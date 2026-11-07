/**
 * `sight console` on Windows, in a terminal: open an Automation
 * connection to a new Stata of the console's own, then run the
 * interactive front end on it.
 */

import type { ColorOutputMode } from '../output-colorizer';
import { EXIT_TERMINAL_UNSUPPORTED } from './exit-codes';
import { open_automation_console } from './open';

export interface AutomationConsoleOptions {
    color_output: ColorOutputMode;
    history: boolean;
    env: NodeJS.ProcessEnv;
}

/** Raw mode is required; check it before touching Stata (code 86). */
function terminal_supports_raw_mode(): boolean {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return false;
    }
    try {
        process.stdin.setRawMode(true);
        process.stdin.setRawMode(false);
        return true;
    } catch {
        return false;
    }
}

export async function run_automation_console(options: AutomationConsoleOptions): Promise<number> {
    if (!terminal_supports_raw_mode()) {
        console.error('Error: sight console needs a terminal that supports raw input.');
        return EXIT_TERMINAL_UNSUPPORTED;
    }

    const opening = open_automation_console({
        env: options.env,
        columns: process.stdout.columns || 80,
        say: (text) => console.error(text),
    });
    // Ctrl+C before the interactive front end starts cancels: at once
    // before connecting, and while connecting once Stata answers (see
    // OpenHandle.cancel); a second Ctrl+C then stops at once.
    const on_sigint = (): void => {
        if (opening.cancel() === 'graceful') {
            console.error('Stopping after Stata answers; press Ctrl+C again to stop at once (a '
                + 'Stata being started may then stay running without a window).');
        }
    };
    process.on('SIGINT', on_sigint);
    const opened = await opening.result;
    process.off('SIGINT', on_sigint);
    if (!opened.ok) {
        if (opened.message) {
            console.error(opened.message);
        }
        return opened.exit_code;
    }

    const { run_interactive } = await import('../interactive');
    const status = await run_interactive({
        color_output: options.color_output,
        history: options.history,
        start_backend: (events) => opened.connection.start_backend(events),
    });
    await opened.connection.finish();
    return status;
}

/**
 * `sight console` on Windows, in a terminal: open an Automation
 * connection to Stata (asking on the terminal before taking over an
 * open one), then run the interactive front end on it.
 */

import * as readline from 'readline';
import type { ColorOutputMode } from '../output-colorizer';
import type { ConnectAnswer, ConnectQuestion } from './connect';
import { EXIT_TERMINAL_UNSUPPORTED } from './exit-codes';
import { open_automation_console } from './open';

export interface AutomationConsoleOptions {
    color_output: ColorOutputMode;
    history: boolean;
    yes: boolean;
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

function ask_on_terminal(question: ConnectQuestion): Promise<ConnectAnswer> {
    const choices = question.allow_send_instead ? '[y/N/s]' : '[y/N]';
    const extra = question.allow_send_instead
        ? '\n  s: leave this Stata alone and send code to it from the editor instead'
        : '';
    const tail = question.kind === 'take_over' ? `${extra}\nContinue? ${choices} ` : ` ${choices} `;
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question.text + tail, (answer) => {
            rl.close();
            // The answer letters are Sight's own prompt, not Stata
            // syntax, so case doesn't matter here.
            const text = answer.trim().toLowerCase();
            if (text === 'y' || text === 'yes') {
                resolve('yes');
            } else if (question.allow_send_instead && text === 's') {
                resolve('send');
            } else {
                resolve('no');
            }
        });
        rl.on('SIGINT', () => {
            rl.close();
            process.emit('SIGINT');
        });
    });
}

export async function run_automation_console(options: AutomationConsoleOptions): Promise<number> {
    if (!terminal_supports_raw_mode()) {
        console.error('Error: sight console needs a terminal that supports raw input.');
        return EXIT_TERMINAL_UNSUPPORTED;
    }

    const opening = open_automation_console({
        env: options.env,
        yes: options.yes,
        from_editor: false,
        columns: process.stdout.columns || 80,
        ask: ask_on_terminal,
        say: (text) => console.error(text),
    });
    // Ctrl+C before the interactive front end starts ends the bridge,
    // which releases any reference (closing that Stata, as the waiting
    // notices say).
    const on_sigint = (): void => opening.cancel();
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

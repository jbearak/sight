/**
 * Wires a console session to the real terminal: raw mode and bracketed
 * paste on the way in, and on the way out (normal exit, Stata exiting,
 * signals, or a crash) a single shutdown that ends the backend and
 * restores the terminal.
 */

import type { ColorOutputMode } from './output-colorizer';
import { signal_exit_status } from './pty';
import type { BackendEvents, BackendHandle } from './backend';
import { start_session_host } from './session-host';

export interface InteractiveOptions {
    color_output: ColorOutputMode;
    history: boolean;
    /**
     * Starts the backend. Events it reports before the session exists
     * are buffered and delivered in order.
     */
    start_backend: (events: BackendEvents, size: { columns: number; rows: number }) => BackendHandle;
}

const BRACKETED_PASTE_ON = '\x1b[?2004h';
const BRACKETED_PASTE_OFF = '\x1b[?2004l';

function shutdown_signals(): NodeJS.Signals[] {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGHUP', 'SIGINT'];
    if (process.platform === 'win32') {
        signals.push('SIGBREAK');
    } else {
        signals.push('SIGQUIT');
    }
    return signals;
}

export function run_interactive(options: InteractiveOptions): Promise<number> {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const signals = shutdown_signals();

    // Writes can fail with EIO/EPIPE once the terminal is gone (e.g.
    // after SIGHUP); there is nobody left to tell, so ignore them.
    const write = (text: string): void => {
        try {
            stdout.write(text);
        } catch {
            // Terminal gone.
        }
    };
    stdout.on('error', () => undefined);

    let restored = false;
    const restore = (): void => {
        if (restored) {
            return;
        }
        restored = true;
        stdin.off('data', on_input);
        stdout.off('resize', on_resize);
        for (const my_signal of signals) {
            process.off(my_signal, on_signal);
        }
        process.off('uncaughtException', on_crash);
        process.off('unhandledRejection', on_crash);
        // Stata turns on application cursor and keypad modes; put the
        // terminal back even if Stata was killed before resetting them.
        write(BRACKETED_PASTE_OFF + '\x1b[?1l\x1b>');
        try {
            stdin.setRawMode(false);
        } catch {
            // Terminal gone.
        }
        stdin.pause();
    };

    const host = start_session_host({
        write,
        columns: () => stdout.columns || 80,
        rows: () => stdout.rows || 24,
        color_output: options.color_output,
        history: options.history,
        start_backend: options.start_backend,
        on_end: restore,
    });

    const input_decoder = new TextDecoder();
    function on_input(chunk: Buffer | string): void {
        host.handle_input(typeof chunk === 'string' ? chunk : input_decoder.decode(chunk, { stream: true }));
    }
    function on_resize(): void {
        host.handle_resize();
    }
    function on_signal(signal: NodeJS.Signals): void {
        void host.shutdown('signal', signal_exit_status(signal));
    }
    function on_crash(error: unknown): void {
        void host.shutdown('crash', 1).then(() => {
            console.error('sight console: internal error:', error);
        });
    }

    stdin.setRawMode(true);
    stdin.on('data', on_input);
    stdin.resume();
    stdout.on('resize', on_resize);
    for (const my_signal of signals) {
        process.on(my_signal, on_signal);
    }
    process.on('uncaughtException', on_crash);
    process.on('unhandledRejection', on_crash);
    write(BRACKETED_PASTE_ON);

    return host.done;
}

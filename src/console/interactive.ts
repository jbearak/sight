/**
 * Wires a ConsoleSession to the real terminal and a Stata backend, and
 * owns the process lifecycle: raw mode and bracketed paste on the way
 * in, and on the way out (normal exit, Stata exiting, signals, or a
 * crash) a single idempotent shutdown that ends the backend and
 * restores the terminal.
 */

import type { ColorOutputMode } from './output-colorizer';
import { ConsoleSession } from './session';
import { History, default_history_path } from './history';
import { SessionCompleter } from './completer';
import { signal_exit_status } from './pty';
import type { BackendEvents, BackendHandle, ShutdownReason } from './backend';

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

type PendingEvent =
    | { kind: 'output'; text: string }
    | { kind: 'notice'; text: string }
    | { kind: 'sight'; text: string }
    | { kind: 'error' };

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

    let session: ConsoleSession | null = null;
    const pending: PendingEvent[] = [];
    const deliver = (event: PendingEvent): void => {
        if (!session) {
            pending.push(event);
            return;
        }
        switch (event.kind) {
            case 'output':
                session.handle_output(event.text);
                return;
            case 'notice':
                session.show_notice(event.text);
                return;
            case 'sight':
                session.write_sight_text(event.text);
                return;
            case 'error':
                session.handle_stata_error();
                return;
        }
    };
    const handle = options.start_backend({
        on_output: (text) => deliver({ kind: 'output', text }),
        on_notice: (text) => deliver({ kind: 'notice', text }),
        on_sight_text: (text) => deliver({ kind: 'sight', text }),
        on_stata_error: () => deliver({ kind: 'error' }),
    }, { columns: stdout.columns || 80, rows: stdout.rows || 24 });

    const completer = new SessionCompleter();
    session = new ConsoleSession({
        backend: handle.backend,
        write,
        columns: () => stdout.columns || 80,
        clock: {
            set_timeout: (callback, delay_ms) => setTimeout(callback, delay_ms),
            clear_timeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        },
        history: new History(options.history ? default_history_path() : null),
        completer,
        color_mode: options.color_output,
    });
    for (const my_event of pending.splice(0)) {
        deliver(my_event);
    }

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

    let finish: (status: number) => void = () => undefined;
    const done = new Promise<number>((resolve) => {
        finish = resolve;
    });

    let ending = false;
    const end = (status: number): void => {
        if (ending) {
            return;
        }
        ending = true;
        session?.handle_exit();
        restore();
        const message = handle.lifecycle.closing_message();
        if (message) {
            write(`${message}\r\n`);
        }
        void completer.dispose();
        finish(status);
    };

    let shutting_down = false;
    const shutdown = async (reason: ShutdownReason, status: number): Promise<void> => {
        if (shutting_down || ending) {
            return;
        }
        shutting_down = true;
        await handle.lifecycle.shutdown(reason);
        end(status);
    };

    function on_input(chunk: Buffer | string): void {
        session?.handle_input(typeof chunk === 'string' ? chunk : input_decoder.decode(chunk, { stream: true }));
    }
    function on_resize(): void {
        handle.backend.resize(stdout.columns || 80, stdout.rows || 24);
        session?.handle_resize();
    }
    function on_signal(signal: NodeJS.Signals): void {
        void shutdown('signal', signal_exit_status(signal));
    }
    function on_crash(error: unknown): void {
        void shutdown('crash', 1).then(() => {
            console.error('sight console: internal error:', error);
        });
    }
    const input_decoder = new TextDecoder();

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

    void handle.lifecycle.exit_status.then((status) => {
        if (!shutting_down) {
            end(status);
        }
    });

    return done;
}

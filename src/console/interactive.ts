/**
 * Wires a ConsoleSession to the real terminal and a Stata PTY, and owns
 * the process lifecycle: raw mode and bracketed paste on the way in, and
 * on the way out (normal exit, Stata exiting, signals, or a crash) a
 * single idempotent shutdown that stops Stata, reaps it, and restores the
 * terminal.
 */

import type { ColorOutputMode } from './output-colorizer';
import { ConsoleSession } from './session';
import { History, default_history_path } from './history';
import { SessionCompleter } from './completer';
import { signal_exit_status, spawn_stata_pty, type StataPty } from './pty';

export interface InteractiveOptions {
    stata_path: string;
    stata_args: readonly string[];
    color_output: ColorOutputMode;
    history: boolean;
    stata_echoes: boolean;
}

const BRACKETED_PASTE_ON = '\x1b[?2004h';
const BRACKETED_PASTE_OFF = '\x1b[?2004l';
/** How long Stata gets to exit after SIGHUP before SIGKILL. */
const CHILD_EXIT_GRACE_MS = 2000;
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGHUP', 'SIGINT', 'SIGQUIT'];

export function run_interactive(options: InteractiveOptions): Promise<number> {
    const stdin = process.stdin;
    const stdout = process.stdout;

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
    const pending_output: string[] = [];
    const pty: StataPty = spawn_stata_pty({
        command: options.stata_path,
        args: options.stata_args,
        columns: stdout.columns || 80,
        rows: stdout.rows || 24,
        on_data: (text) => {
            if (session) {
                session.handle_output(text);
            } else {
                pending_output.push(text);
            }
        },
    });

    const completer = new SessionCompleter();
    session = new ConsoleSession({
        pty,
        write,
        columns: () => stdout.columns || 80,
        clock: {
            set_timeout: (callback, delay_ms) => setTimeout(callback, delay_ms),
            clear_timeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        history: new History(options.history ? default_history_path() : null),
        completer,
        color_mode: options.color_output,
        stata_echoes: options.stata_echoes,
    });
    for (const my_text of pending_output.splice(0)) {
        session.handle_output(my_text);
    }

    let restored = false;
    const restore = (): void => {
        if (restored) {
            return;
        }
        restored = true;
        stdin.off('data', on_input);
        stdout.off('resize', on_resize);
        for (const my_signal of SHUTDOWN_SIGNALS) {
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

    let shutting_down = false;
    const shutdown = async (status: number): Promise<void> => {
        if (shutting_down) {
            return;
        }
        shutting_down = true;
        pty.kill('SIGHUP');
        const exited = await Promise.race([
            pty.exit_status.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CHILD_EXIT_GRACE_MS)),
        ]);
        if (!exited) {
            pty.kill('SIGKILL');
            await pty.exit_status;
        }
        session?.handle_exit();
        pty.close();
        restore();
        void completer.dispose();
        finish(status);
    };

    function on_input(chunk: Buffer | string): void {
        session?.handle_input(typeof chunk === 'string' ? chunk : input_decoder.decode(chunk, { stream: true }));
    }
    function on_resize(): void {
        pty.resize(stdout.columns || 80, stdout.rows || 24);
        session?.handle_resize();
    }
    function on_signal(signal: NodeJS.Signals): void {
        void shutdown(signal_exit_status(signal));
    }
    function on_crash(error: unknown): void {
        void shutdown(1).then(() => {
            console.error('sight console: internal error:', error);
        });
    }
    const input_decoder = new TextDecoder();

    stdin.setRawMode(true);
    stdin.on('data', on_input);
    stdin.resume();
    stdout.on('resize', on_resize);
    for (const my_signal of SHUTDOWN_SIGNALS) {
        process.on(my_signal, on_signal);
    }
    process.on('uncaughtException', on_crash);
    process.on('unhandledRejection', on_crash);
    write(BRACKETED_PASTE_ON);

    void pty.exit_status.then((status) => {
        if (shutting_down) {
            return;
        }
        shutting_down = true;
        session?.handle_exit();
        pty.close();
        restore();
        void completer.dispose();
        finish(status);
    });

    return done;
}

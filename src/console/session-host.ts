/**
 * Runs a ConsoleSession on a Stata backend for some display: the real
 * terminal (`run_interactive`) or an editor's own terminal pane (the
 * VS Code extension on Windows). The display supplies writes, its
 * size, and keystrokes; the host owns the session, the completer and
 * a single idempotent end.
 */

import type { ColorOutputMode } from './output-colorizer';
import { ConsoleSession } from './session';
import { History, default_history_path } from './history';
import { SessionCompleter } from './completer';
import type { BackendEvents, BackendHandle, ShutdownReason } from './backend';

export interface SessionHostOptions {
    write: (text: string) => void;
    columns: () => number;
    rows: () => number;
    color_output: ColorOutputMode;
    history: boolean;
    /** Where relative paths complete from (default: the cwd). */
    working_directory?: string;
    /**
     * Starts the backend. Events it reports before the session exists
     * are buffered and delivered in order.
     */
    start_backend: (events: BackendEvents, size: { columns: number; rows: number }) => BackendHandle;
    /** Called once as the session ends, before the closing message. */
    on_end?: () => void;
}

export interface SessionHost {
    handle_input(text: string): void;
    handle_resize(): void;
    /** End the session (Stata too, as the backend's policy says). */
    shutdown(reason: ShutdownReason, status: number): Promise<void>;
    /** Resolves once with the exit status. */
    readonly done: Promise<number>;
}

type PendingEvent =
    | { kind: 'output'; text: string }
    | { kind: 'notice'; text: string }
    | { kind: 'sight'; text: string }
    | { kind: 'error' };

export function start_session_host(options: SessionHostOptions): SessionHost {
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
    }, { columns: options.columns(), rows: options.rows() });

    const completer = new SessionCompleter(options.working_directory);
    session = new ConsoleSession({
        backend: handle.backend,
        write: options.write,
        columns: options.columns,
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
        options.on_end?.();
        const message = handle.lifecycle.closing_message();
        if (message) {
            options.write(`${message}\r\n`);
        }
        void completer.dispose();
        finish(status);
    };

    let shutting_down = false;
    void handle.lifecycle.exit_status.then((status) => {
        if (!shutting_down) {
            end(status);
        }
    });

    return {
        handle_input: (text) => {
            if (!ending) {
                session?.handle_input(text);
            }
        },
        handle_resize: () => {
            if (ending) {
                return;
            }
            handle.backend.resize(options.columns(), options.rows());
            session?.handle_resize();
        },
        shutdown: async (reason, status) => {
            if (shutting_down || ending) {
                return;
            }
            shutting_down = true;
            await handle.lifecycle.shutdown(reason);
            end(status);
        },
        done,
    };
}

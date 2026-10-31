/**
 * `sight console` for an editor's own terminal pane: the VS Code
 * extension runs this in its own process and shows it in an extension
 * terminal. Keystrokes come in through `handle_input`, and the
 * console's bytes go out through `host.write`, exactly as on a real
 * terminal.
 *
 * On Windows it drives the Stata app through Automation. On macOS and
 * Linux it runs console Stata in a pseudo-terminal opened by the
 * sight-pty helper (helper-pty.ts), since the extension's Node runtime
 * can't open one itself.
 *
 * Bundled separately (client/console-runtime/console.js) and loaded
 * only when needed; the extension mirrors these types.
 */

import type { ConnectAnswer, ConnectQuestion } from './automation/connect';
import { open_automation_console } from './automation/open';
import { DEFAULT_STATA_ARGS } from './args';
import { spawn_helper_pty, type HelperPty } from './helper-pty';
import { create_pty_handle } from './pty-backend';
import { start_session_host, type SessionHost } from './session-host';

/** Bumped when the contract below changes incompatibly. */
export const EDITOR_CONSOLE_API_VERSION = 2;

/** macOS and Linux: how to run console Stata. */
export interface EditorConsolePty {
    /** The sight-pty helper for this platform. */
    helper_path: string;
    /** Stata's console binary (stata-mp, ...). */
    stata_path: string;
}

export interface EditorConsoleHost {
    write(text: string): void;
    columns(): number;
    rows(): number;
    /** Ask the user (a dialog); a dismissed question counts as no. */
    ask(question: ConnectQuestion): Promise<ConnectAnswer>;
    env: NodeJS.ProcessEnv;
    /**
     * Where relative paths complete from; on macOS and Linux also
     * Stata's working directory.
     */
    working_directory?: string;
    /** Required on macOS and Linux; unused on Windows. */
    pty?: EditorConsolePty;
}

export interface EditorConsoleEnd {
    /**
     * 0 after a normal end; 80-85 when the console didn't take Stata
     * (see docs/console.md, "Exit codes on Windows"); 130 if cancelled;
     * otherwise an error.
     */
    code: number;
    /** True if the console had Stata (its session ran). */
    took_stata: boolean;
    /**
     * macOS and Linux: the sight-pty helper failed (it couldn't start,
     * or the system ended it before it reported on Stata), so plain
     * Stata may still work where the console didn't.
     */
    helper_failed?: boolean;
}

export interface EditorConsole {
    handle_input(text: string): void;
    handle_resize(): void;
    /** The pane was closed: end, which closes Stata if it was taken. */
    close(): void;
    /** Resolves true at the first prompt, or false if it ends first. */
    readonly ready: Promise<boolean>;
    readonly done: Promise<EditorConsoleEnd>;
}

const BRACKETED_PASTE_ON = '\x1b[?2004h';

/** Turn bare newlines into the CR LF a terminal needs. */
function as_terminal_text(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

export function start_editor_console(host: EditorConsoleHost): EditorConsole {
    if (process.platform !== 'win32') {
        return start_pty_console(host);
    }
    let session: SessionHost | null = null;
    let closed = false;
    let resolve_ready: (value: boolean) => void = () => undefined;
    const ready = new Promise<boolean>((resolve) => {
        resolve_ready = resolve;
    });

    const opening = open_automation_console({
        env: host.env,
        yes: false,
        from_editor: true,
        columns: host.columns(),
        ask: host.ask,
        say: (text) => host.write(`${as_terminal_text(text)}\r\n`),
    });

    const run = async (): Promise<EditorConsoleEnd> => {
        const opened = await opening.result;
        if (!opened.ok) {
            if (opened.message) {
                host.write(`${as_terminal_text(opened.message)}\r\n`);
            }
            return { code: opened.exit_code, took_stata: false };
        }
        host.write(BRACKETED_PASTE_ON);
        const session_host = start_session_host({
            write: host.write,
            columns: host.columns,
            rows: host.rows,
            color_output: host.env.NO_COLOR ? 'off' : 'streams',
            history: true,
            working_directory: host.working_directory,
            start_backend: (events) => {
                const handle = opened.connection.start_backend(events);
                resolve_ready(true);
                return handle;
            },
        });
        session = session_host;
        if (closed) {
            void session_host.shutdown('user', 0);
        }
        const status = await session_host.done;
        await opened.connection.finish();
        return { code: status, took_stata: true };
    };

    const done = run().catch((error: unknown) => {
        host.write(`sight console: internal error: ${as_terminal_text(String(error))}\r\n`);
        return { code: 1, took_stata: session !== null };
    }).then((end) => {
        resolve_ready(false);
        return end;
    });

    return {
        handle_input: (text) => session?.handle_input(text),
        handle_resize: () => session?.handle_resize(),
        close: () => {
            if (closed) {
                return;
            }
            closed = true;
            if (session) {
                void session.shutdown('user', 0);
            } else {
                opening.cancel();
            }
        },
        ready,
        done,
    };
}

/** Console Stata in a pseudo-terminal through the sight-pty helper. */
function start_pty_console(host: EditorConsoleHost): EditorConsole {
    let resolve_ready: (value: boolean) => void = () => undefined;
    const ready = new Promise<boolean>((resolve) => {
        resolve_ready = resolve;
    });
    const pty_host = host.pty;
    if (!pty_host) {
        host.write('sight console: no pseudo-terminal helper was given.\r\n');
        resolve_ready(false);
        return {
            handle_input: () => undefined,
            handle_resize: () => undefined,
            close: () => undefined,
            ready,
            done: Promise.resolve({
                code: 1, took_stata: false, helper_failed: true,
            }),
        };
    }
    // A VS Code started from the Dock or Finder has no TERM.
    const env = { ...host.env, TERM: host.env.TERM || 'xterm-256color' };
    let helper: HelperPty | null = null;
    let session: SessionHost | null = null;
    let was_ready = false;
    const run = async (): Promise<EditorConsoleEnd> => {
        host.write(BRACKETED_PASTE_ON);
        const session_host = start_session_host({
            write: host.write,
            columns: host.columns,
            rows: host.rows,
            color_output: host.env.NO_COLOR ? 'off' : 'streams',
            history: true,
            working_directory: host.working_directory,
            // Before Stata's first prompt it may still discard typed
            // input, so sends wait for this.
            on_ready: () => {
                was_ready = true;
                resolve_ready(true);
            },
            start_backend: (events, size) => create_pty_handle({
                stata_path: pty_host.stata_path,
                stata_args: DEFAULT_STATA_ARGS,
                columns: size.columns,
                rows: size.rows,
                stata_echoes: false,
            }, events, (pty_options) => {
                helper = spawn_helper_pty({
                    ...pty_options,
                    env,
                    helper_path: pty_host.helper_path,
                    cwd: host.working_directory,
                    on_helper_error: (message) => events.on_sight_text(
                        `sight console: ${message}`
                    ),
                });
                return helper;
            }),
        });
        session = session_host;
        const status = await session_host.done;
        const helper_failed = helper?.helper_failed() ?? true;
        return { code: status, took_stata: was_ready, helper_failed };
    };
    const done = run().catch((error: unknown) => {
        host.write(`sight console: internal error: ${as_terminal_text(String(error))}\r\n`);
        return { code: 1, took_stata: false, helper_failed: helper === null };
    }).then((end) => {
        resolve_ready(false);
        return end;
    });
    return {
        handle_input: (text) => session?.handle_input(text),
        handle_resize: () => session?.handle_resize(),
        close: () => {
            void session?.shutdown('user', 0);
        },
        ready,
        done,
    };
}

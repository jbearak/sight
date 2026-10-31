/**
 * `sight console` for an editor's own terminal pane, on Windows: the
 * VS Code extension runs this in its own process and shows it in an
 * extension terminal (no separate program, so no OS terminal needed).
 * Keystrokes come in through `handle_input`, and the console's bytes go
 * out through `host.write`, exactly as on a real terminal.
 *
 * Bundled separately (client/console-runtime/console.js) and loaded
 * only when needed; the extension mirrors these types.
 */

import type { ConnectAnswer, ConnectQuestion } from './automation/connect';
import { open_automation_console } from './automation/open';
import { start_session_host, type SessionHost } from './session-host';

/** Bumped when the contract below changes incompatibly. */
export const EDITOR_CONSOLE_API_VERSION = 1;

export interface EditorConsoleHost {
    write(text: string): void;
    columns(): number;
    rows(): number;
    /** Ask the user (a dialog); a dismissed question counts as no. */
    ask(question: ConnectQuestion): Promise<ConnectAnswer>;
    env: NodeJS.ProcessEnv;
    /** Where relative paths complete from. */
    working_directory?: string;
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

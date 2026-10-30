/**
 * The backend for console Stata on macOS and Linux: Stata runs in a
 * pseudo-terminal, which already speaks the byte stream the session
 * expects.
 */

import type { BackendEvents, BackendHandle, ShutdownReason, StataBackend } from './backend';
import { spawn_stata_pty, type StataPty } from './pty';

/**
 * Longest line sent while the child terminal is in canonical mode; the
 * kernel's line buffer (MAX_CANON, 1024 bytes on macOS) drops the rest.
 */
export const MAX_CANONICAL_LINE_BYTES = 1000;

/** How long Stata gets to exit after SIGHUP before SIGKILL. */
const CHILD_EXIT_GRACE_MS = 2000;

export interface PtyBackendOptions {
    /** Set when Stata is known to echo input itself (`--stata-echoes`). */
    stata_echoes: boolean;
}

export class PtyBackend implements StataBackend {
    constructor(
        private readonly pty: StataPty,
        private readonly options: PtyBackendOptions,
    ) {}

    submit_line(line: string): void {
        // A real keyboard sends CR for Enter; the terminal turns it
        // into a newline in canonical mode, as when typing.
        this.pty.write(line + '\r');
    }

    answer_more(key: string): void {
        // Writing the key plus Enter works whether Stata reads it
        // line-buffered or as a single key.
        const enter = key === '' || this.pty.canonical_mode() ? '\r' : '';
        this.pty.write(key + enter);
    }

    interrupt(): void {
        this.pty.interrupt();
    }

    resize(columns: number, rows: number): void {
        this.pty.resize(columns, rows);
    }

    echoes_input(): boolean {
        // Stata's console normally puts its terminal in raw mode and
        // echoes what it reads itself; a terminal with echo on does too.
        return this.options.stata_echoes || this.pty.echo_enabled()
            || !this.pty.canonical_mode();
    }

    max_line_bytes(): number | null {
        return this.pty.canonical_mode() ? MAX_CANONICAL_LINE_BYTES : null;
    }
}

export interface PtyHandleOptions {
    stata_path: string;
    stata_args: readonly string[];
    columns: number;
    rows: number;
    stata_echoes: boolean;
}

/** Start Stata in a PTY and wrap it as a backend with its lifecycle. */
export function create_pty_handle(options: PtyHandleOptions, events: BackendEvents): BackendHandle {
    const pty = spawn_stata_pty({
        command: options.stata_path,
        args: options.stata_args,
        columns: options.columns,
        rows: options.rows,
        on_data: (text) => events.on_output(text),
    });
    let shutting_down = false;
    const exit_status = pty.exit_status.then((status) => {
        pty.close();
        return status;
    });
    return {
        backend: new PtyBackend(pty, { stata_echoes: options.stata_echoes }),
        lifecycle: {
            exit_status,
            closing_message: () => null,
            shutdown: async (_reason: ShutdownReason): Promise<void> => {
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
                pty.close();
            },
        },
    };
}

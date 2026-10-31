/**
 * The seam between the console session and Stata.
 *
 * A backend makes Stata look like console Stata in a terminal: it
 * delivers the bytes a pseudo-terminal would deliver (prompts, Stata's
 * echo of each line as Stata reads it, output) and takes whole lines.
 * The session keeps editing, prompt detection, echo removal and colors.
 *
 * Two backends exist: the PTY backend (console Stata on macOS and
 * Linux) and the Automation backend (the Stata GUI on Windows, driven
 * through COM).
 */

export interface StataBackend {
    /**
     * Send one entered line (no newline). `drawn` is the session's own
     * decision: true when it drew the highlighted line itself, false
     * when it left the line for Stata's echo (typeahead).
     */
    submit_line(line: string, drawn: boolean): void;
    /** Answer `--more--` with one key ('' for Enter). */
    answer_more(key: string): void;
    /** Ctrl+C. The backend decides what Stata needs. */
    interrupt(): void;
    resize(columns: number, rows: number): void;
    /** Whether Stata prints its own copy of each line it reads. */
    echoes_input(): boolean;
    /** Longest line in bytes the backend can send, or null. */
    max_line_bytes(): number | null;
}

/** What a backend reports, delivered to the session in order. */
export interface BackendEvents {
    /** Bytes as a terminal running console Stata would show them. */
    on_output(text: string): void;
    /** A short, one-row note under the editor; cleared by a key. */
    on_notice(text: string): void;
    /** A lasting line of Sight's own, outside Stata's output. */
    on_sight_text(text: string): void;
    /** Stata reported an error that output didn't show (log lost). */
    on_stata_error(): void;
}

export type ShutdownReason = 'user' | 'signal' | 'crash';

export interface BackendLifecycle {
    /** End the session; resolves when done or given up. */
    shutdown(reason: ShutdownReason): Promise<void>;
    /** Resolves once with the console's exit status. */
    readonly exit_status: Promise<number>;
    /** Printed after the terminal is restored, if any. */
    closing_message(): string | null;
}

export interface BackendHandle {
    backend: StataBackend;
    lifecycle: BackendLifecycle;
}

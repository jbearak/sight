/**
 * The Stata pane: an extension terminal (VS Code's Pseudoterminal)
 * that runs `sight console` inside the extension process, so it needs
 * no separate install. On Windows the console drives the Stata app; on
 * macOS and Linux it runs console Stata through the small sight-pty
 * helper shipped with the extension (client/pty-helper/). The pane
 * only carries keystrokes in and bytes out.
 *
 * The console code is bundled separately (console-runtime/console.js)
 * and loaded the first time a pane opens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as vscode from 'vscode';
import {
    hold_temp_file,
    release_temp_file,
    schedule_temp_file_cleanup
} from './temp-file.js';

// ---- The console runtime's contract (src/console/editor-console.ts) ----

export const EDITOR_CONSOLE_API_VERSION = 3;

export interface EditorConsolePty {
    helper_path: string;
    stata_path: string;
}

export interface EditorConsoleHost {
    write(text: string): void;
    columns(): number;
    rows(): number;
    env: NodeJS.ProcessEnv;
    working_directory?: string;
    pty?: EditorConsolePty;
}

export interface EditorConsoleEnd {
    code: number;
    took_stata: boolean;
    helper_failed?: boolean;
}

export interface EditorConsole {
    handle_input(text: string): void;
    send_line(line: string): Promise<boolean>;
    handle_resize(): void;
    close(): void;
    readonly ready: Promise<boolean>;
    readonly done: Promise<EditorConsoleEnd>;
}

export interface EditorConsoleModule {
    EDITOR_CONSOLE_API_VERSION: number;
    start_editor_console(host: EditorConsoleHost): EditorConsole;
}

const CONSOLE_RUNTIME_RELATIVE_PATH = path.join(
    'console-runtime', 'console.js'
);

/** Load the bundled console runtime from the extension's directory. */
export async function load_console_module(
    extension_path: string
): Promise<EditorConsoleModule> {
    const file_path = path.join(
        extension_path, CONSOLE_RUNTIME_RELATIVE_PATH
    );
    const loaded = await import(pathToFileURL(file_path).href) as
        Partial<EditorConsoleModule> & { default?: Partial<EditorConsoleModule> };
    const the_module = typeof loaded.start_editor_console === 'function'
        ? loaded
        : loaded.default;
    if (
        !the_module
        || typeof the_module.start_editor_console !== 'function'
        || the_module.EDITOR_CONSOLE_API_VERSION !== EDITOR_CONSOLE_API_VERSION
    ) {
        throw new Error(
            'The Sight extension\'s console runtime is missing or out of '
            + 'date; reinstall the extension.'
        );
    }
    return the_module as EditorConsoleModule;
}

// ---- The pane ----

/** How the pane's console ended, reported once. */
export type PaneEnd =
    | {
        reason: 'process';
        code: number;
        took_stata: boolean;
        helper_failed?: boolean;
    }
    | { reason: 'user' };

export interface ConsolePaneOptions {
    load_module: () => Promise<EditorConsoleModule>;
    working_directory?: string;
    /** macOS and Linux: the helper and Stata to run. */
    pty?: EditorConsolePty;
    /** The console showed its first prompt. */
    on_ready: () => void;
    /** Called once, before the pane closes (if it does). */
    on_end: (end: PaneEnd) => void;
}

export interface ConsolePane {
    readonly pty: vscode.Pseudoterminal;
    /**
     * Enter a line in the console, as if typed at its prompt (but
     * never as an answer to `--more--`). With `temp_file_path`, the
     * pane owns that file from now on: it is kept until the console
     * gives the line to Stata (a long command may run first), then
     * deleted after the usual delay; deleted at once if the console
     * reports it never gave the line to Stata. A line the console
     * hasn't answered for when the pane ends may already be Stata's,
     * so its file is kept for the usual delay too.
     *
     * A pane without `pty` (Windows) can't tell when Stata reads the
     * file: Stata's Automation takes a line at once and queues it
     * while Stata is busy with a command typed into its own window.
     * So that pane keeps its last KEPT_FILE_LIMIT delivered files
     * until it ends, and the usual delay starts then; an older one
     * is deleted when a newer send is delivered.
     */
    type_line(text: string, temp_file_path?: string): void;
}

/**
 * How many delivered files a Windows pane keeps. The console gives
 * Stata one sent line at a time, so only the newest can still be
 * waiting; the rest are a margin.
 */
export const KEPT_FILE_LIMIT = 20;
const PRESS_ANY_KEY = '\r\n[Press any key to close this pane.]';
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

export function create_console_pane(
    options: ConsolePaneOptions
): ConsolePane {
    const write_emitter = new vscode.EventEmitter<string>();
    const close_emitter = new vscode.EventEmitter<number | void>();
    let columns = DEFAULT_COLUMNS;
    let rows = DEFAULT_ROWS;
    let the_console: EditorConsole | null = null;
    let ended = false;
    let waiting_for_key = false;
    let user_closed = false;
    /** Temp files of typed lines the console hasn't answered for. */
    const the_held_files = new Set<string>();
    /** Windows: the last delivered files, oldest first. */
    const the_kept_files: string[] = [];
    const keeps_delivered_files = options.pty === undefined;
    /** Cleanups end_held_files scheduled, by file. */
    const the_end_cleanups = new Map<string, NodeJS.Timeout>();

    const settle_file = (file_path: string, sent: boolean): void => {
        if (!the_held_files.delete(file_path)) {
            return;
        }
        release_temp_file(file_path);
        const end_cleanup = the_end_cleanups.get(file_path);
        the_end_cleanups.delete(file_path);
        if (!sent) {
            // Deleted once: a later file at this path must outlive
            // the cleanup scheduled when the pane ended.
            if (end_cleanup !== undefined) {
                clearTimeout(end_cleanup);
            }
            fs.promises.unlink(file_path).catch(() => {});
        } else if (!ended) {
            if (!keeps_delivered_files) {
                schedule_temp_file_cleanup(file_path);
                return;
            }
            the_kept_files.push(file_path);
            while (the_kept_files.length > KEPT_FILE_LIMIT) {
                const oldest = the_kept_files.shift();
                if (oldest !== undefined) {
                    fs.promises.unlink(oldest).catch(() => {});
                }
            }
        }
        // Ended: its cleanup was scheduled then (end_held_files).
    };
    /**
     * The pane is ending with lines not answered for. One the console
     * gave to Stata (a Windows send whose reply is still due) may yet
     * run, so each file gets the usual delay now; one the console
     * then reports never sent goes at once.
     */
    const end_held_files = (): void => {
        for (const my_file of the_held_files) {
            release_temp_file(my_file);
            the_end_cleanups.set(
                my_file, schedule_temp_file_cleanup(my_file)
            );
        }
        for (const my_file of the_kept_files.splice(0)) {
            schedule_temp_file_cleanup(my_file);
        }
    };

    const write = (text: string): void => {
        write_emitter.fire(text);
    };
    const end_once = (end: PaneEnd): void => {
        if (ended) {
            return;
        }
        ended = true;
        end_held_files();
        options.on_end(end);
    };
    const finish = (end: EditorConsoleEnd): void => {
        if (user_closed) {
            return;
        }
        end_once({ reason: 'process', ...end });
        if (end.code === 0) {
            close_emitter.fire(0);
            return;
        }
        // Leave the console's last words (an error, or why it didn't
        // take Stata) on screen until a key.
        write(PRESS_ANY_KEY);
        waiting_for_key = true;
    };

    const start = async (): Promise<void> => {
        let the_module: EditorConsoleModule;
        try {
            the_module = await options.load_module();
        } catch (my_error) {
            write(`${my_error instanceof Error ? my_error.message : my_error}\r\n`);
            finish({ code: 1, took_stata: false });
            return;
        }
        if (user_closed) {
            return;
        }
        const started = the_module.start_editor_console({
            write,
            columns: () => columns,
            rows: () => rows,
            env: process.env,
            working_directory: options.working_directory,
            pty: options.pty,
        });
        the_console = started;
        void started.ready.then(is_ready => {
            if (is_ready && !ended) {
                options.on_ready();
            }
        });
        void started.done.then(finish, () => {
            finish({ code: 1, took_stata: false });
        });
    };

    const pty: vscode.Pseudoterminal = {
        onDidWrite: write_emitter.event,
        onDidClose: close_emitter.event,
        open: (dimensions) => {
            if (dimensions) {
                columns = dimensions.columns;
                rows = dimensions.rows;
            }
            void start();
        },
        close: () => {
            // The user closed the pane (or VS Code is shutting down):
            // end the console, which closes its Stata.
            user_closed = true;
            end_once({ reason: 'user' });
            the_console?.close();
        },
        handleInput: (data) => {
            if (waiting_for_key) {
                waiting_for_key = false;
                close_emitter.fire();
                return;
            }
            the_console?.handle_input(data);
        },
        setDimensions: (dimensions) => {
            columns = dimensions.columns;
            rows = dimensions.rows;
            the_console?.handle_resize();
        },
    };

    return {
        pty,
        type_line: (text, temp_file_path) => {
            if (!the_console) {
                throw new Error('sight console is not running.');
            }
            const sent = the_console.send_line(text);
            if (temp_file_path === undefined) {
                return;
            }
            hold_temp_file(temp_file_path);
            the_held_files.add(temp_file_path);
            sent.then(
                is_sent => settle_file(temp_file_path, is_sent),
                () => settle_file(temp_file_path, false)
            );
        },
    };
}

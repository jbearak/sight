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

import * as path from 'path';
import { pathToFileURL } from 'url';
import * as vscode from 'vscode';

// ---- The console runtime's contract (src/console/editor-console.ts) ----

export const EDITOR_CONSOLE_API_VERSION = 2;

export type ConsoleAnswer = 'yes' | 'no' | 'send';

export interface ConsoleQuestion {
    kind: 'take_over' | 'keep';
    text: string;
    allow_send_instead: boolean;
}

export interface EditorConsolePty {
    helper_path: string;
    stata_path: string;
}

export interface EditorConsoleHost {
    write(text: string): void;
    columns(): number;
    rows(): number;
    ask(question: ConsoleQuestion): Promise<ConsoleAnswer>;
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
    ask: (question: ConsoleQuestion) => Promise<ConsoleAnswer>;
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
    /** Type a line into the console, as if entered at its prompt. */
    type_line(text: string): void;
}

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

    const write = (text: string): void => {
        write_emitter.fire(text);
    };
    const end_once = (end: PaneEnd): void => {
        if (ended) {
            return;
        }
        ended = true;
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
            ask: options.ask,
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
        type_line: (text) => {
            if (!the_console) {
                throw new Error('sight console is not running.');
            }
            the_console.handle_input(`${text}\r`);
        },
    };
}

/** Ask the console's questions as VS Code dialogs. */
export async function ask_with_dialog(
    question: ConsoleQuestion
): Promise<ConsoleAnswer> {
    if (question.kind === 'take_over') {
        const take_over = 'Take over';
        const send_instead = 'Send code to it instead';
        const the_items = question.allow_send_instead
            ? [take_over, send_instead]
            : [take_over];
        const choice = await vscode.window.showWarningMessage(
            question.text, { modal: true }, ...the_items
        );
        if (choice === take_over) {
            return 'yes';
        }
        return choice === send_instead ? 'send' : 'no';
    }
    const keep = 'Keep using it';
    const choice = await vscode.window.showWarningMessage(
        question.text, { modal: true }, keep
    );
    return choice === keep ? 'yes' : 'no';
}

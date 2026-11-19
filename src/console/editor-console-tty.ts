/**
 * The editor console (editor-console.ts) as a program on a real
 * terminal, for a terminal session the extension doesn't host itself:
 * in a remote window with Perch installed, the VS Code extension runs
 * this in a Perch session, so the console outlives a closed window or a
 * dropped connection. (`sight console` needs Bun's PTY API; this runs
 * on the extension host's Node and uses the sight-pty helper instead.)
 *
 * Bundled as client/console-runtime/tty.js, next to console.js, which
 * it loads. Arguments:
 *
 *   --helper PATH      the sight-pty helper
 *   --stata PATH       Stata's console binary
 *   --cwd DIR          Stata's working directory
 *   --ready-file PATH  written (atomically, 0600) at the first prompt
 *   --end-file PATH    written when the console ends on its own
 *   --run LINE         typed at the first prompt (the first do/run)
 *
 * Its input is keys, plus editor sends in an escape sequence
 * (editor-send-channel.ts), which it enters at Stata's prompt as the
 * pane's sends are, never as keys. It deletes each send's do-file
 * once Stata has read the line, or at once if Stata never will.
 *
 * It exits with the console's code. After a failure it leaves the
 * console's last words on screen until a key, as the pane does.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    EditorConsole,
    EditorConsoleEnd,
    EditorConsoleHost,
} from './editor-console';
import { EditorSendDecoder, type EditorSend } from './editor-send-channel';

/** Mirrors editor-console.ts and the extension's console-pane.ts. */
const EDITOR_CONSOLE_API_VERSION = 3;
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const PRESS_ANY_KEY = '\r\n[Press any key to close this pane.]';
/** How long a lone ESC waits to be read as the start of a send. */
const SEND_START_WAIT_MS = 25;
/** As the extension's temp-file cleanup: Stata has read the line. */
const SENT_FILE_CLEANUP_MS = 30000;

interface EditorConsoleModule {
    EDITOR_CONSOLE_API_VERSION: number;
    start_editor_console(host: EditorConsoleHost): EditorConsole;
}

export interface TtyConsoleArgs {
    helper_path: string;
    stata_path: string;
    working_directory?: string;
    ready_file?: string;
    end_file?: string;
    run_line?: string;
}

const VALUE_FLAGS: ReadonlyMap<string, keyof TtyConsoleArgs> = new Map([
    ['--helper', 'helper_path'],
    ['--stata', 'stata_path'],
    ['--cwd', 'working_directory'],
    ['--ready-file', 'ready_file'],
    ['--end-file', 'end_file'],
    ['--run', 'run_line'],
]);

export function parse_tty_console_args(
    argv: readonly string[]
): TtyConsoleArgs | string {
    const parsed: Partial<TtyConsoleArgs> = {};
    for (let i = 0; i < argv.length; i += 2) {
        const flag = argv[i] ?? '';
        const key = VALUE_FLAGS.get(flag);
        const value = argv[i + 1];
        if (key === undefined) {
            return `unknown argument: ${flag}`;
        }
        if (value === undefined) {
            return `${flag} needs a value`;
        }
        parsed[key] = value;
    }
    if (!parsed.helper_path || !parsed.stata_path) {
        return '--helper and --stata are required';
    }
    return {
        ...parsed,
        helper_path: parsed.helper_path,
        stata_path: parsed.stata_path,
    };
}

/** Write a small file atomically (a temporary file, then rename). */
function write_file_atomic(file_path: string, text: string): void {
    const temp_path = `${file_path}.${process.pid}.tmp`;
    fs.writeFileSync(temp_path, text, { mode: 0o600 });
    fs.renameSync(temp_path, file_path);
}

function try_write_file(file_path: string | undefined, text: string): void {
    if (!file_path) {
        return;
    }
    try {
        write_file_atomic(file_path, text);
    } catch (my_error) {
        process.stdout.write(
            `sight console: could not write ${file_path}: `
            + `${my_error instanceof Error ? my_error.message : my_error}\r\n`
        );
    }
}

function load_console_module(): EditorConsoleModule {
    // console.js is a CommonJS bundle next to this one.
    const loaded = require(path.join(__dirname, 'console.js')) as
        Partial<EditorConsoleModule>;
    if (
        typeof loaded.start_editor_console !== 'function'
        || loaded.EDITOR_CONSOLE_API_VERSION !== EDITOR_CONSOLE_API_VERSION
    ) {
        throw new Error(
            'The Sight extension\'s console runtime is missing or out of '
            + 'date; reinstall the extension.'
        );
    }
    return loaded as EditorConsoleModule;
}

export function run_tty_console(args: TtyConsoleArgs): void {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let key_reader: ((text: string) => void) | null = null;
    let the_console: EditorConsole | null = null;
    let closing = false;
    let ended = false;
    const decoder = new EditorSendDecoder();
    let partial_timer: ReturnType<typeof setTimeout> | null = null;
    /** Sent files waiting out their cleanup delay. */
    const the_sent_files = new Map<string, ReturnType<typeof setTimeout>>();

    const delete_file = (file_path: string): void => {
        try {
            fs.unlinkSync(file_path);
        } catch {
            // Gone already.
        }
    };
    const settle_file = (file_path: string, sent: boolean): void => {
        if (!sent) {
            delete_file(file_path);
            return;
        }
        const timer = setTimeout(() => {
            the_sent_files.delete(file_path);
            delete_file(file_path);
        }, SENT_FILE_CLEANUP_MS);
        the_sent_files.set(file_path, timer);
    };

    const exit = (code: number): void => {
        if (stdin.isTTY) {
            stdin.setRawMode(false);
        }
        // Stata has ended, so it reads none of these any more.
        for (const [my_file, my_timer] of the_sent_files) {
            clearTimeout(my_timer);
            delete_file(my_file);
        }
        process.exit(code);
    };

    const handle_keys = (text: string): void => {
        if (key_reader) {
            const reader = key_reader;
            key_reader = null;
            reader(text);
            return;
        }
        the_console?.handle_input(text);
    };
    // An editor send (editor-send-channel.ts): entered by the console
    // at a prompt, never taken as keys. Its file goes once Stata has
    // read the line, or at once if it never will.
    const handle_send = (send: EditorSend): void => {
        const file = send.file;
        if (!the_console || closing || ended) {
            if (file !== undefined) {
                settle_file(file, false);
            }
            return;
        }
        void the_console.send_line(send.line).then((sent) => {
            if (file !== undefined) {
                settle_file(file, sent);
            }
        });
    };
    const handle_events = (
        the_events: ReturnType<EditorSendDecoder['push']>
    ): void => {
        for (const my_event of the_events) {
            if (my_event.type === 'keys') {
                handle_keys(my_event.text);
            } else {
                handle_send(my_event.send);
            }
        }
    };

    if (stdin.isTTY) {
        stdin.setRawMode(true);
    }
    stdin.setEncoding('utf8');
    stdin.on('data', (text: string) => {
        if (partial_timer !== null) {
            clearTimeout(partial_timer);
            partial_timer = null;
        }
        handle_events(decoder.push(text));
        if (decoder.has_partial_start()) {
            partial_timer = setTimeout(() => {
                partial_timer = null;
                handle_events(decoder.flush_partial());
            }, SEND_START_WAIT_MS);
        }
    });
    stdin.resume();

    const read_key = (): Promise<string> => new Promise((resolve) => {
        key_reader = resolve;
    });

    let the_module: EditorConsoleModule;
    try {
        the_module = load_console_module();
    } catch (my_error) {
        stdout.write(
            `${my_error instanceof Error ? my_error.message : my_error}\r\n`
        );
        try_write_file(args.end_file, JSON.stringify({ code: 1 }));
        void read_key().then(() => exit(1));
        return;
    }

    const started = the_module.start_editor_console({
        write: (text) => {
            stdout.write(text);
        },
        columns: () => stdout.columns || DEFAULT_COLUMNS,
        rows: () => stdout.rows || DEFAULT_ROWS,
        env: process.env,
        working_directory: args.working_directory,
        pty: { helper_path: args.helper_path, stata_path: args.stata_path },
    });
    the_console = started;

    stdout.on('resize', () => {
        started.handle_resize();
    });
    const close = (): void => {
        if (closing) {
            return;
        }
        closing = true;
        started.close();
    };
    process.on('SIGHUP', close);
    process.on('SIGTERM', close);

    void started.ready.then((is_ready) => {
        if (!is_ready || closing) {
            return;
        }
        try_write_file(
            args.ready_file, JSON.stringify({ pid: process.pid })
        );
        if (args.run_line) {
            started.handle_input(`${args.run_line}\r`);
        }
    });

    void started.done.then(
        (end) => finish(end),
        () => finish({ code: 1, took_stata: false })
    );

    function finish(end: EditorConsoleEnd): void {
        ended = true;
        if (closing) {
            exit(end.code);
            return;
        }
        try_write_file(args.end_file, JSON.stringify(end));
        if (end.code === 0) {
            exit(0);
            return;
        }
        stdout.write(PRESS_ANY_KEY);
        void read_key().then(() => exit(end.code));
    }
}

/** The bundle's entry: tty.js runs this when started as a program. */
export function main(argv: readonly string[]): void {
    const args = parse_tty_console_args(argv);
    if (typeof args === 'string') {
        process.stderr.write(`sight console: ${args}\n`);
        process.exit(2);
    }
    run_tty_console(args);
}

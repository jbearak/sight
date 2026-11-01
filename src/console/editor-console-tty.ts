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

/** Mirrors editor-console.ts and the extension's console-pane.ts. */
const EDITOR_CONSOLE_API_VERSION = 2;
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const PRESS_ANY_KEY = '\r\n[Press any key to close this pane.]';

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

    const exit = (code: number): void => {
        if (stdin.isTTY) {
            stdin.setRawMode(false);
        }
        process.exit(code);
    };

    if (stdin.isTTY) {
        stdin.setRawMode(true);
    }
    stdin.setEncoding('utf8');
    stdin.on('data', (text: string) => {
        if (key_reader) {
            const reader = key_reader;
            key_reader = null;
            reader(text);
            return;
        }
        the_console?.handle_input(text);
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
        // Only the Windows console asks, and Perch runs on macOS and
        // Linux; answer on the terminal anyway.
        ask: async (question) => {
            const send_key = question.allow_send_instead ? '/s' : '';
            stdout.write(`\r\n${question.text} [y/N${send_key}] `);
            const key = (await read_key()).trim().toLowerCase();
            stdout.write('\r\n');
            if (key === 'y') {
                return 'yes';
            }
            return key === 's' && question.allow_send_instead ? 'send' : 'no';
        },
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

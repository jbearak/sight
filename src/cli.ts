#!/usr/bin/env node
/**
 * CLI entry point for the Sight LSP server.
 * Supports stdio and Node IPC transports for standalone and VS Code usage.
 */

import { fileURLToPath } from 'url';
import package_json from '../package.json' with { type: 'json' };
import {
    CLI_DESCRIPTION,
    LEGACY_BINARY_NAME,
    NATIVE_BINARY_NAME_PATTERN,
    PRIMARY_BINARY_NAME,
} from './cli-binary-names';

const __filename = fileURLToPath(import.meta.url);

// Version is inlined from package.json at build time
const VERSION = package_json.version;

/**
 * Transport type for LSP communication.
 */
export type TransportType = 'stdio' | 'node-ipc';

/**
 * Parsed CLI options.
 */
export interface CLIOptions {
    transport: TransportType;
    help: boolean;
    version: boolean;
    quiet: boolean;
}

/**
 * Result of parsing CLI arguments.
 */
export type CLIParseResult =
    | { success: true; options: CLIOptions }
    | { success: false; error: string };

/**
 * Recognized CLI flags.
 */
const KNOWN_FLAGS = new Set([
    '--stdio', '-s',
    '--node-ipc', '-i',
    '--help', '-h',
    '--version', '-v',
    '--quiet', '-q',
]);

/**
 * Parse command-line arguments into CLIOptions.
 * @param argv - Command-line arguments (typically process.argv.slice(2))
 * @returns CLIParseResult with either parsed options or an error message
 */
export function parse_args(argv: string[]): CLIParseResult {
    const options: CLIOptions = {
        transport: 'stdio', // Default to stdio for standalone usage
        help: false,
        version: false,
        quiet: false,
    };

    let has_stdio = false;
    let has_node_ipc = false;

    for (const arg of argv) {
        // Check for unknown flags
        if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg)) {
            return { success: false, error: `Unknown flag: ${arg}` };
        }

        if (!arg.startsWith('-') && !KNOWN_FLAGS.has(arg)) {
            return { success: false, error: `Unknown command: ${arg}` };
        }

        switch (arg) {
            case '--stdio':
            case '-s':
                has_stdio = true;
                options.transport = 'stdio';
                break;
            case '--node-ipc':
            case '-i':
                has_node_ipc = true;
                options.transport = 'node-ipc';
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            case '--version':
            case '-v':
                options.version = true;
                break;
            case '--quiet':
            case '-q':
                options.quiet = true;
                break;
        }
    }

    // Check for conflicting transport flags
    if (has_stdio && has_node_ipc) {
        return { success: false, error: 'Cannot specify both --stdio and --node-ipc' };
    }

    return { success: true, options };
}

/**
 * Serialize CLIOptions back to an argument array.
 * Used for testing round-trip property.
 */
export function serialize_options(options: CLIOptions): string[] {
    const args: string[] = [];

    if (options.transport === 'stdio') {
        args.push('--stdio');
    } else if (options.transport === 'node-ipc') {
        args.push('--node-ipc');
    }

    if (options.help) {
        args.push('--help');
    }

    if (options.version) {
        args.push('--version');
    }

    if (options.quiet) {
        args.push('--quiet');
    }

    return args;
}

/**
 * Print help message to stdout.
 */
export function print_help(): void {
    const banner = `${PRIMARY_BINARY_NAME} ${VERSION}, ${CLI_DESCRIPTION}`;
    const help_text = `
${banner}

USAGE:
    sight [OPTIONS]
    sight check [OPTIONS] [PATHS...]
    sight parse --json FILE...
    sight graph --json [ROOT]
    sight console [OPTIONS] [-- STATA_ARGS...]

COMMANDS:
    check             Run full Stata diagnostics over a workspace (for CI).
                      See "sight check --help" for its options.
    parse             Print the structured view of Stata files as JSON.
    graph             Print the do/run/include graph of a project as JSON.
    console           Run Stata's console with highlighting, completion
                      and colored output (experimental).
                      See "sight console --help" for its options.

OPTIONS:
    -s, --stdio       Use stdio transport (default)
    -i, --node-ipc    Use Node IPC transport (for VS Code)
    -q, --quiet       Suppress startup messages
    -h, --help        Show this help message
    -v, --version     Show version number

EXAMPLES:
    sight --stdio           Start server with stdio transport
    sight --node-ipc        Start server with Node IPC (VS Code)
    sight                   Start server with stdio (default)
    sight check --help      Show options for the check command

Docs: https://github.com/jbearak/sight
`.trim();

    console.log(help_text);
}

/**
 * Print version to stdout.
 */
export function print_version(): void {
    console.log(`${PRIMARY_BINARY_NAME} ${VERSION}`);
}

/**
 * Print error message to stderr with usage hint.
 */
export function print_error(message: string): void {
    console.error(`Error: ${message}`);
    console.error('Run "sight --help" for usage information.');
}

/**
 * Main entry point for CLI.
 * Parses arguments and starts the server or prints help/version.
 */
export async function main(
    argv: string[] = process.argv.slice(2),
    deps: { is_tty?: boolean } = {}
): Promise<number> {
    if (argv[0] === 'check') {
        const { run_check } = await import('./cli/check');
        return run_check(argv.slice(1));
    }

    if (argv[0] === 'parse') {
        const { run_parse } = await import('./cli/parse');
        return run_parse(argv.slice(1));
    }

    if (argv[0] === 'graph') {
        const { run_graph } = await import('./cli/graph');
        return run_graph(argv.slice(1));
    }

    if (argv[0] === 'console') {
        const { run_console } = await import('./console');
        return run_console(argv.slice(1));
    }

    // A bare `sight` (no arguments) would otherwise start the stdio server and
    // block on stdin. In an interactive terminal that reads as a silent hang,
    // so show help instead. When stdin is not a TTY — e.g. an editor spawning
    // the server over a pipe — fall through and start the server as before.
    const is_tty = deps.is_tty ?? Boolean(process.stdin.isTTY);
    if (argv.length === 0 && is_tty) {
        print_help();
        return 0;
    }

    const result = parse_args(argv);

    if (!result.success) {
        print_error(result.error);
        return 1;
    }

    const { options } = result;

    if (options.help) {
        print_help();
        return 0;
    }

    if (options.version) {
        print_version();
        return 0;
    }

    // Start the server with the selected transport
    const { create_server } = await import('./server-factory');
    await create_server({ transport: options.transport, quiet: options.quiet });

    return 0;
}

/**
 * Detect whether this module should run the CLI main entry point.
 * Node invokes npm package bins through symlinks named after the command.
 * Accept both the real bundle name and exposed command names.
 */
export function is_cli_entry_point(
    script_path: string | undefined,
    cli_filename: string = __filename
): boolean {
    if (!script_path) {
        return false;
    }

    const normalized_script_path = script_path.replace(/\\/g, '/');
    // UNC server names are case-insensitive. Bun may capitalize the
    // server in argv while fileURLToPath uses the URL's lowercase host.
    // Preserve the case of the path itself, which can be significant.
    const normalize_unc_host = (value: string): string =>
        value.replace(/^(\/\/)([^/]+)/, (_match, prefix: string, host: string) =>
            prefix + host.toLowerCase());
    const normalized_cli_path = cli_filename.replace(/\\/g, '/');
    const script_filename = normalized_script_path.split('/').pop() ?? '';
    const both_unc = script_path.startsWith('\\\\') && cli_filename.startsWith('\\\\');

    return (
        script_path === cli_filename ||
        (both_unc && normalize_unc_host(normalized_script_path) === normalize_unc_host(normalized_cli_path)) ||
        normalized_script_path.endsWith(`/${PRIMARY_BINARY_NAME}`) ||
        normalized_script_path.endsWith(`/${PRIMARY_BINARY_NAME}.exe`) ||
        normalized_script_path.endsWith(`/${LEGACY_BINARY_NAME}`) ||
        normalized_script_path.endsWith(`/${LEGACY_BINARY_NAME}.exe`) ||
        normalized_script_path.endsWith('/sight-server.js') ||
        NATIVE_BINARY_NAME_PATTERN.test(script_filename)
    );
}

/**
 * Exit with `code` once stdout and stderr have flushed. process.exit
 * drops what a pipe hasn't taken yet: `sight parse --json` piped to a
 * slow reader lost all but the first 64 KiB when one file failed. A
 * write callback can't tell when the pipe has it (Bun calls it before
 * then, and reports no pending bytes), but in Bun and Node the
 * callback of `end()` waits until the reader has taken everything, so
 * this ends both streams and exits when both have finished or failed
 * (a reader that went away). There is no time limit: a pending write
 * is never cut off, and once both streams finish, the explicit exit
 * stops any other handle from keeping the process alive.
 */
function exit_after_output(code: number): void {
    process.exitCode = code;
    let pending = 2;
    const finish_one = (): void => {
        pending--;
        if (pending === 0) {
            process.exit(code);
        }
    };
    for (const my_stream of [process.stdout, process.stderr]) {
        let is_done = false;
        const done = (): void => {
            if (!is_done) {
                is_done = true;
                finish_one();
            }
        };
        my_stream.once('error', done);
        if (my_stream.destroyed) {
            // The reader went away (see `quiet_when_reader_closes`).
            done();
            continue;
        }
        try {
            my_stream.end(done);
        } catch {
            done();
        }
    }
}

/** Subcommands that write a report and then exit. */
const REPORT_COMMANDS: ReadonlySet<string> = new Set(['check', 'parse', 'graph']);

/**
 * Stop writing, without an error, once the reader of a report goes
 * away (`sight parse --json *.do | head -1`). Without a listener the
 * failed write (EPIPE) is an unhandled error that prints a stack and
 * exits 1, so the command keeps running and exits with the code its
 * result gives; its later writes are dropped. Other errors still
 * throw.
 */
function quiet_when_reader_closes(stream: NodeJS.WriteStream): void {
    stream.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
            return;
        }
        throw error;
    });
}

// Run main if this is the entry point. Use process.argv[1] for
// Node.js ESM compatibility because import.meta.main is Bun-only.
if (is_cli_entry_point(process.argv[1])) {
    if (REPORT_COMMANDS.has(process.argv[2] ?? '')) {
        quiet_when_reader_closes(process.stdout);
        quiet_when_reader_closes(process.stderr);
    }
    main().then((code) => {
        // The console is finished when main resolves; exit even if a
        // completion cache or stdin handle would keep the loop alive.
        if (process.argv[2] === 'console') {
            process.exit(code);
        } else if (code !== 0) {
            exit_after_output(code);
        }
        // Don't exit on success - server is running
    }).catch((error) => {
        console.error('Fatal error:', error);
        exit_after_output(1);
    });
}

#!/usr/bin/env node
/**
 * CLI entry point for the Sight LSP server.
 * Supports stdio and Node IPC transports for standalone and VS Code usage.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import pkg from '../package.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);

// Version is inlined from package.json at build time
const VERSION = pkg.version;

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
    const help_text = `
Sight - Language Server Protocol implementation for Stata

USAGE:
    sight [OPTIONS]

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

For more information, visit: https://github.com/jbearak/sight
`.trim();

    console.log(help_text);
}

/**
 * Print version to stdout.
 */
export function print_version(): void {
    console.log(`sight ${VERSION}`);
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
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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

// Run main if this is the entry point
// Use process.argv[1] check for Node.js ESM compatibility (import.meta.main is Bun-only)
const is_main = process.argv[1] && (
    process.argv[1] === __filename ||
    process.argv[1].endsWith('/sight-server.js') ||
    process.argv[1].endsWith('\\sight-server.js')
);
if (is_main) {
    main().then((code) => {
        if (code !== 0) {
            process.exit(code);
        }
        // Don't exit on success - server is running
    }).catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

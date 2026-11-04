/**
 * `sight parse --json FILE...`: print Sight's structured view of Stata
 * files as versioned JSON. One FILE prints one JSON document; several
 * print JSON Lines, one document per line in argument order.
 */

import * as path from 'path';
import package_json from '../../package.json' with { type: 'json' };
import embedded_cache_raw from '../command-database/caches/v18.json' with { type: 'json' };
import { CommandDatabase } from '../command-database';
import type { CommandCache } from '../command-database/types';
import { build_parse_document, PARSE_SCHEMA_VERSION } from './parse-json';
import { read_source_file } from './source-files';
import { EXIT_OK, EXIT_OPERATOR_ERROR } from './shared';

const embedded_cache = embedded_cache_raw as CommandCache;

export interface ParseArgs {
    json: boolean;
    help: boolean;
    files: string[];
}

export type ParseArgsResult =
    | { success: true; args: ParseArgs }
    | { success: false; error: string };

export interface ParseOutput {
    stdout(text: string): void;
    stderr(text: string): void;
}

const DEFAULT_OUTPUT: ParseOutput = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
};

export function parse_parse_args(argv: string[]): ParseArgsResult {
    const args: ParseArgs = { json: false, help: false, files: [] };
    let after_double_dash = false;
    for (const my_arg of argv) {
        if (after_double_dash || !my_arg.startsWith('-') || my_arg === '-') {
            args.files.push(my_arg);
            continue;
        }
        switch (my_arg) {
            case '--':
                after_double_dash = true;
                break;
            case '--json':
                args.json = true;
                break;
            case '-h':
            case '--help':
                args.help = true;
                break;
            default:
                return { success: false, error: `unknown option: ${my_arg}` };
        }
    }
    if (args.help) {
        return { success: true, args };
    }
    if (!args.json) {
        return { success: false, error: 'only JSON output is available; pass --json' };
    }
    if (args.files.length === 0) {
        return { success: false, error: 'no FILE given' };
    }
    return { success: true, args };
}

function parse_help_text(): string {
    return `
sight parse ${package_json.version} - structured view of Stata files as JSON

USAGE:
    sight parse --json FILE...

One FILE prints one JSON document. Several FILEs print JSON Lines: one
document per line, in argument order. The schema (schema_version
${PARSE_SCHEMA_VERSION}) is documented in docs/cli.md.

OPTIONS:
    --json        Print JSON (required)
    -h, --help    Show this help message
`.trim();
}

function load_command_database(): CommandDatabase | undefined {
    try {
        const database = new CommandDatabase();
        // Built-in commands only: canonical names are for Stata's own
        // commands, not community ones.
        database.load_cache(embedded_cache);
        return database;
    } catch {
        // Without the database, canonical names are null.
        return undefined;
    }
}

/**
 * Run `sight parse` with `cwd` for relative paths. Returns EXIT_OK when
 * every file was read (syntax errors are data, not failures), or
 * EXIT_OPERATOR_ERROR for bad arguments or an unreadable file. An
 * unreadable file still gets a document, with `error` set, so JSON Lines
 * stay in argument order.
 */
export function run_parse_with_cwd(
    argv: string[],
    cwd: string,
    output: ParseOutput = DEFAULT_OUTPUT
): number {
    const result = parse_parse_args(argv);
    if (!result.success) {
        output.stderr(`sight parse: ${result.error}\n`);
        return EXIT_OPERATOR_ERROR;
    }
    if (result.args.help) {
        output.stdout(`${parse_help_text()}\n`);
        return EXIT_OK;
    }

    const database = load_command_database();
    let exit_code = EXIT_OK;
    for (const my_file of result.args.files) {
        const absolute_path = path.resolve(cwd, my_file);
        const read = read_source_file(absolute_path);
        let document: Record<string, unknown>;
        if (read.kind === 'ok') {
            document = build_parse_document({
                path: absolute_path,
                content: read.text,
                sight_version: package_json.version,
                command_database: database,
            });
        } else {
            const message = read.kind === 'read-error'
                ? read.message
                : read.diagnostic.message;
            output.stderr(`sight parse: ${my_file}: ${message}\n`);
            exit_code = EXIT_OPERATOR_ERROR;
            document = {
                schema_version: PARSE_SCHEMA_VERSION,
                sight_version: package_json.version,
                path: absolute_path,
                error: { message },
            };
        }
        output.stdout(`${JSON.stringify(document)}\n`);
    }
    return exit_code;
}

export async function run_parse(argv: string[]): Promise<number> {
    return run_parse_with_cwd(argv, process.cwd(), DEFAULT_OUTPUT);
}

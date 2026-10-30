/**
 * Argument parsing for `sight console`.
 */

import type { ColorOutputMode } from './output-colorizer';

export interface ConsoleArgs {
    stata_path?: string;
    color_output: ColorOutputMode;
    history: boolean;
    stata_echoes: boolean;
    /** Windows: take over an open Stata without asking. */
    yes: boolean;
    help: boolean;
    /** Arguments passed to Stata. */
    stata_args: string[];
}

export type ConsoleParseResult =
    | { success: true; args: ConsoleArgs }
    | { success: false; error: string };

/** Stata's arguments when none are given after `--`: skip the banner. */
export const DEFAULT_STATA_ARGS: readonly string[] = ['-q'];

const COLOR_OUTPUT_MODES: ReadonlySet<string> = new Set(['streams', 'off']);

function is_color_output_mode(value: string): value is ColorOutputMode {
    return COLOR_OUTPUT_MODES.has(value);
}

export function parse_console_args(argv: readonly string[]): ConsoleParseResult {
    const args: ConsoleArgs = {
        color_output: 'streams',
        history: true,
        stata_echoes: false,
        yes: false,
        help: false,
        stata_args: [...DEFAULT_STATA_ARGS],
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? '';
        if (arg === '--') {
            args.stata_args = argv.slice(i + 1);
            break;
        }
        const equals_index = arg.indexOf('=');
        const flag = arg.startsWith('--') && equals_index !== -1
            ? arg.slice(0, equals_index)
            : arg;
        const inline_value = flag !== arg ? arg.slice(equals_index + 1) : undefined;
        const take_value = (): string | null => {
            if (inline_value !== undefined) {
                return inline_value;
            }
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('-')) {
                return null;
            }
            i++;
            return next;
        };

        switch (flag) {
            case '-h':
            case '--help':
                args.help = true;
                break;
            case '--stata': {
                const value = take_value();
                if (!value) {
                    return { success: false, error: '--stata requires a path' };
                }
                args.stata_path = value;
                break;
            }
            case '--color-output': {
                const value = take_value();
                if (!value || !is_color_output_mode(value)) {
                    return {
                        success: false,
                        error: '--color-output must be "streams" or "off"',
                    };
                }
                args.color_output = value;
                break;
            }
            case '--no-color':
                args.color_output = 'off';
                break;
            case '--no-history':
                args.history = false;
                break;
            case '--stata-echoes':
                args.stata_echoes = true;
                break;
            case '-y':
            case '--yes':
                args.yes = true;
                break;
            default:
                return {
                    success: false,
                    error: `Unknown option for "sight console": ${arg}. `
                        + 'Pass Stata\'s own options after "--".',
                };
        }
    }
    return { success: true, args };
}

export const CONSOLE_HELP = `
Run Stata's console with syntax highlighting, Tab completion, history and
colored output (experimental). On macOS and Linux it runs Stata's
console binary (stata-mp, stata-se, ...). On Windows it drives the
Stata application through Automation, keeping its window open; that
Stata closes when the console ends.

USAGE:
    sight console [OPTIONS] [-- STATA_ARGS...]

OPTIONS:
    --stata PATH            Stata console binary (default: search PATH,
                            then /Applications/Stata and StataNow)
    --color-output MODE     streams (default) or off
    --no-color              Same as --color-output off
    --no-history            Don't read or write the history file
    --stata-echoes          Stata echoes input itself; show it only once
    -y, --yes               Windows: take over an open Stata without asking
    -h, --help              Show this help

STATA_ARGS default to "-q". Arguments after "--" replace them.

ENVIRONMENT:
    SIGHT_STATA_PATH        Stata binary, when --stata is not given
    SIGHT_CONSOLE_HISTORY   History file path
    NO_COLOR                Same as --color-output off
    SIGHT_CONSOLE_TMPDIR    Windows: where the console keeps its log

Docs: https://github.com/jbearak/sight/blob/main/docs/console.md
`.trim();

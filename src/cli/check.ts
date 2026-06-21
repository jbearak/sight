import {
    ColorChoice,
    EXIT_OPERATOR_ERROR,
    OutputFormat,
    SeverityLevel,
    parse_color_choice,
    parse_output_format,
    parse_severity_level,
} from './shared';

export interface CheckArgs {
    paths: string[];
    workspace?: string;
    config_path?: string;
    no_config: boolean;
    format: OutputFormat;
    max_severity: SeverityLevel;
    quiet: boolean;
    color: ColorChoice;
    help: boolean;
}

export type CheckParseResult =
    | { success: true; args: CheckArgs }
    | { success: false; error: string };

export function parse_check_args(argv: string[]): CheckParseResult {
    const args: CheckArgs = {
        paths: [],
        no_config: false,
        format: OutputFormat.Text,
        max_severity: SeverityLevel.Info,
        quiet: false,
        color: ColorChoice.Auto,
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--workspace':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--workspace needs a path' };
                }
                args.workspace = argv[++i];
                break;
            case '--config':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--config needs a path' };
                }
                args.config_path = argv[++i];
                break;
            case '--no-config':
                args.no_config = true;
                break;
            case '--format':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--format needs a value' };
                }
                try {
                    args.format = parse_output_format(argv[++i]);
                } catch (error) {
                    return {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    };
                }
                break;
            case '--max-severity':
                if (argv[i + 1] === undefined) {
                    return {
                        success: false,
                        error: '--max-severity needs a value',
                    };
                }
                try {
                    args.max_severity = parse_severity_level(argv[++i]);
                } catch (error) {
                    return {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    };
                }
                break;
            case '--quiet':
                args.quiet = true;
                break;
            case '--color':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--color needs a value' };
                }
                try {
                    args.color = parse_color_choice(argv[++i]);
                } catch (error) {
                    return {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    };
                }
                break;
            case '--no-color':
                args.color = ColorChoice.Never;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                if (arg.startsWith('-')) {
                    return { success: false, error: `Unknown flag: ${arg}` };
                }
                args.paths.push(arg);
        }
    }

    if (args.no_config && args.config_path !== undefined) {
        return {
            success: false,
            error: 'Cannot specify both --config and --no-config',
        };
    }

    return { success: true, args };
}

export async function run_check(argv: string[]): Promise<number> {
    const result = parse_check_args(argv);
    if (!result.success) {
        console.error(`sight check: ${result.error}`);
        return 1;
    }
    if (result.args.help) {
        return 0;
    }
    console.error('sight check: batch diagnostics are unavailable before Task 6');
    return EXIT_OPERATOR_ERROR;
}

import { describe, expect, it } from 'bun:test';
import {
    parse_check_args,
} from '../../../src/cli/check';
import {
    ColorChoice,
    OutputFormat,
    SeverityLevel,
} from '../../../src/cli/shared';
import { parse_args, print_help } from '../../../src/cli';

describe('sight check args', () => {
    it('uses Raven-parity defaults', () => {
        const result = parse_check_args([]);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.args.paths).toEqual([]);
            expect(result.args.workspace).toBeUndefined();
            expect(result.args.config_path).toBeUndefined();
            expect(result.args.no_config).toBe(false);
            expect(result.args.format).toBe(OutputFormat.Text);
            expect(result.args.max_severity).toBe(SeverityLevel.Info);
            expect(result.args.quiet).toBe(false);
            expect(result.args.color).toBe(ColorChoice.Auto);
            expect(result.args.help).toBe(false);
        }
    });

    it('parses all supported options', () => {
        const result = parse_check_args([
            '--workspace', 'analysis',
            '--config', '../sight.toml',
            '--format', 'sarif',
            '--max-severity', 'warning',
            '--quiet',
            '--color', 'always',
            'main.do',
        ]);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.args.workspace).toBe('analysis');
            expect(result.args.config_path).toBe('../sight.toml');
            expect(result.args.format).toBe(OutputFormat.Sarif);
            expect(result.args.max_severity).toBe(SeverityLevel.Warning);
            expect(result.args.quiet).toBe(true);
            expect(result.args.color).toBe(ColorChoice.Always);
            expect(result.args.paths).toEqual(['main.do']);
        }
    });

    it('treats --no-color as --color never with last flag winning', () => {
        const first = parse_check_args(['--no-color', '--color', 'always']);
        const second = parse_check_args(['--color', 'always', '--no-color']);

        expect(first.success && first.args.color).toBe(ColorChoice.Always);
        expect(second.success && second.args.color).toBe(ColorChoice.Never);
    });

    it('supports --flag=value, allowing values that begin with a dash', () => {
        const result = parse_check_args([
            '--workspace=analysis',
            '--config=-odd-name.toml',
            '--format=json',
            '--max-severity=warning',
            '--color=always',
        ]);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.args.workspace).toBe('analysis');
            expect(result.args.config_path).toBe('-odd-name.toml');
            expect(result.args.format).toBe(OutputFormat.Json);
            expect(result.args.max_severity).toBe(SeverityLevel.Warning);
            expect(result.args.color).toBe(ColorChoice.Always);
        }
    });

    it('rejects an empty --flag= value', () => {
        const result = parse_check_args(['--workspace=']);

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe('--workspace needs a path');
        }
    });

    it('rejects an unknown --flag=value flag by its flag name', () => {
        const result = parse_check_args(['--bogus=1']);

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe('Unknown flag: --bogus');
        }
    });

    it('rejects --config with --no-config', () => {
        const result = parse_check_args(['--config', 'sight.toml', '--no-config']);

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain('Cannot specify both');
        }
    });

    it('rejects unknown flags and missing option values', () => {
        expect(parse_check_args(['--wat']).success).toBe(false);
        const workspace = parse_check_args(['--workspace']);
        expect(workspace.success).toBe(false);
        if (!workspace.success) {
            expect(workspace.error).toBe('--workspace needs a path');
        }
    });

    it('rejects flags where option values are required', () => {
        const the_cases = [
            {
                argv: ['--workspace', '--quiet'],
                error: '--workspace needs a path',
            },
            {
                argv: ['--config', '--no-config'],
                error: '--config needs a path',
            },
            {
                argv: ['--format', '--quiet'],
                error: '--format needs a value',
            },
            {
                argv: ['--max-severity', '--quiet'],
                error: '--max-severity needs a value',
            },
            {
                argv: ['--color', '--quiet'],
                error: '--color needs a value',
            },
        ];

        for (const my_case of the_cases) {
            const result = parse_check_args(my_case.argv);

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBe(my_case.error);
            }
        }
    });
});

describe('top-level parser remains transport-only', () => {
    it('still rejects check when called directly so main can route first', () => {
        const result = parse_args(['check']);

        expect(result.success).toBe(false);
    });

    it('top-level help advertises the check subcommand', () => {
        const lines: string[] = [];
        const original_log = console.log;
        console.log = (message?: unknown) => {
            lines.push(String(message));
        };
        try {
            print_help();
        } finally {
            console.log = original_log;
        }

        const text = lines.join('\n');
        expect(text).toContain('check');
        expect(text).toContain('sight check --help');
    });
});

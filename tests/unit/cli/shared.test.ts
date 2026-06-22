import { describe, expect, it } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import {
    ColorChoice,
    EXIT_CHECK_FAILED,
    EXIT_OK,
    OutputFormat,
    SeverityLevel,
    compare_diagnostic_records,
    diagnostic_exceeds_threshold,
    env_flag_is_set,
    force_color_is_enabled,
    parse_color_choice,
    parse_output_format,
    parse_severity_level,
    render_json,
    render_sarif,
    render_text,
    resolve_color,
} from '../../../src/cli/shared';

function diag(
    severity: DiagnosticSeverity,
    line: number,
    character: number,
    message: string,
    code: number | string
) {
    return {
        range: {
            start: { line, character },
            end: { line, character: character + 1 },
        },
        severity,
        code,
        source: 'sight',
        message,
    };
}

describe('cli shared parsing', () => {
    it('parses output formats and rejects unknown values', () => {
        expect(parse_output_format('text')).toBe(OutputFormat.Text);
        expect(parse_output_format('json')).toBe(OutputFormat.Json);
        expect(parse_output_format('sarif')).toBe(OutputFormat.Sarif);
        expect(() => parse_output_format('xml')).toThrow(
            'unknown --format value: xml'
        );
    });

    it('parses severity levels and rejects unknown values', () => {
        expect(parse_severity_level('off')).toBe(SeverityLevel.Off);
        expect(parse_severity_level('hint')).toBe(SeverityLevel.Hint);
        expect(parse_severity_level('info')).toBe(SeverityLevel.Info);
        expect(parse_severity_level('warning')).toBe(SeverityLevel.Warning);
        expect(parse_severity_level('error')).toBe(SeverityLevel.Error);
        expect(() => parse_severity_level('warn')).toThrow(
            'unknown --max-severity value: warn'
        );
    });

    it('parses color choices and rejects unknown values', () => {
        expect(parse_color_choice('auto')).toBe(ColorChoice.Auto);
        expect(parse_color_choice('always')).toBe(ColorChoice.Always);
        expect(parse_color_choice('never')).toBe(ColorChoice.Never);
        expect(() => parse_color_choice('sometimes')).toThrow(
            'unknown --color value: sometimes'
        );
    });
});

describe('cli shared severity gates', () => {
    it('uses strict greater-than comparison for max severity', () => {
        expect(
            diagnostic_exceeds_threshold(
                diag(DiagnosticSeverity.Information, 0, 0, 'info', 6003),
                SeverityLevel.Info
            )
        ).toBe(false);
        expect(
            diagnostic_exceeds_threshold(
                diag(DiagnosticSeverity.Hint, 0, 0, 'hint', 1004),
                SeverityLevel.Info
            )
        ).toBe(false);
        expect(
            diagnostic_exceeds_threshold(
                diag(DiagnosticSeverity.Warning, 0, 0, 'warning', 2001),
                SeverityLevel.Info
            )
        ).toBe(true);
    });

    it('exports stable exit code constants', () => {
        expect(EXIT_OK).toBe(0);
        expect(EXIT_CHECK_FAILED).toBe(1);
    });
});

describe('cli shared color resolution', () => {
    it('explicit always and never override environment signals', () => {
        expect(resolve_color(ColorChoice.Always, true, false, false)).toBe(true);
        expect(resolve_color(ColorChoice.Never, false, true, true)).toBe(false);
    });

    it('auto honors NO_COLOR before FORCE_COLOR before TTY', () => {
        expect(resolve_color(ColorChoice.Auto, true, true, true)).toBe(false);
        expect(resolve_color(ColorChoice.Auto, false, true, false)).toBe(true);
        expect(resolve_color(ColorChoice.Auto, false, false, true)).toBe(true);
        expect(resolve_color(ColorChoice.Auto, false, false, false)).toBe(false);
    });
});

describe('cli shared color env flags', () => {
    it('treats NO_COLOR as set for any non-empty value (no-color spec)', () => {
        expect(env_flag_is_set('0')).toBe(true);
        expect(env_flag_is_set('false')).toBe(true);
        expect(env_flag_is_set('1')).toBe(true);
        expect(env_flag_is_set('')).toBe(false);
        expect(env_flag_is_set(undefined)).toBe(false);
    });

    it('treats FORCE_COLOR=0/false/off as disabled, else enabled', () => {
        expect(force_color_is_enabled('0')).toBe(false);
        expect(force_color_is_enabled('false')).toBe(false);
        expect(force_color_is_enabled('FALSE')).toBe(false);
        expect(force_color_is_enabled('off')).toBe(false);
        expect(force_color_is_enabled('1')).toBe(true);
        expect(force_color_is_enabled('true')).toBe(true);
        expect(force_color_is_enabled('')).toBe(false);
        expect(force_color_is_enabled(undefined)).toBe(false);
    });
});

describe('cli shared renderers', () => {
    const records = [
        {
            relative_path: 'b.do',
            diagnostic: diag(DiagnosticSeverity.Warning, 2, 4, 'B warning', 2001),
        },
        {
            relative_path: 'a.do',
            diagnostic: diag(DiagnosticSeverity.Error, 0, 1, 'A error', 3000),
        },
    ];

    it('sorts by path, range, severity, code, and message', () => {
        const sorted = [...records].sort(compare_diagnostic_records);
        expect(sorted.map((record) => record.relative_path)).toEqual([
            'a.do',
            'b.do',
        ]);
    });

    it('renders text with one-based coordinates and summary', () => {
        const text = render_text(records, { quiet: false, use_color: false });
        expect(text).toContain('a.do:1:2 error: A error [3000]');
        expect(text).toContain('b.do:3:5 warning: B warning [2001]');
        expect(text).toContain('2 issues (1 errors, 1 warnings, 0 infos, 0 hints, 0 notes)');
    });

    it('renders JSON as parseable path and diagnostic records', () => {
        const parsed = JSON.parse(render_json(records));
        expect(parsed).toHaveLength(2);
        expect(parsed[0].path).toBe('a.do');
        expect(parsed[0].diagnostic.message).toBe('A error');
    });

    it('renders SARIF 2.1.0 with string rule IDs and tool metadata', () => {
        const parsed = JSON.parse(render_sarif(records, '0.7.2'));
        expect(parsed.version).toBe('2.1.0');
        expect(parsed.runs[0].tool.driver.name).toBe('sight');
        expect(parsed.runs[0].tool.driver.version).toBe('0.7.2');
        expect(parsed.runs[0].results[0].ruleId).toBe('SIGHT3000');
    });
});

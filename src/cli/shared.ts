import { stdout } from 'process';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';

export const EXIT_OK = 0;
export const EXIT_CHECK_FAILED = 1;
export const EXIT_OPERATOR_ERROR = 2;

export enum OutputFormat {
    Text = 'text',
    Json = 'json',
    Sarif = 'sarif',
}

export enum ColorChoice {
    Auto = 'auto',
    Always = 'always',
    Never = 'never',
}

export enum SeverityLevel {
    Off = 0,
    Hint = 1,
    Info = 2,
    Warning = 3,
    Error = 4,
}

export interface DiagnosticRecord {
    relative_path: string;
    diagnostic: Diagnostic;
}

export function error_message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function parse_output_format(value: string): OutputFormat {
    switch (value) {
        case 'text':
            return OutputFormat.Text;
        case 'json':
            return OutputFormat.Json;
        case 'sarif':
            return OutputFormat.Sarif;
        default:
            throw new Error(`unknown --format value: ${value}`);
    }
}

export function parse_severity_level(value: string): SeverityLevel {
    switch (value) {
        case 'off':
            return SeverityLevel.Off;
        case 'hint':
            return SeverityLevel.Hint;
        case 'info':
            return SeverityLevel.Info;
        case 'warning':
            return SeverityLevel.Warning;
        case 'error':
            return SeverityLevel.Error;
        default:
            throw new Error(`unknown --max-severity value: ${value}`);
    }
}

export function parse_color_choice(value: string): ColorChoice {
    switch (value) {
        case 'auto':
            return ColorChoice.Auto;
        case 'always':
            return ColorChoice.Always;
        case 'never':
            return ColorChoice.Never;
        default:
            throw new Error(`unknown --color value: ${value}`);
    }
}

function severity_level(diagnostic: Diagnostic): SeverityLevel {
    switch (diagnostic.severity) {
        case DiagnosticSeverity.Error:
            return SeverityLevel.Error;
        case DiagnosticSeverity.Warning:
            return SeverityLevel.Warning;
        case DiagnosticSeverity.Information:
            return SeverityLevel.Info;
        case DiagnosticSeverity.Hint:
            return SeverityLevel.Hint;
        default:
            return SeverityLevel.Off;
    }
}

export function diagnostic_exceeds_threshold(
    diagnostic: Diagnostic,
    max_severity: SeverityLevel
): boolean {
    return severity_level(diagnostic) > max_severity;
}

// NO_COLOR semantics (https://no-color.org): present and non-empty disables
// color regardless of the value, so "0"/"false" still count as set here.
export function env_flag_is_set(value: string | undefined): boolean {
    return value !== undefined && value.length > 0;
}

// FORCE_COLOR semantics (de-facto, per supports-color): "0"/"false"/"off"
// explicitly disable forced color; any other non-empty value enables it.
const FORCE_COLOR_DISABLED_VALUES = new Set(['0', 'false', 'off']);

export function force_color_is_enabled(value: string | undefined): boolean {
    if (value === undefined || value.length === 0) return false;
    return !FORCE_COLOR_DISABLED_VALUES.has(value.trim().toLowerCase());
}

export function resolve_color(
    choice: ColorChoice,
    no_color: boolean,
    force_color: boolean,
    stdout_is_tty: boolean
): boolean {
    if (choice === ColorChoice.Always) return true;
    if (choice === ColorChoice.Never) return false;
    if (no_color) return false;
    if (force_color) return true;
    return stdout_is_tty;
}

export function resolve_color_from_env(choice: ColorChoice): boolean {
    return resolve_color(
        choice,
        env_flag_is_set(process.env.NO_COLOR),
        force_color_is_enabled(process.env.FORCE_COLOR),
        stdout.isTTY === true
    );
}

function code_text(code: Diagnostic['code']): string {
    if (typeof code === 'number') return String(code);
    if (typeof code === 'string') return code;
    return '';
}

function sarif_rule_id(code: Diagnostic['code']): string {
    const value = code_text(code);
    return /^\d+$/.test(value) ? `SIGHT${value}` : value || 'SIGHT';
}

function severity_word(diagnostic: Diagnostic): string {
    switch (diagnostic.severity) {
        case DiagnosticSeverity.Error:
            return 'error';
        case DiagnosticSeverity.Warning:
            return 'warning';
        case DiagnosticSeverity.Information:
            return 'info';
        case DiagnosticSeverity.Hint:
            return 'hint';
        default:
            return 'note';
    }
}

function sarif_level(diagnostic: Diagnostic): string {
    switch (diagnostic.severity) {
        case DiagnosticSeverity.Error:
            return 'error';
        case DiagnosticSeverity.Warning:
            return 'warning';
        default:
            return 'note';
    }
}

function colorize(word: string, use_color: boolean): string {
    if (!use_color) return word;
    switch (word) {
        case 'error':
            return `\u001b[31m${word}\u001b[0m`;
        case 'warning':
            return `\u001b[33m${word}\u001b[0m`;
        case 'info':
            return `\u001b[34m${word}\u001b[0m`;
        case 'hint':
            return `\u001b[36m${word}\u001b[0m`;
        default:
            return word;
    }
}

export function compare_diagnostic_records(
    a: DiagnosticRecord,
    b: DiagnosticRecord
): number {
    return a.relative_path.localeCompare(b.relative_path)
        || a.diagnostic.range.start.line - b.diagnostic.range.start.line
        || a.diagnostic.range.start.character -
            b.diagnostic.range.start.character
        || severity_level(b.diagnostic) - severity_level(a.diagnostic)
        || code_text(a.diagnostic.code)
            .localeCompare(code_text(b.diagnostic.code))
        || a.diagnostic.message.localeCompare(b.diagnostic.message);
}

function sorted_records(records: DiagnosticRecord[]): DiagnosticRecord[] {
    return [...records].sort(compare_diagnostic_records);
}

export function render_text(
    records: DiagnosticRecord[],
    options: { quiet: boolean; use_color: boolean }
): string {
    const counts = { error: 0, warning: 0, info: 0, hint: 0, note: 0 };
    const lines: string[] = [];

    for (const record of sorted_records(records)) {
        const word = severity_word(record.diagnostic);
        counts[word as keyof typeof counts]++;
        const code = code_text(record.diagnostic.code);
        const code_suffix = code ? ` [${code}]` : '';
        lines.push(
            `${record.relative_path}:` +
            `${record.diagnostic.range.start.line + 1}:` +
            `${record.diagnostic.range.start.character + 1} ` +
            `${colorize(word, options.use_color)}: ` +
            `${record.diagnostic.message}${code_suffix}`
        );
    }

    if (!options.quiet) {
        lines.push(
            `${records.length} issues (` +
            `${counts.error} errors, ` +
            `${counts.warning} warnings, ` +
            `${counts.info} infos, ` +
            `${counts.hint} hints, ` +
            `${counts.note} notes)`
        );
    }

    if (lines.length === 0) {
        return '';
    }
    return lines.join('\n') + '\n';
}

export function render_json(records: DiagnosticRecord[]): string {
    return JSON.stringify(
        sorted_records(records).map((record) => ({
            path: record.relative_path,
            diagnostic: record.diagnostic,
        })),
        null,
        2
    ) + '\n';
}

export function render_sarif(
    records: DiagnosticRecord[],
    version: string
): string {
    const sorted = sorted_records(records);
    const rule_ids = Array.from(
        new Set(sorted.map((record) =>
            sarif_rule_id(record.diagnostic.code)
        ))
    ).sort();

    return JSON.stringify({
        version: '2.1.0',
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        runs: [{
            tool: {
                driver: {
                    name: 'sight',
                    version,
                    rules: rule_ids.map((id) => ({
                        id,
                        name: id,
                        shortDescription: { text: id },
                    })),
                },
            },
            results: sorted.map((record) => ({
                ruleId: sarif_rule_id(record.diagnostic.code),
                level: sarif_level(record.diagnostic),
                message: { text: record.diagnostic.message },
                locations: [{
                    physicalLocation: {
                        artifactLocation: { uri: record.relative_path },
                        region: {
                            startLine:
                                record.diagnostic.range.start.line + 1,
                            startColumn:
                                record.diagnostic.range.start.character + 1,
                            endLine: record.diagnostic.range.end.line + 1,
                            endColumn:
                                record.diagnostic.range.end.character + 1,
                        },
                    },
                }],
            })),
        }],
    }, null, 2) + '\n';
}

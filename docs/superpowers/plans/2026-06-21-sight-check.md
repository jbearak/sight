# sight check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `sight check`, a headless CLI diagnostic checker that indexes a Stata workspace and reports editor-parity diagnostics for CI.

**Architecture:** Implement a direct batch pipeline, not an internal LSP client. The CLI will parse `sight check` arguments, load `sight.toml`, build the same indexer/scope/diagnostic provider graph the server uses, collect diagnostics per report target, render text/JSON/SARIF, and return CI-friendly exit codes.

**Tech Stack:** TypeScript, Bun, `vscode-languageserver`, `vscode-uri`, existing Sight lexer/parser/analyzer/indexer/scope providers, Bun test, fast-check.

---

## File Structure

- Create `src/cli/shared.ts`: exit codes, severity ordering, output format parsing, color resolution, deterministic diagnostic sorting, and text/JSON/SARIF rendering.
- Create `src/cli/source-files.ts`: supported source extension detection, recursive source walking, path resolution from cwd, explicit target collection, UTF-8 source reading, and explicit large-file diagnostics.
- Create `src/cli/check.ts`: `sight check` argument parsing, help text, config loading, batch context construction, diagnostic collection, and `run_check()` / `run_check_with_cwd()` entry points.
- Modify `src/cli.ts`: intercept `check` before the existing transport parser.
- Modify `src/providers/diagnostics.ts`: replace the full `Connection` constructor dependency with a narrow exported diagnostics connection interface.
- Create tests under `tests/unit/cli/` for shared rendering, source discovery, parser behavior, config loading, and batch context seams.
- Create tests under `tests/integration/cli-check.test.ts` for same-file diagnostics, workspace-report filtering, cross-file scope, config behavior, encoding, large files, and spawned command routing.
- Modify `docs/cli.md`: document `sight check`.
- Modify `README.md`: link the CLI docs.

---

### Task 1: CLI Shared Rendering And Severity Gates

**Files:**
- Create: `src/cli/shared.ts`
- Test: `tests/unit/cli/shared.test.ts`

- [ ] **Step 1: Write failing tests for severity, color, sorting, and output formats**

Create `tests/unit/cli/shared.test.ts`:

```typescript
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
                diag(
                    DiagnosticSeverity.Information,
                    0,
                    0,
                    'info',
                    'CSTYLE_LOGICAL_IN_CONTROL_FLOW'
                ),
                SeverityLevel.Info
            )
        ).toBe(false);
        expect(
            diagnostic_exceeds_threshold(
                diag(
                    DiagnosticSeverity.Hint,
                    0,
                    0,
                    'hint',
                    'CONTINUATION_NO_SPACE'
                ),
                SeverityLevel.Info
            )
        ).toBe(false);
        expect(
            diagnostic_exceeds_threshold(
                diag(
                    DiagnosticSeverity.Warning,
                    0,
                    0,
                    'warning',
                    'UNDEFINED_MACRO'
                ),
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

describe('cli shared renderers', () => {
    const records = [
        {
            path: '/repo/b.do',
            relative_path: 'b.do',
            diagnostic: diag(
                DiagnosticSeverity.Warning,
                2,
                4,
                'B warning',
                'UNDEFINED_MACRO'
            ),
        },
        {
            path: '/repo/a.do',
            relative_path: 'a.do',
            diagnostic: diag(
                DiagnosticSeverity.Error,
                0,
                1,
                'A error',
                'SYNTAX_ERROR'
            ),
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
        expect(text).toContain('a.do:1:2 error: A error [SYNTAX_ERROR]');
        expect(text).toContain('b.do:3:5 warning: B warning [UNDEFINED_MACRO]');
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
        expect(parsed.runs[0].results[0].ruleId).toBe('SYNTAX_ERROR');
    });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
bun test tests/unit/cli/shared.test.ts
```

Expected: FAIL because `src/cli/shared.ts` does not exist.

- [ ] **Step 3: Implement shared CLI helpers**

Create `src/cli/shared.ts`:

```typescript
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { stdout } from 'process';

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
    path: string;
    relative_path: string;
    diagnostic: Diagnostic;
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

export function env_flag_is_set(value: string | undefined): boolean {
    return value !== undefined && value.length > 0;
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
        env_flag_is_set(process.env.FORCE_COLOR),
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
        || a.diagnostic.range.start.character - b.diagnostic.range.start.character
        || severity_level(b.diagnostic) - severity_level(a.diagnostic)
        || code_text(a.diagnostic.code).localeCompare(code_text(b.diagnostic.code))
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
    const rule_ids = Array.from(
        new Set(sorted_records(records).map((record) =>
            sarif_rule_id(record.diagnostic.code)
        ))
    ).sort();

    return JSON.stringify({
        version: '2.1.0',
        $schema:
            'https://json.schemastore.org/sarif-2.1.0.json',
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
            results: sorted_records(records).map((record) => ({
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
```

- [ ] **Step 4: Run the focused shared tests**

Run:

```bash
bun test tests/unit/cli/shared.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/cli/shared.ts tests/unit/cli/shared.test.ts
git commit -m "Add sight check output helpers"
```

---

### Task 2: Source Discovery And Source Read Helpers

**Files:**
- Create: `src/cli/source-files.ts`
- Test: `tests/unit/cli/source-files.test.ts`

- [ ] **Step 1: Write failing tests for source matching, recursive walking, target collection, large files, and UTF-8 errors**

Create `tests/unit/cli/source-files.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiagnosticSeverity } from 'vscode-languageserver';
import {
    collect_report_targets,
    is_stata_source_path,
    read_source_file,
    size_limit_diagnostic,
} from '../../../src/cli/source-files';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-source-'));
}

describe('sight check source files', () => {
    it('recognizes Stata source extensions case-insensitively', () => {
        expect(is_stata_source_path('/x/a.do')).toBe(true);
        expect(is_stata_source_path('/x/a.DO')).toBe(true);
        expect(is_stata_source_path('/x/a.ado')).toBe(true);
        expect(is_stata_source_path('/x/a.doh')).toBe(true);
        expect(is_stata_source_path('/x/a.mata')).toBe(true);
        expect(is_stata_source_path('/x/a.txt')).toBe(false);
    });

    it('collects supported source files from directories and skips VCS dirs', () => {
        const root = temp_dir();
        fs.mkdirSync(path.join(root, 'analysis'));
        fs.mkdirSync(path.join(root, '.git'));
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'analysis', 'helper.ADO'), 'program x\nend\n');
        fs.writeFileSync(path.join(root, '.git', 'ignored.do'), 'bad\n');
        fs.writeFileSync(path.join(root, 'notes.txt'), 'ignored\n');

        const result = collect_report_targets([], root, root);

        expect(result.operator_errors).toEqual([]);
        expect(result.targets.map((target) => target.relative_path)).toEqual([
            'analysis/helper.ADO',
            'main.do',
        ]);
    });

    it('resolves explicit paths from cwd and reports missing paths as operator errors', () => {
        const root = temp_dir();
        const cwd = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');

        const result = collect_report_targets(
            [path.relative(cwd, path.join(root, 'main.do')), 'missing.do'],
            root,
            cwd
        );

        expect(result.targets.map((target) => target.path)).toEqual([
            path.join(root, 'main.do'),
        ]);
        expect(result.operator_errors).toHaveLength(1);
        expect(result.operator_errors[0]).toContain('missing.do');
    });

    it('ignores explicit existing non-source files', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'notes.txt'), 'ignored\n');

        const result = collect_report_targets(['notes.txt'], root, root);

        expect(result.targets).toEqual([]);
        expect(result.operator_errors).toEqual([]);
    });

    it('turns oversize explicit targets into error diagnostics', () => {
        const diagnostic = size_limit_diagnostic('/x/main.do', 11, 10);

        expect(diagnostic.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostic.range.start).toEqual({ line: 0, character: 0 });
        expect(diagnostic.message).toContain('exceeds');
        expect(diagnostic.message).toContain('10 bytes');
    });

    it('reads UTF-8 and reports invalid UTF-8 as a diagnostic input error', () => {
        const root = temp_dir();
        const good = path.join(root, 'good.do');
        const bad = path.join(root, 'bad.do');
        fs.writeFileSync(good, 'display 1\n');
        fs.writeFileSync(bad, Buffer.from([0x64, 0x69, 0x80]));

        expect(read_source_file(good).kind).toBe('ok');
        const result = read_source_file(bad);

        expect(result.kind).toBe('decode-error');
        if (result.kind === 'decode-error') {
            expect(result.diagnostic.message).toContain('offset 2');
            expect(result.diagnostic.severity).toBe(DiagnosticSeverity.Error);
        }
    });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
bun test tests/unit/cli/source-files.test.ts
```

Expected: FAIL because `src/cli/source-files.ts` does not exist.

- [ ] **Step 3: Implement source-file helpers**

Create `src/cli/source-files.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';

const SOURCE_EXTENSIONS = new Set(['.do', '.ado', '.doh', '.mata']);
const VCS_METADATA_DIRS = new Set(['.git', '.hg', '.svn']);

export interface ReportTarget {
    path: string;
    relative_path: string;
    explicit: boolean;
}

export interface ReportTargetResult {
    targets: ReportTarget[];
    operator_errors: string[];
}

export type SourceReadResult =
    | { kind: 'ok'; text: string }
    | { kind: 'decode-error'; diagnostic: Diagnostic }
    | { kind: 'read-error'; message: string };

export function is_stata_source_path(file_path: string): boolean {
    return SOURCE_EXTENSIONS.has(path.extname(file_path).toLowerCase());
}

export function relative_path(workspace_root: string, file_path: string): string {
    const relative = path.relative(workspace_root, file_path);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative.split(path.sep).join('/')
        : file_path;
}

function walk_sources(dir_path: string, out: string[]): void {
    const entries = fs.readdirSync(dir_path, { withFileTypes: true });
    for (const entry of entries) {
        const entry_path = path.join(dir_path, entry.name);
        if (entry.isDirectory()) {
            if (VCS_METADATA_DIRS.has(entry.name)) continue;
            walk_sources(entry_path, out);
        } else if (entry.isFile() && is_stata_source_path(entry_path)) {
            out.push(entry_path);
        }
    }
}

export function collect_report_targets(
    input_paths: string[],
    workspace_root: string,
    cwd: string
): ReportTargetResult {
    const operator_errors: string[] = [];
    const source_paths: string[] = [];
    const normalized_root = path.resolve(workspace_root);
    const has_explicit_paths = input_paths.length > 0;
    const paths_to_collect = input_paths.length > 0
        ? input_paths
        : [normalized_root];

    for (const input_path of paths_to_collect) {
        const absolute_path = path.resolve(cwd, input_path);
        if (!fs.existsSync(absolute_path)) {
            operator_errors.push(`path does not exist: ${input_path}`);
            continue;
        }

        const stat = fs.statSync(absolute_path);
        if (stat.isDirectory()) {
            walk_sources(absolute_path, source_paths);
        } else if (stat.isFile() && is_stata_source_path(absolute_path)) {
            source_paths.push(absolute_path);
        }
    }

    const unique_sorted_paths = Array.from(new Set(source_paths))
        .sort((a, b) =>
            relative_path(normalized_root, a)
                .localeCompare(relative_path(normalized_root, b))
        );

    return {
        targets: unique_sorted_paths.map((file_path) => ({
            path: file_path,
            relative_path: relative_path(normalized_root, file_path),
            explicit: has_explicit_paths,
        })),
        operator_errors,
    };
}

export function size_limit_diagnostic(
    file_path: string,
    actual_bytes: number,
    limit_bytes: number
): Diagnostic {
    return {
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        severity: DiagnosticSeverity.Error,
        source: 'sight',
        code: 'SIGHT_FILE_TOO_LARGE',
        message:
            `${file_path} is ${actual_bytes} bytes, which exceeds ` +
            `the configured limit of ${limit_bytes} bytes.`,
    };
}

export function index_limit_diagnostic(file_path: string): Diagnostic {
    return {
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        severity: DiagnosticSeverity.Error,
        source: 'sight',
        code: 'SIGHT_FILE_NOT_INDEXED',
        message:
            `${file_path} was not indexed before Sight reached ` +
            'crossFile.maxIndexedFiles. Raise maxIndexedFiles or check fewer files.',
    };
}

function utf8_error_offset(bytes: Buffer): number {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let i = 0; i <= bytes.length; i++) {
        try {
            decoder.decode(bytes.subarray(0, i));
        } catch {
            return Math.max(0, i - 1);
        }
    }
    return 0;
}

function decode_error_diagnostic(file_path: string, offset: number): Diagnostic {
    return {
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        severity: DiagnosticSeverity.Error,
        source: 'sight',
        code: 'SIGHT_INVALID_ENCODING',
        message:
            `${file_path} is not valid UTF-8 at byte offset ${offset}. ` +
            'Re-save the file as UTF-8.',
    };
}

export function read_source_file(file_path: string): SourceReadResult {
    let bytes: Buffer;
    try {
        bytes = fs.readFileSync(file_path);
    } catch (error) {
        return {
            kind: 'read-error',
            message: `${file_path}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        };
    }

    try {
        return {
            kind: 'ok',
            text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        };
    } catch {
        return {
            kind: 'decode-error',
            diagnostic: decode_error_diagnostic(
                file_path,
                utf8_error_offset(bytes)
            ),
        };
    }
}
```

- [ ] **Step 4: Run the focused source-file tests**

Run:

```bash
bun test tests/unit/cli/source-files.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/cli/source-files.ts tests/unit/cli/source-files.test.ts
git commit -m "Add sight check source discovery"
```

---

### Task 3: Check Argument Parser And Top-Level Routing

**Files:**
- Create: `src/cli/check.ts`
- Modify: `src/cli.ts`
- Test: `tests/unit/cli/check-args.test.ts`

- [ ] **Step 1: Write failing check parser tests**

Create `tests/unit/cli/check-args.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import {
    parse_check_args,
} from '../../../src/cli/check';
import {
    ColorChoice,
    OutputFormat,
    SeverityLevel,
} from '../../../src/cli/shared';
import { parse_args } from '../../../src/cli';

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
});

describe('top-level parser remains transport-only', () => {
    it('still rejects check when called directly so main can route first', () => {
        const result = parse_args(['check']);

        expect(result.success).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
bun test tests/unit/cli/check-args.test.ts
```

Expected: FAIL because `src/cli/check.ts` does not exist.

- [ ] **Step 3: Implement `parse_check_args()` and help text**

Create `src/cli/check.ts` with the parser and temporary run stub:

```typescript
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
                        error: error instanceof Error ? error.message : String(error),
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
                        error: error instanceof Error ? error.message : String(error),
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
                        error: error instanceof Error ? error.message : String(error),
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
```

- [ ] **Step 4: Route `check` before the existing top-level parser**

Modify `src/cli.ts` in `main()` before `const result = parse_args(argv);`:

```typescript
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    if (argv[0] === 'check') {
        const { run_check } = await import('./cli/check');
        return run_check(argv.slice(1));
    }

    const result = parse_args(argv);
```

Keep the existing transport parser unchanged so the transport-selection property
tests still prove the old flags work.

- [ ] **Step 5: Run parser and transport tests**

Run:

```bash
bun test tests/unit/cli/check-args.test.ts tests/property/cli-transport-selection.prop.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/cli.ts src/cli/check.ts tests/unit/cli/check-args.test.ts
git commit -m "Route sight check subcommand"
```

---

### Task 4: Narrow DiagnosticsProvider Connection Interface

**Files:**
- Modify: `src/providers/diagnostics.ts`
- Test: `tests/unit/cli/diagnostics-connection.test.ts`

- [ ] **Step 1: Write a failing compile-focused test for a no-op diagnostics connection**

Create `tests/unit/cli/diagnostics-connection.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import {
    DiagnosticsConnection,
    DiagnosticsProvider,
} from '../../../src/providers/diagnostics';

describe('DiagnosticsProvider connection surface', () => {
    it('accepts the narrow CLI diagnostics connection', () => {
        const connection: DiagnosticsConnection = {
            sendDiagnostics: () => undefined,
        };
        const provider = new DiagnosticsProvider(connection);

        expect(provider).toBeInstanceOf(DiagnosticsProvider);
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
bun test tests/unit/cli/diagnostics-connection.test.ts
```

Expected: FAIL because `DiagnosticsConnection` is not exported and the
constructor still requires the full LSP `Connection`.

- [ ] **Step 3: Refactor `DiagnosticsProvider` constructor type**

Modify the imports and constructor type in `src/providers/diagnostics.ts`:

```typescript
import { Diagnostic, DiagnosticSeverity, Position, CancellationToken, Range } from 'vscode-languageserver';
```

Add near the top:

```typescript
export interface DiagnosticsConnection {
    sendDiagnostics(params: { uri: string; diagnostics: Diagnostic[] }): void;
}
```

Change the class field and constructor:

```typescript
export class DiagnosticsProvider {
    private connection: DiagnosticsConnection;
    private debounce_manager: DocumentDebounceManager | null = null;

    constructor(
        connection: DiagnosticsConnection,
        debounce_manager?: DocumentDebounceManager
    ) {
        this.connection = connection;
        this.debounce_manager = debounce_manager || null;
    }
```

Do not change diagnostic logic in this task.

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun test tests/unit/cli/diagnostics-connection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run representative diagnostics and server type checks**

Run:

```bash
bun test tests/unit/default-settings.test.ts tests/property/handler-deps-mutation.prop.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/providers/diagnostics.ts tests/unit/cli/diagnostics-connection.test.ts
git commit -m "Narrow diagnostics provider connection"
```

---

### Task 5: Config Loading And Batch Context Construction

**Files:**
- Modify: `src/cli/check.ts`
- Test: `tests/unit/cli/check-config.test.ts`
- Test: `tests/unit/cli/check-context.test.ts`

- [ ] **Step 1: Write failing tests for config loading**

Create `tests/unit/cli/check-config.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    load_check_config,
} from '../../../src/cli/check';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-config-'));
}

describe('sight check config loading', () => {
    it('uses built-in defaults under --no-config', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[diagnostics]\nenabled = false\n');

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: true,
        });

        expect(result.kind).toBe('loaded');
        if (result.kind === 'loaded') {
            expect(result.config.diagnostics.enabled).toBe(true);
        }
    });

    it('loads explicit config relative to cwd', () => {
        const cwd = temp_dir();
        const workspace = temp_dir();
        fs.writeFileSync(path.join(cwd, 'custom.toml'), '[diagnostics]\nenabled = false\n');

        const result = load_check_config({
            cwd,
            workspace_root: workspace,
            config_path: 'custom.toml',
            no_config: false,
        });

        expect(result.kind).toBe('loaded');
        if (result.kind === 'loaded') {
            expect(result.config.diagnostics.enabled).toBe(false);
        }
    });

    it('discovers config from workspace root and reports stale json warnings', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, '.sight.json'), '{}\n');
        fs.writeFileSync(path.join(root, 'sight.toml'), '[diagnostics]\nindentation = true\n');

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: false,
        });

        expect(result.kind).toBe('loaded');
        if (result.kind === 'loaded') {
            expect(result.config.diagnostics.indentation).toBe(true);
            expect(result.warnings.some((warning) =>
                warning.message.includes('.sight.json is no longer supported')
            )).toBe(true);
        }
    });

    it('returns operator error for malformed discovered config', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: false,
        });

        expect(result.kind).toBe('operator-error');
        if (result.kind === 'operator-error') {
            expect(result.message).toContain('failed to load');
        }
    });
});
```

- [ ] **Step 2: Write failing tests for batch context wiring**

Create `tests/unit/cli/check-context.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    build_check_context,
    load_check_config,
} from '../../../src/cli/check';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-context-'));
}

describe('sight check batch context', () => {
    it('marks dependency graph scan complete and indexes workspace symbols', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'parent.do'), 'global g 1\ndo child.do\n');
        fs.writeFileSync(path.join(root, 'child.do'), 'display \"$g\"\n');
        const config_result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: true,
        });
        expect(config_result.kind).toBe('loaded');
        if (config_result.kind !== 'loaded') return;

        const context = await build_check_context(root, config_result.config);

        expect(context.dependency_graph.is_scan_complete()).toBe(true);
        expect(context.workspace_indexer.get_all_symbols().globalMacros.has('g')).toBe(true);
        expect(context.scope_resolver).toBeDefined();
        await context.document_store.dispose();
    });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run:

```bash
bun test tests/unit/cli/check-config.test.ts tests/unit/cli/check-context.test.ts
```

Expected: FAIL because `load_check_config()` and `build_check_context()` are not
implemented.

- [ ] **Step 4: Implement config loading**

Modify `src/cli/check.ts` imports:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import {
    deep_merge_config,
    discover_and_load_project_config,
    load_toml_file,
    type ProjectConfigWarning,
} from '../config-file';
import { DependencyGraph } from '../dependency-graph';
import { DocumentStore } from '../document-store';
import { ForwardScopeResolver } from '../forward-scope-resolver';
import { WorkspaceIndexer } from '../indexer';
import { DiagnosticsProvider } from '../providers/diagnostics';
import { ScopeResolver } from '../scope-resolver';
import { DEFAULT_SETTINGS } from '../server-handlers';
import { StataLSPConfig } from '../types';
import { validate_comment_formatting_config } from '../utils/config-validator';
```

Add:

```typescript
export type CheckConfigResult =
    | {
        kind: 'loaded';
        config: StataLSPConfig;
        warnings: ProjectConfigWarning[];
        config_path?: string;
    }
    | { kind: 'operator-error'; message: string };

export function load_check_config(options: {
    cwd: string;
    workspace_root: string;
    config_path?: string;
    no_config: boolean;
}): CheckConfigResult {
    if (options.no_config) {
        return {
            kind: 'loaded',
            config: validate_comment_formatting_config(DEFAULT_SETTINGS),
            warnings: [],
        };
    }

    const loaded = options.config_path
        ? load_toml_file(path.resolve(options.cwd, options.config_path))
        : discover_and_load_project_config(options.workspace_root);

    if (loaded.kind === 'load-failed') {
        return {
            kind: 'operator-error',
            message: `failed to load ${loaded.path}: ${loaded.error}`,
        };
    }

    if (loaded.kind === 'none') {
        return {
            kind: 'loaded',
            config: validate_comment_formatting_config(DEFAULT_SETTINGS),
            warnings: loaded.warnings,
        };
    }

    return {
        kind: 'loaded',
        config: validate_comment_formatting_config(
            deep_merge_config(DEFAULT_SETTINGS, loaded.partial_config)
        ),
        warnings: loaded.warnings,
        config_path: loaded.path,
    };
}
```

- [ ] **Step 5: Implement batch context construction with explicit wiring**

Add to `src/cli/check.ts`:

```typescript
export interface CheckContext {
    dependency_graph: DependencyGraph;
    workspace_indexer: WorkspaceIndexer;
    scope_resolver: ScopeResolver;
    forward_scope_resolver: ForwardScopeResolver;
    document_store: DocumentStore;
    diagnostics_provider: DiagnosticsProvider;
}

export async function build_check_context(
    workspace_root: string,
    config: StataLSPConfig
): Promise<CheckContext> {
    const dependency_graph = new DependencyGraph();
    const workspace_indexer = new WorkspaceIndexer();
    const scope_resolver = new ScopeResolver({
        log: (msg) => {
            if (config.debug === true) {
                console.error(msg);
            }
        },
        warn: (msg) => console.error(msg),
    }, {
        read_file: async (uri: string) =>
            fs.promises.readFile(URI.parse(uri).fsPath, 'utf8'),
        exists: async (uri: string) => {
            try {
                await fs.promises.access(URI.parse(uri).fsPath);
                return true;
            } catch {
                return false;
            }
        },
    });
    const forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
        max_forward_depth: config.cross_file.max_forward_depth,
    });
    const document_store = new DocumentStore();
    const diagnostics_provider = new DiagnosticsProvider({
        sendDiagnostics: () => undefined,
    });

    workspace_indexer.configure(config);
    workspace_indexer.set_max_indexed_files(
        config.cross_file.max_indexed_files
    );
    workspace_indexer.set_dependency_graph(dependency_graph);
    scope_resolver.set_dependency_graph(dependency_graph);
    scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    diagnostics_provider.set_dependency_graph(dependency_graph);
    document_store.set_workspace_roots([workspace_root]);
    document_store.set_scope_resolver(scope_resolver);
    document_store.set_on_backward_directives_parsed((uri, directives) => {
        workspace_indexer.set_buffer_directives(uri, directives);
    });

    await workspace_indexer.initialize([workspace_root], config.adoPaths);

    return {
        dependency_graph,
        workspace_indexer,
        scope_resolver,
        forward_scope_resolver,
        document_store,
        diagnostics_provider,
    };
}
```

- [ ] **Step 6: Run config and context tests**

Run:

```bash
bun test tests/unit/cli/check-config.test.ts tests/unit/cli/check-context.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/cli/check.ts tests/unit/cli/check-config.test.ts tests/unit/cli/check-context.test.ts
git commit -m "Build sight check batch context"
```

---

### Task 6: Collect Diagnostics And Return Gated Exit Codes

**Files:**
- Modify: `src/cli/check.ts`
- Test: `tests/integration/cli-check.test.ts`

- [ ] **Step 1: Write failing integration tests for same-file diagnostics, config, exit gates, large files, and invalid UTF-8**

Create `tests/integration/cli-check.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    run_check_with_cwd,
} from '../../src/cli/check';
import {
    EXIT_CHECK_FAILED,
    EXIT_OK,
    EXIT_OPERATOR_ERROR,
} from '../../src/cli/shared';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-integration-'));
}

async function run_capture(argv: string[], cwd: string) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_check_with_cwd(argv, cwd, {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
    });
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

describe('sight check integration', () => {
    it('reports same-file undefined macro diagnostics', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('main.do:1:');
        expect(result.stdout).toContain('Undefined macro');
    });

    it('honors editor default undefinedVariable off', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), 'regress y x\n');

        const result = await run_capture(['--workspace', root, '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('uses strict max severity gating', async () => {
        const root = temp_dir();
        fs.writeFileSync(
            path.join(root, 'sight.toml'),
            '[diagnostics.severity]\nundefinedMacro = "information"\n'
        );
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--max-severity', 'info'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toContain('info:');
    });

    it('indexes whole workspace while report paths filter output', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'parent.do'), 'global project_root /tmp\ndo child.do\n');
        fs.writeFileSync(path.join(root, 'child.do'), 'display "$project_root"\n');

        const result = await run_capture(['--workspace', root, 'child.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('reports malformed config as operator error', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const result = await run_capture(['--workspace', root], root);

        expect(result.code).toBe(EXIT_OPERATOR_ERROR);
        expect(result.stderr).toContain('failed to load');
    });

    it('reports missing explicit path as operator error', async () => {
        const root = temp_dir();

        const result = await run_capture(['--workspace', root, 'missing.do'], root);

        expect(result.code).toBe(EXIT_OPERATOR_ERROR);
        expect(result.stderr).toContain('path does not exist');
    });

    it('reports explicitly oversized source files as error diagnostics', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[indexing]\nmaxFileSizeBytes = 1\n');
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');

        const result = await run_capture(['--workspace', root, 'main.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('exceeds the configured limit');
    });

    it('reports explicit source files skipped by max indexed files', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'b.do'), 'display 2\n');

        const result = await run_capture(
            ['--workspace', root, 'a.do', 'b.do', '--quiet'],
            root
        );

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('was not indexed');
        expect(result.stdout).toContain('maxIndexedFiles');
    });

    it('reports invalid UTF-8 as an error diagnostic', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'bad.do'), Buffer.from([0x64, 0x80]));

        const result = await run_capture(['--workspace', root, 'bad.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('not valid UTF-8');
        expect(result.stdout).toContain('byte offset');
    });
});
```

- [ ] **Step 2: Run the integration tests and verify they fail**

Run:

```bash
bun test tests/integration/cli-check.test.ts
```

Expected: FAIL because `run_check_with_cwd()` and diagnostic collection are not
implemented.

- [ ] **Step 3: Implement injectable output and diagnostic collection**

Modify `src/cli/check.ts` to add:

```typescript
import { Diagnostic } from 'vscode-languageserver';
import {
    collect_report_targets,
    index_limit_diagnostic,
    relative_path,
    read_source_file,
    size_limit_diagnostic,
} from './source-files';
import {
    DiagnosticRecord,
    EXIT_CHECK_FAILED,
    EXIT_OK,
    EXIT_OPERATOR_ERROR,
    compare_diagnostic_records,
    diagnostic_exceeds_threshold,
    render_json,
    render_sarif,
    render_text,
    resolve_color_from_env,
} from './shared';

export interface CheckOutput {
    stdout(text: string): void;
    stderr(text: string): void;
}

const DEFAULT_OUTPUT: CheckOutput = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
};

function diagnostic_record(
    workspace_root: string,
    file_path: string,
    diagnostic: Diagnostic
): DiagnosticRecord {
    return {
        path: file_path,
        relative_path: relative_path(workspace_root, file_path),
        diagnostic,
    };
}
```

Add `collect_check_diagnostics()`:

```typescript
export async function collect_check_diagnostics(
    context: CheckContext,
    workspace_root: string,
    config: StataLSPConfig,
    targets: Array<{ path: string; relative_path: string; explicit: boolean }>
): Promise<DiagnosticRecord[]> {
    const records: DiagnosticRecord[] = [];
    const workspace_symbols = context.workspace_indexer.get_all_symbols();
    const indexed_files = context.workspace_indexer.get_indexed_files();

    for (const target of targets) {
        const stats = fs.statSync(target.path);
        const uri = URI.file(target.path).toString();
        if (target.explicit && stats.size > config.indexing.maxFileSizeBytes) {
            records.push(diagnostic_record(
                workspace_root,
                target.path,
                size_limit_diagnostic(
                    target.path,
                    stats.size,
                    config.indexing.maxFileSizeBytes
                )
            ));
            continue;
        }
        if (
            target.explicit &&
            context.workspace_indexer.get_metrics().files_indexed
                >= config.cross_file.max_indexed_files &&
            !indexed_files.has(uri)
        ) {
            records.push(diagnostic_record(
                workspace_root,
                target.path,
                index_limit_diagnostic(target.path)
            ));
            continue;
        }

        const read_result = read_source_file(target.path);
        if (read_result.kind === 'read-error') {
            throw new Error(read_result.message);
        }
        if (read_result.kind === 'decode-error') {
            records.push(diagnostic_record(
                workspace_root,
                target.path,
                read_result.diagnostic
            ));
            continue;
        }

        await context.document_store.open(
            uri,
            read_result.text,
            1,
            workspace_symbols
        );
        const state = context.document_store.get(uri);
        if (!state) {
            throw new Error(`failed to analyze ${target.path}`);
        }

        const diagnostics = await context.diagnostics_provider.get_diagnostics(
            state,
            config,
            workspace_symbols,
            context.scope_resolver
        );
        for (const diagnostic of diagnostics) {
            records.push(diagnostic_record(workspace_root, target.path, diagnostic));
        }
        context.document_store.close(uri);
    }

    return records.sort(compare_diagnostic_records);
}
```

- [ ] **Step 4: Implement `run_check_with_cwd()`**

Replace the temporary `run_check()` body and add:

```typescript
export async function run_check_with_cwd(
    argv: string[],
    cwd: string,
    output: CheckOutput = DEFAULT_OUTPUT
): Promise<number> {
    const result = parse_check_args(argv);
    if (!result.success) {
        output.stderr(`sight check: ${result.error}\n`);
        return EXIT_CHECK_FAILED;
    }
    if (result.args.help) {
        output.stdout(`${check_help_text()}\n`);
        return EXIT_OK;
    }

    const workspace_root = path.resolve(
        cwd,
        result.args.workspace ?? '.'
    );
    if (!fs.existsSync(workspace_root) ||
        !fs.statSync(workspace_root).isDirectory()) {
        output.stderr(`sight check: invalid workspace: ${workspace_root}\n`);
        return EXIT_OPERATOR_ERROR;
    }

    const config_result = load_check_config({
        cwd,
        workspace_root,
        config_path: result.args.config_path,
        no_config: result.args.no_config,
    });
    if (config_result.kind === 'operator-error') {
        output.stderr(`sight check: ${config_result.message}\n`);
        return EXIT_OPERATOR_ERROR;
    }
    for (const warning of config_result.warnings) {
        output.stderr(`sight check: ${warning.message}\n`);
    }

    const target_result = collect_report_targets(
        result.args.paths,
        workspace_root,
        cwd
    );
    if (target_result.operator_errors.length > 0) {
        for (const message of target_result.operator_errors) {
            output.stderr(`sight check: ${message}\n`);
        }
        return EXIT_OPERATOR_ERROR;
    }

    let context: CheckContext | undefined;
    try {
        context = await build_check_context(
            workspace_root,
            config_result.config
        );
        const diagnostics = await collect_check_diagnostics(
            context,
            workspace_root,
            config_result.config,
            target_result.targets
        );
        const any_failure = diagnostics.some((record) =>
            diagnostic_exceeds_threshold(
                record.diagnostic,
                result.args.max_severity
            )
        );

        if (result.args.format === OutputFormat.Json) {
            output.stdout(render_json(diagnostics));
        } else if (result.args.format === OutputFormat.Sarif) {
            output.stdout(render_sarif(diagnostics, package_json.version));
        } else {
            output.stdout(render_text(diagnostics, {
                quiet: result.args.quiet,
                use_color: resolve_color_from_env(result.args.color),
            }));
        }

        return any_failure ? EXIT_CHECK_FAILED : EXIT_OK;
    } catch (error) {
        output.stderr(
            `sight check: ${
                error instanceof Error ? error.message : String(error)
            }\n`
        );
        return EXIT_OPERATOR_ERROR;
    } finally {
        if (context) {
            await context.document_store.dispose();
        }
    }
}

function check_help_text(): string {
    return `
sight check ${package_json.version} - full Stata diagnostics for CI

USAGE:
    sight check [OPTIONS] [PATHS...]

OPTIONS:
    --workspace DIR             Workspace root to index (default: current directory)
    --config PATH               Explicit sight.toml path
    --no-config                 Ignore sight.toml and use built-in defaults
    --format text|json|sarif    Output format (default: text)
    --max-severity LEVEL        Highest severity that does not fail the build
                                (off, hint, info, warning, error; default: info)
    --quiet                     Suppress text summary line
    --color auto|always|never   Colorize text output (default: auto)
    --no-color                  Alias for --color never
    -h, --help                  Show this help message
`.trim();
}

export function print_check_help(): void {
    console.log(check_help_text());
}

export async function run_check(argv: string[]): Promise<number> {
    return run_check_with_cwd(argv, process.cwd(), DEFAULT_OUTPUT);
}
```

Task 3 intentionally did not add `print_check_help()`, so this is the only help
implementation in the plan.

- [ ] **Step 5: Run the integration tests**

Run:

```bash
bun test tests/integration/cli-check.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused unit tests from previous tasks**

Run:

```bash
bun test tests/unit/cli/shared.test.ts tests/unit/cli/source-files.test.ts tests/unit/cli/check-args.test.ts tests/unit/cli/check-config.test.ts tests/unit/cli/check-context.test.ts tests/unit/cli/diagnostics-connection.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/cli/check.ts tests/integration/cli-check.test.ts
git commit -m "Collect diagnostics for sight check"
```

---

### Task 7: Spawned CLI Smoke Tests, SARIF/JSON Checks, And Docs

**Files:**
- Modify: `docs/cli.md`
- Modify: `README.md`
- Test: `tests/integration/cli-check-spawn.test.ts`
- Test: `tests/integration/cli-check-output.test.ts`

- [ ] **Step 1: Write spawned command and output tests**

Create `tests/integration/cli-check-output.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-output-'));
}

async function run_capture(argv: string[], cwd: string) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_check_with_cwd(argv, cwd, {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
    });
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

describe('sight check machine output', () => {
    it('emits parseable JSON records', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--format', 'json'], root);
        const parsed = JSON.parse(result.stdout);

        expect(parsed[0].path).toBe('main.do');
        expect(parsed[0].diagnostic.source).toBe('sight');
    });

    it('emits SARIF 2.1.0 records', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--format', 'sarif'], root);
        const parsed = JSON.parse(result.stdout);

        expect(parsed.version).toBe('2.1.0');
        expect(parsed.runs[0].tool.driver.name).toBe('sight');
        expect(parsed.runs[0].results[0].ruleId).toMatch(/^SIGHT/);
    });
});
```

Create `tests/integration/cli-check-spawn.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-spawn-'));
}

const repo_root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

describe('sight check spawned CLI', () => {
    it('routes sight check --help through the top-level CLI', () => {
        const result = spawnSync(
            'bun',
            ['src/cli.ts', 'check', '--help'],
            { cwd: repo_root, encoding: 'utf8' }
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('sight check');
        expect(result.stdout).toContain('--workspace DIR');
    });

    it('returns exit 1 for check diagnostics through the top-level CLI', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");
        const result = spawnSync(
            'bun',
            ['src/cli.ts', 'check', '--workspace', root, '--quiet'],
            { cwd: repo_root, encoding: 'utf8' }
        );

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Undefined macro');
    });
});
```

- [ ] **Step 2: Run the new tests and verify docs are still missing**

Run:

```bash
bun test tests/integration/cli-check-output.test.ts tests/integration/cli-check-spawn.test.ts
```

Expected: PASS for tests if previous tasks are complete. Continue to docs in the
next step.

- [ ] **Step 3: Add CLI documentation**

Create or modify `docs/cli.md`:

```markdown
# CLI

Sight ships a `sight` binary for editor language-server use and command-line
checks.

## `sight check`

Run the same static diagnostics Sight publishes in the editor, but in a
headless batch suitable for CI:

```text
sight check [OPTIONS] [PATHS...]
```

`sight check` always indexes the whole workspace so `do`, `run`, and `include`
chains resolve correctly. Positional `PATHS...` only filter which files report
diagnostics. With no paths, Sight reports every `.do`, `.ado`, `.doh`, and
`.mata` file under the workspace.

Options:

- `--workspace DIR`: workspace root to index. Defaults to the current directory.
- `--config PATH`: explicit `sight.toml`, resolved from the invocation
  directory.
- `--no-config`: ignore `sight.toml` and use built-in defaults.
- `--format text|json|sarif`: output format. Defaults to `text`.
- `--max-severity off|hint|info|warning|error`: highest severity that does not
  fail the build. Defaults to `info`, so warnings and errors fail.
- `--quiet`: suppress the text summary line.
- `--color auto|always|never`: colorize text output.
- `--no-color`: alias for `--color never`.

Exit codes:

- `0`: no diagnostic exceeded `--max-severity`.
- `1`: at least one diagnostic exceeded `--max-severity`, or a usage error.
- `2`: operator error, such as invalid workspace, missing explicit path, or
  malformed config.

Example:

```yaml
- name: Check Stata sources
  run: sight check
```

`.mata` files are included as report targets because Sight indexes them for
symbols, but v1 diagnostics for Mata are limited to what the current parser and
diagnostic pipeline can produce.
```

Modify `README.md` to add a CLI docs link near the existing docs list:

```markdown
- [CLI](docs/cli.md) - `sight check` for CI and command-line diagnostics
```

- [ ] **Step 4: Run docs/output tests**

Run:

```bash
bun test tests/integration/cli-check-output.test.ts tests/integration/cli-check-spawn.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full project verification**

Run:

```bash
bun run test
```

Expected: PASS for typecheck and the full Bun test suite.

- [ ] **Step 6: Commit**

Run:

```bash
git add docs/cli.md README.md tests/integration/cli-check-output.test.ts tests/integration/cli-check-spawn.test.ts
git commit -m "Document sight check CLI"
```

---

## Adversarial Review Checklist

Before opening a PR or handing this branch back, verify these review-derived
failure modes explicitly:

- [ ] `sight check` routes before `parse_args()` rejects `check`.
- [ ] `DiagnosticsProvider` accepts a narrow CLI connection without `as any`.
- [ ] `WorkspaceIndexer`, `ScopeResolver`, `ForwardScopeResolver`, and
  `DiagnosticsProvider` are all wired to the same `DependencyGraph`.
- [ ] `workspace_indexer.set_max_indexed_files()` is called from validated
  config.
- [ ] Diagnostics use `workspace_indexer.get_all_symbols()`.
- [ ] Each report target is opened, diagnosed, and closed before the next target.
- [ ] CLI logging never writes warnings/debug text to stdout.
- [ ] `--max-severity info` does not fail `information` diagnostics.
- [ ] JSON and SARIF output are deterministic and parseable.
- [ ] Invalid UTF-8 in a reported source file is a diagnostic, not exit `2`.
- [ ] Missing explicit paths and unreadable files are exit `2`.
- [ ] `bun run test` passes.

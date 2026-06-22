import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { hasStataExtension, VCS_METADATA_DIRS } from '../utils/file-path-utils';
import { compare_strings, error_message } from './shared';

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

export function canonicalize_existing_path(file_path: string): string {
    return fs.realpathSync.native(file_path);
}

function workspace_relative(
    workspace_root: string,
    file_path: string
): { relative: string; inside: boolean } {
    const relative = path.relative(workspace_root, file_path);
    const inside = !relative.startsWith('..') && !path.isAbsolute(relative);
    return { relative, inside };
}

export function relative_path(workspace_root: string, file_path: string): string {
    const { relative } = workspace_relative(workspace_root, file_path);
    if (relative === '') {
        return '.';
    }
    // Emit a workspace-relative path even for out-of-workspace targets (a
    // `../`-prefixed path) so report output is deterministic and free of the
    // absolute, machine-specific prefix that would otherwise leak into JSON /
    // SARIF and break golden-file comparisons across machines. Only a path that
    // cannot be made relative (e.g. a different Windows drive, where
    // path.relative returns an absolute path) falls back to the absolute path.
    return path.isAbsolute(relative)
        ? file_path
        : relative.split(path.sep).join('/');
}

export function is_within_workspace(
    workspace_root: string,
    file_path: string
): boolean {
    const { relative, inside } = workspace_relative(workspace_root, file_path);
    return relative === '' || (relative.length > 0 && inside);
}

function walk_sources(
    dir_path: string,
    out: string[],
    operator_errors: string[]
): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir_path, { withFileTypes: true });
    } catch (error) {
        operator_errors.push(
            `cannot read directory: ${dir_path}: ${error_message(error)}`
        );
        return;
    }

    for (const entry of entries) {
        const entry_path = path.join(dir_path, entry.name);
        if (entry.isDirectory()) {
            if (VCS_METADATA_DIRS.has(entry.name)) continue;
            walk_sources(entry_path, out, operator_errors);
        } else if (entry.isFile() && hasStataExtension(entry.name)) {
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
    let normalized_root = path.resolve(workspace_root);
    try {
        normalized_root = canonicalize_existing_path(normalized_root);
    } catch {
        // Workspace validation happens before target collection in check.ts.
    }
    const has_explicit_paths = input_paths.length > 0;
    const paths_to_collect = input_paths.length > 0
        ? input_paths
        : [normalized_root];

    for (const input_path of paths_to_collect) {
        const resolved_path = path.resolve(cwd, input_path);
        if (!fs.existsSync(resolved_path)) {
            operator_errors.push(`path does not exist: ${input_path}`);
            continue;
        }

        let absolute_path: string;
        try {
            absolute_path = canonicalize_existing_path(resolved_path);
        } catch (error) {
            operator_errors.push(
                `cannot access path: ${input_path}: ${error_message(error)}`
            );
            continue;
        }

        let stat: fs.Stats;
        try {
            stat = fs.statSync(absolute_path);
        } catch (error) {
            operator_errors.push(
                `cannot stat path: ${input_path}: ${error_message(error)}`
            );
            continue;
        }
        if (stat.isDirectory()) {
            walk_sources(absolute_path, source_paths, operator_errors);
        } else if (stat.isFile() && hasStataExtension(absolute_path)) {
            source_paths.push(absolute_path);
        }
    }

    const targets: ReportTarget[] = Array.from(new Set(source_paths))
        .map((file_path) => ({
            path: file_path,
            relative_path: relative_path(normalized_root, file_path),
            explicit: has_explicit_paths,
        }));
    targets.sort((a, b) => compare_strings(a.relative_path, b.relative_path));

    return { targets, operator_errors };
}

function file_level_diagnostic(code: string, message: string): Diagnostic {
    return {
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        severity: DiagnosticSeverity.Error,
        source: 'sight',
        code,
        message,
    };
}

// File-level diagnostic messages deliberately omit the file path: the renderer
// already prefixes each diagnostic with its (workspace-relative) location, so
// repeating an absolute path in the message body is both redundant and
// machine-specific (it would break golden/snapshot comparisons in CI and leak
// the filesystem layout).
export function size_limit_diagnostic(
    actual_bytes: number,
    limit_bytes: number
): Diagnostic {
    return file_level_diagnostic(
        'SIGHT_FILE_TOO_LARGE',
        `File is ${actual_bytes} bytes, which exceeds ` +
        `the configured limit of ${limit_bytes} bytes.`
    );
}

export function index_limit_diagnostic(): Diagnostic {
    return file_level_diagnostic(
        'SIGHT_FILE_NOT_INDEXED',
        'File was not indexed before Sight reached ' +
        'crossFile.maxIndexedFiles. Raise maxIndexedFiles or check fewer files.'
    );
}

// Deterministic detail for a read/stat failure: the errno code (ENOENT,
// EACCES, ...) when present, else the error message. The OS error message
// embeds an absolute path, so prefer the code to keep output reproducible.
export function read_error_detail(error: unknown): string {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return typeof code === 'string' ? code : error_message(error);
}

// Per-file diagnostic for a target that cannot be stat-ed or read (e.g. it was
// deleted or its permissions changed after discovery). Reported per file so a
// benign race does not abort the whole check batch.
export function unreadable_diagnostic(detail: string): Diagnostic {
    return file_level_diagnostic(
        'SIGHT_UNREADABLE',
        `File could not be read: ${detail}`
    );
}

function utf8_error_offset(bytes: Buffer): number {
    // Return the byte offset where the first invalid UTF-8 sequence BEGINS
    // (its lead byte), not the trailing byte that proved it invalid, so the
    // diagnostic points a user at the actual start of the bad bytes. Single
    // O(n) pass validating lead/continuation bytes and the tightened ranges
    // that reject overlong encodings, surrogates, and out-of-range code points.
    const length = bytes.length;
    let i = 0;
    while (i < length) {
        const lead = bytes[i];
        if (lead <= 0x7f) {
            i++;
            continue;
        }

        let extra: number;
        let lower = 0x80;
        let upper = 0xbf;
        if (lead >= 0xc2 && lead <= 0xdf) {
            extra = 1;
        } else if (lead >= 0xe0 && lead <= 0xef) {
            extra = 2;
            if (lead === 0xe0) lower = 0xa0;       // reject overlong
            else if (lead === 0xed) upper = 0x9f;  // reject surrogates
        } else if (lead >= 0xf0 && lead <= 0xf4) {
            extra = 3;
            if (lead === 0xf0) lower = 0x90;       // reject overlong
            else if (lead === 0xf4) upper = 0x8f;  // reject > U+10FFFF
        } else {
            // Invalid lead byte: lone continuation, 0xc0/0xc1, or 0xf5..0xff.
            return i;
        }

        if (i + extra >= length) {
            return i; // truncated multi-byte sequence at end of input
        }
        // The first continuation byte uses the tightened [lower, upper] range;
        // remaining continuations only need to be 0x80..0xbf.
        if (bytes[i + 1] < lower || bytes[i + 1] > upper) {
            return i;
        }
        for (let k = 2; k <= extra; k++) {
            if (bytes[i + k] < 0x80 || bytes[i + k] > 0xbf) {
                return i;
            }
        }

        i += extra + 1;
    }

    // Only reached if the caller's decode error was spurious; fall back to the
    // final byte rather than claiming offset 0.
    return Math.max(0, length - 1);
}

function decode_error_diagnostic(offset: number): Diagnostic {
    return file_level_diagnostic(
        'SIGHT_INVALID_ENCODING',
        `File is not valid UTF-8 at byte offset ${offset}. ` +
        'Re-save the file as UTF-8.'
    );
}

export function read_source_file(file_path: string): SourceReadResult {
    let bytes: Buffer;
    try {
        bytes = fs.readFileSync(file_path);
    } catch (error) {
        return {
            kind: 'read-error',
            message: read_error_detail(error),
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
            diagnostic: decode_error_diagnostic(utf8_error_offset(bytes)),
        };
    }
}

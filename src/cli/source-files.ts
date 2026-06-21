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

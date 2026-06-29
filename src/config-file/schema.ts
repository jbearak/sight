import type { StataLSPConfig, CrossFileCaseMismatchSeverity } from '../types';
import type { DeepPartial, ProjectConfigWarning } from './types';

type WarningSink = (warning: ProjectConfigWarning) => void;
type JsonObject = Record<string, unknown>;
type Severity = StataLSPConfig['diagnostics']['severity']['undefinedMacro'];
type CrossFileSeverity =
    StataLSPConfig['cross_file']['diagnostics']['missing_file'];

const SEVERITIES = new Set([
    'error',
    'warning',
    'information',
    'hint',
    'off',
    'info',
]);
const CROSS_FILE_SEVERITIES = new Set([
    'error',
    'warning',
    'information',
    'off',
    'info',
]);
// 'auto' is only valid for case_mismatch — keep it separate from
// CROSS_FILE_SEVERITIES so other cross-file severity fields cannot
// accidentally accept it.
const CROSS_FILE_CASE_MISMATCH_SEVERITIES = new Set([
    'auto',
    'error',
    'warning',
    'information',
    'off',
    'info',
]);

const DIAGNOSTIC_SEVERITY_KEYS = [
    'undefinedMacro',
    'undefinedVariable',
    'styleWarnings',
    'malformedOperator',
    'spacedCompoundOperator',
    'invalidOperatorSequence',
    'cStyleLogicalInControlFlow',
    'mixedLogicalOperators',
] as const;

const INDENT_STYLES = ['spaces', 'tabs'] as const;
const FORMATTER_MODES = ['source-preserving', 'ast'] as const;
const COMMENT_STYLES = ['line', '//', '*', '/* */'] as const;
const LINE_COMMENT_STYLES = ['//', '*'] as const;
const ASSUME_CALL_SITE_VALUES = ['start', 'end'] as const;
const BACKWARD_DEPENDENCY_VALUES = ['auto', 'explicit'] as const;

// Server-side public settings the mapper understands and maps into the
// internal StataLSPConfig. Both camelCase and snake_case spellings of each
// are accepted (pick_key/normalize_name normalize on `_` and case), so every
// public setting has a permanent equivalent alias in either form.
const SERVER_TOP_LEVEL_KEYS = [
    'indexWorkspace',
    'adoPaths',
    'exclude',
    'lineCommentStyle',
    'debug',
    'diagnostics',
    'formatting',
    'completion',
    'indexing',
    'crossFile',
] as const;

// Top-level `sight.*` sections owned by the VS Code client, not the server.
// They legitimately appear in a full `sight` settings tree pushed via
// workspace/configuration or didChangeConfiguration, so the mapper recognizes
// (and ignores) them rather than emitting a misleading "unknown key" warning.
// The server never reads these; the client extension consumes them directly.
const CLIENT_ONLY_TOP_LEVEL_KEYS = [
    'sendToStata',
    'dataBrowser',
    'depthColors',
    'personalAdoDir',
] as const;

function is_object(value: unknown): value is JsonObject {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value);
}

function normalize_name(value: string): string {
    return value.replace(/_/g, '').toLowerCase();
}

function warn_invalid_value(
    key_path: string,
    value: unknown,
    warn?: WarningSink
): void {
    warn?.({
        code: 'invalid-value',
        key_path,
        message: `Invalid value for '${key_path}': ${JSON.stringify(value)}; ignoring`,
    });
}

function warn_unknown_key(
    key_path: string,
    raw_key: string,
    warn?: WarningSink
): void {
    warn?.({
        code: 'unknown-key',
        key_path,
        message: `Unknown project config key '${key_path}.${raw_key}'; ignoring`,
    });
}

function normalize_severity_value<T extends string>(
    value: unknown,
    key_path: string,
    allowed: ReadonlySet<string>,
    warn?: WarningSink
): T | undefined {
    if (typeof value !== 'string') {
        warn_invalid_value(key_path, value, warn);
        return undefined;
    }
    const lower = value.toLowerCase();
    if (!allowed.has(lower)) {
        warn_invalid_value(key_path, value, warn);
        return undefined;
    }
    return (lower === 'info' ? 'information' : lower) as T;
}

function pick_key(
    obj: JsonObject,
    canonical_key: string,
    warn?: WarningSink,
    key_path = canonical_key
): unknown {
    const matches = Object.keys(obj).filter(
        (my_key) => normalize_name(my_key) === normalize_name(canonical_key)
    );
    if (matches.length === 0) {
        return undefined;
    }

    const canonical_matches = matches.filter(
        (my_key) => my_key === canonical_key
    );
    if (canonical_matches.length === 1) {
        if (matches.length > 1) {
            warn?.({
                code: 'normalized-key-collision',
                key_path,
                message:
                    `Multiple keys normalize to '${key_path}'; ` +
                    `using canonical spelling '${canonical_key}' and ignoring ` +
                    matches
                        .filter((my_key) => my_key !== canonical_key)
                        .join(', '),
            });
        }
        return obj[canonical_key];
    }

    if (matches.length > 1) {
        warn?.({
            code: 'normalized-key-collision',
            key_path,
            message:
                `Multiple keys normalize to '${key_path}' and none use ` +
                `canonical spelling; ignoring ${matches.join(', ')}`,
        });
        return undefined;
    }

    return obj[matches[0]];
}

function warn_unknown_keys(
    obj: JsonObject,
    canonical_keys: readonly string[],
    parent_path: string,
    warn?: WarningSink
): void {
    const normalized_known = new Set(
        canonical_keys.map((my_key) => normalize_name(my_key))
    );
    for (const raw_key of Object.keys(obj)) {
        if (!normalized_known.has(normalize_name(raw_key))) {
            warn_unknown_key(parent_path, raw_key, warn);
        }
    }
}

function assign_boolean(
    target: JsonObject,
    key: string,
    source: JsonObject,
    public_key: string,
    key_path: string,
    warn?: WarningSink
): void {
    const value = pick_key(source, public_key, warn, key_path);
    if (value === undefined) {
        return;
    }
    if (typeof value === 'boolean') {
        target[key] = value;
    } else {
        warn_invalid_value(key_path, value, warn);
    }
}

function assign_number(
    target: JsonObject,
    key: string,
    source: JsonObject,
    public_key: string,
    key_path: string,
    warn?: WarningSink
): void {
    const value = pick_key(source, public_key, warn, key_path);
    if (value === undefined) {
        return;
    }
    if (typeof value === 'number') {
        target[key] = value;
    } else {
        warn_invalid_value(key_path, value, warn);
    }
}

function assign_string_member<V extends string>(
    target: JsonObject,
    key: string,
    source: JsonObject,
    public_key: string,
    key_path: string,
    allowed: readonly V[],
    warn?: WarningSink
): void {
    const value = pick_key(source, public_key, warn, key_path);
    if (value === undefined) {
        return;
    }
    if (typeof value !== 'string') {
        warn_invalid_value(key_path, value, warn);
        return;
    }
    const match = allowed.find(
        (candidate) => candidate.toLowerCase() === value.toLowerCase()
    );
    if (match) {
        target[key] = match;
    } else {
        warn_invalid_value(key_path, value, warn);
    }
}

function object_value(
    source: JsonObject,
    public_key: string,
    key_path: string,
    warn?: WarningSink
): JsonObject | undefined {
    const value = pick_key(source, public_key, warn, key_path);
    if (value === undefined) {
        return undefined;
    }
    if (is_object(value)) {
        return value;
    }
    warn_invalid_value(key_path, value, warn);
    return undefined;
}

function maybe_assign_object<T extends object>(
    target: JsonObject,
    key: string,
    value: T
): void {
    if (Object.keys(value).length > 0) {
        target[key] = value;
    }
}

function map_diagnostics(
    raw: JsonObject,
    warn?: WarningSink
): NonNullable<DeepPartial<StataLSPConfig>['diagnostics']> | undefined {
    warn_unknown_keys(
        raw,
        ['enabled', 'indentation', 'severity'],
        'diagnostics',
        warn
    );

    const mapped: JsonObject = {};
    assign_boolean(mapped, 'enabled', raw, 'enabled', 'diagnostics.enabled', warn);
    assign_boolean(
        mapped,
        'indentation',
        raw,
        'indentation',
        'diagnostics.indentation',
        warn
    );

    const severity = object_value(
        raw,
        'severity',
        'diagnostics.severity',
        warn
    );
    if (severity) {
        warn_unknown_keys(
            severity,
            DIAGNOSTIC_SEVERITY_KEYS,
            'diagnostics.severity',
            warn
        );
        const mapped_severity: JsonObject = {};
        for (const my_key of DIAGNOSTIC_SEVERITY_KEYS) {
            const value = pick_key(
                severity,
                my_key,
                warn,
                `diagnostics.severity.${my_key}`
            );
            if (value !== undefined) {
                const normalized = normalize_severity_value<Severity>(
                    value,
                    `diagnostics.severity.${my_key}`,
                    SEVERITIES,
                    warn
                );
                if (normalized) {
                    mapped_severity[my_key] = normalized;
                }
            }
        }
        maybe_assign_object(mapped, 'severity', mapped_severity);
    }

    return Object.keys(mapped).length > 0
        ? mapped as NonNullable<DeepPartial<StataLSPConfig>['diagnostics']>
        : undefined;
}

function map_formatting(
    raw: JsonObject,
    warn?: WarningSink
): NonNullable<DeepPartial<StataLSPConfig>['formatting']> | undefined {
    warn_unknown_keys(
        raw,
        [
            'indentSize',
            'indentStyle',
            'lineWidth',
            'preferredCommentStyle',
            'normalizeCommentStyle',
            'commentLineWidth',
            'mode',
            'preserveAlignment',
        ],
        'formatting',
        warn
    );

    const mapped: JsonObject = {};
    assign_number(mapped, 'indentSize', raw, 'indentSize', 'formatting.indentSize', warn);
    assign_string_member(
        mapped,
        'indentStyle',
        raw,
        'indentStyle',
        'formatting.indentStyle',
        INDENT_STYLES,
        warn
    );
    assign_number(mapped, 'lineWidth', raw, 'lineWidth', 'formatting.lineWidth', warn);
    assign_string_member(
        mapped,
        'preferredCommentStyle',
        raw,
        'preferredCommentStyle',
        'formatting.preferredCommentStyle',
        COMMENT_STYLES,
        warn
    );
    assign_boolean(
        mapped,
        'normalizeCommentStyle',
        raw,
        'normalizeCommentStyle',
        'formatting.normalizeCommentStyle',
        warn
    );
    assign_number(
        mapped,
        'commentLineWidth',
        raw,
        'commentLineWidth',
        'formatting.commentLineWidth',
        warn
    );
    assign_string_member(
        mapped,
        'mode',
        raw,
        'mode',
        'formatting.mode',
        FORMATTER_MODES,
        warn
    );
    assign_boolean(
        mapped,
        'preserve_alignment',
        raw,
        'preserveAlignment',
        'formatting.preserveAlignment',
        warn
    );

    return Object.keys(mapped).length > 0
        ? mapped as NonNullable<DeepPartial<StataLSPConfig>['formatting']>
        : undefined;
}

function map_completion(
    raw: JsonObject,
    warn?: WarningSink
): NonNullable<DeepPartial<StataLSPConfig>['completion']> | undefined {
    warn_unknown_keys(raw, ['cacheSize', 'prefixMaxItems'], 'completion', warn);
    const mapped: JsonObject = {};
    assign_number(mapped, 'cacheSize', raw, 'cacheSize', 'completion.cacheSize', warn);
    assign_number(
        mapped,
        'prefixMaxItems',
        raw,
        'prefixMaxItems',
        'completion.prefixMaxItems',
        warn
    );
    return Object.keys(mapped).length > 0
        ? mapped as NonNullable<DeepPartial<StataLSPConfig>['completion']>
        : undefined;
}

function map_indexing(
    raw: JsonObject,
    warn?: WarningSink
): NonNullable<DeepPartial<StataLSPConfig>['indexing']> | undefined {
    warn_unknown_keys(raw, ['maxFileSizeBytes'], 'indexing', warn);
    const mapped: JsonObject = {};
    assign_number(
        mapped,
        'maxFileSizeBytes',
        raw,
        'maxFileSizeBytes',
        'indexing.maxFileSizeBytes',
        warn
    );
    return Object.keys(mapped).length > 0
        ? mapped as NonNullable<DeepPartial<StataLSPConfig>['indexing']>
        : undefined;
}

function map_cross_file(
    raw: JsonObject,
    warn?: WarningSink
): DeepPartial<StataLSPConfig>['cross_file'] | undefined {
    warn_unknown_keys(
        raw,
        [
            'indexWorkspace',
            'maxIndexedFiles',
            'assumeCallSite',
            'backwardDependencies',
            'maxBackwardDepth',
            'maxForwardDepth',
            'maxChainDepth',
            'maxCalleeRevalidations',
            'diagnostics',
        ],
        'crossFile',
        warn
    );

    const mapped: JsonObject = {};
    assign_boolean(
        mapped,
        'index_workspace',
        raw,
        'indexWorkspace',
        'crossFile.indexWorkspace',
        warn
    );
    assign_number(
        mapped,
        'max_indexed_files',
        raw,
        'maxIndexedFiles',
        'crossFile.maxIndexedFiles',
        warn
    );
    assign_string_member(
        mapped,
        'assume_call_site',
        raw,
        'assumeCallSite',
        'crossFile.assumeCallSite',
        ASSUME_CALL_SITE_VALUES,
        warn
    );
    assign_string_member(
        mapped,
        'backward_dependencies',
        raw,
        'backwardDependencies',
        'crossFile.backwardDependencies',
        BACKWARD_DEPENDENCY_VALUES,
        warn
    );
    assign_number(
        mapped,
        'max_backward_depth',
        raw,
        'maxBackwardDepth',
        'crossFile.maxBackwardDepth',
        warn
    );
    assign_number(
        mapped,
        'max_forward_depth',
        raw,
        'maxForwardDepth',
        'crossFile.maxForwardDepth',
        warn
    );
    assign_number(
        mapped,
        'max_chain_depth',
        raw,
        'maxChainDepth',
        'crossFile.maxChainDepth',
        warn
    );
    assign_number(
        mapped,
        'max_callee_revalidations',
        raw,
        'maxCalleeRevalidations',
        'crossFile.maxCalleeRevalidations',
        warn
    );

    const diagnostics = object_value(
        raw,
        'diagnostics',
        'crossFile.diagnostics',
        warn
    );
    if (diagnostics) {
        warn_unknown_keys(
            diagnostics,
            ['missingFile', 'maxDepth', 'callSiteIdentification', 'caseMismatch'],
            'crossFile.diagnostics',
            warn
        );
        const mapped_diagnostics: JsonObject = {};
        for (const [public_key, internal_key] of [
            ['missingFile', 'missing_file'],
            ['maxDepth', 'max_depth'],
            ['callSiteIdentification', 'call_site_identification'],
        ] as const) {
            const key_path = `crossFile.diagnostics.${public_key}`;
            const value = pick_key(diagnostics, public_key, warn, key_path);
            if (value !== undefined) {
                const normalized = normalize_severity_value<CrossFileSeverity>(
                    value,
                    key_path,
                    CROSS_FILE_SEVERITIES,
                    warn
                );
                if (normalized) {
                    mapped_diagnostics[internal_key] = normalized;
                }
            }
        }
        // caseMismatch accepts 'auto' in addition to the standard severities
        const case_mismatch_key_path = 'crossFile.diagnostics.caseMismatch';
        const case_mismatch_value = pick_key(
            diagnostics,
            'caseMismatch',
            warn,
            case_mismatch_key_path
        );
        if (case_mismatch_value !== undefined) {
            const normalized = normalize_severity_value<CrossFileCaseMismatchSeverity>(
                case_mismatch_value,
                case_mismatch_key_path,
                CROSS_FILE_CASE_MISMATCH_SEVERITIES,
                warn
            );
            if (normalized) {
                mapped_diagnostics['case_mismatch'] = normalized;
            }
        }
        maybe_assign_object(mapped, 'diagnostics', mapped_diagnostics);
    }

    return Object.keys(mapped).length > 0
        ? mapped as DeepPartial<StataLSPConfig>['cross_file']
        : undefined;
}

export function map_public_config_to_partial_config(
    raw: unknown,
    warn?: WarningSink
): DeepPartial<StataLSPConfig> {
    if (!is_object(raw)) {
        return {};
    }

    // Recognize both server-mapped keys and client-only sections so a full
    // `sight` settings tree (which carries sendToStata/dataBrowser/... for the
    // VS Code client) does not produce spurious unknown-key warnings.
    warn_unknown_keys(
        raw,
        [...SERVER_TOP_LEVEL_KEYS, ...CLIENT_ONLY_TOP_LEVEL_KEYS],
        'sight',
        warn
    );

    const mapped: DeepPartial<StataLSPConfig> = {};
    const root = mapped as JsonObject;

    assign_boolean(root, 'indexWorkspace', raw, 'indexWorkspace', 'indexWorkspace', warn);

    const ado_paths = pick_key(raw, 'adoPaths', warn, 'adoPaths');
    if (ado_paths !== undefined) {
        if (Array.isArray(ado_paths)
            && ado_paths.every((item) => typeof item === 'string')) {
            mapped.adoPaths = ado_paths;
        } else {
            warn_invalid_value('adoPaths', ado_paths, warn);
        }
    }

    const exclude = pick_key(raw, 'exclude', warn, 'exclude');
    if (exclude !== undefined) {
        if (Array.isArray(exclude)
            && exclude.every((item) => typeof item === 'string')) {
            mapped.exclude = exclude;
        } else {
            warn_invalid_value('exclude', exclude, warn);
        }
    }

    assign_string_member(
        root,
        'lineCommentStyle',
        raw,
        'lineCommentStyle',
        'lineCommentStyle',
        LINE_COMMENT_STYLES,
        warn
    );
    assign_boolean(root, 'debug', raw, 'debug', 'debug', warn);

    const diagnostics = object_value(raw, 'diagnostics', 'diagnostics', warn);
    const mapped_diagnostics = diagnostics
        ? map_diagnostics(diagnostics, warn)
        : undefined;
    if (mapped_diagnostics) {
        mapped.diagnostics = mapped_diagnostics;
    }

    const formatting = object_value(raw, 'formatting', 'formatting', warn);
    const mapped_formatting = formatting
        ? map_formatting(formatting, warn)
        : undefined;
    if (mapped_formatting) {
        mapped.formatting = mapped_formatting;
    }

    const completion = object_value(raw, 'completion', 'completion', warn);
    const mapped_completion = completion
        ? map_completion(completion, warn)
        : undefined;
    if (mapped_completion) {
        mapped.completion = mapped_completion;
    }

    const indexing = object_value(raw, 'indexing', 'indexing', warn);
    const mapped_indexing = indexing
        ? map_indexing(indexing, warn)
        : undefined;
    if (mapped_indexing) {
        mapped.indexing = mapped_indexing;
    }

    const cross_file = object_value(raw, 'crossFile', 'crossFile', warn);
    const mapped_cross_file = cross_file
        ? map_cross_file(cross_file, warn)
        : undefined;
    if (mapped_cross_file) {
        mapped.cross_file = mapped_cross_file;
    }

    return mapped;
}

/**
 * Configuration Validation Module
 *
 * Provides validation and fallback logic for StataLSPConfig settings,
 * particularly for comment formatting configuration.
 */

import { StataLSPConfig } from '../types';
import type { DeepPartial } from '../config-file/types';
import { DEFAULT_SETTINGS } from '../server-handlers';

type CrossFileSeverityLevel = 'error' | 'warning' | 'information' | 'off';
type CrossFileCaseMismatchLevel =
    'auto' | 'error' | 'warning' | 'information' | 'off';

/**
 * Build a complete StataLSPConfig by validating a partial configuration, applying defaults for missing or invalid fields, and normalizing allowed values.
 *
 * @param config - Partial configuration to validate and merge into defaults
 * @param log_warning - Optional callback invoked with a warning message when a provided value is invalid
 * @returns A fully populated StataLSPConfig with validated values and defaults applied where necessary
 */
export function validate_comment_formatting_config(
    config: DeepPartial<StataLSPConfig> | undefined,
    log_warning?: (message: string) => void
): StataLSPConfig {
    // Start with defaults
    const validated_config: StataLSPConfig = JSON.parse(
        JSON.stringify(DEFAULT_SETTINGS)
    );

    if (!config) {
        return validated_config;
    }

    // Validate formatting section
    if (config.formatting) {
        const formatting = config.formatting;

        // Validate indentSize
        if (formatting.indentSize !== undefined) {
            if (typeof formatting.indentSize === 'number' && formatting.indentSize > 0) {
                validated_config.formatting.indentSize = formatting.indentSize;
            } else {
                log_warning?.(
                    `Invalid indentSize: ${formatting.indentSize}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.indentSize}`
                );
            }
        }

        // Validate indentStyle
        if (formatting.indentStyle !== undefined) {
            if (formatting.indentStyle === 'spaces' || formatting.indentStyle === 'tabs') {
                validated_config.formatting.indentStyle = formatting.indentStyle;
            } else {
                log_warning?.(
                    `Invalid indentStyle: ${formatting.indentStyle}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.indentStyle}`
                );
            }
        }

        // Validate preferredCommentStyle
        if (formatting.preferredCommentStyle !== undefined) {
            if (
                formatting.preferredCommentStyle === 'line' ||
                formatting.preferredCommentStyle === '//' ||
                formatting.preferredCommentStyle === '*' ||
                formatting.preferredCommentStyle === '/* */'
            ) {
                validated_config.formatting.preferredCommentStyle =
                    formatting.preferredCommentStyle;
            } else {
                log_warning?.(
                    `Invalid preferredCommentStyle: ${formatting.preferredCommentStyle}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.preferredCommentStyle}`
                );
            }
        }

        // Validate normalizeCommentStyle
        if (formatting.normalizeCommentStyle !== undefined) {
            if (typeof formatting.normalizeCommentStyle === 'boolean') {
                validated_config.formatting.normalizeCommentStyle = formatting.normalizeCommentStyle;
            } else {
                log_warning?.(
                    `Invalid normalizeCommentStyle: ${formatting.normalizeCommentStyle}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.normalizeCommentStyle}`
                );
            }
        }

        // Validate commentLineWidth
        if (formatting.commentLineWidth !== undefined) {
            if (typeof formatting.commentLineWidth === 'number' && formatting.commentLineWidth > 0) {
                validated_config.formatting.commentLineWidth = formatting.commentLineWidth;
            } else {
                log_warning?.(
                    `Invalid commentLineWidth: ${formatting.commentLineWidth}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.commentLineWidth}`
                );
            }
        }

        // Validate lineWidth
        if (formatting.lineWidth !== undefined) {
            if (typeof formatting.lineWidth === 'number' && formatting.lineWidth > 0) {
                validated_config.formatting.lineWidth = formatting.lineWidth;
            } else {
                log_warning?.(
                    `Invalid lineWidth: ${formatting.lineWidth}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.lineWidth}`
                );
            }
        }

        // Validate mode
        if (formatting.mode !== undefined) {
            if (formatting.mode === 'source-preserving' || formatting.mode === 'ast') {
                validated_config.formatting.mode = formatting.mode;
            } else {
                log_warning?.(
                    `Invalid formatting.mode: ${formatting.mode}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.mode}`
                );
            }
        }

        // Validate preserve_alignment
        if (formatting.preserve_alignment !== undefined) {
            if (typeof formatting.preserve_alignment === 'boolean') {
                validated_config.formatting.preserve_alignment = formatting.preserve_alignment;
            } else {
                log_warning?.(
                    `Invalid preserve_alignment: ${formatting.preserve_alignment}. ` +
                    `Using default: ${DEFAULT_SETTINGS.formatting.preserve_alignment}`
                );
            }
        }
    }

    // Resolve "line" to effective style using lineCommentStyle
    if (validated_config.formatting.preferredCommentStyle === 'line') {
        const line_style = config?.lineCommentStyle;
        validated_config.formatting.preferredCommentStyle =
            line_style === '*' ? '*' : '//';
    }

    // Validate other sections (diagnostics, completion, indexing)
    if (config.diagnostics) {
        const diagnostics = config.diagnostics;

        if (typeof diagnostics.enabled === 'boolean') {
            validated_config.diagnostics.enabled = diagnostics.enabled;
        }

        if (diagnostics.severity) {
            const valid_severities = ['error', 'warning', 'information', 'hint', 'off'];
            if (
                diagnostics.severity.undefinedMacro &&
                valid_severities.includes(diagnostics.severity.undefinedMacro)
            ) {
                validated_config.diagnostics.severity.undefinedMacro = diagnostics.severity.undefinedMacro;
            }
            if (
                diagnostics.severity.undefinedVariable &&
                valid_severities.includes(diagnostics.severity.undefinedVariable)
            ) {
                validated_config.diagnostics.severity.undefinedVariable = diagnostics.severity.undefinedVariable;
            }
            if (
                diagnostics.severity.styleWarnings &&
                valid_severities.includes(diagnostics.severity.styleWarnings)
            ) {
                validated_config.diagnostics.severity.styleWarnings = diagnostics.severity.styleWarnings;
            }
            if (
                diagnostics.severity.malformedOperator &&
                valid_severities.includes(diagnostics.severity.malformedOperator)
            ) {
                validated_config.diagnostics.severity.malformedOperator = diagnostics.severity.malformedOperator;
            }
            if (
                diagnostics.severity.spacedCompoundOperator &&
                valid_severities.includes(diagnostics.severity.spacedCompoundOperator)
            ) {
                validated_config.diagnostics.severity.spacedCompoundOperator =
                    diagnostics.severity.spacedCompoundOperator;
            }
            if (
                diagnostics.severity.invalidOperatorSequence &&
                valid_severities.includes(diagnostics.severity.invalidOperatorSequence)
            ) {
                validated_config.diagnostics.severity.invalidOperatorSequence = diagnostics.severity.invalidOperatorSequence;
            }
            if (
                diagnostics.severity.cStyleLogicalInControlFlow &&
                valid_severities.includes(diagnostics.severity.cStyleLogicalInControlFlow)
            ) {
                validated_config.diagnostics.severity.cStyleLogicalInControlFlow = diagnostics.severity.cStyleLogicalInControlFlow;
            }
            if (
                diagnostics.severity.mixedLogicalOperators &&
                valid_severities.includes(diagnostics.severity.mixedLogicalOperators)
            ) {
                validated_config.diagnostics.severity.mixedLogicalOperators = diagnostics.severity.mixedLogicalOperators;
            }
        }

        if (typeof diagnostics.indentation === 'boolean') {
            validated_config.diagnostics.indentation = diagnostics.indentation;
        }
    }

    // Validate completion section
    if (config.completion) {
        const completion = config.completion;
        if (typeof completion.cacheSize === 'number' && completion.cacheSize > 0) {
            validated_config.completion.cacheSize = completion.cacheSize;
        } else if (completion.cacheSize !== undefined) {
            log_warning?.(
                `Invalid completion.cacheSize: ${completion.cacheSize}. ` +
                `Using default: ${DEFAULT_SETTINGS.completion.cacheSize}`
            );
        }

        if (typeof completion.prefixMaxItems === 'number' && completion.prefixMaxItems > 0) {
            validated_config.completion.prefixMaxItems = completion.prefixMaxItems;
        } else if (completion.prefixMaxItems !== undefined) {
            log_warning?.(
                `Invalid completion.prefixMaxItems: ${completion.prefixMaxItems}. ` +
                `Using default: ${DEFAULT_SETTINGS.completion.prefixMaxItems}`
            );
        }
    }

    if (config.indexing) {
        const indexing = config.indexing;

        if (typeof indexing.maxFileSizeBytes === 'number' && indexing.maxFileSizeBytes > 0) {
            validated_config.indexing.maxFileSizeBytes = indexing.maxFileSizeBytes;
        }
    }

    if (Array.isArray(config.adoPaths)) {
        validated_config.adoPaths = config.adoPaths;
    }

    if (Array.isArray(config.exclude)
        && config.exclude.every((item) => typeof item === 'string')) {
        validated_config.exclude = config.exclude;
    }

    if (typeof config.indexWorkspace === 'boolean') {
        validated_config.indexWorkspace = config.indexWorkspace;
    }

    if (typeof config.debug === 'boolean') {
        validated_config.debug = config.debug;
    }

    // Validate cross_file section
    if (config.cross_file) {
        const cross_file = config.cross_file;

        if (typeof cross_file.index_workspace === 'boolean') {
            validated_config.cross_file.index_workspace = cross_file.index_workspace;
        }

        if (typeof cross_file.max_indexed_files === 'number' && cross_file.max_indexed_files > 0) {
            validated_config.cross_file.max_indexed_files = cross_file.max_indexed_files;
        }

        if (cross_file.assume_call_site === 'end' || cross_file.assume_call_site === 'start') {
            validated_config.cross_file.assume_call_site = cross_file.assume_call_site;
        }

        if (
            cross_file.backward_dependencies === 'auto' ||
            cross_file.backward_dependencies === 'explicit'
        ) {
            validated_config.cross_file.backward_dependencies =
                cross_file.backward_dependencies;
        }

        if (typeof cross_file.max_backward_depth === 'number' && cross_file.max_backward_depth > 0) {
            validated_config.cross_file.max_backward_depth = cross_file.max_backward_depth;
        }
        if (typeof cross_file.max_forward_depth === 'number' && cross_file.max_forward_depth > 0) {
            validated_config.cross_file.max_forward_depth = cross_file.max_forward_depth;
        }
        if (typeof cross_file.max_chain_depth === 'number' && cross_file.max_chain_depth > 0) {
            validated_config.cross_file.max_chain_depth = cross_file.max_chain_depth;
        }

        if (typeof cross_file.max_callee_revalidations === 'number' && cross_file.max_callee_revalidations > 0) {
            validated_config.cross_file.max_callee_revalidations = cross_file.max_callee_revalidations;
        }

        if (cross_file.diagnostics) {
            const valid_severities = ['error', 'warning', 'information', 'info', 'off'];
            const valid_case_mismatch_severities = [
                'auto', 'error', 'warning', 'information', 'info', 'off',
            ];
            const normalize_sev = (s: string): CrossFileSeverityLevel =>
                (s === 'info' ? 'information' : s) as CrossFileSeverityLevel;
            const normalize_case_mismatch_sev = (
                s: string
            ): CrossFileCaseMismatchLevel =>
                (s === 'info' ? 'information' : s) as CrossFileCaseMismatchLevel;
            if (
                cross_file.diagnostics.missing_file &&
                valid_severities.includes(cross_file.diagnostics.missing_file)
            ) {
                validated_config.cross_file.diagnostics.missing_file = normalize_sev(cross_file.diagnostics.missing_file);
            }
            if (
                cross_file.diagnostics.max_depth &&
                valid_severities.includes(cross_file.diagnostics.max_depth)
            ) {
                validated_config.cross_file.diagnostics.max_depth = normalize_sev(cross_file.diagnostics.max_depth);
            }
            if (
                cross_file.diagnostics.call_site_identification &&
                valid_severities.includes(cross_file.diagnostics.call_site_identification)
            ) {
                validated_config.cross_file.diagnostics.call_site_identification = normalize_sev(cross_file.diagnostics.call_site_identification);
            }
            // case_mismatch accepts 'auto' in addition to the standard
            // severities; an invalid value falls back to 'auto' with a warning
            if (cross_file.diagnostics.case_mismatch !== undefined) {
                const my_raw = cross_file.diagnostics.case_mismatch as string;
                if (valid_case_mismatch_severities.includes(my_raw)) {
                    validated_config.cross_file.diagnostics.case_mismatch =
                        normalize_case_mismatch_sev(my_raw);
                } else {
                    log_warning?.(
                        `Invalid cross_file.diagnostics.case_mismatch: ` +
                        `${my_raw}. Using default: auto`
                    );
                    validated_config.cross_file.diagnostics.case_mismatch = 'auto';
                }
            }
        }
    }

    return validated_config;
}

/**
 * Validates that a comment style value is valid.
 *
 * @param style - The comment style to validate
 * @returns true if valid, false otherwise
 */
export function is_valid_comment_style(
    style: unknown
): style is 'line' | '//' | '*' | '/* */' {
    return style === 'line'
        || style === '//'
        || style === '*'
        || style === '/* */';
}

/**
 * Validates that a comment line width is valid.
 *
 * @param width - The line width to validate
 * @returns true if valid, false otherwise
 */
export function is_valid_comment_line_width(width: unknown): width is number {
    return typeof width === 'number' && width > 0;
}

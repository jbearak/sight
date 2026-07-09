import { describe, expect, it } from 'bun:test';
import { map_public_config_to_partial_config } from '../../../src/config-file';

describe('map_public_config_to_partial_config', () => {
    it('maps every public server-side section into internal config shape', () => {
        const result = map_public_config_to_partial_config({
            indexWorkspace: false,
            adoPaths: ['/ado'],
            exclude: ['output/**', '!output/keep.do'],
            lineCommentStyle: '*',
            debug: true,
            diagnostics: {
                enabled: false,
                indentation: true,
                severity: {
                    undefinedMacro: 'error',
                    undefinedVariable: 'warning',
                    styleWarnings: 'information',
                    malformedOperator: 'hint',
                    spacedCompoundOperator: 'warning',
                    invalidOperatorSequence: 'off',
                    cStyleLogicalInControlFlow: 'info',
                    mixedLogicalOperators: 'warning',
                },
            },
            formatting: {
                indentSize: 2,
                indentStyle: 'tabs',
                lineWidth: 100,
                preferredCommentStyle: 'line',
                normalizeCommentStyle: true,
                commentLineWidth: 88,
                mode: 'ast',
                preserveAlignment: false,
            },
            completion: {
                cacheSize: 50,
                prefixMaxItems: 25,
            },
            indexing: {
                maxFileSizeBytes: 12345,
            },
            crossFile: {
                indexWorkspace: false,
                maxIndexedFiles: 17,
                assumeCallSite: 'start',
                backwardDependencies: 'explicit',
                maxBackwardDepth: 3,
                maxForwardDepth: 4,
                maxChainDepth: 5,
                maxCalleeRevalidations: 6,
                diagnostics: {
                    missingFile: 'error',
                    maxDepth: 'info',
                    callSiteIdentification: 'off',
                },
            },
        });

        expect(result.indexWorkspace).toBe(false);
        expect(result.adoPaths).toEqual(['/ado']);
        expect(result.exclude).toEqual(['output/**', '!output/keep.do']);
        expect(result.lineCommentStyle).toBe('*');
        expect(result.debug).toBe(true);
        expect(result.diagnostics?.enabled).toBe(false);
        expect(result.diagnostics?.severity?.spacedCompoundOperator).toBe('warning');
        expect(result.diagnostics?.severity?.cStyleLogicalInControlFlow).toBe('information');
        expect(result.formatting?.preserve_alignment).toBe(false);
        expect(result.cross_file?.backward_dependencies).toBe('explicit');
        expect(result.cross_file?.diagnostics?.max_depth).toBe('information');
    });

    it('accepts known keys and enum values case-insensitively', () => {
        const result = map_public_config_to_partial_config({
            CrossFile: {
                BackwardDependencies: 'AUTO',
                Diagnostics: {
                    MissingFile: 'Info',
                },
            },
        });

        expect(result.cross_file?.backward_dependencies).toBe('auto');
        expect(result.cross_file?.diagnostics?.missing_file).toBe('information');
    });

    it('warns and ignores a non-string-array exclude', () => {
        const warnings: string[] = [];
        const result = map_public_config_to_partial_config(
            { exclude: ['output/**', 42] },
            (warning) => warnings.push(warning.message)
        );

        expect(result.exclude).toBeUndefined();
        expect(warnings.join('\n')).toContain('exclude');
    });

    it('uses workspace.exclude canonically and keeps root exclude as an alias', () => {
        const canonical = map_public_config_to_partial_config({
            workspace: { exclude: ['canonical/**'] },
        });
        const legacy = map_public_config_to_partial_config({
            exclude: ['legacy/**'],
        });

        expect(canonical.exclude).toEqual(['canonical/**']);
        expect(legacy.exclude).toEqual(['legacy/**']);
    });

    it('prefers canonical shared paths over compatibility aliases', () => {
        const warnings: string[] = [];
        const result = map_public_config_to_partial_config(
            {
                workspace: { exclude: ['canonical/**'] },
                exclude: ['legacy/**'],
                diagnostics: {
                    severity: { undefinedVariable: 'error' },
                    undefinedVariableSeverity: 'warning',
                },
                crossFile: {
                    diagnostics: {
                        missingFile: 'off',
                        caseMismatch: 'auto',
                    },
                    missingFileSeverity: 'error',
                    caseMismatchSeverity: 'warning',
                },
            },
            (warning) => warnings.push(warning.message)
        );

        expect(result.exclude).toEqual(['canonical/**']);
        expect(result.diagnostics?.severity?.undefinedVariable).toBe('error');
        expect(result.cross_file?.diagnostics?.missing_file).toBe('off');
        expect(result.cross_file?.diagnostics?.case_mismatch).toBe('auto');
        expect(warnings.filter((warning) => warning.includes('compatibility alias')))
            .toHaveLength(4);
    });

    it('accepts Raven diagnostic paths as compatibility aliases', () => {
        const result = map_public_config_to_partial_config({
            diagnostics: { undefinedVariableSeverity: 'hint' },
            crossFile: {
                missingFileSeverity: 'information',
                caseMismatchSeverity: 'warning',
            },
        });

        expect(result.diagnostics?.severity?.undefinedVariable).toBe('hint');
        expect(result.cross_file?.diagnostics?.missing_file).toBe('information');
        expect(result.cross_file?.diagnostics?.case_mismatch).toBe('warning');
    });

    it('warns and ignores colliding aliases when no canonical spelling exists', () => {
        const warnings: string[] = [];
        const result = map_public_config_to_partial_config(
            {
                CrossFile: { maxChainDepth: 10 },
                crossfile: { maxChainDepth: 20 },
            },
            (warning) => warnings.push(warning.message)
        );

        expect(result.cross_file).toBeUndefined();
        expect(warnings.join('\n')).toContain('crossFile');
    });

    it('uses canonical spelling when aliases collide with canonical spelling', () => {
        const result = map_public_config_to_partial_config({
            crossFile: { maxChainDepth: 10 },
            CrossFile: { maxChainDepth: 20 },
        });

        expect(result.cross_file?.max_chain_depth).toBe(10);
    });

    describe('crossFile.diagnostics.caseMismatch', () => {
        it('maps caseMismatch "auto" to cross_file.diagnostics.case_mismatch', () => {
            const result = map_public_config_to_partial_config({
                crossFile: { diagnostics: { caseMismatch: 'auto' } },
            });
            expect(result.cross_file?.diagnostics?.case_mismatch).toBe('auto');
        });

        it('maps caseMismatch "warning" through to internal field', () => {
            const result = map_public_config_to_partial_config({
                crossFile: { diagnostics: { caseMismatch: 'warning' } },
            });
            expect(result.cross_file?.diagnostics?.case_mismatch).toBe('warning');
        });

        it('maps caseMismatch "info" to "information"', () => {
            const result = map_public_config_to_partial_config({
                crossFile: { diagnostics: { caseMismatch: 'info' } },
            });
            expect(result.cross_file?.diagnostics?.case_mismatch).toBe('information');
        });

        it('rejects an invalid caseMismatch value and emits a warning', () => {
            const the_warnings: string[] = [];
            const result = map_public_config_to_partial_config(
                { crossFile: { diagnostics: { caseMismatch: 'bogus' } } },
                (w) => the_warnings.push(w.message)
            );
            expect(result.cross_file?.diagnostics?.case_mismatch).toBeUndefined();
            expect(the_warnings.length).toBeGreaterThan(0);
        });

        it('rejects "auto" for missingFile — auto is not allowed on other cross-file severities', () => {
            const the_warnings: string[] = [];
            const result = map_public_config_to_partial_config(
                { crossFile: { diagnostics: { missingFile: 'auto' } } },
                (w) => the_warnings.push(w.message)
            );
            expect(result.cross_file?.diagnostics?.missing_file).not.toBe('auto');
            expect(the_warnings.length).toBeGreaterThan(0);
        });
    });
});

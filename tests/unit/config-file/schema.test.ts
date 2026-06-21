import { describe, expect, it } from 'bun:test';
import { map_public_config_to_partial_config } from '../../../src/config-file';

describe('map_public_config_to_partial_config', () => {
    it('maps every public server-side section into internal config shape', () => {
        const result = map_public_config_to_partial_config({
            indexWorkspace: false,
            adoPaths: ['/ado'],
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
        expect(result.lineCommentStyle).toBe('*');
        expect(result.debug).toBe(true);
        expect(result.diagnostics?.enabled).toBe(false);
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
});

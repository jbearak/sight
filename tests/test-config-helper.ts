import { StataLSPConfig, CrossFileConfig } from '../src/types';

/**
 * Creates a minimal test config with defaults, allowing partial overrides.
 * Avoids type assertion issues in tests.
 */
export function createTestConfig(overrides: Partial<StataLSPConfig> = {}): StataLSPConfig {
    const defaultCrossFile: CrossFileConfig = {
        indexWorkspace: true,
        maxIndexedFiles: 1000,
        maxBackwardDepth: 10,
        maxForwardDepth: 10,
        maxChainDepth: 20,
        maxCalleeRevalidations: 10,
        assumeCallSite: 'end',
        diagnostics: {
            undefinedSymbol: 'warning',
            outOfScope: 'information',
            missingFile: 'warning',
            callSiteIdentification: 'information'
        }
    };

    return {
        diagnostics: {
            enabled: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'information',
                styleWarnings: 'hint'
            },
            undefinedVariableEnabled: false,
            indentation: true
        },
        completion: { 
            cacheSize: 100, 
            prefixMaxItems: 50 
        },
        formatting: { 
            indentSize: 4, 
            indentStyle: 'spaces', 
            lineWidth: 80,
            preferredCommentStyle: '//',
            normalizeCommentStyle: false,
            commentLineWidth: 72
        },
        indexing: { 
            maxFileSizeBytes: 500000 
        },
        adoPaths: [],
        indexWorkspace: true,
        cross_file: defaultCrossFile,
        ...overrides
    };
}

import { describe, expect, it } from 'bun:test';
import {
    deep_merge_config,
    map_public_config_to_partial_config,
} from '../../../src/config-file';
import type { ProjectConfigWarning } from '../../../src/config-file';
import { validate_comment_formatting_config } from '../../../src/utils/config-validator';
import type { StataLSPConfig } from '../../../src/types';

// The canonical public convention is camelCase, but every public setting must
// also accept its snake_case spelling (and vice-versa) as a permanent,
// equivalent alias. These tests resolve a public-shape settings object through
// the same pipeline the server uses (map -> merge -> validate) and assert that
// the camelCase and snake_case spellings of every setting produce identical
// effective StataLSPConfig values, with no warnings.

interface Resolved {
    config: StataLSPConfig;
    warnings: string[];
}

function resolve_public_settings(public_config: unknown): Resolved {
    const warnings: string[] = [];
    const mapped = map_public_config_to_partial_config(
        public_config,
        (warning: ProjectConfigWarning) => warnings.push(warning.message)
    );
    const merged = deep_merge_config({}, mapped);
    const config = validate_comment_formatting_config(merged);
    return { config, warnings };
}

// Convert a camelCase identifier to snake_case. Used to derive the alias form
// for each leaf key so the table stays single-sourced on the camelCase name.
function to_snake_case(name: string): string {
    return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

// Build a nested public-config object from a dotted camelCase path and a value.
function build_nested(path: string[], value: unknown): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let i = 0; i < path.length - 1; i++) {
        const next: Record<string, unknown> = {};
        cursor[path[i]] = next;
        cursor = next;
    }
    cursor[path[path.length - 1]] = value;
    return root;
}

// Build the same object but with every path segment rewritten to snake_case.
function build_nested_snake(
    path: string[],
    value: unknown
): Record<string, unknown> {
    return build_nested(path.map(to_snake_case), value);
}

// Every public setting, by its dotted camelCase path, paired with a
// non-default value. Validating against a non-default value proves the setting
// actually took effect (rather than coinciding with the default).
const PUBLIC_SETTINGS: ReadonlyArray<{ path: string[]; value: unknown }> = [
    // Top-level
    { path: ['indexWorkspace'], value: false },
    { path: ['adoPaths'], value: ['/custom/ado', '/more/ado'] },
    { path: ['exclude'], value: ['output/**', 'tmp/*.do'] },
    { path: ['lineCommentStyle'], value: '*' },
    { path: ['debug'], value: true },

    // diagnostics
    { path: ['diagnostics', 'enabled'], value: false },
    { path: ['diagnostics', 'indentation'], value: true },

    // diagnostics.severity
    { path: ['diagnostics', 'severity', 'undefinedMacro'], value: 'error' },
    { path: ['diagnostics', 'severity', 'undefinedVariable'], value: 'warning' },
    { path: ['diagnostics', 'severity', 'styleWarnings'], value: 'error' },
    { path: ['diagnostics', 'severity', 'malformedOperator'], value: 'error' },
    { path: ['diagnostics', 'severity', 'spacedCompoundOperator'], value: 'warning' },
    {
        path: ['diagnostics', 'severity', 'invalidOperatorSequence'],
        value: 'warning',
    },
    {
        path: ['diagnostics', 'severity', 'cStyleLogicalInControlFlow'],
        value: 'error',
    },
    {
        path: ['diagnostics', 'severity', 'mixedLogicalOperators'],
        value: 'error',
    },

    // formatting
    { path: ['formatting', 'indentSize'], value: 2 },
    { path: ['formatting', 'indentStyle'], value: 'tabs' },
    { path: ['formatting', 'lineWidth'], value: 100 },
    { path: ['formatting', 'preferredCommentStyle'], value: '*' },
    { path: ['formatting', 'normalizeCommentStyle'], value: true },
    { path: ['formatting', 'commentLineWidth'], value: 88 },
    { path: ['formatting', 'mode'], value: 'ast' },
    { path: ['formatting', 'preserveAlignment'], value: false },

    // completion
    { path: ['completion', 'cacheSize'], value: 50 },
    { path: ['completion', 'prefixMaxItems'], value: 25 },

    // indexing
    { path: ['indexing', 'maxFileSizeBytes'], value: 12345 },

    // crossFile
    { path: ['crossFile', 'indexWorkspace'], value: false },
    { path: ['crossFile', 'maxIndexedFiles'], value: 17 },
    { path: ['crossFile', 'assumeCallSite'], value: 'start' },
    { path: ['crossFile', 'backwardDependencies'], value: 'explicit' },
    { path: ['crossFile', 'maxBackwardDepth'], value: 3 },
    { path: ['crossFile', 'maxForwardDepth'], value: 4 },
    { path: ['crossFile', 'maxChainDepth'], value: 5 },
    { path: ['crossFile', 'maxCalleeRevalidations'], value: 6 },

    // crossFile.diagnostics
    { path: ['crossFile', 'diagnostics', 'missingFile'], value: 'error' },
    { path: ['crossFile', 'diagnostics', 'maxDepth'], value: 'off' },
    {
        path: ['crossFile', 'diagnostics', 'callSiteIdentification'],
        value: 'off',
    },
];

describe('public config camelCase/snake_case alias guarantee', () => {
    for (const my_setting of PUBLIC_SETTINGS) {
        const dotted = my_setting.path.join('.');
        it(`accepts both spellings for ${dotted}`, () => {
            const camel = resolve_public_settings(
                build_nested(my_setting.path, my_setting.value)
            );
            const snake = resolve_public_settings(
                build_nested_snake(my_setting.path, my_setting.value)
            );

            // Neither spelling produces warnings (both are first-class).
            expect(camel.warnings).toEqual([]);
            expect(snake.warnings).toEqual([]);

            // Both spellings produce identical effective settings.
            expect(snake.config).toEqual(camel.config);

            // And the value actually took effect (differs from a no-op config).
            const baseline = resolve_public_settings({});
            expect(camel.config).not.toEqual(baseline.config);
        });
    }

    it('produces no warnings for a full sight tree with client-only keys', () => {
        // A full `sight` settings tree pushed via getConfiguration carries
        // client-only sections (sendToStata, dataBrowser, depthColors,
        // personalAdoDir). The mapper must recognize-and-ignore them rather
        // than warn, so the live VS Code path stays quiet.
        const { warnings } = resolve_public_settings({
            crossFile: { maxChainDepth: 7 },
            formatting: { preserveAlignment: false },
            sendToStata: { saveBeforeSend: true, workingDirectory: 'lsp' },
            dataBrowser: { maxStoredLayouts: 5, persistSort: true },
            depthColors: { enabled: true },
            personalAdoDir: '/home/user/ado',
        });
        expect(warnings).toEqual([]);
    });

    it('still warns on a genuinely unknown top-level key', () => {
        const { warnings } = resolve_public_settings({
            notARealSetting: true,
        });
        expect(warnings.join('\n')).toContain('notARealSetting');
    });

    it('resolves a mixed camelCase/snake_case tree identically', () => {
        // A user mixing both conventions in one config must get the same
        // result as either pure-convention spelling.
        const mixed = resolve_public_settings({
            crossFile: { max_chain_depth: 5, maxForwardDepth: 4 },
            formatting: { preserve_alignment: false, indentSize: 2 },
            diagnostics: { severity: { undefined_macro: 'error' } },
        });
        const camel = resolve_public_settings({
            crossFile: { maxChainDepth: 5, maxForwardDepth: 4 },
            formatting: { preserveAlignment: false, indentSize: 2 },
            diagnostics: { severity: { undefinedMacro: 'error' } },
        });
        expect(mixed.warnings).toEqual([]);
        expect(mixed.config).toEqual(camel.config);
    });
});

import { describe, expect, it } from 'bun:test';
import { load_toml_str } from '../../../src/config-file';

describe('load_toml_str', () => {
    it('parses sight.toml into a partial internal config', () => {
        const loaded = load_toml_str(
            `
debug = true

[crossFile]
maxChainDepth = 7
backwardDependencies = "AUTO"

[crossFile.diagnostics]
missingFile = "Info"
`,
            'test sight.toml'
        );

        expect(loaded.kind).toBe('loaded');
        if (loaded.kind === 'loaded') {
            expect(loaded.partial_config.debug).toBe(true);
            expect(loaded.partial_config.cross_file?.max_chain_depth).toBe(7);
            expect(loaded.partial_config.cross_file?.backward_dependencies).toBe('auto');
            expect(loaded.partial_config.cross_file?.diagnostics?.missing_file).toBe('information');
        }
    });

    it('returns load-failed for malformed TOML', () => {
        const loaded = load_toml_str('not = = toml', 'bad sight.toml');

        expect(loaded.kind).toBe('load-failed');
        if (loaded.kind === 'load-failed') {
            expect(loaded.error).toContain('bad sight.toml');
        }
    });
});

import { describe, expect, it } from 'bun:test';
import { deep_merge_config } from '../../../src/config-file';

describe('deep_merge_config', () => {
    it('merges objects recursively with project values winning at leaves', () => {
        const client = {
            formatting: { lineWidth: 100, indentSize: 2 },
            diagnostics: { indentation: false },
        };
        const project = {
            formatting: { indentSize: 4 },
        };

        expect(deep_merge_config(client, project)).toEqual({
            formatting: { lineWidth: 100, indentSize: 4 },
            diagnostics: { indentation: false },
        });
    });

    it('replaces arrays wholesale', () => {
        const client = { adoPaths: ['/client'] };
        const project = { adoPaths: ['/project', '/shared'] };

        expect(deep_merge_config(client, project)).toEqual({
            adoPaths: ['/project', '/shared'],
        });
    });

    it('returns a clone when project config is absent', () => {
        const client = { debug: true };
        const merged = deep_merge_config(client, undefined);

        expect(merged).toEqual(client);
        expect(merged).not.toBe(client);
    });
});

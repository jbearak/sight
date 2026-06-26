import { describe, it, expect } from 'bun:test';
import { resolve_path_rich } from '../../src/utils/file-path-utils';

// In-memory fs: map of dir -> entries (name + isFile)
// Each key is a directory path; value is an array of [name, isFile] pairs.
// existsSync answers true for directory paths (keys) and for file paths
// (dir + '/' + name where isFile is true).
function make_fs(tree: Record<string, Array<[string, boolean]>>) {
    const the_dir_set = new Set(Object.keys(tree));
    const the_file_set = new Set<string>();
    for (const [my_dir, my_entries] of Object.entries(tree)) {
        for (const [my_name, my_is_file] of my_entries) {
            if (my_is_file) {
                the_file_set.add(`${my_dir}/${my_name}`);
            }
        }
    }
    return {
        existsSync: (p: string) =>
            the_dir_set.has(p) || the_file_set.has(p),
        readdirSync: (
            p: string,
            _opts: { withFileTypes: true },
        ) =>
            (tree[p] ?? []).map(([my_name, my_is_file]) => ({
                name: my_name,
                isFile: () => my_is_file,
                isDirectory: () => !my_is_file,
            })),
    };
}

describe('resolve_path_rich', () => {
    const roots = ['/ws'];

    it('exact match', () => {
        const fs = make_fs({ '/ws': [['Clean.do', true]] });
        expect(
            resolve_path_rich('/ws/Clean.do', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({ kind: 'exact', path: '/ws/Clean.do' });
    });

    it('unique case-only with .do fallback', () => {
        const fs = make_fs({ '/ws': [['Clean.do', true]] });
        const out = resolve_path_rich('/ws/clean', {
            workspace_roots: roots,
            fs,
        });
        expect(out.kind).toBe('case_only');
        if (out.kind === 'case_only') {
            expect(out.path).toBe('/ws/Clean.do');
        }
    });

    it('ambiguous (2+ ci matches)', () => {
        const fs = make_fs({
            '/ws': [
                ['Clean.do', true],
                ['CLEAN.do', true],
            ],
        });
        expect(
            resolve_path_rich('/ws/clean.do', {
                workspace_roots: roots,
                fs,
            }).kind,
        ).toBe('ambiguous');
    });

    it('missing', () => {
        const fs = make_fs({ '/ws': [['other.do', true]] });
        expect(
            resolve_path_rich('/ws/clean.do', {
                workspace_roots: roots,
                fs,
            }).kind,
        ).toBe('missing');
    });

    it('multi-component directory case-only', () => {
        const fs = make_fs({
            '/ws': [['Helpers', false]],
            '/ws/Helpers': [['clean.do', true]],
        });
        const out = resolve_path_rich('/ws/helpers/clean.do', {
            workspace_roots: roots,
            fs,
        });
        expect(out.kind).toBe('case_only');
        if (out.kind === 'case_only') {
            expect(out.path).toBe('/ws/Helpers/clean.do');
        }
    });

    it('exact-before-case: exact sibling wins', () => {
        const fs = make_fs({
            '/ws': [
                ['clean.do', true],
                ['Clean.do', true],
            ],
        });
        expect(
            resolve_path_rich('/ws/clean.do', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({ kind: 'exact', path: '/ws/clean.do' });
    });

    it('ASCII-only: non-ASCII not folded', () => {
        const fs = make_fs({ '/ws': [['café.do', true]] });
        // requested differs by a non-ASCII letter case -> not folded -> missing
        expect(
            resolve_path_rich('/ws/cafÉ.do', {
                workspace_roots: roots,
                fs,
            }).kind,
        ).toBe('missing');
    });

    it('directory named like leaf does not beat unique .do file', () => {
        const fs = make_fs({
            '/ws': [
                ['clean', false],
                ['Clean.do', true],
            ],
        });
        const out = resolve_path_rich('/ws/clean', {
            workspace_roots: roots,
            fs,
        });
        expect(out.kind).toBe('case_only');
        if (out.kind === 'case_only') {
            expect(out.path).toBe('/ws/Clean.do');
        }
    });

    it('outside workspace roots: no case handling', () => {
        const fs = make_fs({ '/other': [['Clean.do', true]] });
        expect(
            resolve_path_rich('/other/clean.do', {
                workspace_roots: roots,
                fs,
            }).kind,
        ).toBe('missing');
    });
});

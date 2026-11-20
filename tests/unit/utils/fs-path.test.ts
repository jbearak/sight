/**
 * Canonical Windows path form (upper-case drive letter, native `\`
 * separators) and drive-letter-insensitive root containment.
 *
 * Every test passes the platform explicitly, so the Windows rules run
 * on every CI host rather than only on Windows.
 */

import { describe, expect, it } from 'bun:test';
import {
    canonical_fs_path,
    is_path_within_root,
    slashed_comparison_path,
    uri_to_fs_path,
} from '../../../src/utils/fs-path';
import {
    build_cd_timeline,
    case_mismatch_display_paths,
    case_only_matched_directory,
    resolve_forward_call_rich,
    resolve_path_rich,
    type RichResolveFs,
} from '../../../src/utils/file-path-utils';
import { get_workspace_root_for_path } from '../../../src/utils/workspace-roots';
import type { CdCommand } from '../../../src/types';

/**
 * In-memory filesystem. Map keys are directories, spelled with `sep`
 * (the case-only walk hands the filesystem native paths: `\` on
 * win32, `/` elsewhere); entries are `[name, is_file]`. `probed`
 * records every path the filesystem was asked about.
 */
function make_fs(
    tree: Record<string, Array<[string, boolean]>>,
    sep: '/' | '\\' = '/',
    probed: string[] = [],
): RichResolveFs {
    const the_kinds = new Map<string, boolean>();
    for (const [my_dir, my_entries] of Object.entries(tree)) {
        for (const [my_name, my_is_file] of my_entries) {
            the_kinds.set(`${my_dir}${sep}${my_name}`, my_is_file);
        }
    }
    const fs = make_tree_fs(tree, the_kinds);
    return {
        existsSync: p => (probed.push(p), fs.existsSync(p)),
        readdirSync: (p, opts) => (probed.push(p), fs.readdirSync(p, opts)),
        statSync: p => (probed.push(p), fs.statSync(p)),
    };
}

function make_tree_fs(
    tree: Record<string, Array<[string, boolean]>>,
    the_kinds: Map<string, boolean>,
): RichResolveFs {
    return {
        existsSync: (p: string) => p in tree || the_kinds.get(p) === true,
        readdirSync: (p: string) =>
            (tree[p] ?? []).map(([my_name, my_is_file]) => ({
                name: my_name,
                isFile: () => my_is_file,
                isDirectory: () => !my_is_file,
                isSymbolicLink: () => false,
            })),
        statSync: (p: string) => {
            const my_is_file = the_kinds.get(p);
            if (my_is_file === undefined && !(p in tree)) {
                throw new Error(`ENOENT: ${p}`);
            }
            return {
                isFile: () => my_is_file === true,
                isDirectory: () => my_is_file !== true,
            };
        },
    };
}

const WINDOWS_TREE = {
    'C:\\ws': [['helpers', false], ['Raw', false], ['main.do', true]],
    'C:\\ws\\helpers': [['Clean.do', true]],
    'C:\\ws\\Raw': [],
} satisfies Record<string, Array<[string, boolean]>>;

describe('canonical_fs_path', () => {
    it('upper-cases the drive letter and uses backslashes on win32', () => {
        expect(canonical_fs_path('c:/Proj/a.do', 'win32'))
            .toBe('C:\\Proj\\a.do');
        expect(canonical_fs_path('c:\\Proj\\a.do', 'win32'))
            .toBe('C:\\Proj\\a.do');
        expect(canonical_fs_path('C:\\Proj\\a.do', 'win32'))
            .toBe('C:\\Proj\\a.do');
    });

    it('keeps the case of the rest of the path on win32', () => {
        expect(canonical_fs_path('d:\\Data\\RAW\\x.do', 'win32'))
            .toBe('D:\\Data\\RAW\\x.do');
    });

    it('leaves UNC and drive-less paths alone apart from separators', () => {
        expect(canonical_fs_path('//server/share/a.do', 'win32'))
            .toBe('\\\\server\\share\\a.do');
        expect(canonical_fs_path('\\ws\\a.do', 'win32')).toBe('\\ws\\a.do');
    });

    it('is the identity on posix', () => {
        expect(canonical_fs_path('/Users/me/a.do', 'linux'))
            .toBe('/Users/me/a.do');
        expect(canonical_fs_path('c:/x', 'darwin')).toBe('c:/x');
    });
});

describe('uri_to_fs_path', () => {
    it('gives the canonical form for a VS Code drive URI on win32', () => {
        // VS Code sends `file:///c%3A/...`; Node clients send
        // `file:///C:/...`. Both name the same file.
        expect(uri_to_fs_path('file:///c%3A/Proj/a.do', 'win32'))
            .toBe('C:\\Proj\\a.do');
        expect(uri_to_fs_path('file:///C:/Proj/a.do', 'win32'))
            .toBe('C:\\Proj\\a.do');
    });

    it('gives a UNC path for a URI with an authority on win32', () => {
        expect(uri_to_fs_path('file://server/share/a.do', 'win32'))
            .toBe('\\\\server\\share\\a.do');
    });

    it('decodes the path on posix', () => {
        expect(uri_to_fs_path('file:///Users/me/my%20dir/a.do', 'linux'))
            .toBe('/Users/me/my dir/a.do');
    });
});

describe('slashed_comparison_path', () => {
    it('folds only the drive letter on win32', () => {
        expect(slashed_comparison_path('c:\\Proj\\a.do', 'win32'))
            .toBe('C:/Proj/a.do');
    });

    it('keeps the drive letter as written on posix', () => {
        expect(slashed_comparison_path('c:\\Proj', 'linux')).toBe('c:/Proj');
    });
});

describe('is_path_within_root', () => {
    it('ignores the case of the drive letter on win32', () => {
        expect(is_path_within_root('c:\\proj\\a.do', 'C:\\proj', 'win32'))
            .toBe(true);
        expect(is_path_within_root('C:\\proj\\a.do', 'c:\\proj', 'win32'))
            .toBe(true);
        expect(is_path_within_root('c:\\proj', 'C:\\proj', 'win32'))
            .toBe(true);
    });

    it('compares the rest of the path exactly on win32', () => {
        expect(is_path_within_root('C:\\Proj\\a.do', 'C:\\proj', 'win32'))
            .toBe(false);
        expect(is_path_within_root('C:\\project\\a.do', 'C:\\proj', 'win32'))
            .toBe(false);
    });

    it('accepts a drive root on win32', () => {
        expect(is_path_within_root('c:\\x\\a.do', 'C:\\', 'win32'))
            .toBe(true);
    });

    it('compares exactly on posix', () => {
        expect(is_path_within_root('/ws/a.do', '/ws', 'linux')).toBe(true);
        expect(is_path_within_root('/WS/a.do', '/ws', 'linux')).toBe(false);
        expect(is_path_within_root('/a.do', '/', 'linux')).toBe(true);
    });
});

describe('get_workspace_root_for_path on win32', () => {
    it('picks the root whose drive letter differs only in case', () => {
        const the_roots = ['C:\\ws\\a', 'C:\\ws\\b'];
        expect(get_workspace_root_for_path(the_roots, 'c:\\ws\\b\\x.do', 'win32'))
            .toBe('C:\\ws\\b');
    });

    it('returns roots in canonical form', () => {
        const the_roots = ['c:\\ws\\a', 'c:/ws/b'];
        expect(get_workspace_root_for_path(the_roots, 'C:\\ws\\b\\x.do', 'win32'))
            .toBe('C:\\ws\\b');
        expect(get_workspace_root_for_path(the_roots, 'D:\\other\\x.do', 'win32'))
            .toBe('C:\\ws\\a');
    });
});

describe('resolve_path_rich on win32', () => {
    const fs = make_fs(WINDOWS_TREE, '\\');

    it('finds a lower-case-drive path inside an upper-case-drive root', () => {
        const my_outcome = resolve_path_rich('c:\\ws\\helpers\\Clean.do', {
            workspace_roots: ['C:\\ws'],
            fs,
            platform: 'win32',
        });
        // The drive letter's case is not a case-only mismatch.
        expect(my_outcome).toEqual({
            kind: 'exact',
            path: 'C:\\ws\\helpers\\Clean.do',
        });
    });

    it('finds an upper-case-drive path inside a lower-case-drive root', () => {
        const my_outcome = resolve_path_rich('C:\\ws\\helpers\\clean', {
            workspace_roots: ['c:\\ws'],
            fs,
            platform: 'win32',
        });
        expect(my_outcome).toEqual({
            kind: 'case_only',
            path: 'C:\\ws\\helpers\\Clean.do',
            requested: 'C:\\ws\\helpers\\clean',
        });
    });

    it('still reports a case-only mismatch below the root', () => {
        const my_outcome = resolve_path_rich('c:\\ws\\HELPERS\\clean.do', {
            workspace_roots: ['C:\\ws'],
            fs,
            platform: 'win32',
        });
        expect(my_outcome.kind).toBe('case_only');
        expect(my_outcome).toMatchObject({
            path: 'C:\\ws\\helpers\\Clean.do',
        });
    });

    it('returns native separators for a path outside every root', () => {
        const my_outcome = resolve_path_rich('c:/ws/main.do', {
            workspace_roots: ['D:\\elsewhere'],
            fs,
            platform: 'win32',
        });
        expect(my_outcome).toEqual({ kind: 'exact', path: 'C:\\ws\\main.do' });
    });

    it('hands the filesystem canonical native paths', () => {
        const the_probed: string[] = [];
        resolve_path_rich('c:/ws/helpers/clean', {
            workspace_roots: ['c:\\ws'],
            fs: make_fs(WINDOWS_TREE, '\\', the_probed),
            platform: 'win32',
        });
        expect(the_probed.length).toBeGreaterThan(0);
        expect(the_probed.filter(my_path =>
            !my_path.startsWith('C:\\') || my_path.includes('/'),
        )).toEqual([]);
    });

    it('keeps "/" in resolved paths on posix', () => {
        const my_posix_fs = make_fs({
            '/ws': [['helpers', false]],
            '/ws/helpers': [['Clean.do', true]],
        });
        expect(resolve_path_rich('/ws/helpers/clean', {
            workspace_roots: ['/ws'],
            fs: my_posix_fs,
            platform: 'linux',
        })).toEqual({
            kind: 'case_only',
            path: '/ws/helpers/Clean.do',
            requested: '/ws/helpers/clean',
        });
    });
});

describe('resolve_forward_call_rich on win32', () => {
    const fs = make_fs(WINDOWS_TREE, '\\');

    it('resolves a case-only relative call from a URI-derived caller dir', () => {
        // Before canonical paths, the caller directory came from
        // vscode-uri as `c:\ws` while the root came from Node as `C:\ws`.
        const my_outcome = resolve_forward_call_rich(
            'helpers/clean',
            'c:\\ws',
            undefined,
            { workspace_roots: ['C:\\ws'], fs, platform: 'win32' },
        );
        expect(my_outcome).toEqual({
            kind: 'case_only',
            path: 'C:\\ws\\helpers\\Clean.do',
            requested: 'c:\\ws\\helpers\\clean',
        });
    });

    it('resolves an absolute path typed with a lower-case drive', () => {
        const my_outcome = resolve_forward_call_rich(
            'c:\\ws\\helpers\\Clean.do',
            'C:\\ws',
            undefined,
            { workspace_roots: ['C:\\ws'], fs, platform: 'win32' },
        );
        expect(my_outcome).toEqual({
            kind: 'exact',
            path: 'C:\\ws\\helpers\\Clean.do',
        });
    });

    it('uses the workspace-root tier for a caller below the root', () => {
        const my_nested_fs = make_fs({
            ...WINDOWS_TREE,
            'C:\\ws': [...WINDOWS_TREE['C:\\ws'], ['sub', false]],
            'C:\\ws\\sub': [['a.do', true]],
        }, '\\');
        const my_outcome = resolve_forward_call_rich(
            'helpers/clean',
            'c:\\ws\\sub',
            undefined,
            { workspace_roots: ['C:\\ws'], fs: my_nested_fs, platform: 'win32' },
        );
        expect(my_outcome.kind).toBe('case_only');
        expect(my_outcome).toMatchObject({
            path: 'C:\\ws\\helpers\\Clean.do',
        });
    });
});

describe('case-mismatch helpers on win32', () => {
    it('does not treat a drive-letter difference as a directory match', () => {
        expect(case_only_matched_directory({
            path: 'C:\\ws\\helpers\\Clean.do',
            requested: 'c:\\ws\\helpers\\clean',
        }, 'win32')).toBe(false);
        expect(case_only_matched_directory({
            path: 'C:\\ws\\helpers\\Clean.do',
            requested: 'c:\\ws\\HELPERS\\clean',
        }, 'win32')).toBe(true);
    });

    it('pairs the as-written path with the on-disk spelling', () => {
        expect(case_mismatch_display_paths(
            'helpers/clean',
            {
                path: 'C:\\ws\\helpers\\Clean.do',
                requested: 'c:\\ws\\helpers\\clean',
            },
            'C:\\ws',
            'win32',
        )).toEqual({ requested: 'helpers/clean', on_disk: 'helpers/Clean.do' });
    });
});

describe('build_cd_timeline on win32', () => {
    const cd = (raw_path: string, line: number): CdCommand => ({
        raw_path,
        range: {
            start: { line, character: 0 },
            end: { line, character: 3 + raw_path.length },
        },
        is_static: true,
    });

    it('gives working directories in canonical form', () => {
        const my_result = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: 'c:\\ws',
            cd_commands: [cd('raw', 0)],
            workspace_roots: ['C:\\ws'],
            fs: make_fs(WINDOWS_TREE, '\\'),
            platform: 'win32',
        });
        expect(my_result.timeline.entries.map(my_entry => my_entry.wd))
            .toEqual(['C:\\ws\\Raw']);
        expect(my_result.diagnostics.map(my_diag => my_diag.kind))
            .toEqual(['path_case_mismatch']);
    });

    it('accepts a trailing separator on an existing directory', () => {
        const my_result = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: 'c:\\ws',
            cd_commands: [cd('c:/ws/Raw/', 0)],
            workspace_roots: ['C:\\ws'],
            fs: make_fs(WINDOWS_TREE, '\\'),
            platform: 'win32',
        });
        expect(my_result.diagnostics).toEqual([]);
    });
});

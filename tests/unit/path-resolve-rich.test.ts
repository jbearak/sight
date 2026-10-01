import { describe, it, expect } from 'bun:test';
import {
    case_mismatch_display_paths,
    resolve_path_rich,
    resolve_forward_call_rich,
} from '../../src/utils/file-path-utils';

// ─── In-memory filesystem helpers ────────────────────────────────────────────

/**
 * Entry descriptor for `make_fs`.
 *
 * Tuple: [name, kind]
 *   kind = true        → regular file
 *   kind = false       → regular directory
 *   kind = 'link-dir'  → symlink whose target is a directory
 *   kind = 'link-file' → symlink whose target is a file
 *   kind = 'link-dead' → dangling symlink (statSync throws)
 */
type FsEntry = [
    string,
    boolean | 'link-dir' | 'link-file' | 'link-dead',
];

/**
 * Build an injected filesystem from a tree descriptor.
 *
 * Map keys are directory paths; values are arrays of entry descriptors.
 * existsSync is true for directory keys and for regular/symlink-file paths.
 * statSync follows a symlink to its target kind; throws for dangling links.
 */
function make_fs(tree: Record<string, Array<FsEntry>>) {
    const the_dir_set = new Set(Object.keys(tree));
    const the_file_set = new Set<string>();
    // Map from full path → kind, for statSync resolution
    const the_kind_map = new Map<
        string,
        boolean | 'link-dir' | 'link-file' | 'link-dead'
    >();
    for (const [my_dir, my_entries] of Object.entries(tree)) {
        for (const [my_name, my_kind] of my_entries) {
            const my_full = `${my_dir}/${my_name}`;
            the_kind_map.set(my_full, my_kind);
            // Treat as file for existsSync when it's a regular file or a
            // symlink to a file (not dead and not dir-targeted).
            if (
                my_kind === true ||
                my_kind === 'link-file'
            ) {
                the_file_set.add(my_full);
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
            (tree[p] ?? []).map(([my_name, my_kind]) => ({
                name: my_name,
                isFile:         () => my_kind === true,
                isDirectory:    () => my_kind === false,
                isSymbolicLink: () =>
                    my_kind === 'link-dir' ||
                    my_kind === 'link-file' ||
                    my_kind === 'link-dead',
            })),
        statSync: (p: string): { isFile(): boolean; isDirectory(): boolean } => {
            const my_kind = the_kind_map.get(p);
            if (my_kind === 'link-dead' || my_kind === undefined) {
                // Dangling symlink or unknown path → throw like real statSync
                throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
            }
            const my_is_file   = my_kind === true || my_kind === 'link-file';
            const my_is_dir    = my_kind === false || my_kind === 'link-dir';
            return {
                isFile:      () => my_is_file,
                isDirectory: () => my_is_dir,
            };
        },
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

    it('outside workspace roots: .do fallback applied (F4)', () => {
        // Roots supplied but path is outside them; the .do fallback should
        // still apply for plain-existence semantics.
        const the_file_set = new Set(['/other/script.do']);
        const the_dir_set = new Set(['/other']);
        const fs = {
            existsSync: (p: string) =>
                the_file_set.has(p) || the_dir_set.has(p),
            readdirSync: (_p: string, _opts: { withFileTypes: true }) => [],
        };
        const out = resolve_path_rich('/other/script', {
            workspace_roots: roots,
            fs,
        });
        expect(out.kind).toBe('exact');
        if (out.kind === 'exact') {
            expect(out.path).toBe('/other/script.do');
        }
    });

    it('no workspace_roots: plain existence — exact if file present', () => {
        // No roots supplied → plain-existence semantics (no directory scan).
        // The requested path exists exactly → exact.
        const fs = make_fs({ '/ws': [['clean.do', true]] });
        const out = resolve_path_rich('/ws/clean.do', { fs });
        expect(out.kind).toBe('exact');
        if (out.kind === 'exact') {
            expect(out.path).toBe('/ws/clean.do');
        }
    });

    it('no workspace_roots: plain existence — missing when absent', () => {
        const fs = make_fs({ '/ws': [['other.do', true]] });
        expect(resolve_path_rich('/ws/clean.do', { fs }).kind).toBe('missing');
    });

    it('no workspace_roots: .do fallback applied (plain existence)', () => {
        // existsSync returns true only for the .do-suffixed path
        const the_file_set = new Set(['/ws/Clean.do']);
        const the_dir_set = new Set(['/ws']);
        const fs = {
            existsSync: (p: string) =>
                the_file_set.has(p) || the_dir_set.has(p),
            readdirSync: (_p: string, _opts: { withFileTypes: true }) => [],
        };
        const out = resolve_path_rich('/ws/Clean', { fs });
        // No case scanning; the .do path exists exactly → exact
        expect(out.kind).toBe('exact');
        if (out.kind === 'exact') {
            expect(out.path).toBe('/ws/Clean.do');
        }
    });

    it('workspace_roots supplied: case-only resolution still works', () => {
        // When a root is passed, case-insensitive scanning applies.
        const fs = make_fs({ '/ws': [['Clean.do', true]] });
        const out = resolve_path_rich('/ws/clean', {
            workspace_roots: ['/ws'],
            fs,
        });
        expect(out.kind).toBe('case_only');
        if (out.kind === 'case_only') {
            expect(out.path).toBe('/ws/Clean.do');
        }
    });

    // ── Symlink tests (CodeRabbit #216 regression) ────────────────────────

    it('symlinked directory component is traversed (intermediate match)', () => {
        // /ws/helpers → symlink to a directory containing clean.do
        const fs = make_fs({
            '/ws':          [['helpers', 'link-dir']],
            '/ws/helpers':  [['clean.do', true]],
        });
        const out = resolve_path_rich('/ws/helpers/clean.do', {
            workspace_roots: ['/ws'],
            fs,
        });
        expect(out.kind).toBe('exact');
        if (out.kind === 'exact') {
            expect(out.path).toBe('/ws/helpers/clean.do');
        }
    });

    it('symlinked .do file is matched at the final component (exact)', () => {
        // /ws/clean.do is a symlink to a file
        const fs = make_fs({
            '/ws': [['clean.do', 'link-file']],
        });
        const out = resolve_path_rich('/ws/clean.do', {
            workspace_roots: ['/ws'],
            fs,
        });
        expect(out.kind).toBe('exact');
        if (out.kind === 'exact') {
            expect(out.path).toBe('/ws/clean.do');
        }
    });

    it('symlinked file matched via .do fallback at the final component', () => {
        // Requested without extension; /ws/Clean.do is a symlink to a file
        const fs = make_fs({
            '/ws': [['Clean.do', 'link-file']],
        });
        const out = resolve_path_rich('/ws/clean', {
            workspace_roots: ['/ws'],
            fs,
        });
        // The symlinked .do file should resolve as case_only (name mismatch)
        expect(out.kind).toBe('case_only');
        if (out.kind === 'case_only') {
            expect(out.path).toBe('/ws/Clean.do');
        }
    });

    it('symlinked file with case-only name difference resolves case_only', () => {
        // /ws/Clean.do is a symlink; request uses lowercase → case_only
        const fs = make_fs({
            '/ws': [['Clean.do', 'link-file']],
        });
        const out = resolve_path_rich('/ws/clean.do', {
            workspace_roots: ['/ws'],
            fs,
        });
        expect(out.kind).toBe('case_only');
        if (out.kind === 'case_only') {
            expect(out.path).toBe('/ws/Clean.do');
        }
    });

    it('dangling symlink does NOT match and does not throw', () => {
        // /ws/dead.do is a dangling symlink; should resolve to missing
        const fs = make_fs({
            '/ws': [
                ['dead.do', 'link-dead'],
                ['other.do', true],
            ],
        });
        const out = resolve_path_rich('/ws/dead.do', {
            workspace_roots: ['/ws'],
            fs,
        });
        expect(out.kind).toBe('missing');
    });

    it('dangling symlink directory does NOT crash intermediate traversal', () => {
        // /ws/helpers is a dangling dir symlink; traversal must not throw
        const fs = make_fs({
            '/ws': [['helpers', 'link-dead']],
        });
        const out = resolve_path_rich('/ws/helpers/clean.do', {
            workspace_roots: ['/ws'],
            fs,
        });
        // helpers/ not resolved as a directory → missing
        expect(out.kind).toBe('missing');
    });

    // ── Case-variant sibling directories ──────────────────────────────────
    //
    // On a case-sensitive filesystem a checkout can hold two directories
    // whose names differ only in case (e.g. `Scripts/` and `scripts/`).
    // On the author's case-insensitive machine they are one directory, so
    // a path that misses under the exact-cased directory must still find
    // the file under its case-variant sibling.

    it('exact directory misses: file found under case-variant sibling', () => {
        const fs = make_fs({
            '/ws': [['scripts', false], ['Scripts', false]],
            '/ws/scripts': [['tables', false]],
            '/ws/scripts/tables': [['figure.do', true]],
            '/ws/Scripts': [['tables', false]],
            '/ws/Scripts/tables': [['export.do', true]],
        });
        expect(
            resolve_path_rich('/ws/scripts/tables/export.do', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({
            kind: 'case_only',
            path: '/ws/Scripts/tables/export.do',
            requested: '/ws/scripts/tables/export.do',
        });
    });

    it('case-variant sibling resolution applies the .do fallback', () => {
        const fs = make_fs({
            '/ws': [['scripts', false], ['Scripts', false]],
            '/ws/scripts': [],
            '/ws/Scripts': [['clean.do', true]],
        });
        expect(
            resolve_path_rich('/ws/scripts/clean', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({
            kind: 'case_only',
            path: '/ws/Scripts/clean.do',
            requested: '/ws/scripts/clean',
        });
    });

    it('exact directory wins when it holds the file', () => {
        const fs = make_fs({
            '/ws': [['scripts', false], ['Scripts', false]],
            '/ws/scripts': [['clean.do', true]],
            '/ws/Scripts': [['clean.do', true]],
        });
        expect(
            resolve_path_rich('/ws/scripts/clean.do', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({ kind: 'exact', path: '/ws/scripts/clean.do' });
    });

    it('exact directory with a case-only leaf wins over siblings', () => {
        const fs = make_fs({
            '/ws': [['scripts', false], ['Scripts', false]],
            '/ws/scripts': [['Clean.do', true]],
            '/ws/Scripts': [['clean.do', true]],
        });
        expect(
            resolve_path_rich('/ws/scripts/clean.do', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({
            kind: 'case_only',
            path: '/ws/scripts/Clean.do',
            requested: '/ws/scripts/clean.do',
        });
    });

    it('two case-variant siblings both holding the file: ambiguous', () => {
        const fs = make_fs({
            '/ws': [
                ['scripts', false],
                ['Scripts', false],
                ['SCRIPTS', false],
            ],
            '/ws/scripts': [],
            '/ws/Scripts': [['clean.do', true]],
            '/ws/SCRIPTS': [['clean.do', true]],
        });
        const out = resolve_path_rich('/ws/scripts/clean.do', {
            workspace_roots: roots,
            fs,
        });
        expect(out.kind).toBe('ambiguous');
        if (out.kind === 'ambiguous') {
            expect(out.matches).toEqual([
                '/ws/Scripts/clean.do',
                '/ws/SCRIPTS/clean.do',
            ]);
        }
    });

    it('no exact directory, one of two case variants holds the file', () => {
        // Neither directory matches exactly, but only one holds the
        // file, so the author's intended target is unique.
        const fs = make_fs({
            '/ws': [['Scripts', false], ['SCRIPTS', false]],
            '/ws/Scripts': [['other.do', true]],
            '/ws/SCRIPTS': [['clean.do', true]],
        });
        expect(
            resolve_path_rich('/ws/scripts/clean.do', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({
            kind: 'case_only',
            path: '/ws/SCRIPTS/clean.do',
            requested: '/ws/scripts/clean.do',
        });
    });

    it('no exact directory, no case variant holds the file: missing', () => {
        const fs = make_fs({
            '/ws': [['Scripts', false], ['SCRIPTS', false]],
            '/ws/Scripts': [['other.do', true]],
            '/ws/SCRIPTS': [],
        });
        expect(
            resolve_path_rich('/ws/scripts/clean.do', {
                workspace_roots: roots,
                fs,
            }).kind,
        ).toBe('missing');
    });

    it('backtracks at a deeper component', () => {
        // The exact `scripts/tables` exists but lacks the file; the
        // case-variant `scripts/Tables` holds it.
        const fs = make_fs({
            '/ws': [['scripts', false]],
            '/ws/scripts': [['tables', false], ['Tables', false]],
            '/ws/scripts/tables': [],
            '/ws/scripts/Tables': [['clean.do', true]],
        });
        expect(
            resolve_path_rich('/ws/scripts/tables/clean.do', {
                workspace_roots: roots,
                fs,
            }),
        ).toEqual({
            kind: 'case_only',
            path: '/ws/scripts/Tables/clean.do',
            requested: '/ws/scripts/tables/clean.do',
        });
    });

    it('reports the as-written paths probed under every visited directory', () => {
        // `scripts/` and the empty `SCRIPTS/` both miss; a file created
        // at either probed path would change the outcome (exact, or
        // ambiguous), so a closure cache must treat both as dependents.
        const fs = make_fs({
            '/ws': [
                ['scripts', false],
                ['Scripts', false],
                ['SCRIPTS', false],
            ],
            '/ws/scripts': [],
            '/ws/Scripts': [['clean.do', true]],
            '/ws/SCRIPTS': [],
        });
        const the_missed: string[] = [];
        const out = resolve_path_rich('/ws/scripts/clean.do', {
            workspace_roots: roots,
            fs,
            missed_probes: the_missed,
        });
        expect(out.kind).toBe('case_only');
        expect(the_missed.sort()).toEqual([
            '/ws/SCRIPTS/clean.do',
            '/ws/scripts/clean.do',
        ]);
    });

    it('reports the as-written remainder when a directory is absent', () => {
        // `SCRIPTS/` exists but lacks `tables/`; creating
        // `SCRIPTS/tables/clean` (or its .do form) would add a match.
        const fs = make_fs({
            '/ws': [['Scripts', false], ['SCRIPTS', false]],
            '/ws/Scripts': [['tables', false]],
            '/ws/Scripts/tables': [['clean.do', true]],
            '/ws/SCRIPTS': [],
        });
        const the_missed: string[] = [];
        const out = resolve_path_rich('/ws/scripts/tables/clean', {
            workspace_roots: roots,
            fs,
            missed_probes: the_missed,
        });
        expect(out).toEqual({
            kind: 'case_only',
            path: '/ws/Scripts/tables/clean.do',
            requested: '/ws/scripts/tables/clean',
        });
        expect(the_missed.sort()).toEqual([
            '/ws/SCRIPTS/tables/clean',
            '/ws/SCRIPTS/tables/clean.do',
            '/ws/Scripts/tables/clean',
            '/ws/scripts/tables/clean',
            '/ws/scripts/tables/clean.do',
        ]);
    });

    it('reports nothing for an exact hit', () => {
        const fs = make_fs({
            '/ws': [['scripts', false], ['Scripts', false]],
            '/ws/scripts': [['clean.do', true]],
            '/ws/Scripts': [],
        });
        const the_missed: string[] = [];
        resolve_path_rich('/ws/scripts/clean.do', {
            workspace_roots: roots,
            fs,
            missed_probes: the_missed,
        });
        expect(the_missed).toEqual([]);
    });

    it('directory target found under a case-variant sibling', () => {
        const fs = make_fs({
            '/ws': [['scripts', false], ['Scripts', false]],
            '/ws/scripts': [['data', false]],
            '/ws/Scripts': [['tables', false]],
            '/ws/Scripts/tables': [],
        });
        expect(
            resolve_path_rich('/ws/scripts/tables', {
                workspace_roots: roots,
                target_kind: 'directory',
                fs,
            }),
        ).toEqual({
            kind: 'case_only',
            path: '/ws/Scripts/tables',
            requested: '/ws/scripts/tables',
        });
    });
});

describe('resolve_forward_call_rich', () => {
    // RB1: script-relative miss falls back to workspace-root-relative hit.
    // Scenario: no WD, caller is in /ws/sub, raw_path is helpers/setup.
    // /ws/sub/helpers/setup.do does NOT exist (script-relative miss).
    // /ws/helpers/setup.do DOES exist (workspace-root-relative hit).
    it('no-WD script-relative miss falls back to workspace-root-relative hit', () => {
        const the_fs = make_fs({
            '/ws':          [['sub', false], ['helpers', false]],
            '/ws/sub':      [], // no helpers/ here — script-relative misses
            '/ws/helpers':  [['setup.do', true]], // workspace-root hit
        });

        const my_outcome = resolve_forward_call_rich(
            'helpers/setup',
            '/ws/sub',      // caller_dir
            undefined,      // no working_directory
            {
                workspace_roots: ['/ws'],
                fs: the_fs,
            },
        );

        // Should resolve to the workspace-root-relative path (exact match).
        expect(my_outcome.kind).toBe('exact');
        expect((my_outcome as { kind: 'exact'; path: string }).path).toBe(
            '/ws/helpers/setup.do',
        );
    });

    // Scenario: WD-join produces AMBIGUOUS, script-relative is clean.
    // The function MUST stay ambiguous — it must NOT fall back to the
    // clean script-relative path.
    it('ambiguous WD-join does NOT fall back to clean script-relative path', () => {
        // Filesystem: WD=/wd, caller dir=/ws, raw_path=helpers/clean
        // /wd/helpers/ has two case-insensitive matches → ambiguous WD-join.
        // /ws/helpers/ has a single exact match → script-relative would succeed.
        const the_fs = make_fs({
            '/wd':          [['helpers', false]],
            '/wd/helpers':  [['Clean.do', true], ['CLEAN.do', true]], // ambiguous
            '/ws':          [['helpers', false]],
            '/ws/helpers':  [['clean.do', true]], // would succeed as script-relative
        });

        const my_outcome = resolve_forward_call_rich(
            'helpers/clean',
            '/ws',              // caller_dir
            '/wd',              // working_directory → WD-join is /wd/helpers/clean
            {
                workspace_roots: ['/ws', '/wd'],
                fs: the_fs,
            },
        );

        // Must remain ambiguous — the clean script-relative fallback must NOT
        // fire when the primary outcome is `ambiguous`.
        expect(my_outcome.kind).toBe('ambiguous');
    });

    // RC1: caller OUTSIDE all workspace_roots must NOT get a tier-3
    // workspace-root-relative candidate. A file that exists under
    // workspace_roots[0] but NOT relative to the outside caller must
    // resolve to MISSING, not a spurious hit.
    it('caller outside all workspace_roots: no tier-3 candidate added', () => {
        // Filesystem layout:
        //   /ws/helpers/setup.do  — exists under the workspace root
        //   /outside              — caller dir, NOT inside /ws
        //
        // Before the fix, tier-3 used get_workspace_root_for_path which
        // falls back to workspace_roots[0] (/ws) and would wrongly add
        // /ws/helpers/setup as a candidate, producing an exact hit.
        // After the fix, find_strict_containing_root returns null for
        // /outside → tier-3 is skipped → only the script-relative
        // candidate /outside/helpers/setup is tried → MISSING.
        const the_fs = make_fs({
            '/ws':             [['helpers', false]],
            '/ws/helpers':     [['setup.do', true]],
            '/outside':        [], // no helpers/ here — script-relative misses
        });

        const my_outcome = resolve_forward_call_rich(
            'helpers/setup',
            '/outside',         // caller_dir — outside /ws
            undefined,          // no working_directory
            {
                workspace_roots: ['/ws'],
                fs: the_fs,
            },
        );

        // Tier-3 must NOT fire; the only candidate (/outside/helpers/setup)
        // is MISSING.
        expect(my_outcome.kind).toBe('missing');
    });
});

describe('case_mismatch_display_paths', () => {
    it('pairs the as-written path with the same on-disk components', () => {
        // Resolved against the workspace root from a nested caller: the
        // display must not be re-based onto the caller's directory.
        expect(
            case_mismatch_display_paths(
                'scripts/tables/export.do',
                {
                    requested: '/ws/scripts/tables/export.do',
                    path: '/ws/Scripts/tables/export.do',
                },
                '/ws/scripts/tables',
            ),
        ).toEqual({
            requested: 'scripts/tables/export.do',
            on_disk: 'Scripts/tables/export.do',
        });
    });

    it('shows the .do the fallback added', () => {
        expect(
            case_mismatch_display_paths(
                'helpers\\clean',
                {
                    requested: '/ws/helpers/clean',
                    path: '/ws/Helpers/clean.do',
                },
                '/ws',
            ),
        ).toEqual({ requested: 'helpers/clean', on_disk: 'Helpers/clean.do' });
    });

    it('falls back when the mismatch is in the resolution base', () => {
        // A miscased working directory (`Data` vs on-disk `data`) with a
        // correctly cased raw path: pairing the raw suffix would print
        // the same spelling twice and hide the discrepancy.
        expect(
            case_mismatch_display_paths(
                'clean.do',
                {
                    requested: '/ws/Data/clean.do',
                    path: '/ws/data/clean.do',
                },
                '/ws',
            ),
        ).toEqual({
            requested: 'Data/clean.do',
            on_disk: 'data/clean.do',
        });
    });

    it('falls back to display-dir-relative paths for dot segments', () => {
        expect(
            case_mismatch_display_paths(
                '../helpers/clean.do',
                {
                    requested: '/ws/helpers/clean.do',
                    path: '/ws/Helpers/clean.do',
                },
                '/ws/sub',
            ),
        ).toEqual({
            requested: '../helpers/clean.do',
            on_disk: '../Helpers/clean.do',
        });
    });

    it('falls back to display-dir-relative paths for absolute paths', () => {
        expect(
            case_mismatch_display_paths(
                '/ws/helpers/clean.do',
                {
                    requested: '/ws/helpers/clean.do',
                    path: '/ws/Helpers/clean.do',
                },
                '/ws',
            ),
        ).toEqual({
            requested: 'helpers/clean.do',
            on_disk: 'Helpers/clean.do',
        });
    });
});

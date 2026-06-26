import { describe, it, expect } from 'bun:test';
import {
    resolve_path_rich,
    resolve_forward_call_rich,
} from '../../src/utils/file-path-utils';

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

import { describe, it, expect } from 'bun:test';
import {
    resolve_path_rich,
    build_cd_timeline,
    wd_for_position,
    apply_cd_timeline,
} from '../../src/utils/file-path-utils';
import type { CdCommand, ForwardCall } from '../../src/types';

// ─── In-memory filesystem helper (mirrors path-resolve-rich.test.ts) ──────────

type FsEntry = [string, boolean | 'link-dir' | 'link-file' | 'link-dead'];

function make_fs(tree: Record<string, Array<FsEntry>>) {
    const the_dir_set = new Set(Object.keys(tree));
    const the_file_set = new Set<string>();
    const the_kind_map = new Map<string, FsEntry[1]>();
    for (const [my_dir, my_entries] of Object.entries(tree)) {
        for (const [my_name, my_kind] of my_entries) {
            const my_full = `${my_dir}/${my_name}`;
            the_kind_map.set(my_full, my_kind);
            if (my_kind === true || my_kind === 'link-file') {
                the_file_set.add(my_full);
            }
        }
    }
    return {
        existsSync: (p: string) => the_dir_set.has(p) || the_file_set.has(p),
        readdirSync: (p: string, _opts: { withFileTypes: true }) =>
            (tree[p] ?? []).map(([my_name, my_kind]) => ({
                name: my_name,
                isFile: () => my_kind === true,
                isDirectory: () => my_kind === false,
                isSymbolicLink: () =>
                    my_kind === 'link-dir' ||
                    my_kind === 'link-file' ||
                    my_kind === 'link-dead',
            })),
        statSync: (p: string): { isFile(): boolean; isDirectory(): boolean } => {
            const my_kind = the_kind_map.get(p);
            if (my_kind === 'link-dead' || my_kind === undefined) {
                throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
            }
            const my_is_file = my_kind === true || my_kind === 'link-file';
            const my_is_dir = my_kind === false || my_kind === 'link-dir';
            return { isFile: () => my_is_file, isDirectory: () => my_is_dir };
        },
    };
}

const cd = (raw_path: string, line: number, character = 0, is_static = true): CdCommand => ({
    raw_path,
    range: {
        start: { line, character },
        end: { line, character: character + 2 + raw_path.length },
    },
    is_static,
});

const fwd = (raw_path: string, line: number, character = 0): ForwardCall => ({
    type: 'do',
    raw_path,
    call_site_line: line,
    range: { start: { line, character }, end: { line, character: character + 3 + raw_path.length } },
    source: 'command',
    is_static: true,
    caller_uri: 'file:///ws/main.do',
});

// ─── resolve_path_rich directory mode ─────────────────────────────────────────

describe('resolve_path_rich target_kind: directory', () => {
    const roots = ['/ws'];

    it('matches a directory leaf exactly (no .do fallback)', () => {
        const fs = make_fs({ '/ws': [['raw', false]] });
        expect(
            resolve_path_rich('/ws/raw', { workspace_roots: roots, fs, target_kind: 'directory' }),
        ).toEqual({ kind: 'exact', path: '/ws/raw' });
    });

    it('does NOT match a FILE leaf in directory mode', () => {
        const fs = make_fs({ '/ws': [['raw', true]] });
        expect(
            resolve_path_rich('/ws/raw', { workspace_roots: roots, fs, target_kind: 'directory' }),
        ).toEqual({ kind: 'missing', requested: '/ws/raw' });
    });

    it('case-only directory match', () => {
        const fs = make_fs({ '/ws': [['Raw', false]] });
        expect(
            resolve_path_rich('/ws/raw', { workspace_roots: roots, fs, target_kind: 'directory' }),
        ).toEqual({ kind: 'case_only', path: '/ws/Raw', requested: '/ws/raw' });
    });

    it('ambiguous when two case variants exist', () => {
        const fs = make_fs({ '/ws': [['Raw', false], ['raw', false]] });
        const outcome = resolve_path_rich('/ws/RAW', { workspace_roots: roots, fs, target_kind: 'directory' });
        expect(outcome.kind).toBe('ambiguous');
    });

    it('outside workspace roots: requires isDirectory (a file is not a dir)', () => {
        const fs = make_fs({ '/elsewhere': [['data', true]] });
        // No workspace roots → plain-existence branch; a FILE must not satisfy a directory target.
        expect(
            resolve_path_rich('/elsewhere/data', { fs, target_kind: 'directory' }),
        ).toEqual({ kind: 'missing', requested: '/elsewhere/data' });
    });

    it('outside workspace roots: a real directory resolves exact', () => {
        const fs = make_fs({ '/elsewhere': [['data', false]], '/elsewhere/data': [] });
        expect(
            resolve_path_rich('/elsewhere/data', { fs, target_kind: 'directory' }),
        ).toEqual({ kind: 'exact', path: '/elsewhere/data' });
    });
});

// ─── build_cd_timeline + wd_for_position ──────────────────────────────────────

describe('build_cd_timeline', () => {
    const roots = ['/ws'];

    it('resolves two sequential cd targets relative to the running WD', () => {
        const fs = make_fs({
            '/ws': [['raw', false], ['analysis', false]],
            '/ws/raw': [],
            '/ws/analysis': [],
        });
        const { timeline, diagnostics } = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: '/ws',
            cd_commands: [cd('raw', 0), cd('../analysis', 2)],
            workspace_roots: roots,
            fs,
        });
        expect(diagnostics).toEqual([]);
        // Before any cd → starting (script-relative / undefined)
        expect(wd_for_position(timeline, { line: 0, character: 0 })).toBeUndefined();
        // After `cd raw` → /ws/raw
        expect(wd_for_position(timeline, { line: 1, character: 0 })).toBe('/ws/raw');
        // After `cd ../analysis` (joined against /ws/raw) → /ws/analysis
        expect(wd_for_position(timeline, { line: 3, character: 0 })).toBe('/ws/analysis');
    });

    it('uses the REAL on-disk casing for the WD (kills the cascade)', () => {
        const fs = make_fs({ '/ws': [['Raw', false]], '/ws/Raw': [] });
        const { timeline, diagnostics } = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: '/ws',
            cd_commands: [cd('raw', 0)],
            workspace_roots: roots,
            fs,
        });
        // WD is the real-cased path, so later calls resolve exact (no cascade).
        expect(wd_for_position(timeline, { line: 1, character: 0 })).toBe('/ws/Raw');
        // One case-mismatch diagnostic on the cd line.
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.kind).toBe('path_case_mismatch');
        expect(diagnostics[0]!.range.start.line).toBe(0);
    });

    it('missing cd target → warning, WD becomes the joined intent path', () => {
        const fs = make_fs({ '/ws': [] });
        const { timeline, diagnostics } = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: '/ws',
            cd_commands: [cd('out', 0)],
            workspace_roots: roots,
            fs,
        });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.kind).toBe('missing_directory');
        expect(diagnostics[0]!.severity).toBe('warning');
        // WD preserves the author's intent for later relative calls.
        expect(wd_for_position(timeline, { line: 1, character: 0 })).toBe('/ws/out');
    });

    it('ambiguous cd → warning, WD UNCHANGED (does not poison later calls)', () => {
        // Two case variants of the target exist under the active WD.
        const fs = make_fs({
            '/ws': [['start', false]],
            '/ws/start': [['Out', false], ['out', false]],
            '/ws/start/Out': [],
            '/ws/start/out': [],
        });
        const { timeline, diagnostics } = build_cd_timeline({
            starting_wd: '/ws/start',
            caller_dir: '/ws',
            cd_commands: [cd('OUT', 0)],
            workspace_roots: roots,
            fs,
        });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.kind).toBe('missing_directory');
        // WD stays at the starting value — ambiguous never poisons.
        expect(wd_for_position(timeline, { line: 1, character: 0 })).toBe('/ws/start');
    });

    it('resolves cd ONLY against the current WD (no script-relative fallback)', () => {
        // `raw/` exists beside the script, but the active WD is `base`, where
        // `raw` does NOT exist. Stata would fail `cd raw` here; we must report
        // missing — never silently snap to the script-relative `raw/`.
        const fs = make_fs({
            '/ws': [['raw', false], ['base', false]],
            '/ws/raw': [],
            '/ws/base': [],
        });
        const { timeline, diagnostics } = build_cd_timeline({
            starting_wd: '/ws/base',
            caller_dir: '/ws',
            cd_commands: [cd('raw', 0)],
            workspace_roots: roots,
            fs,
        });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.kind).toBe('missing_directory');
        // WD becomes the intended (missing) base/raw, NOT the script-relative /ws/raw.
        expect(wd_for_position(timeline, { line: 1, character: 0 })).toBe('/ws/base/raw');
    });

    it('ignores non-static cd commands (dynamic paths never poison)', () => {
        const fs = make_fs({ '/ws': [['raw', false]], '/ws/raw': [] });
        const { timeline, diagnostics } = build_cd_timeline({
            starting_wd: '/ws/base',
            caller_dir: '/ws',
            cd_commands: [cd('`dir\'', 0, 0, /* is_static */ false)],
            workspace_roots: roots,
            fs,
        });
        expect(diagnostics).toEqual([]);
        expect(wd_for_position(timeline, { line: 1, character: 0 })).toBe('/ws/base');
    });
});

// ─── wd_for_position same-line position ordering (defensive) ──────────────────
// Ordering is by full (line, character) position, so it stays correct even if a
// cd and a call were to share a line. (Note: under `#delimit ;` the parser does
// not currently produce cd commands — see detect_cd_command — so these synthetic
// positions exercise the ordering function directly, not end-to-end `;` parsing.)

describe('wd_for_position same-line position ordering', () => {
    const roots = ['/ws'];
    const fs = make_fs({ '/ws': [['a', false]], '/ws/a': [] });

    it('a call AFTER a same-line cd sees the new WD', () => {
        const { timeline } = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: '/ws',
            cd_commands: [cd('a', 5, /* character */ 0)],
            workspace_roots: roots,
            fs,
        });
        // `cd a` at (5,0); `do x` at (5,6) → after the cd.
        expect(wd_for_position(timeline, { line: 5, character: 6 })).toBe('/ws/a');
    });

    it('a call BEFORE a same-line cd keeps the prior WD', () => {
        const { timeline } = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: '/ws',
            cd_commands: [cd('a', 5, /* character */ 8)],
            workspace_roots: roots,
            fs,
        });
        // `do x` at (5,0); `cd a` at (5,8) → call is before the cd.
        expect(wd_for_position(timeline, { line: 5, character: 0 })).toBeUndefined();
    });
});

// ─── apply_cd_timeline ────────────────────────────────────────────────────────

describe('apply_cd_timeline', () => {
    const roots = ['/ws'];
    const fs = make_fs({
        '/ws': [['raw', false], ['analysis', false]],
        '/ws/raw': [],
        '/ws/analysis': [],
    });

    it('re-stamps command calls per the timeline; leaves directive calls alone', () => {
        const { timeline } = build_cd_timeline({
            starting_wd: undefined,
            caller_dir: '/ws',
            // `cd raw` (script-relative → /ws/raw), then `cd ../analysis`
            // (relative to /ws/raw → /ws/analysis).
            cd_commands: [cd('raw', 0), cd('../analysis', 2)],
            workspace_roots: roots,
            fs,
        });
        const directive_call: ForwardCall = {
            ...fwd('helper', 5),
            source: 'directive',
            working_directory: '/ws/fixed',
        };
        const calls: ForwardCall[] = [fwd('import', 1), fwd('clean', 3), directive_call];
        const restamped = apply_cd_timeline(calls, timeline);
        expect(restamped[0]!.working_directory).toBe('/ws/raw');      // after cd raw
        expect(restamped[1]!.working_directory).toBe('/ws/analysis'); // after cd analysis
        expect(restamped[2]!.working_directory).toBe('/ws/fixed');    // directive untouched
    });
});

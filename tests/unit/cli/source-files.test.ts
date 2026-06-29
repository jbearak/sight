import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiagnosticSeverity } from 'vscode-languageserver';
import {
    collect_report_targets,
    read_source_file,
    size_limit_diagnostic,
} from '../../../src/cli/source-files';
import { hasStataExtension } from '../../../src/utils/file-path-utils';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-source-'));
}

describe('sight check source files', () => {
    it('recognizes Stata source extensions case-insensitively', () => {
        expect(hasStataExtension('/x/a.do')).toBe(true);
        expect(hasStataExtension('/x/a.DO')).toBe(true);
        expect(hasStataExtension('/x/a.ado')).toBe(true);
        expect(hasStataExtension('/x/a.doh')).toBe(true);
        expect(hasStataExtension('/x/a.mata')).toBe(true);
        expect(hasStataExtension('/x/a.txt')).toBe(false);
    });

    it('collects supported source files from directories and skips VCS dirs', () => {
        const root = temp_dir();
        fs.mkdirSync(path.join(root, 'analysis'));
        fs.mkdirSync(path.join(root, '.git'));
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'analysis', 'helper.ADO'), 'program x\nend\n');
        fs.writeFileSync(path.join(root, '.git', 'ignored.do'), 'bad\n');
        fs.writeFileSync(path.join(root, 'notes.txt'), 'ignored\n');

        const result = collect_report_targets([], root, root);

        expect(result.operator_errors).toEqual([]);
        expect(result.targets.map((target) => target.relative_path)).toEqual([
            'analysis/helper.ADO',
            'main.do',
        ]);
    });

    it('resolves explicit paths from cwd and reports missing paths as operator errors', () => {
        const root = temp_dir();
        const cwd = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');

        const result = collect_report_targets(
            [path.relative(cwd, path.join(root, 'main.do')), 'missing.do'],
            root,
            cwd
        );

        expect(result.targets.map((target) => target.path)).toEqual([
            fs.realpathSync.native(path.join(root, 'main.do')),
        ]);
        expect(result.operator_errors).toHaveLength(1);
        expect(result.operator_errors[0]).toContain('missing.do');
    });

    it('ignores explicit existing non-source files', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'notes.txt'), 'ignored\n');

        const result = collect_report_targets(['notes.txt'], root, root);

        expect(result.targets).toEqual([]);
        expect(result.operator_errors).toEqual([]);
    });

    it('skips excluded directories when walking, honoring explicit files', () => {
        const root = temp_dir();
        fs.mkdirSync(path.join(root, 'output'));
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(path.join(root, 'src', 'main.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'output', 'gen.do'), 'display 2\n');

        // Default walk excludes output/**.
        const walked = collect_report_targets([], root, root, ['output/**']);
        expect(walked.operator_errors).toEqual([]);
        expect(walked.targets.map((t) => t.relative_path)).toEqual(['src/main.do']);

        // An explicitly-named file under an excluded path is still checked.
        const explicit = collect_report_targets(
            ['output/gen.do'],
            root,
            root,
            ['output/**']
        );
        expect(explicit.targets.map((t) => t.relative_path)).toEqual([
            'output/gen.do',
        ]);
    });

    it('excludes individual files matching a glob during a walk', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'keep.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'build.gen.do'), 'display 2\n');

        const result = collect_report_targets([], root, root, ['**/*.gen.do']);
        expect(result.targets.map((t) => t.relative_path)).toEqual(['keep.do']);
    });

    it('turns oversize explicit targets into error diagnostics', () => {
        const diagnostic = size_limit_diagnostic(11, 10);

        expect(diagnostic.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostic.range.start).toEqual({ line: 0, character: 0 });
        expect(diagnostic.message).toContain('exceeds');
        expect(diagnostic.message).toContain('10 bytes');
        // The message must not embed an absolute path (machine-specific, breaks
        // golden comparisons); the renderer shows the relative location.
        expect(diagnostic.message).not.toContain('/');
    });

    it('reads UTF-8 and reports invalid UTF-8 as a diagnostic input error', () => {
        const root = temp_dir();
        const good = path.join(root, 'good.do');
        const bad = path.join(root, 'bad.do');
        fs.writeFileSync(good, 'display 1\n');
        fs.writeFileSync(bad, Buffer.from([0x64, 0x69, 0x80]));

        expect(read_source_file(good).kind).toBe('ok');
        const result = read_source_file(bad);

        expect(result.kind).toBe('decode-error');
        if (result.kind === 'decode-error') {
            expect(result.diagnostic.message).toContain('offset 2');
            expect(result.diagnostic.severity).toBe(DiagnosticSeverity.Error);
        }
    });

    it('reports the bad byte offset after valid multi-byte sequences', () => {
        const root = temp_dir();
        const bad = path.join(root, 'bad.do');
        // "d" + "é" (0xC3 0xA9) + lone continuation byte 0x80 at index 3.
        fs.writeFileSync(bad, Buffer.from([0x64, 0xC3, 0xA9, 0x80]));

        const result = read_source_file(bad);

        expect(result.kind).toBe('decode-error');
        if (result.kind === 'decode-error') {
            expect(result.diagnostic.message).toContain('offset 3');
        }
    });

    it('points at the START of a truncated multi-byte sequence', () => {
        const root = temp_dir();
        const bad = path.join(root, 'bad.do');
        // "a" then lead byte 0xC3 with no continuation byte (truncated at EOF).
        // The offset must be the lead byte (1), not the trailing byte.
        fs.writeFileSync(bad, Buffer.from([0x61, 0xC3]));

        const result = read_source_file(bad);

        expect(result.kind).toBe('decode-error');
        if (result.kind === 'decode-error') {
            expect(result.diagnostic.message).toContain('offset 1');
        }
    });

    it('points at the START of a sequence with an invalid continuation', () => {
        const root = temp_dir();
        const bad = path.join(root, 'bad.do');
        // 0xE2 expects two continuation bytes; 0x28 '(' is not one, so the bad
        // sequence begins at the lead byte (index 1), not at the 0x28.
        fs.writeFileSync(bad, Buffer.from([0x61, 0xE2, 0x28, 0xA1]));

        const result = read_source_file(bad);

        expect(result.kind).toBe('decode-error');
        if (result.kind === 'decode-error') {
            expect(result.diagnostic.message).toContain('offset 1');
        }
    });

    it('locates the bad byte offset in a large file without quadratic cost', () => {
        const root = temp_dir();
        const bad = path.join(root, 'big.do');
        // 500k valid ASCII bytes then one invalid byte: an O(n^2) scan would
        // stall here, so this doubles as a performance regression guard.
        const bytes = Buffer.concat([
            Buffer.alloc(500_000, 0x61),
            Buffer.from([0x80]),
        ]);
        fs.writeFileSync(bad, bytes);

        const result = read_source_file(bad);

        expect(result.kind).toBe('decode-error');
        if (result.kind === 'decode-error') {
            expect(result.diagnostic.message).toContain('offset 500000');
        }
    });
});

/**
 * `sight check` analyzes each discovered file under its own URI, and the
 * workspace index holds real files only. Opening a symlink-alias URI the index
 * never indexed gives unreliable cross-file scope and (past the index cap) a
 * spurious "file not indexed", so this walk — like the persistent indexer —
 * follows neither symlinked directories nor symlinked files (issue #219).
 * In-workspace symlink targets are covered via their real path;
 * symlink-following lives in the non-analyzing consumers.
 */
function try_symlink(target: string, link_path: string): boolean {
    try {
        fs.symlinkSync(target, link_path);
        return true;
    } catch {
        return false;
    }
}

describe('sight check analyzes real files only, not symlinks (#219)', () => {
    it('does NOT discover a symlinked source file', () => {
        // The real file is checked; the symlink alias is not a separate
        // target (analysis is path-keyed; analyzing the alias URI would
        // mismatch the dep-graph / index).
        const root = temp_dir();
        const real = path.join(root, 'real.do');
        fs.writeFileSync(real, 'display 1\n');
        if (!try_symlink(real, path.join(root, 'aliased.do'))) return;

        const result = collect_report_targets([], root, root);
        const rels = result.targets.map((my_target) => my_target.relative_path);
        expect(rels).toContain('real.do');
        expect(rels).not.toContain('aliased.do');
    });

    it('does NOT discover a symlinked source file with an external target', () => {
        // An external-target symlink is not checked; declare the external
        // location as a workspace folder to check it directly.
        const root = temp_dir();
        const external = temp_dir();
        const target = path.join(external, 'lib.do');
        fs.writeFileSync(target, 'display 1\n');
        if (!try_symlink(target, path.join(root, 'lib.do'))) return;

        const result = collect_report_targets([], root, root);
        const rels = result.targets.map((my_target) => my_target.relative_path);
        expect(rels).not.toContain('lib.do');
    });

    it('does not discover a symlinked non-source file', () => {
        const root = temp_dir();
        const real = path.join(root, 'notes.txt');
        fs.writeFileSync(real, 'not stata\n');
        if (!try_symlink(real, path.join(root, 'aliased.txt'))) return;
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');

        const result = collect_report_targets([], root, root);
        const rels = result.targets.map((my_target) => my_target.relative_path);
        expect(rels).toContain('main.do');
        expect(rels.some((my_rel) => my_rel.endsWith('.txt'))).toBe(false);
    });

    it('discovers a symlinked-dir target via its real in-workspace location', () => {
        const root = temp_dir();
        const real_dir = path.join(root, 'realdir');
        fs.mkdirSync(real_dir);
        fs.writeFileSync(path.join(real_dir, 'inner.do'), 'display 1\n');
        if (!try_symlink(real_dir, path.join(root, 'linkdir'))) return;

        const result = collect_report_targets([], root, root);
        // linkdir is not descended; realdir/inner.do is found by the direct
        // scan — discovered exactly once, under its real path.
        const inner = result.targets.filter((my_target) =>
            my_target.relative_path.endsWith('inner.do'),
        );
        expect(inner).toHaveLength(1);
        expect(inner[0]!.relative_path).toBe('realdir/inner.do');
        expect(result.operator_errors).toEqual([]);
    });

    it('does not recurse through a directory symlink (cycle would not hang)', () => {
        const root = temp_dir();
        const sub = path.join(root, 'sub');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');
        if (!try_symlink(root, path.join(sub, 'loop'))) return;

        // Completes (loop not descended); main.do discovered exactly once.
        const result = collect_report_targets([], root, root);
        const mains = result.targets.filter((my_target) =>
            my_target.relative_path.endsWith('main.do'),
        );
        expect(mains).toHaveLength(1);
    });

    it('does NOT descend a symlinked directory pointing outside the scan root', () => {
        const root = temp_dir();
        const external = temp_dir();
        fs.writeFileSync(path.join(root, 'inside.do'), 'display 1\n');
        fs.writeFileSync(path.join(external, 'outside.do'), 'display 1\n');
        if (!try_symlink(external, path.join(root, 'external_link'))) return;

        const result = collect_report_targets([], root, root);
        const rels = result.targets.map((my_target) => my_target.relative_path);
        expect(rels).toContain('inside.do');
        expect(rels.some((my_rel) => my_rel.endsWith('outside.do')))
            .toBe(false);
    });
});

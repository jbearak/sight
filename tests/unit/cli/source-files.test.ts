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

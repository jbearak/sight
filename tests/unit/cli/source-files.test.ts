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
        const diagnostic = size_limit_diagnostic('/x/main.do', 11, 10);

        expect(diagnostic.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostic.range.start).toEqual({ line: 0, character: 0 });
        expect(diagnostic.message).toContain('exceeds');
        expect(diagnostic.message).toContain('10 bytes');
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
});

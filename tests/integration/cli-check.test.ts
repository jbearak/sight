import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    run_check_with_cwd,
} from '../../src/cli/check';
import {
    EXIT_CHECK_FAILED,
    EXIT_OK,
    EXIT_OPERATOR_ERROR,
} from '../../src/cli/shared';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-integration-'));
}

async function run_capture(argv: string[], cwd: string) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_check_with_cwd(argv, cwd, {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
    });
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

describe('sight check integration', () => {
    it('reports same-file undefined macro diagnostics', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('main.do:1:');
        expect(result.stdout).toContain('Undefined');
        expect(result.stdout).toContain('macro');
    });

    it('honors editor default undefinedVariable off', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), 'regress y x\n');

        const result = await run_capture(['--workspace', root, '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('uses strict max severity gating', async () => {
        const root = temp_dir();
        fs.writeFileSync(
            path.join(root, 'sight.toml'),
            '[diagnostics.severity]\nundefinedMacro = "information"\n'
        );
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--max-severity', 'info'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toContain('info:');
    });

    it('indexes whole workspace while report paths filter output', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'parent.do'), 'global project_root /tmp\ndo child.do\n');
        fs.writeFileSync(path.join(root, 'child.do'), 'display "$project_root"\n');

        const result = await run_capture(['--workspace', root, 'child.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('canonicalizes symlinked workspace and explicit target paths', async () => {
        const real_root = temp_dir();
        const link_root = `${real_root}-link`;
        fs.symlinkSync(real_root, link_root, 'dir');
        fs.writeFileSync(path.join(real_root, 'parent.do'), 'global project_root /tmp\ndo child.do\n');
        fs.writeFileSync(path.join(real_root, 'child.do'), 'display "$project_root"\n');

        const result = await run_capture(
            ['--workspace', link_root, path.join(real_root, 'child.do'), '--quiet'],
            real_root
        );

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('indexes uppercase source extensions for cross-file scope', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'parent.DO'), 'global project_root /tmp\ndo child.do\n');
        fs.writeFileSync(path.join(root, 'child.do'), 'display "$project_root"\n');

        const result = await run_capture(['--workspace', root, 'child.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('reports malformed config as operator error', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const result = await run_capture(['--workspace', root], root);

        expect(result.code).toBe(EXIT_OPERATOR_ERROR);
        expect(result.stderr).toContain('failed to load');
    });

    it('reports missing explicit path as operator error', async () => {
        const root = temp_dir();

        const result = await run_capture(['--workspace', root, 'missing.do'], root);

        expect(result.code).toBe(EXIT_OPERATOR_ERROR);
        expect(result.stderr).toContain('path does not exist');
    });

    it('reports unreadable report directories as operator errors', async () => {
        const root = temp_dir();
        const locked = path.join(root, 'locked');
        fs.mkdirSync(locked);
        fs.chmodSync(locked, 0);
        try {
            const result = await run_capture(['--workspace', root, 'locked'], root);

            expect(result.code).toBe(EXIT_OPERATOR_ERROR);
            expect(result.stderr).toContain('sight check:');
            expect(result.stderr).toContain('permission denied');
            expect(result.stderr).not.toContain(' at ');
        } finally {
            fs.chmodSync(locked, 0o700);
        }
    });

    it('reports explicitly oversized source files as error diagnostics', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[indexing]\nmaxFileSizeBytes = 1\n');
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');

        const result = await run_capture(['--workspace', root, 'main.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('exceeds the configured limit');
    });

    it('reports explicit source files skipped by max indexed files', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'b.do'), 'display 2\n');

        const result = await run_capture(
            ['--workspace', root, 'a.do', 'b.do', '--quiet'],
            root
        );

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('was not indexed');
        expect(result.stdout).toContain('maxIndexedFiles');
    });

    it('reports explicit .mata files skipped by max indexed files', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.mata'), '// a\n');
        fs.writeFileSync(path.join(root, 'b.mata'), '// b\n');

        const result = await run_capture(
            ['--workspace', root, 'a.mata', 'b.mata', '--quiet'],
            root
        );

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('was not indexed');
        expect(result.stdout).toContain('maxIndexedFiles');
    });

    it('diagnoses explicit outside-workspace files after max indexed files is reached', async () => {
        const root = temp_dir();
        const outside = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.do'), 'display 1\n');
        fs.writeFileSync(path.join(outside, 'b.do'), '}\n');

        const result = await run_capture(
            ['--workspace', root, path.join(outside, 'b.do'), '--quiet'],
            root
        );

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('unexpected closing brace');
        expect(result.stdout).not.toContain('maxIndexedFiles');
        expect(result.stdout).not.toContain('was not indexed');
    });

    it('reports invalid UTF-8 as an error diagnostic', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'bad.do'), Buffer.from([0x64, 0x80]));

        const result = await run_capture(['--workspace', root, 'bad.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('not valid UTF-8');
        expect(result.stdout).toContain('byte offset');
    });
});

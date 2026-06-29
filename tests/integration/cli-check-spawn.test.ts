import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { StataDiagnosticCode } from '../../src/types';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-spawn-'));
}

const repo_root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

describe('sight check spawned CLI', () => {
    it('routes sight check --help through the top-level CLI', () => {
        const result = spawnSync(
            'bun',
            ['src/cli.ts', 'check', '--help'],
            { cwd: repo_root, encoding: 'utf8' }
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('sight check');
        expect(result.stdout).toContain('--workspace DIR');
    });

    it('returns exit 1 for check diagnostics through the top-level CLI', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");
        const result = spawnSync(
            'bun',
            ['src/cli.ts', 'check', '--workspace', root, '--quiet'],
            { cwd: repo_root, encoding: 'utf8' }
        );

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(`[${StataDiagnosticCode.UNDEFINED_MACRO}]`);
    });

    it('returns exit 2 for an unknown flag (operator error)', () => {
        const result = spawnSync(
            'bun',
            ['src/cli.ts', 'check', '--bogus'],
            { cwd: repo_root, encoding: 'utf8' }
        );

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('Unknown flag: --bogus');
    });
});

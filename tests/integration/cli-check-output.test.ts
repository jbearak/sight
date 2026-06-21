import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-output-'));
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

describe('sight check machine output', () => {
    it('emits parseable JSON records', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--format', 'json'], root);
        const parsed = JSON.parse(result.stdout);

        expect(parsed[0].path).toBe('main.do');
        expect(parsed[0].diagnostic.source).toBe('sight');
    });

    it('emits SARIF 2.1.0 records', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--format', 'sarif'], root);
        const parsed = JSON.parse(result.stdout);

        expect(parsed.version).toBe('2.1.0');
        expect(parsed.runs[0].tool.driver.name).toBe('sight');
        expect(parsed.runs[0].results[0].ruleId).toMatch(/^SIGHT/);
    });
});

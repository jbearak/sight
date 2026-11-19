import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * A command that fails on one file still writes every record before it
 * exits, even to a pipe whose reader is slower than the CLI: exiting
 * with output still buffered cut it off at the pipe's 64 KiB.
 */

const REPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const BUNDLED_ENTRY = path.join(REPO_ROOT, 'dist', 'sight-server.js');
// How long the reader waits before reading anything.
const READER_DELAY_S = 1;

function make_inputs(): { big: string; missing: string } {
    const my_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-drain-'));
    const big = path.join(my_dir, 'big.do');
    const the_lines: string[] = [];
    for (let i = 0; i < 3000; i++) {
        the_lines.push(`generate double v${i} = ${i} * 2 if !missing(x)`);
    }
    fs.writeFileSync(big, the_lines.join('\n') + '\n');
    return { big, missing: path.join(my_dir, 'missing.do') };
}

/**
 * Run `command args` with stdout piped to a reader that waits before
 * it reads anything; the command's exit status and what the reader
 * got.
 */
function run_with_slow_reader(
    command: string,
    the_args: string[]
): { status: number | null; stdout: string } {
    const my_quoted = [command, ...the_args]
        .map(my_arg => `'${my_arg.replace(/'/g, `'\\''`)}'`)
        .join(' ');
    const my_script = `{ ${my_quoted} 2>/dev/null; echo $? >&2; } ` +
        `| { sleep ${READER_DELAY_S}; cat; }`;
    const my_result = spawnSync('sh', ['-c', my_script], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    return {
        status: Number.parseInt(my_result.stderr.trim(), 10),
        stdout: my_result.stdout,
    };
}

function expect_every_record(
    result: { status: number | null; stdout: string },
    inputs: { big: string; missing: string }
): void {
    expect(result.status).toBe(2);
    const the_records = result.stdout.trimEnd().split('\n')
        .map(my_line => JSON.parse(my_line));
    expect(the_records.map(my_record => my_record.path))
        .toEqual([inputs.big, inputs.missing]);
    expect(the_records[1].error).toBeDefined();
    // Large enough that the pipe alone can't hold it.
    expect(result.stdout.length).toBeGreaterThan(256 * 1024);
}

const describe_unix = describe.skipIf(process.platform === 'win32');

describe_unix('sight parse --json piped to a slow reader', () => {
    it('writes every record before exiting 2 (bun)', () => {
        const inputs = make_inputs();
        const result = run_with_slow_reader('bun', [
            'src/cli.ts', 'parse', '--json', inputs.big, inputs.missing,
        ]);
        expect_every_record(result, inputs);
    }, 30_000);

    it.skipIf(!fs.existsSync(BUNDLED_ENTRY))(
        'writes every record before exiting 2 (bundled, node)',
        () => {
            const inputs = make_inputs();
            const result = run_with_slow_reader('node', [
                BUNDLED_ENTRY, 'parse', '--json', inputs.big, inputs.missing,
            ]);
            expect_every_record(result, inputs);
        },
        30_000
    );
});

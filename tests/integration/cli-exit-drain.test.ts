import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
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
// How long the reader waits before reading anything: longer than the
// five seconds the CLI once waited before exiting regardless.
const READER_DELAY_S = 6;

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

    it('exits once its output is out, though stdin stays open', async () => {
        // Nothing but output may hold the exit back: a parent that
        // never closes our stdin must not keep the CLI running.
        const inputs = make_inputs();
        const my_child = spawn('bun', [
            'src/cli.ts', 'parse', '--json', inputs.missing,
        ], { cwd: REPO_ROOT, stdio: ['pipe', 'ignore', 'ignore'] });
        const my_timer = setTimeout(() => my_child.kill(), 15_000);
        const my_status = await new Promise<number | null>((resolve) => {
            my_child.on('exit', (code) => resolve(code));
        });
        clearTimeout(my_timer);
        my_child.stdin?.destroy();
        expect(my_status).toBe(2);
    }, 30_000);
});

/**
 * A reader that stops early (`| head -1`) closes the pipe while the
 * CLI is still writing. The CLI stops writing and exits with the code
 * its result gives, without printing an EPIPE error.
 */
function make_many_inputs(): string {
    const my_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-epipe-'));
    const the_lines: string[] = [];
    for (let i = 0; i < 400; i++) {
        the_lines.push(`display \`undefined_${i}'`);
    }
    // Large enough that the pipe cannot hold all of it.
    for (let i = 0; i < 100; i++) {
        the_lines.push(`do leaf.do argument_${i}`);
    }
    for (let i = 0; i < 40; i++) {
        fs.writeFileSync(path.join(my_dir, `f${i}.do`),
            the_lines.join('\n') + '\n');
    }
    fs.writeFileSync(path.join(my_dir, 'leaf.do'), 'args a\n');
    return my_dir;
}

function run_with_early_close(
    command: string,
    the_args: string[],
    cwd: string
): { status: number; stderr: string } {
    const my_quoted = [command, ...the_args]
        .map(my_arg => `'${my_arg.replace(/'/g, `'\\''`)}'`)
        .join(' ');
    const my_script = `${my_quoted} 2>err.txt | head -c 10 >/dev/null; ` +
        'echo "${PIPESTATUS[0]}"';
    const my_result = spawnSync('bash', ['-c', my_script], {
        cwd,
        encoding: 'utf8',
    });
    return {
        status: Number.parseInt(my_result.stdout.trim(), 10),
        stderr: fs.readFileSync(path.join(cwd, 'err.txt'), 'utf8'),
    };
}

describe_unix('sight commands piped to a reader that closes early', () => {
    const the_runtimes: Array<[string, string, boolean]> = [
        ['bun', path.join(REPO_ROOT, 'src/cli.ts'), true],
        ['node', BUNDLED_ENTRY, fs.existsSync(BUNDLED_ENTRY)],
    ];
    for (const [my_runtime, my_entry, my_available] of the_runtimes) {
        const the_commands: Array<[string, string[], number]> = [
            ['parse', ['parse', '--json', ...Array.from(
                { length: 40 }, (_, i) => `f${i}.do`)], 0],
            ['check', ['check', '--workspace', '.', '--no-config',
                '--format', 'json', '.'], 1],
            ['graph', ['graph', '--json', '.'], 0],
        ];
        for (const [my_name, the_args, my_status] of the_commands) {
            it.skipIf(!my_available)(
                `${my_name} exits ${my_status} quietly (${my_runtime})`,
                () => {
                    const my_dir = make_many_inputs();
                    try {
                        const result = run_with_early_close(
                            my_runtime, [my_entry, ...the_args], my_dir);
                        expect(result.stderr).not.toContain('EPIPE');
                        expect(result.stderr).toBe('');
                        expect(result.status).toBe(my_status);
                    } finally {
                        fs.rmSync(my_dir, { recursive: true, force: true });
                    }
                },
                30_000
            );
        }
    }
});

/**
 * Opt-in regression test for the integrated-terminal "first console
 * launch" fix.
 *
 * The fix bakes the first command into the Stata CLI launch arguments
 * (`shellArgs: [command, `"<path>"']`) so Stata runs it itself after
 * initialization, instead of typing it into the freshly-spawned REPL
 * where it races Stata's startup stdin flush and gets discarded.
 *
 * This test exercises the real external contract that the fix depends
 * on: that launching the actual Stata CLI with the command as launch
 * arguments actually runs the file (including when the path contains
 * spaces, which requires Stata's compound-quote form because Stata
 * joins launch argv with spaces and re-parses them as one command
 * line).
 *
 * It is SKIPPED unless SIGHT_REAL_STATA_CLI points at a Stata console
 * binary (e.g. /Applications/Stata/StataMP.app/Contents/MacOS/stata-mp
 * or `stata-mp` on PATH), so CI without Stata stays green. Run with:
 *
 *   SIGHT_REAL_STATA_CLI=/path/to/stata-mp bun test \
 *     tests/integration/send-to-stata-real-cli-launch.test.ts
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STATA_CLI = process.env.SIGHT_REAL_STATA_CLI;

/**
 * Mirrors wrap_path_for_stata_terminal in the terminal module. Kept
 * inline so this test does not import the manager (which imports the
 * 'vscode' module, unavailable outside the extension host).
 */
function wrap_path_for_stata(my_path: string): string {
    return '`"' + my_path + '"' + "'";
}

const the_temp_dirs: string[] = [];

function make_work_dir(): string {
    // Include a space to exercise the compound-quote launch-arg path.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight real cli '));
    the_temp_dirs.push(dir);
    return dir;
}

interface LaunchResult {
    exit_code: number | null;
}

function launch_stata_with_command(
    cli: string,
    command: string,
    runner_path: string,
    cwd: string
): Promise<LaunchResult> {
    return new Promise((resolve, reject) => {
        // Exactly the argv the terminal manager builds for shellArgs.
        const the_args = [command, wrap_path_for_stata(runner_path)];
        const child = spawn(cli, the_args, {
            cwd,
            // stdin closed: no REPL interaction, so the only way the
            // marker appears is the launch-arg command running. stdout/
            // stderr are ignored (not piped) -- we assert via the marker
            // file, and unread pipes could fill and block a chatty Stata.
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('Stata launch timed out.'));
        }, 30000);
        child.on('error', my_error => {
            clearTimeout(timeout);
            reject(my_error);
        });
        child.on('exit', my_code => {
            clearTimeout(timeout);
            resolve({ exit_code: my_code });
        });
    });
}

async function run_first_command(command: string): Promise<boolean> {
    const work_dir = make_work_dir();
    const marker_path = path.join(work_dir, 'marker.txt');
    // Space in the runner filename too, to stress quoting.
    const runner_path = path.join(work_dir, 'first command.do');
    const runner_source =
        `file open f using "${marker_path}", write replace\n` +
        `file write f "ran" _n\n` +
        `file close f\n`;
    fs.writeFileSync(runner_path, runner_source);

    await launch_stata_with_command(
        STATA_CLI as string,
        command,
        runner_path,
        work_dir
    );
    return fs.existsSync(marker_path);
}

const describe_real_cli = STATA_CLI ? describe : describe.skip;

describe_real_cli(
    'Feature: real Stata CLI runs the baked first command (opt-in)',
    () => {
        afterAll(() => {
            for (const my_dir of the_temp_dirs) {
                fs.rmSync(my_dir, { recursive: true, force: true });
            }
        });

        test('`do` as a launch argument runs the file', async () => {
            expect(await run_first_command('do')).toBe(true);
        });

        test('`include` as a launch argument runs the file', async () => {
            expect(await run_first_command('include')).toBe(true);
        });
    }
);

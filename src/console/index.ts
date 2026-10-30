/**
 * `sight console`: Stata's console with a better front end.
 *
 * This module is safe to load under Node: the PTY and session code
 * (Bun-only) load lazily, and only for an interactive terminal. With
 * stdin or stdout redirected, Stata runs directly with inherited stdio.
 */

import { spawn } from 'child_process';
import * as os from 'os';
import { CONSOLE_HELP, parse_console_args, type ConsoleArgs } from './args';
import { locate_stata } from './stata-locator';

export const EXIT_USAGE = 2;

export interface ConsoleDeps {
    is_tty?: boolean;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
}

export async function run_console(
    argv: readonly string[],
    deps: ConsoleDeps = {}
): Promise<number> {
    const parsed = parse_console_args(argv);
    if (!parsed.success) {
        console.error(`Error: ${parsed.error}`);
        console.error('Run "sight console --help" for usage information.');
        return EXIT_USAGE;
    }
    const { args } = parsed;
    if (args.help) {
        console.log(CONSOLE_HELP);
        return 0;
    }

    const platform = deps.platform ?? process.platform;
    const env = deps.env ?? process.env;
    if (platform === 'win32') {
        return run_windows_console(args, env, deps);
    }

    const located = locate_stata({ explicit_path: args.stata_path, env, platform });
    if (!located.found) {
        console.error(`Error: ${located.error}`);
        return EXIT_USAGE;
    }

    const is_tty = deps.is_tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!is_tty) {
        return run_passthrough(located.path, args.stata_args);
    }

    const { is_pty_supported } = await import('./pty');
    if (!is_pty_supported()) {
        console.error('Error: sight console needs the native sight binary or '
            + 'Bun 1.3.5 or later (run it with "bun"); this runtime has no '
            + 'pseudo-terminal support.');
        return EXIT_USAGE;
    }
    const color_output = env.NO_COLOR ? 'off' : args.color_output;
    const { run_interactive } = await import('./interactive');
    const { create_pty_handle } = await import('./pty-backend');
    return run_interactive({
        color_output,
        history: args.history,
        start_backend: (events, size) => create_pty_handle({
            stata_path: located.path,
            stata_args: args.stata_args,
            columns: size.columns,
            rows: size.rows,
            stata_echoes: args.stata_echoes,
        }, events),
    });
}

/**
 * Windows has no Stata console binary: drive the Stata application
 * through Automation (COM). Needs an interactive terminal; the PTY
 * check doesn't apply, so this also runs under Node.
 */
async function run_windows_console(
    args: ConsoleArgs,
    env: NodeJS.ProcessEnv,
    deps: ConsoleDeps
): Promise<number> {
    if (args.stata_path !== undefined) {
        console.error('Error: --stata isn\'t used on Windows: sight console drives the Stata '
            + 'registered for Automation. To switch editions, run that edition\'s exe with '
            + '/Register as administrator.');
        return EXIT_USAGE;
    }
    const is_tty = deps.is_tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!is_tty) {
        console.error('Error: on Windows, sight console needs an interactive terminal. To '
            + 'run a do-file without one, use Stata\'s batch mode: StataMP-64.exe /e do file.do');
        return EXIT_USAGE;
    }
    const { run_automation_console } = await import('./automation/run');
    return run_automation_console({
        color_output: env.NO_COLOR ? 'off' : args.color_output,
        history: args.history,
        yes: args.yes,
        env,
    });
}

/** Run Stata with this process's stdio; resolve with its exit status. */
export function run_passthrough(stata_path: string, stata_args: readonly string[]): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn(stata_path, [...stata_args], { stdio: 'inherit' });
        child.on('error', (error) => {
            console.error(`Error: could not start ${stata_path}: ${error.message}`);
            resolve(1);
        });
        child.on('exit', (code, signal) => {
            if (code !== null) {
                resolve(code);
                return;
            }
            const number = signal ? os.constants.signals[signal] : undefined;
            resolve(number === undefined ? 1 : 128 + number);
        });
    });
}

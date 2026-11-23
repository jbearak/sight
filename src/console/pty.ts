/**
 * Runs Stata in a pseudo-terminal using Bun's built-in PTY support
 * (`Bun.spawn({ terminal })`, Bun 1.3.5 and later).
 *
 * The source is compiled with Node typings too, so Bun's API is reached
 * through `globalThis` and checked at runtime rather than assumed.
 */

import { spawnSync } from 'child_process';
import * as os from 'os';

/** termios `c_lflag` bits we read or change, per platform. */
interface LocalFlagBits {
    echo: number;
    icanon: number;
}

const LOCAL_FLAG_BITS: Readonly<Partial<Record<NodeJS.Platform, LocalFlagBits>>> = {
    darwin: { echo: 0x8, icanon: 0x100 },
    linux: { echo: 0o10, icanon: 0o2 },
};

interface BunTerminal {
    write(data: string): number;
    resize(cols: number, rows: number): void;
    close(): void;
    localFlags: number;
}

interface BunSubprocess {
    readonly pid: number;
    readonly exited: Promise<number>;
    readonly exitCode: number | null;
    readonly signalCode: string | null;
    kill(signal?: string | number): void;
}

interface BunPtyApi {
    Terminal: new (options: {
        cols: number;
        rows: number;
        data: (terminal: BunTerminal, data: Uint8Array) => void;
    }) => BunTerminal;
    spawn(command: string[], options: {
        terminal: BunTerminal;
        env?: Record<string, string | undefined>;
        cwd?: string;
    }): BunSubprocess;
}

function bun_pty_api(): BunPtyApi | null {
    const candidate: unknown = (globalThis as { Bun?: unknown }).Bun;
    if (typeof candidate !== 'object' || candidate === null) {
        return null;
    }
    const api = candidate as Partial<BunPtyApi>;
    if (typeof api.Terminal !== 'function' || typeof api.spawn !== 'function') {
        return null;
    }
    return api as BunPtyApi;
}

/** True when this runtime can run Stata in a PTY. */
export function is_pty_supported(): boolean {
    return bun_pty_api() !== null && LOCAL_FLAG_BITS[process.platform] !== undefined;
}

export interface StataPtyOptions {
    command: string;
    args: readonly string[];
    columns: number;
    rows: number;
    on_data: (text: string) => void;
    env?: NodeJS.ProcessEnv;
}

export interface StataPty {
    readonly pid: number;
    write(text: string): void;
    /** Interrupt Stata, as Ctrl+C does in plain console Stata. */
    interrupt(): void;
    resize(columns: number, rows: number): void;
    /** True when the child's terminal echoes input (Stata turned echo on). */
    echo_enabled(): boolean;
    /** True when the child's terminal is line-buffered (canonical mode). */
    canonical_mode(): boolean;
    kill(signal: NodeJS.Signals): void;
    /** Resolves with the exit status: the code, or 128 + signal number. */
    readonly exit_status: Promise<number>;
    close(): void;
}

export function spawn_stata_pty(options: StataPtyOptions): StataPty {
    const api = bun_pty_api();
    const bits = LOCAL_FLAG_BITS[process.platform];
    if (!api || !bits) {
        throw new Error('This runtime has no pseudo-terminal support.');
    }
    const decoder = new TextDecoder();
    const terminal = new api.Terminal({
        cols: options.columns,
        rows: options.rows,
        data: (_terminal, data) => {
            const text = decoder.decode(data, { stream: true });
            if (text.length > 0) {
                options.on_data(text);
            }
        },
    });
    // The console draws what the user types itself, so the terminal
    // must not echo it a second time.
    terminal.localFlags = terminal.localFlags & ~bits.echo;

    const child = api.spawn([options.command, ...options.args], {
        terminal,
        env: { ...(options.env ?? process.env) },
    });
    let closed = false;
    const exit_status = child.exited.then(() => exit_status_of(child));

    return {
        pid: child.pid,
        write: (text) => {
            if (!closed) {
                terminal.write(text);
            }
        },
        // Bun's PTY is not the child's controlling terminal (the child has
        // no foreground process group), so the terminal can't turn a
        // typed ^C into SIGINT or announce a resize with SIGWINCH. Send
        // both signals to Stata directly.
        //
        // A terminal's ^C also reaches what Stata started (such as the
        // command its `shell` runs, which Stata waits for), so interrupt
        // signals those too. They can't be reached as a process group:
        // the child shares sight console's group, and Bun's `detached`
        // would make the PTY its controlling terminal, bringing job
        // control (Stata stopped by SIGTTIN after `shell`). Stata is
        // signalled first, so the signal is pending by the time what it
        // waits for ends.
        interrupt: () => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }
            const descendants = descendant_pids(child.pid);
            signal_child(child, 'SIGINT');
            for (const my_pid of descendants) {
                signal_pid(my_pid, 'SIGINT');
            }
        },
        resize: (columns, rows) => {
            if (!closed) {
                terminal.resize(Math.max(columns, 1), Math.max(rows, 1));
                signal_child(child, 'SIGWINCH');
            }
        },
        echo_enabled: () => !closed && (terminal.localFlags & bits.echo) !== 0,
        canonical_mode: () => closed || (terminal.localFlags & bits.icanon) !== 0,
        kill: (signal) => {
            signal_child(child, signal);
        },
        exit_status,
        close: () => {
            if (!closed) {
                closed = true;
                terminal.close();
            }
        },
    };
}

function signal_child(child: BunSubprocess, signal: NodeJS.Signals): void {
    try {
        child.kill(signal);
    } catch {
        // Already gone.
    }
}

function signal_pid(pid: number, signal: NodeJS.Signals): void {
    try {
        process.kill(pid, signal);
    } catch {
        // Already gone.
    }
}

/** Matches a `ps -o pid=,ppid=` line. */
const PS_LINE_PATTERN = /^\s*(\d+)\s+(\d+)\s*$/;

/**
 * The pids of every process descended from `root_pid` (not including
 * it), from one `ps` snapshot. Empty if `ps` can't be run. A process
 * whose parent already exited has been reparented and isn't found.
 */
export function descendant_pids(root_pid: number): number[] {
    const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], {
        encoding: 'utf8',
        timeout: 2000,
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') {
        return [];
    }
    const children_of = new Map<number, number[]>();
    for (const my_line of result.stdout.split('\n')) {
        const match = PS_LINE_PATTERN.exec(my_line);
        if (!match) {
            continue;
        }
        const pid = Number(match[1]);
        const parent_pid = Number(match[2]);
        const siblings = children_of.get(parent_pid);
        if (siblings) {
            siblings.push(pid);
        } else {
            children_of.set(parent_pid, [pid]);
        }
    }
    const descendants: number[] = [];
    const seen = new Set<number>([root_pid]);
    const pending = [root_pid];
    for (let parent = pending.pop(); parent !== undefined; parent = pending.pop()) {
        for (const my_pid of children_of.get(parent) ?? []) {
            if (!seen.has(my_pid)) {
                seen.add(my_pid);
                descendants.push(my_pid);
                pending.push(my_pid);
            }
        }
    }
    return descendants;
}

function exit_status_of(child: BunSubprocess): number {
    if (child.exitCode !== null) {
        return child.exitCode;
    }
    return signal_exit_status(child.signalCode);
}

/** Shell convention: a child killed by signal n exits with 128 + n. */
export function signal_exit_status(signal: string | null): number {
    if (!signal) {
        return 1;
    }
    const number = (os.constants.signals as Record<string, number | undefined>)[signal];
    return number === undefined ? 1 : 128 + number;
}

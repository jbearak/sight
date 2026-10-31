/**
 * Runs Stata in a pseudo-terminal through the `sight-pty` helper
 * (client/pty-helper/sight-pty.c), for runtimes with no PTY of their
 * own: the VS Code extension host on macOS and Linux is Node.
 *
 * The helper relays the terminal over pipes. Its stdout carries frames
 * (1 type byte, a 4-byte big-endian length, the payload): 'O' output,
 * 'L' the terminal's local flags in hex, 'E' a helper error, 'X' the
 * exit ("CODE SIGNAL"). Control lines go to its fd 3: "W COLS ROWS",
 * "I" (interrupt), "H" (hang up, then kill), "K" (kill). The helper
 * owns Stata's pid, so nothing here signals a pid that may have been
 * reused. Stata has no controlling terminal, so killing the helper
 * wouldn't end it: the helper is asked to kill Stata instead.
 */

import { spawn } from 'child_process';
import * as os from 'os';
import type { Readable, Writable } from 'stream';
import type { StataPty, StataPtyOptions } from './pty';

/** termios `c_lflag` bits, per platform (as in pty.ts). */
const LOCAL_FLAG_BITS: Readonly<Partial<Record<NodeJS.Platform, {
    echo: number;
    icanon: number;
}>>> = {
    darwin: { echo: 0x8, icanon: 0x100 },
    linux: { echo: 0o10, icanon: 0o2 },
};

const FRAME_HEADER_BYTES = 5;

export interface HelperPtyOptions extends StataPtyOptions {
    helper_path: string;
    cwd?: string;
    /** Called with a helper failure message (it can't run Stata). */
    on_helper_error?: (message: string) => void;
}

/** Splits the helper's stdout into frames, across reads. */
export class FrameReader {
    private pending: Buffer = Buffer.alloc(0);

    constructor(
        private readonly on_frame: (type: string, payload: Buffer) => void,
    ) {}

    push(chunk: Buffer): void {
        this.pending = this.pending.length === 0
            ? chunk
            : Buffer.concat([this.pending, chunk]);
        let offset = 0;
        while (this.pending.length - offset >= FRAME_HEADER_BYTES) {
            const length = this.pending.readUInt32BE(offset + 1);
            const end = offset + FRAME_HEADER_BYTES + length;
            if (end > this.pending.length) {
                break;
            }
            const type = String.fromCharCode(this.pending[offset] ?? 0);
            this.on_frame(type, this.pending.subarray(
                offset + FRAME_HEADER_BYTES, end
            ));
            offset = end;
        }
        this.pending = this.pending.subarray(offset);
    }
}

/** Parses an 'X' payload ("CODE SIGNAL") into a shell exit status. */
export function exit_status_from_frame(payload: string): number {
    const [code_text, signal_text] = payload.trim().split(' ');
    const code = Number(code_text);
    const signal_number = Number(signal_text);
    if (Number.isInteger(signal_number) && signal_number > 0) {
        return 128 + signal_number;
    }
    return Number.isInteger(code) ? code : 1;
}

export interface HelperPty extends StataPty {
    /**
     * After exit: true if the helper itself failed (it couldn't start,
     * or ended without reporting Stata's exit, as when the system kills
     * it at launch), so the caller can fall back to plain Stata.
     */
    helper_failed(): boolean;
}

export function spawn_helper_pty(options: HelperPtyOptions): HelperPty {
    const bits = LOCAL_FLAG_BITS[process.platform];
    if (!bits) {
        throw new Error('sight-pty runs only on macOS and Linux.');
    }
    const child = spawn(options.helper_path, [
        String(Math.max(options.columns, 1)),
        String(Math.max(options.rows, 1)),
        '--',
        options.command,
        ...options.args,
    ], {
        cwd: options.cwd,
        env: { ...(options.env ?? process.env) },
        stdio: ['pipe', 'pipe', 'ignore', 'pipe'],
    });
    // The pipes are missing if the helper couldn't start at all.
    const input = child.stdin as Writable | null;
    const output = child.stdout as Readable | null;
    const control = (child.stdio[3] ?? null) as Writable | null;
    // A closed pipe after the helper ends isn't worth reporting.
    input?.on('error', () => undefined);
    control?.on('error', () => undefined);

    // Before the first 'L': echo off, line-buffered (the helper's
    // defaults), so a send that early is length-limited, not lost.
    let local_flags = bits.icanon;
    let exit_frame_status: number | null = null;
    let closed = false;
    let ended = false;
    const decoder = new TextDecoder();
    const reader = new FrameReader((type, payload) => {
        switch (type) {
            case 'O': {
                const text = decoder.decode(payload, { stream: true });
                if (text.length > 0) {
                    options.on_data(text);
                }
                return;
            }
            case 'L': {
                const flags = parseInt(payload.toString('latin1'), 16);
                if (Number.isFinite(flags)) {
                    local_flags = flags;
                }
                return;
            }
            case 'E':
                options.on_helper_error?.(payload.toString('utf8'));
                return;
            case 'X':
                exit_frame_status = exit_status_from_frame(
                    payload.toString('latin1')
                );
                return;
        }
    });
    output?.on('data', (chunk: Buffer) => reader.push(chunk));

    const exit_status = new Promise<number>((resolve) => {
        let output_ended = false;
        let helper_status: number | null = null;
        const settle = (): void => {
            if (!output_ended || helper_status === null) {
                return;
            }
            ended = true;
            resolve(exit_frame_status ?? helper_status);
        };
        if (output) {
            output.on('end', () => {
                output_ended = true;
                settle();
            });
            output.on('error', () => {
                output_ended = true;
                settle();
            });
        } else {
            output_ended = true;
        }
        child.on('error', (error) => {
            options.on_helper_error?.(
                `cannot start ${options.helper_path}: ${error.message}`
            );
            output_ended = true;
            helper_status = 127;
            settle();
        });
        child.on('exit', (code, signal) => {
            helper_status = code ?? signal_status(signal);
            settle();
        });
    });

    const send_control = (line: string): void => {
        if (!closed && !ended) {
            control?.write(`${line}\n`);
        }
    };

    return {
        pid: child.pid ?? -1,
        write: (text) => {
            if (!closed && !ended) {
                input?.write(text);
            }
        },
        interrupt: () => send_control('I'),
        resize: (columns, rows) => {
            send_control(`W ${Math.max(columns, 1)} ${Math.max(rows, 1)}`);
        },
        echo_enabled: () => !closed && (local_flags & bits.echo) !== 0,
        canonical_mode: () => closed || (local_flags & bits.icanon) !== 0,
        kill: (signal) => {
            if (signal === 'SIGKILL') {
                send_control('K');
                return;
            }
            send_control(signal === 'SIGINT' ? 'I' : 'H');
        },
        exit_status,
        helper_failed: () => ended && exit_frame_status === null,
        close: () => {
            if (!closed) {
                closed = true;
                input?.end();
                control?.end();
            }
        },
    };
}

function signal_status(signal: NodeJS.Signals | null): number {
    if (!signal) {
        return 1;
    }
    const number = (os.constants.signals as Record<string, number | undefined>)[signal];
    return number === undefined ? 1 : 128 + number;
}

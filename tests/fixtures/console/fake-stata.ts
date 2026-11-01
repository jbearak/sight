#!/usr/bin/env bun
/**
 * A stand-in for Stata's console (`stata-mp`) used by `sight console`
 * tests. It reproduces the console protocol the wrapper relies on:
 * prompts printed without a newline (`. `, `  N. `, `: `), errors as a
 * message line plus `r(NNN);`, `--Break--` on SIGINT, and reading input
 * line by line from its terminal.
 *
 * FAKE_STATA_MODE (comma-separated) adds adversarial behavior:
 *   echo  turn terminal echo back on at startup, like a program that
 *         manages its own terminal settings.
 *   raw   behave like real Stata 18's console: switch the terminal to
 *         non-canonical mode with echo off, echo typed characters
 *         itself, and read `--more--` as a single key.
 *
 * Commands: local/global/generate (silent), display/di TEXT, sleep MS, foreach/forvalues ... {, mata,
 * request, more, slow, note, colors, len, pid, size, do/include FILE,
 * exitcode N, exit.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const modes = new Set((process.env.FAKE_STATA_MODE ?? '').split(',').filter(Boolean));
const quiet = process.argv.includes('-q');

if (modes.has('echo')) {
    spawnSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
}
const raw = modes.has('raw');
if (raw) {
    spawnSync('stty', ['-icanon', '-echo', 'min', '1'], { stdio: ['inherit', 'ignore', 'ignore'] });
}
/** Set while `--more--` waits for one key (raw mode). */
let more_key_reader: ((key: string) => void) | null = null;

type Mode = 'stata' | 'block' | 'mata';
let mode: Mode = 'stata';
let block_line = 0;
let busy_timer: ReturnType<typeof setTimeout> | null = null;
let line_reader: ((line: string) => void) | null = null;

const write = (text: string): void => {
    process.stdout.write(text);
};

function prompt(): void {
    if (mode === 'block') {
        block_line++;
        write(`${String(block_line).padStart(3)}. `);
    } else if (mode === 'mata') {
        write(': ');
    } else {
        write('. ');
    }
}

function finish(): void {
    write('\n');
    prompt();
    // Like Stata, read typed-ahead lines only once idle again.
    queueMicrotask(drain_input);
}

function run(line: string): void {
    if (mode === 'block') {
        if (line.trim() === '}' || line.trim() === 'end') {
            mode = 'stata';
            block_line = 0;
            finish();
            return;
        }
        prompt();
        return;
    }
    if (mode === 'mata') {
        if (line.trim() === 'end') {
            mode = 'stata';
            write('-'.repeat(40) + '\n');
            finish();
            return;
        }
        write(`  ${line}\n`);
        prompt();
        return;
    }

    const [command = '', ...rest] = line.trim().split(/\s+/);
    const argument = line.trim().slice(command.length).trim();
    switch (command) {
        case '':
            prompt();
            return;
        case 'exit':
            process.exit(0);
        case 'exitcode':
            process.exit(Number(rest[0] ?? '0'));
        case 'display':
        case 'di':
            write(argument.replace(/^"(.*)"$/, '$1') + '\n');
            finish();
            return;
        case 'sleep':
            busy_timer = setTimeout(() => {
                busy_timer = null;
                finish();
            }, Number(rest[0] ?? '0'));
            return;
        case 'foreach':
        case 'forvalues':
            mode = 'block';
            block_line = 0;
            prompt();
            return;
        case 'mata':
            mode = 'mata';
            write('-'.repeat(20) + ' mata (type end to exit) ' + '-'.repeat(20) + '\n');
            prompt();
            return;
        case 'request':
            write('Enter a name: ');
            line_reader = (reply) => {
                write(`hello, ${reply}\n`);
                finish();
            };
            return;
        case 'more': {
            write('line 1\nline 2\n--more--');
            const answer = (reply: string): void => {
                // Real Stata erases the prompt with backspaces.
                write(`${'\b'.repeat(8)}${' '.repeat(8)}${'\b'.repeat(8)}`
                    + `line 3 (${JSON.stringify(reply)})\n`);
                finish();
            };
            if (raw) {
                more_key_reader = answer;
            } else {
                line_reader = answer;
            }
            return;
        }
        case 'slow':
            // Output with a prompt-shaped fragment and a pause in the middle.
            write('working\n. ');
            busy_timer = setTimeout(() => {
                write('still working\n');
                busy_timer = setTimeout(() => {
                    busy_timer = null;
                    write('done\n');
                    finish();
                }, 150);
            }, 150);
            return;
        case 'note':
            write('note: something to know\n');
            finish();
            return;
        case 'colors':
            write('\x1b[32mgreen\x1b[0m\n');
            finish();
            return;
        case 'local':
        case 'global':
        case 'generate':
        case 'gen':
            // Definitions succeed silently, as in Stata.
            finish();
            return;
        case 'pid':
            write(`pid ${process.pid}\n`);
            finish();
            return;
        case 'do':
        case 'include': {
            // Reads the file and, with FAKE_STATA_LOG set, appends it
            // there, so end-to-end tests can see what reached Stata.
            const file_path = argument.replace(/^`"(.*)"'$/, '$1').replace(/^"(.*)"$/, '$1');
            let text: string;
            try {
                text = readFileSync(file_path, 'utf8');
            } catch {
                write(`file ${file_path} not found\nr(601);\n`);
                finish();
                return;
            }
            if (process.env.FAKE_STATA_LOG) {
                appendFileSync(process.env.FAKE_STATA_LOG, text);
            }
            write(`ran ${file_path}\n`);
            finish();
            return;
        }
        case 'size':
            // The terminal's size, to check that resizes reach Stata.
            write(`size ${process.stdout.columns}x${process.stdout.rows}\n`);
            finish();
            return;
        case 'len':
            write(`received ${Buffer.byteLength(line, 'utf8')} bytes\n`);
            finish();
            return;
        default:
            write(`command ${command} is unrecognized\nr(199);\n`);
            finish();
    }
}

process.on('SIGINT', () => {
    if (busy_timer) {
        clearTimeout(busy_timer);
        busy_timer = null;
    }
    line_reader = null;
    mode = 'stata';
    block_line = 0;
    write('\n--Break--\nr(1);\n');
    finish();
});

let pending = '';

function drain_input(): void {
    let index = pending.indexOf('\n');
    while (index !== -1 && busy_timer === null) {
        const line = pending.slice(0, index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
        const reader = line_reader;
        if (reader) {
            line_reader = null;
            reader(line);
        } else {
            run(line);
        }
        index = pending.indexOf('\n');
    }
}

process.stdin.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    if (!raw) {
        pending += text;
        drain_input();
        return;
    }
    // Raw mode: echo as Stata does, turning CR into a line end.
    for (const my_char of text) {
        const key_reader = more_key_reader;
        if (key_reader) {
            more_key_reader = null;
            key_reader(my_char);
            continue;
        }
        if (my_char === '\r' || my_char === '\n') {
            if (busy_timer === null) {
                write('\n');
            }
            pending += '\n';
        } else {
            if (busy_timer === null) {
                write(my_char);
            }
            pending += my_char;
        }
    }
    drain_input();
});

if (!quiet) {
    write('\n  ___  ____  ____  ____  ____ (R)\n Fake Stata 18.0\n\n');
}
prompt();

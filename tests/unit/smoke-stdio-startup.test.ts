import { describe, expect, it } from 'bun:test';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import {
    existsSync,
    chmodSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    extract_response_bodies,
    frame_message,
    get_smoke_spawn_options,
    get_windows_tree_kill_command,
    plan_smoke_protocol_writes,
    response_received,
    trim_stdout_buffer,
    write_child_stdin,
    terminate_child_process,
} from '../../scripts/smoke-stdio-startup';

function frame_json(message: unknown): Buffer {
    return frame_message(JSON.stringify(message));
}

function run_smoke_helper(
    command_path: string,
    pid_path?: string
): Promise<{ stderr: string; exit_code: number }> {
    return new Promise((resolve) => {
        const proc = spawn(
            process.execPath,
            ['scripts/smoke-stdio-startup.ts', command_path],
            {
                cwd: join(__dirname, '../..'),
                env: {
                    ...process.env,
                    SIGHT_SMOKE_INITIALIZE_TIMEOUT_MS: '1000',
                    SIGHT_SMOKE_SHUTDOWN_TIMEOUT_MS: '150',
                    SIGHT_SMOKE_EXIT_TIMEOUT_MS: '150',
                    ...(pid_path
                        ? { SIGHT_MOCK_PID_FILE: pid_path }
                        : {}),
                },
                stdio: ['ignore', 'ignore', 'pipe'],
            }
        );
        let stderr = '';

        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        proc.on('close', (code) => {
            resolve({
                stderr,
                exit_code: code ?? 1,
            });
        });
    });
}

function quote_posix(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

function write_mock_command(
    temp_root: string,
    script_source: string
): string {
    const script_path = join(temp_root, 'mock-server.ts');
    writeFileSync(script_path, script_source);

    if (process.platform === 'win32') {
        const command_path = join(temp_root, 'mock-server.cmd');
        writeFileSync(
            command_path,
            `@echo off\r\n"${process.execPath}" "${script_path}" %*\r\n`
        );
        return command_path;
    }

    const command_path = join(temp_root, 'mock-server');
    writeFileSync(
        command_path,
        [
            '#!/bin/sh',
            `exec ${quote_posix(process.execPath)} ` +
                `${quote_posix(script_path)} "$@"`,
            '',
        ].join('\n')
    );
    chmodSync(command_path, 0o755);

    return command_path;
}

function mock_server_source(
    mode: 'none' | 'initialize' | 'shutdown' | 'success'
): string {
    return [
        "import { writeFileSync } from 'fs';",
        'const pid_path = process.env.SIGHT_MOCK_PID_FILE;',
        "if (pid_path) writeFileSync(pid_path, String(process.pid));",
        'let stdin_buffer = Buffer.alloc(0);',
        'let initialize_sent = false;',
        'let shutdown_sent = false;',
        'function read_messages() {',
        "  const separator = Buffer.from('\\r\\n\\r\\n', 'ascii');",
        '  const messages = [];',
        '  let search_start = 0;',
        '  while (search_start < stdin_buffer.length) {',
        '    const header_end = stdin_buffer.indexOf(separator, search_start);',
        '    if (header_end < 0) break;',
        '    const header = stdin_buffer.subarray(search_start, header_end)' +
            ".toString('ascii');",
        '    const match = header.match(/Content-Length:\\s*(\\d+)/i);',
        '    if (!match) break;',
        '    const body_start = header_end + separator.length;',
        '    const body_end = body_start + Number(match[1]);',
        '    if (stdin_buffer.length < body_end) break;',
        '    messages.push(JSON.parse(stdin_buffer.subarray(' +
            "body_start, body_end).toString('utf8')));",
        '    search_start = body_end;',
        '  }',
        '  stdin_buffer = stdin_buffer.subarray(search_start);',
        '  return messages;',
        '}',
        'function write_response(id) {',
        "  const body = JSON.stringify({ jsonrpc: '2.0', id, result: {} });",
        '  const header = ' +
            '`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n`;',
        '  process.stdout.write(header + body);',
        '}',
        "process.stdin.on('data', (chunk) => {",
        '  stdin_buffer = Buffer.concat([stdin_buffer, chunk]);',
        mode === 'none'
            ? '  return;'
            : [
                '  for (const message of read_messages()) {',
                '    if (!initialize_sent && message.method === ' +
                    '"initialize") {',
                '      initialize_sent = true;',
                '      write_response(1);',
                '    }',
                '    if (message.method === "exit") {',
                mode === 'success'
                    ? '      process.exit(0);'
                    : '      continue;',
                '  }',
                '    if (!shutdown_sent && message.method === "shutdown") {',
                mode === 'shutdown' || mode === 'success'
                    ? [
                        '      shutdown_sent = true;',
                        '      write_response(2);',
                    ].join('\n')
                    : '',
                '    }',
                '  }',
            ].join('\n'),
        '});',
        'setInterval(() => {}, 1000);',
        '',
    ].join('\n');
}

function make_fake_child(): EventEmitter & {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: () => boolean;
    kill_count: number;
} {
    const child = new EventEmitter() as EventEmitter & {
        pid: number;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: () => boolean;
        kill_count: number;
    };

    child.pid = 1234;
    child.exitCode = null;
    child.signalCode = null;
    child.kill_count = 0;
    child.kill = () => {
        child.kill_count++;
        child.exitCode = 1;
        setTimeout(() => child.emit('exit', 1, null), 0);
        return true;
    };

    return child;
}

function is_process_alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function wait_for_process_exit(pid: number): Promise<boolean> {
    for (let i = 0; i < 25; i++) {
        if (!is_process_alive(pid)) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 40));
    }

    return !is_process_alive(pid);
}

async function expect_mock_process_stopped(pid_path: string): Promise<void> {
    expect(existsSync(pid_path)).toBe(true);
    const pid = Number(readFileSync(pid_path, 'utf8'));
    const exited = await wait_for_process_exit(pid);

    if (!exited) {
        try {
            process.kill(pid);
        } catch {
            // The assertion below reports the failure.
        }
    }

    expect(exited).toBe(true);
}

describe('stdio startup smoke framing helpers', () => {
    it('finds an initialize response after a preceding LSP frame', () => {
        const notification = {
            jsonrpc: '2.0',
            method: 'window/logMessage',
            params: {
                type: 3,
                message: 'starting',
            },
        };
        const response = {
            jsonrpc: '2.0',
            id: 1,
            result: {
                capabilities: {},
            },
        };
        const output = Buffer.concat([
            frame_json(notification),
            frame_json(response),
        ]);

        expect(extract_response_bodies(output).map(JSON.parse))
            .toEqual([notification, response]);
        expect(response_received(output, 1)).toBe(true);
    });

    it('uses byte lengths when extracting non-ASCII LSP bodies', () => {
        const notification = {
            jsonrpc: '2.0',
            method: 'window/logMessage',
            params: {
                type: 3,
                message: 'héllo from Stata',
            },
        };
        const response = {
            jsonrpc: '2.0',
            id: 2,
            result: null,
        };
        const output = Buffer.concat([
            frame_json(notification),
            frame_json(response),
        ]);

        expect(extract_response_bodies(output).map(JSON.parse))
            .toEqual([notification, response]);
        expect(response_received(output, 2)).toBe(true);
    });

    it('plans initialized and shutdown writes after initialize response', () => {
        const response = {
            jsonrpc: '2.0',
            id: 1,
            result: {
                capabilities: {},
            },
        };
        const output = frame_json(response);
        const write_plan = plan_smoke_protocol_writes(output, {
            initialized_sent: false,
            shutdown_sent: false,
            exit_sent: false,
        });
        const the_messages = write_plan.messages
            .map(extract_response_bodies)
            .flat()
            .map(JSON.parse);

        expect(write_plan.initialize_received).toBe(true);
        expect(write_plan.shutdown_received).toBe(false);
        expect(write_plan.next_state).toEqual({
            initialized_sent: true,
            shutdown_sent: true,
            exit_sent: false,
        });
        expect(the_messages.map((message) => message.method))
            .toEqual(['initialized', 'shutdown']);
    });

    it('plans exit only after shutdown response', () => {
        const response = {
            jsonrpc: '2.0',
            id: 2,
            result: null,
        };
        const output = frame_json(response);
        const write_plan = plan_smoke_protocol_writes(output, {
            initialized_sent: true,
            shutdown_sent: true,
            exit_sent: false,
        });
        const the_messages = write_plan.messages
            .map(extract_response_bodies)
            .flat()
            .map(JSON.parse);

        expect(write_plan.initialize_received).toBe(false);
        expect(write_plan.shutdown_received).toBe(true);
        expect(write_plan.next_state).toEqual({
            initialized_sent: true,
            shutdown_sent: true,
            exit_sent: true,
        });
        expect(the_messages).toEqual([{
            jsonrpc: '2.0',
            method: 'exit',
            params: {},
        }]);
    });

    it('keeps only the newest stdout bytes when the smoke buffer grows', () => {
        const old_chunk = Buffer.from('old-output');
        const new_chunk = Buffer.from('new-output');
        const trimmed = trim_stdout_buffer(
            Buffer.concat([old_chunk, new_chunk]),
            new_chunk.length
        );

        expect(trimmed.toString('utf8')).toBe('new-output');
    });

    it('plans Windows process-tree termination with taskkill', () => {
        expect(get_windows_tree_kill_command(1234)).toEqual({
            command: 'taskkill',
            args: ['/pid', '1234', '/t', '/f'],
        });
    });

    it('uses a direct spawn for explicit Windows executable paths', () => {
        expect(get_smoke_spawn_options(
            'bin/sight-windows-x64.exe',
            'win32'
        ).shell).toBe(false);
        expect(get_smoke_spawn_options(
            'C:\\tools\\sight-windows-x64.exe',
            'win32'
        ).shell).toBe(false);
    });

    it('uses a shell for bare Windows command names', () => {
        expect(get_smoke_spawn_options('sight', 'win32').shell).toBe(true);
        expect(get_smoke_spawn_options('sight-language-server', 'win32').shell)
            .toBe(true);
    });

    it('reports stdin EPIPE writes without throwing', async () => {
        const failed_stdin = {
            write(
                _chunk: Buffer,
                callback?: (error?: Error | null) => void
            ): boolean {
                const error = new Error('broken pipe') as NodeJS.ErrnoException;

                error.code = 'EPIPE';
                callback?.(error);
                return false;
            },
        };
        const the_errors: Error[] = [];

        write_child_stdin(
            failed_stdin,
            frame_json({ jsonrpc: '2.0', method: 'initialize' }),
            (error) => {
                the_errors.push(error);
            }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(the_errors).toHaveLength(1);
        expect((the_errors[0] as NodeJS.ErrnoException).code).toBe('EPIPE');
    });

    it('falls back to child.kill when Windows process-tree kill fails',
        async () => {
            const child = make_fake_child();
            let runner_timeout_ms: number | undefined;

            await terminate_child_process(child, {
                platform: 'win32',
                run_windows_tree_kill: (_command, _args, options) => {
                    runner_timeout_ms = options.timeout;
                    return {
                        status: 1,
                    };
                },
            });

            expect(runner_timeout_ms).toBe(1000);
            expect(child.kill_count).toBe(1);
        }
    );

    it('succeeds when the server completes initialize-shutdown-exit',
        async () => {
            const temp_root = mkdtempSync(
                join(tmpdir(), 'sight-smoke-helper-')
            );
            const command_path = write_mock_command(
                temp_root,
                mock_server_source('success')
            );

            try {
                const result = await run_smoke_helper(command_path);

                expect(result.exit_code).toBe(0);
                expect(result.stderr).toBe('');
            } finally {
                rmSync(temp_root, { recursive: true, force: true });
            }
        }
    );

    it('fails and stops the child when initialize response never arrives',
        async () => {
            const temp_root = mkdtempSync(
                join(tmpdir(), 'sight-smoke-helper-')
            );
            const pid_path = join(temp_root, 'mock.pid');
            const command_path = write_mock_command(
                temp_root,
                mock_server_source('none')
            );

            try {
                const result = await run_smoke_helper(command_path, pid_path);

                expect(result.exit_code).toBe(1);
                expect(result.stderr).toContain('did not answer initialize');
                await expect_mock_process_stopped(pid_path);
            } finally {
                rmSync(temp_root, { recursive: true, force: true });
            }
        }
    );

    it('fails and stops the child when shutdown response never arrives',
        async () => {
            const temp_root = mkdtempSync(
                join(tmpdir(), 'sight-smoke-helper-')
            );
            const pid_path = join(temp_root, 'mock.pid');
            const command_path = write_mock_command(
                temp_root,
                mock_server_source('initialize')
            );

            try {
                const result = await run_smoke_helper(command_path, pid_path);

                expect(result.exit_code).toBe(1);
                expect(result.stderr).toContain('did not answer shutdown');
                await expect_mock_process_stopped(pid_path);
            } finally {
                rmSync(temp_root, { recursive: true, force: true });
            }
        }
    );

    it('fails and stops the child when process ignores exit notification',
        async () => {
            const temp_root = mkdtempSync(
                join(tmpdir(), 'sight-smoke-helper-')
            );
            const pid_path = join(temp_root, 'mock.pid');
            const command_path = write_mock_command(
                temp_root,
                mock_server_source('shutdown')
            );

            try {
                const result = await run_smoke_helper(command_path, pid_path);

                expect(result.exit_code).toBe(1);
                expect(result.stderr).toContain(
                    'did not exit cleanly after shutdown'
                );
                await expect_mock_process_stopped(pid_path);
            } finally {
                rmSync(temp_root, { recursive: true, force: true });
            }
        }
    );
});

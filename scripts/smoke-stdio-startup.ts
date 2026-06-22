#!/usr/bin/env bun
/**
 * Smoke-test that a Sight executable responds to stdio LSP initialize.
 */

import {
    spawn,
    spawnSync,
    type ChildProcess,
    type SpawnOptions,
} from 'child_process';

const INITIALIZE_REQUEST_ID = 1;
const SHUTDOWN_REQUEST_ID = 2;
const MAX_STDOUT_BUFFER_BYTES = 1024 * 1024;
const initialize_request = JSON.stringify({
    jsonrpc: '2.0',
    id: INITIALIZE_REQUEST_ID,
    method: 'initialize',
    params: {
        capabilities: {},
    },
});
const initialized_notification = JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialized',
    params: {},
});
const shutdown_request = JSON.stringify({
    jsonrpc: '2.0',
    id: SHUTDOWN_REQUEST_ID,
    method: 'shutdown',
    params: null,
});
const exit_notification = JSON.stringify({
    jsonrpc: '2.0',
    method: 'exit',
    params: {},
});

export interface SmokeProtocolState {
    initialized_sent: boolean;
    shutdown_sent: boolean;
    exit_sent: boolean;
}

export interface SmokeProtocolWrites {
    next_state: SmokeProtocolState;
    messages: Buffer[];
    initialize_received: boolean;
    shutdown_received: boolean;
}

export interface WindowsTreeKillCommand {
    command: string;
    args: string[];
}

export interface WindowsTreeKillOptions {
    timeout: number;
}

export interface WindowsTreeKillResult {
    status: number | null;
    error?: Error;
}

export interface TerminateChildProcessOptions {
    platform?: NodeJS.Platform;
    run_windows_tree_kill?: (
        command: string,
        args: string[],
        options: WindowsTreeKillOptions
    ) => WindowsTreeKillResult;
    tree_kill_timeout_ms?: number;
}

export interface ChildStdinWriter {
    write(
        chunk: Buffer,
        callback?: (error?: Error | null) => void
    ): boolean;
}

function has_windows_executable_path(command: string): boolean {
    return command.toLowerCase().endsWith('.exe');
}

export function get_smoke_spawn_options(
    command: string,
    platform: NodeJS.Platform = process.platform
): SpawnOptions {
    return {
        stdio: 'pipe',
        shell: platform === 'win32' && !has_windows_executable_path(command),
    };
}

export function write_child_stdin(
    child_stdin: ChildStdinWriter,
    message: Buffer,
    on_error: (error: Error) => void
): void {
    let error_reported = false;

    function report_error(error?: Error | null): void {
        if (!error || error_reported) {
            return;
        }

        error_reported = true;
        on_error(error);
    }

    try {
        child_stdin.write(message, report_error);
    } catch (error) {
        report_error(error as Error);
    }
}

export function get_windows_tree_kill_command(
    pid: number
): WindowsTreeKillCommand {
    return {
        command: 'taskkill',
        args: ['/pid', String(pid), '/t', '/f'],
    };
}

export function frame_message(message: string): Buffer {
    const body = Buffer.from(message, 'utf8');
    const header = Buffer.from(
        `Content-Length: ${body.length}\r\n\r\n`,
        'ascii'
    );

    return Buffer.concat([header, body]);
}

export function extract_response_bodies(output_buffer: Buffer): string[] {
    const the_bodies: string[] = [];
    const separator = Buffer.from('\r\n\r\n', 'ascii');
    let search_start_index = 0;

    while (search_start_index < output_buffer.length) {
        const header_end_index = output_buffer.indexOf(
            separator,
            search_start_index
        );

        if (header_end_index < 0) {
            break;
        }

        const header_text = output_buffer.subarray(
            search_start_index,
            header_end_index
        ).toString('ascii');
        const length_match = header_text.match(/Content-Length:\s*(\d+)/i);

        if (!length_match) {
            search_start_index = header_end_index + separator.length;
            continue;
        }

        const body_start_index = header_end_index + separator.length;
        const body_length = Number(length_match[1]);
        const body_end_index = body_start_index + body_length;

        if (output_buffer.length < body_end_index) {
            break;
        }

        the_bodies.push(
            output_buffer.subarray(body_start_index, body_end_index)
                .toString('utf8')
        );
        search_start_index = body_end_index;
    }

    return the_bodies;
}

export function response_received(
    response_buffer: Buffer,
    request_id: number
): boolean {
    const the_response_bodies = extract_response_bodies(response_buffer);

    for (const my_response_body of the_response_bodies) {
        try {
            const response = JSON.parse(my_response_body) as {
                id?: unknown;
                result?: unknown;
            };

            if (
                response.id === request_id &&
                response.result !== undefined
            ) {
                return true;
            }
        } catch {
            continue;
        }
    }

    return false;
}

export function plan_smoke_protocol_writes(
    stdout_buffer: Buffer,
    state: SmokeProtocolState
): SmokeProtocolWrites {
    const next_state: SmokeProtocolState = {
        ...state,
    };
    const messages: Buffer[] = [];
    const initialize_received = response_received(
        stdout_buffer,
        INITIALIZE_REQUEST_ID
    );
    const shutdown_received = response_received(
        stdout_buffer,
        SHUTDOWN_REQUEST_ID
    );

    if (!next_state.initialized_sent && initialize_received) {
        next_state.initialized_sent = true;
        next_state.shutdown_sent = true;
        messages.push(frame_message(initialized_notification));
        messages.push(frame_message(shutdown_request));
    }

    if (
        next_state.shutdown_sent &&
        !next_state.exit_sent &&
        shutdown_received
    ) {
        next_state.exit_sent = true;
        messages.push(frame_message(exit_notification));
    }

    return {
        next_state,
        messages,
        initialize_received,
        shutdown_received,
    };
}

export function trim_stdout_buffer(
    stdout_buffer: Buffer,
    max_bytes: number = MAX_STDOUT_BUFFER_BYTES
): Buffer {
    if (stdout_buffer.length <= max_bytes) {
        return stdout_buffer;
    }

    return stdout_buffer.subarray(stdout_buffer.length - max_bytes);
}

function wait_for_child_exit(
    child: ChildProcess,
    timeout_ms: number
): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            child.off('exit', on_exit);
            resolve(false);
        }, timeout_ms);

        function on_exit(): void {
            clearTimeout(timeout);
            resolve(true);
        }

        child.once('exit', on_exit);
    });
}

export async function terminate_child_process(
    child: ChildProcess,
    options: TerminateChildProcessOptions = {}
): Promise<void> {
    const platform = options.platform ?? process.platform;
    const run_windows_tree_kill = options.run_windows_tree_kill ??
        ((command, args, runner_options) => spawnSync(command, args, {
            stdio: 'ignore',
            timeout: runner_options.timeout,
        }));
    const tree_kill_timeout_ms = options.tree_kill_timeout_ms ?? 1000;

    if (!child.pid) {
        child.kill();
        await wait_for_child_exit(child, 500);
        return;
    }

    if (platform === 'win32') {
        const kill_command = get_windows_tree_kill_command(child.pid);
        const result = run_windows_tree_kill(
            kill_command.command,
            kill_command.args,
            {
                timeout: tree_kill_timeout_ms,
            }
        );

        if (
            result.error ||
            result.status !== 0
        ) {
            child.kill();
        }

        await wait_for_child_exit(child, tree_kill_timeout_ms);
        return;
    }

    child.kill();
    if (!(await wait_for_child_exit(child, 500))) {
        child.kill('SIGKILL');
        await wait_for_child_exit(child, 1000);
    }
}

function get_timeout_ms(env_name: string, default_ms: number): number {
    const raw_value = process.env[env_name];
    const parsed_value = Number(raw_value);

    if (Number.isFinite(parsed_value) && parsed_value > 0) {
        return parsed_value;
    }

    return default_ms;
}

function format_stdin_write_error(command: string, error: Error): string {
    const code = (error as NodeJS.ErrnoException).code;
    const prefix = code ? `${code}: ` : '';

    return `${command} closed stdin before startup smoke completed: ` +
        `${prefix}${error.message}`;
}

function run_smoke(command: string): void {
    const framed_initialize_request = frame_message(initialize_request);
    const timeout_ms = get_timeout_ms(
        'SIGHT_SMOKE_INITIALIZE_TIMEOUT_MS',
        5000
    );
    const shutdown_timeout_ms = get_timeout_ms(
        'SIGHT_SMOKE_SHUTDOWN_TIMEOUT_MS',
        5000
    );
    const post_exit_timeout_ms = get_timeout_ms(
        'SIGHT_SMOKE_EXIT_TIMEOUT_MS',
        2000
    );

    const spawn_options = get_smoke_spawn_options(command);
    const child: ChildProcess = spawn(
        command,
        ['--stdio', '--quiet'],
        spawn_options
    );
    const child_stdin = child.stdin;
    const child_stdout = child.stdout;
    const child_stderr = child.stderr;

    let my_initialized_sent = false;
    let my_shutdown_sent = false;
    let my_exit_sent = false;
    let my_stderr_text = '';
    let my_stdout_buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let my_settled = false;
    let my_initialize_timeout: ReturnType<typeof setTimeout> | undefined;
    let my_shutdown_timeout: ReturnType<typeof setTimeout> | undefined;
    let my_post_exit_timeout: ReturnType<typeof setTimeout> | undefined;

    async function finish(
        exit_code: number,
        message?: string,
        kill_child = true
    ): Promise<never> {
        if (my_settled) {
            process.exit(exit_code);
        }

        my_settled = true;
        if (my_initialize_timeout) {
            clearTimeout(my_initialize_timeout);
        }
        if (my_shutdown_timeout) {
            clearTimeout(my_shutdown_timeout);
        }
        if (my_post_exit_timeout) {
            clearTimeout(my_post_exit_timeout);
        }

        if (kill_child) {
            await terminate_child_process(child);
        }

        if (message) {
            console.error(message);
        }

        process.exit(exit_code);
    }

    if (!child_stdin || !child_stdout || !child_stderr) {
        void finish(1, `${command} did not expose stdio pipes`);
        return;
    }

    child_stdout.on('data', (chunk: Buffer) => {
        my_stdout_buffer = trim_stdout_buffer(
            Buffer.concat([my_stdout_buffer, chunk])
        );
        const write_plan = plan_smoke_protocol_writes(my_stdout_buffer, {
            initialized_sent: my_initialized_sent,
            shutdown_sent: my_shutdown_sent,
            exit_sent: my_exit_sent,
        });

        if (!my_initialized_sent && write_plan.initialize_received) {
            if (my_initialize_timeout) {
                clearTimeout(my_initialize_timeout);
                my_initialize_timeout = undefined;
            }
            if (!my_shutdown_timeout) {
                my_shutdown_timeout = setTimeout(() => {
                    void finish(
                        1,
                        `${command} did not answer shutdown within ` +
                        `${shutdown_timeout_ms}ms\n${my_stderr_text}`
                    );
                }, shutdown_timeout_ms);
            }
        }

        my_initialized_sent = write_plan.next_state.initialized_sent;
        my_shutdown_sent = write_plan.next_state.shutdown_sent;
        my_exit_sent = write_plan.next_state.exit_sent;

        for (const my_message of write_plan.messages) {
            write_child_stdin(child_stdin, my_message, (error) => {
                if (!my_settled) {
                    void finish(1, format_stdin_write_error(command, error));
                }
            });
        }

        if (
            write_plan.shutdown_received &&
            my_exit_sent &&
            !my_post_exit_timeout
        ) {
            if (my_shutdown_timeout) {
                clearTimeout(my_shutdown_timeout);
                my_shutdown_timeout = undefined;
            }
            my_post_exit_timeout = setTimeout(() => {
                void finish(
                    1,
                    `${command} did not exit cleanly after shutdown\n` +
                    my_stderr_text
                );
            }, post_exit_timeout_ms);
        }
    });

    child_stderr.on('data', (chunk: Buffer) => {
        my_stderr_text += chunk.toString('utf8');
    });

    child.on('exit', (code, signal) => {
        if (my_settled) {
            return;
        }

        if (my_exit_sent && code === 0) {
            void finish(0, undefined, false);
            return;
        }

        void finish(
            1,
            `${command} exited before startup smoke completed: ` +
            `code=${code} signal=${signal}\n${my_stderr_text}`,
            false
        );
    });

    child.on('error', (error) => {
        void finish(1, `${command} failed to start: ${error.message}`);
    });

    child_stdin.on('error', (error) => {
        if (!my_settled) {
            void finish(1, format_stdin_write_error(command, error));
        }
    });

    write_child_stdin(child_stdin, framed_initialize_request, (error) => {
        if (!my_settled) {
            void finish(1, format_stdin_write_error(command, error));
        }
    });

    my_initialize_timeout = setTimeout(() => {
        void finish(
            1,
            `${command} did not answer initialize within ${timeout_ms}ms\n` +
            my_stderr_text
        );
    }, timeout_ms);
}

if (import.meta.main) {
    const command = process.argv[2];

    if (!command) {
        console.error('Usage: bun scripts/smoke-stdio-startup.ts <command>');
        process.exit(2);
    }

    run_smoke(command);
}

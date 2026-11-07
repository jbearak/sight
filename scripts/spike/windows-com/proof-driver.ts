/** Runs unchanged production open/connect/backend with a trace-only transport. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { open_automation_console, type OpenHandle } from '../../../src/console/automation/open';
import { start_powershell_bridge } from '../../../src/console/automation/process-transport';
import type { BackendHandle } from '../../../src/console/backend';
import type { BridgeTransport } from '../../../src/console/automation/bridge';

const [dir, common_root, cancel_stage = 'none', cancel_count = '1'] = process.argv.slice(2);
if (!dir || !common_root) throw new Error('Expected result dir and shared temp root');
fs.mkdirSync(dir, { recursive: true });
const trace_path = path.join(dir, 'trace.jsonl');
function record(event: string, data: unknown): void {
    fs.appendFileSync(trace_path, JSON.stringify({ utc: new Date().toISOString(), event, data }) + '\n');
}
function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const pending = new Map<number, { op: string; args: Record<string, unknown>; start_ms: number }>();
let handle: OpenHandle | undefined;
let backend: BackendHandle | undefined;
let output = '';
let own_pid: number | null = null;
let auto_cancelled = false;
const notices: string[] = [];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function cancel(): void {
    if (!handle) throw new Error('Handle unavailable');
    record('cancel', { outcome: handle.cancel(), own_pid });
}
function maybe_cancel(op: string, args: Record<string, unknown>): void {
    const matches = (cancel_stage === 'free' && op === 'is_free') ||
        (cancel_stage === 'title' && op === 'do_sync' && typeof args.cmd === 'string' && args.cmd.startsWith('window manage maintitle'));
    if (!auto_cancelled && matches) {
        auto_cancelled = true;
        cancel();
        if (cancel_count === '2') setTimeout(cancel, 30);
    }
}
record('revision', { commit: '2548950b8abb9d6f7f6c74727111a6ae6a58b04a',
    bridge_source_sha256: createHash('sha256').update(fs.readFileSync(path.resolve(import.meta.dir, '../../../src/console/automation/bridge-script.ts'))).digest('hex'),
    bun: Bun.version, process_arch: process.arch, pid: process.pid });
try {
    handle = open_automation_console({
        env: { ...process.env, SIGHT_CONSOLE_TMPDIR: common_root }, columns: 90,
        say: (text) => { notices.push(text); record('notice', text); },
        start_bridge: (script_path) => {
            const transport = start_powershell_bridge(script_path);
            const tapped: BridgeTransport = {
                send: (line) => {
                    const value: unknown = JSON.parse(line);
                    if (!object(value) || typeof value.id !== 'number' || typeof value.op !== 'string') throw new Error('Bad request');
                    pending.set(value.id, { op: value.op, args: value, start_ms: performance.now() });
                    record('request', value);
                    transport.send(line);
                    maybe_cancel(value.op, value);
                },
                on_line: (callback) => transport.on_line((line) => {
                    const value: unknown = JSON.parse(line);
                    if (object(value) && typeof value.id === 'number') {
                        const request = pending.get(value.id);
                        record('reply', { op: request?.op, elapsed_ms: request ? performance.now() - request.start_ms : null, reply: value });
                        if (!value.event) pending.delete(value.id);
                        if (request?.op === 'title_pid' && value.ok === true && typeof value.pid === 'number') own_pid = value.pid;
                    }
                    callback(line);
                }),
                ended: transport.ended.then((stderr) => { record('bridge_ended', { stderr }); return stderr; }),
                close: () => transport.close(), kill: () => transport.kill(),
            };
            return { ...tapped, fatal: transport.fatal };
        },
    });
    let stop = false;
    let last_command = '';
    const control = async (): Promise<void> => {
        while (!stop) {
            const file = path.join(dir, 'command.json');
            if (fs.existsSync(file)) {
                try {
                    const command: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
                    if (object(command) && typeof command.nonce === 'string' && command.nonce !== last_command) {
                        last_command = command.nonce;
                        record('control', command);
                        if (command.op === 'cancel') cancel();
                        else if (command.op === 'submit' && typeof command.line === 'string' && backend) {
                            backend.backend.submit_line(command.line, false);
                        }
                        fs.writeFileSync(path.join(dir, 'ack'), command.nonce);
                    }
                } catch (error) { record('control_error', String(error)); }
            }
            await sleep(10);
        }
    };
    const controls = control();
    const opened = await handle.result;
    record('open_result', opened.ok ? { ok: true, own_pid, notices } : opened);
    if (!opened.ok) {
        stop = true;
        await controls;
        fs.writeFileSync(path.join(dir, 'done.json'), JSON.stringify(opened));
        process.exitCode = opened.exit_code;
    } else {
        backend = opened.connection.start_backend({
            on_output: (text) => { output += text; record('output', text); fs.writeFileSync(path.join(dir, 'output.txt'), output); },
            on_notice: (text) => record('backend_notice', text),
            on_sight_text: (text) => record('sight_text', text),
            on_stata_error: () => record('stata_error', {}),
        });
        fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ own_pid, notices }));
        const status = await backend.lifecycle.exit_status;
        record('backend_exit', { status, message: backend.lifecycle.closing_message() });
        stop = true;
        await controls;
        await opened.connection.finish();
        fs.writeFileSync(path.join(dir, 'done.json'), JSON.stringify({ ok: true, status, own_pid, notices }));
        process.exitCode = status;
    }
} catch (error) {
    record('driver_error', error instanceof Error ? { message: error.message, stack: error.stack } : String(error));
    fs.writeFileSync(path.join(dir, 'error.txt'), String(error));
    handle?.cancel();
    handle?.cancel();
    process.exitCode = 1;
}

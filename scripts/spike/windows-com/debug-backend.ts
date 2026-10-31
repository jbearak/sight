/** Windows-only smoke test of the production bridge, connection and backend. */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BRIDGE_SCRIPT } from '../../../src/console/automation/bridge-script';
import { BridgeClient } from '../../../src/console/automation/bridge';
import { start_powershell_bridge } from '../../../src/console/automation/process-transport';
import { connect_to_stata } from '../../../src/console/automation/connect';
import { AutomationBackend } from '../../../src/console/automation/automation-backend';
import { LogTail } from '../../../src/console/automation/log-tail';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const root = path.join(os.tmpdir(), 'sight-debug-harness');
const token = randomBytes(16).toString('hex');
const dir = path.join(root, token);
fs.mkdirSync(dir, { recursive: true });
const script = path.join(dir, 'bridge.ps1');
fs.writeFileSync(script, BRIDGE_SCRIPT, 'utf8');
const transport = start_powershell_bridge(script);
const bridge = new BridgeClient(transport);
const request = async (op: string, args: Record<string, unknown> = {}) => {
    const result = await bridge.request(op, args, { timeout_ms: 15000 });
    console.log('REQUEST', op, JSON.stringify(result));
    assert.ok(result.ok, `${op}: ${JSON.stringify(result)}`);
    return result.value;
};
let output = '';
const sight_messages: string[] = [];
try {
    await request('self_test', { dir });
    await request('registered');
    const existing = await request('list_stata', { strict: false, root });
    assert.deepEqual(existing.processes, [], 'An existing Stata must not be touched');
    const connected = await connect_to_stata({
        bridge, dir, root, token, yes: false, from_editor: false, columns: 80,
        ask: async (question) => { throw new Error(`Unexpected question: ${question}`); },
        say: (text) => console.log('NOTICE', text), sleep,
        file_size: (file) => fs.statSync(file).size,
    });
    console.log('CONNECT', JSON.stringify(connected));
    assert.ok(connected.ok);
    assert.equal(connected.log_rc, 0);
    const backend = new AutomationBackend({
        bridge, log: new LogTail(connected.log_path, connected.start_size),
        start_size: connected.start_size,
        clock: { now: Date.now, set_timeout: (cb, ms) => setTimeout(cb, ms),
            clear_timeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
        events: {
            on_output: (text) => { output += text; console.log('OUTPUT', JSON.stringify(text)); },
            on_notice: (text) => console.log('NOTICE', text),
            on_sight_text: (text) => { sight_messages.push(text); console.log('SIGHT', text); },
            on_stata_error: () => console.log('STATA_ERROR'),
        },
    });
    backend.start();
    const line = async (command: string, prompt: string) => {
        const before = output.length;
        console.log('SUBMIT', JSON.stringify(command));
        backend.submit_line(command, false);
        const deadline = Date.now() + 15000;
        while (!output.slice(before).endsWith(prompt) && Date.now() < deadline) {
            await sleep(50);
        }
        assert.ok(output.slice(before).endsWith(prompt),
            `Expected ${JSON.stringify(prompt)} after ${command}: ${JSON.stringify(output.slice(before))}`);
    };
    await line('sysuse auto, clear', '. ');
    assert.equal(output.split('sysuse auto, clear').length - 1, 1);
    await line('display 1234567', '. ');
    assert.match(output, /1234567/);
    await line('foreach x in 1 2 {', '  2. ');
    await line("display `x'", '  3. ');
    await line('}', '. ');
    await line('program define spike_debug', '  1. ');
    await line('display 42', '  2. ');
    await line('end', '. ');
    await line('spike_debug', '. ');
    await line('mata', ': ');
    await line('1+1', ': ');
    await line('end', '. ');
    await line('python', '>>> ');
    await line('print(123)', '>>> ');
    await line('end', '. ');
    const before_interrupt = output.length;
    backend.submit_line('sleep 10000', false);
    await sleep(700);
    backend.submit_line('display 778899', false);
    await sleep(200);
    backend.interrupt();
    const break_deadline = Date.now() + 10000;
    while (!output.slice(before_interrupt).endsWith('. ') && Date.now() < break_deadline) {
        await sleep(50);
    }
    assert.match(output.slice(before_interrupt), /--Break--/);
    assert.equal(output.slice(before_interrupt).split('sleep 10000').length - 1, 1);
    assert.doesNotMatch(output.slice(before_interrupt), /778899/);
    await line('log close _all', '. ');
    await line('display 77', '. ');
    await line('display 88', '. ');
    assert.ok(sight_messages.some((message) => message.includes("Sight's log was closed")));
    backend.submit_line('exit', false);
    const status = await Promise.race([backend.exit_status, sleep(10000).then(() => -1)]);
    console.log('EXIT', status);
    assert.equal(status, 0);
} finally {
    bridge.close();
    const stderr = await Promise.race([transport.ended, sleep(3000).then(() => 'timeout')]);
    console.log('BRIDGE_END', stderr);
    if (stderr === 'timeout') transport.kill();
}

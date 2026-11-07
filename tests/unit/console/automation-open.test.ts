/**
 * open_automation_console tests with a fake bridge process: the checks
 * before any COM call (the COM helper compiles, the registration is
 * supported) and the staged cancel. Before `connect` is sent a cancel
 * ends the bridge at once; while connecting, the first cancel waits
 * for connect.ts to identify the Stata, and a second one ends it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CANCELLED_STATUS,
    open_automation_console,
    type OpenOptions,
} from '../../../src/console/automation/open';
import type { ProcessTransport } from '../../../src/console/automation/process-transport';
import {
    EXIT_AUTOMATION_UNSUPPORTED,
    EXIT_BRIDGE_BLOCKED,
} from '../../../src/console/automation/exit-codes';

type Reply = Record<string, unknown>;
/** A reply, or `hold` to answer later through `release`. */
type Handler = (request: Reply) => Reply | 'hold';

class FakeBridgeProcess implements ProcessTransport {
    ops: string[] = [];
    killed = false;
    closed = false;
    private listener: (line: string) => void = () => undefined;
    private finish: (text: string) => void = () => undefined;
    private held: Reply | null = null;
    readonly ended = new Promise<string>((resolve) => {
        this.finish = resolve;
    });
    constructor(private readonly handlers: Record<string, Handler>) {}
    send(line: string): void {
        const request = JSON.parse(line) as Reply;
        const op = String(request.op);
        this.ops.push(op);
        const handler = this.handlers[op];
        const reply = handler ? handler(request) : { ok: true };
        if (reply === 'hold') {
            this.held = request;
            return;
        }
        this.answer(request, reply);
    }
    /** Answer the held request. */
    release(reply: Reply): void {
        const request = this.held;
        if (!request) {
            throw new Error('nothing held');
        }
        this.held = null;
        this.answer(request, reply);
    }
    private answer(request: Reply, reply: Reply): void {
        queueMicrotask(() => this.listener(JSON.stringify({ id: request.id, ...reply })));
    }
    on_line(callback: (line: string) => void): void {
        this.listener = callback;
    }
    close(): void {
        // A real bridge finishes the request in flight, then exits.
        this.closed = true;
        queueMicrotask(() => this.finish(''));
    }
    kill(): void {
        this.killed = true;
        this.finish('killed');
    }
    fatal(): string | null {
        return null;
    }
}

let tmp_dir: string;

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-open-'));
});

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
});

function options(bridge: FakeBridgeProcess, said: string[] = []): OpenOptions {
    return {
        env: { SIGHT_CONSOLE_TMPDIR: tmp_dir },
        columns: 80,
        say: (text) => said.push(text),
        start_bridge: () => bridge,
    };
}

/** A console's own new Stata: new, COM-started, found by its title. */
const OWN_SESSION: Record<string, Handler> = {
    connect: () => ({ ok: true, before: [], after: [{ pid: 10, start: 't10', com_started: true }] }),
    is_free: () => ({ ok: true, free: true }),
    do_sync: () => ({ ok: true, rc: 0 }),
    title_pid: () => ({ ok: true, pid: 10, start: 't10' }),
};

async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(condition()).toBe(true);
}

describe('open_automation_console', () => {
    it('stops with 85 when the COM helper can\'t be compiled, before any COM call', async () => {
        const bridge = new FakeBridgeProcess({
            prepare: () => ({ ok: false, error: 'native_unavailable', message: 'native_unavailable' }),
        });
        const result = await open_automation_console(options(bridge)).result;
        expect(result).toMatchObject({ ok: false, exit_code: EXIT_BRIDGE_BLOCKED });
        expect(bridge.ops).toEqual(['self_test', 'prepare']);
    });

    it('stops with 87 on an unsupported registration, naming it', async () => {
        const bridge = new FakeBridgeProcess({
            check_registration: () => ({
                ok: false, error: 'unsupported_registration', message: 'unsupported_registration',
                key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\AppID\\{X}', value: 'RunAs',
            }),
        });
        const result = await open_automation_console(options(bridge)).result;
        expect(result).toMatchObject({ ok: false, exit_code: EXIT_AUTOMATION_UNSUPPORTED });
        if (result.ok) {
            throw new Error('expected a refusal');
        }
        expect(result.message).toContain('HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\AppID\\{X}');
        expect(result.message).toContain('sets RunAs');
        expect(bridge.ops).not.toContain('list_stata');
        expect(bridge.ops).not.toContain('connect');
    });

    it('ends the bridge at once when cancelled before connecting', async () => {
        const bridge = new FakeBridgeProcess({ list_stata: () => 'hold' });
        const opening = open_automation_console(options(bridge));
        await until(() => bridge.ops.includes('list_stata'));
        expect(opening.cancel()).toBe('killed');
        expect(bridge.killed).toBe(true);
        expect(await opening.result).toMatchObject({ ok: false, exit_code: CANCELLED_STATUS });
        expect(bridge.ops).not.toContain('connect');
    });

    it('waits for Stata once connecting: a first cancel doesn\'t kill, a second does', async () => {
        const bridge = new FakeBridgeProcess({ connect: () => 'hold' });
        const opening = open_automation_console(options(bridge));
        await until(() => bridge.ops.includes('connect'));
        expect(opening.cancel()).toBe('graceful');
        expect(bridge.killed).toBe(false);
        expect(opening.cancel()).toBe('killed');
        expect(bridge.killed).toBe(true);
        expect(await opening.result).toMatchObject({ ok: false, exit_code: CANCELLED_STATUS });
    });

    it('ends its own new Stata when cancelled while connecting', async () => {
        const bridge = new FakeBridgeProcess({ ...OWN_SESSION, connect: () => 'hold' });
        const opening = open_automation_console(options(bridge));
        await until(() => bridge.ops.includes('connect'));
        expect(opening.cancel()).toBe('graceful');
        bridge.release(OWN_SESSION.connect({}) as Reply);
        expect(await opening.result).toMatchObject({ ok: false, exit_code: CANCELLED_STATUS });
        expect(bridge.ops).toContain('title_pid');
        // Closing stdin makes the bridge release Stata (closing it).
        expect(bridge.closed).toBe(true);
    });

    it('keeps a Stata it didn\'t start when cancelled while connecting', async () => {
        const said: string[] = [];
        const bridge = new FakeBridgeProcess({
            ...OWN_SESSION,
            connect: () => 'hold',
            title_pid: () => ({ ok: true, pid: 5, start: 't5' }),
        });
        const opening = open_automation_console(options(bridge, said));
        await until(() => bridge.ops.includes('connect'));
        opening.cancel();
        bridge.release({ ok: true, before: [{ pid: 5, start: 't5' }], after: [{ pid: 5, start: 't5' }] });
        const result = await opening.result;
        expect(result.ok).toBe(true);
        expect(bridge.closed).toBe(false);
        expect(said.some((my_text) => my_text.includes('Ctrl+C came while connecting'))).toBe(true);
    });
});

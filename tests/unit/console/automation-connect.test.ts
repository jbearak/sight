/**
 * Connect-sequence tests for sight console on Windows, with a scripted
 * fake bridge. They pin the ownership rules: the console never asks to
 * take over a window; it calls a Stata its own only when the title
 * marker finds a new, COM-started process (by pid and start time);
 * otherwise it keeps that Stata and says so. A cancel ends only the
 * console's own new Stata. The mutex is held until identification.
 */

import { describe, expect, it } from 'bun:test';
import type { Bridge, BridgeReply, RequestOptions } from '../../../src/console/automation/bridge';
import {
    CANCELLED_STATUS,
    connect_to_stata,
    type ConnectStage,
    type StataProcess,
} from '../../../src/console/automation/connect';

function stata(pid: number, extra: Partial<StataProcess> = {}): StataProcess {
    return { pid, start: `t${pid}`, title: `Stata/MP 18.0 #${pid}`, has_window: true, com_started: false, ...extra };
}

/** A new Stata COM started for the console. */
function fresh(pid: number): StataProcess {
    return stata(pid, { com_started: true, has_window: false, title: '' });
}

interface Script {
    before?: StataProcess[];
    after?: StataProcess[];
    /** The bridge's error reply to `connect`, instead of a session. */
    connect_error?: { error: string; hresult?: string; detail?: Record<string, unknown> };
    /** Reply to `connect` as if the bridge had ended. */
    connect_gone?: boolean;
    title_pid?: number | null;
    /** Start time `title_pid` reports (defaults to the listed one). */
    title_start?: string;
    title_rc?: number;
    vview_rc?: number;
    busy_polls?: number;
    /** `is_free` fails with this HRESULT. */
    free_hresult?: string;
    /** Called when `connect` is requested, before it's answered. */
    on_connect?: () => void;
    /** Called when `is_free` is requested. */
    on_free?: () => void;
    /** The bridge ends at this request. */
    gone_at?: 'do_sync' | 'title_pid';
}

class ScriptedBridge implements Bridge {
    ops: string[] = [];
    sync_commands: string[] = [];
    pid_writes: number[] = [];
    private busy_left: number;
    readonly ended = new Promise<string>(() => undefined);
    constructor(private readonly script: Script) {
        this.busy_left = script.busy_polls ?? 0;
    }
    request(op: string, params: Record<string, unknown> = {}, _options: RequestOptions = {}): Promise<BridgeReply> {
        this.ops.push(op);
        const ok = (value: Record<string, unknown>): Promise<BridgeReply> => Promise.resolve({ ok: true, value });
        if (op === this.script.gone_at) {
            return Promise.resolve({ ok: false, bridge_gone: true });
        }
        switch (op) {
            case 'list_stata':
                return ok({ processes: [] });
            case 'connect': {
                this.script.on_connect?.();
                const error = this.script.connect_error;
                if (error) {
                    return Promise.resolve({
                        ok: false,
                        failure: { error: error.error, hresult: error.hresult, detail: error.detail ?? {} },
                    });
                }
                if (this.script.connect_gone) {
                    return Promise.resolve({ ok: false, bridge_gone: true });
                }
                return ok({ before: this.script.before ?? [], after: this.script.after ?? [], drained: 0 });
            }
            case 'is_free':
                this.script.on_free?.();
                if (this.script.free_hresult) {
                    return Promise.resolve({
                        ok: false,
                        failure: { error: 'error', hresult: this.script.free_hresult, detail: {} },
                    });
                }
                if (this.busy_left > 0) {
                    this.busy_left--;
                    return ok({ free: false });
                }
                return ok({ free: true });
            case 'do_sync':
                this.sync_commands.push(String(params.cmd));
                if (String(params.cmd).startsWith('window manage')) {
                    return ok({ rc: this.script.title_rc ?? 0 });
                }
                if (String(params.cmd) === 'quietly which vview') {
                    return ok({ rc: this.script.vview_rc ?? 0 });
                }
                return ok({ rc: 0 });
            case 'title_pid': {
                const pid = this.script.title_pid ?? null;
                const listed = (this.script.after ?? []).find((my_process) => my_process.pid === pid);
                return ok({ pid, start: this.script.title_start ?? listed?.start ?? (pid === null ? null : `t${pid}`) });
            }
            case 'write_pid':
                this.pid_writes.push(Number(params.pid));
                return ok({});
            case 'short_path':
                return ok({ path: 'C:\\Users\\X\\AppData\\Local\\Temp\\SIGHT-~1\\ABC' });
            default:
                return ok({});
        }
    }
    close(): void {}
    kill(): void {}
}

function deps(bridge: Bridge, cancel?: { value: boolean }) {
    const said: string[] = [];
    const stages: ConnectStage[] = [];
    return {
        said,
        stages,
        deps: {
            bridge,
            say: (text: string) => said.push(text),
            sleep: () => Promise.resolve(),
            file_size: () => 1234,
            dir: 'C:\\tmp\\sight-console\\abc',
            root: 'C:\\tmp\\sight-console',
            token: 'abcdef0123456789',
            columns: 100,
            is_cancelled: () => cancel?.value ?? false,
            on_stage: (stage: ConnectStage) => stages.push(stage),
        },
    };
}

const NOT_STARTED = 'a Stata it didn\'t start';
const UNCONFIRMED = 'couldn\'t confirm which Stata window';

describe('connect_to_stata', () => {
    it('starts its own Stata when none is open, without a notice', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], title_pid: 10 });
        const { deps: d, said, stages } = deps(bridge);
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({
            ok: true, pid: 10, start_size: 1234, log_rc: 0, has_vview: true,
        });
        expect(said).toEqual([]);
        expect(stages).toEqual(['graceful', 'done']);
        expect(bridge.pid_writes).toEqual([10]);
        // The mutex is held until this console has identified its Stata.
        expect(bridge.ops.slice(0, 7)).toEqual([
            'list_stata', 'connect', 'is_free', 'do_sync', 'title_pid', 'write_pid', 'release_mutex',
        ]);
        expect(bridge.sync_commands).toEqual([
            'window manage maintitle "Stata - sight console abcdef01"',
            'set more off',
            'quietly which vview',
            'set linesize 100',
            'log using "C:\\Users\\X\\AppData\\Local\\Temp\\SIGHT-~1\\ABC\\out.log", text replace name(_scabcdef01)',
        ]);
    });

    it('asks nothing and says nothing when other Statas are open', async () => {
        const bridge = new ScriptedBridge({
            before: [stata(1), stata(2)],
            after: [stata(1), stata(2), fresh(10)],
            title_pid: 10,
        });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: 10 });
        expect(said).toEqual([]);
    });

    it('keeps a Stata that was open before, and says so', async () => {
        const bridge = new ScriptedBridge({ before: [stata(5)], after: [stata(5)], title_pid: 5 });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: 5 });
        expect(said.length).toBe(1);
        expect(said[0]).toContain(`${NOT_STARTED} (Stata/MP 18.0 #5)`);
        expect(said[0]).toContain('closes when the console ends');
        expect(bridge.pid_writes).toEqual([5]);
        expect(bridge.ops).toContain('release_mutex');
    });

    it('keeps a new Stata opened by hand meanwhile, and says so', async () => {
        const bridge = new ScriptedBridge({ before: [], after: [stata(12)], title_pid: 12 });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: 12 });
        expect(said[0]).toContain(NOT_STARTED);
    });

    it('treats a reused pid (another start time) as new', async () => {
        const bridge = new ScriptedBridge({
            before: [stata(10, { start: 'old' })],
            after: [fresh(10)],
            title_pid: 10,
        });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: 10 });
        expect(said).toEqual([]);
    });

    it('calls the Stata unconfirmed when its title can\'t be set, without a pid file', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], title_rc: 198 });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: null });
        expect(said[0]).toContain(UNCONFIRMED);
        expect(bridge.pid_writes).toEqual([]);
        expect(bridge.ops).not.toContain('title_pid');
        expect(bridge.ops).toContain('release_mutex');
    });

    it('calls it unconfirmed with two new Statas and no title match', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10), fresh(11)], title_pid: null });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: null });
        expect(said[0]).toContain(UNCONFIRMED);
        expect(bridge.pid_writes).toEqual([]);
    });

    it('calls it unconfirmed when the title pid\'s start time doesn\'t match', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], title_pid: 10, title_start: 'other' });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: null });
        expect(said[0]).toContain(UNCONFIRMED);
        expect(bridge.pid_writes).toEqual([]);
    });

    it('calls it unconfirmed when the bridge could not list Statas afterwards', async () => {
        const bridge = new ScriptedBridge({ after: [], title_pid: 10 });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: null });
        expect(said[0]).toContain(UNCONFIRMED);
    });

    it('keeps Stata, unconfirmed, when waiting for it fails other than Stata being gone', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], title_pid: 10, free_hresult: '0x80004005' });
        const { deps: d, said } = deps(bridge);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: null });
        expect(said[0]).toContain(UNCONFIRMED);
        expect(bridge.sync_commands[0]).not.toContain('window manage');
    });

    it.each(['do_sync', 'title_pid'] as const)('ends when the bridge is gone at %s, not keeping a dead session', async (op) => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], title_pid: 10, gone_at: op });
        const { deps: d, said } = deps(bridge);
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({ ok: false, exit_code: 1 });
        expect(said).toEqual([]);
        expect(bridge.ops).not.toContain('release_mutex');
    });

    it('ends when Stata is gone while waiting for it', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], free_hresult: '0x800706BA' });
        const result = await connect_to_stata(deps(bridge).deps);
        expect(result).toMatchObject({ ok: false, exit_code: 1 });
    });

    it.each([
        ['drain_failed', { hresult: '0x80004005' }, 'couldn\'t make sure that no open Stata is handed to it (0x80004005)'],
        ['drain_limit', { count: 16 }, 'More than 16 Stata windows are open'],
        ['drain_launched', { stray_pid: 4242 }, 'process 4242'],
        ['session_failed', { hresult: '0x80080005', stray_pid: 77 }, 'could not start Stata (0x80080005). A Stata started meanwhile (process 77)'],
        ['session_failed', { wrap_failed: true }, 'couldn\'t be used, so it was closed'],
    ] as const)('reports a %s connect error and sends nothing more', async (error, detail, text) => {
        // As BridgeClient parses it: hresult is its own field.
        const { hresult, ...rest } = detail as Record<string, unknown>;
        const bridge = new ScriptedBridge({
            connect_error: { error, hresult: typeof hresult === 'string' ? hresult : undefined, detail: rest },
        });
        const result = await connect_to_stata(deps(bridge).deps);
        expect(result).toMatchObject({ ok: false, exit_code: 1 });
        if (result.ok) {
            throw new Error('expected a failure');
        }
        expect(result.message).toContain(text);
        expect(bridge.ops).toEqual(['list_stata', 'connect']);
    });

    it('notes when Sight\'s vview isn\'t installed', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], title_pid: 10, vview_rc: 111 });
        const result = await connect_to_stata(deps(bridge).deps);
        expect(result).toMatchObject({ ok: true, has_vview: false, log_rc: 0 });
    });

    it('sends nothing until Stata is free', async () => {
        const bridge = new ScriptedBridge({ after: [fresh(10)], title_pid: 10, busy_polls: 3 });
        await connect_to_stata(deps(bridge).deps);
        const first_sync = bridge.ops.indexOf('do_sync');
        const last_free = bridge.ops.lastIndexOf('is_free');
        expect(first_sync).toBeGreaterThan(last_free);
        expect(bridge.ops.filter((my_op) => my_op === 'is_free').length).toBe(4);
    });

    describe('cancelling', () => {
        it('never sends connect after a cancel during the listing', async () => {
            const cancel = { value: true };
            const bridge = new ScriptedBridge({});
            const { deps: d, stages } = deps(bridge, cancel);
            const result = await connect_to_stata(d);
            expect(result).toMatchObject({ ok: false, exit_code: CANCELLED_STATUS, cancelled: true });
            expect(bridge.ops).toEqual(['list_stata']);
            expect(stages).toEqual(['done']);
        });

        it('ends its own new Stata after identifying it', async () => {
            const cancel = { value: false };
            const bridge = new ScriptedBridge({
                after: [fresh(10)], title_pid: 10, on_connect: () => { cancel.value = true; },
            });
            const result = await connect_to_stata(deps(bridge, cancel).deps);
            expect(result).toMatchObject({ ok: false, exit_code: CANCELLED_STATUS, cancelled: true });
            expect(bridge.ops).toContain('title_pid');
            expect(bridge.ops).toContain('release_mutex');
            expect(bridge.ops).not.toContain('short_path');
        });

        it('waits for identification when cancelled while Stata is busy', async () => {
            const cancel = { value: false };
            const bridge = new ScriptedBridge({
                after: [fresh(10)], title_pid: 10, busy_polls: 2, on_free: () => { cancel.value = true; },
            });
            const result = await connect_to_stata(deps(bridge, cancel).deps);
            expect(result).toMatchObject({ ok: false, exit_code: CANCELLED_STATUS });
            expect(bridge.ops).toContain('title_pid');
        });

        it('keeps a Stata it didn\'t start, and says why', async () => {
            const cancel = { value: false };
            const bridge = new ScriptedBridge({
                before: [stata(5)], after: [stata(5)], title_pid: 5,
                on_connect: () => { cancel.value = true; },
            });
            const { deps: d, said } = deps(bridge, cancel);
            expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: 5 });
            expect(said[0]).toContain(NOT_STARTED);
            expect(said[1]).toContain('Ctrl+C came while connecting');
        });

        it('keeps an unconfirmed Stata too', async () => {
            const cancel = { value: false };
            const bridge = new ScriptedBridge({
                after: [fresh(10)], title_rc: 198, on_connect: () => { cancel.value = true; },
            });
            const { deps: d, said } = deps(bridge, cancel);
            expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: null });
            expect(said[0]).toContain(UNCONFIRMED);
        });

        it('reports a connect error rather than a silent cancel', async () => {
            const cancel = { value: false };
            const bridge = new ScriptedBridge({
                connect_error: { error: 'session_failed', detail: { stray_pid: 9 } },
                on_connect: () => { cancel.value = true; },
            });
            const result = await connect_to_stata(deps(bridge, cancel).deps);
            expect(result).toMatchObject({ ok: false, exit_code: 1 });
        });

        it('returns cancelled when a forced stop ended the bridge', async () => {
            const cancel = { value: false };
            const bridge = new ScriptedBridge({
                connect_gone: true, on_connect: () => { cancel.value = true; },
            });
            const result = await connect_to_stata(deps(bridge, cancel).deps);
            expect(result).toMatchObject({ ok: false, exit_code: CANCELLED_STATUS });
        });
    });
});

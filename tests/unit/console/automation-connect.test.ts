/**
 * Connect-sequence tests for sight console on Windows, with a scripted
 * fake bridge. They pin the ownership rules: no COM call before
 * consent, a refusal when several Statas are open, ending at once when
 * the open Stata is held elsewhere, asking after the fact when an
 * unexpected Stata answered, and keeping the mutex when this console's
 * Stata can't be identified.
 */

import { describe, expect, it } from 'bun:test';
import type { Bridge, BridgeReply, RequestOptions } from '../../../src/console/automation/bridge';
import {
    connect_to_stata,
    type ConnectAnswer,
    type ConnectQuestion,
    type StataProcess,
} from '../../../src/console/automation/connect';
import {
    EXIT_SEND_FROM_EDITOR,
    EXIT_SEVERAL_STATA_OPEN,
    EXIT_STATA_HELD_ELSEWHERE,
    EXIT_TAKEOVER_DECLINED,
} from '../../../src/console/automation/exit-codes';

function stata(pid: number, extra: Partial<StataProcess> = {}): StataProcess {
    return { pid, start: `t${pid}`, title: `Stata/MP 18.0 #${pid}`, has_window: true, com_started: false, ...extra };
}

interface Script {
    open: StataProcess[][];
    before?: StataProcess[];
    after?: StataProcess[];
    title_pid?: number | null;
    title_rc?: number;
    vview_rc?: number;
    busy_polls?: number;
}

class ScriptedBridge implements Bridge {
    ops: string[] = [];
    sync_commands: string[] = [];
    private listing_index = 0;
    private busy_left: number;
    readonly ended = new Promise<string>(() => undefined);
    constructor(private readonly script: Script) {
        this.busy_left = script.busy_polls ?? 0;
    }
    private listing(): StataProcess[] {
        const listings = this.script.open;
        const index = Math.min(this.listing_index, listings.length - 1);
        return listings[index] ?? [];
    }
    request(op: string, params: Record<string, unknown> = {}, _options: RequestOptions = {}): Promise<BridgeReply> {
        this.ops.push(op);
        const ok = (value: Record<string, unknown>): Promise<BridgeReply> => Promise.resolve({ ok: true, value });
        switch (op) {
            case 'list_stata':
                return ok({ processes: this.listing() });
            case 'connect': {
                const expect = (params.expect as number[]).join(',');
                this.listing_index++;
                const now = this.listing().map((my_process) => my_process.pid).join(',');
                if (this.listing_index < this.script.open.length && now !== expect) {
                    return ok({ listing_changed: true, processes: this.listing() });
                }
                return ok({ listing_changed: false, before: this.script.before ?? [], after: this.script.after ?? [] });
            }
            case 'is_free':
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
            case 'title_pid':
                return ok({ pid: this.script.title_pid ?? null });
            case 'short_path':
                return ok({ path: 'C:\\Users\\X\\AppData\\Local\\Temp\\SIGHT-~1\\ABC' });
            default:
                return ok({});
        }
    }
    close(): void {}
    kill(): void {}
}

function deps(bridge: Bridge, answers: string[] = [], extra: { yes?: boolean; from_editor?: boolean } = {}) {
    const questions: ConnectQuestion[] = [];
    const said: string[] = [];
    return {
        questions,
        said,
        deps: {
            bridge,
            ask: (question: ConnectQuestion): Promise<ConnectAnswer> => {
                questions.push(question);
                const answer = answers.shift() ?? '';
                return Promise.resolve(answer === 'y' ? 'yes' : answer === 's' ? 'send' : 'no');
            },
            say: (text: string) => said.push(text),
            sleep: () => Promise.resolve(),
            file_size: () => 1234,
            dir: 'C:\\tmp\\sight-console\\abc',
            root: 'C:\\tmp\\sight-console',
            token: 'abcdef0123456789',
            yes: extra.yes ?? false,
            from_editor: extra.from_editor ?? false,
            columns: 100,
        },
    };
}

describe('connect_to_stata', () => {
    it('starts a new Stata when none is open, without asking', async () => {
        const bridge = new ScriptedBridge({
            open: [[]],
            after: [stata(10, { com_started: true })],
            title_pid: 10,
        });
        const { deps: d, questions } = deps(bridge);
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({
            ok: true, pid: 10, start_size: 1234, log_rc: 0, has_vview: true,
        });
        expect(questions).toEqual([]);
        expect(bridge.ops).toContain('release_mutex');
        expect(bridge.sync_commands).toEqual([
            'window manage maintitle "Stata - sight console abcdef01"',
            'set more off',
            'quietly which vview',
            'set linesize 100',
            'log using "C:\\Users\\X\\AppData\\Local\\Temp\\SIGHT-~1\\ABC\\out.log", text replace name(_scabcdef01)',
        ]);
    });

    it('refuses when two or more Statas are open, before any COM call', async () => {
        const bridge = new ScriptedBridge({ open: [[stata(1), stata(2)]] });
        const result = await connect_to_stata(deps(bridge).deps);
        expect(result).toMatchObject({ ok: false, exit_code: EXIT_SEVERAL_STATA_OPEN });
        expect(bridge.ops).not.toContain('connect');
    });

    it('asks before taking over the open Stata, and stops on no', async () => {
        const bridge = new ScriptedBridge({ open: [[stata(5)]] });
        const { deps: d, questions } = deps(bridge, ['n']);
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({ ok: false, exit_code: EXIT_TAKEOVER_DECLINED });
        expect(questions[0]).toMatchObject({ kind: 'take_over', allow_send_instead: false });
        expect(bridge.ops).not.toContain('connect');
    });

    it('offers s from the editor and makes no COM call for it', async () => {
        const bridge = new ScriptedBridge({ open: [[stata(5)]] });
        const { deps: d, questions } = deps(bridge, ['s'], { from_editor: true });
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({ ok: false, exit_code: EXIT_SEND_FROM_EDITOR });
        expect(questions[0]).toMatchObject({ kind: 'take_over', allow_send_instead: true });
        expect(bridge.ops).not.toContain('connect');
    });

    it('shares the open Stata on yes', async () => {
        const bridge = new ScriptedBridge({ open: [[stata(5)]], before: [stata(5)], after: [stata(5)], title_pid: 5 });
        const result = await connect_to_stata(deps(bridge, ['y']).deps);
        expect(result).toMatchObject({ ok: true, pid: 5 });
    });

    it('skips the question with --yes', async () => {
        const bridge = new ScriptedBridge({ open: [[stata(5)]], before: [stata(5)], after: [stata(5)], title_pid: 5 });
        const { deps: d, questions } = deps(bridge, [], { yes: true });
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: 5 });
        expect(questions).toEqual([]);
    });

    it('ends at once when COM started a new Stata instead of the shared one', async () => {
        const bridge = new ScriptedBridge({
            open: [[stata(5)]],
            before: [stata(5)],
            after: [stata(5), stata(11, { com_started: true })],
        });
        const result = await connect_to_stata(deps(bridge, ['y']).deps);
        expect(result).toMatchObject({ ok: false, exit_code: EXIT_STATA_HELD_ELSEWHERE });
        expect(bridge.ops).not.toContain('do_sync');
    });

    it('notes when Sight\'s vview isn\'t installed', async () => {
        const bridge = new ScriptedBridge({
            open: [[]],
            after: [stata(10, { com_started: true })],
            title_pid: 10,
            vview_rc: 111,
        });
        const { deps: d } = deps(bridge);
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({ ok: true, has_vview: false, log_rc: 0 });
    });

    it('asks again when the set of open Statas changed before connecting', async () => {
        const bridge = new ScriptedBridge({
            open: [[], [stata(7)], [stata(7)]],
            before: [stata(7)],
            after: [stata(7)],
            title_pid: 7,
        });
        const { deps: d, questions } = deps(bridge, ['y']);
        expect(await connect_to_stata(d)).toMatchObject({ ok: true, pid: 7 });
        expect(questions.length).toBe(1);
    });

    it('asks after the fact when a Stata nobody agreed to answered', async () => {
        const bridge = new ScriptedBridge({
            open: [[]],
            before: [],
            after: [stata(12, { com_started: false, title: 'Stata/MP 18.0' })],
            title_pid: 12,
        });
        const { deps: d, questions } = deps(bridge, ['n']);
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({ ok: false, exit_code: 0 });
        expect(questions.length).toBe(1);
        expect(questions[0]?.kind).toBe('keep');
        expect(questions[0]?.text).toContain('just opened');
    });

    it('keeps the mutex when its Stata cannot be identified', async () => {
        const bridge = new ScriptedBridge({
            open: [[]],
            before: [],
            after: [],
            title_rc: 198,
        });
        const { deps: d, questions } = deps(bridge, ['y']);
        const result = await connect_to_stata(d);
        expect(result).toMatchObject({ ok: true, pid: null });
        expect(questions[0]?.text).toContain('couldn\'t identify');
        expect(bridge.ops).not.toContain('release_mutex');
    });

    it('sends nothing until Stata is free', async () => {
        const bridge = new ScriptedBridge({
            open: [[stata(5)]],
            before: [stata(5)],
            after: [stata(5)],
            title_pid: 5,
            busy_polls: 3,
        });
        await connect_to_stata(deps(bridge, ['y']).deps);
        const first_sync = bridge.ops.indexOf('do_sync');
        const last_free = bridge.ops.lastIndexOf('is_free');
        expect(first_sync).toBeGreaterThan(last_free);
        expect(bridge.ops.filter((my_op) => my_op === 'is_free').length).toBe(4);
    });
});

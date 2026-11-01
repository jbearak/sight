/**
 * The VS Code-free part of running Sight's Stata console in a Perch
 * session (client/src/send-to-stata/perch-core.ts): escaping, the
 * launch, and finding Perch and Sight's sessions.
 */

import { describe, expect, test } from 'bun:test';
import {
    build_perch_launch,
    candidate_sessions,
    escape_perch_braces,
    PerchConnection,
    type PerchExtensionLike,
    type PerchTracked,
    type PerchTrackingApi,
} from '../../../client/src/send-to-stata/perch-core';
import type { PerchSessionInfo } from '../../../client/src/send-to-stata/perch-api';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

function create_deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((the_resolve) => {
        resolve = the_resolve;
    });
    return { promise, resolve };
}

function session(id: string, overrides: Partial<PerchSessionInfo> = {}): PerchSessionInfo {
    return {
        id,
        name: 'Stata',
        kind: 'stata',
        owner: 'jbearak.sight',
        annotations: {},
        dir: `/tmp/perch-1000/${id}`,
        degraded: [],
        cwd: '/work',
        host: 'h',
        createdAt: '2026-11-01T00:00:00Z',
        state: 'running',
        attached: false,
        attachedHere: false,
        ...overrides,
    };
}

type Terminal = { name: string };

class FakeApi implements PerchTrackingApi<Terminal> {
    is_available = true;
    the_terminals: Array<{ session: PerchSessionInfo; terminal: Terminal }> = [];
    the_listed: PerchSessionInfo[] = [];
    list_gate: Promise<void> | null = null;
    the_filters: unknown[] = [];
    private readonly the_attach: Array<(event: { session: PerchSessionInfo; terminal: Terminal }) => unknown> = [];
    private readonly the_end: Array<(event: PerchSessionInfo) => unknown> = [];

    available = async () => this.is_available;
    terminals = () => this.the_terminals;
    listSessions = async (filter?: unknown) => {
        this.the_filters.push(filter);
        await this.list_gate;
        return this.the_listed;
    };
    onDidAttach = (listener: (event: { session: PerchSessionInfo; terminal: Terminal }) => unknown) => {
        this.the_attach.push(listener);
        return { dispose: () => this.the_attach.splice(this.the_attach.indexOf(listener), 1) };
    };
    onDidEndSession = (listener: (event: PerchSessionInfo) => unknown) => {
        this.the_end.push(listener);
        return { dispose: () => this.the_end.splice(this.the_end.indexOf(listener), 1) };
    };
    attach(info: PerchSessionInfo, terminal: Terminal): void {
        for (const my_listener of [...this.the_attach]) {
            my_listener({ session: info, terminal });
        }
    }
    end(info: PerchSessionInfo): void {
        for (const my_listener of [...this.the_end]) {
            my_listener(info);
        }
    }
    listener_count(): number {
        return this.the_attach.length + this.the_end.length;
    }
}

interface Harness {
    connection: PerchConnection<FakeApi, Terminal>;
    the_connected: Array<{ api: FakeApi | undefined; tracked: PerchTracked<Terminal> }>;
    the_attached: string[];
    the_ended: string[];
    the_logged: string[];
    state: {
        remote: boolean;
        extension: PerchExtensionLike | undefined;
        find_count: number;
    };
}

function create_harness(api: FakeApi | null, overrides: Partial<Harness['state']> = {}): Harness {
    const state: Harness['state'] = {
        remote: true,
        extension: api === null ? undefined : {
            isActive: true,
            exports: { getApi: (version: number, caller: string) => (version === 1 && caller === 'jbearak.sight' ? api : undefined) },
            activate: async () => undefined,
        },
        find_count: 0,
        ...overrides,
    };
    const harness: Harness = {
        the_connected: [],
        the_attached: [],
        the_ended: [],
        the_logged: [],
        state,
        connection: new PerchConnection<FakeApi, Terminal>({
            is_remote_workspace: () => state.remote,
            find_extension: () => {
                state.find_count += 1;
                return state.extension;
            },
            to_api: (value) => (value instanceof FakeApi ? value : undefined),
            log: (message) => harness.the_logged.push(message),
            on_connected: (connected_api, tracked) => harness.the_connected.push({ api: connected_api, tracked }),
            on_attach: (info) => harness.the_attached.push(info.id),
            on_end: (info) => harness.the_ended.push(info.id),
        }),
    };
    return harness;
}

describe('escape_perch_braces', () => {
    test('doubles every brace, including in {dir} and {id}', () => {
        expect(escape_perch_braces('/a/{dir}/b}{/{id}')).toBe('/a/{{dir}}/b}}{{/{{id}}');
        expect(escape_perch_braces('no braces')).toBe('no braces');
    });
});

describe('build_perch_launch', () => {
    test('the editor console: escaped strings, raw {dir}, cwd unexpanded', () => {
        const options = build_perch_launch({
            mode: 'editor',
            stata_path: '/st{a}ta',
            working_directory: '/w{dir}',
            first_send: { command: 'do', quoted_path: '`"/t/{id}.do"\'' },
            editor: { node_path: '/n{o}de', tty_script: '/x/tty.js', helper_path: '/h}' },
        });
        expect(options).toEqual({
            name: 'Stata',
            kind: 'stata',
            cwd: '/w{dir}',
            annotations: { 'sight.console': 'editor' },
            env: { ELECTRON_RUN_AS_NODE: '1' },
            command: [
                '/n{{o}}de', '/x/tty.js',
                '--helper', '/h}}',
                '--stata', '/st{{a}}ta',
                '--ready-file', '{dir}/sight-console-ready',
                '--end-file', '{dir}/sight-console-end',
                '--cwd', '/w{{dir}}',
                '--run', 'do `"/t/{{id}}.do"\'',
            ],
        });
    });

    test('the Stata CLI: the first send as two arguments', () => {
        expect(build_perch_launch({
            mode: 'stata',
            stata_path: '/st{a}ta',
            first_send: { command: 'include', quoted_path: '`"/t/}x.do"\'' },
        })).toEqual({
            name: 'Stata',
            kind: 'stata',
            annotations: { 'sight.console': 'stata' },
            command: ['/st{{a}}ta', 'include', '`"/t/}}x.do"\''],
        });
    });
});

describe('PerchConnection', () => {
    test('a local window never looks for the extension', async () => {
        const harness = create_harness(new FakeApi(), { remote: false });
        expect(harness.connection.may_use_perch()).toBe(false);
        await harness.connection.connect();
        expect(harness.state.find_count).toBe(0);
        expect(harness.connection.api).toBeUndefined();
    });

    test('no extension, an unusable getApi, or unavailable Perch: no API', async () => {
        const none = create_harness(null);
        await none.connection.connect();
        expect(none.connection.api).toBeUndefined();

        const unavailable_api = new FakeApi();
        unavailable_api.is_available = false;
        const unavailable = create_harness(unavailable_api);
        await unavailable.connection.connect();
        expect(unavailable.connection.api).toBeUndefined();

        const no_get_api = create_harness(new FakeApi(), {
            extension: { isActive: true, exports: {}, activate: async () => ({}) },
        });
        await no_get_api.connection.connect();
        expect(no_get_api.connection.api).toBeUndefined();
    });

    test('activates Perch if needed; a rejection is logged, never thrown', async () => {
        const api = new FakeApi();
        let activations = 0;
        const harness = create_harness(api, {
            extension: {
                isActive: false,
                exports: undefined,
                activate: async () => {
                    activations += 1;
                    throw new Error('activation failed');
                },
            },
        });
        await harness.connection.connect();
        expect(activations).toBe(1);
        expect(harness.connection.api).toBeUndefined();
        expect(harness.the_connected).toEqual([]);
        expect(harness.the_logged).toEqual(['Perch lookup failed: activation failed']);
    });

    test('adopts Sight\'s terminals and lists only Sight\'s sessions', async () => {
        const api = new FakeApi();
        const here = session('aaaaaaaa');
        const elsewhere = session('bbbbbbbb');
        const others = session('cccccccc', { owner: 'jbearak.raven-r' });
        const ended = session('dddddddd', { state: 'exited' });
        api.the_terminals = [
            { session: here, terminal: { name: 'here' } },
            { session: others, terminal: { name: 'raven' } },
        ];
        api.the_listed = [here, elsewhere, ended];
        const harness = create_harness(api);
        await harness.connection.connect();
        expect(api.the_filters).toEqual([{ owner: 'jbearak.sight' }]);
        const tracked = harness.connection.tracked;
        expect([...tracked.terminals.keys()]).toEqual(['aaaaaaaa']);
        expect([...tracked.sessions.keys()].sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
        expect(candidate_sessions(tracked, () => false).map(my_session => my_session.id))
            .toEqual(['bbbbbbbb']);
        expect(candidate_sessions(tracked, (id) => id === 'bbbbbbbb')).toEqual([]);
    });

    test('an attach or end during the listing wins over the listing', async () => {
        const api = new FakeApi();
        const restored = session('aaaaaaaa');
        const opened = session('bbbbbbbb');
        api.the_terminals = [{ session: restored, terminal: { name: 'restored' } }];
        api.the_listed = [restored];
        const gate = create_deferred<void>();
        api.list_gate = gate.promise;
        const harness = create_harness(api);
        const connecting = harness.connection.connect();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        api.end({ ...restored, state: 'exited' });
        api.attach(opened, { name: 'opened' });
        // Not yet current: nothing reported until the swap.
        expect(harness.the_attached).toEqual([]);
        expect(harness.the_ended).toEqual([]);
        gate.resolve();
        await connecting;
        const tracked = harness.connection.tracked;
        expect([...tracked.terminals.keys()]).toEqual(['bbbbbbbb']);
        expect(tracked.sessions.has('aaaaaaaa')).toBe(false);
    });

    test('events after the swap are reported', async () => {
        const api = new FakeApi();
        const harness = create_harness(api);
        await harness.connection.connect();
        api.attach(session('aaaaaaaa'), { name: 'a' });
        api.attach(session('rrrrrrrr', { owner: 'jbearak.raven-r' }), { name: 'r' });
        api.end(session('aaaaaaaa', { state: 'exited' }));
        expect(harness.the_attached).toEqual(['aaaaaaaa']);
        expect(harness.the_ended).toEqual(['aaaaaaaa']);
        expect(harness.connection.tracked.sessions.size).toBe(0);
    });

    test('a superseded lookup is discarded and its events unsubscribed', async () => {
        const api = new FakeApi();
        const gate = create_deferred<void>();
        api.list_gate = gate.promise;
        api.the_listed = [session('aaaaaaaa')];
        const harness = create_harness(api);
        const first = harness.connection.connect();
        await new Promise((resolve) => setTimeout(resolve, 0));
        api.list_gate = null;
        api.the_listed = [session('bbbbbbbb')];
        const second = harness.connection.connect();
        await second;
        gate.resolve();
        await first;
        expect(harness.the_connected).toHaveLength(1);
        expect([...harness.connection.tracked.sessions.keys()]).toEqual(['bbbbbbbb']);
        // Only the current lookup's two listeners remain.
        expect(api.listener_count()).toBe(2);
    });

    test('dispose stops reporting', async () => {
        const api = new FakeApi();
        const harness = create_harness(api);
        await harness.connection.connect();
        harness.connection.dispose();
        expect(api.listener_count()).toBe(0);
    });
});

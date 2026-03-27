import { describe, it, expect } from 'bun:test';
import {
    LanguageClientLifecycle,
    ManagedLanguageClient,
} from '../../client/src/language-client-lifecycle';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}

function create_deferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((the_resolve, the_reject) => {
        resolve = the_resolve;
        reject = the_reject;
    });
    return { promise, resolve, reject };
}

function next_tick(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('LanguageClientLifecycle', () => {
    it('stops the client after startup settles during deactivation', async () => {
        const start_deferred = create_deferred<void>();
        let stop_calls = 0;
        let started_hook_calls = 0;

        const the_client: ManagedLanguageClient = {
            start: () => start_deferred.promise,
            stop: async () => {
                stop_calls += 1;
            },
        };

        const my_lifecycle = new LanguageClientLifecycle(
            { appendLine: () => {} },
            {
                on_started: () => {
                    started_hook_calls += 1;
                },
            },
            {
                startup_timeout_ms: 5,
                stop_timeout_ms: 50,
            }
        );

        void my_lifecycle.start_client(the_client).catch(() => {});
        await my_lifecycle.deactivate();

        expect(stop_calls).toBe(0);
        expect(started_hook_calls).toBe(0);

        start_deferred.resolve();
        await next_tick();

        expect(stop_calls).toBe(1);
        expect(started_hook_calls).toBe(0);
    });

    it('does not stop a client whose startup failed', async () => {
        let stop_calls = 0;
        const the_error = new Error('startup failed');

        const the_client: ManagedLanguageClient = {
            start: async () => {
                throw the_error;
            },
            stop: async () => {
                stop_calls += 1;
            },
        };

        const my_lifecycle = new LanguageClientLifecycle(
            { appendLine: () => {} }
        );

        await expect(
            my_lifecycle.start_client(the_client)
        ).rejects.toThrow('startup failed');

        await my_lifecycle.deactivate();

        expect(stop_calls).toBe(0);
    });

    it('shares a single stop operation across repeated deactivate calls', async () => {
        const stop_deferred = create_deferred<void>();
        let stop_calls = 0;

        const the_client: ManagedLanguageClient = {
            start: async () => {},
            stop: async () => {
                stop_calls += 1;
                await stop_deferred.promise;
            },
        };

        const my_lifecycle = new LanguageClientLifecycle(
            { appendLine: () => {} },
            undefined,
            {
                startup_timeout_ms: 50,
                stop_timeout_ms: 50,
            }
        );

        await my_lifecycle.start_client(the_client);

        const first_deactivate = my_lifecycle.deactivate();
        const second_deactivate = my_lifecycle.deactivate();

        await next_tick();
        expect(stop_calls).toBe(1);

        stop_deferred.resolve();
        await Promise.all([first_deactivate, second_deactivate]);

        expect(stop_calls).toBe(1);
    });

    it('deactivate with no client resets deactivating so next start fires on_started', async () => {
        let started_hook_calls = 0;

        const the_client: ManagedLanguageClient = {
            start: async () => {},
            stop: async () => {},
        };

        const my_lifecycle = new LanguageClientLifecycle(
            { appendLine: () => {} },
            {
                on_started: () => {
                    started_hook_calls += 1;
                },
            }
        );

        // Deactivate before any client was started
        await my_lifecycle.deactivate();

        // Now start a client — on_started should fire
        await my_lifecycle.start_client(the_client);
        expect(started_hook_calls).toBe(1);
    });

    it('start_client with a new client does not reuse the old start_promise', async () => {
        let start_calls_a = 0;
        let start_calls_b = 0;

        const client_a: ManagedLanguageClient = {
            start: async () => { start_calls_a += 1; },
            stop: async () => {},
        };
        const client_b: ManagedLanguageClient = {
            start: async () => { start_calls_b += 1; },
            stop: async () => {},
        };

        const my_lifecycle = new LanguageClientLifecycle(
            { appendLine: () => {} },
            undefined,
            { startup_timeout_ms: 50, stop_timeout_ms: 50 }
        );

        await my_lifecycle.start_client(client_a);
        expect(start_calls_a).toBe(1);

        await my_lifecycle.deactivate();

        await my_lifecycle.start_client(client_b);
        expect(start_calls_b).toBe(1);
    });

    it('start_client waits for in-flight stop before starting new client', async () => {
        const stop_deferred = create_deferred<void>();
        let start_calls_b = 0;
        let started_hook_calls = 0;

        const client_a: ManagedLanguageClient = {
            start: async () => {},
            stop: () => stop_deferred.promise,
        };
        const client_b: ManagedLanguageClient = {
            start: async () => { start_calls_b += 1; },
            stop: async () => {},
        };

        const my_lifecycle = new LanguageClientLifecycle(
            { appendLine: () => {} },
            {
                on_started: () => {
                    started_hook_calls += 1;
                },
            },
            { startup_timeout_ms: 50, stop_timeout_ms: 500 }
        );

        await my_lifecycle.start_client(client_a);
        expect(started_hook_calls).toBe(1);

        // Begin deactivation (stop is slow)
        const deactivate_promise = my_lifecycle.deactivate();

        // Start new client while stop is in-flight
        const start_b_promise = my_lifecycle.start_client(client_b);

        // B should not have started yet — still waiting for A's stop
        await next_tick();
        expect(start_calls_b).toBe(0);

        // Let A's stop complete
        stop_deferred.resolve();
        await deactivate_promise;
        await start_b_promise;

        // Now B should have started and on_started should fire
        expect(start_calls_b).toBe(1);
        expect(started_hook_calls).toBe(2);
    });

    it('calls the started hook when startup completes before deactivation', async () => {
        let started_hook_calls = 0;

        const the_client: ManagedLanguageClient = {
            start: async () => {},
            stop: async () => {},
        };

        const my_lifecycle = new LanguageClientLifecycle(
            { appendLine: () => {} },
            {
                on_started: () => {
                    started_hook_calls += 1;
                },
            }
        );

        await my_lifecycle.start_client(the_client);

        expect(started_hook_calls).toBe(1);
    });
});

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

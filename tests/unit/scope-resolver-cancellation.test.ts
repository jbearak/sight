import { describe, expect, it } from 'bun:test';
import { CancellationTokenSource } from 'vscode-languageserver';
import { create_empty_symbol_table } from '../../src/analyzer';
import { ScopeResolver } from '../../src/scope-resolver';

describe('ScopeResolver cancellation', () => {
    it('does not cache a partial forward scope after cancellation', async () => {
        const resolver = new ScopeResolver();
        const cancellation_source = new CancellationTokenSource();
        let resolve_count = 0;
        let release_forward: (() => void) | undefined;
        let forward_started: (() => void) | undefined;
        const first_forward_start = new Promise<void>(resolve => {
            forward_started = resolve;
        });
        const first_forward_gate = new Promise<void>(resolve => {
            release_forward = resolve;
        });

        resolver.set_forward_scope_resolver({
            filter_calls_before_line: calls => calls,
            resolve: async () => {
                resolve_count++;
                if (resolve_count === 1) {
                    forward_started?.();
                    await first_forward_gate;
                }
                return {
                    symbols: create_empty_symbol_table(),
                    call_sites: [],
                    diagnostics: [],
                };
            },
        });

        const uri = 'file:///scope-cancellation.do';
        const content = 'do "child.do"\n';
        const cancelled_resolve = resolver.resolve(
            uri,
            content,
            {},
            cancellation_source.token
        );
        await first_forward_start;
        cancellation_source.cancel();
        release_forward?.();
        await cancelled_resolve;

        expect(resolver.get_cache_sizes().scope).toBe(0);

        await resolver.resolve(uri, content);
        expect(resolve_count).toBe(2);
        expect(resolver.get_cache_sizes().scope).toBe(1);
        cancellation_source.dispose();
    });
});

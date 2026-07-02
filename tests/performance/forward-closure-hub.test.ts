/**
 * Issue #209/#234 — hub-heavy forward-call performance coverage.
 *
 * A parent runs N sibling files before its child; every sibling sources one
 * shared hub. This is the dense shape that motivated the forward-closure
 * memo. The guards here are REGRESSION guards, not timing benchmarks:
 * resolving the child must keep file reads BOUNDED (no accidental O(N^2)
 * blowup in full-workspace `sight check`), and enabling the memo must never
 * ADD reads.
 *
 * Note: the persistent `file_cache` already dedupes disk READS (the shared
 * hub is read once even with N siblings), so reads are a cache-busting
 * regression guard, not where the memo's win shows. The memo targets closure
 * RE-COMPUTATION across callers (CPU, not I/O): the N→1 scenario below
 * resolves N root files that all traverse one shared chain and asserts, via
 * the memo's recomputation counter (#234), that the chain's closures are
 * computed once and served to every later caller.
 */

import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ContentProvider } from '../../src/types';
import { describe, it, expect } from 'bun:test';
import { URI } from 'vscode-uri';

const N_SIBLINGS = 20;

function build_hub_workspace(): {
    resolver: ScopeResolver;
    forward: ForwardScopeResolver;
    read_counts: Map<string, number>;
    child_uri: string;
    child_content: string;
} {
    const read_counts = new Map<string, number>();

    // parent.do: run sibling_0 .. run sibling_{N-1}, then do child.do
    const sibling_runs = Array.from({ length: N_SIBLINGS },
        (_unused, i) => `run "sibling_${i}.do"`).join('\n');
    const parent_content = `${sibling_runs}\ndo "child.do"\n`;
    // Each sibling sources the shared hub, then defines its own global.
    const sibling_content = (i: number) =>
        `run "hub.do"\nglobal sib_${i}_g 1\n`;
    const hub_content = `global hub_shared_g 1\n`;
    const child_content =
        `* @lsp-done-by: "parent.do" match="child.do"\n` +
        `display "\${hub_shared_g}"\n`;

    const content_for = (uri: string): string => {
        if (uri.endsWith('parent.do')) return parent_content;
        if (uri.endsWith('hub.do')) return hub_content;
        if (uri.endsWith('child.do')) return child_content;
        const m = uri.match(/sibling_(\d+)\.do$/);
        if (m) return sibling_content(Number(m[1]));
        return '';
    };

    const content_provider: ContentProvider = {
        read_file: async (uri: string) => {
            read_counts.set(uri, (read_counts.get(uri) || 0) + 1);
            return content_for(uri);
        },
        exists: async () => true,
        stat: async (uri: string) => ({
            mtimeMs: 1000,
            size: Buffer.byteLength(content_for(uri), 'utf8'),
        }),
    };

    const resolver = new ScopeResolver(undefined, content_provider);
    const forward = new ForwardScopeResolver(resolver);
    resolver.set_forward_scope_resolver(forward);
    const child_uri = URI.file('/ws/child.do').toString();
    return { resolver, forward, read_counts, child_uri, child_content };
}

function total_reads(read_counts: Map<string, number>): number {
    let total = 0;
    for (const [, count] of read_counts) total += count;
    return total;
}

describe('hub-heavy forward-call performance (#209)', () => {
    it('keeps reads bounded (no O(N^2) blowup) when N siblings share one hub', async () => {
        const ws = build_hub_workspace();
        await ws.resolver.resolve(ws.child_uri, ws.child_content);

        const reads = total_reads(ws.read_counts);
        // The shared hub global must reach the child.
        const resolved = await ws.resolver.resolve(
            ws.child_uri, ws.child_content);
        expect(resolved.symbols.globalMacros.has('hub_shared_g')).toBe(true);

        // Linear guard: a healthy resolution reads each file ~once (observed
        // ≈ N+3 with the shared hub read a single time, thanks to file_cache).
        // O(N^2) (each sibling re-reading the hub and/or siblings) would be
        // ~400+. 2*N tolerates a constant-factor of extra passes while still
        // catching any quadratic / cache-busting regression.
        expect(reads).toBeLessThanOrEqual(2 * N_SIBLINGS);
    });

    it('memo ON never reads more than OFF (standalone walks reuse file_cache)', async () => {
        const off = build_hub_workspace();
        off.forward.set_forward_closure_memo_enabled(false);
        await off.resolver.resolve(off.child_uri, off.child_content);

        const on = build_hub_workspace();
        on.forward.set_forward_closure_memo_enabled(true);
        await on.resolver.resolve(on.child_uri, on.child_content);

        // The memo's standalone closure builds go through the same
        // file_cache as live walks, so enabling it must not add I/O.
        expect(total_reads(on.read_counts))
            .toBeLessThanOrEqual(total_reads(off.read_counts));
    });

    it('collapses shared-chain closure recomputation to ~1 across N callers (#234)', async () => {
        // N root files all `do` chain_1; chain_1 → chain_2 → … → chain_K
        // (the last link is a leaf). This is the `sight check` shape: every
        // root's resolution traverses the same chain, and without the memo
        // each traversal recomputes every chain closure from scratch.
        const N_ROOTS = 10;
        const CHAIN_LINKS = 5; // chain_1..chain_5; chain_5 is a leaf
        const chain_content = (i: number): string =>
            i < CHAIN_LINKS
                ? `do "chain_${i + 1}.do"\nglobal chain_${i}_g 1\n`
                : `global chain_${i}_g 1\n`;
        const root_content = `do "chain_1.do"\ndisplay "\${chain_${CHAIN_LINKS}_g}"\n`;

        const content_for = (uri: string): string => {
            const m = uri.match(/chain_(\d+)\.do$/);
            if (m) return chain_content(Number(m[1]));
            if (/root_\d+\.do$/.test(uri)) return root_content;
            return '';
        };
        const build = (memo_on: boolean) => {
            const read_counts = new Map<string, number>();
            const content_provider: ContentProvider = {
                read_file: async (uri: string) => {
                    read_counts.set(uri, (read_counts.get(uri) || 0) + 1);
                    return content_for(uri);
                },
                exists: async () => true,
                stat: async (uri: string) => ({
                    mtimeMs: 1000,
                    size: Buffer.byteLength(content_for(uri), 'utf8'),
                }),
            };
            const resolver = new ScopeResolver(undefined, content_provider);
            const forward = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward);
            forward.set_forward_closure_memo_enabled(memo_on);
            return { resolver, forward, read_counts };
        };
        const resolve_all_roots = async (
            ws: ReturnType<typeof build>
        ): Promise<void> => {
            for (let i = 0; i < N_ROOTS; i++) {
                const my_uri = URI.file(`/ws/root_${i}.do`).toString();
                await ws.resolver.resolve(my_uri, root_content);
            }
        };

        const on = build(true);
        await resolve_all_roots(on);
        const metrics = on.forward.get_forward_closure_metrics();

        // The N→1 collapse: chain_1..chain_{K-1} have forward calls (the
        // leaf does not), so exactly K-1 closures are ever computed —
        // regardless of N — and every later root serves chain_1's cached
        // closure instead of re-walking the chain.
        expect(metrics.misses).toBe(CHAIN_LINKS - 1);
        expect(metrics.hits).toBe(N_ROOTS - 1);

        // And the memo must not add I/O relative to OFF.
        const off = build(false);
        await resolve_all_roots(off);
        expect(total_reads(on.read_counts))
            .toBeLessThanOrEqual(total_reads(off.read_counts));
    });
});

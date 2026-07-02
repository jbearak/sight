/**
 * Issue #234 — forward-closure memo store/serve semantics.
 *
 * The memo-on/off correctness gate (forward-closure-memo-gate.test.ts)
 * proves the memo never changes caller-observable output. This file pins the
 * memo's own mechanics instead:
 *  - the N→1 collapse (misses stay flat across callers, hits grow);
 *  - the disjointness serve gate (a caller whose visited/stack intersects a
 *    cached closure's reachable set is recomputed live);
 *  - the visited-delta replay (later siblings dedup identically to a live
 *    walk after a serve);
 *  - store-eligibility (diagnostic-producing closures are never stored —
 *    including cap truncations suppressed by `max_depth: 'off'`);
 *  - invalidation parity with scope_cache (didChange + on-disk change +
 *    transitive dependents + clear_cache), the in-flight epoch guard, and
 *    the dependency-graph scan/version gates.
 *
 * See docs/cross-file.md "Forward-closure caching semantics".
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'node:url';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DependencyGraph } from '../../src/dependency-graph';
import type { ForwardCallSite, ResolvedScope } from '../../src/types';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('issue #234 — forward-closure memo store/serve', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        forward_resolver.set_forward_closure_memo_enabled(true);
        temp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'memo-store-serve-234-'));
    });
    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };
    const to_uri = (file_path: string): string =>
        pathToFileURL(file_path).toString();
    const read = (file_path: string): string =>
        fs.readFileSync(file_path, 'utf8');

    /** Do any of the file's own forward-call sites carry this global? */
    const site_has_global = (r: ResolvedScope, name: string): boolean =>
        (r.forward_call_symbols ?? []).some(
            (s: ForwardCallSite) => s.symbols.globalMacros.has(name));

    /** chain_1 → chain_2 → chain_3 (leaf), plus N roots that `do` chain_1. */
    const build_chain_workspace = (n_roots: number): {
        chain: string[]; roots: string[];
    } => {
        const chain_3 = create_file('chain_3.do', 'global g3 1\n');
        const chain_2 = create_file(
            'chain_2.do', `do "${chain_3}"\nglobal g2 1\n`);
        const chain_1 = create_file(
            'chain_1.do', `do "${chain_2}"\nglobal g1 1\n`);
        const the_roots = Array.from({ length: n_roots }, (_unused, i) =>
            create_file(
                `root_${i}.do`, `do "${chain_1}"\ndisplay "\${g3}"\n`));
        return { chain: [chain_1, chain_2, chain_3], roots: the_roots };
    };

    it('collapses shared-chain recomputation across callers (N→1)', async () => {
        const { roots } = build_chain_workspace(5);

        for (const my_root of roots) {
            const resolved = await scope_resolver.resolve(
                to_uri(my_root), read(my_root));
            expect(site_has_global(resolved, 'g3')).toBe(true);
        }

        const metrics = forward_resolver.get_forward_closure_metrics();
        // chain_1 and chain_2 have forward calls (chain_3 is a leaf): their
        // closures are computed exactly once, on the first root.
        expect(metrics.misses).toBe(2);
        // Every later root serves chain_1's cached closure.
        expect(metrics.hits).toBe(roots.length - 1);
    });

    it('replays the visited-delta: a later sibling dedups against a served hub', async () => {
        // parent runs a then b; both source the same hub. Serving a's
        // closure must replay hub into visited so b's walk boundary-skips
        // the hub exactly as a live walk would (no duplicate hub site).
        const hub = create_file('hub.do', 'global hub_g 1\n');
        const a = create_file('a.do', `run "${hub}"\nglobal a_g 1\n`);
        const b = create_file('b.do', `run "${hub}"\nglobal b_g 1\n`);
        const parent = create_file(
            'parent.do', `run "${a}"\nrun "${b}"\ndisplay 1\n`);

        // Resolve the parent twice: the second pass serves a's closure from
        // the memo (hit) and must produce the identical call-site surface.
        const surface_of = (r: ResolvedScope): string[] =>
            (r.forward_call_symbols ?? []).map((s: ForwardCallSite) =>
                `${path.basename(s.callee_uri)}@${s.call_line}:` +
                `${s.effective_type}`).sort();

        const first = await scope_resolver.resolve(
            to_uri(parent), read(parent));
        // Force a fresh top-level resolution without touching the memo.
        scope_resolver.invalidate_scope_cache(to_uri(parent));
        const second = await scope_resolver.resolve(
            to_uri(parent), read(parent));

        expect(surface_of(second)).toEqual(surface_of(first));
        const hub_sites = (second.forward_call_symbols ?? []).filter(
            (s: ForwardCallSite) => s.callee_uri === to_uri(hub) &&
                s.symbols.globalMacros.has('hub_g'));
        // The hub's symbols must be contributed exactly once (a's subtree);
        // b's re-visit is a dedup'd boundary, not a second contribution.
        expect(hub_sites.length).toBe(1);
    });

    it('never serves a closure into a caller whose state intersects it', async () => {
        // cycle: a → b → a. Resolving a's own scope walks b, whose closure
        // reaches back to a (in the caller's stack) — so b's cached entry
        // must NOT be served (a live walk cycle-skips a; the standalone
        // closure contains it).
        const a_path = path.join(temp_dir, 'cyc_a.do');
        const b_path = path.join(temp_dir, 'cyc_b.do');
        fs.writeFileSync(a_path, `do "${b_path}"\nglobal a_g 1\n`);
        fs.writeFileSync(b_path, `do "${a_path}"\nglobal b_g 1\n`);

        const resolved = await scope_resolver.resolve(
            to_uri(a_path), read(a_path));
        // b's contribution must include b_g but NOT re-walk a into a
        // duplicate site (live cycle-skip semantics preserved).
        expect(site_has_global(resolved, 'b_g')).toBe(true);
        const a_sites = (resolved.forward_call_symbols ?? []).filter(
            (s: ForwardCallSite) => s.callee_uri === to_uri(a_path));
        expect(a_sites.length).toBe(0);
    });

    it('does not store diagnostic-producing closures (missing file)', async () => {
        const broken = create_file(
            'broken.do', `do "${path.join(temp_dir, 'missing.do')}"\n`);
        const root = create_file(
            'diag_root.do', `do "${broken}"\ndisplay 1\n`);

        const first = await scope_resolver.resolve(
            to_uri(root), read(root));
        const first_missing = first.diagnostics.filter(d =>
            d.message.includes('Cannot read file'));
        expect(first_missing.length).toBeGreaterThan(0);

        // Nothing may be cached for broken.do: a second resolution (fresh
        // scope-cache entry) must re-emit the same diagnostics.
        scope_resolver.invalidate_scope_cache(to_uri(root));
        const second = await scope_resolver.resolve(
            to_uri(root), read(root));
        const second_missing = second.diagnostics.filter(d =>
            d.message.includes('Cannot read file'));
        expect(second_missing.map(d => d.message))
            .toEqual(first_missing.map(d => d.message));
        expect(forward_resolver.get_forward_closure_metrics().hits).toBe(0);
    });

    it("does not store cap-truncated closures even under max_depth 'off'", async () => {
        // deep chain long enough to exceed max_forward_depth = 2
        const d3 = create_file('deep_3.do', 'global d3 1\n');
        const d2 = create_file('deep_2.do', `do "${d3}"\nglobal d2 1\n`);
        const d1 = create_file('deep_1.do', `do "${d2}"\nglobal d1 1\n`);
        const root = create_file('deep_root.do', `do "${d1}"\ndisplay 1\n`);

        const scope = new ScopeResolver(create_test_scope_resolver_logger());
        const forward = new ForwardScopeResolver(scope, {
            max_forward_depth: 2,
            diagnostics: { max_depth: 'off' },
        });
        scope.set_forward_scope_resolver(forward);
        forward.set_forward_closure_memo_enabled(true);

        const config = {
            max_forward_depth: 2,
            diagnostics: { max_depth: 'off' as const },
        };
        const resolved = await scope.resolve(to_uri(root), read(root), config);
        // 'off' suppresses the truncation diagnostic for the user...
        expect(resolved.diagnostics.filter(d =>
            d.message.includes('Maximum forward resolution')).length).toBe(0);
        // The memo must have engaged (floor: a disabled memo would make
        // the assertions below vacuous).
        expect(forward.get_forward_closure_metrics().misses)
            .toBeGreaterThan(0);

        // ...but the truncated closure must never have been stored as
        // SERVABLE. Only a second resolution can prove that: if the
        // standalone build inherited the caller's 'off' severity (instead
        // of forcing a non-'off' one), the cap-truncated closure would
        // look diagnostic-free, get stored, and be SERVED here — hits > 0.
        scope.invalidate_scope_cache(to_uri(root));
        await scope.resolve(to_uri(root), read(root), config);
        expect(forward.get_forward_closure_metrics().hits).toBe(0);
    });

    it('keeps standalone-build work bounded on a mutual do-cycle', async () => {
        // a → b → a. A memo miss launches a fresh-stack standalone build
        // that cannot see the caller's ancestry; without the in-flight
        // re-entry guard the builds cascade to max_forward_depth on every
        // traversal. Bounded misses prove the guard works.
        const a_path = path.join(temp_dir, 'bounded_a.do');
        const b_path = path.join(temp_dir, 'bounded_b.do');
        fs.writeFileSync(a_path, `do "${b_path}"\nglobal a_g 1\n`);
        fs.writeFileSync(b_path, `do "${a_path}"\nglobal b_g 1\n`);

        await scope_resolver.resolve(to_uri(a_path), read(a_path));
        // ≤ 2 standalone attempts for one traversal of a 2-cycle — a
        // cascade would burn ~max_forward_depth (10) per traversal. The
        // floor proves the memo actually engaged (a silently-disabled memo
        // would report 0 and satisfy any ceiling vacuously).
        const first_cycle_misses =
            forward_resolver.get_forward_closure_metrics().misses;
        expect(first_cycle_misses).toBeGreaterThan(0);
        expect(first_cycle_misses).toBeLessThanOrEqual(2);

        // invalidate_scope_cache(a) also evicts both memo entries (a is in
        // their dependent sets), so the second traversal legitimately
        // recomputes the same bounded set — still no cascade.
        scope_resolver.invalidate_scope_cache(to_uri(a_path));
        await scope_resolver.resolve(to_uri(a_path), read(a_path));
        expect(forward_resolver.get_forward_closure_metrics().misses)
            .toBeLessThanOrEqual(4);
    });

    it('does not re-attempt doomed standalone builds on cap-tripping chains', async () => {
        // deep_1 → … → deep_6 with max_forward_depth 3: every standalone
        // build in the truncated region is doomed (truncation diagnostic).
        // Each key must be attempted ONCE (negative-cached), not once per
        // level of every live retry (O(2^depth)).
        const the_chain: string[] = [];
        for (let i = 6; i >= 1; i--) {
            const my_path = path.join(temp_dir, `cap_${i}.do`);
            const my_next = the_chain.length > 0
                ? `do "${the_chain[the_chain.length - 1]}"\n`
                : '';
            fs.writeFileSync(my_path, `${my_next}global cap_${i}_g 1\n`);
            the_chain.push(my_path);
        }
        const head = the_chain[the_chain.length - 1];
        const root = create_file('cap_root.do', `do "${head}"\ndisplay 1\n`);

        const config = { max_forward_depth: 3 };
        await scope_resolver.resolve(to_uri(root), read(root), config);
        const first_misses =
            forward_resolver.get_forward_closure_metrics().misses;
        // Floor: the memo must actually have attempted builds (a
        // silently-disabled memo would report 0 and pass any ceiling).
        expect(first_misses).toBeGreaterThan(0);
        expect(first_misses).toBeLessThanOrEqual(4);

        // Re-resolving must not re-attempt the doomed builds.
        scope_resolver.invalidate_scope_cache(to_uri(root));
        const again = await scope_resolver.resolve(
            to_uri(root), read(root), config);
        expect(forward_resolver.get_forward_closure_metrics().misses)
            .toBe(first_misses);
        // ...and the truncation diagnostic still reaches the user.
        expect(again.diagnostics.some(d =>
            d.message.includes('Maximum forward resolution'))).toBe(true);
    });

    it('evicts transitively dependent entries on didChange and on-disk change', async () => {
        const { chain, roots } = build_chain_workspace(2);
        const [, , chain_3] = chain;

        for (const my_root of roots) {
            await scope_resolver.resolve(to_uri(my_root), read(my_root));
        }
        expect(forward_resolver.get_forward_closure_metrics().misses).toBe(2);

        // Edit the LEAF: both memoized closures (chain_1's and chain_2's)
        // transitively depend on it and must be evicted together.
        fs.writeFileSync(chain_3, 'global g3_renamed 1\n');
        scope_resolver.invalidate_file_cache(to_uri(chain_3));
        expect(forward_resolver.get_forward_closure_metrics().invalidations)
            .toBe(2);

        scope_resolver.invalidate_scope_cache(to_uri(roots[0]));
        const after = await scope_resolver.resolve(
            to_uri(roots[0]), read(roots[0]));
        expect(site_has_global(after, 'g3')).toBe(false);
        expect(site_has_global(after, 'g3_renamed')).toBe(true);
    });

    it('clear_cache drops the memo (workspace reset parity)', async () => {
        const { roots } = build_chain_workspace(2);
        await scope_resolver.resolve(to_uri(roots[0]), read(roots[0]));
        const before = forward_resolver.get_forward_closure_metrics();
        expect(before.misses).toBe(2);

        scope_resolver.clear_cache();

        await scope_resolver.resolve(to_uri(roots[1]), read(roots[1]));
        const after = forward_resolver.get_forward_closure_metrics();
        // Fully recomputed — nothing served across the clear.
        expect(after.hits).toBe(0);
        expect(after.misses).toBe(4);
    });

    it('open-buffer edits invalidate through invalidate_scope_cache (didChange path)', async () => {
        // Production didChange calls invalidate_scope_cache (NOT
        // invalidate_file_cache); the memo must be evicted through that
        // funnel too — codex finding #4 on the #234 plan.
        const { chain, roots } = build_chain_workspace(1);
        const [, chain_2] = chain;
        await scope_resolver.resolve(to_uri(roots[0]), read(roots[0]));
        expect(forward_resolver.get_forward_closure_metrics().misses).toBe(2);

        fs.writeFileSync(chain_2, 'global g2_only 1\n');
        scope_resolver.invalidate_scope_cache(to_uri(chain_2));
        // chain_1's closure depends on chain_2 → evicted; chain_2's own
        // entry likewise. (invalidate_scope_cache deliberately leaves
        // file_cache alone; evict it here so the re-read sees the new
        // content, standing in for the didChange buffer overlay.)
        expect(forward_resolver.get_forward_closure_metrics().invalidations)
            .toBe(2);
        scope_resolver.invalidate_file_cache(to_uri(chain_2));

        scope_resolver.invalidate_scope_cache(to_uri(roots[0]));
        const after = await scope_resolver.resolve(
            to_uri(roots[0]), read(roots[0]));
        expect(site_has_global(after, 'g3')).toBe(false);
        expect(site_has_global(after, 'g2_only')).toBe(true);
    });

    it('does not populate while the dependency-graph scan is incomplete', async () => {
        const graph = new DependencyGraph();
        forward_resolver.set_dependency_graph(graph);
        const { roots } = build_chain_workspace(3);

        // Scan not complete → gate closed → no stores, no serves.
        await scope_resolver.resolve(to_uri(roots[0]), read(roots[0]));
        let metrics = forward_resolver.get_forward_closure_metrics();
        expect(metrics.misses).toBe(0);
        expect(metrics.hits).toBe(0);

        // Scan complete → gate open.
        graph.mark_scan_complete();
        scope_resolver.invalidate_scope_cache(to_uri(roots[0]));
        await scope_resolver.resolve(to_uri(roots[1]), read(roots[1]));
        await scope_resolver.resolve(to_uri(roots[2]), read(roots[2]));
        metrics = forward_resolver.get_forward_closure_metrics();
        expect(metrics.misses).toBe(2);
        expect(metrics.hits).toBe(1);
    });

    it('a dep-graph version bump rotates keys without stranding old entries', async () => {
        const graph = new DependencyGraph();
        graph.mark_scan_complete();
        forward_resolver.set_dependency_graph(graph);
        const { roots } = build_chain_workspace(2);

        await scope_resolver.resolve(to_uri(roots[0]), read(roots[0]));
        expect(forward_resolver.get_forward_closure_metrics().misses).toBe(2);

        // Bump the graph version (unrelated edge change): old keys are
        // unreachable, so the next resolution recomputes — and the base-key
        // rotation must evict the two stranded entries at store time.
        const version_before = graph.get_version();
        graph.update_caller('file:///unrelated/x.do', [{
            type: 'do',
            raw_path: 'y.do',
            call_site_line: 0,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
            },
            source: 'command',
            is_static: true,
        }]);
        expect(graph.get_version()).toBeGreaterThan(version_before);
        await scope_resolver.resolve(to_uri(roots[1]), read(roots[1]));
        const metrics = forward_resolver.get_forward_closure_metrics();
        expect(metrics.misses).toBe(4);
        expect(metrics.invalidations).toBe(2);
    });
});

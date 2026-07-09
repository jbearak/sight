/**
 * Issue #294 — bounded cross-file caches (LRU capacity limits).
 *
 * Pins the eviction contracts of the three bounded caches:
 *  - scope_cache eviction prunes uri_to_cache_keys and counts in
 *    `evictions` (never `invalidations`), and does NOT invalidate the
 *    forward-closure memo (capacity pressure is not a content change);
 *  - file_cache eviction DOES invalidate the forward-closure memo for the
 *    evicted URI (the stale-content purges compare against the evicted
 *    entry's hash baseline — without this, a memo entry re-poisoned in a
 *    debounce window would never be purged);
 *  - forward_closure_memo eviction prunes memo_uri_to_keys, counts in its
 *    own `evictions`, and does NOT bump the invalidation epoch;
 *  - the indexer's forced-'explicit' WD walk is probe-only
 *    (skip_backward_registration): a post-eviction reparse driven by it
 *    can neither wipe auto-registered edges nor stamp a registration that
 *    never ran, while genuine explicit-mode resolutions keep the pinned
 *    auto→explicit self-heal;
 *  - capacity 1 produces byte-identical resolution results to the default
 *    capacity (eviction is a performance knob, never a correctness one);
 *  - the config knobs map and validate end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DependencyGraph } from '../../src/dependency-graph';
import { DirectiveParser } from '../../src/directive-parser';
import { map_public_config_to_partial_config } from '../../src/config-file/schema';
import { validate_comment_formatting_config } from '../../src/utils/config-validator';
import type { ForwardCallSite, ResolvedScope } from '../../src/types';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('issue #294 — bounded cross-file caches', () => {
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-294-'));
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
        URI.file(file_path).toString();

    /** Do any of the file's own forward-call sites carry this global? */
    const site_has_global = (r: ResolvedScope, name: string): boolean =>
        (r.forward_call_symbols ?? []).some(
            (s: ForwardCallSite) => s.symbols.globalMacros.has(name));

    /** Internal-state accessors (test-only; fields are private). */
    const uri_index_of = (resolver: ScopeResolver): Map<string, Set<string>> =>
        (resolver as unknown as {
            uri_to_cache_keys: Map<string, Set<string>>;
        }).uri_to_cache_keys;
    const scope_cache_of = (resolver: ScopeResolver): { size: number } =>
        (resolver as unknown as {
            scope_cache: { size: number };
        }).scope_cache;
    const memo_index_of = (
        forward: ForwardScopeResolver
    ): Map<string, Set<string>> =>
        (forward as unknown as {
            memo_uri_to_keys: Map<string, Set<string>>;
        }).memo_uri_to_keys;
    const epoch_of = (forward: ForwardScopeResolver): number =>
        (forward as unknown as {
            memo_invalidation_epoch: number;
        }).memo_invalidation_epoch;

    describe('scope_cache eviction', () => {
        it('prunes uri_to_cache_keys, counts evictions (not invalidations), and does not touch the memo', async () => {
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger(), undefined,
                { max_cached_scopes: 1 }
            );
            const the_memo_invalidations: string[] = [];
            // Minimal ForwardScopeResolverInterface spy: records memo
            // invalidations so we can assert scope_cache eviction never
            // fires one (only file_cache eviction and real invalidation do).
            scope.set_forward_scope_resolver({
                filter_calls_before_line: (calls) => calls,
                resolve: async () => ({
                    symbols: {
                        programs: new Map(), localMacros: new Map(),
                        globalMacros: new Map(), variables: new Map(),
                        scalars: new Map(), matrices: new Map(),
                    },
                    call_sites: [], diagnostics: [],
                } as never),
                invalidate_forward_closure_for_uri: (uri: string) => {
                    the_memo_invalidations.push(uri);
                    return 0;
                },
            });

            const a_uri = to_uri(path.join(temp_dir, 'a.do'));
            const b_uri = to_uri(path.join(temp_dir, 'b.do'));
            await scope.resolve(a_uri, 'global g_a 1\n', {});
            const invalidations_before =
                scope.get_cache_metrics().scope.invalidations;
            await scope.resolve(b_uri, 'global g_b 1\n', {});

            const metrics = scope.get_cache_metrics();
            expect(metrics.scope.evictions).toBe(1);
            expect(metrics.scope.invalidations).toBe(invalidations_before);
            expect(scope.get_cache_sizes().scope).toBe(1);

            // The index must hold no rows beyond the live cache entries —
            // an eviction that skipped pruning would leak a's key here.
            const the_index = uri_index_of(scope);
            let total_indexed_keys = 0;
            for (const my_key_set of the_index.values()) {
                total_indexed_keys += my_key_set.size;
            }
            expect(total_indexed_keys).toBe(scope_cache_of(scope).size);
            expect(the_index.has(a_uri)).toBe(false);

            // Roots without forward calls never reach the memo; and
            // scope_cache CAPACITY eviction must not invalidate it either.
            expect(the_memo_invalidations).toEqual([]);
        });

        it('set_cache_capacities shrink evicts immediately through the same hook', async () => {
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger());
            for (let i = 0; i < 4; i++) {
                await scope.resolve(
                    to_uri(path.join(temp_dir, `f${i}.do`)),
                    `global g_${i} 1\n`, {});
            }
            expect(scope.get_cache_sizes().scope).toBe(4);
            scope.set_cache_capacities({ max_cached_scopes: 2 });
            expect(scope.get_cache_sizes().scope).toBe(2);
            expect(scope.get_cache_metrics().scope.evictions).toBe(2);
            const the_index = uri_index_of(scope);
            let total_indexed_keys = 0;
            for (const my_key_set of the_index.values()) {
                total_indexed_keys += my_key_set.size;
            }
            expect(total_indexed_keys).toBe(2);
        });
    });

    describe('file_cache eviction', () => {
        it('invalidates the forward-closure memo for the evicted URI', async () => {
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger(), undefined,
                { max_cached_files: 1 }
            );
            const the_memo_invalidations: string[] = [];
            scope.set_forward_scope_resolver({
                filter_calls_before_line: (calls) => calls,
                resolve: async () => ({
                    symbols: {
                        programs: new Map(), localMacros: new Map(),
                        globalMacros: new Map(), variables: new Map(),
                        scalars: new Map(), matrices: new Map(),
                    },
                    call_sites: [], diagnostics: [],
                } as never),
                invalidate_forward_closure_for_uri: (uri: string) => {
                    the_memo_invalidations.push(uri);
                    return 0;
                },
            });

            const a_uri = to_uri(path.join(temp_dir, 'a.do'));
            const b_uri = to_uri(path.join(temp_dir, 'b.do'));
            await scope.resolve(a_uri, 'global g_a 1\n', {});
            // Resolving b writes b's root entry, evicting a's (capacity 1):
            // the eviction hook must invalidate the memo for a.
            await scope.resolve(b_uri, 'global g_b 1\n', {});

            expect(scope.get_cache_metrics().file.evictions).toBe(1);
            expect(the_memo_invalidations).toContain(a_uri);
            expect(scope.get_cache_sizes().file).toBe(1);
        });
    });

    describe('forward_closure_memo eviction', () => {
        it('prunes memo_uri_to_keys, counts evictions, and does not bump the epoch', async () => {
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger());
            const forward = new ForwardScopeResolver(scope);
            scope.set_forward_scope_resolver(forward);
            forward.set_forward_closure_memo_capacity(1);

            // Closures are stored per callee WITH forward calls (leaves
            // have none), so each root needs a mid-file: root → mid → leaf.
            const x_path = create_file('x.do', 'global g_x 1\n');
            const y_path = create_file('y.do', 'global g_y 1\n');
            const mid1_path = create_file(
                'mid1.do', `do "${x_path}"\nglobal g_m1 1\n`);
            const mid2_path = create_file(
                'mid2.do', `do "${y_path}"\nglobal g_m2 1\n`);
            const root1_path = create_file('root1.do', `do "${mid1_path}"\n`);
            const root2_path = create_file('root2.do', `do "${mid2_path}"\n`);

            await scope.resolve(
                to_uri(root1_path), fs.readFileSync(root1_path, 'utf8'), {});
            const epoch_before = epoch_of(forward);
            const invalidations_before =
                forward.get_forward_closure_metrics().invalidations;

            // Storing y's closure evicts x's (capacity 1).
            await scope.resolve(
                to_uri(root2_path), fs.readFileSync(root2_path, 'utf8'), {});

            const metrics = forward.get_forward_closure_metrics();
            expect(metrics.evictions).toBeGreaterThanOrEqual(1);
            expect(metrics.invalidations).toBe(invalidations_before);
            expect(epoch_of(forward)).toBe(epoch_before);
            expect(forward.get_forward_closure_memo_size()).toBeLessThanOrEqual(1);

            // No dangling index rows: every indexed key must exist in the
            // memo.
            const the_index = memo_index_of(forward);
            const memo = (forward as unknown as {
                forward_closure_memo: { has(k: string): boolean };
            }).forward_closure_memo;
            for (const my_key_set of the_index.values()) {
                for (const my_key of my_key_set) {
                    expect(memo.has(my_key)).toBe(true);
                }
            }
        });

        it('same-key overwrite prunes the old entry\'s index rows (lockstep gap)', () => {
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger());
            const forward = new ForwardScopeResolver(scope);
            const internals = forward as unknown as {
                store_memo_entry(key: string, entry: unknown): unknown;
                memo_uri_to_keys: Map<string, Set<string>>;
            };
            const make_entry = (deps: string[]) => ({
                kind: 'unservable',
                dependent_uris: new Set(deps),
            });
            internals.store_memo_entry(
                'k1', make_entry(['file:///old-dep.do']));
            expect(
                internals.memo_uri_to_keys.get('file:///old-dep.do')?.has('k1')
            ).toBe(true);
            // Overwrite with a different dependent set: the old row must go.
            internals.store_memo_entry(
                'k1', make_entry(['file:///new-dep.do']));
            expect(internals.memo_uri_to_keys.has('file:///old-dep.do'))
                .toBe(false);
            expect(
                internals.memo_uri_to_keys.get('file:///new-dep.do')?.has('k1')
            ).toBe(true);
        });
    });

    describe('probe-only WD walk (skip_backward_registration)', () => {
        it('a post-eviction WD-walk reparse cannot wipe auto-registered edges', async () => {
            const dependency_graph = new DependencyGraph();
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger(), undefined,
                { max_cached_files: 1 }
            );
            const forward = new ForwardScopeResolver(scope);
            scope.set_forward_scope_resolver(forward);
            scope.set_dependency_graph(dependency_graph);

            // A --do--> B (auto-discovered; B has no explicit directives).
            const b_path = create_file('b.do', 'global g_b 1\n');
            const a_path = create_file('a.do', 'do b.do\n');
            const a_uri = to_uri(a_path);
            const b_uri = to_uri(b_path);
            dependency_graph.update_caller(a_uri, [{
                type: 'do',
                raw_path: 'b.do',
                is_static: true,
                call_site_line: 0,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
                source: 'command',
            }]);

            // An auto-mode resolution of C (done-by B) reads B as an
            // ancestor and registers B's auto parents: A → B.
            const c_uri = to_uri(path.join(temp_dir, 'c.do'));
            await scope.resolve(
                c_uri,
                `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`,
                {}
            );
            expect(
                scope.get_backward_directive_children(a_uri).has(b_uri)
            ).toBe(true);

            // Capacity pressure evicts B's file_cache entry (capacity 1;
            // resolving another root's parse_file write is enough).
            await scope.resolve(
                to_uri(path.join(temp_dir, 'noise.do')),
                'global g_noise 1\n', {});

            // The indexer's WD walk over a child of B misses the cache and
            // reparses B under forced-'explicit'. Probe-only (#294): it
            // must neither register (which would clear-then-register B's
            // edges to empty) nor stamp.
            const d_path = create_file(
                'd.do', `// @lsp-done-by: "${b_path}"\ndisplay "d"\n`);
            const parser = new DirectiveParser();
            const d_parse = parser.parse(
                fs.readFileSync(d_path, 'utf8'), to_uri(d_path));
            await scope.resolve_inherited_working_directory(
                d_parse.directives, to_uri(d_path), false);

            expect(
                scope.get_backward_directive_children(a_uri).has(b_uri)
            ).toBe(true);

            // The walk-written entry carries no registration stamp: it
            // must not claim a registration that never ran.
            const the_file_cache = (scope as unknown as {
                file_cache: {
                    peek(k: string): { registered_backward_mode?: string } | undefined;
                    keys(): IterableIterator<string>;
                };
            }).file_cache;
            for (const my_key of the_file_cache.keys()) {
                if (my_key.startsWith(b_uri)) {
                    expect(the_file_cache.peek(my_key)?.registered_backward_mode)
                        .toBeUndefined();
                }
            }
        });

        it('a genuine explicit-mode HIT on a walk-written unstamped entry registers it (self-heal)', async () => {
            // Round-2 review gap: the miss-path test below never exercises
            // upgrade_registration_on_cache_hit's explicit+undefined
            // branch. Here the walk primes an UNSTAMPED cached entry for a
            // file with its own explicit directive, and a later genuine
            // explicit-mode resolution HITS that entry (content
            // unchanged, no eviction) — the hit path must register the
            // raw directives and stamp 'explicit', else the file's parent
            // edge stays unregistered until a content change.
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger());
            const forward = new ForwardScopeResolver(scope);
            scope.set_forward_scope_resolver(forward);

            const parent_path = create_file(
                'parent.do', 'global g_parent 1\n');
            const parent_uri = to_uri(parent_path);
            const b_path = create_file(
                'b.do',
                `// @lsp-done-by: "${parent_path}"\nglobal g_b 1\n`);
            const b_uri = to_uri(b_path);

            // Probe-only walk over a child of B primes B's cache entry:
            // unstamped, unregistered.
            const d_path = create_file(
                'd.do', `// @lsp-done-by: "${b_path}"\ndisplay "d"\n`);
            const parser = new DirectiveParser();
            const d_parse = parser.parse(
                fs.readFileSync(d_path, 'utf8'), to_uri(d_path));
            await scope.resolve_inherited_working_directory(
                d_parse.directives, to_uri(d_path), false);
            expect(
                scope.get_backward_directive_children(parent_uri).has(b_uri)
            ).toBe(false);

            // Genuine explicit-mode resolution of another child HITS B's
            // cached entry and must self-heal the registration.
            const c_uri = to_uri(path.join(temp_dir, 'c.do'));
            await scope.resolve(
                c_uri,
                `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`,
                { backward_dependencies: 'explicit' }
            );
            expect(
                scope.get_backward_directive_children(parent_uri).has(b_uri)
            ).toBe(true);
            const the_file_cache = (scope as unknown as {
                file_cache: {
                    peek(k: string): { registered_backward_mode?: string } | undefined;
                };
            }).file_cache;
            expect(the_file_cache.peek(b_uri)?.registered_backward_mode)
                .toBe('explicit');
        });

        it('genuine explicit-mode resolution still clears vestigial auto edges (pinned self-heal)', async () => {
            const dependency_graph = new DependencyGraph();
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger(), undefined,
                { max_cached_files: 1 }
            );
            const forward = new ForwardScopeResolver(scope);
            scope.set_forward_scope_resolver(forward);
            scope.set_dependency_graph(dependency_graph);

            const b_path = create_file('b.do', 'global g_b 1\n');
            const a_path = create_file('a.do', 'do b.do\n');
            const a_uri = to_uri(a_path);
            const b_uri = to_uri(b_path);
            dependency_graph.update_caller(a_uri, [{
                type: 'do',
                raw_path: 'b.do',
                is_static: true,
                call_site_line: 0,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
                source: 'command',
            }]);

            const c_uri = to_uri(path.join(temp_dir, 'c.do'));
            await scope.resolve(
                c_uri, `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`, {});
            expect(
                scope.get_backward_directive_children(a_uri).has(b_uri)
            ).toBe(true);

            // Evict B, then resolve under GENUINE explicit config: the
            // miss-reparse registers B's raw (empty) directives, clearing
            // the vestigial auto edge — the documented auto→explicit
            // mid-session self-heal must survive #294.
            await scope.resolve(
                to_uri(path.join(temp_dir, 'noise.do')),
                'global g_noise 1\n', {});
            await scope.resolve(
                c_uri,
                `// @lsp-done-by: "${b_path}"\ndisplay "c"\n`,
                { backward_dependencies: 'explicit' }
            );
            expect(
                scope.get_backward_directive_children(a_uri).has(b_uri)
            ).toBe(false);
        });
    });

    describe('debounce-window re-poisoning survives eviction (the #294 file_cache hook)', () => {
        it('an evicted stale baseline still gets its memo entries purged', async () => {
            // Replays the #278 debounce-window scenario (see
            // forward-closure-memo-store-serve.test.ts) with one twist:
            // the callee's stale file_cache entry is capacity-EVICTED
            // before the debounced parse lands, so parse_file's
            // `if (cached)` purge can never fire. The eviction hook's memo
            // invalidation must cover it instead.
            const x_v1 = 'global x_v1 1\n';
            const x_v2 = 'global x_v2 1\n';
            let x_content = x_v1;

            const the_contents = new Map<string, string>();
            const content_for = (uri: string): string =>
                uri.endsWith('x.do') ? x_content
                    : (the_contents.get(uri) ?? '');
            const provider = {
                read_file: async (uri: string) => content_for(uri),
                exists: async () => true,
                // Constant mtime: the fast path keeps serving the cached
                // (stale) entry during the window.
                stat: async (uri: string) => ({
                    mtimeMs: 1000,
                    size: Buffer.byteLength(content_for(uri), 'utf8'),
                }),
            };
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger(), provider);
            const forward = new ForwardScopeResolver(scope);
            scope.set_forward_scope_resolver(forward);

            const x_uri = 'file:///ws/x.do';
            const a_uri = 'file:///ws/a.do';
            const root1_uri = 'file:///ws/root1.do';
            const root2_uri = 'file:///ws/root2.do';
            the_contents.set(a_uri, 'do "x.do"\nglobal a_g 1\n');
            const root_content = 'do "a.do"\ndisplay "x"\n';
            the_contents.set(root1_uri, root_content);
            the_contents.set(root2_uri, root_content);

            // Warm: a's closure embeds x v1.
            const warm = await scope.resolve(root1_uri, root_content);
            expect(site_has_global(warm, 'x_v1')).toBe(true);

            // Edit x; eager didChange invalidation runs; the debounced
            // parse has not landed yet.
            x_content = x_v2;
            scope.invalidate_scope_cache(x_uri);

            // A resolution inside the window re-poisons the memo from the
            // stale cached x (constant mtime serves v1).
            const in_window = await scope.resolve(root2_uri, root_content);
            expect(site_has_global(in_window, 'x_v1')).toBe(true);

            // Capacity pressure now evicts EVERYTHING down to one entry —
            // including x's stale baseline. Without the eviction hook, the
            // debounced parse below would find no cached entry, skip its
            // `if (cached)` purge, and the poisoned closure would serve
            // forever.
            scope.set_cache_capacities({ max_cached_files: 1 });

            // The debounced parse of x lands; a later resolution must see
            // v2, not the window-pinned v1.
            await scope.resolve(x_uri, x_v2);
            scope.invalidate_scope_cache(root1_uri);
            const after = await scope.resolve(root1_uri, root_content);
            expect(site_has_global(after, 'x_v2')).toBe(true);
            expect(site_has_global(after, 'x_v1')).toBe(false);
        });
    });

    describe('eviction during an in-flight standalone build', () => {
        it('skips the memo store (degraded) but the result is still correct', async () => {
            // A file_cache eviction fires invalidate_forward_closure_for_uri,
            // which bumps the memo epoch — and ANY epoch movement during an
            // in-flight standalone build's await window makes that build
            // refuse to store (the #234 guard against publishing stale
            // closures). Documented degradation: under eviction churn the
            // memo may never populate; the resolution itself must still be
            // correct via the live walk.
            const the_contents = new Map<string, string>();
            let scope: ScopeResolver | undefined;
            let evict_on_leaf_read = false;
            const provider = {
                read_file: async (uri: string) => {
                    if (evict_on_leaf_read && uri.endsWith('leaf.do')) {
                        // Unrelated capacity pressure mid-build: shrink the
                        // file cache, evicting entries and bumping the memo
                        // epoch through the eviction hook.
                        evict_on_leaf_read = false;
                        scope?.set_cache_capacities({ max_cached_files: 1 });
                    }
                    return the_contents.get(uri) ?? '';
                },
                exists: async () => true,
            };
            scope = new ScopeResolver(
                create_test_scope_resolver_logger(), provider);
            const forward = new ForwardScopeResolver(scope);
            scope.set_forward_scope_resolver(forward);

            const leaf_uri = 'file:///ws/leaf.do';
            const mid_uri = 'file:///ws/mid.do';
            const root_uri = 'file:///ws/root.do';
            const unrelated_uri = 'file:///ws/unrelated.do';
            the_contents.set(leaf_uri, 'global g_leaf 1\n');
            the_contents.set(mid_uri, 'do "leaf.do"\nglobal g_mid 1\n');
            the_contents.set(root_uri, 'do "mid.do"\n');
            the_contents.set(unrelated_uri, 'global g_u 1\n');

            // Seed an unrelated file_cache entry so the shrink has
            // something to evict.
            await scope.resolve(
                unrelated_uri, the_contents.get(unrelated_uri) as string);

            evict_on_leaf_read = true;
            const resolved = await scope.resolve(
                root_uri, the_contents.get(root_uri) as string);

            // Correct result via the live walk...
            expect(site_has_global(resolved, 'g_mid')).toBe(true);
            // ...but the epoch moved mid-build, so nothing was stored.
            expect(forward.get_forward_closure_memo_size()).toBe(0);

            // A later, undisturbed resolution stores normally again. (At
            // capacity 1 the memo stays starved by design — every read's
            // eviction re-bumps the epoch — so restore headroom first.)
            scope.set_cache_capacities({ max_cached_files: 2000 });
            scope.invalidate_scope_cache(root_uri);
            await scope.resolve(
                root_uri, the_contents.get(root_uri) as string);
            expect(forward.get_forward_closure_memo_size())
                .toBeGreaterThanOrEqual(1);
        });
    });

    describe('capacity 1 vs default produce identical results', () => {
        const build_workspace = () => {
            const x_path = create_file('x.do', 'global g_x 1\nlocal l_x 2\n');
            const mid_path = create_file(
                'mid.do', `do "${x_path}"\nglobal g_mid 1\n`);
            const top_path = create_file(
                'top.do', `do "${mid_path}"\nglobal g_top 1\n`);
            const leaf_content = [
                `// @lsp-done-by: "${top_path}"`,
                'display "$g_top $g_mid $g_x"',
                `do "${x_path}"`,
                '',
            ].join('\n');
            const leaf_path = create_file('leaf.do', leaf_content);
            return { leaf_path, leaf_content };
        };

        const resolve_with = async (capacities: {
            max_cached_files?: number;
            max_cached_scopes?: number;
            memo?: number;
        }) => {
            const scope = new ScopeResolver(
                create_test_scope_resolver_logger(), undefined, capacities);
            const forward = new ForwardScopeResolver(scope);
            if (capacities.memo !== undefined) {
                forward.set_forward_closure_memo_capacity(capacities.memo);
            }
            scope.set_forward_scope_resolver(forward);
            const { leaf_path, leaf_content } = build_workspace();
            // Resolve twice (second pass exercises post-eviction rereads).
            await scope.resolve(to_uri(leaf_path), leaf_content, {});
            scope.invalidate_scope_cache(to_uri(leaf_path));
            return scope.resolve(to_uri(leaf_path), leaf_content, {});
        };

        it('chain + forward-call fixture resolves identically', async () => {
            const generous = await resolve_with({});
            const starved = await resolve_with({
                max_cached_files: 1, max_cached_scopes: 1, memo: 1,
            });

            const globals = (r: ResolvedScope) =>
                Array.from(r.symbols.globalMacros.keys()).sort();
            expect(globals(starved)).toEqual(globals(generous));
            expect(Array.from(starved.symbols.programs.keys()).sort())
                .toEqual(Array.from(generous.symbols.programs.keys()).sort());
            expect(starved.diagnostics).toEqual(generous.diagnostics);
            // Backward-inherited globals live in the merged symbol table;
            // the leaf's own `do` carries g_x at its forward-call site.
            expect(starved.symbols.globalMacros.has('g_top')).toBe(true);
            expect(starved.symbols.globalMacros.has('g_mid')).toBe(true);
            expect(site_has_global(starved, 'g_x')).toBe(true);
        });
    });

    describe('config plumbing', () => {
        it('maps crossFile.maxCached* to cross_file.max_cached_*', () => {
            const partial = map_public_config_to_partial_config({
                crossFile: {
                    maxCachedFiles: 50,
                    maxCachedScopes: 25,
                    maxCachedForwardClosures: 75,
                },
            });
            expect(partial.cross_file?.max_cached_files).toBe(50);
            expect(partial.cross_file?.max_cached_scopes).toBe(25);
            expect(partial.cross_file?.max_cached_forward_closures).toBe(75);
        });

        it('validator accepts positive numbers and falls back to defaults otherwise', () => {
            const valid = validate_comment_formatting_config({
                cross_file: {
                    max_cached_files: 10,
                    max_cached_scopes: 5,
                    max_cached_forward_closures: 15,
                },
            } as never);
            expect(valid.cross_file.max_cached_files).toBe(10);
            expect(valid.cross_file.max_cached_scopes).toBe(5);
            expect(valid.cross_file.max_cached_forward_closures).toBe(15);

            const invalid = validate_comment_formatting_config({
                cross_file: {
                    max_cached_files: -1,
                    max_cached_scopes: 0,
                    max_cached_forward_closures: 'lots',
                },
            } as never);
            expect(invalid.cross_file.max_cached_files).toBe(2000);
            expect(invalid.cross_file.max_cached_scopes).toBe(1000);
            expect(invalid.cross_file.max_cached_forward_closures).toBe(2000);
        });
    });
});

/**
 * Issue #294 — property: cache capacity never changes resolution results.
 *
 * For randomly shaped backward chains with forward calls, resolving with
 * pathologically small LRU capacities (file/scope/memo all 1) must produce
 * results deep-equal to resolving with the default capacities. Capacity
 * eviction is a performance knob, never a correctness one.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import type { ResolvedScope } from '../../src/types';
import { create_test_scope_resolver_logger } from '../test-logger';
import { arbitrary_non_reserved_identifier } from './generators';

const observable = (r: ResolvedScope) => ({
    globals: Array.from(r.symbols.globalMacros.keys()).sort(),
    locals: Array.from(r.symbols.localMacros.keys()).sort(),
    programs: Array.from(r.symbols.programs.keys()).sort(),
    diagnostics: r.diagnostics,
    forward_sites: (r.forward_call_symbols ?? []).map((s) =>
        Array.from(s.symbols.globalMacros.keys()).sort()),
});

describe('issue #294 — bounded-cache equivalence property', () => {
    test('capacity 1 resolves identically to default capacity', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 4 }),
                fc.array(arbitrary_non_reserved_identifier(), {
                    minLength: 4, maxLength: 4,
                }),
                async (chain_depth, the_names) => {
                    const temp_dir = fs.mkdtempSync(
                        path.join(os.tmpdir(), 'sight-294-prop-'));
                    try {
                        // leaf defines a global; each ancestor i defines a
                        // global and does the next file down; the resolved
                        // file names the top of the chain via done-by and
                        // also `do`s the leaf directly.
                        const leaf_path = path.join(temp_dir, 'leaf.do');
                        fs.writeFileSync(
                            leaf_path, `global ${the_names[0]}_leaf 1\n`);
                        let child_path = leaf_path;
                        for (let i = 0; i < chain_depth; i++) {
                            const my_path = path.join(
                                temp_dir, `anc_${i}.do`);
                            fs.writeFileSync(
                                my_path,
                                `do "${child_path}"\n` +
                                `global ${the_names[i % 4]}_${i} 1\n`);
                            child_path = my_path;
                        }
                        const target_uri = URI.file(
                            path.join(temp_dir, 'target.do')).toString();
                        const target_content =
                            `// @lsp-done-by: "${child_path}"\n` +
                            `do "${leaf_path}"\n` +
                            'display "hello"\n';

                        const resolve_with = async (starved: boolean) => {
                            const scope = new ScopeResolver(
                                create_test_scope_resolver_logger(),
                                undefined,
                                starved
                                    ? {
                                        max_cached_files: 1,
                                        max_cached_scopes: 1,
                                    }
                                    : undefined);
                            const forward = new ForwardScopeResolver(scope);
                            if (starved) {
                                forward
                                    .set_forward_closure_memo_capacity(1);
                            }
                            scope.set_forward_scope_resolver(forward);
                            // Two passes: the second exercises
                            // post-eviction re-reads on warm-ish state.
                            await scope.resolve(
                                target_uri, target_content, {});
                            scope.invalidate_scope_cache(target_uri);
                            return scope.resolve(
                                target_uri, target_content, {});
                        };

                        const generous = await resolve_with(false);
                        const starved = await resolve_with(true);
                        expect(observable(starved))
                            .toEqual(observable(generous));
                    } finally {
                        fs.rmSync(temp_dir, {
                            recursive: true, force: true,
                        });
                    }
                }
            ),
            { numRuns: 15 }
        );
    }, 60000);
});

/**
 * Unit tests for `ForwardScopeResolver.compute_effective_end_state_locals`.
 *
 * The helper computes a callee's include-only end-state: walk its own
 * `local X` statements in source order, merging the end-states of any
 * nested `include` callees. `do`/`run` callees are NOT descended — they
 * would require a separate boundary promotion to expose their bindings.
 * The helper drives the OUT_OF_SCOPE_SYMBOL rewrite message, so covering
 * it at unit level catches shadowing/redefinition and cycle-handling
 * regressions closer to the code under change.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';

describe('ForwardScopeResolver.compute_effective_end_state_locals', () => {
    let temp_dir: string;
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsr-effective-'));
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver, { max_forward_depth: 10 });
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    async function walk(callee_fs_path: string): Promise<Map<string, any>> {
        const callee_uri = URI.file(callee_fs_path).toString();
        return (forward_resolver as any).compute_effective_end_state_locals(
            callee_uri,
            callee_fs_path,
            undefined,
            new Set<string>(),
            1,
            { max_forward_depth: 10 },
            undefined,
        );
    }

    test('empty callee returns empty map', async () => {
        const my_path = path.join(temp_dir, 'empty.do');
        fs.writeFileSync(my_path, '');
        const result = await walk(my_path);
        expect(result.size).toBe(0);
    });

    test('callee with only own locals: last-def-wins across primary + additional_definitions', async () => {
        const my_path = path.join(temp_dir, 'own_locals.do');
        fs.writeFileSync(my_path, ['local veggie carrot', 'local fruit apple', 'local veggie beet'].join('\n'));
        const result = await walk(my_path);
        expect(result.size).toBe(2);
        expect(result.has('veggie')).toBe(true);
        expect(result.has('fruit')).toBe(true);
        // The late redefinition (line 2) wins; without the Bug A fix the
        // walk would only see the primary at line 0.
        const my_veggie = result.get('veggie');
        expect(my_veggie.sourceUri).toContain('own_locals.do');
    });

    test('include-then-local: local wins when it comes after the include', async () => {
        const defs_path = path.join(temp_dir, 'defs_include_then_local.do');
        fs.writeFileSync(defs_path, 'local veggie beet');
        const my_path = path.join(temp_dir, 'include_then_local.do');
        fs.writeFileSync(my_path, ['include "defs_include_then_local.do"', 'local veggie carrot'].join('\n'));
        const result = await walk(my_path);
        expect(result.size).toBe(1);
        // The caller's own `local` is the last write, so the callee itself
        // should own the bound symbol (not defs.do).
        const my_veggie = result.get('veggie');
        expect(my_veggie.sourceUri).toContain('include_then_local.do');
    });

    test('local-then-include: include wins when it comes after the local', async () => {
        const defs_path = path.join(temp_dir, 'defs_local_then_include.do');
        fs.writeFileSync(defs_path, 'local veggie beet');
        const my_path = path.join(temp_dir, 'local_then_include.do');
        fs.writeFileSync(my_path, ['local veggie carrot', 'include "defs_local_then_include.do"'].join('\n'));
        const result = await walk(my_path);
        expect(result.size).toBe(1);
        const my_veggie = result.get('veggie');
        expect(my_veggie.sourceUri).toContain('defs_local_then_include.do');
    });

    test('nested `do` is opaque: walk does not descend into `do`/`run` callees', async () => {
        // The helper is the engine behind OUT_OF_SCOPE_SYMBOL rewrites. The
        // rewrite is a single-boundary counterfactual: "promote THIS one
        // do/run to include — where would the local now come from?" Deeper
        // do/run boundaries stay opaque because promoting them would be a
        // separate fix. So this walk does not descend into `do`/`run`
        // callees, even when they define the referenced name.
        const nested_path = path.join(temp_dir, 'nested_do_target.do');
        fs.writeFileSync(nested_path, 'local veggie beet');
        const my_path = path.join(temp_dir, 'nested_do.do');
        fs.writeFileSync(my_path, ['do "nested_do_target.do"', 'local fruit apple'].join('\n'));
        const result = await walk(my_path);
        expect(result.has('fruit')).toBe(true);
        expect(result.has('veggie')).toBe(false);
        expect(result.get('fruit')!.sourceUri).toContain('nested_do.do');
    });

    test('own local after opaque `do` wins (nested do target is not walked)', async () => {
        const nested_path = path.join(temp_dir, 'nested_do_redef.do');
        fs.writeFileSync(nested_path, 'local shared beet');
        const my_path = path.join(temp_dir, 'nested_do_overridden.do');
        fs.writeFileSync(
            my_path,
            ['do "nested_do_redef.do"', 'local shared carrot'].join('\n'),
        );
        const result = await walk(my_path);
        expect(result.size).toBe(1);
        // `do` is opaque, so only the caller's own `local shared carrot`
        // contributes — no need to reason about which comes first.
        expect(result.get('shared')!.sourceUri).toContain('nested_do_overridden.do');
    });

    test('cycle terminates and returns empty without throwing', async () => {
        const a_path = path.join(temp_dir, 'cycle_a.do');
        const b_path = path.join(temp_dir, 'cycle_b.do');
        fs.writeFileSync(a_path, 'include "cycle_b.do"');
        fs.writeFileSync(b_path, 'include "cycle_a.do"');
        const result = await walk(a_path);
        // Neither file defines a local — cycle is safely broken.
        expect(result.size).toBe(0);
    });

    test('depth boundary: at max_forward_depth still surfaces own top-level locals', async () => {
        // Callers invoke this helper with `my_context.depth + 1`, so a direct
        // `do` child of the file at `depth == max - 1` arrives here at
        // `depth == max`. It would be processed by the outer resolver, so the
        // helper must also surface the callee's own locals for the
        // diagnostic rewrite to name the blame file.
        const my_path = path.join(temp_dir, 'at_max.do');
        fs.writeFileSync(my_path, 'local veggie beet');
        const callee_uri = URI.file(my_path).toString();
        const result = await (forward_resolver as any).compute_effective_end_state_locals(
            callee_uri,
            my_path,
            undefined,
            new Set<string>(),
            10,
            { max_forward_depth: 10 },
            undefined,
        );
        expect(result.size).toBe(1);
        expect(result.has('veggie')).toBe(true);
    });

    test('depth boundary: at max refuses to descend into own includes', async () => {
        // The helper stops recursing once the next hop would exceed
        // `max_forward_depth`, so nested-include locals from beyond the
        // boundary should be absent even though own locals are present.
        const nested_path = path.join(temp_dir, 'nested_defs_at_boundary.do');
        fs.writeFileSync(nested_path, 'local nested_veggie beet');
        const my_path = path.join(temp_dir, 'at_max_with_nested_include.do');
        fs.writeFileSync(
            my_path,
            ['local own_veggie beet', 'include "nested_defs_at_boundary.do"'].join('\n'),
        );
        const callee_uri = URI.file(my_path).toString();
        const result = await (forward_resolver as any).compute_effective_end_state_locals(
            callee_uri,
            my_path,
            undefined,
            new Set<string>(),
            10,
            { max_forward_depth: 10 },
            undefined,
        );
        expect(result.has('own_veggie')).toBe(true);
        expect(result.has('nested_veggie')).toBe(false);
    });

    test('depth beyond max: returns empty without throwing', async () => {
        // Past the boundary, we don't process the file at all — any symbols
        // claimed here would misattribute blame past the configured depth.
        const my_path = path.join(temp_dir, 'past_max.do');
        fs.writeFileSync(my_path, 'local veggie beet');
        const callee_uri = URI.file(my_path).toString();
        const result = await (forward_resolver as any).compute_effective_end_state_locals(
            callee_uri,
            my_path,
            undefined,
            new Set<string>(),
            11,
            { max_forward_depth: 10 },
            undefined,
        );
        expect(result.size).toBe(0);
    });
});

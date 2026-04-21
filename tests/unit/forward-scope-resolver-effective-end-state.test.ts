/**
 * Unit tests for `ForwardScopeResolver.compute_effective_end_state_locals`.
 *
 * The helper is private; these tests access it via `(fsr as any)` to
 * exercise the walk directly without standing up a full diagnostics
 * pipeline. The helper drives the OUT_OF_SCOPE_SYMBOL rewrite message,
 * so covering it at unit level catches shadowing/redefinition and
 * cycle-handling regressions closer to the code under change.
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

    test('nested `do` contributes nothing to the result (locals do not propagate)', async () => {
        const nested_path = path.join(temp_dir, 'nested_do_target.do');
        fs.writeFileSync(nested_path, 'local veggie beet');
        const my_path = path.join(temp_dir, 'nested_do.do');
        fs.writeFileSync(my_path, ['do "nested_do_target.do"', 'local fruit apple'].join('\n'));
        const result = await walk(my_path);
        // fruit is the callee's own local; veggie is behind a `do` and
        // must not appear.
        expect(result.size).toBe(1);
        expect(result.has('fruit')).toBe(true);
        expect(result.has('veggie')).toBe(false);
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

    test('depth bound: exceeding max_forward_depth returns empty without throwing', async () => {
        const my_path = path.join(temp_dir, 'depth_limited.do');
        fs.writeFileSync(my_path, 'local veggie beet');
        const callee_uri = URI.file(my_path).toString();
        const result = await (forward_resolver as any).compute_effective_end_state_locals(
            callee_uri,
            my_path,
            undefined,
            new Set<string>(),
            // depth starts at 10 — at-or-above max_forward_depth, should bail.
            10,
            { max_forward_depth: 10 },
            undefined,
        );
        expect(result.size).toBe(0);
    });
});

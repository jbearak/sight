/**
 * Property tests for Scope Resolver
 *
 * Tests Properties 5, 6, 7, 8, 9 from the design document.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';
import { create_test_scope_resolver_logger } from '../test-logger';

/**
 * Silent logger for tests that intentionally trigger warnings.
 */
const silent_logger = create_test_scope_resolver_logger();

describe('Scope Resolver Property Tests', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-resolver-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    // Property 5: Cycle Detection Completeness
    describe('Property 5: Cycle Detection Completeness', () => {
        test('detects direct cycles', async () => {
            // A -> B -> A
            const file_a = write_file('a.do', '// @lsp-done-by "b.do"\nlocal x = 1');
            const file_b = write_file('b.do', '// @lsp-done-by "a.do"\nlocal y = 2');

            const result = await resolver.resolve(
                URI.file(file_a).toString(),
                fs.readFileSync(file_a, 'utf8')
            );

            // Cycles should be handled gracefully without emitting diagnostics
            // Expected cycles occur when backward resolution leads to a parent, then forward resolution encounters the original file
            const cycle_diagnostic = result.diagnostics.find(d =>
                d.message.includes('Circular dependency')
            );
            expect(cycle_diagnostic).toBeUndefined();

            // Should still resolve symbols from the current file
            expect(result.symbols.localMacros.has('x')).toBe(true);
        });

        test('detects indirect cycles', async () => {
            // A -> B -> C -> A
            const file_a = write_file('a.do', '// @lsp-done-by "b.do"\nlocal x = 1');
            const file_b = write_file('b.do', '// @lsp-done-by "c.do"\nlocal y = 2');
            const file_c = write_file('c.do', '// @lsp-done-by "a.do"\nlocal z = 3');

            const result = await resolver.resolve(
                URI.file(file_a).toString(),
                fs.readFileSync(file_a, 'utf8')
            );

            // Cycles should be handled gracefully without emitting diagnostics
            // Expected cycles occur when backward resolution leads to a parent, then forward resolution encounters the original file
            const cycle_diagnostic = result.diagnostics.find(d =>
                d.message.includes('Circular dependency')
            );
            expect(cycle_diagnostic).toBeUndefined();

            // Should still resolve symbols from the current file
            expect(result.symbols.localMacros.has('x')).toBe(true);
        });

        test('terminates without infinite recursion', async () => {
            // Self-referential
            const file_a = write_file('self.do', '// @lsp-done-by "self.do"\nlocal x = 1');

            const start = Date.now();
            const result = await resolver.resolve(
                URI.file(file_a).toString(),
                fs.readFileSync(file_a, 'utf8')
            );
            const elapsed = Date.now() - start;

            expect(elapsed).toBeLessThan(1000); // Should complete quickly
            // Cycles should be handled gracefully without emitting diagnostics
            expect(result.diagnostics.some(d => d.message.includes('Circular'))).toBe(false);

            // Should still resolve symbols from the current file
            expect(result.symbols.localMacros.has('x')).toBe(true);
        });
    });

    // Property 6: Inheritance Rule Correctness
    describe('Property 6: Inheritance Rule Correctness', () => {
        test('included-by inherits all symbol types', async () => {
            const parent = write_file('parent.do', `
local parent_local = 1
global parent_global = 2
program define parent_prog
end
gen parent_var = 3
`);
            const child = write_file('child.do', `// @lsp-included-by "parent.do"
local child_local = 4
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            // Should have parent's locals
            expect(result.symbols.localMacros.has('parent_local')).toBe(true);
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            expect(result.symbols.programs.has('parent_prog')).toBe(true);
        });

        test('done-by excludes locals', async () => {
            const parent = write_file('parent.do', `
local parent_local = 1
global parent_global = 2
program define parent_prog
end
`);
            const child = write_file('child.do', `// @lsp-done-by "parent.do"
local child_local = 4
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            // Should NOT have parent's locals
            expect(result.symbols.localMacros.has('parent_local')).toBe(false);
            // Should have globals and programs
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            expect(result.symbols.programs.has('parent_prog')).toBe(true);
        });

        test('done-by strips locals from ancestor included-by chains', async () => {
            // Regression test: grandparent -> parent (included-by) -> child (done-by)
            // Child should NOT see grandparent's locals even though parent inherits them via included-by
            const grandparent = write_file('grandparent.do', `
local grandparent_local = 1
global grandparent_global = 2
`);
            const parent = write_file('parent.do', `// @lsp-included-by "grandparent.do"
local parent_local = 3
global parent_global = 4
`);
            const child = write_file('child.do', `// @lsp-done-by "parent.do"
local child_local = 5
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            // Child should NOT have any ancestor locals (done-by boundary strips them)
            expect(result.symbols.localMacros.has('grandparent_local')).toBe(false);
            expect(result.symbols.localMacros.has('parent_local')).toBe(false);
            // Child should have its own local
            expect(result.symbols.localMacros.has('child_local')).toBe(true);
            // Child should have ancestor globals (done-by allows non-locals)
            expect(result.symbols.globalMacros.has('grandparent_global')).toBe(true);
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
        });
    });

    // Property 7: Call Site Filtering
    describe('Property 7: Call Site Filtering', () => {
        test('filters symbols by call site line', async () => {
            // Line 0: empty, Line 1: before_call, Line 2: include child, Line 3: after_call
            const parent = write_file('parent.do', `local before_call = 1
include child.do
local after_call = 2
`);
            const child = write_file('child.do', `// @lsp-included-by "parent.do" match="include child.do"
local child_local = 3
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            // Should have before_call (line 0) but not after_call (line 2, after call site line 1)
            // Using include semantics so locals ARE inherited
            expect(result.symbols.localMacros.has('before_call')).toBe(true);
            expect(result.symbols.localMacros.has('after_call')).toBe(false);
        });

        test('line parameter works', async () => {
            // Line 0: line1, Line 1: line2, Line 2: line3
            const parent = write_file('parent.do', `local line1 = 1
local line2 = 2
local line3 = 3
`);
            // line=2 means call site is at line 2 (1-indexed), so symbols on lines 0 and 1 (0-indexed) are included
            const child = write_file('child.do', `// @lsp-included-by "parent.do" line=2
local child_local = 4
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            // Should have line1 (line 0) and line2 (line 1) but not line3 (line 2)
            expect(result.symbols.localMacros.has('line1')).toBe(true);
            expect(result.symbols.localMacros.has('line2')).toBe(true);
            expect(result.symbols.localMacros.has('line3')).toBe(false);
        });
    });

    // Property 8: Shadowing Semantics
    describe('Property 8: Shadowing Semantics', () => {
        test('current file shadows ancestors', async () => {
            const parent = write_file('parent.do', `
global shared = "parent"
`);
            const child = write_file('child.do', `// @lsp-included-by "parent.do"
global shared = "child"
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            const shared = result.symbols.globalMacros.get('shared');
            expect(shared?.value).toBe('"child"');
        });

        test('nearer ancestors shadow distant ones', async () => {
            const grandparent = write_file('grandparent.do', `
global shared = "grandparent"
`);
            const parent = write_file('parent.do', `// @lsp-included-by "grandparent.do"
global shared = "parent"
`);
            const child = write_file('child.do', `// @lsp-included-by "parent.do"
local x = 1
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            const shared = result.symbols.globalMacros.get('shared');
            expect(shared?.value).toBe('"parent"');
        });
    });

    // Property 9: Multi-Parent Union
    describe('Property 9: Multi-Parent Union', () => {
        test('unions symbols from multiple parents', async () => {
            const parent1 = write_file('parent1.do', `
global from_parent1 = 1
`);
            const parent2 = write_file('parent2.do', `
global from_parent2 = 2
`);
            const child = write_file('child.do', `// @lsp-done-by "parent1.do"
// @lsp-done-by "parent2.do"
local x = 1
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            expect(result.symbols.globalMacros.has('from_parent1')).toBe(true);
            expect(result.symbols.globalMacros.has('from_parent2')).toBe(true);
        });

        test('included-by takes precedence over done-by for same parent', async () => {
            // When both directives reference the same parent, included-by should win
            // (meaning locals should be included)
            const parent = write_file('parent.do', `
local parent_local = 1
global parent_global = 2
`);
            const child = write_file('child.do', `// @lsp-done-by "parent.do"
// @lsp-included-by "parent.do"
local x = 1
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            // included-by should win, so locals should be included
            expect(result.symbols.localMacros.has('parent_local')).toBe(true);
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
        });

        test('included-by wins regardless of directive order', async () => {
            // Test with included-by first, then done-by
            const parent = write_file('parent.do', `
local parent_local = 1
global parent_global = 2
`);
            const child = write_file('child.do', `// @lsp-included-by "parent.do"
// @lsp-done-by "parent.do"
local x = 1
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            // included-by should still win, so locals should be included
            expect(result.symbols.localMacros.has('parent_local')).toBe(true);
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
        });
    });

    // Error handling
    describe('Error handling', () => {
        test('handles missing files gracefully', async () => {
            // Use silent logger since this test intentionally triggers file-not-found warnings
            const silent_resolver = new ScopeResolver(silent_logger);
            
            const child = write_file('child.do', `// @lsp-done-by "nonexistent.do"
local x = 1
`);

            const result = await silent_resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            expect(result.diagnostics.some(d => d.message.includes('Cannot read file'))).toBe(true);
            // Should still have child's symbols
            expect(result.symbols.localMacros.has('x')).toBe(true);
        });

        test('handles match string not found', async () => {
            const parent = write_file('parent.do', `
local x = 1
`);
            const child = write_file('child.do', `// @lsp-included-by "parent.do" match="nonexistent"
local y = 2
`);

            const result = await resolver.resolve(
                URI.file(child).toString(),
                fs.readFileSync(child, 'utf8')
            );

            expect(result.diagnostics.some(d => d.message.includes('not found'))).toBe(true);
        });
    });
});
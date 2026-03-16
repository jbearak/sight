/**
 * Unit tests for scope-cache-optimization feature.
 * Tests cache separation, metrics, and invalidation behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';
import { URI } from 'vscode-uri';
import { create_empty_symbol_table } from '../../src/analyzer';
import { ForwardCall } from '../../src/types';

describe('Scope Cache Optimization Unit Tests', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-cache-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    // Helper to create test files
    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    describe('10.1: invalidate_scope_cache with no dependents is a no-op', () => {
        it('should not increment metrics when no entries depend on the URI', async () => {
            // Resolve a file to populate scope cache
            const file_path = create_file('test.do', 'local x = 1');
            const file_uri = `file://${file_path}`;

            await resolver.resolve(file_uri, 'local x = 1');
            resolver.reset_cache_metrics();

            // Invalidate a non-existent URI
            resolver.invalidate_scope_cache('file:///nonexistent.do');

            const metrics = resolver.get_cache_metrics();
            expect(metrics.scope.invalidations).toBe(0);
            expect(metrics.file.invalidations).toBe(0);
        });
    });

    describe('10.2: get_parsed_file handles read errors', () => {
        it('should handle missing files gracefully and produce diagnostic', async () => {
            // Use silent-by-default test logger (set STATA_LSP_TEST_LOG=1 for noisy output)
            const silent_resolver = new ScopeResolver(create_test_scope_resolver_logger());
            
            // Create a parent file that references a non-existent file
            const parent_content = `
// @lsp-done-by: nonexistent.do
local x = 1
`;
            const parent_path = create_file('parent.do', parent_content);
            const parent_uri = `file://${parent_path}`;

            // Resolve should handle the missing file gracefully
            const result = await silent_resolver.resolve(parent_uri, parent_content);

            // Should have a diagnostic about the missing file
            expect(
                result.diagnostics.some(d => d.message.includes('Cannot read file'))
            ).toBe(true);
        });
    });

    describe('10.3: Metrics structure has nested and top-level counters', () => {
        it('should have nested scope and file counters', () => {
            const metrics = resolver.get_cache_metrics();

            expect(metrics.scope).toBeDefined();
            expect(metrics.file).toBeDefined();
            expect(typeof metrics.scope.hits).toBe('number');
            expect(typeof metrics.scope.misses).toBe('number');
            expect(typeof metrics.scope.invalidations).toBe('number');
            expect(typeof metrics.file.hits).toBe('number');
            expect(typeof metrics.file.misses).toBe('number');
            expect(typeof metrics.file.invalidations).toBe('number');
        });

        it('should have top-level aliases that match scope counters', async () => {
            const file_path = create_file('test.do', 'local x = 1');
            const file_uri = `file://${file_path}`;

            // Generate some activity
            await resolver.resolve(file_uri, 'local x = 1');
            await resolver.resolve(file_uri, 'local x = 1'); // cache hit

            const metrics = resolver.get_cache_metrics();

            expect(metrics.hits).toBe(metrics.scope.hits);
            expect(metrics.misses).toBe(metrics.scope.misses);
            expect(metrics.invalidations).toBe(metrics.scope.invalidations);
        });
    });

    describe('10.7: FileCacheEntry stores content_hash, not raw content', () => {
        it('should use hash-based comparison for cache hits', async () => {
            const file_path = create_file('test.do', 'local x = 1');
            const file_uri = `file://${file_path}`;

            // First resolve - cache miss
            await resolver.resolve(file_uri, 'local x = 1');
            const metrics1 = resolver.get_cache_metrics();
            expect(metrics1.scope.misses).toBe(1);

            // Same content - cache hit
            await resolver.resolve(file_uri, 'local x = 1');
            const metrics2 = resolver.get_cache_metrics();
            expect(metrics2.scope.hits).toBe(1);

            // Different content - cache miss
            await resolver.resolve(file_uri, 'local y = 2');
            const metrics3 = resolver.get_cache_metrics();
            expect(metrics3.scope.misses).toBe(2);
        });
    });

    describe('invalidate_scope_cache vs invalidate_file_cache', () => {
        it('invalidate_scope_cache should NOT touch file_cache', async () => {
            const parent_path = create_file('parent.do', 'global parent_var = 1');
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = 1`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // Resolve to populate both caches
            await resolver.resolve(child_uri, child_content);
            resolver.reset_cache_metrics();

            // Invalidate scope cache only
            resolver.invalidate_scope_cache(child_uri);

            // Resolve again - should get file cache hit for parent
            await resolver.resolve(child_uri, child_content);

            const metrics = resolver.get_cache_metrics();
            // File cache should have a hit (parent was cached)
            expect(metrics.file.hits).toBeGreaterThan(0);
        });

        it('invalidate_file_cache should cascade to scope_cache', async () => {
            const parent_path = create_file('parent.do', 'global parent_var = 1');
            const parent_uri = `file://${parent_path}`;
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = 1`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // Resolve to populate caches
            await resolver.resolve(child_uri, child_content);
            resolver.reset_cache_metrics();

            // Invalidate file cache for parent
            resolver.invalidate_file_cache(parent_uri);

            const metrics = resolver.get_cache_metrics();
            // Should have incremented both file and scope invalidations
            expect(metrics.file.invalidations).toBe(1);
            expect(metrics.scope.invalidations).toBeGreaterThan(0);
        });
    });

    describe('clear_cache metrics accuracy', () => {
        it('should increment both scope and file invalidations correctly', async () => {
            const parent_path = create_file('parent.do', 'global parent_var = 1');
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = 1`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // Resolve to populate caches
            await resolver.resolve(child_uri, child_content);
            resolver.reset_cache_metrics();

            // Clear all caches
            resolver.clear_cache();

            const metrics = resolver.get_cache_metrics();
            // Should have incremented invalidations for both caches
            expect(metrics.scope.invalidations).toBeGreaterThan(0);
            expect(metrics.file.invalidations).toBeGreaterThan(0);
        });
    });

    describe('reset_cache_metrics', () => {
        it('should reset all counters without clearing caches', async () => {
            const file_path = create_file('test.do', 'local x = 1');
            const file_uri = `file://${file_path}`;

            // Generate some activity
            await resolver.resolve(file_uri, 'local x = 1');
            await resolver.resolve(file_uri, 'local x = 1');

            // Reset metrics
            resolver.reset_cache_metrics();

            const metrics = resolver.get_cache_metrics();
            expect(metrics.scope.hits).toBe(0);
            expect(metrics.scope.misses).toBe(0);
            expect(metrics.scope.invalidations).toBe(0);
            expect(metrics.file.hits).toBe(0);
            expect(metrics.file.misses).toBe(0);
            expect(metrics.file.invalidations).toBe(0);

            // Cache should still be populated - next resolve should be a hit
            await resolver.resolve(file_uri, 'local x = 1');
            const metrics2 = resolver.get_cache_metrics();
            expect(metrics2.scope.hits).toBe(1);
        });
    });

    describe('reset_reverse_deps', () => {
        const make_forward_call = (callee_path: string, line: number): ForwardCall => ({
            type: 'do',
            path: callee_path,
            raw_path: path.basename(callee_path),
            call_site_line: line,
            range: { start: { line, character: 0 }, end: { line, character: 10 } },
            source: 'command',
            is_static: true,
        });

        const make_symbols_with_global = (name: string) => {
            const symbols = create_empty_symbol_table();
            symbols.globalMacros.set(name, {
                name,
                scope: 'global',
                location: {
                    uri: 'test',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                },
                sourceUri: 'test',
            });
            return symbols;
        };

        it('should clear all reverse dep maps and backward directive children', async () => {
            // Populate reverse deps via update_reverse_dependencies
            const callee_path = create_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const forward_calls = [make_forward_call(callee_path, 5)];
            const symbols = make_symbols_with_global('test_global');
            resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            // Populate backward directive children via resolve
            const parent_path = create_file('parent.do', 'global parent_g = 1');
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal y = 1`;
            const child_path = create_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();
            const parent_uri = URI.file(parent_path).toString();
            await resolver.resolve(child_uri, child_content);

            // Verify maps are populated
            expect(resolver.get_callers_for_callee(callee_uri).size).toBeGreaterThan(0);
            expect(resolver.get_backward_directive_children(parent_uri).size).toBeGreaterThan(0);

            // Reset
            resolver.reset_reverse_deps();

            // All reverse dep maps should be empty
            expect(resolver.get_callers_for_callee(callee_uri).size).toBe(0);
            expect(resolver.get_backward_directive_children(parent_uri).size).toBe(0);
        });

        it('clear_cache alone should NOT clear reverse deps', async () => {
            const callee_path = create_file('callee2.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller2.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const forward_calls = [make_forward_call(callee_path, 5)];
            const symbols = make_symbols_with_global('test_global2');
            resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            expect(resolver.get_callers_for_callee(callee_uri).size).toBeGreaterThan(0);

            // clear_cache should not touch reverse deps
            resolver.clear_cache();

            expect(resolver.get_callers_for_callee(callee_uri).size).toBeGreaterThan(0);
        });

        it('dispose should clear both caches and reverse deps', async () => {
            // Populate reverse deps
            const callee_path = create_file('callee3.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller3.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const forward_calls = [make_forward_call(callee_path, 5)];
            const symbols = make_symbols_with_global('test_global3');
            resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            // Populate scope cache
            const parent_path = create_file('parent3.do', 'global parent_g3 = 1');
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal y = 1`;
            const child_path = create_file('child3.do', child_content);
            const child_uri = URI.file(child_path).toString();
            const parent_uri = URI.file(parent_path).toString();
            await resolver.resolve(child_uri, child_content);

            expect(resolver.get_callers_for_callee(callee_uri).size).toBeGreaterThan(0);
            expect(resolver.get_backward_directive_children(parent_uri).size).toBeGreaterThan(0);

            resolver.dispose();

            expect(resolver.get_callers_for_callee(callee_uri).size).toBe(0);
            expect(resolver.get_backward_directive_children(parent_uri).size).toBe(0);
        });
    });
});
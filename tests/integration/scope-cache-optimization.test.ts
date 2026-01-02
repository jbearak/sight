/**
 * Integration tests for scope-cache-optimization feature.
 * Tests the interaction between cache invalidation and file system changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('Scope Cache Optimization Integration Tests', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-cache-int-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    describe('12.1: Editing child.do does NOT re-read unchanged parent.do', () => {
        it('should use file cache for unchanged parent when child is edited', async () => {
            // Create parent file
            const parent_content = 'global parent_var = 1';
            const parent_path = create_file('parent.do', parent_content);
            const parent_uri = `file://${parent_path}`;

            // Create child file with directive
            const child_content_v1 = `// @lsp-done-by: ${parent_path}\nlocal x = 1`;
            const child_path = create_file('child.do', child_content_v1);
            const child_uri = `file://${child_path}`;

            // First resolve - populates both caches
            await resolver.resolve(child_uri, child_content_v1);
            resolver.reset_cache_metrics();

            // Simulate in-memory edit (invalidate_scope_cache, not invalidate_file_cache)
            resolver.invalidate_scope_cache(child_uri);

            // Edit child content
            const child_content_v2 = `// @lsp-done-by: ${parent_path}\nlocal y = 2`;

            // Resolve with new content
            await resolver.resolve(child_uri, child_content_v2);

            const metrics = resolver.get_cache_metrics();
            // Parent should be a file cache hit (not re-read from disk)
            expect(metrics.file.hits).toBe(1);
            expect(metrics.file.misses).toBe(0);
        });
    });

    describe('12.2: Saving parent.do triggers re-read on next resolve', () => {
        it('should re-read parent when file cache is invalidated', async () => {
            // Create parent file
            const parent_content_v1 = 'global parent_var = 1';
            const parent_path = create_file('parent.do', parent_content_v1);
            const parent_uri = `file://${parent_path}`;

            // Create child file with directive
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = \`parent_var'`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // First resolve
            await resolver.resolve(child_uri, child_content);

            // Simulate on-disk change (save) - invalidate file cache
            resolver.invalidate_file_cache(parent_uri);

            // Update parent file on disk
            const parent_content_v2 = 'global parent_var = 2\nglobal new_var = 3';
            fs.writeFileSync(parent_path, parent_content_v2);

            resolver.reset_cache_metrics();

            // Resolve again
            const result = await resolver.resolve(child_uri, child_content);

            const metrics = resolver.get_cache_metrics();
            // Parent should be a file cache miss (re-read from disk)
            expect(metrics.file.misses).toBe(1);

            // Should see the new global from updated parent
            expect(result.symbols.globalMacros.has('new_var')).toBe(true);
        });
    });

    describe('12.3: Deleting parent.do produces diagnostic on next resolve', () => {
        it('should emit diagnostic when parent file is deleted', async () => {
            // Use silent-by-default test logger (set STATA_LSP_TEST_LOG=1 for noisy output)
            const silent_resolver = new ScopeResolver(create_test_scope_resolver_logger());
            
            // Create parent file
            const parent_content = 'global parent_var = 1';
            const parent_path = create_file('parent.do', parent_content);
            const parent_uri = `file://${parent_path}`;

            // Create child file with directive
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = \`parent_var'`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // First resolve - works fine
            const result1 = await silent_resolver.resolve(child_uri, child_content);
            expect(result1.diagnostics.filter(d => d.message.includes('Cannot read file'))).toHaveLength(0);

            // Delete parent file
            fs.unlinkSync(parent_path);

            // Invalidate file cache (simulating watcher event)
            silent_resolver.invalidate_file_cache(parent_uri);

            // Resolve again
            const result2 = await silent_resolver.resolve(child_uri, child_content);

            // Should have diagnostic about missing file
            const missing_file_diagnostics = result2.diagnostics.filter(d => 
                d.message.includes('Cannot read file')
            );
            expect(missing_file_diagnostics.length).toBeGreaterThan(0);
        });
    });

    describe('Cache separation behavior', () => {
        it('should maintain file cache across scope-only invalidations', async () => {
            // Create parent file
            const parent_content = 'global parent_var = 1';
            const parent_path = create_file('parent.do', parent_content);

            // Create child file with directive
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = 1`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // First resolve
            await resolver.resolve(child_uri, child_content);

            // Multiple scope-only invalidations
            for (let i = 0; i < 5; i++) {
                resolver.invalidate_scope_cache(child_uri);
                resolver.reset_cache_metrics();
                await resolver.resolve(child_uri, child_content);

                const metrics = resolver.get_cache_metrics();
                // Parent should always be a file cache hit
                expect(metrics.file.hits).toBe(1);
                expect(metrics.file.misses).toBe(0);
            }
        });

        it('should cascade file invalidation to all dependent scope entries', async () => {
            // Create grandparent file
            const grandparent_content = 'global grandparent_var = 1';
            const grandparent_path = create_file('grandparent.do', grandparent_content);
            const grandparent_uri = `file://${grandparent_path}`;

            // Create parent file with directive to grandparent
            const parent_content = `// @lsp-done-by: ${grandparent_path}\nglobal parent_var = 1`;
            const parent_path = create_file('parent.do', parent_content);

            // Create child file with directive to parent
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = 1`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // Resolve child (loads entire chain)
            await resolver.resolve(child_uri, child_content);
            resolver.reset_cache_metrics();

            // Invalidate grandparent file cache
            resolver.invalidate_file_cache(grandparent_uri);

            const metrics = resolver.get_cache_metrics();
            // Should have cascaded to scope cache
            expect(metrics.scope.invalidations).toBeGreaterThan(0);
            expect(metrics.file.invalidations).toBe(1);
        });
    });

    describe('15.3: Single disk read per parent file (no double-read)', () => {
        it('should read parent file exactly once per resolve (not twice for call-site inference)', async () => {
            // Create parent file with content that requires call-site inference
            const parent_content = `global parent_var = 1
do child.do
global after_call = 2`;
            const parent_path = create_file('parent.do', parent_content);

            // Create child file with directive (no explicit call site - triggers inference)
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = \`parent_var'`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // Clear caches to ensure fresh read
            resolver.clear_cache();
            resolver.reset_cache_metrics();

            // Resolve - should read parent exactly once
            await resolver.resolve(child_uri, child_content);

            // Verify via metrics: file.misses should be 1 (one read for parent)
            // If there were double-reads, we'd see inconsistent behavior or the old code
            // would have had 2 reads but only 1 miss (since second read wasn't tracked)
            const metrics = resolver.get_cache_metrics();
            expect(metrics.file.misses).toBe(1); // Parent was read and parsed once
            expect(metrics.file.hits).toBe(0);   // No cache hits on first resolve
        });

        it('should use content from get_parsed_file for match-based call site resolution', async () => {
            // Create parent file with a match string
            const parent_content = `global before_match = 1
* CALL_SITE_MARKER
global after_match = 2`;
            const parent_path = create_file('parent.do', parent_content);

            // Create child file with match-based call site (note: space after path, not comma)
            const child_content = `// @lsp-done-by: ${parent_path} match="CALL_SITE_MARKER"\nlocal x = \`before_match'`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            resolver.clear_cache();
            resolver.reset_cache_metrics();

            // Resolve - should read parent exactly once even with match-based call site
            const result = await resolver.resolve(child_uri, child_content);

            // Verify via metrics
            const metrics = resolver.get_cache_metrics();
            expect(metrics.file.misses).toBe(1); // Parent was read once
            expect(metrics.file.hits).toBe(0);

            // Verify call site was resolved correctly (before_match should be visible)
            expect(result.symbols.globalMacros.has('before_match')).toBe(true);
            // after_match should NOT be visible (defined after call site)
            expect(result.symbols.globalMacros.has('after_match')).toBe(false);
        });

        it('should read parent once on cache hit (content returned transiently)', async () => {
            // Create parent file
            const parent_content = 'global parent_var = 1';
            const parent_path = create_file('parent.do', parent_content);

            // Create child file with directive
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = 1`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            // First resolve to populate cache
            await resolver.resolve(child_uri, child_content);

            // Invalidate scope cache only (simulating in-memory edit)
            resolver.invalidate_scope_cache(child_uri);
            resolver.reset_cache_metrics();

            // Resolve again - should still read parent once (for hash check) but get cache hit
            await resolver.resolve(child_uri, child_content);

            // Verify it was a cache hit (content unchanged, so hash matches)
            const metrics = resolver.get_cache_metrics();
            expect(metrics.file.hits).toBe(1);
            expect(metrics.file.misses).toBe(0);
        });

        it('should correctly resolve call site with inferred do-file reference', async () => {
            // Create parent file that calls child.do
            const parent_content = `global before_do = 1
do child.do
global after_do = 2`;
            const parent_path = create_file('parent.do', parent_content);

            // Create child file with directive (no explicit call site - should infer from "do child.do")
            const child_content = `// @lsp-done-by: ${parent_path}\nlocal x = \`before_do'`;
            const child_path = create_file('child.do', child_content);
            const child_uri = `file://${child_path}`;

            resolver.clear_cache();
            resolver.reset_cache_metrics();

            const result = await resolver.resolve(child_uri, child_content);

            // Verify call site was inferred correctly
            // before_do should be visible (defined before "do child.do")
            expect(result.symbols.globalMacros.has('before_do')).toBe(true);
            // after_do should NOT be visible (defined after "do child.do")
            expect(result.symbols.globalMacros.has('after_do')).toBe(false);

            // Verify only one file read
            const metrics = resolver.get_cache_metrics();
            expect(metrics.file.misses).toBe(1);
        });
    });
});

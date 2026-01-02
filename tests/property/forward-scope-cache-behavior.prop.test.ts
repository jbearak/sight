/**
 * Feature: forward-scope-cache-behavior, Properties 4 and 5: Cache Key and Invalidation Behavior
 * Validates: Requirements 2.3, 4.1, 4.2, 4.3
 *
 * Property 4: Cache Key Includes Working Directory
 * *For any* file parsed with a working directory context, the cache key SHALL include
 * the working directory, such that parsing the same file with a different working
 * directory results in a cache miss and re-parse.
 *
 * Property 5: Cache Invalidation Removes All Entries
 * *For any* file with multiple cache entries (due to different working directories),
 * when the file is invalidated, ALL cache entries for that file SHALL be removed
 * regardless of working directory.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';

describe('Property 4: Cache Key Includes Working Directory', () => {
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-key-wd-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file to the temp directory.
     */
    const write_file = (relative_path: string, content: string): string => {
        const full_path = path.join(temp_dir, relative_path);
        const dir = path.dirname(full_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(full_path, content);
        return full_path;
    };

    // Generator for simple directory names (alphanumeric, lowercase, safe for filesystem)
    const dir_name_gen = fc.string({ minLength: 2, maxLength: 8 })
        .filter(s => /^[a-z][a-z0-9]*$/.test(s));

    // Generator for simple file names (alphanumeric with underscores)
    const file_name_gen = fc.string({ minLength: 2, maxLength: 12 })
        .filter(s => /^[a-z][a-z0-9_]*$/.test(s));

    /**
     * Test 4.1: Same file with different working directories results in cache miss
     *
     * For any file F parsed with working directory W1, when the same file F is
     * parsed with a different working directory W2, it SHALL result in a cache miss.
     *
     * **Validates: Requirements 2.3, 4.1**
     */
    test('same file with different working directories results in cache miss', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                dir_name_gen,
                file_name_gen,
                async (wd1_name, wd2_name, target_file_name) => {
                    // Ensure working directories are different
                    fc.pre(wd1_name !== wd2_name);

                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure:
                    // temp_dir/
                    //   wd1/                        <- Working directory 1
                    //   wd2/                        <- Working directory 2
                    //   scripts/
                    //     target.do                 <- Target file to parse

                    const wd1_dir = path.join(temp_dir, wd1_name);
                    const wd2_dir = path.join(temp_dir, wd2_name);
                    const scripts_dir = path.join(temp_dir, 'scripts');

                    fs.mkdirSync(wd1_dir, { recursive: true });
                    fs.mkdirSync(wd2_dir, { recursive: true });
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    // Create target file
                    const target_content = `global test_var = "test_value"`;
                    const target_path = write_file(`scripts/${target_file_name}.do`, target_content);
                    const target_uri = URI.file(target_path).toString();

                    // Parse file with first working directory
                    const result1 = await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: wd1_dir }
                    );
                    expect('error' in result1).toBe(false);

                    const metrics_after_first = scope_resolver.get_cache_metrics();
                    expect(metrics_after_first.file.misses).toBe(1);
                    expect(metrics_after_first.file.hits).toBe(0);

                    // Parse same file with second working directory - should be cache miss
                    const result2 = await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: wd2_dir }
                    );
                    expect('error' in result2).toBe(false);

                    const metrics_after_second = scope_resolver.get_cache_metrics();
                    // Should have 2 misses total (one for each working directory)
                    expect(metrics_after_second.file.misses).toBe(2);
                    expect(metrics_after_second.file.hits).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 4.2: Same file with same working directory results in cache hit
     *
     * For any file F parsed with working directory W, when the same file F is
     * parsed again with the same working directory W, it SHALL result in a cache hit.
     *
     * **Validates: Requirements 2.3, 4.2**
     */
    test('same file with same working directory results in cache hit', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                async (wd_name, target_file_name) => {
                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure:
                    // temp_dir/
                    //   wd/                         <- Working directory
                    //   scripts/
                    //     target.do                 <- Target file to parse

                    const wd_dir = path.join(temp_dir, wd_name);
                    const scripts_dir = path.join(temp_dir, 'scripts');

                    fs.mkdirSync(wd_dir, { recursive: true });
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    // Create target file
                    const target_content = `global test_var = "test_value"`;
                    const target_path = write_file(`scripts/${target_file_name}.do`, target_content);
                    const target_uri = URI.file(target_path).toString();

                    // Parse file with working directory
                    const result1 = await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: wd_dir }
                    );
                    expect('error' in result1).toBe(false);

                    const metrics_after_first = scope_resolver.get_cache_metrics();
                    expect(metrics_after_first.file.misses).toBe(1);
                    expect(metrics_after_first.file.hits).toBe(0);

                    // Parse same file with same working directory - should be cache hit
                    const result2 = await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: wd_dir }
                    );
                    expect('error' in result2).toBe(false);

                    const metrics_after_second = scope_resolver.get_cache_metrics();
                    // Should have 1 miss and 1 hit
                    expect(metrics_after_second.file.misses).toBe(1);
                    expect(metrics_after_second.file.hits).toBe(1);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 4.3: File without working directory has separate cache entry from file with working directory
     *
     * For any file F, parsing with no working directory and parsing with a working
     * directory W SHALL result in separate cache entries (both cache misses).
     *
     * **Validates: Requirements 2.3, 4.3**
     */
    test('file without working directory has separate cache entry from file with working directory', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                async (wd_name, target_file_name) => {
                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure:
                    // temp_dir/
                    //   wd/                         <- Working directory
                    //   scripts/
                    //     target.do                 <- Target file to parse

                    const wd_dir = path.join(temp_dir, wd_name);
                    const scripts_dir = path.join(temp_dir, 'scripts');

                    fs.mkdirSync(wd_dir, { recursive: true });
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    // Create target file
                    const target_content = `global test_var = "test_value"`;
                    const target_path = write_file(`scripts/${target_file_name}.do`, target_content);
                    const target_uri = URI.file(target_path).toString();

                    // Parse file without working directory
                    const result1 = await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: undefined }
                    );
                    expect('error' in result1).toBe(false);

                    const metrics_after_first = scope_resolver.get_cache_metrics();
                    expect(metrics_after_first.file.misses).toBe(1);

                    // Parse same file with working directory - should be cache miss
                    const result2 = await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: wd_dir }
                    );
                    expect('error' in result2).toBe(false);

                    const metrics_after_second = scope_resolver.get_cache_metrics();
                    // Should have 2 misses total
                    expect(metrics_after_second.file.misses).toBe(2);
                    expect(metrics_after_second.file.hits).toBe(0);

                    // Parse file without working directory again - should be cache hit
                    const result3 = await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: undefined }
                    );
                    expect('error' in result3).toBe(false);

                    const metrics_after_third = scope_resolver.get_cache_metrics();
                    // Should have 2 misses and 1 hit
                    expect(metrics_after_third.file.misses).toBe(2);
                    expect(metrics_after_third.file.hits).toBe(1);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 4.4: Cache key format includes working directory as suffix
     *
     * For any file F parsed with working directory W, the cache key SHALL be
     * formatted as "uri|working_directory" to ensure uniqueness.
     *
     * **Validates: Requirements 2.3, 4.1**
     */
    test('cache key format includes working directory as suffix', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                dir_name_gen,
                file_name_gen,
                async (wd1_name, wd2_name, target_file_name) => {
                    // Ensure working directories are different
                    fc.pre(wd1_name !== wd2_name);

                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure
                    const wd1_dir = path.join(temp_dir, wd1_name);
                    const wd2_dir = path.join(temp_dir, wd2_name);
                    const scripts_dir = path.join(temp_dir, 'scripts');

                    fs.mkdirSync(wd1_dir, { recursive: true });
                    fs.mkdirSync(wd2_dir, { recursive: true });
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    // Create target file
                    const target_content = `global test_var = "test_value"`;
                    const target_path = write_file(`scripts/${target_file_name}.do`, target_content);
                    const target_uri = URI.file(target_path).toString();

                    // Parse file with both working directories
                    await scope_resolver.get_parsed_file(target_uri, target_path, { working_directory: wd1_dir });
                    await scope_resolver.get_parsed_file(target_uri, target_path, { working_directory: wd2_dir });
                    await scope_resolver.get_parsed_file(target_uri, target_path, { working_directory: undefined });

                    // All three should be cache misses (different cache keys)
                    const metrics = scope_resolver.get_cache_metrics();
                    expect(metrics.file.misses).toBe(3);
                    expect(metrics.file.hits).toBe(0);

                    // Now re-parse each - all should be cache hits
                    await scope_resolver.get_parsed_file(target_uri, target_path, { working_directory: wd1_dir });
                    await scope_resolver.get_parsed_file(target_uri, target_path, { working_directory: wd2_dir });
                    await scope_resolver.get_parsed_file(target_uri, target_path, { working_directory: undefined });

                    const metrics_after = scope_resolver.get_cache_metrics();
                    expect(metrics_after.file.misses).toBe(3);
                    expect(metrics_after.file.hits).toBe(3);
                }
            ),
            { numRuns: 100 }
        );
    });
});


describe('Property 5: Cache Invalidation Removes All Entries', () => {
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-invalidate-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file to the temp directory.
     */
    const write_file = (relative_path: string, content: string): string => {
        const full_path = path.join(temp_dir, relative_path);
        const dir = path.dirname(full_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(full_path, content);
        return full_path;
    };

    // Generator for simple directory names (alphanumeric, lowercase, safe for filesystem)
    const dir_name_gen = fc.string({ minLength: 2, maxLength: 8 })
        .filter(s => /^[a-z][a-z0-9]*$/.test(s));

    // Generator for simple file names (alphanumeric with underscores)
    const file_name_gen = fc.string({ minLength: 2, maxLength: 12 })
        .filter(s => /^[a-z][a-z0-9_]*$/.test(s));

    /**
     * Test 5.1: Invalidating file removes all cache entries regardless of working directory
     *
     * For any file F with N cache entries (due to N different working directories),
     * when invalidate_file_cache(F) is called, ALL N cache entries SHALL be removed.
     *
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    test('invalidating file removes all cache entries regardless of working directory', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(dir_name_gen, { minLength: 2, maxLength: 5 }),
                file_name_gen,
                async (wd_names, target_file_name) => {
                    // Ensure all working directory names are unique
                    const unique_wd_names = [...new Set(wd_names)];
                    fc.pre(unique_wd_names.length >= 2);

                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure
                    const scripts_dir = path.join(temp_dir, 'scripts');
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    const the_wd_dirs: string[] = [];
                    for (const my_wd_name of unique_wd_names) {
                        const my_wd_dir = path.join(temp_dir, my_wd_name);
                        fs.mkdirSync(my_wd_dir, { recursive: true });
                        the_wd_dirs.push(my_wd_dir);
                    }

                    // Create target file
                    const target_content = `global test_var = "test_value"`;
                    const target_path = write_file(`scripts/${target_file_name}.do`, target_content);
                    const target_uri = URI.file(target_path).toString();

                    // Parse file with each working directory to create multiple cache entries
                    for (const my_wd_dir of the_wd_dirs) {
                        await scope_resolver.get_parsed_file(
                            target_uri,
                            target_path,
                            { working_directory: my_wd_dir }
                        );
                    }

                    // Also parse without working directory
                    await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: undefined }
                    );

                    const num_entries = the_wd_dirs.length + 1;
                    const metrics_before_invalidation = scope_resolver.get_cache_metrics();
                    expect(metrics_before_invalidation.file.misses).toBe(num_entries);

                    // Verify all entries are cached (re-parse should be hits)
                    for (const my_wd_dir of the_wd_dirs) {
                        await scope_resolver.get_parsed_file(
                            target_uri,
                            target_path,
                            { working_directory: my_wd_dir }
                        );
                    }
                    await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: undefined }
                    );

                    const metrics_after_hits = scope_resolver.get_cache_metrics();
                    expect(metrics_after_hits.file.hits).toBe(num_entries);

                    // Invalidate the file cache
                    scope_resolver.invalidate_file_cache(target_uri);

                    const metrics_after_invalidation = scope_resolver.get_cache_metrics();
                    // All entries should have been invalidated
                    expect(metrics_after_invalidation.file.invalidations).toBe(num_entries);

                    // Re-parse all - should all be cache misses now
                    for (const my_wd_dir of the_wd_dirs) {
                        await scope_resolver.get_parsed_file(
                            target_uri,
                            target_path,
                            { working_directory: my_wd_dir }
                        );
                    }
                    await scope_resolver.get_parsed_file(
                        target_uri,
                        target_path,
                        { working_directory: undefined }
                    );

                    const metrics_final = scope_resolver.get_cache_metrics();
                    // Should have num_entries * 2 misses total (before and after invalidation)
                    expect(metrics_final.file.misses).toBe(num_entries * 2);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 5.2: Invalidation of one file does not affect cache entries for other files
     *
     * For any two files F1 and F2, when invalidate_file_cache(F1) is called,
     * cache entries for F2 SHALL remain intact.
     *
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    test('invalidation of one file does not affect cache entries for other files', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                file_name_gen,
                async (wd_name, file1_name, file2_name) => {
                    // Ensure file names are different
                    fc.pre(file1_name !== file2_name);

                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure
                    const wd_dir = path.join(temp_dir, wd_name);
                    const scripts_dir = path.join(temp_dir, 'scripts');

                    fs.mkdirSync(wd_dir, { recursive: true });
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    // Create two target files
                    const file1_content = `global file1_var = "file1_value"`;
                    const file1_path = write_file(`scripts/${file1_name}.do`, file1_content);
                    const file1_uri = URI.file(file1_path).toString();

                    const file2_content = `global file2_var = "file2_value"`;
                    const file2_path = write_file(`scripts/${file2_name}.do`, file2_content);
                    const file2_uri = URI.file(file2_path).toString();

                    // Parse both files with working directory
                    await scope_resolver.get_parsed_file(file1_uri, file1_path, { working_directory: wd_dir });
                    await scope_resolver.get_parsed_file(file2_uri, file2_path, { working_directory: wd_dir });

                    const metrics_after_parse = scope_resolver.get_cache_metrics();
                    expect(metrics_after_parse.file.misses).toBe(2);

                    // Verify both are cached
                    await scope_resolver.get_parsed_file(file1_uri, file1_path, { working_directory: wd_dir });
                    await scope_resolver.get_parsed_file(file2_uri, file2_path, { working_directory: wd_dir });

                    const metrics_after_hits = scope_resolver.get_cache_metrics();
                    expect(metrics_after_hits.file.hits).toBe(2);

                    // Invalidate only file1
                    scope_resolver.invalidate_file_cache(file1_uri);

                    const metrics_after_invalidation = scope_resolver.get_cache_metrics();
                    expect(metrics_after_invalidation.file.invalidations).toBe(1);

                    // Re-parse file1 - should be cache miss
                    await scope_resolver.get_parsed_file(file1_uri, file1_path, { working_directory: wd_dir });

                    const metrics_after_file1 = scope_resolver.get_cache_metrics();
                    expect(metrics_after_file1.file.misses).toBe(3); // 2 initial + 1 after invalidation

                    // Re-parse file2 - should still be cache hit (not invalidated)
                    await scope_resolver.get_parsed_file(file2_uri, file2_path, { working_directory: wd_dir });

                    const metrics_final = scope_resolver.get_cache_metrics();
                    expect(metrics_final.file.hits).toBe(3); // 2 initial + 1 after file1 invalidation
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 5.3: Invalidation count matches number of cache entries removed
     *
     * For any file F with N cache entries, when invalidate_file_cache(F) is called,
     * the invalidation count in metrics SHALL increase by exactly N.
     *
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    test('invalidation count matches number of cache entries removed', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(dir_name_gen, { minLength: 1, maxLength: 6 }),
                file_name_gen,
                async (wd_names, target_file_name) => {
                    // Ensure all working directory names are unique
                    const unique_wd_names = [...new Set(wd_names)];

                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure
                    const scripts_dir = path.join(temp_dir, 'scripts');
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    const the_wd_dirs: string[] = [];
                    for (const my_wd_name of unique_wd_names) {
                        const my_wd_dir = path.join(temp_dir, my_wd_name);
                        fs.mkdirSync(my_wd_dir, { recursive: true });
                        the_wd_dirs.push(my_wd_dir);
                    }

                    // Create target file
                    const target_content = `global test_var = "test_value"`;
                    const target_path = write_file(`scripts/${target_file_name}.do`, target_content);
                    const target_uri = URI.file(target_path).toString();

                    // Parse file with each working directory
                    for (const my_wd_dir of the_wd_dirs) {
                        await scope_resolver.get_parsed_file(
                            target_uri,
                            target_path,
                            { working_directory: my_wd_dir }
                        );
                    }

                    const num_entries = the_wd_dirs.length;
                    const metrics_before = scope_resolver.get_cache_metrics();
                    expect(metrics_before.file.invalidations).toBe(0);

                    // Invalidate the file cache
                    scope_resolver.invalidate_file_cache(target_uri);

                    const metrics_after = scope_resolver.get_cache_metrics();
                    // Invalidation count should match number of entries
                    expect(metrics_after.file.invalidations).toBe(num_entries);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 5.4: Multiple invalidations of same file are idempotent
     *
     * For any file F, calling invalidate_file_cache(F) multiple times after the
     * first invalidation SHALL not increase the invalidation count (no entries to remove).
     *
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    test('multiple invalidations of same file are idempotent', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(dir_name_gen, { minLength: 2, maxLength: 4 }),
                file_name_gen,
                fc.integer({ min: 2, max: 5 }),
                async (wd_names, target_file_name, num_invalidations) => {
                    // Ensure all working directory names are unique
                    const unique_wd_names = [...new Set(wd_names)];
                    fc.pre(unique_wd_names.length >= 2);

                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure
                    const scripts_dir = path.join(temp_dir, 'scripts');
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    const the_wd_dirs: string[] = [];
                    for (const my_wd_name of unique_wd_names) {
                        const my_wd_dir = path.join(temp_dir, my_wd_name);
                        fs.mkdirSync(my_wd_dir, { recursive: true });
                        the_wd_dirs.push(my_wd_dir);
                    }

                    // Create target file
                    const target_content = `global test_var = "test_value"`;
                    const target_path = write_file(`scripts/${target_file_name}.do`, target_content);
                    const target_uri = URI.file(target_path).toString();

                    // Parse file with each working directory
                    for (const my_wd_dir of the_wd_dirs) {
                        await scope_resolver.get_parsed_file(
                            target_uri,
                            target_path,
                            { working_directory: my_wd_dir }
                        );
                    }

                    const num_entries = the_wd_dirs.length;

                    // First invalidation should remove all entries
                    scope_resolver.invalidate_file_cache(target_uri);
                    const metrics_after_first = scope_resolver.get_cache_metrics();
                    expect(metrics_after_first.file.invalidations).toBe(num_entries);

                    // Subsequent invalidations should not increase count (no entries to remove)
                    for (let i = 1; i < num_invalidations; i++) {
                        scope_resolver.invalidate_file_cache(target_uri);
                    }

                    const metrics_final = scope_resolver.get_cache_metrics();
                    // Invalidation count should still be num_entries (no additional entries removed)
                    expect(metrics_final.file.invalidations).toBe(num_entries);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 5.5: Invalidation cascades to scope cache entries
     *
     * For any file F that is part of a directive chain, when invalidate_file_cache(F)
     * is called, scope cache entries that depend on F SHALL also be invalidated.
     *
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    test('invalidation cascades to scope cache entries', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                file_name_gen,
                fc.constantFrom('done-by', 'included-by'),
                async (wd_name, parent_file_name, child_file_name, directive_type) => {
                    // Ensure file names are different
                    fc.pre(parent_file_name !== child_file_name);

                    // Clear cache and reset metrics at the start of each iteration
                    scope_resolver.clear_cache();
                    scope_resolver.reset_cache_metrics();

                    // Create directory structure
                    const wd_dir = path.join(temp_dir, wd_name);
                    const scripts_dir = path.join(temp_dir, 'scripts');

                    fs.mkdirSync(wd_dir, { recursive: true });
                    fs.mkdirSync(scripts_dir, { recursive: true });

                    // Create parent file
                    const parent_content = `global parent_var = "parent_value"`;
                    const parent_path = write_file(`scripts/${parent_file_name}.do`, parent_content);
                    const parent_uri = URI.file(parent_path).toString();

                    // Create child file with directive to parent
                    const child_content = `// @lsp-${directive_type}: "${parent_file_name}.do"\nlocal child_var = 1`;
                    const child_path = write_file(`scripts/${child_file_name}.do`, child_content);
                    const child_uri = URI.file(child_path).toString();

                    // Resolve scope for child (this will cache both file and scope entries)
                    const result1 = await scope_resolver.resolve(child_uri, child_content);
                    expect(result1.symbols.globalMacros.has('parent_var')).toBe(true);

                    const metrics_after_resolve = scope_resolver.get_cache_metrics();
                    expect(metrics_after_resolve.scope.misses).toBe(1);

                    // Resolve again - should be scope cache hit
                    const result2 = await scope_resolver.resolve(child_uri, child_content);
                    expect(result2.symbols.globalMacros.has('parent_var')).toBe(true);

                    const metrics_after_hit = scope_resolver.get_cache_metrics();
                    expect(metrics_after_hit.scope.hits).toBe(1);

                    // Invalidate parent file cache
                    scope_resolver.invalidate_file_cache(parent_uri);

                    const metrics_after_invalidation = scope_resolver.get_cache_metrics();
                    // Scope cache should also be invalidated (cascade)
                    expect(metrics_after_invalidation.scope.invalidations).toBeGreaterThanOrEqual(1);

                    // Resolve again - should be scope cache miss (invalidated)
                    const result3 = await scope_resolver.resolve(child_uri, child_content);
                    expect(result3.symbols.globalMacros.has('parent_var')).toBe(true);

                    const metrics_final = scope_resolver.get_cache_metrics();
                    expect(metrics_final.scope.misses).toBe(2); // Initial + after invalidation
                }
            ),
            { numRuns: 100 }
        );
    });
});

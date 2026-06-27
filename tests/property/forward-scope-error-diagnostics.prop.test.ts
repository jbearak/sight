/**
 * Feature: forward-scope-working-directory-fix, Property 6: Error Diagnostics Include Tried Paths
 * Validates: Requirements 3.2, 3.3
 *
 * Property 6: Error Diagnostics Include Tried Paths
 * *For any* forward call that cannot be resolved, the emitted diagnostic SHALL include
 * the paths that were attempted during resolution.
 *
 * This test validates that when a forward call path cannot be resolved (file doesn't exist),
 * the diagnostic message includes information about the paths that were tried during resolution.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';
import { ForwardCall } from '../../src/types';

describe('Property 6: Error Diagnostics Include Tried Paths', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'error-diag-tried-paths-'));
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

    /**
     * Helper to create a ForwardCall object.
     */
    const create_forward_call = (
        resolved_path: string,
        raw_path: string,
        call_type: 'do' | 'run' | 'include',
        call_site_line: number
    ): ForwardCall => ({
        type: call_type,
        raw_path,
        call_site_line,
        range: {
            start: { line: call_site_line, character: 0 },
            end: { line: call_site_line, character: raw_path.length + call_type.length + 3 }
        },
        source: 'command',
        is_static: true,
    });

    // Generator for simple directory names (alphanumeric, lowercase, safe for filesystem)
    const dir_name_gen = fc.string({ minLength: 2, maxLength: 8 })
        .filter(s => /^[a-z][a-z0-9]*$/.test(s));

    // Generator for simple file names (alphanumeric with underscores, no extension)
    const file_name_gen = fc.string({ minLength: 2, maxLength: 12 })
        .filter(s => /^[a-z][a-z0-9_]*$/.test(s));

    // Generator for forward call directive types
    const forward_call_type_gen = fc.constantFrom('do', 'run', 'include') as fc.Arbitrary<'do' | 'run' | 'include'>;

    // Generator for backward directive types
    const backward_directive_gen = fc.constantFrom('done-by', 'included-by');

    // Generator for working directory synonyms
    const wd_synonym_gen = fc.constantFrom(
        'working-directory',
        'working-dir',
        'current-directory',
        'current-dir',
        'cd',
        'wd'
    );

    /**
     * Test 6.1: Diagnostic includes tried paths when file doesn't exist (no .do extension)
     *
     * When a forward call references a file without .do extension that doesn't exist,
     * the diagnostic should include both the original path and the .do fallback path
     * that were tried.
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('diagnostic includes tried paths when file without .do extension does not exist', async () => {
        await fc.assert(
            fc.asyncProperty(
                file_name_gen,
                forward_call_type_gen,
                async (missing_file_name, call_type) => {
                    // Create a parent file
                    const parent_content = `local parent_var = 1`;
                    const parent_path = write_file('parent.do', parent_content);

                    // Create a forward call to a non-existent file (without .do extension)
                    // This should trigger the .do fallback logic
                    const missing_path = path.join(temp_dir, missing_file_name);
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(missing_path, missing_file_name, call_type, 0)
                    ];

                    // Resolve forward scope
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: undefined,
                            call_chain: [],
                        }
                    );

                    // Should have a diagnostic about the missing file
                    const missing_file_diag = result.diagnostics.find(d =>
                        d.message.includes('Cannot read file')
                    );
                    expect(missing_file_diag).toBeDefined();

                    // The diagnostic should include "tried:" with the paths attempted
                    expect(missing_file_diag!.message).toContain('tried:');

                    // Should include both the original path and the .do fallback
                    expect(missing_file_diag!.message).toContain(missing_path);
                    expect(missing_file_diag!.message).toContain(missing_path + '.do');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 6.2: Diagnostic does not include "tried:" when file has .do extension
     *
     * When a forward call references a file with .do extension that doesn't exist,
     * the diagnostic should NOT include "tried:" since no fallback was attempted.
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('diagnostic does not include tried paths when file with .do extension does not exist', async () => {
        await fc.assert(
            fc.asyncProperty(
                file_name_gen,
                forward_call_type_gen,
                async (missing_file_name, call_type) => {
                    // Create a parent file
                    const parent_content = `local parent_var = 1`;
                    const parent_path = write_file('parent.do', parent_content);

                    // Create a forward call to a non-existent file WITH .do extension
                    // This should NOT trigger the .do fallback logic
                    const missing_path = path.join(temp_dir, missing_file_name + '.do');
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(missing_path, missing_file_name + '.do', call_type, 0)
                    ];

                    // Resolve forward scope
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: undefined,
                            call_chain: [],
                        }
                    );

                    // Should have a diagnostic about the missing file
                    const missing_file_diag = result.diagnostics.find(d =>
                        d.message.includes('Cannot read file')
                    );
                    expect(missing_file_diag).toBeDefined();

                    // The diagnostic should NOT include "tried:" since no fallback was attempted
                    expect(missing_file_diag!.message).not.toContain('tried:');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 6.3: Diagnostic includes tried paths with different call types
     *
     * When a forward call of any type (do, run, include) cannot be resolved,
     * the diagnostic should include the tried paths.
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('diagnostic includes tried paths with different call types', async () => {
        await fc.assert(
            fc.asyncProperty(
                file_name_gen,
                forward_call_type_gen,
                async (missing_name, call_type) => {
                    // Create a parent file
                    const parent_content = `local parent_var = 1`;
                    const parent_path = write_file('parent.do', parent_content);

                    // The missing path is resolved relative to the parent file's directory (temp_dir)
                    const missing_path = path.join(temp_dir, missing_name);

                    // Create a forward call to the missing file
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(missing_path, missing_name, call_type, 0),
                    ];

                    // Resolve forward scope
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: undefined,
                            call_chain: [],
                        }
                    );

                    // Should have exactly 1 diagnostic
                    expect(result.diagnostics.length).toBe(1);

                    // The diagnostic should be for the missing file
                    const missing_file_diag = result.diagnostics[0];
                    expect(missing_file_diag.message).toContain('Cannot read file');
                    expect(missing_file_diag.message).toContain(missing_name);

                    // The diagnostic should include "tried:" with the paths attempted
                    expect(missing_file_diag.message).toContain('tried:');

                    // Should include both the original path and the .do fallback in the tried paths
                    expect(missing_file_diag.message).toContain(missing_path);
                    expect(missing_file_diag.message).toContain(missing_path + '.do');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 6.4: Diagnostic includes tried paths with working directory context
     *
     * When a forward call with a working directory context cannot be resolved,
     * the diagnostic should include the tried paths (resolved relative to working directory).
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('diagnostic includes tried paths with working directory context', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                wd_synonym_gen,
                forward_call_type_gen,
                async (subdir_name, missing_name, wd_synonym, call_type) => {
                    // Create directory structure:
                    // temp_dir/
                    //   scripts/
                    //     parent.do           <- Has working directory pointing to ../data
                    //   data/                 <- Working directory (but missing file not here)

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const data_dir = path.join(temp_dir, 'data');
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(data_dir, { recursive: true });

                    // Create parent file with working directory
                    const parent_content = `// @lsp-${wd_synonym}: "../data"\nlocal parent_var = 1`;
                    const parent_path = write_file('scripts/parent.do', parent_content);

                    // Create a forward call to a non-existent file (without .do extension)
                    // The path should be resolved relative to the working directory (data/)
                    const missing_path = path.join(data_dir, missing_name);
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(missing_path, missing_name, call_type, 1)
                    ];

                    // Resolve forward scope with working directory context
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: data_dir,
                            call_chain: [],
                        }
                    );

                    // Should have a diagnostic about the missing file
                    const missing_file_diag = result.diagnostics.find(d =>
                        d.message.includes('Cannot read file')
                    );
                    expect(missing_file_diag).toBeDefined();

                    // The diagnostic should include "tried:" with the paths attempted
                    expect(missing_file_diag!.message).toContain('tried:');

                    // Should include both the original path and the .do fallback
                    expect(missing_file_diag!.message).toContain(missing_path);
                    expect(missing_file_diag!.message).toContain(missing_path + '.do');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 6.5: Diagnostic includes tried paths through backward directive chain
     *
     * When a forward call directive (@lsp-do, @lsp-run, @lsp-include) cannot be resolved,
     * the diagnostic should include the tried paths.
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('diagnostic includes tried paths for directive-based forward calls', async () => {
        await fc.assert(
            fc.asyncProperty(
                file_name_gen,
                forward_call_type_gen,
                async (missing_name, forward_type) => {
                    // Create a parent file with a forward call directive to a missing file
                    const missing_path = path.join(temp_dir, missing_name);
                    const parent_content = `// @lsp-${forward_type}: "${missing_name}"\nlocal parent_var = 1`;
                    const parent_path = write_file('parent.do', parent_content);

                    // Create a forward call to the missing file
                    // (simulating what the directive parser would extract)
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(missing_path, missing_name, forward_type as 'do' | 'run' | 'include', 0),
                    ];

                    // Resolve forward scope using the forward resolver directly
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: undefined,
                            call_chain: [],
                        }
                    );

                    // Find the "Cannot read file" diagnostic for the missing file
                    const missing_file_diag = result.diagnostics.find(d =>
                        d.message.includes('Cannot read file') && d.message.includes(missing_name)
                    );
                    expect(missing_file_diag).toBeDefined();

                    // The diagnostic should include "tried:" with the paths attempted
                    expect(missing_file_diag!.message).toContain('tried:');

                    // Should include both the original path and the .do fallback
                    expect(missing_file_diag!.message).toContain(missing_path);
                    expect(missing_file_diag!.message).toContain(missing_path + '.do');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 6.6: Diagnostic includes raw_path in message
     *
     * The diagnostic message should include the raw_path (as written by the user)
     * for clarity, not just the resolved absolute paths.
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('diagnostic includes raw_path in message', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                forward_call_type_gen,
                async (subdir_name, missing_name, call_type) => {
                    // Create a parent file
                    const parent_content = `local parent_var = 1`;
                    const parent_path = write_file('parent.do', parent_content);

                    // Create a forward call with a relative path containing subdirectory
                    const raw_path = `${subdir_name}/${missing_name}`;
                    const resolved_path = path.join(temp_dir, subdir_name, missing_name);
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(resolved_path, raw_path, call_type, 0)
                    ];

                    // Resolve forward scope
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: undefined,
                            call_chain: [],
                        }
                    );

                    // Should have a diagnostic about the missing file
                    const missing_file_diag = result.diagnostics.find(d =>
                        d.message.includes('Cannot read file')
                    );
                    expect(missing_file_diag).toBeDefined();

                    // The diagnostic should include the raw_path
                    expect(missing_file_diag!.message).toContain(raw_path);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 6.7: Diagnostic severity is warning for missing files with tried paths
     *
     * All "Cannot read file" diagnostics (including those with tried paths)
     * should have warning severity.
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('diagnostic severity is warning for missing files with tried paths', async () => {
        await fc.assert(
            fc.asyncProperty(
                file_name_gen,
                forward_call_type_gen,
                async (missing_name, call_type) => {
                    // Create a parent file
                    const parent_content = `local parent_var = 1`;
                    const parent_path = write_file('parent.do', parent_content);

                    // Create a forward call to a non-existent file (without .do extension)
                    const missing_path = path.join(temp_dir, missing_name);
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(missing_path, missing_name, call_type, 0)
                    ];

                    // Resolve forward scope
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: undefined,
                            call_chain: [],
                        }
                    );

                    // Should have a diagnostic about the missing file
                    const missing_file_diag = result.diagnostics.find(d =>
                        d.message.includes('Cannot read file')
                    );
                    expect(missing_file_diag).toBeDefined();

                    // The diagnostic should have warning severity
                    expect(missing_file_diag!.severity).toBe('warning');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 6.8: Each missing file gets its own diagnostic with tried paths
     *
     * When a forward call cannot be resolved, it should get its own
     * diagnostic with the appropriate tried paths.
     *
     * **Validates: Requirements 3.2, 3.3**
     */
    test('each missing file gets its own diagnostic with tried paths', async () => {
        await fc.assert(
            fc.asyncProperty(
                file_name_gen,
                forward_call_type_gen,
                async (missing_name, call_type) => {
                    // Create a parent file
                    const parent_content = `local parent_var = 1`;
                    const parent_path = write_file('parent.do', parent_content);

                    // Create a forward call to a non-existent file (without .do extension)
                    const missing_path = path.join(temp_dir, missing_name);
                    const forward_calls: ForwardCall[] = [
                        create_forward_call(missing_path, missing_name, call_type, 0),
                    ];

                    // Resolve forward scope
                    const result = await forward_resolver.resolve(
                        URI.file(parent_path).toString(),
                        forward_calls,
                        'include',
                        {
                            visited: new Map(),
                            effective_call_type: 'include',
                            depth: 0,
                            diagnostics: [],
                            working_directory: undefined,
                            call_chain: [],
                        }
                    );

                    // Should have exactly 1 diagnostic for the missing file
                    expect(result.diagnostics.length).toBe(1);

                    // The diagnostic should be for the missing file
                    const missing_file_diag = result.diagnostics[0];
                    expect(missing_file_diag.message).toContain('Cannot read file');
                    expect(missing_file_diag.message).toContain(missing_name);

                    // The diagnostic should include "tried:" with the paths attempted
                    expect(missing_file_diag.message).toContain('tried:');

                    // Should include both the original path and the .do fallback
                    expect(missing_file_diag.message).toContain(missing_path);
                    expect(missing_file_diag.message).toContain(missing_path + '.do');
                }
            ),
            { numRuns: 100 }
        );
    });
});

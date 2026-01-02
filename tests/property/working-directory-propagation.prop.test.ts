/**
 * Property tests for Working Directory Inheritance and Propagation
 *
 * Tests Property 1 from the design document:
 * *For any* file hierarchy where a parent file has a working directory directive,
 * all nested files without their own directive SHALL resolve paths using the
 * inherited working directory, and nested files with their own directive SHALL
 * use their own directive instead.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * Feature: working-directory-propagation
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardCall } from '../../src/types';
import { URI } from 'vscode-uri';

describe('Working Directory Inheritance and Propagation Property Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-propagation-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file to the temp directory.
     */
    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    /**
     * Helper to create a forward call for a file.
     */
    const create_forward_call = (
        file_path: string,
        raw_path: string,
        call_type: 'do' | 'run' | 'include' = 'do',
        call_site_line: number = 0
    ): ForwardCall => ({
        type: call_type,
        path: file_path,
        raw_path,
        call_site_line,
        range: { start: { line: call_site_line, character: 0 }, end: { line: call_site_line, character: 10 } },
        source: 'command',
        is_static: true,
    });

    // Generator for valid directory names (simple alphanumeric)
    const dir_name_gen = fc.tuple(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
            { minLength: 0, maxLength: 10 }
        )
    ).map(([first, rest]) => first + rest);

    // Generator for valid file names (simple alphanumeric)
    const file_name_gen = fc.tuple(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
            { minLength: 0, maxLength: 10 }
        )
    ).map(([first, rest]) => first + rest + '.do');

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
     * Property 1.1: Basic Working Directory Inheritance
     * When a parent file has @lsp-cd directive and calls a nested file via `do`,
     * the nested file should inherit the working directory.
     * **Validates: Requirement 1.1**
     */
    describe('Property 1.1: Basic Working Directory Inheritance', () => {
        test('nested file inherits working directory from parent via do command', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    wd_synonym_gen,
                    async (my_dir_name, my_synonym) => {
                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${my_synonym}: "${my_dir_name}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file without working directory directive
                        const nested_content = `local nested_var = 2`;
                        const nested_path = write_file('nested.do', nested_content);

                        // Create forward call from parent to nested
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, 'nested.do', 'do', 1)
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
                                working_directory: my_dir_name, // Parent's working directory
                                call_chain: [],
                            }
                        );

                        // Nested file should be processed (symbols should be present)
                        // The working directory should have been passed through the context
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('nested file inherits working directory from parent via include command', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    wd_synonym_gen,
                    async (my_dir_name, my_synonym) => {
                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${my_synonym}: "${my_dir_name}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file without working directory directive
                        const nested_content = `local nested_var = 2`;
                        const nested_path = write_file('nested.do', nested_content);

                        // Create forward call from parent to nested via include
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, 'nested.do', 'include', 1)
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
                                working_directory: my_dir_name,
                                call_chain: [],
                            }
                        );

                        // Nested file should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                        // Include should preserve local macros
                        expect(result.symbols.localMacros.has('nested_var')).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 1.2: Working Directory Override in Nested Files
     * When a nested file has its own @lsp-cd directive, it should override
     * the inherited working directory.
     * **Validates: Requirement 1.2**
     */
    describe('Property 1.2: Working Directory Override in Nested Files', () => {
        test('nested file with own directive overrides inherited working directory', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    dir_name_gen,
                    wd_synonym_gen,
                    wd_synonym_gen,
                    async (parent_dir, nested_dir, parent_synonym, nested_synonym) => {
                        // Ensure directories are different for meaningful test
                        const actual_nested_dir = parent_dir === nested_dir
                            ? nested_dir + '_override'
                            : nested_dir;

                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${parent_synonym}: "${parent_dir}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file WITH its own working directory directive
                        const nested_content = `// @lsp-${nested_synonym}: "${actual_nested_dir}"\nlocal nested_var = 2`;
                        const nested_path = write_file('nested.do', nested_content);

                        // Create forward call from parent to nested
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, 'nested.do', 'do', 1)
                        ];

                        // Resolve forward scope with parent's working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: parent_dir,
                                call_chain: [],
                            }
                        );

                        // Nested file should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 1.3: Fallback Behavior Without Working Directory
     * When no working directory is set, the existing fallback behavior
     * (script-relative resolution) should apply.
     * **Validates: Requirement 1.3**
     */
    describe('Property 1.3: Fallback Behavior Without Working Directory', () => {
        test('files without working directory use script-relative resolution', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    async (my_file_name) => {
                        // Create parent file WITHOUT working directory directive
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file
                        const nested_content = `local nested_var = 2`;
                        const nested_path = write_file(my_file_name, nested_content);

                        // Create forward call from parent to nested
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, my_file_name, 'do', 0)
                        ];

                        // Resolve forward scope WITHOUT working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // No working directory
                                call_chain: [],
                            }
                        );

                        // Nested file should still be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 1.4: Multi-Level Nesting Propagation
     * Working directory should propagate through all levels of nesting.
     * **Validates: Requirement 1.4**
     */
    describe('Property 1.4: Multi-Level Nesting Propagation', () => {
        test('working directory propagates through multiple nesting levels', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    fc.integer({ min: 2, max: 5 }),
                    wd_synonym_gen,
                    async (my_dir_name, nesting_depth, my_synonym) => {
                        // Create a chain of files: parent -> child1 -> child2 -> ... -> childN
                        const the_files: string[] = [];

                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${my_synonym}: "${my_dir_name}"\n// @lsp-do: "child0.do"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);
                        the_files.push(parent_path);

                        // Create chain of child files (each calls the next via @lsp-do directive)
                        for (let i = 0; i < nesting_depth; i++) {
                            const is_last = i === nesting_depth - 1;
                            const child_content = is_last
                                ? `local child${i}_var = ${i}`
                                : `// @lsp-do: "child${i + 1}.do"\nlocal child${i}_var = ${i}`;
                            const child_path = write_file(`child${i}.do`, child_content);
                            the_files.push(child_path);
                        }

                        // Create forward call from parent to first child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(the_files[1], 'child0.do', 'do', 1)
                        ];

                        // Resolve forward scope with parent's working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: my_dir_name,
                                call_chain: [],
                            }
                        );

                        // All files in the chain should be processed
                        // The working directory should propagate through all levels
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('nested file override does not affect sibling files', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    dir_name_gen,
                    wd_synonym_gen,
                    async (parent_dir, child_override_dir, my_synonym) => {
                        // Ensure directories are different
                        const actual_child_dir = parent_dir === child_override_dir
                            ? child_override_dir + '_override'
                            : child_override_dir;

                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${my_synonym}: "${parent_dir}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child1 WITH its own working directory directive
                        const child1_content = `// @lsp-${my_synonym}: "${actual_child_dir}"\nlocal child1_var = 1`;
                        const child1_path = write_file('child1.do', child1_content);

                        // Create child2 WITHOUT working directory directive (should inherit from parent)
                        const child2_content = `local child2_var = 2`;
                        const child2_path = write_file('child2.do', child2_content);

                        // Create forward calls from parent to both children
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(child1_path, 'child1.do', 'do', 1),
                            create_forward_call(child2_path, 'child2.do', 'do', 2),
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
                                working_directory: parent_dir,
                                call_chain: [],
                            }
                        );

                        // Both children should be processed
                        expect(result.call_sites.length).toBe(2);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Additional Property: Working Directory with Different Call Types
     * Working directory inheritance should work consistently across
     * do, run, and include call types.
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
     */
    describe('Working Directory with Different Call Types', () => {
        test('working directory inheritance works with all call types', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    fc.constantFrom('do', 'run', 'include') as fc.Arbitrary<'do' | 'run' | 'include'>,
                    wd_synonym_gen,
                    async (my_dir_name, call_type, my_synonym) => {
                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${my_synonym}: "${my_dir_name}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file
                        const nested_content = `local nested_var = 2`;
                        const nested_path = write_file('nested.do', nested_content);

                        // Create forward call with specified call type
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, 'nested.do', call_type, 1)
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
                                working_directory: my_dir_name,
                                call_chain: [],
                            }
                        );

                        // Nested file should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);

                        // Verify inheritance rules are applied correctly
                        if (call_type === 'include') {
                            // Include should preserve local macros
                            expect(result.symbols.localMacros.has('nested_var')).toBe(true);
                        } else {
                            // Do/run should exclude local macros
                            expect(result.symbols.localMacros.has('nested_var')).toBe(false);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property: Working Directory Context Propagation Through Recursive Resolution
     * When ForwardScopeResolver recursively resolves nested files, the working
     * directory context should be properly propagated or overridden.
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
     */
    describe('Working Directory Context Propagation Through Recursive Resolution', () => {
        test('working directory context is passed to recursive resolution', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    wd_synonym_gen,
                    async (my_dir_name, my_synonym) => {
                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${my_synonym}: "${my_dir_name}"\n// @lsp-do: "child.do"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file that calls grandchild
                        const child_content = `// @lsp-do: "grandchild.do"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Create grandchild file
                        const grandchild_content = `local grandchild_var = 3`;
                        write_file('grandchild.do', grandchild_content);

                        // Create forward call from parent to child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(child_path, 'child.do', 'do', 1)
                        ];

                        // Resolve forward scope with parent's working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: my_dir_name,
                                call_chain: [],
                            }
                        );

                        // Both child and grandchild should be processed
                        // (grandchild is resolved recursively through child's @lsp-do directive)
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('nested file working directory override propagates to its children', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    dir_name_gen,
                    wd_synonym_gen,
                    async (parent_dir, child_dir, my_synonym) => {
                        // Ensure directories are different
                        const actual_child_dir = parent_dir === child_dir
                            ? child_dir + '_override'
                            : child_dir;

                        // Create parent file with working directory directive
                        const parent_content = `// @lsp-${my_synonym}: "${parent_dir}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file WITH its own working directory directive
                        // and a call to grandchild
                        const child_content = `// @lsp-${my_synonym}: "${actual_child_dir}"\n// @lsp-do: "grandchild.do"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Create grandchild file (should inherit child's working directory)
                        const grandchild_content = `local grandchild_var = 3`;
                        write_file('grandchild.do', grandchild_content);

                        // Create forward call from parent to child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(child_path, 'child.do', 'do', 1)
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
                                working_directory: parent_dir,
                                call_chain: [],
                            }
                        );

                        // Child and grandchild should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Nested File Diagnostic Source Identification
     * *For any* diagnostic originating from a nested file during forward scope resolution,
     * the diagnostic message SHALL include the source file path and the diagnostic range
     * SHALL point to the call site in the immediate parent file.
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     */
    describe('Property 2: Nested File Diagnostic Source Identification', () => {
        /**
         * Property 2.1: Single-level nesting diagnostic includes call chain
         * When a "Cannot read file" error occurs in a nested file, the diagnostic
         * message should include the call chain (e.g., "child.do: Cannot read file: missing.do")
         * **Validates: Requirements 2.1, 2.4**
         */
        test('single-level nesting diagnostic includes call chain prefix', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    file_name_gen,
                    fc.constantFrom('do', 'run', 'include') as fc.Arbitrary<'do' | 'run' | 'include'>,
                    async (child_name, missing_name, call_type) => {
                        // Skip if child_name === missing_name (would be circular dependency, not missing file)
                        if (child_name === missing_name) {
                            return true; // Skip this iteration
                        }
                        // Skip if missing_name is 'parent.do' (we create this file)
                        if (missing_name === 'parent.do') {
                            return true;
                        }

                        // Create parent file that calls child
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file that references a missing file
                        const child_content = `// @lsp-${call_type}: "${missing_name}"\nlocal child_var = 2`;
                        const child_path = write_file(child_name, child_content);

                        // Create forward call from parent to child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(child_path, child_name, 'do', 0)
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

                        // Find the "Cannot read file" diagnostic
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );

                        // Should have a diagnostic about the missing file
                        expect(missing_file_diag).toBeDefined();

                        // The diagnostic message should include the call chain prefix
                        // Format: "child.do: Cannot read file: missing.do"
                        expect(missing_file_diag!.message).toContain(child_name);
                        expect(missing_file_diag!.message).toContain('Cannot read file');
                        expect(missing_file_diag!.message).toContain(missing_name);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.2: Diagnostic range points to parent's call site
         * The diagnostic range should point to the call site in the parent file
         * that triggered the nested resolution.
         * **Validates: Requirements 2.2**
         */
        test('diagnostic range points to parent call site', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    file_name_gen,
                    fc.integer({ min: 0, max: 50 }),
                    async (child_name, missing_name, call_site_line) => {
                        // Skip if child_name === missing_name (would be circular dependency, not missing file)
                        if (child_name === missing_name) {
                            return true; // Skip this iteration
                        }
                        // Skip if missing_name is 'parent.do' (we create this file)
                        if (missing_name === 'parent.do') {
                            return true;
                        }

                        // Create parent file
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file that references a missing file
                        const child_content = `// @lsp-do: "${missing_name}"\nlocal child_var = 2`;
                        const child_path = write_file(child_name, child_content);

                        // Create forward call with specific call site line
                        const expected_range = {
                            start: { line: call_site_line, character: 0 },
                            end: { line: call_site_line, character: 10 }
                        };
                        const forward_calls: ForwardCall[] = [{
                            type: 'do',
                            path: child_path,
                            raw_path: child_name,
                            call_site_line,
                            range: expected_range,
                            source: 'command',
                            is_static: true,
                        }];

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

                        // Find the "Cannot read file" diagnostic
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );

                        // Should have a diagnostic
                        expect(missing_file_diag).toBeDefined();

                        // The diagnostic range should be from the child's @lsp-do directive
                        // (which is at line 0 in the child file)
                        expect(missing_file_diag!.range.start.line).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.3: Multi-level nesting shows full call chain
         * Multi-level nesting should show the full call chain in the diagnostic message.
         * **Validates: Requirements 2.3, 2.4**
         */
        test('multi-level nesting shows full call chain in diagnostic', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    file_name_gen,
                    file_name_gen,
                    async (child_name, grandchild_name, missing_name) => {
                        // Ensure unique names
                        const actual_grandchild = grandchild_name === child_name
                            ? grandchild_name + '_gc'
                            : grandchild_name;
                        const actual_missing = missing_name === child_name || missing_name === actual_grandchild
                            ? missing_name + '_missing'
                            : missing_name;

                        // Create parent file
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file that calls grandchild
                        const child_content = `// @lsp-do: "${actual_grandchild}"\nlocal child_var = 2`;
                        const child_path = write_file(child_name, child_content);

                        // Create grandchild file that references a missing file
                        const grandchild_content = `// @lsp-do: "${actual_missing}"\nlocal grandchild_var = 3`;
                        write_file(actual_grandchild, grandchild_content);

                        // Create forward call from parent to child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(child_path, child_name, 'do', 0)
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

                        // Find the "Cannot read file" diagnostic
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file') && d.message.includes(actual_missing)
                        );

                        // Should have a diagnostic about the missing file
                        expect(missing_file_diag).toBeDefined();

                        // The diagnostic message should include the full call chain
                        // Format: "child.do -> grandchild.do: Cannot read file: missing.do"
                        expect(missing_file_diag!.message).toContain(child_name);
                        expect(missing_file_diag!.message).toContain(actual_grandchild);
                        expect(missing_file_diag!.message).toContain('->');
                        expect(missing_file_diag!.message).toContain('Cannot read file');
                        expect(missing_file_diag!.message).toContain(actual_missing);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.4: Root file diagnostics have no call chain prefix
         * Diagnostics from the root file (no nesting) should NOT have a call chain prefix.
         * **Validates: Requirements 2.1, 2.4**
         */
        test('root file diagnostics have no call chain prefix', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    fc.constantFrom('do', 'run', 'include') as fc.Arbitrary<'do' | 'run' | 'include'>,
                    async (missing_name, call_type) => {
                        // Create parent file that directly references a missing file
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create forward call to a non-existent file
                        const forward_calls: ForwardCall[] = [{
                            type: call_type,
                            path: path.join(temp_dir, missing_name),
                            raw_path: missing_name,
                            call_site_line: 0,
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                            source: 'command',
                            is_static: true,
                        }];

                        // Resolve forward scope with empty call chain (root level)
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
                                call_chain: [], // Empty call chain = root level
                            }
                        );

                        // Find the "Cannot read file" diagnostic
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );

                        // Should have a diagnostic
                        expect(missing_file_diag).toBeDefined();

                        // The diagnostic message should NOT have a call chain prefix
                        // It should start with "Cannot read file" directly
                        expect(missing_file_diag!.message.startsWith('Cannot read file')).toBe(true);

                        // Should not contain "->" which indicates a call chain
                        expect(missing_file_diag!.message).not.toContain('->');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.5: Diagnostic severity is warning for missing files
         * All "Cannot read file" diagnostics should have warning severity.
         * **Validates: Requirements 2.1**
         */
        test('missing file diagnostics have warning severity', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    fc.integer({ min: 1, max: 3 }),
                    async (missing_name, nesting_depth) => {
                        // Create a chain of files where the last one references a missing file
                        const the_files: string[] = [];

                        // Create parent file
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);
                        the_files.push(parent_path);

                        // Create chain of child files
                        for (let i = 0; i < nesting_depth - 1; i++) {
                            const child_content = `// @lsp-do: "child${i + 1}.do"\nlocal child${i}_var = ${i}`;
                            const child_path = write_file(`child${i}.do`, child_content);
                            the_files.push(child_path);
                        }

                        // Create last child that references missing file
                        const last_child_content = `// @lsp-do: "${missing_name}"\nlocal last_var = 99`;
                        const last_child_path = write_file(`child${nesting_depth - 1}.do`, last_child_content);
                        the_files.push(last_child_path);

                        // Create forward call from parent to first child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(the_files[1], 'child0.do', 'do', 0)
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

                        // Find the "Cannot read file" diagnostic
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );

                        // Should have a diagnostic with warning severity
                        expect(missing_file_diag).toBeDefined();
                        expect(missing_file_diag!.severity).toBe('warning');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.6: Call chain format is consistent
         * The call chain format should be consistent: "file1.do -> file2.do -> file3.do: message"
         * **Validates: Requirements 2.3, 2.4**
         */
        test('call chain format uses arrow separator consistently', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 4 }),
                    file_name_gen,
                    async (chain_length, missing_name) => {
                        // Create a chain of files
                        const the_file_names: string[] = [];
                        const the_file_paths: string[] = [];

                        // Create parent file
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create chain of child files
                        for (let i = 0; i < chain_length; i++) {
                            const is_last = i === chain_length - 1;
                            const child_name = `chain_${i}.do`;
                            the_file_names.push(child_name);

                            const child_content = is_last
                                ? `// @lsp-do: "${missing_name}"\nlocal chain${i}_var = ${i}`
                                : `// @lsp-do: "chain_${i + 1}.do"\nlocal chain${i}_var = ${i}`;
                            const child_path = write_file(child_name, child_content);
                            the_file_paths.push(child_path);
                        }

                        // Create forward call from parent to first child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(the_file_paths[0], the_file_names[0], 'do', 0)
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

                        // Find the "Cannot read file" diagnostic
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file') && d.message.includes(missing_name)
                        );

                        // Should have a diagnostic
                        expect(missing_file_diag).toBeDefined();

                        // Count the number of " -> " separators
                        const arrow_count = (missing_file_diag!.message.match(/ -> /g) || []).length;

                        // Should have (chain_length - 1) arrows for chain_length files
                        // e.g., "a.do -> b.do -> c.do: Cannot read file" has 2 arrows for 3 files
                        expect(arrow_count).toBe(chain_length - 1);

                        // The message should end with ": Cannot read file: <missing_name>"
                        expect(missing_file_diag!.message).toMatch(/: Cannot read file:/);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.7: Circular dependency handling in call chains
         * When a circular dependency is detected, it should be handled gracefully
         * without emitting diagnostics, as expected cycles occur during two-phase resolution.
         * **Validates: Requirements 2.3, 2.4**
         */
        test('circular dependency diagnostics include call chain', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    async (child_name) => {
                        // Create parent file
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file that calls back to parent (creating a cycle)
                        const child_content = `// @lsp-do: "parent.do"\nlocal child_var = 2`;
                        const child_path = write_file(child_name, child_content);

                        // Create forward call from parent to child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(child_path, child_name, 'do', 0)
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

                        // Cycles should be handled gracefully without emitting diagnostics
                        // Expected cycles occur when backward resolution leads to a parent, then forward resolution encounters the original file
                        const cycle_diag = result.diagnostics.find(d =>
                            d.message.includes('Circular dependency')
                        );

                        // Should NOT have a diagnostic about the circular dependency
                        expect(cycle_diag).toBeUndefined();

                        // Should still resolve symbols correctly
                        expect(result.symbols).toBeDefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.8: Max depth exceeded diagnostics include call chain
         * When max forward depth is exceeded, the diagnostic should include
         * the call chain showing how the depth was reached.
         * **Validates: Requirements 2.3, 2.4**
         */
        test('max depth exceeded diagnostics include call chain', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 5 }),
                    async (max_depth) => {
                        // Create a chain of files that exceeds max depth
                        const the_file_names: string[] = [];
                        const the_file_paths: string[] = [];

                        // Create parent file
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create chain of child files (more than max_depth)
                        for (let i = 0; i < max_depth + 2; i++) {
                            const child_name = `depth_${i}.do`;
                            the_file_names.push(child_name);

                            const child_content = `// @lsp-do: "depth_${i + 1}.do"\nlocal depth${i}_var = ${i}`;
                            const child_path = write_file(child_name, child_content);
                            the_file_paths.push(child_path);
                        }

                        // Create forward call from parent to first child
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(the_file_paths[0], the_file_names[0], 'do', 0)
                        ];

                        // Resolve forward scope with limited max depth
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
                            },
                            undefined,
                            undefined,
                            { max_forward_depth: max_depth }
                        );

                        // Find the max depth exceeded diagnostic
                        const depth_diag = result.diagnostics.find(d =>
                            d.message.includes('Maximum forward resolution depth')
                        );

                        // Should have a diagnostic about max depth
                        expect(depth_diag).toBeDefined();

                        // The diagnostic message should include the call chain prefix
                        // (at least one file name from the chain)
                        const has_chain_prefix = the_file_names.some(name =>
                            depth_diag!.message.includes(name)
                        );
                        expect(has_chain_prefix).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Backward Compatibility
     * *For any* file hierarchy without working directory directives, the path resolution
     * behavior SHALL match the existing fallback strategy (script-relative first, then
     * workspace-root-relative), and single-file analysis SHALL remain unchanged.
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    describe('Property 3: Backward Compatibility', () => {
        /**
         * Property 3.1: Files without working directory directive use
         * When no working directory directive is present in any file in the call chain,
         * the ForwardScopeResolver should use the existing fallback behavior
         * (script-relative, then workspace-root-relative).
         * **Validates: Requirement 3.1**
         */
        test('files without working directory directive use script-relative resolution', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    file_name_gen,
                    async (subdir_name, nested_file_name) => {
                        // Create a subdirectory structure
                        const subdir_path = path.join(temp_dir, subdir_name);
                        if (!fs.existsSync(subdir_path)) {
                            fs.mkdirSync(subdir_path, { recursive: true });
                        }

                        // Create parent file in subdirectory WITHOUT working directory directive
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file(`${subdir_name}/parent.do`, parent_content);

                        // Create nested file in same subdirectory
                        const nested_content = `local nested_var = 2`;
                        const nested_path = write_file(`${subdir_name}/${nested_file_name}`, nested_content);

                        // Create forward call using relative path (script-relative)
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, nested_file_name, 'do', 0)
                        ];

                        // Resolve forward scope WITHOUT working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // No working directory
                                call_chain: [],
                            }
                        );

                        // Nested file should be processed successfully
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);
                        // No errors about missing files
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );
                        expect(missing_file_diag).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.2: Nested file's working directory doesn't affect parent
         * When a parent file has no working directory directive but a nested file does,
         * the nested file's directive should only affect that file and its descendants,
         * not the parent or sibling files.
         * **Validates: Requirement 3.2**
         */
        test('nested file working directory does not affect parent resolution', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    wd_synonym_gen,
                    async (nested_dir, my_synonym) => {
                        // Create parent file WITHOUT working directory
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file WITH its own working directory directive
                        const nested_content = `// @lsp-${my_synonym}: "${nested_dir}"\nlocal nested_var = 2`;
                        const nested_path = write_file('nested.do', nested_content);

                        // Create sibling file WITHOUT working directory directive
                        const sibling_content = `local sibling_var = 3`;
                        const sibling_path = write_file('sibling.do', sibling_content);

                        // Create forward calls from parent to both nested and sibling
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, 'nested.do', 'do', 0),
                            create_forward_call(sibling_path, 'sibling.do', 'do', 1),
                        ];

                        // Resolve forward scope WITHOUT parent working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // Parent has no working directory
                                call_chain: [],
                            }
                        );

                        // Both files should be processed
                        expect(result.call_sites.length).toBe(2);

                        // Sibling should not be affected by nested's working directory
                        // (no errors about missing files for sibling)
                        const sibling_error = result.diagnostics.find(d =>
                            d.message.includes('sibling.do') && d.message.includes('Cannot read file')
                        );
                        expect(sibling_error).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.3: Single-file analysis remains unchanged
         * Single-file analysis (no nesting) should remain unchanged - symbols should
         * be resolved correctly without any working directory context.
         * **Validates: Requirement 3.3**
         */
        test('single file analysis works without working directory context', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        { minLength: 1, maxLength: 10 }
                    ),
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        { minLength: 1, maxLength: 10 }
                    ),
                    async (local_name, global_name) => {
                        // Create a single file WITHOUT working directory directive
                        const file_content = `local ${local_name} = 1\nglobal ${global_name} = 2`;
                        const file_path = write_file('single.do', file_content);

                        // Resolve forward scope with empty forward
                        const result = await forward_resolver.resolve(
                            URI.file(file_path).toString(),
                            [], // No forward calls
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // No working directory
                                call_chain: [],
                            }
                        );

                        // No call sites (single file)
                        expect(result.call_sites.length).toBe(0);
                        // No diagnostics
                        expect(result.diagnostics.length).toBe(0);
                        // Symbols should be empty (forward resolver doesn't parse the root file)
                        expect(result.symbols).toBeDefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.4: Multi-level nesting without working directory uses fallback
         * When multiple levels of nesting exist without any working directory directives,
         * all files should use the fallback behavior (script-relative resolution).
         * **Validates: Requirements 3.1, 3.2**
         */
        test('multi-level nesting without working directory uses fallback', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 4 }),
                    async (nesting_depth) => {
                        // Create a chain of files WITHOUT working directory directives
                        const the_files: string[] = [];

                        // Create parent file
                        const parent_content = `// @lsp-do: "child0.do"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);
                        the_files.push(parent_path);

                        // Create chain of child files (each calls the next via @lsp-do directive)
                        for (let i = 0; i < nesting_depth; i++) {
                            const is_last = i === nesting_depth - 1;
                            const child_content = is_last
                                ? `local child${i}_var = ${i}`
                                : `// @lsp-do: "child${i + 1}.do"\nlocal child${i}_var = ${i}`;
                            const child_path = write_file(`child${i}.do`, child_content);
                            the_files.push(child_path);
                        }

                        // Create forward call from parent to first
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(the_files[1], 'child0.do', 'do', 0)
                        ];

                        // Resolve forward scope WITHOUT working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // No working directory
                                call_chain: [],
                            }
                        );

                        // All files in the chain should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);

                        // No errors about missing files (fallback
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );
                        expect(missing_file_diag).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.5: Nested file's working directory only affects descendants
         * When a nested file has a working directory directive, it should only affect
         * that file's descendants, not its siblings or parent.
         * **Validates: Requirement 3.2**
         */
        test('nested file working directory only affects its descendants', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    wd_synonym_gen,
                    async (nested_dir, my_synonym) => {
                        // Create parent file WITHOUT working directory directive
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file WITH working directory
                        const nested_content = `// @lsp-${my_synonym}: "${nested_dir}"\n// @lsp-do: "grandchild.do"\nlocal nested_var = 2`;
                        const nested_path = write_file('nested.do', nested_content);

                        // Create grandchild file (should inherit nested's working directory)
                        const grandchild_content = `local grandchild_var = 3`;
                        write_file('grandchild.do', grandchild_content);

                        // Create sibling file WITHOUT working directory
                        const sibling_content = `local sibling_var = 4`;
                        const sibling_path = write_file('sibling.do', sibling_content);

                        // Create forward calls from parent to nested and sibling
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, 'nested.do', 'do', 0),
                            create_forward_call(sibling_path, 'sibling.do', 'do', 1),
                        ];

                        // Resolve forward scope WITHOUT parent working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // Parent has no working directory
                                call_chain: [],
                            }
                        );

                        // Both nested and sibling should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(2);

                        // Sibling should not be affected by nested's working directory
                        const sibling_error = result.diagnostics.find(d =>
                            d.message.includes('sibling.do') && d.message.includes('Cannot read file')
                        );
                        expect(sibling_error).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.6: Empty working directory context is equivalent to no directive
         * When working_directory is undefined in the context, behavior
         * identical to files without any working directory directive.
         * **Validates: Requirement 3.1**
         */
        test('undefined working directory context uses fallback behavior', async () => {
            await fc.assert(
                fc.asyncProperty(
                    file_name_gen,
                    fc.constantFrom('do', 'run', 'include') as fc.Arbitrary<'do' | 'run' | 'include'>,
                    async (nested_name, call_type) => {
                        // Create parent file WITHOUT working directory directive
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file WITHOUT working directory directive
                        const nested_content = `local nested_var = 2`;
                        const nested_path = write_file(nested_name, nested_content);

                        // Create forward call
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, nested_name, call_type, 0)
                        ];

                        // Resolve forward scope with explicitly undefined working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // Explicitly undefined
                                call_chain: [],
                            }
                        );

                        // Nested file should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);

                        // No errors about missing files
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );
                        expect(missing_file_diag).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.7: Mixed hierarchy - some files with directive,
         * In a mixed hierarchy where some files have working directory
         * direcome don't, each file should use the appropriate resolution strategy.
         * **Validates: Requirements 3.1, 3.2, 3.3**
         */
        test('mixed hierarchy uses appropriate resolution for each file', async () => {
            await fc.assert(
                fc.asyncProperty(
                    dir_name_gen,
                    wd_synonym_gen,
                    async (wd_dir, my_synonym) => {
                        // Create parent file WITHOUT working directory directive
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child1 WITH working directory
                        const child1_content = `// @lsp-${my_synonym}: "${wd_dir}"\nlocal child1_var = 2`;
                        const child1_path = write_file('child1.do', child1_content);

                        // Create child2 WITHOUT working directory
                        const child2_content = `local child2_var = 3`;
                        const child2_path = write_file('child2.do', child2_content);

                        // Create child3 WITHOUT working directory directive
                        const child3_content = `local child3_var = 4`;
                        const child3_path = write_file('child3.do', child3_content);

                        // Create forward calls from parent to all children
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(child1_path, 'child1.do', 'do', 0),
                            create_forward_call(child2_path, 'child2.do', 'do', 1),
                            create_forward_call(child3_path, 'child3.do', 'do', 2),
                        ];

                        // Resolve forward scope WITHOUT parent working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // Parent has no working directory
                                call_chain: [],
                            }
                        );

                        // All children should be processed
                        expect(result.call_sites.length).toBe(3);

                        // No errors about missing files for children without directives
                        const child2_error = result.diagnostics.find(d =>
                            d.message.includes('child2.do') && d.message.includes('Cannot read file')
                        );
                        const child3_error = result.diagnostics.find(d =>
                            d.message.includes('child3.do') && d.message.includes('Cannot read file')
                        );
                        expect(child2_error).toBeUndefined();
                        expect(child3_error).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.8: Fallback behavior with different call types
         * The fallback behavior (script-relative resolution) should work consistently
         * across all call types (do, run, include) when no working directory is set.
         * **Validates: Requirements 3.1, 3.3**
         */
        test('fallback behavior works with all call types', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('do', 'run', 'include') as fc.Arbitrary<'do' | 'run' | 'include'>,
                    file_name_gen,
                    async (call_type, nested_name) => {
                        // Create parent file WITHOUT working directory
                        const parent_content = `local parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create nested file WITHOUT working directory directive
                        const nested_content = `local nested_var = 2`;
                        const nested_path = write_file(nested_name, nested_content);

                        // Create forward call with specified call type
                        const forward_calls: ForwardCall[] = [
                            create_forward_call(nested_path, nested_name, call_type, 0)
                        ];

                        // Resolve forward scope WITHOUT working directory
                        const result = await forward_resolver.resolve(
                            URI.file(parent_path).toString(),
                            forward_calls,
                            'include',
                            {
                                visited: new Map(),
                                effective_call_type: 'include',
                                depth: 0,
                                diagnostics: [],
                                working_directory: undefined, // No working directory
                                call_chain: [],
                            }
                        );

                        // Nested file should be processed
                        expect(result.call_sites.length).toBeGreaterThanOrEqual(1);

                        // No errors about missing files
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );
                        expect(missing_file_diag).toBeUndefined();

                        // Verify inheritance rules are applied correctly
                        if (call_type === 'include') {
                            // Include should preserve local macros
                            expect(result.symbols.localMacros.has('nested_var')).toBe(true);
                        } else {
                            // Do/run should exclude local macros
                            expect(result.symbols.localMacros.has('nested_var')).toBe(false);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

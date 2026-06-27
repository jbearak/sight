/**
 * Property tests for Working Directory Integration
 *
 * Tests Properties 7, 8 from the design document.
 * Feature: working-directory-directive
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';
import { DirectiveParser } from '../../src/directive-parser';
import { ForwardCall } from '../../src/types';

describe('Working Directory Integration Property Tests', () => {
    /**
     * Property 7: Missing File Diagnostic
     * *For any* do/run/include command referencing a file that cannot be found,
     * the ForwardScopeResolver should emit a warning diagnostic indicating the
     * file was not found.
     * **Validates: Requirements 2.5**
     */
    describe('Property 7: Missing File Diagnostic', () => {
        test('emits diagnostic for missing files', async () => {
            // Create a mock ScopeResolver that returns errors for file reads
            const mock_scope_resolver = {
                get_parsed_file: async () => ({ error: 'File not found' }),
            } as unknown as ScopeResolver;

            const forward_resolver = new ForwardScopeResolver(mock_scope_resolver);

            await fc.assert(
                fc.asyncProperty(
                    fc.tuple(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
                            { minLength: 0, maxLength: 10 }
                        )
                    ).map(([first, rest]) => first + rest + '.do'),
                    fc.constantFrom('do', 'run', 'include') as fc.Arbitrary<'do' | 'run' | 'include'>,
                    async (my_filename, my_type) => {
                        const forward_calls: ForwardCall[] = [{
                            type: my_type,
                            raw_path: my_filename,
                            call_site_line: 0,
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                            source: 'command',
                            is_static: true,
                            caller_uri: 'file:///test/script.do',
                        }];

                        const result = await forward_resolver.resolve(
                            'file:///test/script.do',
                            forward_calls
                        );

                        // Should have a diagnostic about the missing file
                        expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
                        const missing_file_diag = result.diagnostics.find(d =>
                            d.message.includes('Cannot read file')
                        );
                        expect(missing_file_diag).toBeDefined();
                        expect(missing_file_diag!.severity).toBe('warning');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 8: Directive Isolation
     * *For any* file containing both a working directory directive and other
     * directives (@lsp-do, @lsp-run, @lsp-include, @lsp-done-by, @lsp-included-by),
     * the other directives should resolve paths relative to the script's
     * containing directory, unaffected by the working directory directive.
     * **Validates: Requirements 2.6**
     */
    describe('Property 8: Directive Isolation', () => {
        const parser = new DirectiveParser();

        test('working directory does not affect @lsp-done-by path resolution', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
                            { minLength: 0, maxLength: 10 }
                        )
                    ).map(([first, rest]) => first + rest + '.do'),
                    fc.tuple(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
                            { minLength: 0, maxLength: 10 }
                        )
                    ).map(([first, rest]) => first + rest),
                    (parent_file, working_dir) => {
                        // File with both working directory and done-by directives
                        const content = `// @lsp-working-directory: "/different/${working_dir}"\n` +
                            `// @lsp-done-by: "${parent_file}"\n` +
                            'gen x = 1';
                        
                        const script_dir = '/project/scripts';
                        const uri = `file://${script_dir}/test.do`;
                        
                        const result = parser.parse(content, uri);

                        // Working directory should be parsed
                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.is_workspace_relative).toBe(true);

                        // done-by directive should resolve relative to script directory
                        expect(result.directives.length).toBe(1);
                        const done_by = result.directives[0];
                        expect(done_by.type).toBe('done-by');
                        // Path should be resolved relative to script_dir, not working_dir
                        expect(done_by.path.startsWith(script_dir)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('working directory does not affect @lsp-do directive path resolution', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
                            { minLength: 0, maxLength: 10 }
                        )
                    ).map(([first, rest]) => first + rest + '.do'),
                    fc.tuple(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
                            { minLength: 0, maxLength: 10 }
                        )
                    ).map(([first, rest]) => first + rest),
                    (callee_file, working_dir) => {
                        // File with both working directory and @lsp-do directives
                        const content = `// @lsp-working-directory: "/different/${working_dir}"\n` +
                            `// @lsp-do: "${callee_file}"\n` +
                            'gen x = 1';
                        
                        const script_dir = '/project/scripts';
                        const uri = `file://${script_dir}/test.do`;
                        
                        const result = parser.parse(content, uri);

                        // Working directory should be parsed
                        expect(result.working_directory).toBeDefined();

                        // @lsp-do directive should resolve relative to script directory
                        expect(result.forward_calls).toBeDefined();
                        expect(result.forward_calls!.length).toBe(1);
                        const forward_call = result.forward_calls![0];
                        expect(forward_call.type).toBe('do');
                        // The directive parser records raw_path verbatim and
                        // does NOT fold in the working directory; resolution
                        // (script-relative for @lsp-do) is the consumer's job.
                        expect(forward_call.raw_path).toBe(callee_file);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('working directory does not affect @lsp-included-by path resolution', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
                            { minLength: 0, maxLength: 10 }
                        )
                    ).map(([first, rest]) => first + rest + '.do'),
                    fc.tuple(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                        fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
                            { minLength: 0, maxLength: 10 }
                        )
                    ).map(([first, rest]) => first + rest),
                    (parent_file, working_dir) => {
                        // File with both working directory and included-by directives
                        const content = `// @lsp-working-directory: "/different/${working_dir}"\n` +
                            `// @lsp-included-by: "${parent_file}"\n` +
                            'gen x = 1';
                        
                        const script_dir = '/project/scripts';
                        const uri = `file://${script_dir}/test.do`;
                        
                        const result = parser.parse(content, uri);

                        // Working directory should be parsed
                        expect(result.working_directory).toBeDefined();

                        // included-by directive should resolve relative to script directory
                        expect(result.directives.length).toBe(1);
                        const included_by = result.directives[0];
                        expect(included_by.type).toBe('included-by');
                        // Path should be resolved relative to script_dir, not working_dir
                        expect(included_by.path.startsWith(script_dir)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

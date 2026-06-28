/**
 * Property-Based Tests for Directive Call Site Diagnostics
 *
 * Feature: directive-call-site-diagnostics
 * Tests the diagnostic messaging for cross-file directives when the LSP cannot
 * identify the call site or detects type mismatches.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { DirectiveParser } from '../../src/directive-parser';

describe('Directive Call Site Diagnostics Property Tests', () => {
    let temp_dir: string;
    let resolver: ScopeResolver;
    let directive_parser: DirectiveParser;

    // Helper to create temp files
    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'directive-call-site-'));
        resolver = new ScopeResolver();
        directive_parser = new DirectiveParser();
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    describe('Property 3: Out-of-Bounds line= Emits Warning', () => {
        /**
         * Property 3: Out-of-Bounds line= Emits Warning
         * For any parent file with N lines, when the directive specifies line=M where M > N,
         * the Scope_Resolver SHALL emit a warning-level diagnostic indicating the line is out of bounds.
         * Validates: Requirements 1.3
         */
        test('emits warning when line= exceeds file length', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10 }),  // Number of lines in parent
                    fc.integer({ min: 1, max: 100 }), // Line offset beyond file length
                    async (num_lines, offset) => {
                        // Create parent file with num_lines lines
                        const parent_content = Array(num_lines).fill('local x = 1').join('\n');
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child with line= parameter that exceeds parent length
                        const out_of_bounds_line = num_lines + offset;
                        const child_content = `// @lsp-done-by: "parent.do" line=${out_of_bounds_line}\nlocal y = 2`;
                        const child_path = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_path).toString(),
                            child_content
                        );

                        // Should have a warning about out of bounds
                        const out_of_bounds_diag = result.diagnostics.find(
                            d => d.message.includes('out of bounds') && d.severity === 'warning'
                        );
                        expect(out_of_bounds_diag).toBeDefined();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 4: Invalid Call Statement at line= Emits Warning', () => {
        /**
         * Property 4: Invalid Call Statement at line= Emits Warning
         * For any parent file where line L exists but does not contain a do/run/include command
         * or @lsp-do/run/include directive, when the directive specifies line=L,
         * the Scope_Resolver SHALL emit a warning-level diagnostic.
         * Validates: Requirements 1.4
         */
        test('emits warning when line= points to non-call statement', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 5 }),  // Line number to point to
                    async (target_line) => {
                        // Create parent file with no call statements
                        const parent_lines = [
                            'local x = 1',
                            'display "hello"',
                            'gen y = 2',
                            'summarize x',
                            'regress y x',
                        ];
                        const parent_content = parent_lines.join('\n');
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child with line= parameter pointing to non-call line
                        const child_content = `// @lsp-done-by: "parent.do" line=${target_line}\nlocal y = 2`;
                        const child_path = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_path).toString(),
                            child_content
                        );

                        // Should have a warning about no call statement
                        const no_call_diag = result.diagnostics.find(
                            d => d.message.includes('does not contain') && d.severity === 'warning'
                        );
                        expect(no_call_diag).toBeDefined();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });


    describe('Property 1: Call Site Not Identified Emits Information Diagnostic', () => {
        /**
         * Property 1: Call Site Not Identified Emits Information Diagnostic
         * For any parent file content that does not contain do/run/include statements
         * referencing the child file, AND the directive has no explicit line= or match= parameter,
         * AND reverse deps have no call edges, the Scope_Resolver SHALL emit an information-level
         * diagnostic that mentions the parent filename and suggests using line= or match=.
         * Validates: Requirements 1.1, 1.7
         */
        test('emits information when call site cannot be identified', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 5 }),  // Number of lines in parent
                    async (num_lines) => {
                        // Create parent file with no call statements to child
                        const parent_lines = Array(num_lines).fill('local x = 1');
                        const parent_content = parent_lines.join('\n');
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child with directive but no explicit call site
                        const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
                        const child_path = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_path).toString(),
                            child_content
                        );

                        // Should have an information diagnostic about call site not identified
                        const not_identified_diag = result.diagnostics.find(
                            d => d.message.includes('Could not identify call site') &&
                                 d.message.includes('parent.do') &&
                                 d.message.includes('line=') &&
                                 d.message.includes('match=')
                        );
                        expect(not_identified_diag).toBeDefined();
                        expect(not_identified_diag?.severity).toBe('information');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 2: Valid line= Parameter Suppresses Diagnostic', () => {
        /**
         * Property 2: Valid line= Parameter Suppresses Diagnostic
         * For any parent file with N lines containing a valid call statement at line L (where 1 ≤ L ≤ N),
         * when the directive specifies line=L, the Scope_Resolver SHALL NOT emit a
         * "cannot identify call site" diagnostic.
         * Validates: Requirements 1.2
         */
        test('does not emit call site diagnostic when valid line= is provided', async () => {
            // Create parent file with a call statement
            const parent_content = `local x = 1\ndo "child.do"\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with line= pointing to the call statement (line 2, 1-indexed)
            const child_content = `// @lsp-done-by: "parent.do" line=2\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should NOT have a "cannot identify call site" diagnostic
            const not_identified_diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(not_identified_diag).toBeUndefined();
        });
    });

    describe('Property 5: Valid match= Parameter Suppresses Diagnostic', () => {
        /**
         * Property 5: Valid match= Parameter Suppresses Diagnostic
         * For any parent file containing string S, when the directive specifies match=S,
         * the Scope_Resolver SHALL NOT emit a "cannot identify call site" diagnostic.
         * Validates: Requirements 1.5
         */
        test('does not emit call site diagnostic when valid match= is provided', async () => {
            // Create parent file with a unique string
            const parent_content = `local x = 1\n// CALL_SITE_MARKER\ndo "child.do"\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with match= pointing to the marker
            const child_content = `// @lsp-done-by: "parent.do" match="CALL_SITE_MARKER"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should NOT have a "cannot identify call site" diagnostic
            const not_identified_diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(not_identified_diag).toBeUndefined();
        });
    });

    describe('Property 6: Not-Found match= Emits Warning', () => {
        /**
         * Property 6: Not-Found match= Emits Warning
         * For any parent file not containing string S, when the directive specifies match=S,
         * the Scope_Resolver SHALL emit a warning-level diagnostic indicating the match string was not found.
         * Validates: Requirements 1.6
         */
        test('emits warning when match= string is not found', async () => {
            await fc.assert(
                fc.asyncProperty(
                    // `match=` supports `\"` escaped quotes, so a `\` directly
                    // before the closing quote is an escape, not a literal.
                    // Exclude trailing backslashes (and `"`/newlines) so the
                    // generated value is an unambiguous, plain search string.
                    fc.string({ minLength: 5, maxLength: 20 }).filter(
                        s => !s.includes('\n') && !s.includes('"') && !s.endsWith('\\')
                    ),
                    async (match_string) => {
                        // Create parent file without the match string
                        const parent_content = `local x = 1\ndo "other.do"\nlocal z = 3`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child with match= that won't be found
                        const child_content = `// @lsp-done-by: "parent.do" match="${match_string}"\nlocal y = 2`;
                        const child_path = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_path).toString(),
                            child_content
                        );

                        // Should have a warning about match not found
                        const not_found_diag = result.diagnostics.find(
                            d => d.message.includes('not found') && d.severity === 'warning'
                        );
                        expect(not_found_diag).toBeDefined();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });


    describe('Property 7: included-by with do/run Mismatch Emits Warning', () => {
        /**
         * Property 7: included-by with do/run Mismatch Emits Warning
         * For any child file with @lsp-included-by directive where the detected call type
         * in the parent is do or run, the Scope_Resolver SHALL emit a warning-level diagnostic
         * explaining that local macros will not be inherited.
         * Validates: Requirements 2.1, 2.2, 2.3
         */
        test('emits warning when included-by but parent uses do', async () => {
            // Create parent file with do command
            const parent_content = `local x = 1\ndo "child.do"\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with included-by directive
            const child_content = `// @lsp-included-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should have a warning about local macros not being inherited
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Local macros will not be inherited') && d.severity === 'warning'
            );
            expect(mismatch_diag).toBeDefined();
        });

        test('emits warning when included-by but parent uses run', async () => {
            // Create parent file with run command
            const parent_content = `local x = 1\nrun "child.do"\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with included-by directive
            const child_content = `// @lsp-included-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should have a warning about local macros not being inherited
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Local macros will not be inherited') && d.severity === 'warning'
            );
            expect(mismatch_diag).toBeDefined();
        });
    });

    describe('run command detection', () => {
        /**
         * Tests for proper detection of the "run" command in parent files.
         * Verifies that @lsp-run-by and @lsp-done-by work correctly when parent uses "run".
         */
        test('run-by directive with parent using run command - no mismatch warning', async () => {
            // Create parent file with run command
            const parent_content = `local x = 1\nrun "child.do"\nlocal z = 3`;
            write_file('parent.do', parent_content);

            // Create child with run-by directive (synonym for done-by)
            const child_content = `// @lsp-run-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should NOT have a mismatch warning - run-by with run is correct
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Local macros will not be inherited') ||
                     d.message.includes('Full inheritance')
            );
            expect(mismatch_diag).toBeUndefined();

            // Should NOT have "Could not identify call site" - run should be detected
            const not_identified_diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(not_identified_diag).toBeUndefined();
        });

        test('done-by directive with parent using run command - no mismatch warning', async () => {
            // Create parent file with run command
            const parent_content = `local x = 1\nrun "child.do"\nlocal z = 3`;
            write_file('parent.do', parent_content);

            // Create child with done-by directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should NOT have a mismatch warning - done-by with run is correct (both are non-include)
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Local macros will not be inherited') ||
                     d.message.includes('Full inheritance')
            );
            expect(mismatch_diag).toBeUndefined();

            // Should NOT have "Could not identify call site" - run should be detected
            const not_identified_diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(not_identified_diag).toBeUndefined();
        });

        test('run command is detected and call site is identified', async () => {
            // Create parent file with run command on line 2 (0-indexed: line 1)
            const parent_content = `local x = 1\nrun "child.do"\nlocal z = 3`;
            write_file('parent.do', parent_content);

            // Create child with done-by directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Verify the chain includes the parent
            expect(result.chain.length).toBeGreaterThan(1);

            // The parent should be in the chain
            const parent_entry = result.chain.find(e => e.uri.includes('parent.do'));
            expect(parent_entry).toBeDefined();
        });
    });

    describe('Property 8: done-by/run-by with include Mismatch Emits Information', () => {
        /**
         * Property 8: done-by/run-by with include Mismatch Emits Information
         * For any child file with @lsp-done-by or @lsp-run-by directive where the detected
         * call type in the parent is include, the Scope_Resolver SHALL emit an information-level
         * diagnostic explaining that full inheritance (including local macros) will occur.
         * Validates: Requirements 3.1, 3.2, 3.3
         */
        test('emits information when done-by but parent uses include', async () => {
            // Create parent file with include command
            const parent_content = `local x = 1\ninclude "child.do"\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with done-by directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should have an information diagnostic about full inheritance
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Full inheritance') &&
                     d.message.includes('local macros')
            );
            expect(mismatch_diag).toBeDefined();
            expect(mismatch_diag?.severity).toBe('information');
        });
    });

    describe('Property 9: Mixed Call Types Emits Warning', () => {
        /**
         * Property 9: Mixed Call Types Emits Warning
         * For any parent file containing both do/run AND include statements referencing
         * the same child file, the Scope_Resolver SHALL emit a warning-level diagnostic
         * explaining the ambiguity and suggesting line= or match= parameters.
         * Validates: Requirements 4.1, 4.2, 4.3
         */
        test('emits warning when parent has both do and include for same child', async () => {
            // Create parent file with both do and include
            const parent_content = `local x = 1\ndo "child.do"\ninclude "child.do"\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should have a warning about mixed call types
            const mixed_diag = result.diagnostics.find(
                d => d.message.includes('multiple call types') && d.severity === 'warning'
            );
            expect(mixed_diag).toBeDefined();
        });
    });

    describe('Property 10: Diagnostic Range Matches Directive Location', () => {
        /**
         * Property 10: Diagnostic Range Matches Directive Location
         * For any call-site-related diagnostic emitted by the Scope_Resolver,
         * the diagnostic range SHALL match the range of the directive in the child file.
         * Validates: Requirements 5.1
         */
        test('diagnostic range matches directive location', async () => {
            // Create parent file with no call to child
            const parent_content = `local x = 1\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with directive on line 0
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Find the call site identification diagnostic
            const diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(diag).toBeDefined();
            // Range should be on line 0 (where the directive is)
            expect(diag?.range.start.line).toBe(0);
        });
    });

    describe('Property 11: Diagnostic Includes Source Attribution', () => {
        /**
         * Property 11: Diagnostic Includes Source Attribution
         * For any call-site-related diagnostic emitted by the Scope_Resolver,
         * the diagnostic SHALL include source attribution indicating the parent file involved.
         * Validates: Requirements 5.2
         */
        test('diagnostic includes source attribution', async () => {
            // Create parent file with no call to child
            const parent_content = `local x = 1\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Find the call site identification diagnostic
            const diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(diag).toBeDefined();
            // Should have source attribution
            expect(diag?.source).toBeDefined();
            expect(diag?.source?.source_file).toBe('parent.do');
        });
    });

    describe('Property 12: Information Diagnostics Respect Configuration', () => {
        /**
         * Property 12: Information Diagnostics Respect Configuration
         * For any information-level diagnostic for call site identification,
         * when the cross-file diagnostic configuration is set to suppress information-level diagnostics,
         * the diagnostic SHALL NOT be emitted.
         * Validates: Requirements 6.1
         */
        test('information diagnostics are suppressed when configured off', async () => {
            // Create parent file with no call to child
            const parent_content = `local x = 1\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content,
                { diagnostics: { call_site_identification: 'off' } }
            );

            // Should NOT have the call site identification diagnostic
            const diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(diag).toBeUndefined();
        });
    });

    describe('Property 13: included-by Warning Is Not Suppressible', () => {
        /**
         * Property 13: included-by Warning Is Not Suppressible
         * For any warning-level diagnostic for included-by with do/run mismatch,
         * regardless of the cross-file diagnostic configuration, the warning SHALL be emitted.
         * Validates: Requirements 6.2
         */
        test('included-by warning is always emitted regardless of config', async () => {
            // Create parent file with do command
            const parent_content = `local x = 1\ndo "child.do"\nlocal z = 3`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with included-by directive
            const child_content = `// @lsp-included-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            // Even with call_site_identification off, the included-by warning should still appear
            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content,
                { diagnostics: { call_site_identification: 'off' } }
            );

            // Should still have the warning about local macros not being inherited
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Local macros will not be inherited') && d.severity === 'warning'
            );
            expect(mismatch_diag).toBeDefined();
        });
    });

    describe('find_all_call_sites_for_file', () => {
        /**
         * Tests for the DirectiveParser.find_all_call_sites_for_file() method
         */
        test('finds all call sites for a child file', () => {
            const parent_content = `
local x = 1
do "child.do"
include "child.do"
run "child.do"
local z = 3
`;
            const result = directive_parser.find_all_call_sites_for_file(parent_content, 'child.do');

            expect(result.length).toBe(3);
            expect(result.some(r => r.call_type === 'do')).toBe(true);
            expect(result.some(r => r.call_type === 'include')).toBe(true);
            expect(result.some(r => r.call_type === 'run')).toBe(true);
        });

        test('returns empty array when no call sites found', () => {
            const parent_content = `
local x = 1
do "other.do"
local z = 3
`;
            const result = directive_parser.find_all_call_sites_for_file(parent_content, 'child.do');

            expect(result.length).toBe(0);
        });

        test('handles case-insensitive filename matching', () => {
            const parent_content = `do "CHILD.DO"`;
            const result = directive_parser.find_all_call_sites_for_file(parent_content, 'child.do');

            expect(result.length).toBe(1);
        });

        test('finds @lsp-do directive as call site', () => {
            const parent_content = `
local x = 1
// @lsp-do: survey.do
_loop_execute_survey
local z = 3
`;
            const result = directive_parser.find_all_call_sites_for_file(parent_content, 'survey.do');

            expect(result.length).toBe(1);
            expect(result[0].call_type).toBe('do');
            expect(result[0].line).toBe(2); // 0-indexed
        });

        test('finds @lsp-run directive as call site', () => {
            const parent_content = `
local x = 1
// @lsp-run: "child.do"
local z = 3
`;
            const result = directive_parser.find_all_call_sites_for_file(parent_content, 'child.do');

            expect(result.length).toBe(1);
            expect(result[0].call_type).toBe('run');
        });

        test('finds @lsp-include directive as call site', () => {
            const parent_content = `
local x = 1
* @lsp-include: child.do
local z = 3
`;
            const result = directive_parser.find_all_call_sites_for_file(parent_content, 'child.do');

            expect(result.length).toBe(1);
            expect(result[0].call_type).toBe('include');
        });

        test('finds both commands and directives as call sites', () => {
            const parent_content = `
local x = 1
do "child.do"
// @lsp-include: child.do
local z = 3
`;
            const result = directive_parser.find_all_call_sites_for_file(parent_content, 'child.do');

            expect(result.length).toBe(2);
            expect(result.some(r => r.call_type === 'do')).toBe(true);
            expect(result.some(r => r.call_type === 'include')).toBe(true);
        });
    });

    describe('@lsp-do directive call site identification', () => {
        /**
         * Tests for proper detection of @lsp-do directives as call sites
         * in the scope resolution chain.
         */
        test('identifies call site when parent uses @lsp-do directive', async () => {
            // Create parent file with @lsp-do directive (not actual do command)
            const parent_content = `local x = 1\n// @lsp-do: child.do\n_execute_child\nlocal z = 3`;
            write_file('parent.do', parent_content);

            // Create child with done-by directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should NOT have "Could not identify call site" - @lsp-do should be detected
            const not_identified_diag = result.diagnostics.find(
                d => d.message.includes('Could not identify call site')
            );
            expect(not_identified_diag).toBeUndefined();

            // The parent should be in the chain
            const parent_entry = result.chain.find(e => e.uri.includes('parent.do'));
            expect(parent_entry).toBeDefined();
        });
    });

    describe('Property 14: Do-First/Include-Later Uses Earliest Edge Call Type', () => {
        /**
         * Property 14: Do-First/Include-Later Uses Earliest Edge Call Type
         * When a parent file has both do and include statements referencing the same child,
         * the effective call type SHALL be determined by the earliest call site (by line number),
         * not by whether ANY edge is include.
         * Validates: Requirement 4 ("the first one found will be used")
         */
        test('do-first/include-later: effective call type is do, not include', async () => {
            // Create parent file with do FIRST (line 1), then include LATER (line 2)
            const parent_content = `local x = 1\ndo "child.do"\ninclude "child.do"\nlocal z = 3`;
            write_file('parent.do', parent_content);

            // Create child with done-by directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal parent_local = 1`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should have mixed call types warning
            const mixed_diag = result.diagnostics.find(
                d => d.message.includes('multiple call types')
            );
            expect(mixed_diag).toBeDefined();

            // Should NOT have done-by/include mismatch info (because effective type is do, not include)
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Full inheritance') && d.message.includes('local macros')
            );
            expect(mismatch_diag).toBeUndefined();
        });

        test('include-first/do-later: effective call type is include, not do', async () => {
            // Create parent file with include FIRST (line 1), then do LATER (line 2)
            const parent_content = `local x = 1\ninclude "child.do"\ndo "child.do"\nlocal z = 3`;
            write_file('parent.do', parent_content);

            // Create child with done-by directive
            const child_content = `// @lsp-done-by: "parent.do"\nlocal parent_local = 1`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should have mixed call types warning
            const mixed_diag = result.diagnostics.find(
                d => d.message.includes('multiple call types')
            );
            expect(mixed_diag).toBeDefined();

            // SHOULD have done-by/include mismatch info (because effective type is include)
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Full inheritance') && d.message.includes('local macros')
            );
            expect(mismatch_diag).toBeDefined();
            expect(mismatch_diag?.severity).toBe('information');
        });

        test('do-first/include-later with included-by: warns about mismatch', async () => {
            // Create parent file with do FIRST (line 1), then include LATER (line 2)
            const parent_content = `local x = 1\ndo "child.do"\ninclude "child.do"\nlocal z = 3`;
            write_file('parent.do', parent_content);

            // Create child with included-by directive (expects include semantics)
            const child_content = `// @lsp-included-by: "parent.do"\nlocal parent_local = 1`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Should have included-by/do mismatch warning (because effective type is do)
            const mismatch_diag = result.diagnostics.find(
                d => d.message.includes('Local macros will not be inherited')
            );
            expect(mismatch_diag).toBeDefined();
            expect(mismatch_diag?.severity).toBe('warning');
        });
    });

    describe('Duplicate diagnostic prevention', () => {
        /**
         * Tests that diagnostics are not duplicated when resolving chained directives.
         */
        test('should not emit duplicate diagnostics for chained directives', async () => {
            // Create loop.do with NO call to survey.do (to trigger the warning)
            const loop_content = `local x = 1\nlocal z = 3`;
            write_file('loop.do', loop_content);

            // Create survey.do with @lsp-done-by: loop.do
            const survey_content = `// @lsp-done-by: "loop.do"\nlocal y = 2\ninclude "wm_vars.do"`;
            write_file('survey.do', survey_content);

            // Create wm_vars.do with @lsp-included-by: survey.do
            const wm_vars_content = `// @lsp-included-by: "survey.do"\nlocal w = 3`;
            const wm_vars_path = write_file('wm_vars.do', wm_vars_content);

            const result = await resolver.resolve(
                URI.file(wm_vars_path).toString(),
                wm_vars_content
            );

            // Count how many "Could not identify call site" diagnostics there are
            const call_site_diags = result.diagnostics.filter(
                d => d.message.includes('Could not identify call site')
            );

            // Should only be ONE diagnostic about loop.do, not two
            if (call_site_diags.length !== 1 && process.env.SIGHT_TEST_LOG === '1') {
                console.log('All diagnostics:', JSON.stringify(result.diagnostics, null, 2));
            }
            expect(call_site_diags.length).toBe(1);
        });

        test('should not emit duplicate diagnostics when both files have unidentified call sites', async () => {
            // Create grandparent.do with NO call to parent.do
            const grandparent_content = `local x = 1\nlocal z = 3`;
            write_file('grandparent.do', grandparent_content);

            // Create parent.do with @lsp-done-by: grandparent.do and NO call to child.do
            const parent_content = `// @lsp-done-by: "grandparent.do"\nlocal y = 2`;
            write_file('parent.do', parent_content);

            // Create child.do with @lsp-included-by: parent.do
            const child_content = `// @lsp-included-by: "parent.do"\nlocal w = 3`;
            const child_path = write_file('child.do', child_content);

            const result = await resolver.resolve(
                URI.file(child_path).toString(),
                child_content
            );

            // Count how many "Could not identify call site" diagnostics there are
            const call_site_diags = result.diagnostics.filter(
                d => d.message.includes('Could not identify call site')
            );

            // Should be TWO diagnostics - one for parent.do not finding child.do,
            // and one for grandparent.do not finding parent.do
            // But each should only appear ONCE
            expect(call_site_diags.length).toBe(2);

            // Verify they're about different files
            const parent_diag = call_site_diags.find(d => d.message.includes('parent.do'));
            const grandparent_diag = call_site_diags.find(d => d.message.includes('grandparent.do'));
            expect(parent_diag).toBeDefined();
            expect(grandparent_diag).toBeDefined();
        });
    });
});

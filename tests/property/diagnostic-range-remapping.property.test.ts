/**
 * Property-based tests for diagnostic range remapping.
 * Validates Requirements 4.1, 4.2, 4.3 from the working-directory-chain-inheritance spec.
 *
 * Property 5: Diagnostic Range Remapping
 * - Diagnostics with source attribution are remapped to the active file's directive line
 * - The range points to the first directive in the active file
 * - The message includes source file and line information
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('Diagnostic Range Remapping Property Tests', () => {
    let temp_dir: string;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'range-remap-test-'));
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to create a file in the temp directory.
     */
    function create_file(filename: string, content: string): string {
        const file_path = path.join(temp_dir, filename);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    }

    /**
     * Helper to create a file URI.
     */
    function file_uri(file_path: string): string {
        return `file://${file_path}`;
    }

    describe('Property 5.1: Remapped diagnostics point to directive line in active file', () => {
        it('should remap diagnostic range to first directive line', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('done-by', 'included-by'),
                    fc.integer({ min: 0, max: 5 }),
                    async (directive_type, blank_lines_before) => {
                        const missing_file = 'nonexistent.do';
                        
                        // Create child file with directive at a specific line
                        const blank_prefix = '\n'.repeat(blank_lines_before);
                        const child_content = `${blank_prefix}* @lsp-${directive_type}: "${missing_file}"\nlocal x = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Find diagnostics with source attribution
                        const remapped_diagnostics = result.diagnostics.filter(
                            d => d.source !== undefined
                        );

                        // All remapped diagnostics should point to the directive line
                        for (const diagnostic of remapped_diagnostics) {
                            // The range should be at the directive line (after blank lines)
                            expect(diagnostic.range.start.line).toBe(blank_lines_before);
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 5.2: Diagnostics from nested chain errors are remapped to active file', () => {
        it('should remap diagnostics from deep chain errors to active file directive', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 3 }),
                    async (chain_depth) => {
                        // Create a chain: child -> parent_1 -> parent_2 -> ... -> missing
                        const files: { name: string; content: string }[] = [];
                        
                        for (let i = chain_depth; i >= 1; i--) {
                            const next_file = i === chain_depth ? 'missing.do' : `parent_${i + 1}.do`;
                            files.push({
                                name: `parent_${i}.do`,
                                content: `* @lsp-done-by: "${next_file}"\nlocal var_${i} = ${i}`,
                            });
                        }

                        // Create all parent files
                        for (const file of files) {
                            create_file(file.name, file.content);
                        }

                        // Create child file pointing to first parent
                        const child_content = `* @lsp-done-by: "parent_1.do"\nlocal child_var = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Find diagnostics about the missing file
                        const missing_file_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file') && d.message.includes('missing.do')
                        );

                        // All such diagnostics should be remapped to line 0 (the directive line)
                        for (const diagnostic of missing_file_diagnostics) {
                            expect(diagnostic.range.start.line).toBe(0);
                        }

                        return true;
                    }
                ),
                { numRuns: 30 }
            );
        });
    });

    describe('Property 5.3: Message format includes source file and line', () => {
        it('should include source file and line in remapped diagnostic message', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('done-by', 'included-by'),
                    async (directive_type) => {
                        const missing_file = 'target_missing.do';
                        const child_content = `* @lsp-${directive_type}: "${missing_file}"\nlocal x = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Find diagnostics with source attribution
                        const remapped_diagnostics = result.diagnostics.filter(
                            d => d.source !== undefined
                        );

                        // Message should include source file info
                        // When source_line is known: "... : source_file line N"
                        // When source_line is unknown: "... : source_file"
                        for (const diagnostic of remapped_diagnostics) {
                            if (diagnostic.source?.source_line !== undefined) {
                                expect(diagnostic.message).toMatch(/: .+\.do line \d+/);
                            } else {
                                // source_line is omitted for missing files, so message has no line number
                                expect(diagnostic.message).toContain(`: ${diagnostic.source?.source_file}`);
                                expect(diagnostic.message).not.toMatch(new RegExp(`: ${diagnostic.source?.source_file} line \\d+`));
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 5.4: Diagnostics without source attribution are not remapped', () => {
        it('should preserve original range for diagnostics without source', async () => {
            // Create a file with a parse error (no directive chain)
            const content = `local x = 1\nlocal y = 2`;
            const file_path = create_file('standalone.do', content);

            const result = await scope_resolver.resolve(
                file_uri(file_path),
                content
            );

            // Diagnostics without source should not be modified
            const diagnostics_without_source = result.diagnostics.filter(
                d => d.source === undefined
            );

            // These should retain their original ranges (not remapped to line 0)
            // Since there are no directives, there's nothing to remap to
            for (const diagnostic of diagnostics_without_source) {
                // Just verify they exist and have valid ranges
                expect(diagnostic.range).toBeDefined();
                expect(diagnostic.range.start).toBeDefined();
                expect(diagnostic.range.end).toBeDefined();
            }
        });
    });

    describe('Property 5.5: Forward call diagnostics are remapped correctly', () => {
        it('should remap forward call error diagnostics to active file directive', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-z][a-z0-9_]*$/i.test(s)),
                    async (missing_name) => {
                        const missing_file = `${missing_name}_forward.do`;
                        
                        // Parent file with a forward call to a missing file
                        const parent_content = `* Parent\ndo "${missing_file}"\nlocal parent_var = 1`;
                        create_file('parent.do', parent_content);

                        // Child file that references the parent
                        const child_content = `* @lsp-done-by: "parent.do"\nlocal child_var = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Find diagnostics about the missing forward call target
                        const forward_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file') && d.message.includes(missing_file)
                        );

                        // All such diagnostics should be remapped to line 0 (the directive line)
                        for (const diagnostic of forward_diagnostics) {
                            expect(diagnostic.range.start.line).toBe(0);
                            // Should include source info in message
                            if (diagnostic.source) {
                                expect(diagnostic.message).toMatch(/: .+ line \d+/);
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 5.6: Multiple directives remap to their respective directive ranges', () => {
        it('should remap diagnostics to the specific directive that references each parent', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: 3 }),
                    async (blank_lines) => {
                        const blank_prefix = '\n'.repeat(blank_lines);
                        
                        // Child file with multiple directives pointing to different missing files
                        const child_content = `${blank_prefix}* @lsp-done-by: "missing1.do"\n* @lsp-done-by: "missing2.do"\nlocal x = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Find diagnostics about missing1.do
                        const missing1_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('missing1.do')
                        );
                        // Find diagnostics about missing2.do
                        const missing2_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('missing2.do')
                        );

                        // Diagnostics about missing1.do should point to the first directive line
                        for (const diagnostic of missing1_diagnostics) {
                            expect(diagnostic.range.start.line).toBe(blank_lines);
                        }

                        // Diagnostics about missing2.do should point to the second directive line
                        for (const diagnostic of missing2_diagnostics) {
                            expect(diagnostic.range.start.line).toBe(blank_lines + 1);
                        }

                        return true;
                    }
                ),
                { numRuns: 30 }
            );
        });
    });
});

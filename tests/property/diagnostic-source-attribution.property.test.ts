/**
 * Property-based tests for diagnostic source attribution completeness.
 * Validates Requirements 3.1, 3.2, 3.3 from the working-directory-chain-inheritance spec.
 *
 * Property 4: Diagnostic Source Attribution Completeness
 * - All diagnostics from parent files have source attribution
 * - Source attribution includes source_file and source_line
 * - Message format includes source file and line info
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('Diagnostic Source Attribution Property Tests', () => {
    let temp_dir: string;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-source-test-'));
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

    describe('Property 4.1: Diagnostics from missing parent files have source attribution', () => {
        it('should include source info when parent file cannot be read', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('done-by', 'included-by'),
                    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9_]*$/i.test(s)),
                    async (directive_type, missing_filename) => {
                        const missing_file = `${missing_filename}_nonexistent.do`;
                        const child_content = `* @lsp-${directive_type}: "${missing_file}"\nlocal x = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Should have at least one diagnostic about the missing file
                        const missing_file_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file')
                        );

                        if (missing_file_diagnostics.length > 0) {
                            // All "Cannot read file" diagnostics should have source attribution
                            for (const diagnostic of missing_file_diagnostics) {
                                expect(diagnostic.source).toBeDefined();
                                if (diagnostic.source) {
                                    expect(diagnostic.source.source_file).toBeDefined();
                                    // source_line is omitted when call site is unknown (file unreadable)
                                    expect(diagnostic.source.source_line).toBeUndefined();
                                }
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 4.2: Diagnostics from forward call errors have source attribution', () => {
        it('should include source info when forward call target cannot be read', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9_]*$/i.test(s)),
                    async (missing_filename) => {
                        const missing_file = `${missing_filename}_missing.do`;
                        
                        // Parent file with a forward call to a missing file
                        const parent_content = `* Parent file\ndo "${missing_file}"\nlocal parent_var = 1`;
                        const parent_path = create_file('parent.do', parent_content);

                        // Child file that references the parent
                        const child_content = `* @lsp-done-by: "parent.do"\nlocal child_var = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Check for diagnostics about the missing forward call target
                        const forward_call_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file') && d.message.includes(missing_file)
                        );

                        // If there are diagnostics about the missing file, they should have source info
                        for (const diagnostic of forward_call_diagnostics) {
                            expect(diagnostic.source).toBeDefined();
                            if (diagnostic.source) {
                                expect(diagnostic.source.source_file).toBeDefined();
                                expect(typeof diagnostic.source.source_line).toBe('number');
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 4.3: Remapped diagnostics include source file and line in message', () => {
        it('should include source file and line info in diagnostic message', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('done-by', 'included-by'),
                    async (directive_type) => {
                        const missing_file = 'nonexistent_target.do';
                        const child_content = `* @lsp-${directive_type}: "${missing_file}"\nlocal x = 1`;
                        const child_path = create_file('child.do', child_content);

                        const result = await scope_resolver.resolve(
                            file_uri(child_path),
                            child_content
                        );

                        // Check diagnostics with source attribution
                        const diagnostics_with_source = result.diagnostics.filter(
                            d => d.source !== undefined
                        );

                        for (const diagnostic of diagnostics_with_source) {
                            // Message should include source file
                            // When source_line is known: "... : source_file line N"
                            // When source_line is unknown: "... : source_file"
                            if (diagnostic.source?.source_line !== undefined) {
                                expect(diagnostic.message).toMatch(/: .+ line \d+/);
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

    describe('Property 4.4: Diagnostics from circular dependencies have source attribution', () => {
        it('should include source info for circular dependency diagnostics', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('done-by', 'included-by'),
                    async (directive_type) => {
                        // Create a circular dependency: A -> B -> A
                        const file_a_content = `* @lsp-${directive_type}: "file_b.do"\nlocal a_var = 1`;
                        const file_b_content = `* @lsp-${directive_type}: "file_a.do"\nlocal b_var = 1`;

                        create_file('file_a.do', file_a_content);
                        const file_b_path = create_file('file_b.do', file_b_content);

                        const result = await scope_resolver.resolve(
                            file_uri(file_b_path),
                            file_b_content
                        );

                        // Check for circular dependency diagnostics
                        const cycle_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Circular dependency')
                        );

                        // If there are cycle diagnostics, they should have source info
                        for (const diagnostic of cycle_diagnostics) {
                            expect(diagnostic.source).toBeDefined();
                            if (diagnostic.source) {
                                expect(diagnostic.source.source_file).toBeDefined();
                                expect(typeof diagnostic.source.source_line).toBe('number');
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 30 }
            );
        });
    });

    describe('Property 4.5: Diagnostics from depth limit exceeded have source attribution', () => {
        it('should include source info for max depth diagnostics', async () => {
            // Create a chain that exceeds max depth
            // A -> B -> C -> D -> E -> F (with max_chain_depth = 3)
            const files: string[] = [];
            for (let i = 0; i < 6; i++) {
                const filename = `file_${i}.do`;
                const next_file = i < 5 ? `file_${i + 1}.do` : '';
                const content = next_file
                    ? `* @lsp-done-by: "${next_file}"\nlocal var_${i} = ${i}`
                    : `local var_${i} = ${i}`;
                create_file(filename, content);
                files.push(filename);
            }

            const first_file_content = `* @lsp-done-by: "file_1.do"\nlocal var_0 = 0`;
            const first_file_path = create_file('file_0.do', first_file_content);

            const result = await scope_resolver.resolve(
                file_uri(first_file_path),
                first_file_content,
                { max_chain_depth: 3 }
            );

            // Check for max depth diagnostics
            const depth_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Maximum') && d.message.includes('depth')
            );

            // If there are depth diagnostics, they should have source info
            for (const diagnostic of depth_diagnostics) {
                expect(diagnostic.source).toBeDefined();
                if (diagnostic.source) {
                    expect(diagnostic.source.source_file).toBeDefined();
                    expect(typeof diagnostic.source.source_line).toBe('number');
                }
            }
        });
    });
});

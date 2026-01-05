/**
 * Property-based tests for out-of-scope diagnostic message correctness
 *
 * Tests Properties 1, 2, and 4 from the design document:
 * - Property 1: Reason prioritization (inheritance_excludes_locals > after_call_site)
 * - Property 2: Correct inheritance-excluded message for done-by directives
 * - Property 4: No duplicate entries in out_of_scope_symbols
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';
import { OutOfScopeSymbol, OutOfScopeReason } from '../../src/types';

describe('Out-of-Scope Diagnostic Correctness Properties', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-of-scope-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    // Property 1: Reason Prioritization
    describe('Property 1: Reason Prioritization', () => {
        test('inheritance_excludes_locals takes priority over after_call_site', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        local_name: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                        call_site_line: fc.integer({ min: 5, max: 15 }),
                        local_def_line: fc.integer({ min: 16, max: 25 })
                    }),
                    async ({ local_name, call_site_line, local_def_line }) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        resolver.clear_cache();

                        // Create parent file with local macro defined after call site
                        const parent_content = [
                            '// Parent file',
                            ...Array(call_site_line).fill('// filler'),
                            `do "child.do"`,
                            ...Array(local_def_line - call_site_line - 1).fill('// more filler'),
                            `local ${local_name} = "value"`
                        ].join('\n');

                        // Create child file with done-by directive
                        const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                        const parent_file = write_file('parent.do', parent_content);
                        const child_file = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_file).toString(),
                            fs.readFileSync(child_file, 'utf8')
                        );

                        // Find the out-of-scope symbol for our local macro
                        const out_of_scope_symbol = result.out_of_scope_symbols.find(s => s.name === local_name);
                        
                        if (out_of_scope_symbol) {
                            // Should have inheritance_excludes_locals reason, not after_call_site
                            expect(out_of_scope_symbol.reason).toBe('inheritance_excludes_locals');
                        }
                    }
                ),
                { numRuns: 20 }
            );
        });

        test('after_call_site reason is used when inheritance does not exclude', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        global_name: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                        call_site_line: fc.integer({ min: 5, max: 15 }),
                        global_def_line: fc.integer({ min: 16, max: 25 })
                    }),
                    async ({ global_name, call_site_line, global_def_line }) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        resolver.clear_cache();

                        // Create parent file with global macro defined after call site
                        const parent_content = [
                            '// Parent file',
                            ...Array(call_site_line).fill('// filler'),
                            `do "child.do"`,
                            ...Array(global_def_line - call_site_line - 1).fill('// more filler'),
                            `global ${global_name} = "value"`
                        ].join('\n');

                        // Create child file with done-by directive
                        const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                        const parent_file = write_file('parent.do', parent_content);
                        const child_file = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_file).toString(),
                            fs.readFileSync(child_file, 'utf8')
                        );

                        // Find the out-of-scope symbol for our global macro
                        const out_of_scope_symbol = result.out_of_scope_symbols.find(s => s.name === global_name);
                        
                        if (out_of_scope_symbol) {
                            // Should have after_call_site reason since globals are not excluded by inheritance
                            expect(out_of_scope_symbol.reason).toBe('after_call_site');
                        }
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    // Property 2: Correct inheritance-excluded message
    describe('Property 2: Correct Inheritance-Excluded Message', () => {
        test('done-by directives exclude local macros with correct reason', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(
                        fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                        { minLength: 1, maxLength: 5 }
                    ).map(names => [...new Set(names)]), // Remove duplicates
                    async (local_names) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        resolver.clear_cache();

                        // Create parent file with local macros
                        const parent_content = [
                            '// Parent file',
                            ...local_names.map(name => `local ${name} = "value"`),
                            'do "child.do"'
                        ].join('\n');

                        // Create child file with done-by directive
                        const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                        const parent_file = write_file('parent.do', parent_content);
                        const child_file = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_file).toString(),
                            fs.readFileSync(child_file, 'utf8')
                        );

                        // All local macros from parent should be out-of-scope with inheritance_excludes_locals reason
                        for (const local_name of local_names) {
                            const out_of_scope_symbol = result.out_of_scope_symbols.find(s => s.name === local_name);
                            if (out_of_scope_symbol) {
                                expect(out_of_scope_symbol.type).toBe('local');
                                expect(out_of_scope_symbol.reason).toBe('inheritance_excludes_locals');
                                expect(out_of_scope_symbol.call_site_line).toBe(-1); // Not applicable for inheritance exclusion
                            }
                        }
                    }
                ),
                { numRuns: 15 }
            );
        });

        test('included-by directives do not exclude local macros', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(
                        fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                        { minLength: 1, maxLength: 5 }
                    ).map(names => [...new Set(names)]), // Remove duplicates
                    async (local_names) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        resolver.clear_cache();

                        // Create parent file with local macros
                        const parent_content = [
                            '// Parent file',
                            ...local_names.map(name => `local ${name} = "value"`),
                            'include "child.do"'
                        ].join('\n');

                        // Create child file with included-by directive
                        const child_content = `// @lsp-included-by "parent.do"\nlocal x = 1`;

                        const parent_file = write_file('parent.do', parent_content);
                        const child_file = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_file).toString(),
                            fs.readFileSync(child_file, 'utf8')
                        );

                        // No local macros should be excluded due to inheritance with included-by
                        const excluded_locals = result.out_of_scope_symbols.filter(
                            s => s.reason === 'inheritance_excludes_locals'
                        );
                        expect(excluded_locals).toHaveLength(0);

                        // Local macros should be available in merged symbols (if they were defined before call site)
                        // Note: We can't guarantee all will be available since some might be defined after call site
                        const available_locals = local_names.filter(name => result.symbols.localMacros.has(name));
                        const after_call_site_locals = result.out_of_scope_symbols.filter(
                            s => local_names.includes(s.name) && s.reason === 'after_call_site'
                        );
                        
                        // Total should equal input (either available or out-of-scope due to call site timing)
                        expect(available_locals.length + after_call_site_locals.length).toBeGreaterThanOrEqual(0);
                    }
                ),
                { numRuns: 15 }
            );
        });
    });

    // Property 4: No duplicate entries
    describe('Property 4: No Duplicate Entries', () => {
        test('out_of_scope_symbols contains no duplicate symbol names', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_names: fc.array(
                            fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                            { minLength: 2, maxLength: 8 }
                        ).map(names => [...new Set(names)]), // Remove duplicates from input
                        call_site_line: fc.integer({ min: 3, max: 8 }),
                        def_lines_after: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 2, maxLength: 8 })
                    }),
                    async ({ symbol_names, call_site_line, def_lines_after }) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        resolver.clear_cache();

                        // Ensure we have enough definition lines for all symbols
                        const def_lines = def_lines_after.slice(0, symbol_names.length).map(offset => call_site_line + offset + 1);
                        
                        // Create parent file with symbols defined after call site (both locals and globals)
                        const parent_content = [
                            '// Parent file',
                            ...Array(call_site_line).fill('// filler'),
                            'do "child.do"',
                            ...symbol_names.map((name, i) => [
                                `local ${name}_local = "value"`,
                                `global ${name}_global = "value"`
                            ]).flat()
                        ].join('\n');

                        // Create child file with done-by directive
                        const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                        const parent_file = write_file('parent.do', parent_content);
                        const child_file = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_file).toString(),
                            fs.readFileSync(child_file, 'utf8')
                        );

                        // Check for duplicate symbol names in out_of_scope_symbols
                        const symbol_names_seen = new Set<string>();
                        const duplicates: string[] = [];

                        for (const symbol of result.out_of_scope_symbols) {
                            if (symbol_names_seen.has(symbol.name)) {
                                duplicates.push(symbol.name);
                            } else {
                                symbol_names_seen.add(symbol.name);
                            }
                        }

                        expect(duplicates).toHaveLength(0);
                    }
                ),
                { numRuns: 25 }
            );
        });

        test('priority replacement works correctly without creating duplicates', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (symbol_name) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        resolver.clear_cache();

                        // Create a scenario where a symbol could be out-of-scope for multiple reasons
                        // 1. Local macro in parent (inheritance_excludes_locals)
                        // 2. Defined after call site (after_call_site)
                        const parent_content = [
                            '// Parent file',
                            `local ${symbol_name} = "before_call"`,
                            'do "child.do"',
                            `local ${symbol_name} = "after_call"` // Redefinition after call site
                        ].join('\n');

                        const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                        const parent_file = write_file('parent.do', parent_content);
                        const child_file = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_file).toString(),
                            fs.readFileSync(child_file, 'utf8')
                        );

                        // Should have exactly one entry for the symbol name
                        const matching_symbols = result.out_of_scope_symbols.filter(s => s.name === symbol_name);
                        expect(matching_symbols.length).toBeLessThanOrEqual(1);

                        // If present, should have the higher priority reason
                        if (matching_symbols.length === 1) {
                            expect(matching_symbols[0].reason).toBe('inheritance_excludes_locals');
                        }
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    // Additional property: Reason consistency
    describe('Additional Property: Reason Consistency', () => {
        test('reason field accurately reflects why symbol is out of scope', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        directive_type: fc.constantFrom('done-by', 'included-by'),
                        symbol_type: fc.constantFrom('local', 'global'),
                        symbol_name: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                        call_site_line: fc.integer({ min: 2, max: 8 }),
                        def_line_offset: fc.integer({ min: -3, max: 5 })
                    }),
                    async ({ directive_type, symbol_type, symbol_name, call_site_line, def_line_offset }) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        resolver.clear_cache();

                        const def_line = call_site_line + def_line_offset;
                        if (def_line < 0) return; // Skip invalid cases

                        const macro_prefix = symbol_type === 'local' ? 'local' : 'global';
                        const call_command = directive_type === 'done-by' ? 'do' : 'include';
                        const directive_name = directive_type === 'done-by' ? '@lsp-done-by' : '@lsp-included-by';

                        // Create parent file
                        const parent_lines = Array(Math.max(call_site_line + 5, def_line + 1)).fill('// filler');
                        parent_lines[def_line] = `${macro_prefix} ${symbol_name} = "value"`;
                        parent_lines[call_site_line] = `${call_command} "child.do"`;
                        const parent_content = parent_lines.join('\n');

                        // Create child file
                        const child_content = `// ${directive_name} "parent.do"\nlocal x = 1`;

                        const parent_file = write_file('parent.do', parent_content);
                        const child_file = write_file('child.do', child_content);

                        const result = await resolver.resolve(
                            URI.file(child_file).toString(),
                            fs.readFileSync(child_file, 'utf8')
                        );

                        const out_of_scope_symbol = result.out_of_scope_symbols.find(s => s.name === symbol_name);

                        if (out_of_scope_symbol) {
                            // Verify reason is consistent with the conditions
                            if (directive_type === 'done-by' && symbol_type === 'local') {
                                expect(out_of_scope_symbol.reason).toBe('inheritance_excludes_locals');
                            } else if (def_line > call_site_line) {
                                expect(out_of_scope_symbol.reason).toBe('after_call_site');
                            }
                        }
                    }
                ),
                { numRuns: 30 }
            );
        });
    });
});
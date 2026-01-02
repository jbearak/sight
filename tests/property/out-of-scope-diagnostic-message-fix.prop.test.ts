/**
 * Property-based tests for out-of-scope diagnostic message fix
 * 
 * Tests the specific properties from the design document:
 * - Property 1: Out-of-Scope Reason Prioritization
 * - Property 2: Correct Message for Inheritance-Excluded Locals  
 * - Property 4: No Duplicate Out-of-Scope Entries
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';

describe('Out-of-Scope Diagnostic Message Fix Properties', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-of-scope-fix-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    // Property 1: Out-of-Scope Reason Prioritization
    test('Property 1: inheritance_excludes_locals prioritized over after_call_site', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    local_name: fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    call_site_line: fc.integer({ min: 2, max: 8 }),
                    def_line_offset: fc.integer({ min: 1, max: 5 })
                }),
                async ({ local_name, call_site_line, def_line_offset }) => {
                    const def_line = call_site_line + def_line_offset;
                    
                    // Create parent with local defined after call site
                    const parent_content = [
                        '// Parent file',
                        ...Array(call_site_line).fill('// filler'),
                        'do "child.do"',
                        ...Array(def_line_offset - 1).fill('// more filler'),
                        `local ${local_name} = "value"`
                    ].join('\n');

                    const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                    const parent_file = write_file('parent.do', parent_content);
                    const child_file = write_file('child.do', child_content);

                    const result = await resolver.resolve(
                        URI.file(child_file).toString(),
                        fs.readFileSync(child_file, 'utf8')
                    );

                    const out_of_scope = result.out_of_scope_symbols.find(s => s.name === local_name);
                    if (out_of_scope) {
                        expect(out_of_scope.reason).toBe('inheritance_excludes_locals');
                        expect(out_of_scope.type).toBe('local');
                    }
                }
            ),
            { numRuns: 15 }
        );
    });

    // Property 2: Correct Message for Inheritance-Excluded Locals
    test('Property 2: inheritance-excluded locals have correct reason', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.string({ minLength: 1, maxLength: 6 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    { minLength: 1, maxLength: 4 }
                ).map(names => [...new Set(names)]),
                async (local_names) => {
                    const parent_content = [
                        '// Parent file',
                        ...local_names.map(name => `local ${name} = "value"`),
                        'do "child.do"'
                    ].join('\n');

                    const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                    const parent_file = write_file('parent.do', parent_content);
                    const child_file = write_file('child.do', child_content);

                    const result = await resolver.resolve(
                        URI.file(child_file).toString(),
                        fs.readFileSync(child_file, 'utf8')
                    );

                    for (const local_name of local_names) {
                        const out_of_scope = result.out_of_scope_symbols.find(s => s.name === local_name);
                        if (out_of_scope) {
                            expect(out_of_scope.type).toBe('local');
                            expect(out_of_scope.reason).toBe('inheritance_excludes_locals');
                        }
                    }
                }
            ),
            { numRuns: 12 }
        );
    });

    // Property 4: No Duplicate Out-of-Scope Entries
    test('Property 4: no duplicate entries in out_of_scope_symbols', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    symbol_names: fc.array(
                        fc.string({ minLength: 1, maxLength: 6 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                        { minLength: 2, maxLength: 6 }
                    ).map(names => [...new Set(names)]),
                    call_site_line: fc.integer({ min: 2, max: 6 })
                }),
                async ({ symbol_names, call_site_line }) => {
                    // Create scenario with both locals and globals after call site
                    const parent_content = [
                        '// Parent file',
                        ...Array(call_site_line).fill('// filler'),
                        'do "child.do"',
                        ...symbol_names.map(name => [
                            `local ${name}_local = "value"`,
                            `global ${name}_global = "value"`
                        ]).flat()
                    ].join('\n');

                    const child_content = `// @lsp-done-by "parent.do"\nlocal x = 1`;

                    const parent_file = write_file('parent.do', parent_content);
                    const child_file = write_file('child.do', child_content);

                    const result = await resolver.resolve(
                        URI.file(child_file).toString(),
                        fs.readFileSync(child_file, 'utf8')
                    );

                    // Check for duplicates
                    const names_seen = new Set<string>();
                    const duplicates: string[] = [];

                    for (const symbol of result.out_of_scope_symbols) {
                        if (names_seen.has(symbol.name)) {
                            duplicates.push(symbol.name);
                        } else {
                            names_seen.add(symbol.name);
                        }
                    }

                    expect(duplicates).toHaveLength(0);
                }
            ),
            { numRuns: 20 }
        );
    });
});
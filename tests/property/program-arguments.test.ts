/**
 * Property tests for program argument completions
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Position } from 'vscode-languageserver';
import { CompletionProvider, detect_completion_context, compute_ranking_key } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { DocumentState } from '../../src/document-store';
import { SymbolTable, ProgramNode, ArgumentSpec, ProgramSignature } from '../../src/types';
import { parse_and_analyze } from '../property/helpers/document-utils';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(content: string, symbols?: Partial<SymbolTable>): DocumentState {
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        ast: null,
        symbols: {
            programs: symbols?.programs || new Map(),
            localMacros: symbols?.localMacros || new Map(),
            globalMacros: symbols?.globalMacros || new Map(),
            variables: symbols?.variables || new Map(),
            scalars: symbols?.scalars || new Map(),
            matrices: symbols?.matrices || new Map(),
        },
        diagnostics: [],
    };
}

/**
 * Generator for valid Stata argument types
 */
const argument_type_gen = fc.constantFrom(
    'varlist', 'varname', 'newvarname', 'anything', 'if', 'in', 'using', 'exp', 'name'
);

/**
 * Generator for argument specifications
 */
const argument_spec_gen = fc.record({
    type: argument_type_gen,
    name: fc.option(fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))),
    isOptional: fc.boolean(),
    range: fc.record({
        start: fc.record({ line: fc.nat(100), character: fc.nat(80) }),
        end: fc.record({ line: fc.nat(100), character: fc.nat(80) })
    })
}).map(spec => ({
    ...spec,
    // Only 'anything' type can have a name
    name: spec.type === 'anything' ? spec.name : undefined
}));

/**
 * Generator for program signatures
 */
const program_signature_gen = fc.record({
    arguments: fc.array(argument_spec_gen, { minLength: 0, maxLength: 5 }),
    options: fc.array(fc.record({
        name: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
        minAbbreviation: fc.string({ minLength: 1, maxLength: 5 }),
        isRequired: fc.boolean(),
        isOptional: fc.boolean(),
        range: fc.record({
            start: fc.record({ line: fc.nat(100), character: fc.nat(80) }),
            end: fc.record({ line: fc.nat(100), character: fc.nat(80) })
        })
    }), { minLength: 0, maxLength: 3 }),
    allowsArbitraryOptions: fc.boolean(),
    syntaxRanges: fc.array(fc.record({
        start: fc.record({ line: fc.nat(100), character: fc.nat(80) }),
        end: fc.record({ line: fc.nat(100), character: fc.nat(80) })
    }), { minLength: 1, maxLength: 2 })
});

describe('Program Argument Completions', () => {
    describe('get_argument_local_name', () => {
        it('should map argument types to local names correctly', () => {
            fc.assert(fc.property(argument_spec_gen, (arg_spec) => {
                const provider = new CompletionProvider(new CommandDatabase());
                const local_name = (provider as any).get_argument_local_name(arg_spec);
                
                if (arg_spec.type === 'anything' && arg_spec.name) {
                    expect(local_name).toBe(arg_spec.name);
                } else {
                    expect(local_name).toBe(arg_spec.type);
                }
            }));
        });

        it('should return null for invalid argument specs', () => {
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Test with null/undefined
            expect((provider as any).get_argument_local_name(null)).toBe(null);
            expect((provider as any).get_argument_local_name(undefined)).toBe(null);
        });
    });

    describe('extract_program_arguments', () => {
        it('should extract all argument local names from signature', () => {
            fc.assert(fc.property(program_signature_gen, (signature) => {
                const provider = new CompletionProvider(new CommandDatabase());
                const extracted_args = (provider as any).extract_program_arguments(signature);
                
                // Should extract exactly the expected number of arguments
                const expected_count = signature.arguments.filter(arg => {
                    if (arg.type === 'anything' && arg.name) return true;
                    return arg.type !== null && arg.type !== undefined;
                }).length;
                
                expect(extracted_args.length).toBe(expected_count);
                
                // Each extracted argument should be a valid local name
                for (const arg_name of extracted_args) {
                    expect(typeof arg_name).toBe('string');
                    expect(arg_name.length).toBeGreaterThan(0);
                }
            }));
        });

        it('should handle empty signatures', () => {
            const provider = new CompletionProvider(new CommandDatabase());
            const empty_signature: ProgramSignature = {
                arguments: [],
                options: [],
                allowsArbitraryOptions: false,
                syntaxRanges: []
            };
            
            const extracted_args = (provider as any).extract_program_arguments(empty_signature);
            expect(extracted_args).toEqual([]);
        });
    });

    describe('detect_cursor_in_program_body', () => {
        it('should detect when cursor is inside program body', () => {
            const program_code = `
program define test_prog
    syntax varlist
    local result \`varlist'
    display "\`result'"
end
`;
            
            const document = create_test_document(program_code);
            const parsed = parse_and_analyze(program_code);
            document.ast = parsed.ast;
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position inside program body (line 3, after syntax)
            const inside_position: Position = { line: 3, character: 10 };
            const program_node = (provider as any).detect_cursor_in_program_body(document, inside_position);
            
            expect(program_node).not.toBeNull();
            expect(program_node?.name).toBe('test_prog');
        });

        it('should not detect program when cursor is outside', () => {
            const program_code = `
local outside_var "test"
program define test_prog
    syntax varlist
    local result \`varlist'
end
local another_outside "test"
`;
            
            const document = create_test_document(program_code);
            const parsed = parse_and_analyze(program_code);
            document.ast = parsed.ast;
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position before program
            const before_position: Position = { line: 1, character: 10 };
            const before_result = (provider as any).detect_cursor_in_program_body(document, before_position);
            expect(before_result).toBeNull();
            
            // Position after program
            const after_position: Position = { line: 6, character: 10 };
            const after_result = (provider as any).detect_cursor_in_program_body(document, after_position);
            expect(after_result).toBeNull();
        });

        it('should not detect program when cursor is on declaration line', () => {
            const program_code = `
program define test_prog
    syntax varlist
    local result \`varlist'
end
`;

            const document = create_test_document(program_code);
            const parsed = parse_and_analyze(program_code);
            document.ast = parsed.ast;

            const provider = new CompletionProvider(new CommandDatabase());

            // Position on program declaration line
            const declaration_position: Position = { line: 1, character: 15 };
            const result = (provider as any).detect_cursor_in_program_body(document, declaration_position);
            expect(result).toBeNull();
        });

        it('should not detect program on a ///-continued header line (#273)', () => {
            // Line 2 is still the header — it expands at definition
            // time in the enclosing frame, so body completions must
            // not be offered there.
            const program_code = `
program define test_prog, ///
    rclass
    syntax varlist
end
`;
            const document = parse_and_analyze(program_code);
            const provider = new CompletionProvider(new CommandDatabase());

            const continuation_position: Position = { line: 2, character: 10 };
            const continuation_result = (provider as any)
                .detect_cursor_in_program_body(document, continuation_position);
            expect(continuation_result).toBeNull();

            // The first true body line still detects the program.
            const body_position: Position = { line: 3, character: 10 };
            const body_result = (provider as any)
                .detect_cursor_in_program_body(document, body_position);
            expect(body_result?.name).toBe('test_prog');
        });

        it('should not detect program on the end line', () => {
            const program_code = `
program define test_prog
    syntax varlist
end
`;
            const document = parse_and_analyze(program_code);
            const provider = new CompletionProvider(new CommandDatabase());

            const end_position: Position = { line: 3, character: 2 };
            const result = (provider as any)
                .detect_cursor_in_program_body(document, end_position);
            expect(result).toBeNull();
        });
    });

    describe('program argument completions in macro context', () => {
        it('should not offer program arguments on a continued header line (#273)', async () => {
            const program_code = `
program define test_prog, ///
    rclass \`
    syntax varlist
end
`;
            const document = parse_and_analyze(program_code);
            const provider = new CompletionProvider(new CommandDatabase());

            // Inside the backtick on the continuation line — still
            // the header, so `varlist` (a body argument) must not be
            // offered as a program argument there.
            const position: Position = { line: 2, character: 12 };
            const completions = await provider.get_completions(document, position);

            const the_argument_labels = completions
                .filter(c => c.detail === 'Program argument')
                .map(c => c.label);
            expect(the_argument_labels).not.toContain('varlist');
        });

        it('should include program arguments in local macro completions', async () => {
            const program_code = `
program define test_prog
    syntax varlist [if] [in], [replace]
    local my_var \`
end
`;
            
            const document = create_test_document(program_code);
            const parsed = parse_and_analyze(program_code);
            document.ast = parsed.ast;
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position inside backtick (local macro context) - after the backtick
            const position: Position = { line: 3, character: 18 };
            
            const completions = await provider.get_completions(document, position);
            
            // Should include program arguments
            const labels = completions.map(c => c.label);
            expect(labels).toContain('varlist');
            expect(labels).toContain('if');
            expect(labels).toContain('in');
            
            // Check that program arguments have correct detail
            const varlist_completion = completions.find(c => c.label === 'varlist');
            expect(varlist_completion?.detail).toBe('Program argument');
        });

        it('should not include program arguments in global macro completions', async () => {
            const program_code = `
program define test_prog
    syntax varlist
    global my_global $
end
`;
            
            const document = create_test_document(program_code);
            const parsed = parse_and_analyze(program_code);
            document.ast = parsed.ast;
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position after dollar sign (global macro context)
            const position: Position = { line: 3, character: 23 };
            const completions = await provider.get_completions(document, position);
            
            // Should not include program arguments in global completions
            const labels = completions.map(c => c.label);
            expect(labels).not.toContain('varlist');
        });

        it('should handle programs with anything() arguments', async () => {
            await fc.assert(fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                async (custom_name) => {
                    const program_code = `
program define test_prog
    syntax anything(name=${custom_name})
    local result \`
end
`;
                    
                    const document = create_test_document(program_code);
                    const parsed = parse_and_analyze(program_code);
                    document.ast = parsed.ast;
                    
                    const provider = new CompletionProvider(new CommandDatabase());
                    
                    // Position inside backtick
                    const position: Position = { line: 3, character: 19 };
                    const completions = await provider.get_completions(document, position);
                    
                    // Should include the custom name, not 'anything'
                    const labels = completions.map(c => c.label);
                    expect(labels).toContain(custom_name);
                    expect(labels).not.toContain('anything');
                }
            ));
        });
    });

    describe('Program Argument Ranking', () => {
        it('should rank program arguments between current-file locals and parent locals', async () => {
            const program_code = `
program define test_prog
    syntax varlist [if] [in]
    local current_local "current"
    local result \`
end
`;
            
            const parsed = parse_and_analyze(program_code);
            const document = create_test_document(program_code);
            document.ast = parsed.ast;
            document.symbols = parsed.symbols;
            
            // Add parent local manually
            document.symbols.localMacros.set('parent_local', { 
                name: 'parent_local', 
                value: 'parent', 
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                scope_depth: 1,
                directive_type: 'included-by'
            });
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position inside backtick
            const position: Position = { line: 4, character: 19 };
            const completions = await provider.get_completions(document, position);
            
            // Find completion items
            const current_local_item = completions.find(c => c.label === 'current_local');
            const varlist_item = completions.find(c => c.label === 'varlist');
            const parent_local_item = completions.find(c => c.label === 'parent_local');
            
            expect(current_local_item).toBeDefined();
            expect(varlist_item).toBeDefined();
            expect(parent_local_item).toBeDefined();
            
            // Check ranking: current_local < varlist < parent_local
            const current_sort = current_local_item?.sortText || '';
            const varlist_sort = varlist_item?.sortText || '';
            const parent_sort = parent_local_item?.sortText || '';
            
            expect(current_sort < varlist_sort).toBe(true);
            expect(varlist_sort < parent_sort).toBe(true);
        });

        it('should assign correct symbol type to program arguments', async () => {
            await fc.assert(fc.asyncProperty(
                fc.array(
                    fc.constantFrom('varlist', 'varname', 'newvarname', 'if', 'in', 'using', 'exp'),
                    { minLength: 1, maxLength: 4 }
                ),
                async (arg_types) => {
                    const syntax_args = arg_types.join(' ');
                    const program_code = `
program define test_prog
    syntax ${syntax_args}
    local result \`
end
`;
                    
                    const document = create_test_document(program_code);
                    const parsed = parse_and_analyze(program_code);
                    document.ast = parsed.ast;
                    
                    const provider = new CompletionProvider(new CommandDatabase());
                    
                    // Position inside backtick
                    const position: Position = { line: 3, character: 19 };
                    const completions = await provider.get_completions(document, position);
                    
                    // All program arguments should have 'Program argument' detail
                    for (const arg_type of arg_types) {
                        const arg_completion = completions.find(c => c.label === arg_type);
                        if (arg_completion) {
                            expect(arg_completion.detail).toBe('Program argument');
                        }
                    }
                }
            ));
        });

        it('should handle mixed program arguments and local macros correctly', async () => {
            const program_code = `
program define test_prog
    syntax varlist [if] [in], [replace]
    local my_local "test"
    local another_local "test2"
    local result \`
end
`;
            
            const parsed = parse_and_analyze(program_code);
            const document = create_test_document(program_code);
            document.ast = parsed.ast;
            document.symbols = parsed.symbols;
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position inside backtick
            const position: Position = { line: 5, character: 19 };
            const completions = await provider.get_completions(document, position);
            
            // Should include both program arguments and local macros
            const labels = completions.map(c => c.label);
            expect(labels).toContain('varlist');
            expect(labels).toContain('if');
            expect(labels).toContain('in');
            expect(labels).toContain('my_local');
            expect(labels).toContain('another_local');
            
            // Program arguments should have different detail than local macros
            const varlist_item = completions.find(c => c.label === 'varlist');
            const local_item = completions.find(c => c.label === 'my_local');
            
            expect(varlist_item?.detail).toBe('Program argument');
            expect(local_item?.detail).not.toBe('Program argument');
        });

        it('should not include program arguments outside program context', async () => {
            const code = `
local outside_local "test"
program define test_prog
    syntax varlist
    local inside_local "test"
end
local result \`
`;
            
            const parsed = parse_and_analyze(code);
            const document = create_test_document(code);
            document.ast = parsed.ast;
            document.symbols = parsed.symbols;
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position outside program (last line)
            const position: Position = { line: 6, character: 15 };
            const completions = await provider.get_completions(document, position);
            
            // Should not include program arguments
            const labels = completions.map(c => c.label);
            expect(labels).not.toContain('varlist');
            expect(labels).toContain('outside_local');
        });

        it('should handle nested program contexts correctly', async () => {
            const program_code = `
program define outer_prog
    syntax varlist(name=outer_vars)
    program define inner_prog
        syntax anything(name=inner_data)
        local result \`
    end
end
`;
            
            const parsed = parse_and_analyze(program_code);
            const document = create_test_document(program_code);
            document.ast = parsed.ast;
            document.symbols = parsed.symbols;
            
            const provider = new CompletionProvider(new CommandDatabase());
            
            // Position inside inner program
            const position: Position = { line: 5, character: 23 };
            const completions = await provider.get_completions(document, position);
            
            // Should include inner program arguments, not outer
            const labels = completions.map(c => c.label);
            expect(labels).toContain('inner_data');
            expect(labels).not.toContain('outer_vars');
        });

        it('should compute correct ranking keys for program arguments', () => {
            fc.assert(fc.property(
                fc.record({
                    scope_depth: fc.integer({ min: 0, max: 5 }),
                    directive_type: fc.constantFrom('current', 'included-by', 'done-by'),
                    parent_uri: fc.option(fc.string({ minLength: 5, maxLength: 30 }).map(s => `/path/${s}.do`)),
                    alphabetical_order: fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
                }),
                (base_factors) => {
                    const program_arg_factors = { ...base_factors, symbol_type: 'program-argument' as const };
                    const local_macro_factors = { ...base_factors, symbol_type: 'local-macro' as const };
                    
                    const program_arg_key = compute_ranking_key(program_arg_factors);
                    const local_macro_key = compute_ranking_key(local_macro_factors);
                    
                    // Program arguments should rank between current-file locals (1.0) and parent locals (2.0)
                    // They get priority 1.5, so they should rank after current-file locals but before parent locals
                    if (base_factors.directive_type === 'current') {
                        // Current-file local should rank higher (lower key) than program argument
                        expect(local_macro_key < program_arg_key).toBe(true);
                    } else {
                        // Program argument should rank higher (lower key) than parent local
                        expect(program_arg_key < local_macro_key).toBe(true);
                    }
                }
            ));
        });
    });
});
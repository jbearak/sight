import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer, create_empty_symbol_table } from '../../src/analyzer';
import { StataDiagnosticCode, SymbolTable, ProgramSymbol } from '../../src/types';

function analyze_code(code: string, workspace_symbols?: SymbolTable) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(code);
    const parse_result = parser.parse(lexer_result.tokens);
    return analyzer.analyze(parse_result.ast, 'file:///test.do', workspace_symbols, { undefined_macro_enabled: true }, lexer_result.tokens);
}

// Generator for valid Stata macro names
const macro_name_gen = fc.string({ minLength: 1, maxLength: 10 })
    .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
    .filter(s => !['if', 'in', 'using', 'local', 'global', 'end', 'program'].includes(s.toLowerCase()));

// Generator for valid program names
const program_name_gen = fc.string({ minLength: 1, maxLength: 8 })
    .filter(s => /^[a-z][a-z0-9]*$/.test(s))
    .filter(s => !['if', 'in', 'using', 'local', 'global', 'end', 'program', 'by', 'quietly', 'capture'].includes(s));

describe('C_local Definition Position Properties', () => {
    /**
     * Property 5: C_local macros get definition_index set to call site
     * When a program with c_locals is called, the c_local macros should have
     * their definition_index set to the program call site, not the program definition.
     */
    it('Property 5: C_local macros get definition_index set to call site', () => {
        fc.assert(
            fc.property(
                program_name_gen,
                fc.array(macro_name_gen, { minLength: 1, maxLength: 3 }),
                (prog_name, c_local_names) => {
                    // Create workspace symbols with a program that has c_locals
                    const workspace_symbols: SymbolTable = create_empty_symbol_table();
                    const program_symbol: ProgramSymbol = {
                        name: prog_name,
                        location: { uri: 'file:///workspace/prog.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
                        sourceUri: 'file:///workspace/prog.ado',
                        c_locals: c_local_names
                    };
                    workspace_symbols.programs.set(prog_name, program_symbol);

                    // Code with program call followed by c_local usage
                    const code = `
local dummy 1
${prog_name} arg1 arg2
local result \`${c_local_names[0]}'
`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    // Check that c_local macro has definition_index set to call site (line 2, which is index 1 in 0-based)
                    const c_local_macro = result.symbols.localMacros.get(c_local_names[0]);
                    expect(c_local_macro).toBeDefined();
                    
                    // The definition_index should be > 0 (after the dummy local)
                    // and should correspond to the program call site
                    expect(c_local_macro?.definition_index).toBeGreaterThan(0);
                    expect(c_local_macro?.definition_line).toBe(2); // Program call is on line 2 (0-indexed)
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 6: Forward reference detection for c_local macros
     * When a c_local macro is referenced before the program call that defines it,
     * it should emit an undefined macro warning.
     */
    it('Property 6: Forward reference detection for c_local macros', () => {
        fc.assert(
            fc.property(
                program_name_gen,
                macro_name_gen,
                (prog_name, c_local_name) => {
                    // Create workspace symbols with a program that has c_locals
                    const workspace_symbols: SymbolTable = create_empty_symbol_table();
                    const program_symbol: ProgramSymbol = {
                        name: prog_name,
                        location: { uri: 'file:///workspace/prog.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
                        sourceUri: 'file:///workspace/prog.ado',
                        c_locals: [c_local_name]
                    };
                    workspace_symbols.programs.set(prog_name, program_symbol);

                    // Code with c_local reference BEFORE program call
                    const code = `
local result \`${c_local_name}'
${prog_name} arg1 arg2
`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    // Should have undefined macro warning for forward reference
                    const warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(c_local_name)
                    );
                    
                    return warnings.length === 1;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 7: Post-call reference for c_local macros
     * When a c_local macro is referenced after the program call that defines it,
     * it should NOT emit an undefined macro warning.
     */
    it('Property 7: Post-call reference for c_local macros', () => {
        fc.assert(
            fc.property(
                program_name_gen,
                macro_name_gen,
                (prog_name, c_local_name) => {
                    // Create workspace symbols with a program that has c_locals
                    const workspace_symbols: SymbolTable = create_empty_symbol_table();
                    const program_symbol: ProgramSymbol = {
                        name: prog_name,
                        location: { uri: 'file:///workspace/prog.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
                        sourceUri: 'file:///workspace/prog.ado',
                        c_locals: [c_local_name]
                    };
                    workspace_symbols.programs.set(prog_name, program_symbol);

                    // Code with program call BEFORE c_local reference
                    const code = `
${prog_name} arg1 arg2
local result \`${c_local_name}'
`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    // Should NOT have undefined macro warning for post-call reference
                    const warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(c_local_name)
                    );
                    
                    return warnings.length === 0;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 8: Multiple c_local macros from same program call
     * When a program defines multiple c_locals, all should get the same definition_index
     * (the program call site) and should be available after the call.
     */
    it('Property 8: Multiple c_local macros from same program call', () => {
        fc.assert(
            fc.property(
                program_name_gen,
                fc.array(macro_name_gen, { minLength: 2, maxLength: 4 }).filter(arr => 
                    new Set(arr).size === arr.length // Ensure unique names
                ),
                (prog_name, c_local_names) => {
                    // Create workspace symbols with a program that has multiple c_locals
                    const workspace_symbols: SymbolTable = create_empty_symbol_table();
                    const program_symbol: ProgramSymbol = {
                        name: prog_name,
                        location: { uri: 'file:///workspace/prog.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
                        sourceUri: 'file:///workspace/prog.ado',
                        c_locals: c_local_names
                    };
                    workspace_symbols.programs.set(prog_name, program_symbol);

                    // Code with program call followed by usage of all c_locals
                    const usage_lines = c_local_names.map(name => `local result_${name} \`${name}'`).join('\n');
                    const code = `
${prog_name} arg1 arg2
${usage_lines}
`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    // All c_local macros should be defined with same definition_index
                    let first_def_index: number | undefined;
                    for (const c_local_name of c_local_names) {
                        const macro = result.symbols.localMacros.get(c_local_name);
                        expect(macro).toBeDefined();
                        
                        if (first_def_index === undefined) {
                            first_def_index = macro?.definition_index;
                        } else {
                            expect(macro?.definition_index).toBe(first_def_index);
                        }
                        
                        // All should have same definition_line (program call line)
                        expect(macro?.definition_line).toBe(1); // Program call is on line 1 (0-indexed)
                    }
                    
                    // Should have no undefined macro warnings
                    const warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    return warnings.length === 0;
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 9: C_local definition_index vs regular local macro definition_index
     * C_local macros should have definition_index set to program call site,
     * while regular local macros should have definition_index set to their own definition site.
     */
    it('Property 9: C_local vs regular local macro definition_index', () => {
        fc.assert(
            fc.property(
                program_name_gen,
                macro_name_gen,
                macro_name_gen,
                (prog_name, c_local_name, regular_name) => {
                    // Ensure different names
                    if (c_local_name === regular_name) return true;
                    
                    // Create workspace symbols with a program that has c_locals
                    const workspace_symbols: SymbolTable = create_empty_symbol_table();
                    const program_symbol: ProgramSymbol = {
                        name: prog_name,
                        location: { uri: 'file:///workspace/prog.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
                        sourceUri: 'file:///workspace/prog.ado',
                        c_locals: [c_local_name]
                    };
                    workspace_symbols.programs.set(prog_name, program_symbol);

                    // Code with regular local, program call, then another regular local
                    const code = `
local ${regular_name} "before"
${prog_name} arg1 arg2
local another_${regular_name} "after"
local result \`${c_local_name}'
`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    const regular_macro = result.symbols.localMacros.get(regular_name);
                    const c_local_macro = result.symbols.localMacros.get(c_local_name);
                    const another_regular_macro = result.symbols.localMacros.get(`another_${regular_name}`);
                    
                    expect(regular_macro).toBeDefined();
                    expect(c_local_macro).toBeDefined();
                    expect(another_regular_macro).toBeDefined();
                    
                    // Regular macro should have earlier definition_index than c_local
                    expect(regular_macro?.definition_index).toBeLessThan(c_local_macro?.definition_index!);
                    
                    // C_local should have earlier definition_index than the "another" regular macro
                    expect(c_local_macro?.definition_index).toBeLessThan(another_regular_macro?.definition_index!);
                    
                    // Definition lines should match expectations
                    expect(regular_macro?.definition_line).toBe(1); // Line 1 (0-indexed)
                    expect(c_local_macro?.definition_line).toBe(2); // Program call on line 2
                    expect(another_regular_macro?.definition_line).toBe(3); // Line 3
                    
                    return true;
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 10: C_local macros from nested program calls
     * When programs are called in nested contexts (e.g., inside if blocks),
     * c_local macros should still get correct definition_index.
     */
    it('Property 10: C_local macros from nested program calls', () => {
        fc.assert(
            fc.property(
                program_name_gen,
                macro_name_gen,
                (prog_name, c_local_name) => {
                    // Create workspace symbols with a program that has c_locals
                    const workspace_symbols: SymbolTable = create_empty_symbol_table();
                    const program_symbol: ProgramSymbol = {
                        name: prog_name,
                        location: { uri: 'file:///workspace/prog.ado', range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } },
                        sourceUri: 'file:///workspace/prog.ado',
                        c_locals: [c_local_name]
                    };
                    workspace_symbols.programs.set(prog_name, program_symbol);

                    // Code with program call inside if block
                    const code = `
local condition 1
if \`condition' == 1 {
    ${prog_name} arg1 arg2
    local result \`${c_local_name}'
}
`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    const c_local_macro = result.symbols.localMacros.get(c_local_name);
                    expect(c_local_macro).toBeDefined();
                    
                    // Should have definition_index > 1 (after condition local and if statement)
                    expect(c_local_macro?.definition_index).toBeGreaterThan(1);
                    
                    // Should have no undefined macro warnings
                    const warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(c_local_name)
                    );
                    
                    return warnings.length === 0;
                }
            ),
            { numRuns: 30 }
        );
    });
});
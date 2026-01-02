import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

function analyze_code(code: string, workspace_symbols?: SymbolTable) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(code);
    const parse_result = parser.parse(lexer_result.tokens);
    return analyzer.analyze(parse_result.ast, 'file:///test.do', workspace_symbols, { undefined_macro_enabled: true }, lexer_result.tokens);
}

// Generator for valid Stata macro names (excluding reserved words and list function names)
const macro_name_gen = fc.string({ minLength: 1, maxLength: 10 })
    .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
    .filter(s => !['if', 'in', 'using', 'local', 'global', 'list', 'end', 'program',
                   // List function names that could be confused with macro names
                   'sizeof', 'sort', 'uniq', 'dups', 'clean', 'posof', 'subinstr', 'length',
                   'word', 'wordcount', 'and', 'or', 'count', 'piece'].includes(s.toLowerCase()));

describe('Forward Reference Detection Properties', () => {
    /**
     * Property 1: Forward references produce warnings
     * When a macro is referenced before it's defined, the analyzer should
     * produce an undefined macro warning.
     */
    it('Property 1: Forward references in list operations produce warnings', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                macro_name_gen,
                (ref_name, def_name) => {
                    // Ensure different names to avoid self-reference
                    if (ref_name === def_name) return true;
                    
                    // Forward reference: use ref_name in list operation before defining it
                    const code = `
local dummy x
local result: list ${ref_name} - dummy
local ${ref_name} value
`;
                    const result = analyze_code(code);
                    const the_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(ref_name)
                    );
                    // Should have exactly one warning for the forward reference
                    return the_warnings.length === 1;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Properly ordered references produce no warnings
     * When a macro is defined before it's referenced, no warning should be produced.
     */
    it('Property 2: Properly ordered references produce no warnings', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                (macro_name) => {
                    // Define macro before using it in list operation
                    const code = `
local ${macro_name} value
local dummy x
local result: list ${macro_name} - dummy
`;
                    const result = analyze_code(code);
                    const the_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    // Should have no warnings
                    return the_warnings.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: First definition determines forward reference boundary
     * When a macro is defined multiple times, only references before the
     * first definition should produce warnings.
     */
    it('Property 3: First definition determines forward reference boundary', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                (macro_name) => {
                    // Reference before first definition should warn
                    // Reference after first definition should not warn
                    const code = `
local dummy x
local before_result: list ${macro_name} - dummy
local ${macro_name} first_value
local after_result: list ${macro_name} - dummy
local ${macro_name} second_value
`;
                    const result = analyze_code(code);
                    const the_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    // Should have exactly one warning (for before_result)
                    return the_warnings.length === 1;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4: Workspace symbols do NOT suppress undefined macro warnings
     * The workspace_symbols parameter does NOT suppress undefined macro warnings.
     * Only cross-file directives provide scope resolution.
     */
    it('Property 4: Workspace symbols do NOT suppress undefined macro warnings', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                (macro_name) => {
                    // Create workspace symbols with the global macro
                    const workspace_symbols: SymbolTable = {
                        programs: new Map(),
                        localMacros: new Map(),
                        globalMacros: new Map([
                            [macro_name, {
                                name: macro_name,
                                scope: 'global',
                                location: { 
                                    uri: 'file:///other.do', 
                                    range: { 
                                        start: { line: 0, character: 0 }, 
                                        end: { line: 0, character: 10 } 
                                    } 
                                },
                                sourceUri: 'file:///other.do',
                            }]
                        ]),
                        variables: new Map(),
                    };

                    // Reference workspace global - WILL warn (workspace symbols do NOT suppress)
                    const code = `
local result: word 1 of \${${macro_name}}
`;
                    const result = analyze_code(code, workspace_symbols);
                    const the_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    // Workspace symbols do NOT suppress undefined macro warnings
                    return the_warnings.length === 1;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 5: Nested forward references in program blocks are detected
     * Forward references inside program blocks should still be detected.
     */
    it('Property 5: Nested forward references in program blocks are detected', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[a-z][a-z0-9]*$/.test(s)),
                (macro_name, prog_name) => {
                    // Forward reference inside program block
                    const code = `
program define ${prog_name}
    local dummy x
    local result: list ${macro_name} - dummy
    local ${macro_name} value
end
`;
                    const result = analyze_code(code);
                    const the_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    // Should have exactly one warning for the forward reference
                    return the_warnings.length === 1;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6: Loop variables are available in loop body
     * Loop variables defined in foreach/forvalues should be available
     * inside the loop body without warnings.
     */
    it('Property 6: Loop variables are available in loop body', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                (loop_var) => {
                    const code = `
local dummy x
foreach ${loop_var} in a b c {
    local result: list ${loop_var} - dummy
}
`;
                    const result = analyze_code(code);
                    const the_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(loop_var)
                    );
                    // Should have no warnings - loop var is defined at loop header
                    return the_warnings.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});

import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';

function analyze_code(code: string) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(code);
    const parse_result = parser.parse(lexer_result.tokens);
    return analyzer.analyze(parse_result.ast, 'file:///test.do', undefined, { undefined_macro_enabled: true }, lexer_result.tokens);
}

// Generator for valid Stata macro names
const macro_name_gen = fc.string({ minLength: 1, maxLength: 10 })
    .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
    .filter(s => !['if', 'in', 'using', 'local', 'global', 'list', 'end', 'program'].includes(s.toLowerCase()));

describe('String Literal Macro Detection Properties', () => {
    /**
     * Property 4: Undefined macros in string literals produce warnings
     * Feature: cross-file-forward-reference-fix, Property 4
     * Validates: Requirements 3.1, 3.2
     * 
     * When a macro is referenced within string literals (e.g., `di "`apple'"`),
     * the analyzer should produce undefined macro warnings when the macro is undefined.
     * Uses compound strings where macro expansion occurs.
     */
    it('Property 4: Undefined macros in string literals produce warnings', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                (macro_name) => {
                    // Test local macro in compound string literal
                    const local_code = `di \`"\`${macro_name}'"'`;
                    const local_result = analyze_code(local_code);
                    const local_warnings = local_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    // Test global macro in compound string literal
                    const global_code = `di \`"$${macro_name}"'`;
                    const global_result = analyze_code(global_code);
                    const global_warnings = global_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    // Both should produce exactly one warning each
                    return local_warnings.length === 1 && global_warnings.length === 1;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Complementary property: Defined macros in string literals produce no warnings
     * Validates that the detection is accurate and doesn't produce false positives.
     */
    it('Defined macros in string literals produce no warnings', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                (macro_name) => {
                    // Test local macro in compound string literal (defined first)
                    const local_code = `local ${macro_name} "value"\ndi \`"\`${macro_name}'"'`;
                    const local_result = analyze_code(local_code);
                    const local_warnings = local_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    // Test global macro in compound string literal (defined first)
                    const global_code = `global ${macro_name} "value"\ndi \`"$${macro_name}"'`;
                    const global_result = analyze_code(global_code);
                    const global_warnings = global_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    // Both should produce no warnings
                    return local_warnings.length === 0 && global_warnings.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});
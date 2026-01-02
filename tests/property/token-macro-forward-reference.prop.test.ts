import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../../src/analyzer";
import { StataParser } from "../../src/parser";
import { StataLexer } from "../../src/lexer";

describe("Token Macro Forward Reference Detection - Property Tests", () => {
    test("Property 1: Token forward references produce warnings", () => {
        fc.assert(
            fc.property(
                fc.record({
                    macro_name: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
                    reference_line: fc.integer({ min: 1, max: 5 }),
                    definition_line: fc.integer({ min: 6, max: 10 }),
                    value: fc.stringMatching(/^[a-zA-Z0-9 ]*$/)
                }),
                ({ macro_name, reference_line, definition_line, value }) => {
                    // Generate code with token reference before definition
                    const the_lines = Array(Math.max(reference_line, definition_line) + 1).fill("");
                    the_lines[reference_line] = `display \`${macro_name}'`;
                    the_lines[definition_line] = `local ${macro_name} "${value}"`;
                    
                    const source_code = the_lines.join("\n");
                    const lexer = new StataLexer();
                    const lexer_result = lexer.tokenize(source_code);
                    const parser = new StataParser();
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analyzer = new SemanticAnalyzer();
                    const analysis_result = analyzer.analyze(parse_result.ast, "test://file.do", undefined, undefined, lexer_result.tokens);
                    
                    // Should produce undefined macro warning
                    const the_warnings = analysis_result.diagnostics.filter(
                        my_diag => my_diag.message.toLowerCase().includes("undefined") && 
                                  my_diag.message.includes(macro_name)
                    );
                    
                    expect(the_warnings.length).toBeGreaterThan(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    test("Property 2: Token properly-ordered references produce no warnings", () => {
        fc.assert(
            fc.property(
                fc.record({
                    macro_name: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
                    definition_line: fc.integer({ min: 1, max: 5 }),
                    reference_line: fc.integer({ min: 6, max: 10 }),
                    value: fc.stringMatching(/^[a-zA-Z0-9 ]*$/),
                    is_global: fc.boolean()
                }),
                ({ macro_name, definition_line, reference_line, value, is_global }) => {
                    // Generate code with token reference after definition
                    const the_lines = Array(Math.max(reference_line, definition_line) + 1).fill("");
                    
                    if (is_global) {
                        the_lines[definition_line] = `global ${macro_name} "${value}"`;
                        the_lines[reference_line] = `display \$${macro_name}`;
                    } else {
                        the_lines[definition_line] = `local ${macro_name} "${value}"`;
                        the_lines[reference_line] = `display \`${macro_name}'`;
                    }
                    
                    const source_code = the_lines.join("\n");
                    const lexer = new StataLexer();
                    const lexer_result = lexer.tokenize(source_code);
                    const parser = new StataParser();
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analyzer = new SemanticAnalyzer();
                    const analysis_result = analyzer.analyze(parse_result.ast, "test://file.do", undefined, undefined, lexer_result.tokens);
                    
                    // Should not produce undefined macro warning for this macro
                    const the_warnings = analysis_result.diagnostics.filter(
                        my_diag => my_diag.message.toLowerCase().includes("undefined") && 
                                  my_diag.message.includes(macro_name)
                    );
                    
                    expect(the_warnings.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    test("Property 3: Token-AST consistency", () => {
        fc.assert(
            fc.property(
                fc.record({
                    macro_name: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
                    reference_line: fc.integer({ min: 1, max: 5 }),
                    definition_line: fc.integer({ min: 6, max: 10 }),
                    value: fc.stringMatching(/^[a-zA-Z0-9 ]*$/)
                }),
                ({ macro_name, reference_line, definition_line, value }) => {
                    // Generate code with both token and AST macro references
                    const the_lines = Array(Math.max(reference_line + 1, definition_line) + 1).fill("");
                    
                    // Token-only reference
                    the_lines[reference_line] = `display \`${macro_name}'`;
                    
                    // AST reference (in local command) - ensure it doesn't conflict with definition line
                    const ast_reference_line = reference_line + 1;
                    if (ast_reference_line !== definition_line) {
                        the_lines[ast_reference_line] = `local other_var \`${macro_name}'`;
                    } else {
                        // If there would be a conflict, skip this test case
                        return true; // Property holds trivially
                    }
                    
                    // Definition
                    the_lines[definition_line] = `local ${macro_name} "${value}"`;
                    
                    const source_code = the_lines.join("\n");
                    const lexer = new StataLexer();
                    const lexer_result = lexer.tokenize(source_code);
                    const parser = new StataParser();
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analyzer = new SemanticAnalyzer();
                    const analysis_result = analyzer.analyze(parse_result.ast, "test://file.do", undefined, undefined, lexer_result.tokens);
                    
                    // Both references should produce warnings (or both should not)
                    const the_warnings = analysis_result.diagnostics.filter(
                        my_diag => my_diag.message.toLowerCase().includes("undefined") && 
                                  my_diag.message.includes(macro_name)
                    );
                    
                    // Should have warnings for both references since both are forward references
                    expect(the_warnings.length).toBeGreaterThanOrEqual(1);
                    
                    // Verify consistency: if one reference produces warning, both should
                    const token_warning_exists = the_warnings.some(
                        my_diag => my_diag.range.start.line === reference_line
                    );
                    const ast_warning_exists = the_warnings.some(
                        my_diag => my_diag.range.start.line === ast_reference_line
                    );
                    
                    // Both should be consistent (both true or both false)
                    expect(token_warning_exists).toBe(ast_warning_exists);
                }
            ),
            { numRuns: 100 }
        );
    });
});
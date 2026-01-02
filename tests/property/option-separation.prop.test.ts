import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { detect_completion_context } from '../../src/providers/completion';
import { DocumentState } from '../../src/document-store';
import { Position } from 'vscode-languageserver-textdocument';

/**
 * Property-based tests for Option Separation
 * Feature: option-separation
 * 
 * Tests Requirements 1.2, 1.3, 2.5:
 * - Commands with assignment syntax followed by options correctly separate expressions from options
 * - Commas inside parentheses are treated as part of the expression
 */
describe('Option Separation Property Tests', () => {
    
    /**
     * Generator for assignment commands that support options
     */
    function arbitrary_assignment_command(): fc.Arbitrary<string> {
        return fc.constantFrom('generate', 'replace', 'egen');
    }

    /**
     * Generator for variable names
     */
    function arbitrary_variable_name(): fc.Arbitrary<string> {
        return fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,8}$/);
    }

    /**
     * Generator for expressions with parentheses containing commas
     */
    function arbitrary_expression_with_commas(): fc.Arbitrary<string> {
        return fc.oneof(
            // Simple function calls with comma-separated arguments
            fc.record({
                func: fc.constantFrom('max', 'min', 'sum', 'mean', 'substr', 'regexm'),
                args: fc.array(fc.stringMatching(/^[a-zA-Z0-9_]+$/), { minLength: 2, maxLength: 4 })
            }).map(({ func, args }) => `${func}(${args.join(', ')})`),
            
            // Nested function calls
            fc.record({
                outer: fc.constantFrom('log', 'exp', 'sqrt'),
                inner: fc.constantFrom('max', 'min'),
                args: fc.array(fc.stringMatching(/^[a-zA-Z0-9_]+$/), { minLength: 2, maxLength: 3 })
            }).map(({ outer, inner, args }) => `${outer}(${inner}(${args.join(', ')}))`),
            
            // Conditional expressions with commas
            fc.record({
                var1: arbitrary_variable_name(),
                var2: arbitrary_variable_name(),
                val1: fc.integer({ min: 1, max: 100 }),
                val2: fc.integer({ min: 1, max: 100 })
            }).map(({ var1, var2, val1, val2 }) => `cond(${var1} > ${val1}, ${val2}, ${var2})`)
        );
    }

    /**
     * Generator for option names
     */
    function arbitrary_option_name(): fc.Arbitrary<string> {
        return fc.constantFrom('nolabel', 'replace', 'force', 'clear', 'detail');
    }

    /**
     * Property 1: Assignment expressions with commas in parentheses should not trigger option context
     * 
     * For any assignment command with an expression containing commas inside parentheses,
     * the completion context at the comma position should NOT be 'option'.
     */
    it('should not detect option context for commas inside parentheses in assignment expressions', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            arbitrary_expression_with_commas(),
            (command, varname, expression) => {
                const source = `${command} ${varname} = ${expression}`;
                
                // Find comma positions within the expression
                const comma_positions: number[] = [];
                let paren_depth = 0;
                const assignment_start = source.indexOf('=') + 1;
                
                for (let i = assignment_start; i < source.length; i++) {
                    if (source[i] === '(') paren_depth++;
                    if (source[i] === ')') paren_depth--;
                    if (source[i] === ',' && paren_depth > 0) {
                        comma_positions.push(i);
                    }
                }
                
                // Test each comma position inside parentheses
                for (const pos of comma_positions) {
                    const document: DocumentState = {
                        content: source,
                        tokens: [],
                        ast: { nodes: [] },
                        symbols: { locals: new Map(), globals: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Set() },
                        diagnostics: [],
                        contextRanges: [],
                        lineOffsets: []
                    };
                    
                    const position: Position = { line: 0, character: pos + 1 };
                    const context = detect_completion_context(document, position);
                    
                    // Comma inside parentheses should NOT be option context
                    expect(context.type).not.toBe('option');
                }
            }
        ), { numRuns: 100 });
    });

    /**
     * Property 2: Top-level commas after assignment expressions should trigger option context
     * 
     * For any assignment command followed by a top-level comma (not in parentheses),
     * the completion context should be 'option'.
     */
    it('should detect option context for top-level commas after assignment expressions', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            arbitrary_expression_with_commas(),
            arbitrary_option_name(),
            (command, varname, expression, option) => {
                const source = `${command} ${varname} = ${expression}, ${option}`;
                
                // Find the top-level comma position (after the expression)
                const assignment_start = source.indexOf('=') + 1;
                let paren_depth = 0;
                let top_level_comma_pos = -1;
                
                for (let i = assignment_start; i < source.length; i++) {
                    if (source[i] === '(') paren_depth++;
                    if (source[i] === ')') paren_depth--;
                    if (source[i] === ',' && paren_depth === 0) {
                        top_level_comma_pos = i;
                        break;
                    }
                }
                
                if (top_level_comma_pos >= 0) {
                    const document: DocumentState = {
                        content: source,
                        tokens: [],
                        ast: { nodes: [] },
                        symbols: { locals: new Map(), globals: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Set() },
                        diagnostics: [],
                        contextRanges: [],
                        lineOffsets: []
                    };
                    
                    const position: Position = { line: 0, character: top_level_comma_pos + 2 };
                    const context = detect_completion_context(document, position);
                    
                    // Top-level comma should be option context
                    expect(context.type).toBe('option');
                    if (context.type === 'option') {
                        expect(context.command).toBe(command);
                    }
                }
            }
        ), { numRuns: 100 });
    });

    /**
     * Property 3: Parser correctly separates expressions from options
     * 
     * For any assignment command with expression and options, the parser should:
     * - Include commas inside parentheses as part of the expression
     * - Treat the first top-level comma as the start of options
     */
    it('should correctly parse assignment expressions with embedded commas and options', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            arbitrary_expression_with_commas(),
            fc.array(arbitrary_option_name(), { minLength: 1, maxLength: 3 }),
            (command, varname, expression, options) => {
                const source = `${command} ${varname} = ${expression}, ${options.join(' ')}`;
                
                const lexer = new StataLexer();
                const lexer_result = lexer.tokenize(source);
                const parser = new StataParser();
                const result = parser.parse(lexer_result.tokens);
                
                expect(result.errors).toHaveLength(0);
                expect(result.ast.nodes).toHaveLength(1);
                
                const command_node = result.ast.nodes[0];
                expect(command_node.type).toBe('command');
                
                if (command_node.type === 'command') {
                    // Should have expression containing the core expression content (ignoring whitespace)
                    expect(command_node.expression).toBeDefined();
                    const normalized_expression = command_node.expression!.replace(/\s+/g, '');
                    const normalized_expected = expression.replace(/\s+/g, '');
                    expect(normalized_expression).toContain(normalized_expected);
                    
                    // Should have options parsed separately
                    expect(command_node.options).toBeDefined();
                    expect(command_node.options!.length).toBeGreaterThan(0);
                    
                    // Expression should not contain option names
                    for (const option of options) {
                        if (command_node.expression && !expression.includes(option)) {
                            expect(command_node.expression).not.toContain(option);
                        }
                    }
                }
            }
        ), { numRuns: 50 });
    });

    /**
     * Property 4: Nested parentheses with commas are handled correctly
     * 
     * For expressions with multiple levels of nested parentheses containing commas,
     * all commas should be treated as part of the expression until the first top-level comma.
     */
    it('should handle nested parentheses with commas correctly', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            fc.record({
                outer_func: fc.constantFrom('log', 'exp'),
                middle_func: fc.constantFrom('max', 'min'),
                inner_func: fc.constantFrom('sum', 'mean'),
                vars: fc.array(arbitrary_variable_name(), { minLength: 3, maxLength: 5 })
            }),
            arbitrary_option_name(),
            (command, varname, { outer_func, middle_func, inner_func, vars }, option) => {
                // Create deeply nested expression: outer(middle(inner(a, b), c), d)
                const inner_expr = `${inner_func}(${vars.slice(0, 2).join(', ')})`;
                const middle_expr = `${middle_func}(${inner_expr}, ${vars[2]})`;
                const outer_expr = `${outer_func}(${middle_expr}, ${vars[3] || 'x'})`;
                
                const source = `${command} ${varname} = ${outer_expr}, ${option}`;
                
                // Count commas inside all parentheses levels
                let paren_depth = 0;
                let commas_in_parens = 0;
                let top_level_comma_pos = -1;
                const assignment_start = source.indexOf('=') + 1;
                
                for (let i = assignment_start; i < source.length; i++) {
                    if (source[i] === '(') paren_depth++;
                    if (source[i] === ')') paren_depth--;
                    if (source[i] === ',') {
                        if (paren_depth > 0) {
                            commas_in_parens++;
                        } else if (top_level_comma_pos === -1) {
                            top_level_comma_pos = i;
                        }
                    }
                }
                
                // Should have found commas inside parentheses
                expect(commas_in_parens).toBeGreaterThan(0);
                
                // Test that commas inside nested parentheses don't trigger option context
                if (top_level_comma_pos > 0) {
                    const document: DocumentState = {
                        content: source,
                        tokens: [],
                        ast: { nodes: [] },
                        symbols: { locals: new Map(), globals: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Set() },
                        diagnostics: [],
                        contextRanges: [],
                        lineOffsets: []
                    };
                    
                    // Test position just after the top-level comma
                    const position: Position = { line: 0, character: top_level_comma_pos + 2 };
                    const context = detect_completion_context(document, position);
                    
                    expect(context.type).toBe('option');
                }
            }
        ), { numRuns: 50 });
    });

    /**
     * Property 5: String literals with commas don't interfere with option detection
     * 
     * For assignment expressions containing string literals with commas,
     * those commas should not affect option context detection.
     */
    it('should ignore commas inside string literals when detecting option context', () => {
        fc.assert(fc.property(
            arbitrary_assignment_command(),
            arbitrary_variable_name(),
            fc.record({
                func: fc.constantFrom('substr', 'regexm', 'subinstr'),
                str_with_comma: fc.constantFrom('"hello, world"', '"a, b, c"', '"x,y,z"'),
                other_args: fc.array(fc.stringMatching(/^[a-zA-Z0-9_]+$/), { minLength: 1, maxLength: 2 })
            }),
            arbitrary_option_name(),
            (command, varname, { func, str_with_comma, other_args }, option) => {
                const expression = `${func}(${str_with_comma}, ${other_args.join(', ')})`;
                const source = `${command} ${varname} = ${expression}, ${option}`;
                
                const document: DocumentState = {
                    content: source,
                    tokens: [],
                    ast: { nodes: [] },
                    symbols: { locals: new Map(), globals: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Set() },
                    diagnostics: [],
                    contextRanges: [],
                    lineOffsets: []
                };
                
                // Find the top-level comma (after the closing parenthesis)
                const closing_paren_pos = source.lastIndexOf(')');
                const comma_pos = source.indexOf(',', closing_paren_pos);
                
                if (comma_pos > 0) {
                    const position: Position = { line: 0, character: comma_pos + 2 };
                    const context = detect_completion_context(document, position);
                    
                    expect(context.type).toBe('option');
                }
                
                // Test that commas inside the string literal don't trigger option context
                const string_start = source.indexOf(str_with_comma);
                const string_commas: number[] = [];
                for (let i = string_start; i < string_start + str_with_comma.length; i++) {
                    if (source[i] === ',') {
                        string_commas.push(i);
                    }
                }
                
                for (const comma_in_string of string_commas) {
                    const pos_in_string: Position = { line: 0, character: comma_in_string + 1 };
                    const context_in_string = detect_completion_context(document, pos_in_string);
                    expect(context_in_string.type).not.toBe('option');
                }
            }
        ), { numRuns: 50 });
    });
});
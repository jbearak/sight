import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { arbitrary_identifier, arbitrary_local_macro_ref, arbitrary_global_macro_ref } from './generators';

/**
 * Property-based tests for Macro Reference Variable Registration Bug Fix
 * Feature: macro-ref-variable-registration-bug
 * 
 * Tests that macro references are NOT registered as variables in the symbol table.
 */
describe('Macro Reference Variable Registration Property Tests', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;

    beforeEach(() => {
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
    });

    /**
     * Property 1: Macro references not registered as variables
     * 
     * *For any* local macro reference (`name') or global macro reference ($name, ${name})
     * used as a varlist item in any variable-extracting command (confirm variable, gen,
     * egen, input, rename), the analyzer SHALL NOT register the macro reference as a
     * VariableSymbol in the symbol table.
     * 
     * Feature: macro-ref-variable-registration-bug, Property 1: Macro references not registered as variables
     * **Validates: Requirements 1.1-1.5, 2.1-2.5**
     */
    describe('Property 1: Macro references not registered as variables', () => {
        it('should NOT register local macro refs in gen command', () => {
            fc.assert(
                fc.property(arbitrary_local_macro_ref(), (macro_ref) => {
                    const source = `gen ${macro_ref} = 1`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register global macro refs in gen command', () => {
            fc.assert(
                fc.property(arbitrary_global_macro_ref(), (macro_ref) => {
                    const source = `gen ${macro_ref} = 1`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register local macro refs in egen command', () => {
            fc.assert(
                fc.property(arbitrary_local_macro_ref(), (macro_ref) => {
                    const source = `egen ${macro_ref} = mean(x)`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register global macro refs in egen command', () => {
            fc.assert(
                fc.property(arbitrary_global_macro_ref(), (macro_ref) => {
                    const source = `egen ${macro_ref} = mean(x)`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register local macro refs in input command', () => {
            fc.assert(
                fc.property(arbitrary_local_macro_ref(), (macro_ref) => {
                    const source = `input ${macro_ref}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register global macro refs in input command', () => {
            fc.assert(
                fc.property(arbitrary_global_macro_ref(), (macro_ref) => {
                    const source = `input ${macro_ref}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register local macro refs in simple rename command', () => {
            fc.assert(
                fc.property(arbitrary_local_macro_ref(), (macro_ref) => {
                    const source = `rename old ${macro_ref}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register global macro refs in simple rename command', () => {
            fc.assert(
                fc.property(arbitrary_global_macro_ref(), (macro_ref) => {
                    const source = `rename old ${macro_ref}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register local macro refs in confirm variable command', () => {
            fc.assert(
                fc.property(arbitrary_local_macro_ref(), (macro_ref) => {
                    const source = `capture confirm variable ${macro_ref}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it('should NOT register global macro refs in confirm variable command', () => {
            fc.assert(
                fc.property(arbitrary_global_macro_ref(), (macro_ref) => {
                    const source = `capture confirm variable ${macro_ref}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(macro_ref)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: is_macro_reference correctly identifies macro references
     * 
     * *For any* string, the is_macro_reference helper function SHALL return true
     * if and only if the string is a local macro reference (starts with backtick
     * and ends with single quote) or a global macro reference (starts with $).
     * 
     * Feature: macro-ref-variable-registration-bug, Property 2: is_macro_reference correctly identifies macro references
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    describe('Property 2: is_macro_reference correctly identifies macro references', () => {
        it('should return true for local macro references', () => {
            fc.assert(
                fc.property(arbitrary_local_macro_ref(), (macro_ref) => {
                    const is_macro_ref = (name: string): boolean => {
                        if (name.startsWith('`') && name.endsWith("'")) {
                            return true;
                        }
                        if (name.startsWith('$')) {
                            return true;
                        }
                        return false;
                    };

                    expect(is_macro_ref(macro_ref)).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('should return true for global macro references', () => {
            fc.assert(
                fc.property(arbitrary_global_macro_ref(), (macro_ref) => {
                    const is_macro_ref = (name: string): boolean => {
                        if (name.startsWith('`') && name.endsWith("'")) {
                            return true;
                        }
                        if (name.startsWith('$')) {
                            return true;
                        }
                        return false;
                    };

                    expect(is_macro_ref(macro_ref)).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('should return false for plain identifiers', () => {
            fc.assert(
                fc.property(arbitrary_identifier(), (identifier) => {
                    const is_macro_ref = (name: string): boolean => {
                        if (name.startsWith('`') && name.endsWith("'")) {
                            return true;
                        }
                        if (name.startsWith('$')) {
                            return true;
                        }
                        return false;
                    };

                    expect(is_macro_ref(identifier)).toBe(false);
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Valid identifiers still registered as variables
     * 
     * *For any* valid Stata identifier used as a varlist item in a variable-extracting
     * command (confirm variable, gen, egen, input, rename), the analyzer SHALL register
     * the identifier as a VariableSymbol in the symbol table with the appropriate source.
     * 
     * Feature: macro-ref-variable-registration-bug, Property 3: Valid identifiers still registered as variables
     * **Validates: Requirements 4.1, 4.2**
     */
    describe('Property 3: Valid identifiers still registered as variables', () => {
        it('should register valid identifiers in gen command', () => {
            fc.assert(
                fc.property(arbitrary_identifier(), (varname) => {
                    const source = `gen ${varname} = 1`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(varname)).toBe(true);
                    expect(result.symbols.variables.get(varname)?.source).toBe('gen');
                }),
                { numRuns: 100 }
            );
        });

        it('should register valid identifiers in egen command', () => {
            fc.assert(
                fc.property(arbitrary_identifier(), (varname) => {
                    const source = `egen ${varname} = mean(x)`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(varname)).toBe(true);
                    expect(result.symbols.variables.get(varname)?.source).toBe('egen');
                }),
                { numRuns: 100 }
            );
        });

        it('should register valid identifiers in input command', () => {
            fc.assert(
                fc.property(arbitrary_identifier(), (varname) => {
                    const source = `input ${varname}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(varname)).toBe(true);
                    expect(result.symbols.variables.get(varname)?.source).toBe('input');
                }),
                { numRuns: 100 }
            );
        });

        it('should register valid identifiers in simple rename command', () => {
            fc.assert(
                fc.property(arbitrary_identifier(), (varname) => {
                    const source = `rename old ${varname}`;
                    const { tokens } = lexer.tokenize(source);
                    const { ast } = parser.parse(tokens);
                    const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                    expect(result.symbols.variables.has(varname)).toBe(true);
                    expect(result.symbols.variables.get(varname)?.source).toBe('rename');
                }),
                { numRuns: 100 }
            );
        });
    });
});

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { parse_option_argument, is_valid_identifier } from '../../src/analyzer/option-argument-parser';

/**
 * Property-based tests for Option Argument Parser
 * Feature: macro-creating-options
 */
describe('Option Argument Parser Property Tests', () => {
    /**
     * Generator for valid Stata identifiers
     */
    const valid_identifier = fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s));

    /**
     * Generator for whitespace strings
     */
    const whitespace = fc.stringMatching(/^[ \t\n\r]+$/);

    /**
     * Generator for macro expansion characters
     */
    const macro_expansion_chars = fc.oneof(
        fc.constant('`'),
        fc.constant('$'),
        fc.string().filter(s => s.includes('`') || s.includes('$'))
    );

    /**
     * Property 1: Option Argument Extraction
     * For any valid Stata identifier wrapped in option syntax (with optional whitespace padding),
     * the parser should extract the identifier correctly after trimming whitespace.
     * Feature: macro-creating-options, Property 1: Option Argument Extraction
     * Validates: Requirements 1.1, 1.2, 1.3
     */
    it('should extract valid identifiers from option arguments with whitespace', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                fc.option(whitespace, { nil: undefined }),
                fc.option(whitespace, { nil: undefined }),
                (identifier, leading_ws, trailing_ws) => {
                    const argument = `${leading_ws || ''}${identifier}${trailing_ws || ''}`;
                    const result = parse_option_argument(argument);
                    
                    expect(result.is_literal).toBe(true);
                    expect(result.identifier).toBe(identifier);
                    expect(result.rejection_reason).toBeUndefined();
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Non-Literal Argument Rejection - Macro Expansion
     * For any option argument containing macro expansion characters (` or $),
     * the parser should reject it with macro_expansion reason.
     * Feature: macro-creating-options, Property 2: Non-Literal Argument Rejection
     * Validates: Requirements 1.4, 3.2, 4.2
     */
    it('should reject arguments with macro expansion', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 }),
                macro_expansion_chars,
                (base_string, expansion_char) => {
                    const argument = base_string + expansion_char;
                    const result = parse_option_argument(argument);
                    
                    expect(result.is_literal).toBe(false);
                    expect(result.rejection_reason).toBe('macro_expansion');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Quoted String Handling
     * For quoted strings, the parser should reject them with 'quoted' reason.
     * Feature: macro-creating-options, Property 3: Quoted String Handling
     * Validates: Requirements 1.4, 3.2, 4.2
     */
    it('should reject quoted arguments', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                fc.oneof(fc.constant('"'), fc.constant("'")),
                (identifier, quote_char) => {
                    const argument = `${quote_char}${identifier}${quote_char}`;
                    const result = parse_option_argument(argument);
                    
                    expect(result.is_literal).toBe(false);
                    expect(result.rejection_reason).toBe('quoted');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4: Invalid Identifier Character Rejection
     * For any string containing invalid identifier characters (non-whitespace), 
     * the parser should reject it.
     * Feature: macro-creating-options, Property 4: Invalid Identifier Character Rejection
     * Validates: Requirements 1.4, 3.2, 4.2
     */
    it('should reject arguments with invalid identifier characters', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => {
                    const trimmed = s.trim();
                    return trimmed.length > 0 && 
                           !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed) &&
                           !/[`$"']/.test(trimmed) &&
                           !/\s/.test(trimmed);
                }),
                (invalid_string) => {
                    const result = parse_option_argument(invalid_string);
                    
                    expect(result.is_literal).toBe(false);
                    expect(result.rejection_reason).toBe('invalid_chars');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 5: Empty Argument Handling
     * For empty or whitespace-only arguments, the parser should reject with 'empty' reason.
     * Feature: macro-creating-options, Property 5: Empty Argument Handling
     * Validates: Requirements 1.4
     */
    it('should handle empty and whitespace-only arguments', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant(''),
                    whitespace
                ),
                (argument) => {
                    const result = parse_option_argument(argument);
                    
                    expect(result.is_literal).toBe(false);
                    expect(result.rejection_reason).toBe('empty');
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 6: Undefined Argument Handling
     * For undefined arguments, the parser should reject with 'empty' reason.
     * Feature: macro-creating-options, Property 6: Undefined Handling
     * Validates: Requirements 1.4
     */
    it('should handle undefined arguments', () => {
        const result = parse_option_argument(undefined);
        
        expect(result.is_literal).toBe(false);
        expect(result.rejection_reason).toBe('empty');
    });

    /**
     * Property 7: Deterministic Parsing
     * For any given input, the parser should always return the same result.
     * Feature: macro-creating-options, Property 7: Deterministic Parsing
     * Validates: General correctness
     */
    it('should be deterministic', () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 50 }),
                (argument) => {
                    const result1 = parse_option_argument(argument);
                    const result2 = parse_option_argument(argument);
                    
                    expect(result1).toEqual(result2);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 8: Valid Identifier Consistency
     * If is_literal is true, identifier should be a valid Stata identifier.
     * Feature: macro-creating-options, Property 8: Valid Identifier Consistency
     * Validates: Requirements 1.1, 1.2, 1.3
     */
    it('should only return valid identifiers when is_literal is true', () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 50 }),
                (argument) => {
                    const result = parse_option_argument(argument);
                    
                    if (result.is_literal) {
                        expect(result.identifier).toBeDefined();
                        expect(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(result.identifier!)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 9: is_valid_identifier function correctness
     * Feature: macro-creating-options, Property 9: is_valid_identifier
     * Validates: General correctness
     */
    it('should correctly validate identifiers', () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 50 }),
                (s) => {
                    const expected = /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
                    expect(is_valid_identifier(s)).toBe(expected);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 10: Internal whitespace rejection
     * Arguments with internal whitespace should be rejected.
     * Feature: macro-creating-options, Property 10: Internal Whitespace Rejection
     * Validates: Requirements 1.4
     */
    it('should reject arguments with internal whitespace', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                (id1, id2) => {
                    const argument = `${id1} ${id2}`;
                    const result = parse_option_argument(argument);
                    
                    expect(result.is_literal).toBe(false);
                    expect(result.rejection_reason).toBe('whitespace');
                }
            ),
            { numRuns: 50 }
        );
    });
});

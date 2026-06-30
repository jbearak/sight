/**
 * Orphan Closing Brace Property Tests
 *
 * Tests that verify the parser correctly detects orphan closing braces
 * (closing braces without matching opening braces) and doesn't produce
 * false positives for valid block structures.
 *
 * Feature: orphan-closing-brace-detection
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer, StataParser } from '../../src/index';
import { ParseErrorCode } from '../../src/types';
import { arbitrary_command_name, arbitrary_variable_name, arbitrary_string_literal } from './generators/primitives';

/**
 * Helper to parse a document and get parse errors
 */
function parse_document(source: string): { errors: Array<{ code: ParseErrorCode; message: string; range: any }> } {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);
    return { errors: parse_result.errors };
}

/**
 * Helper to check if a specific error code is present
 */
function has_error_code(errors: Array<{ code: ParseErrorCode }>, code: ParseErrorCode): boolean {
    return errors.some(e => e.code === code);
}

/**
 * Helper to count occurrences of a specific error code
 */
function count_error_code(errors: Array<{ code: ParseErrorCode }>, code: ParseErrorCode): number {
    return errors.filter(e => e.code === code).length;
}

/**
 * Generator for valid if/else blocks
 */
const arbitrary_if_block = fc.tuple(
    arbitrary_string_literal(),
    fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
).map(([condition, commands]) => 
    `if ${condition} {\n${commands.map(cmd => `  ${cmd}`).join('\n')}\n}`
);

/**
 * Generator for valid foreach blocks
 */
const arbitrary_foreach_block = fc.tuple(
    arbitrary_variable_name(),
    fc.array(arbitrary_variable_name(), { minLength: 1, maxLength: 3 }),
    fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
).map(([loopVar, varlist, commands]) => 
    `foreach ${loopVar} of varlist ${varlist.join(' ')} {\n${commands.map(cmd => `  ${cmd}`).join('\n')}\n}`
);

/**
 * Generator for valid forvalues blocks
 */
const arbitrary_forvalues_block = fc.tuple(
    arbitrary_variable_name(),
    fc.integer({ min: 1, max: 10 }),
    fc.integer({ min: 11, max: 20 }),
    fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
).map(([loopVar, start, end, commands]) => 
    `forvalues ${loopVar} = ${start}/${end} {\n${commands.map(cmd => `  ${cmd}`).join('\n')}\n}`
);

/**
 * Generator for valid while blocks
 */
const arbitrary_while_block = fc.tuple(
    arbitrary_string_literal(),
    fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
).map(([condition, commands]) => 
    `while ${condition} {\n${commands.map(cmd => `  ${cmd}`).join('\n')}\n}`
);

/**
 * Generator for valid frame blocks
 */
const arbitrary_frame_block = fc.tuple(
    arbitrary_variable_name(),
    fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
).map(([frameName, commands]) => 
    `frame ${frameName} {\n${commands.map(cmd => `  ${cmd}`).join('\n')}\n}`
);

/**
 * Generator for valid prefix blocks (quietly, capture, etc.)
 */
const arbitrary_prefix_block = fc.tuple(
    fc.constantFrom('quietly', 'capture', 'noisily'),
    arbitrary_if_block
).map(([prefix, block]) => `${prefix}: ${block}`);

/**
 * Generator for valid block structures
 */
const arbitrary_valid_block = fc.oneof(
    arbitrary_if_block,
    arbitrary_foreach_block,
    arbitrary_forvalues_block,
    arbitrary_while_block,
    arbitrary_frame_block,
    arbitrary_prefix_block
);

/**
 * Generator for simple Stata code without blocks
 */
const arbitrary_simple_code = fc.array(
    fc.oneof(
        arbitrary_command_name(),
        fc.tuple(arbitrary_variable_name(), arbitrary_string_literal()).map(([name, value]) => `local ${name} = ${value}`),
        fc.tuple(arbitrary_variable_name(), arbitrary_string_literal()).map(([name, value]) => `global ${name} = ${value}`)
    ),
    { minLength: 1, maxLength: 5 }
).map(statements => statements.join('\n'));

describe('Orphan Closing Brace Property Tests', () => {
    /**
     * Property 2: Valid Block Structure Acceptance
     * For any valid if/else/foreach/forvalues/while/frame/prefix block structure,
     * the parser SHALL NOT emit a diagnostic with code ORPHAN_CLOSE_BRACE.
     *
     * Feature: orphan-closing-brace-detection, Property 2: Valid Block Structure Acceptance
     * **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8**
     */
    describe('Property 2: Valid Block Structure Acceptance', () => {
        it('should not detect orphan braces in valid if blocks', () => {
            fc.assert(
                fc.property(arbitrary_if_block, (block) => {
                    const result = parse_document(block);
                    return !has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                }),
                { numRuns: 100 }
            );
        });

        it('should not detect orphan braces in valid foreach blocks', () => {
            fc.assert(
                fc.property(arbitrary_foreach_block, (block) => {
                    const result = parse_document(block);
                    return !has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                }),
                { numRuns: 100 }
            );
        });

        it('should not detect orphan braces in valid forvalues blocks', () => {
            fc.assert(
                fc.property(arbitrary_forvalues_block, (block) => {
                    const result = parse_document(block);
                    return !has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                }),
                { numRuns: 100 }
            );
        });

        it('should not detect orphan braces in valid while blocks', () => {
            fc.assert(
                fc.property(arbitrary_while_block, (block) => {
                    const result = parse_document(block);
                    return !has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                }),
                { numRuns: 100 }
            );
        });

        it('should not detect orphan braces in valid frame blocks', () => {
            fc.assert(
                fc.property(arbitrary_frame_block, (block) => {
                    const result = parse_document(block);
                    return !has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                }),
                { numRuns: 100 }
            );
        });

        it('should not detect orphan braces in valid prefix blocks', () => {
            fc.assert(
                fc.property(arbitrary_prefix_block, (block) => {
                    const result = parse_document(block);
                    return !has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                }),
                { numRuns: 100 }
            );
        });

        it('should not detect orphan braces in mixed valid block structures', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_valid_block, { minLength: 1, maxLength: 3 }),
                    (blocks) => {
                        const document = blocks.join('\n\n');
                        const result = parse_document(document);
                        return !has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Regression: a dangling prefix command (e.g. `quietly`, `by`) with no
     * command after it inside a block must not be misreported as an orphan
     * closing brace. The malformed prefix is a genuine syntax error, but the
     * block's own `}` is balanced and must not cascade into ORPHAN_CLOSE_BRACE.
     */
    describe('Regression: dangling prefix command inside a block', () => {
        const the_prefix_commands = [
            'by', 'bysort', 'quietly', 'qui', 'capture', 'cap', 'noisily', 'noi',
        ];

        for (const my_prefix of the_prefix_commands) {
            it(`does not orphan the close brace for dangling \`${my_prefix}\` in forvalues`, () => {
                const result = parse_document(
                    `forvalues i = 1/11 {\n  ${my_prefix}\n}`
                );
                expect(
                    has_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE)
                ).toBe(false);
            });
        }
    });

    /**
     * Property 3: Multiple Orphan Brace Handling
     * For any document containing N orphan closing braces on different lines,
     * the parser SHALL emit exactly N diagnostics with code ORPHAN_CLOSE_BRACE,
     * each with the correct line number.
     *
     * Feature: orphan-closing-brace-detection, Property 3: Multiple Orphan Brace Handling
     * **Validates: Requirements 3.1, 3.2**
     */
    describe('Property 3: Multiple Orphan Brace Handling', () => {
        it('should detect exactly N orphan braces for N orphan braces', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    arbitrary_simple_code,
                    (numBraces, baseCode) => {
                        // Create document with N orphan braces on separate lines
                        const lines = baseCode.split('\n');
                        const document_lines: string[] = [];
                        
                        // Interleave base code lines with orphan braces
                        for (let i = 0; i < numBraces; i++) {
                            if (i < lines.length) {
                                document_lines.push(lines[i]);
                            }
                            document_lines.push('}'); // Orphan brace on its own line
                        }
                        
                        // Add remaining base code lines
                        for (let i = numBraces; i < lines.length; i++) {
                            document_lines.push(lines[i]);
                        }
                        
                        const document = document_lines.join('\n');
                        const result = parse_document(document);
                        
                        const orphan_count = count_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                        return orphan_count === numBraces;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should report correct line numbers for multiple orphan braces', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2, max: 4 }),
                    arbitrary_simple_code,
                    (numBraces, baseCode) => {
                        // Create document with orphan braces at predictable positions
                        const lines = baseCode.split('\n');
                        const document_lines: string[] = [];
                        const expected_brace_lines: number[] = [];
                        
                        // Add base code and orphan braces
                        for (let i = 0; i < numBraces; i++) {
                            if (i < lines.length) {
                                document_lines.push(lines[i]);
                            }
                            expected_brace_lines.push(document_lines.length); // 0-indexed line number
                            document_lines.push('}'); // Orphan brace
                        }
                        
                        const document = document_lines.join('\n');
                        const result = parse_document(document);
                        
                        const orphan_errors = result.errors.filter(e => e.code === ParseErrorCode.ORPHAN_CLOSE_BRACE);
                        const actual_lines = orphan_errors.map(e => e.range.start.line).sort((a, b) => a - b);
                        const expected_lines = expected_brace_lines.sort((a, b) => a - b);
                        
                        return JSON.stringify(actual_lines) === JSON.stringify(expected_lines);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should handle orphan braces mixed with valid blocks', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 3 }),
                    arbitrary_valid_block,
                    (numOrphanBraces, validBlock) => {
                        // Create document with valid block and orphan braces
                        const document_lines = [
                            validBlock,
                            ...Array(numOrphanBraces).fill('}') // Add orphan braces
                        ];
                        
                        const document = document_lines.join('\n');
                        const result = parse_document(document);
                        
                        // Should have exactly numOrphanBraces ORPHAN_CLOSE_BRACE errors
                        const orphan_count = count_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                        return orphan_count === numOrphanBraces;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle single orphan brace correctly', () => {
            fc.assert(
                fc.property(arbitrary_simple_code, (baseCode) => {
                    const document = baseCode + '\n}';
                    const result = parse_document(document);
                    
                    const orphan_count = count_error_code(result.errors, ParseErrorCode.ORPHAN_CLOSE_BRACE);
                    return orphan_count === 1;
                }),
                { numRuns: 100 }
            );
        });
    });
});
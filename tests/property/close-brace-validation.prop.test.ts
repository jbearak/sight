/**
 * Brace Validation Property Tests
 *
 * Tests that verify the parser correctly detects brace placement violations
 * according to Stata's strict brace placement rules.
 *
 * Feature: close-brace-diagnostic
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer, StataParser } from '../../src/index';
import { ParseErrorCode } from '../../src/types';

/**
 * Helper to parse a document and get parse errors
 */
function parse_document(source: string): { errors: Array<{ code: ParseErrorCode; message: string }> } {
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
 * Generator for simple command names
 */
const arbitrary_command = fc.constantFrom('display', 'gen', 'sum', 'reg', 'list', 'describe');

describe('Close Brace Validation Property Tests', () => {
    /**
     * Property 1: Close Brace Not Alone Detection
     * For any Stata document containing a closing brace `}` with non-trivia tokens
     * on the same line (either before or after the brace), the parser SHALL emit
     * a diagnostic with code BRACE_NOT_ALONE (3002).
     *
     * Feature: close-brace-diagnostic, Property 1: Close Brace Not Alone Detection
     * **Validates: Requirements 1.1, 2.1**
     */
    describe('Property 1: Close Brace Not Alone Detection', () => {
        it('should detect code AFTER close brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with code after close brace: } cmd2
                        const document = `if 1 > 0 {\n    ${cmd1}\n} ${cmd2}`;
                        const { errors } = parse_document(document);

                        // Should have BRACE_NOT_ALONE error
                        return has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect code BEFORE close brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with code before close brace: cmd2 }
                        const document = `if 1 > 0 {\n    ${cmd1}\n    ${cmd2} }`;
                        const { errors } = parse_document(document);

                        // Should have BRACE_NOT_ALONE error
                        return has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Valid Close Brace Placement
     * For any Stata document containing a closing brace `}` that is alone on its
     * line (only whitespace/comments before and after), the parser SHALL NOT emit
     * a BRACE_NOT_ALONE diagnostic.
     *
     * Feature: close-brace-diagnostic, Property 2: Valid Close Brace Placement
     * **Validates: Requirements 1.2, 1.3, 2.2**
     */
    describe('Property 2: Valid Close Brace Placement', () => {
        it('should NOT emit BRACE_NOT_ALONE for properly placed close brace', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with properly placed close brace
                        const document = `if 1 > 0 {\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have BRACE_NOT_ALONE error
                        return !has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit BRACE_NOT_ALONE for close brace with only whitespace', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    fc.integer({ min: 0, max: 4 }),
                    (cmd, indent) => {
                        // Create document with close brace preceded by whitespace only
                        const spaces = ' '.repeat(indent);
                        const document = `if 1 > 0 {\n    ${cmd}\n${spaces}}`;
                        const { errors } = parse_document(document);

                        // Should NOT have BRACE_NOT_ALONE error
                        return !has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit BRACE_NOT_ALONE for close brace followed by comment', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with close brace followed by comment
                        const document = `if 1 > 0 {\n    ${cmd}\n} // end of block`;
                        const { errors } = parse_document(document);

                        // Should NOT have BRACE_NOT_ALONE error
                        return !has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Else Same Line Detection
     * For any Stata document containing `} else` on the same line, the parser
     * SHALL emit a diagnostic with code BRACE_ELSE_SAME_LINE (3001).
     *
     * Feature: close-brace-diagnostic, Property 3: Else Same Line Detection
     * **Validates: Requirements 3.1**
     */
    describe('Property 3: Else Same Line Detection', () => {
        it('should detect } else on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with } else on same line
                        const document = `if 1 > 0 {\n    ${cmd1}\n} else {\n    ${cmd2}\n}`;
                        const { errors } = parse_document(document);

                        // Should have BRACE_ELSE_SAME_LINE error
                        return has_error_code(errors, ParseErrorCode.BRACE_ELSE_SAME_LINE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect } else { on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with } else { all on same line
                        const document = `if 1 > 0 {\n    ${cmd1}\n} else {\n    ${cmd2}\n}`;
                        const { errors } = parse_document(document);

                        // Should have BRACE_ELSE_SAME_LINE error
                        return has_error_code(errors, ParseErrorCode.BRACE_ELSE_SAME_LINE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Valid Else Placement
     * For any Stata document containing `}` on one line and `else` on the following
     * line, the parser SHALL NOT emit a BRACE_ELSE_SAME_LINE diagnostic.
     *
     * Feature: close-brace-diagnostic, Property 4: Valid Else Placement
     * **Validates: Requirements 3.2**
     */
    describe('Property 4: Valid Else Placement', () => {
        it('should NOT emit BRACE_ELSE_SAME_LINE for else on separate line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with else on separate line
                        const document = `if 1 > 0 {\n    ${cmd1}\n}\nelse {\n    ${cmd2}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have BRACE_ELSE_SAME_LINE error
                        return !has_error_code(errors, ParseErrorCode.BRACE_ELSE_SAME_LINE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 5: Open Brace Alone Detection
     * For any Stata document containing an opening brace `{` that is alone on its
     * line (not on the same line as a condition), the parser SHALL emit a diagnostic
     * with code OPEN_BRACE_ALONE.
     *
     * Feature: close-brace-diagnostic, Property 5: Open Brace Alone Detection
     * **Validates: Requirements 4.1**
     */
    describe('Property 5: Open Brace Alone Detection', () => {
        it('should detect open brace alone on its own line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with open brace alone on its line
                        // This is invalid in Stata: if (condition)\n{
                        const document = `if 1 > 0\n{\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should have OPEN_BRACE_ALONE error
                        return has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect open brace alone with leading whitespace', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    fc.integer({ min: 1, max: 4 }),
                    (cmd, indent) => {
                        // Create document with open brace alone on its line with leading whitespace
                        const spaces = ' '.repeat(indent);
                        const document = `if 1 > 0\n${spaces}{\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should have OPEN_BRACE_ALONE error
                        return has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 6: Valid Open Brace Placement
     * For any Stata document containing an opening brace `{` on the same line as
     * the condition (e.g., `if (1 == 1) {`), the parser SHALL NOT emit an
     * OPEN_BRACE_ALONE diagnostic.
     *
     * Feature: close-brace-diagnostic, Property 6: Valid Open Brace Placement
     * **Validates: Requirements 4.2**
     */
    describe('Property 6: Valid Open Brace Placement', () => {
        it('should NOT emit OPEN_BRACE_ALONE for brace on same line as condition', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with open brace on same line as condition
                        const document = `if 1 > 0 {\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have OPEN_BRACE_ALONE error
                        return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit OPEN_BRACE_ALONE for foreach with brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with foreach and brace on same line
                        const document = `foreach x in 1 2 3 {\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have OPEN_BRACE_ALONE error
                        return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit OPEN_BRACE_ALONE for while with brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with while and brace on same line
                        const document = `while 1 > 0 {\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have OPEN_BRACE_ALONE error
                        return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 7: Code After Open Brace Detection
     * For any Stata document containing an opening brace `{` followed by non-trivia
     * tokens on the same line, the parser SHALL emit a warning diagnostic with code
     * CODE_AFTER_OPEN_BRACE.
     *
     * Feature: close-brace-diagnostic, Property 7: Code After Open Brace Detection
     * **Validates: Requirements 5.1, 5.4**
     */
    describe('Property 7: Code After Open Brace Detection', () => {
        it('should detect code after open brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with code after open brace: { cmd1
                        // This is problematic in Stata - code is silently ignored
                        const document = `if 1 > 0 { ${cmd1}\n    ${cmd2}\n}`;
                        const { errors } = parse_document(document);

                        // Should have CODE_AFTER_OPEN_BRACE error
                        return has_error_code(errors, ParseErrorCode.CODE_AFTER_OPEN_BRACE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect code immediately after open brace', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with code immediately after open brace: {cmd
                        const document = `if 1 > 0 {${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should have CODE_AFTER_OPEN_BRACE error
                        return has_error_code(errors, ParseErrorCode.CODE_AFTER_OPEN_BRACE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit CODE_AFTER_OPEN_BRACE for brace followed only by newline', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with open brace followed by newline only
                        const document = `if 1 > 0 {\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have CODE_AFTER_OPEN_BRACE error
                        return !has_error_code(errors, ParseErrorCode.CODE_AFTER_OPEN_BRACE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit CODE_AFTER_OPEN_BRACE for brace followed by comment', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with open brace followed by comment
                        const document = `if 1 > 0 { // start of block\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have CODE_AFTER_OPEN_BRACE error
                        return !has_error_code(errors, ParseErrorCode.CODE_AFTER_OPEN_BRACE);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 8: Diagnostic Range Accuracy
     * For any brace placement diagnostic, the range SHALL accurately span the relevant tokens:
     * - For code after close brace: from `}` to end of offending code
     * - For code before close brace: from start of offending code to `}`
     * - For `} else`: from `}` to `else`
     * - For open brace alone: the `{` token
     * - For code after open brace: from `{` to end of offending code
     *
     * Feature: close-brace-diagnostic, Property 8: Diagnostic Range Accuracy
     * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**
     */
    describe('Property 8: Diagnostic Range Accuracy', () => {
        it('should have accurate range for code AFTER close brace (from } to end of code)', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with code after close brace: } cmd2
                        const document = `if 1 > 0 {\n    ${cmd1}\n} ${cmd2}`;
                        const { errors } = parse_document(document);

                        // Find the BRACE_NOT_ALONE error
                        const brace_error = errors.find(e => e.code === ParseErrorCode.BRACE_NOT_ALONE);
                        if (!brace_error) {
                            return false;
                        }

                        // The range should start at the close brace (line 2, column 0)
                        // and end at the end of cmd2
                        const range = brace_error.range;

                        // Range should be on line 2 (0-indexed)
                        if (range.start.line !== 2) {
                            return false;
                        }

                        // Range should start at column 0 (the close brace)
                        if (range.start.character !== 0) {
                            return false;
                        }

                        // Range should end on the same line (not extend beyond)
                        if (range.end.line !== 2) {
                            return false;
                        }

                        // Range should end after the command (at least past the brace)
                        // The end character should be at least 2 (} + space + at least 1 char of cmd2)
                        if (range.end.character < 2 + cmd2.length) {
                            return false;
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have accurate range for code BEFORE close brace (from code start to })', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with code before close brace: cmd2 }
                        const document = `if 1 > 0 {\n    ${cmd1}\n    ${cmd2} }`;
                        const { errors } = parse_document(document);

                        // Find the BRACE_NOT_ALONE error
                        const brace_error = errors.find(e => e.code === ParseErrorCode.BRACE_NOT_ALONE);
                        if (!brace_error) {
                            return false;
                        }

                        const range = brace_error.range;

                        // Range should be on line 2 (0-indexed)
                        if (range.start.line !== 2) {
                            return false;
                        }

                        // Range should start at the beginning of cmd2 (after 4 spaces of indentation)
                        if (range.start.character !== 4) {
                            return false;
                        }

                        // Range should end on the same line
                        if (range.end.line !== 2) {
                            return false;
                        }

                        // Range should end at the close brace (4 + cmd2.length + 1 space + 1 for brace)
                        const expected_end = 4 + cmd2.length + 1 + 1;
                        if (range.end.character !== expected_end) {
                            return false;
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have accurate range for } else on same line (from } to else)', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with } else on same line
                        const document = `if 1 > 0 {\n    ${cmd1}\n} else {\n    ${cmd2}\n}`;
                        const { errors } = parse_document(document);

                        // Find the BRACE_ELSE_SAME_LINE error
                        const else_error = errors.find(e => e.code === ParseErrorCode.BRACE_ELSE_SAME_LINE);
                        if (!else_error) {
                            return false;
                        }

                        const range = else_error.range;

                        // Range should be on line 2 (0-indexed)
                        if (range.start.line !== 2) {
                            return false;
                        }

                        // Range should start at column 0 (the close brace)
                        if (range.start.character !== 0) {
                            return false;
                        }

                        // Range should end on the same line
                        if (range.end.line !== 2) {
                            return false;
                        }

                        // Range should end after "else" (} + space + else = 0 + 1 + 4 = 6)
                        // The end character should be at position 6 (after "} else")
                        if (range.end.character !== 6) {
                            return false;
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have accurate range for open brace alone (just the { token)', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    (cmd) => {
                        // Create document with open brace alone on its line
                        const document = `if 1 > 0\n{\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Find the OPEN_BRACE_ALONE error
                        const brace_error = errors.find(e => e.code === ParseErrorCode.OPEN_BRACE_ALONE);
                        if (!brace_error) {
                            return false;
                        }

                        const range = brace_error.range;

                        // Range should be on line 1 (0-indexed, the line with just {)
                        if (range.start.line !== 1) {
                            return false;
                        }

                        // Range should start at column 0 (the open brace)
                        if (range.start.character !== 0) {
                            return false;
                        }

                        // Range should end on the same line
                        if (range.end.line !== 1) {
                            return false;
                        }

                        // Range should span just the brace (1 character)
                        if (range.end.character !== 1) {
                            return false;
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have accurate range for code after open brace (from { to end of code)', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2) => {
                        // Create document with code after open brace: { cmd1
                        const document = `if 1 > 0 { ${cmd1}\n    ${cmd2}\n}`;
                        const { errors } = parse_document(document);

                        // Find the CODE_AFTER_OPEN_BRACE error
                        const brace_error = errors.find(e => e.code === ParseErrorCode.CODE_AFTER_OPEN_BRACE);
                        if (!brace_error) {
                            return false;
                        }

                        const range = brace_error.range;

                        // Range should be on line 0 (the first line)
                        if (range.start.line !== 0) {
                            return false;
                        }

                        // Range should start at the open brace position
                        // "if 1 > 0 {" - the { is at position 9
                        if (range.start.character !== 9) {
                            return false;
                        }

                        // Range should end on the same line
                        if (range.end.line !== 0) {
                            return false;
                        }

                        // Range should end at the end of cmd1
                        // "if 1 > 0 { cmd1" - end should be at 9 + 1 + 1 + cmd1.length = 11 + cmd1.length
                        const expected_end = 9 + 1 + 1 + cmd1.length;
                        if (range.end.character !== expected_end) {
                            return false;
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT extend diagnostic range beyond the current line', () => {
            fc.assert(
                fc.property(
                    arbitrary_command,
                    arbitrary_command,
                    arbitrary_command,
                    (cmd1, cmd2, cmd3) => {
                        // Create document with code after close brace followed by more lines
                        const document = `if 1 > 0 {\n    ${cmd1}\n} ${cmd2}\n${cmd3}`;
                        const { errors } = parse_document(document);

                        // Find the BRACE_NOT_ALONE error
                        const brace_error = errors.find(e => e.code === ParseErrorCode.BRACE_NOT_ALONE);
                        if (!brace_error) {
                            return false;
                        }

                        const range = brace_error.range;

                        // Range should start and end on line 2 (the line with } cmd2)
                        if (range.start.line !== 2 || range.end.line !== 2) {
                            return false;
                        }

                        // Range should NOT extend to line 3 (where cmd3 is)
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Continuation handling: `find_code_before_on_same_line` follows a
     * `///` continuation across the swallowed '\n' terminator (see
     * is_swallowed_continuation_terminator), joining the physical lines
     * into one logical line for brace placement checks.
     *
     * These lock the continuation-crossing contract the stricter
     * value-checked predicate must preserve. They cannot differentiate
     * the predicate from a value-agnostic check: the divergent state (a
     * non-'\n' terminator directly after a CONTINUATION) is unreachable
     * from the lexer, which is why the predicate swap is behavior-
     * preserving (issue #281).
     */
    describe('Brace placement across /// continuations', () => {
        it('does not flag OPEN_BRACE_ALONE when the condition continues via ///', () => {
            fc.assert(
                fc.property(arbitrary_command, (cmd1) => {
                    const document = `if 1 > 0 ///\n{\n    ${cmd1}\n}`;
                    const { errors } = parse_document(document);

                    return !has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);
                }),
                { numRuns: 100 }
            );
        });

        it('flags BRACE_NOT_ALONE for a close brace joined to code via ///', () => {
            fc.assert(
                fc.property(arbitrary_command, (cmd1) => {
                    const document = `if 1 > 0 {\n    ${cmd1} ///\n}`;
                    const { errors } = parse_document(document);

                    return has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                }),
                { numRuns: 100 }
            );
        });

        it('flags CODE_AFTER_OPEN_BRACE for code joined to an open brace via ///', () => {
            // `{ ///` joins the next physical line, so the code there is
            // logically on the brace line and Stata silently ignores it —
            // the same warning as the single-line `if 1 > 0 { display`.
            fc.assert(
                fc.property(arbitrary_command, (cmd1) => {
                    const document = `if 1 > 0 { ///\n ${cmd1}\n}`;
                    const { errors } = parse_document(document);

                    return has_error_code(errors, ParseErrorCode.CODE_AFTER_OPEN_BRACE);
                }),
                { numRuns: 100 }
            );
        });

        it('flags BRACE_ELSE_SAME_LINE for `else` joined to a close brace via ///', () => {
            fc.assert(
                fc.property(arbitrary_command, (cmd1) => {
                    const document = `if 1 > 0 {\n    ${cmd1}\n} ///\nelse {\n    ${cmd1}\n}`;
                    const { errors } = parse_document(document);

                    return has_error_code(errors, ParseErrorCode.BRACE_ELSE_SAME_LINE);
                }),
                { numRuns: 100 }
            );
        });
    });
});

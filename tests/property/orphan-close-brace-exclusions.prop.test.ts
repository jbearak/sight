/**
 * Orphan Close Brace Exclusion Property Tests
 *
 * Tests that verify Properties 4-6 from tasks 6.1-6.3: exclusion cases where
 * ORPHAN_CLOSE_BRACE diagnostic should NOT be emitted for } characters that
 * appear in macro references, embedded language blocks, or string literals.
 *
 * Feature: orphan-close-brace-detection
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer, StataParser } from '../../src/index';
import { ParseErrorCode } from '../../src/types';
import { arbitrary_macro_name, arbitrary_command_name, arbitrary_string_literal } from './generators/primitives';

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
 * Helper to check if ORPHAN_CLOSE_BRACE error is present
 */
function has_orphan_close_brace_error(errors: Array<{ code: ParseErrorCode }>): boolean {
    return errors.some(e => e.code === ParseErrorCode.ORPHAN_CLOSE_BRACE);
}

describe('Orphan Close Brace Exclusion Property Tests', () => {
    /**
     * Property 4: Macro Brace Exclusion
     * For any Stata document containing ${name} macro references, the parser
     * SHALL NOT emit an ORPHAN_CLOSE_BRACE diagnostic for the } character
     * within the macro reference.
     *
     * Feature: orphan-close-brace-detection, Property 4: Macro Brace Exclusion
     * **Validates: Requirements 4.1, 4.2**
     */
    describe('Property 4: Macro Brace Exclusion', () => {
        it('should NOT emit ORPHAN_CLOSE_BRACE for } in ${name} macro references', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    arbitrary_command_name(),
                    (macroName, command) => {
                        // Create document with ${name} macro reference
                        const document = `${command} \${${macroName}}`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in multiple ${name} macro references', () => {
            fc.assert(
                fc.property(
                    fc.array(arbitrary_macro_name(), { minLength: 2, maxLength: 4 }),
                    arbitrary_command_name(),
                    (macroNames, command) => {
                        // Create document with multiple ${name} macro references
                        const macroRefs = macroNames.map(name => `\${${name}}`).join(' ');
                        const document = `${command} ${macroRefs}`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in nested ${name} contexts', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    arbitrary_macro_name(),
                    arbitrary_command_name(),
                    (outerMacro, innerMacro, command) => {
                        // Create document with nested macro context (though not valid Stata, lexer should handle)
                        const document = `${command} "\${${outerMacro}} and \${${innerMacro}}"`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 5: Embedded Language Exclusion
     * For any Stata document containing Mata or Python blocks with } characters
     * inside the embedded content, the parser SHALL NOT emit an ORPHAN_CLOSE_BRACE
     * diagnostic for those } characters.
     *
     * Feature: orphan-close-brace-detection, Property 5: Embedded Language Exclusion
     * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
     */
    describe('Property 5: Embedded Language Exclusion', () => {
        it('should NOT emit ORPHAN_CLOSE_BRACE for } in Mata blocks', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/(){}[\];,.<>!&|]*$/),
                    (mataContent) => {
                        // Ensure content contains at least one }
                        const contentWithBrace = mataContent + ' }';
                        
                        // Create document with Mata block containing }
                        const document = `mata\n${contentWithBrace}\nend`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in Python blocks', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/(){}[\];,.<>!&|:]*$/),
                    (pythonContent) => {
                        // Ensure content contains at least one }
                        const contentWithBrace = pythonContent + ' }';
                        
                        // Create document with Python block containing }
                        const document = `python\n${contentWithBrace}\nend python`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in single-line Mata blocks', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|]*$/),
                    (mataContent) => {
                        // Create document with single-line Mata block containing }
                        const document = `mata: ${mataContent} }`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in single-line Python blocks', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|:]*$/),
                    (pythonContent) => {
                        // Create document with single-line Python block containing }
                        const document = `python: ${pythonContent} }`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in brace-style Mata blocks', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|]+$/),
                    (mataContent) => {
                        // Ensure we have non-empty content
                        if (mataContent.trim() === '') {
                            return true; // Skip empty content
                        }
                        
                        // Create document with brace-style Mata block containing } inside the content
                        // The } inside the mata block should not trigger ORPHAN_CLOSE_BRACE
                        const document = `mata {\n  x = ${mataContent};\n  if (1) { y = 2; }\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error for the } inside the block
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 6: String Literal Exclusion
     * For any Stata document containing string literals with } characters inside
     * the string content, the parser SHALL NOT emit an ORPHAN_CLOSE_BRACE
     * diagnostic for those } characters.
     *
     * Feature: orphan-close-brace-detection, Property 6: String Literal Exclusion
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('Property 6: String Literal Exclusion', () => {
        it('should NOT emit ORPHAN_CLOSE_BRACE for } in simple string literals', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|]*$/),
                    arbitrary_command_name(),
                    (stringContent, command) => {
                        // Create document with simple string containing }
                        const document = `${command} "${stringContent} }"`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in compound string literals', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|]*$/),
                    arbitrary_command_name(),
                    (stringContent, command) => {
                        // Create document with compound string containing }
                        const document = `${command} \`"${stringContent} }"\``;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in multiple string literals', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|]*$/), { minLength: 2, maxLength: 4 }),
                    arbitrary_command_name(),
                    (stringContents, command) => {
                        // Create document with multiple strings containing }
                        const strings = stringContents.map(content => `"${content} }"`).join(' ');
                        const document = `${command} ${strings}`;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit ORPHAN_CLOSE_BRACE for } in strings with mixed quote styles', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|]*$/),
                    fc.stringMatching(/^[a-zA-Z0-9 _=+\-*/()[\];,.<>!&|]*$/),
                    arbitrary_command_name(),
                    (simpleContent, compoundContent, command) => {
                        // Create document with both simple and compound strings containing }
                        const document = `${command} "${simpleContent} }" \`"${compoundContent} }"\``;
                        const { errors } = parse_document(document);

                        // Should NOT have ORPHAN_CLOSE_BRACE error
                        return !has_orphan_close_brace_error(errors);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
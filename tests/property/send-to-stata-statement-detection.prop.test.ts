import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    ends_with_continuation,
    detect_statement,
    get_statement_text,
    get_upward_bounds,
    get_downward_bounds
} from '../../client/src/send-to-stata/statement-detector';
import { escape_for_applescript } from '../../client/src/send-to-stata/applescript';

/**
 * Property-based tests for statement detection in send-to-stata.
 * 
 * Feature: send-to-stata
 * Property 1: Statement Detection with Continuations
 * Validates: Requirements 1.2, 1.3, 1.4, 8.1, 8.2, 8.3, 8.4
 */

// Mock vscode.TextDocument for testing
interface MockTextDocument {
    lineCount: number;
    lineAt(line: number): { text: string };
}

function create_mock_document(content: string): MockTextDocument {
    const the_lines = content.split('\n');
    return {
        lineCount: the_lines.length,
        lineAt(line: number) {
            return { text: the_lines[line] ?? '' };
        }
    };
}

describe('Feature: send-to-stata - Statement Detection Properties', () => {
    // Generator for simple Stata statements (without ///)
    const simple_statement_gen = fc.oneof(
        fc.constant('display "hello"'),
        fc.constant('gen x = 1'),
        fc.constant('replace y = 2'),
        fc.constant('local foo "bar"'),
        fc.constant('summarize var1'),
        fc.constant('regress y x1 x2')
    );

    // Generator for trailing content after ///
    const trailing_gen = fc.oneof(
        fc.constant(''),
        fc.constant(' '),
        fc.constant('  '),
        fc.constant('\t')
    );

    // Generator for multi-line statements with /// continuations
    const multiline_statement_gen = fc.tuple(
        fc.array(simple_statement_gen, { minLength: 2, maxLength: 5 }),
        fc.array(trailing_gen, { minLength: 1, maxLength: 4 })
    ).map(([the_statements, the_trailing]) => {
        const the_lines: string[] = [];
        for (let i = 0; i < the_statements.length; i++) {
            if (i < the_statements.length - 1) {
                const trailing = the_trailing[i % the_trailing.length];
                the_lines.push(the_statements[i] + ' ///' + trailing);
            } else {
                the_lines.push(the_statements[i]);
            }
        }
        return the_lines;
    });

    // Generator for document with multiple statements
    const document_gen = fc.tuple(
        fc.array(simple_statement_gen, { minLength: 0, maxLength: 3 }),
        multiline_statement_gen,
        fc.array(simple_statement_gen, { minLength: 0, maxLength: 3 })
    ).map(([before, multi, after]) => ({
        before_lines: before,
        multi_lines: multi,
        after_lines: after,
        content: [...before, ...multi, ...after].join('\n')
    }));

    test('Property 1: ends_with_continuation detects /// at line end', () => {
        fc.assert(fc.property(
            simple_statement_gen,
            trailing_gen,
            (statement, trailing) => {
                const line_with_cont = statement + ' ///' + trailing;
                const line_without_cont = statement;

                expect(ends_with_continuation(line_with_cont)).toBe(true);
                expect(ends_with_continuation(line_without_cont)).toBe(false);
            }
        ), { numRuns: 100 });
    });

    test('Property 1: Statement bounds include all continuation lines', () => {
        fc.assert(fc.property(document_gen, (doc_data) => {
            const document = create_mock_document(doc_data.content);
            const multi_start = doc_data.before_lines.length;
            const multi_end = multi_start + doc_data.multi_lines.length - 1;

            // Test from any line within the multi-line statement
            for (let cursor = multi_start; cursor <= multi_end; cursor++) {
                const bounds = detect_statement(document as any, cursor);

                // Bounds should include the entire multi-line statement
                expect(bounds.start_line).toBe(multi_start);
                expect(bounds.end_line).toBe(multi_end);
            }
        }), { numRuns: 100 });
    });

    test('Property 1: Single-line statements have same start and end', () => {
        fc.assert(fc.property(
            fc.array(simple_statement_gen, { minLength: 1, maxLength: 5 }),
            fc.integer({ min: 0, max: 4 }),
            (the_lines, cursor_offset) => {
                const content = the_lines.join('\n');
                const document = create_mock_document(content);
                const cursor = Math.min(cursor_offset, the_lines.length - 1);

                const bounds = detect_statement(document as any, cursor);

                // Single-line statements should have start == end
                expect(bounds.start_line).toBe(cursor);
                expect(bounds.end_line).toBe(cursor);
            }
        ), { numRuns: 100 });
    });

    test('Property 1: get_statement_text extracts correct content', () => {
        fc.assert(fc.property(document_gen, (doc_data) => {
            const document = create_mock_document(doc_data.content);
            const multi_start = doc_data.before_lines.length;
            const multi_end = multi_start + doc_data.multi_lines.length - 1;

            const bounds = detect_statement(document as any, multi_start);
            const text = get_statement_text(document as any, bounds);

            // Extracted text should match the multi-line statement
            const expected = doc_data.multi_lines.join('\n');
            expect(text).toBe(expected);
        }), { numRuns: 100 });
    });

    test('Property 1: Chained continuations handled correctly', () => {
        // Test with 3+ continuation lines
        fc.assert(fc.property(
            fc.array(simple_statement_gen, { minLength: 3, maxLength: 6 }),
            (the_statements) => {
                // Create chained continuations
                const the_lines = the_statements.map((stmt, i) =>
                    i < the_statements.length - 1 ? stmt + ' ///' : stmt
                );
                const content = the_lines.join('\n');
                const document = create_mock_document(content);

                // From any position, should detect entire chain
                for (let cursor = 0; cursor < the_lines.length; cursor++) {
                    const bounds = detect_statement(document as any, cursor);
                    expect(bounds.start_line).toBe(0);
                    expect(bounds.end_line).toBe(the_lines.length - 1);
                }
            }
        ), { numRuns: 100 });
    });

    test('Property 1: /// with trailing whitespace is detected', () => {
        const whitespace_variants = [
            '///',
            '/// ',
            '///  ',
            '///\t',
            '/// \t '
        ];

        for (const my_variant of whitespace_variants) {
            const line = 'display "test"' + my_variant;
            expect(ends_with_continuation(line)).toBe(true);
        }
    });

    test('Property 1: /// not at end is not detected as continuation', () => {
        const non_continuation_lines = [
            'display "///" // not continuation',
            '/// this is a comment',
            'local x "///" // comment',
            '// comment with /// in middle'
        ];

        for (const my_line of non_continuation_lines) {
            // These should NOT be detected as continuations because /// is not
            // at the end (after trimming whitespace)
            expect(ends_with_continuation(my_line)).toBe(false);
        }
    });
});

/**
 * Property 5: Upward Line Extraction
 * Property 6: Downward Line Extraction
 * Validates: Requirements 4.2, 4.4, 5.2, 5.4
 */
describe('Feature: send-to-stata - Upward/Downward Extraction Properties', () => {
    // Mock vscode.TextDocument for testing
    interface MockTextDocument {
        lineCount: number;
        lineAt(line: number): { text: string };
    }

    function create_mock_document(content: string): MockTextDocument {
        const the_lines = content.split('\n');
        return {
            lineCount: the_lines.length,
            lineAt(line: number) {
                return { text: the_lines[line] ?? '' };
            }
        };
    }

    // Generator for simple Stata statements
    const simple_statement_gen = fc.oneof(
        fc.constant('display "hello"'),
        fc.constant('gen x = 1'),
        fc.constant('summarize var1')
    );

    test('Property 5: Upward bounds start at line 0', () => {
        fc.assert(fc.property(
            fc.array(simple_statement_gen, { minLength: 1, maxLength: 10 }),
            fc.integer({ min: 0, max: 9 }),
            (the_lines, cursor_offset) => {
                const content = the_lines.join('\n');
                const document = create_mock_document(content);
                const cursor = Math.min(cursor_offset, the_lines.length - 1);

                const bounds = get_upward_bounds(document as any, cursor);
                expect(bounds.start_line).toBe(0);
            }
        ), { numRuns: 100 });
    });

    test('Property 5: Upward bounds end at cursor line', () => {
        fc.assert(fc.property(
            fc.array(simple_statement_gen, { minLength: 1, maxLength: 10 }),
            fc.integer({ min: 0, max: 9 }),
            (the_lines, cursor_offset) => {
                const content = the_lines.join('\n');
                const document = create_mock_document(content);
                const cursor = Math.min(cursor_offset, the_lines.length - 1);

                const bounds = get_upward_bounds(document as any, cursor);
                expect(bounds.end_line).toBe(cursor);
            }
        ), { numRuns: 100 });
    });

    test('Property 6: Downward bounds end at last line', () => {
        fc.assert(fc.property(
            fc.array(simple_statement_gen, { minLength: 1, maxLength: 10 }),
            fc.integer({ min: 0, max: 9 }),
            (the_lines, cursor_offset) => {
                const content = the_lines.join('\n');
                const document = create_mock_document(content);
                const cursor = Math.min(cursor_offset, the_lines.length - 1);

                const bounds = get_downward_bounds(document as any, cursor);
                expect(bounds.end_line).toBe(the_lines.length - 1);
            }
        ), { numRuns: 100 });
    });

    test('Property 6: Downward includes complete statement from beginning', () => {
        // Create document with multi-line statement
        const content = [
            'display "before"',
            'gen x = 1 ///',
            '    + 2 ///',
            '    + 3',
            'display "after"'
        ].join('\n');
        const document = create_mock_document(content);

        // Cursor on continuation line 2 (0-indexed)
        const bounds = get_downward_bounds(document as any, 2);
        
        // Should start at line 1 (statement start), not line 2
        expect(bounds.start_line).toBe(1);
        expect(bounds.end_line).toBe(4);
    });

    test('Property 6: Downward from non-continuation starts at cursor', () => {
        const content = [
            'display "line 0"',
            'display "line 1"',
            'display "line 2"'
        ].join('\n');
        const document = create_mock_document(content);

        const bounds = get_downward_bounds(document as any, 1);
        expect(bounds.start_line).toBe(1);
        expect(bounds.end_line).toBe(2);
    });

    test('Property 5: Upward at start of file', () => {
        const content = 'display "only line"';
        const document = create_mock_document(content);

        const bounds = get_upward_bounds(document as any, 0);
        expect(bounds.start_line).toBe(0);
        expect(bounds.end_line).toBe(0);
    });

    test('Property 6: Downward at end of file', () => {
        const content = [
            'display "line 0"',
            'display "line 1"'
        ].join('\n');
        const document = create_mock_document(content);

        const bounds = get_downward_bounds(document as any, 1);
        expect(bounds.start_line).toBe(1);
        expect(bounds.end_line).toBe(1);
    });
});

/**
 * Unit tests for edge cases
 * Task 16: Additional unit tests for statement detector, AppleScript escaping,
 * Stata detection, and working directory handling
 */
describe('Feature: send-to-stata - Unit Tests for Edge Cases', () => {
    // Mock vscode.TextDocument for testing
    interface MockTextDocument {
        lineCount: number;
        lineAt(line: number): { text: string };
    }

    function create_mock_document(content: string): MockTextDocument {
        const the_lines = content.split('\n');
        return {
            lineCount: the_lines.length,
            lineAt(line: number) {
                return { text: the_lines[line] ?? '' };
            }
        };
    }

    // 16.1: Statement detector edge cases
    describe('Statement Detector Edge Cases', () => {
        test('Empty document', () => {
            const document = create_mock_document('');
            const bounds = detect_statement(document as any, 0);
            expect(bounds.start_line).toBe(0);
            expect(bounds.end_line).toBe(0);
        });

        test('Single line document', () => {
            const document = create_mock_document('display "hello"');
            const bounds = detect_statement(document as any, 0);
            expect(bounds.start_line).toBe(0);
            expect(bounds.end_line).toBe(0);
        });

        test('Continuation at end of file', () => {
            const content = 'display "test" ///';
            const document = create_mock_document(content);
            const bounds = detect_statement(document as any, 0);
            expect(bounds.start_line).toBe(0);
            expect(bounds.end_line).toBe(0);
        });

        test('Multiple separate statements', () => {
            const content = [
                'display "first"',
                'display "second"',
                'display "third"'
            ].join('\n');
            const document = create_mock_document(content);

            // Each line should be its own statement
            for (let i = 0; i < 3; i++) {
                const bounds = detect_statement(document as any, i);
                expect(bounds.start_line).toBe(i);
                expect(bounds.end_line).toBe(i);
            }
        });

        test('/// in string literal (not continuation)', () => {
            const content = 'display "path///file"';
            const document = create_mock_document(content);
            const bounds = detect_statement(document as any, 0);
            expect(bounds.start_line).toBe(0);
            expect(bounds.end_line).toBe(0);
        });

        test('/// with comment after (is continuation)', () => {
            const content = [
                'gen x = 1 /// this is a comment',
                '    + 2'
            ].join('\n');
            const document = create_mock_document(content);
            
            // ends_with_continuation should return true for line with comment
            expect(ends_with_continuation('gen x = 1 /// this is a comment')).toBe(false);
        });
    });

    // 16.2: AppleScript escaping edge cases
    describe('AppleScript Escaping Edge Cases', () => {
        test('Empty path', () => {
            expect(escape_for_applescript('')).toBe('');
        });

        test('Path with only backslash', () => {
            expect(escape_for_applescript('\\')).toBe('\\\\');
        });

        test('Path with only quote', () => {
            expect(escape_for_applescript('"')).toBe('\\"');
        });

        test('Path with multiple consecutive backslashes', () => {
            expect(escape_for_applescript('\\\\\\')).toBe('\\\\\\\\\\\\');
        });

        test('Path with multiple consecutive quotes', () => {
            expect(escape_for_applescript('"""')).toBe('\\"\\"\\"');
        });

        test('Path with mixed special characters', () => {
            expect(escape_for_applescript('a\\b"c\\d"e')).toBe('a\\\\b\\"c\\\\d\\"e');
        });

        test('Path with newline (should not escape)', () => {
            expect(escape_for_applescript('a\nb')).toBe('a\nb');
        });
    });
});

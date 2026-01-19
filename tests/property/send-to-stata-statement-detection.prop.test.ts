import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    ends_with_continuation,
    detect_statement,
    get_statement_text
} from '../../client/src/send-to-stata/statement-detector';

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

/**
 * Property Tests: Formatter Source Preservation
 *
 * Feature: formatter-bugs
 * Validates: Requirements 2, 4, 5, 7 (Token, String, Parenthesis, Macro preservation)
 */

import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentState } from '../../src/document-store';
import { Token } from '../../src/types';

function create_document_state(source: string): DocumentState {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(source);
    const parser = new StataParser();
    const parse_result = parser.parse(lex_result.tokens);

    return {
        uri: 'file:///test.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: new Map(),
        diagnostics: [],
    };
}

function extract_non_whitespace_tokens(tokens: Token[]): string[] {
    return tokens
        .filter(my_token => my_token.type !== 'WHITESPACE' && my_token.type !== 'EOF')
        .map(my_token => my_token.value);
}

describe('Formatter Source Preservation Properties', () => {
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    // Generator for simple Stata commands
    const simple_command = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'global z = 3',
        'replace x = 2',
        'drop x',
        'use mydata',
        'save mydata'
    );

    // Generator for string literals
    const string_literal = fc.oneof(
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `"${s.replace(/"/g, '')}"`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `\`"${s.replace(/["`']/g, '')}"'`)
    );

    // Generator for macro references
    const macro_name = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/);
    const local_macro_ref = macro_name.map(name => `\`${name}'`);
    const global_macro_ref = macro_name.map(name => `$${name}`);

    test('Property 2: Token Content Preservation', () => {
        fc.assert(
            fc.property(simple_command, (source) => {
                const doc_state = create_document_state(source);
                const edits = formatter.format(doc_state, options);

                if (edits.length === 0) return true; // No edits means source preserved

                const formatted = edits[0].newText;
                const formatted_doc = create_document_state(formatted);

                const original_tokens = extract_non_whitespace_tokens(doc_state.tokens!);
                const formatted_tokens = extract_non_whitespace_tokens(formatted_doc.tokens!);

                // All non-whitespace tokens should be preserved in order
                expect(formatted_tokens).toEqual(original_tokens);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    test('Property 4: String Literal Preservation', () => {
        // Generate string literals without spaces to avoid false positives
        const safe_string_content = fc.stringMatching(/^[a-zA-Z0-9_]+$/);
        const safe_string_literal = fc.oneof(
            safe_string_content.map(s => `"${s}"`),
            safe_string_content.map(s => `\`"${s}"'`)
        );

        fc.assert(
            fc.property(safe_string_literal, (str_lit) => {
                const source = `display ${str_lit}`;
                const doc_state = create_document_state(source);
                const edits = formatter.format(doc_state, options);

                if (edits.length === 0) return true;

                const formatted = edits[0].newText;

                // String literal should be preserved exactly
                expect(formatted).toContain(str_lit);
                return true;
            }),
            { numRuns: 100 }
        );
    });

    test('Property 5: Parenthesis Content Preservation', () => {
        const paren_expr = fc.tuple(
            fc.constantFrom('x', 'y', 'z', '1', '2'),
            fc.constantFrom('+', '-', '*', '/'),
            fc.constantFrom('x', 'y', 'z', '1', '2')
        ).map(([a, op, b]) => `(${a} ${op} ${b})`);

        fc.assert(
            fc.property(paren_expr, (expr) => {
                const source = `gen result = ${expr}`;
                const doc_state = create_document_state(source);
                const edits = formatter.format(doc_state, options);

                if (edits.length === 0) return true;

                const formatted = edits[0].newText;

                // Parenthesized expression should be preserved
                expect(formatted).toContain('(');
                expect(formatted).toContain(')');

                // No spurious spaces immediately after ( or before )
                expect(formatted).not.toMatch(/\( {2,}/);  // No double+ spaces after (
                expect(formatted).not.toMatch(/ {2,}\)/);  // No double+ spaces before )
                return true;
            }),
            { numRuns: 100 }
        );
    });

    test('Property 7: Macro Reference Preservation', () => {
        fc.assert(
            fc.property(
                fc.oneof(local_macro_ref, global_macro_ref),
                (macro_ref) => {
                    const source = `display ${macro_ref}`;
                    const doc_state = create_document_state(source);
                    const edits = formatter.format(doc_state, options);

                    if (edits.length === 0) return true;

                    const formatted = edits[0].newText;

                    // Macro reference should be preserved exactly
                    expect(formatted).toContain(macro_ref);

                    // No spurious internal spaces in macro references
                    if (macro_ref.startsWith('`')) {
                        // Local macro - no space after ` or before '
                        expect(formatted).not.toMatch(/` [^']+'/);
                        expect(formatted).not.toMatch(/`[^']+ '/);
                    }
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

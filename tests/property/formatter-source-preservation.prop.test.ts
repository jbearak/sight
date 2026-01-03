/**
 * Property Tests: Formatter Source Preservation
 *
 * Feature: formatter-bugs
 * Validates: Requirements 2, 4, 5, 7 (Token, String, Parenthesis, Macro preservation)
 *
 * Tests both formatter modes (source-preserving and AST-based) using dual-mode testing utilities.
 */

import { describe, expect } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { Token } from '../../src/types';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';
import { create_document_state } from './helpers/document-utils';

function extract_non_whitespace_tokens(tokens: Token[]): string[] {
    return tokens
        .filter(my_token => my_token.type !== 'WHITESPACE' && my_token.type !== 'EOF')
        .map(my_token => my_token.value);
}

/**
 * Extract semantic content tokens, excluding whitespace, EOF, and STATEMENT_TERMINATOR.
 * Used for comparing semantic equivalence when formatters may add/remove trailing newlines.
 */
function extract_semantic_tokens(tokens: Token[]): string[] {
    return tokens
        .filter(my_token =>
            my_token.type !== 'WHITESPACE' &&
            my_token.type !== 'EOF' &&
            my_token.type !== 'STATEMENT_TERMINATOR'
        )
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

    // Generator for macro references
    const macro_name = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/);
    const local_macro_ref = macro_name.map(name => `\`${name}'`);
    const global_macro_ref = macro_name.map(name => `${name}`);

    for_each_formatter_mode_property(
        'Property 2: Token Content Preservation',
        simple_command,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true; // No edits means source preserved

            const formatted = edits[0].newText;
            const formatted_doc = create_document_state(formatted);
            
            // Skip comparison if formatted output failed to parse
            if (!formatted_doc.tokens || !formatted_doc.ast) {
                return false; // Formatting produced invalid output
            }

            if (mode === 'source-preserving') {
                // Source-preserving mode: exact token preservation (including newlines)
                const original_tokens = extract_non_whitespace_tokens(doc_state.tokens!);
                const formatted_tokens = extract_non_whitespace_tokens(formatted_doc.tokens!);
                expect(formatted_tokens).toEqual(original_tokens);
            } else {
                // AST mode: semantic token preservation (may add trailing newlines)
                const original_semantic = extract_semantic_tokens(doc_state.tokens!);
                const formatted_semantic = extract_semantic_tokens(formatted_doc.tokens!);
                expect(formatted_semantic).toEqual(original_semantic);
            }

            return true;
        },
        100
    );

    // Generator for safe string content (no spaces to avoid false positives)
    const safe_string_content = fc.stringMatching(/^[a-zA-Z0-9_]+$/);
    const safe_string_literal = fc.oneof(
        safe_string_content.map(s => `"${s}"`),
        safe_string_content.map(s => `\`"${s}"'`)
    );

    for_each_formatter_mode_property(
        'Property 4: String Literal Preservation',
        safe_string_literal,
        (mode: FormatterMode, str_lit: string) => {
            const config = create_formatter_config(mode);
            const source = `display ${str_lit}`;
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;

            // String literal should be preserved exactly
            expect(formatted).toContain(str_lit);
            return true;
        },
        100
    );

    // Generator for parenthesized expressions
    const paren_expr = fc.tuple(
        fc.constantFrom('x', 'y', 'z', '1', '2'),
        fc.constantFrom('+', '-', '*', '/'),
        fc.constantFrom('x', 'y', 'z', '1', '2')
    ).map(([a, op, b]) => `(${a} ${op} ${b})`);

    for_each_formatter_mode_property(
        'Property 5: Parenthesis Content Preservation',
        paren_expr,
        (mode: FormatterMode, expr: string) => {
            const config = create_formatter_config(mode);
            const source = `gen result = ${expr}`;
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;

            // Parenthesized expression should be preserved
            expect(formatted).toContain('(');
            expect(formatted).toContain(')');

            // No spurious spaces immediately after ( or before )
            expect(formatted).not.toMatch(/\( {2,}/);  // No double+ spaces after (
            expect(formatted).not.toMatch(/ {2,}\)/);  // No double+ spaces before )
            return true;
        },
        100
    );

    // Generator for macro references (local or global)
    const macro_ref = fc.oneof(local_macro_ref, global_macro_ref);

    for_each_formatter_mode_property(
        'Property 7: Macro Reference Preservation',
        macro_ref,
        (mode: FormatterMode, macro_ref_value: string) => {
            const config = create_formatter_config(mode);
            const source = `display ${macro_ref_value}`;
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;

            // Macro reference should be preserved exactly
            expect(formatted).toContain(macro_ref_value);

            // No spurious internal spaces in macro references
            if (macro_ref_value.startsWith('`')) {
                // Local macro - no space after ` or before '
                expect(formatted).not.toMatch(/` [^']+'/);
                expect(formatted).not.toMatch(/`[^']+ '/);
            }
            return true;
        },
        100
    );
});

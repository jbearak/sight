/**
 * Property Tests: Alignment Preservation During Indent Correction
 *
 * Tests that the formatter preserves intentional alignment in continuation lines
 * when correcting incorrect base indentation.
 *
 * Feature: alignment-preservation-during-indent-correction
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentState } from '../../src/document-store';
import { FormattingOptions } from 'vscode-languageserver';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

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

function create_config(preserve_alignment: boolean) {
    return {
        ...DEFAULT_SETTINGS,
        formatting: {
            ...DEFAULT_SETTINGS.formatting,
            mode: 'source-preserving' as const,
            preserve_alignment,
        },
    };
}

describe('Feature: alignment-preservation-during-indent-correction', () => {
    const formatter = new CodeFormatter();
    const options: FormattingOptions = { tabSize: 4, insertSpaces: true };

    describe('Property 1: Alignment Preservation with Indentation Correction', () => {
        it('preserves relative alignment when correcting missing indentation', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        var_name: fc.stringMatching(/^[a-z][a-z0-9_]{0,3}$/),
                        alignment_spaces: fc.integer({ min: 10, max: 30 }),
                    }),
                    async (data) => {
                        const my_config = create_config(true);
                        const my_alignment = ' '.repeat(data.alignment_spaces);
                        // Statement inside if block but missing indentation
                        const my_source = `if condition {\nreplace ${data.var_name} = 1 if a == 1 ///\n${my_alignment}& b == 2\n}`;

                        const my_doc = create_document_state(my_source);
                        const my_result = await formatter.format(my_doc, options, my_config);
                        const my_lines = my_result[0].newText.split('\n');

                        // Base line should now be indented
                        const base_indented = my_lines[1].startsWith('    ');
                        // Continuation line should have alignment + 4 spaces delta
                        const continuation_has_more_spaces = my_lines[2].match(/^\s*/)?.[0].length === data.alignment_spaces + 4;

                        return base_indented && continuation_has_more_spaces;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 2: Indentation Delta Application', () => {
        it('applies same delta to all continuation lines', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        var_name: fc.stringMatching(/^[a-z][a-z0-9_]{0,3}$/),
                        base_spaces: fc.integer({ min: 8, max: 20 }),
                    }),
                    async (data) => {
                        const my_config = create_config(true);
                        const my_spaces = ' '.repeat(data.base_spaces);
                        // Multiple continuation lines, all missing 4 spaces of indentation
                        const my_source = `if condition {\ngen ${data.var_name} = 1 ///\n${my_spaces}+ 2 ///\n${my_spaces}+ 3\n}`;

                        const my_doc = create_document_state(my_source);
                        const my_result = await formatter.format(my_doc, options, my_config);
                        const my_lines = my_result[0].newText.split('\n');

                        // Both continuation lines should have same delta applied
                        const line2_spaces = my_lines[2].match(/^\s*/)?.[0].length ?? 0;
                        const line3_spaces = my_lines[3].match(/^\s*/)?.[0].length ?? 0;

                        // Both should have original spaces + 4 (the delta)
                        return line2_spaces === data.base_spaces + 4 && line3_spaces === data.base_spaces + 4;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 3: Nested Block Indentation Correction', () => {
        it('applies cumulative delta in nested blocks', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        var_name: fc.stringMatching(/^[a-z][a-z0-9_]{0,3}$/),
                        alignment: fc.integer({ min: 12, max: 24 }),
                    }),
                    async (data) => {
                        const my_config = create_config(true);
                        const my_alignment = ' '.repeat(data.alignment);
                        // Doubly nested, both levels missing indentation
                        const my_source = `if a {\nif b {\ngen ${data.var_name} = 1 ///\n${my_alignment}+ 2\n}\n}`;

                        const my_doc = create_document_state(my_source);
                        const my_result = await formatter.format(my_doc, options, my_config);
                        const my_lines = my_result[0].newText.split('\n');

                        // Inner statement should have 8 spaces (2 levels)
                        const base_correct = my_lines[2].startsWith('        ');
                        // Continuation should have alignment + 8 spaces delta
                        const cont_spaces = my_lines[3].match(/^\s*/)?.[0].length ?? 0;

                        return base_correct && cont_spaces === data.alignment + 8;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 5: Idempotency', () => {
        it('formatting twice produces same result as formatting once', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        var_name: fc.stringMatching(/^[a-z][a-z0-9_]{0,3}$/),
                        spaces: fc.integer({ min: 4, max: 16 }),
                    }),
                    async (data) => {
                        const my_config = create_config(true);
                        const my_spaces = ' '.repeat(data.spaces);
                        const my_source = `if condition {\ngen ${data.var_name} = 1 ///\n${my_spaces}+ 2\n}`;

                        const my_doc1 = create_document_state(my_source);
                        const my_result1 = await formatter.format(my_doc1, options, my_config);
                        const my_formatted_once = my_result1[0].newText;

                        const my_doc2 = create_document_state(my_formatted_once);
                        const my_result2 = await formatter.format(my_doc2, options, my_config);
                        const my_formatted_twice = my_result2[0].newText;

                        return my_formatted_once === my_formatted_twice;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Unit Tests', () => {
        it('basic positive delta: adds 4 spaces to continuation when base needs +4', async () => {
            const my_config = create_config(true);
            // Missing one indent level inside if block
            const my_source = `if condition {
replace x = 0 if v367 != . & v367 != 2 ///
                          & cm_last == cm_birth
}`;
            const my_doc = create_document_state(my_source);
            const my_result = await formatter.format(my_doc, options, my_config);
            const my_lines = my_result[0].newText.split('\n');

            // Base line should be indented by 4
            expect(my_lines[1]).toMatch(/^    replace/);
            // Continuation should have original 26 spaces + 4 = 30 spaces
            expect(my_lines[2]).toMatch(/^                              &/);
        });

        it('negative delta: removes spaces when over-indented', async () => {
            const my_config = create_config(true);
            // Over-indented by 4 spaces
            const my_source = `if condition {
        replace x = 0 if a == 1 ///
                              & b == 2
}`;
            const my_doc = create_document_state(my_source);
            const my_result = await formatter.format(my_doc, options, my_config);
            const my_lines = my_result[0].newText.split('\n');

            // Base line should have 4 spaces (not 8)
            expect(my_lines[1]).toMatch(/^    replace/);
            // Continuation should have 4 fewer spaces
            expect(my_lines[2]).toMatch(/^                          &/);
        });

        it('nested block: applies cumulative delta', async () => {
            const my_config = create_config(true);
            // Both levels missing indentation
            const my_source = `if a {
if b {
gen x = 1 ///
        + 2
}
}`;
            const my_doc = create_document_state(my_source);
            const my_result = await formatter.format(my_doc, options, my_config);
            const my_lines = my_result[0].newText.split('\n');

            // Inner if should have 4 spaces
            expect(my_lines[1]).toMatch(/^    if b/);
            // gen should have 8 spaces
            expect(my_lines[2]).toMatch(/^        gen/);
            // Continuation should have 8 + 8 = 16 spaces
            expect(my_lines[3]).toMatch(/^                \+/);
        });

        it('edge case: no leading whitespace on continuation', async () => {
            const my_config = create_config(true);
            // Continuation at column 0
            const my_source = `if condition {
gen x = 1 ///
+ 2
}`;
            const my_doc = create_document_state(my_source);
            const my_result = await formatter.format(my_doc, options, my_config);
            const my_lines = my_result[0].newText.split('\n');

            // Base should be indented
            expect(my_lines[1]).toMatch(/^    gen/);
            // Continuation should have 4 spaces added
            expect(my_lines[2]).toMatch(/^    \+/);
        });

        it('preserves alignment when base indentation is already correct', async () => {
            const my_config = create_config(true);
            // Already correctly indented
            const my_source = `if condition {
    replace x = 0 if a == 1 ///
                          & b == 2
}`;
            const my_doc = create_document_state(my_source);
            const my_result = await formatter.format(my_doc, options, my_config);
            const my_lines = my_result[0].newText.split('\n');

            // Should be unchanged
            expect(my_lines[1]).toBe('    replace x = 0 if a == 1 ///');
            expect(my_lines[2]).toBe('                          & b == 2');
        });
    });
});

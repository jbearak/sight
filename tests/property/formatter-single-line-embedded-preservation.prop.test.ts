/**
 * Property Tests: Formatter Single-Line Embedded Call Preservation
 *
 * Feature: mata-block-end-handling
 * Property 4: Formatter preservation for single-line embedded calls
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 *
 * Tests that the formatter preserves all statements in documents containing
 * single-line `mata:` or `python:` calls, including code following the call.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from './helpers/document-utils';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('Formatter Single-Line Embedded Call Preservation Properties', () => {
    const formatter = new CodeFormatter();

    // Generator for single-line embedded call language
    const inline_language_arb = fc.constantFrom('mata:', 'python:');

    // Generator for simple inline content (single line, no newlines)
    const inline_content_arb = fc.constantFrom(
        'x = 1',
        'aww_init_matrices()',
        'y = 2 + 3',
        'import pandas as pd',
        'st_local("result", "value")',
        'matrix A = (1, 2)'
    );

    // Generator for simple Stata statements
    const stata_statement_arb = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'count',
        'clear',
        'summarize',
        'describe',
        'run programs.do',
        'use mydata.dta',
        'confirmdir "output"'
    );

    /**
     * Property 4: Formatter preserves code after single-line mata: call
     *
     * For any document with a single-line `mata:` call followed by Stata code,
     * formatting SHALL preserve all code after the call.
     *
     * Feature: mata-block-end-handling, Property 4: Formatter preservation for single-line embedded calls
     * Validates: Requirements 5.1, 5.3, 5.4
     */
    for_each_formatter_mode_property(
        'Property 4: Formatter preserves code after single-line mata: call',
        fc.tuple(inline_content_arb, stata_statement_arb),
        (mode: FormatterMode, [content, after_stmt]) => {
            const source = `mata: ${content}
${after_stmt}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                // No edits means content unchanged, which is fine
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The mata: call
            expect(formatted).toContain('mata:');

            // 2. The statement after the call (extract the command name)
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            return true;
        },
        100
    );

    /**
     * Property 4: Formatter preserves code after single-line python: call
     *
     * For any document with a single-line `python:` call followed by Stata code,
     * formatting SHALL preserve all code after the call.
     *
     * Feature: mata-block-end-handling, Property 4: Formatter preservation for single-line embedded calls
     * Validates: Requirements 5.2, 5.3, 5.4
     */
    for_each_formatter_mode_property(
        'Property 4: Formatter preserves code after single-line python: call',
        fc.tuple(inline_content_arb, stata_statement_arb),
        (mode: FormatterMode, [content, after_stmt]) => {
            const source = `python: ${content}
${after_stmt}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The python: call
            expect(formatted).toContain('python:');

            // 2. The statement after the call
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            return true;
        },
        100
    );

    /**
     * Property 4: Formatter preserves multiple statements after single-line embedded call
     *
     * For any document with a single-line embedded call followed by multiple
     * Stata statements, formatting SHALL preserve all statements.
     *
     * Feature: mata-block-end-handling, Property 4: Formatter preservation for single-line embedded calls
     * Validates: Requirements 5.1, 5.2, 5.3, 5.4
     */
    for_each_formatter_mode_property(
        'Property 4: Formatter preserves multiple statements after single-line embedded call',
        fc.tuple(
            inline_language_arb,
            inline_content_arb,
            fc.array(stata_statement_arb, { minLength: 2, maxLength: 4 })
        ),
        (mode: FormatterMode, [language, content, after_stmts]) => {
            const after_code = after_stmts.join('\n');
            const source = `${language} ${content}
${after_code}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The embedded call
            expect(formatted).toContain(language);

            // 2. All statements after the call
            for (const stmt of after_stmts) {
                const command_name = stmt.split(' ')[0];
                expect(formatted).toContain(command_name);
            }

            return true;
        },
        100
    );

    /**
     * Property 4: Formatter preserves code before and after single-line embedded call
     *
     * For any document with code before and after a single-line embedded call,
     * formatting SHALL preserve all code.
     *
     * Feature: mata-block-end-handling, Property 4: Formatter preservation for single-line embedded calls
     * Validates: Requirements 5.1, 5.2, 5.3, 5.4
     */
    for_each_formatter_mode_property(
        'Property 4: Formatter preserves code before and after single-line embedded call',
        fc.tuple(
            stata_statement_arb,
            inline_language_arb,
            inline_content_arb,
            stata_statement_arb
        ),
        (mode: FormatterMode, [before_stmt, language, content, after_stmt]) => {
            const source = `${before_stmt}
${language} ${content}
${after_stmt}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The statement before the call
            const before_command = before_stmt.split(' ')[0];
            expect(formatted).toContain(before_command);

            // 2. The embedded call
            expect(formatted).toContain(language);

            // 3. The statement after the call
            const after_command = after_stmt.split(' ')[0];
            expect(formatted).toContain(after_command);

            return true;
        },
        100
    );

    /**
     * Property 4: Formatter preserves single-line embedded call inside if block
     *
     * For any single-line embedded call inside an if block, formatting SHALL
     * preserve the call and all code following it.
     *
     * Feature: mata-block-end-handling, Property 4: Formatter preservation for single-line embedded calls
     * Validates: Requirements 5.1, 5.2, 5.3, 5.4
     */
    for_each_formatter_mode_property(
        'Property 4: Formatter preserves single-line embedded call inside if block',
        fc.tuple(inline_language_arb, inline_content_arb, stata_statement_arb),
        (mode: FormatterMode, [language, content, after_stmt]) => {
            const source = `if 1 {
    ${language} ${content}
    ${after_stmt}
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The embedded call
            expect(formatted).toContain(language);

            // 2. The statement after the call
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            // 3. The closing brace of the if block
            expect(formatted.trim().endsWith('}')).toBe(true);

            return true;
        },
        100
    );

    /**
     * Property 4: Formatter preserves multiple single-line embedded calls
     *
     * For any document with multiple single-line embedded calls, formatting
     * SHALL preserve all calls and code between/after them.
     *
     * Feature: mata-block-end-handling, Property 4: Formatter preservation for single-line embedded calls
     * Validates: Requirements 5.1, 5.2, 5.3, 5.4
     */
    for_each_formatter_mode_property(
        'Property 4: Formatter preserves multiple single-line embedded calls',
        fc.tuple(
            inline_content_arb,
            inline_content_arb,
            stata_statement_arb
        ),
        (mode: FormatterMode, [mata_content, python_content, after_stmt]) => {
            const source = `mata: ${mata_content}
python: ${python_content}
${after_stmt}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. Both embedded calls
            expect(formatted).toContain('mata:');
            expect(formatted).toContain('python:');

            // 2. The statement after the calls
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            return true;
        },
        100
    );

    /**
     * Property 4: Formatter preserves complex code after single-line embedded call
     *
     * For any document with a single-line embedded call followed by complex
     * Stata code (if blocks, comments), formatting SHALL preserve all code.
     *
     * Feature: mata-block-end-handling, Property 4: Formatter preservation for single-line embedded calls
     * Validates: Requirements 5.1, 5.2, 5.3, 5.4
     */
    for_each_formatter_mode_property(
        'Property 4: Formatter preserves complex code after single-line embedded call',
        fc.tuple(inline_language_arb, inline_content_arb),
        (mode: FormatterMode, [language, content]) => {
            // This tests the specific bug scenario from the reproduction test
            const source = `run programs.do
${language} ${content}

// We next make sure the output folders exist
confirmdir "output"
if (_rc == 170) {
    mkdir "output"
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain all original statements
            expect(formatted).toContain('run programs.do');
            expect(formatted).toContain(language);
            expect(formatted).toContain('confirmdir');
            expect(formatted).toContain('mkdir');
            expect(formatted).toContain('if');

            return true;
        },
        100
    );
});

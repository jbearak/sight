/**
 * Property Tests: Formatter Embedded Block Preservation
 *
 * Feature: mata-block-end-handling
 * Property 2: Formatter round-trip preservation for embedded blocks
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2
 *
 * Tests that the formatter preserves all statements in documents containing
 * Mata/Python blocks, including the end delimiter and code following the block.
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

describe('Formatter Embedded Block Preservation Properties', () => {
    const formatter = new CodeFormatter();

    // Generator for embedded block language
    const language_arb = fc.constantFrom('mata', 'python');

    // Generator for simple Mata/Python content (single line)
    const embedded_content_arb = fc.constantFrom(
        'x = 1',
        'display("hello")',
        'y = 2 + 3',
        'st_local("result", "value")'
    );

    // Generator for simple Stata statements
    const stata_statement_arb = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'count',
        'clear',
        'summarize',
        'describe'
    );

    /**
     * Property 2: Formatter preserves end delimiter (top-level)
     *
     * For any Mata or Python block at the top level, formatting SHALL
     * preserve the `end` statement.
     *
     * Feature: mata-block-end-handling, Property 2: Formatter round-trip preservation
     * Validates: Requirements 2.1, 2.3, 2.4
     */
    for_each_formatter_mode_property(
        'Property 2: Formatter preserves end delimiter at top level',
        fc.tuple(language_arb, embedded_content_arb),
        (mode: FormatterMode, [language, content]) => {
            const source = `${language}
${content}
end`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                // No edits means content unchanged, which is fine
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain the end delimiter
            expect(formatted).toContain('end');

            return true;
        },
        100
    );

    /**
     * Property 2: Formatter preserves code after embedded block
     *
     * For any document with a Mata/Python block followed by Stata code,
     * formatting SHALL preserve all code after the block.
     *
     * Feature: mata-block-end-handling, Property 2: Formatter round-trip preservation
     * Validates: Requirements 2.2, 2.5
     */
    for_each_formatter_mode_property(
        'Property 2: Formatter preserves code after embedded block',
        fc.tuple(language_arb, embedded_content_arb, stata_statement_arb),
        (mode: FormatterMode, [language, content, after_stmt]) => {
            const source = `${language}
${content}
end
${after_stmt}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The end delimiter
            expect(formatted).toContain('end');

            // 2. The statement after the block (extract the command name)
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            return true;
        },
        100
    );

    /**
     * Property 2: Formatter preserves embedded block inside if
     *
     * For any Mata/Python block inside an if block, formatting SHALL
     * preserve the end delimiter and all code following it.
     *
     * Feature: mata-block-end-handling, Property 2: Formatter round-trip preservation
     * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2
     */
    for_each_formatter_mode_property(
        'Property 2: Formatter preserves embedded block inside if',
        fc.tuple(language_arb, embedded_content_arb, stata_statement_arb),
        (mode: FormatterMode, [language, content, after_stmt]) => {
            const source = `if 1 {
    ${language}
    ${content}
    end
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
            // 1. The end delimiter
            expect(formatted).toContain('end');

            // 2. The statement after the block
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            // 3. The closing brace of the if block
            expect(formatted.trim().endsWith('}')).toBe(true);

            return true;
        },
        100
    );

    /**
     * Property 2: Formatter preserves embedded block inside foreach
     *
     * For any Mata/Python block inside a foreach loop, formatting SHALL
     * preserve the end delimiter and all code following it.
     *
     * Feature: mata-block-end-handling, Property 2: Formatter round-trip preservation
     * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2
     */
    for_each_formatter_mode_property(
        'Property 2: Formatter preserves embedded block inside foreach',
        fc.tuple(language_arb, embedded_content_arb, stata_statement_arb),
        (mode: FormatterMode, [language, content, after_stmt]) => {
            const source = `foreach x in a b c {
    ${language}
    ${content}
    end
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
            // 1. The end delimiter
            expect(formatted).toContain('end');

            // 2. The statement after the block
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            // 3. The closing brace of the foreach block
            expect(formatted.trim().endsWith('}')).toBe(true);

            return true;
        },
        100
    );

    /**
     * Property 2: Formatter preserves multiple statements after embedded block
     *
     * For any document with a Mata/Python block followed by multiple Stata
     * statements, formatting SHALL preserve all statements.
     *
     * Feature: mata-block-end-handling, Property 2: Formatter round-trip preservation
     * Validates: Requirements 2.2, 2.5
     */
    for_each_formatter_mode_property(
        'Property 2: Formatter preserves multiple statements after embedded block',
        fc.tuple(
            language_arb,
            embedded_content_arb,
            fc.array(stata_statement_arb, { minLength: 2, maxLength: 4 })
        ),
        (mode: FormatterMode, [language, content, after_stmts]) => {
            const after_code = after_stmts.join('\n    ');
            const source = `if 1 {
    ${language}
    ${content}
    end
    ${after_code}
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The end delimiter
            expect(formatted).toContain('end');

            // 2. All statements after the block
            for (const stmt of after_stmts) {
                const command_name = stmt.split(' ')[0];
                expect(formatted).toContain(command_name);
            }

            // 3. The closing brace
            expect(formatted.trim().endsWith('}')).toBe(true);

            return true;
        },
        100
    );

    /**
     * Property 2: Formatter preserves deeply nested embedded blocks
     *
     * For Mata/Python blocks nested inside multiple control structures,
     * formatting SHALL preserve the end delimiter and all surrounding code.
     *
     * Feature: mata-block-end-handling, Property 2: Formatter round-trip preservation
     * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2
     */
    for_each_formatter_mode_property(
        'Property 2: Formatter preserves deeply nested embedded blocks',
        fc.tuple(language_arb, embedded_content_arb, stata_statement_arb),
        (mode: FormatterMode, [language, content, after_stmt]) => {
            // Nested: if > foreach > mata/python
            const source = `if 1 {
    foreach x in a b {
        ${language}
        ${content}
        end
        ${after_stmt}
    }
}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The end delimiter
            expect(formatted).toContain('end');

            // 2. The statement after the block
            const command_name = after_stmt.split(' ')[0];
            expect(formatted).toContain(command_name);

            // 3. Both closing braces
            const brace_count = (formatted.match(/}/g) || []).length;
            expect(brace_count).toBeGreaterThanOrEqual(2);

            return true;
        },
        100
    );

    /**
     * Property 2: Formatter preserves code before and after embedded block
     *
     * For any document with code before and after a Mata/Python block,
     * formatting SHALL preserve all code.
     *
     * Feature: mata-block-end-handling, Property 2: Formatter round-trip preservation
     * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
     */
    for_each_formatter_mode_property(
        'Property 2: Formatter preserves code before and after embedded block',
        fc.tuple(
            stata_statement_arb,
            language_arb,
            embedded_content_arb,
            stata_statement_arb
        ),
        (mode: FormatterMode, [before_stmt, language, content, after_stmt]) => {
            const source = `${before_stmt}
${language}
${content}
end
${after_stmt}`;
            const doc = create_document_state(source);
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc, DEFAULT_FORMATTING_OPTIONS, config);

            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;

            // The formatted output MUST contain:
            // 1. The statement before the block
            const before_command = before_stmt.split(' ')[0];
            expect(formatted).toContain(before_command);

            // 2. The end delimiter
            expect(formatted).toContain('end');

            // 3. The statement after the block
            const after_command = after_stmt.split(' ')[0];
            expect(formatted).toContain(after_command);

            return true;
        },
        100
    );
});

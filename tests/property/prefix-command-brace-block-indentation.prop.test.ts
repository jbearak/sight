/**
 * Property Tests: Prefix Command Brace Block Indentation
 *
 * Feature: prefix-command-brace-block-indentation
 * Validates: Requirements 1.1-1.3, 2.1-2.2, 3.1-3.4, 4.1-4.3
 *
 * Tests that prefix command brace blocks (capture { }, quietly { }, noisily { })
 * are correctly recognized as indentation contexts.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from './helpers/document-utils';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('Prefix Command Brace Block Indentation Properties', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    const config: StataLSPConfig = {
        ...DEFAULT_SETTINGS,
        diagnostics: {
            ...DEFAULT_SETTINGS.diagnostics,
            enabled: true,
            indentation: true,
        },
        formatting: {
            ...DEFAULT_SETTINGS.formatting,
            indentSize: 4,
        }
    };

    // Generator for prefix commands
    const prefix_command_arb = fc.constantFrom('capture', 'quietly', 'noisily', 'qui', 'cap');

    // Generator for simple statements inside blocks
    const simple_statement_arb = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'replace x = 2',
        'count',
        'assert 1 == 1'
    );

    // Generator for prefix command brace blocks with properly indented content
    const prefix_block_arb = fc.tuple(
        prefix_command_arb,
        fc.array(simple_statement_arb, { minLength: 1, maxLength: 3 })
    ).map(([prefix, statements]) => {
        const indented_body = statements.map(s => `    ${s}`).join('\n');
        return `${prefix} {\n${indented_body}\n}`;
    });

    /**
     * Property 1: Prefix Command Brace Block Depth Recognition
     * 
     * For any document with prefix command brace blocks, the expected depth
     * for lines inside the block should be one level deeper than the prefix
     * command line.
     * 
     * Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4
     */
    it('Property 1: Prefix command brace blocks increase expected depth for interior lines', () => {
        fc.assert(
            fc.property(prefix_block_arb, (source) => {
                const doc = create_document_state(source);
                const range = { start: 0, end: source.split('\n').length - 1 };
                const expected_depths = analyzer.compute_expected_depths(doc, range);

                const the_lines = source.split('\n');

                // Line 0 (prefix command with opening brace) should have depth 0
                expect(expected_depths.get(0) ?? 0).toBe(0);

                // Interior lines (1 to n-2) should have depth 1
                for (let i = 1; i < the_lines.length - 1; i++) {
                    const depth = expected_depths.get(i) ?? 0;
                    expect(depth).toBe(1);
                }

                // Last line (closing brace) should have depth 0
                const last_line = the_lines.length - 1;
                expect(expected_depths.get(last_line) ?? 0).toBe(0);

                return true;
            }),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2: No Unnecessary Indentation Diagnostic for Brace Block Contents
     * 
     * For any prefix command brace block with properly indented content
     * (one level deeper than the prefix command), the analyzer should NOT
     * emit an UNNECESSARY_INDENTATION diagnostic for lines inside the block.
     * 
     * Validates: Requirements 2.1, 2.2
     */
    it('Property 2: No unnecessary indentation diagnostic for properly indented brace block contents', () => {
        fc.assert(
            fc.property(prefix_block_arb, (source) => {
                const doc = create_document_state(source);
                const diagnostics = analyzer.analyze(doc, config);

                // Filter for UNNECESSARY_INDENTATION diagnostics
                const unnecessary_diagnostics = diagnostics.filter(
                    d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                );

                const the_lines = source.split('\n');

                // No interior lines should have unnecessary indentation diagnostics
                for (const diag of unnecessary_diagnostics) {
                    const line_num = diag.range.start.line;
                    // Interior lines are 1 to n-2
                    const is_interior = line_num > 0 && line_num < the_lines.length - 1;
                    expect(is_interior).toBe(false);
                }

                return true;
            }),
            { numRuns: 50 }
        );
    });

    /**
     * Property 3: Formatter Preserves Brace Block Indentation
     * 
     * For any document with prefix command brace blocks, formatting should
     * preserve the indentation of lines inside the block.
     * 
     * Validates: Requirements 4.1, 4.2, 4.3
     */
    for_each_formatter_mode_property(
        'Property 3: Formatter preserves brace block indentation',
        prefix_block_arb,
        (mode: FormatterMode, source: string) => {
            const fmt_config = create_formatter_config(mode);
            const doc = create_document_state(source);
            const edits = formatter.format(doc, options, fmt_config);

            // If no edits, the source is already correctly formatted
            if (edits.length === 0) {
                return true;
            }

            const formatted = edits[0].newText;
            const formatted_lines = formatted.split('\n');
            const original_lines = source.split('\n');

            // Interior lines should still be indented after formatting
            for (let i = 1; i < formatted_lines.length - 1; i++) {
                const line = formatted_lines[i];
                if (line.trim()) {
                    // Content should have some indentation
                    const leading_spaces = line.length - line.trimStart().length;
                    expect(leading_spaces).toBeGreaterThan(0);
                }
            }

            return true;
        },
        50
    );

    /**
     * Property 4: Nested Prefix Command Brace Blocks
     * 
     * For nested prefix command brace blocks, the expected depth should
     * increase for each nesting level.
     * 
     * Validates: Requirements 1.3
     */
    it('Property 4: Nested prefix command brace blocks have correct depth', () => {
        const nested_source = `capture {
    quietly {
        display "nested"
    }
}`;
        const doc = create_document_state(nested_source);
        const range = { start: 0, end: 4 };
        const expected_depths = analyzer.compute_expected_depths(doc, range);

        // Line 0: capture { -> depth 0
        expect(expected_depths.get(0) ?? 0).toBe(0);
        // Line 1: quietly { -> depth 1
        expect(expected_depths.get(1) ?? 0).toBe(1);
        // Line 2: display "nested" -> depth 2
        expect(expected_depths.get(2) ?? 0).toBe(2);
        // Line 3: } (inner) -> depth 1
        expect(expected_depths.get(3) ?? 0).toBe(1);
        // Line 4: } (outer) -> depth 0
        expect(expected_depths.get(4) ?? 0).toBe(0);
    });

    /**
     * Property 5: Prefix command brace blocks inside control flow
     * 
     * When a prefix command brace block is inside a control flow block,
     * the depths should stack correctly.
     */
    it('Property 5: Prefix command brace blocks inside control flow have correct depth', () => {
        const source = `if 1 == 1 {
    capture {
        display "inside"
    }
}`;
        const doc = create_document_state(source);
        const range = { start: 0, end: 4 };
        const expected_depths = analyzer.compute_expected_depths(doc, range);

        // Line 0: if 1 == 1 { -> depth 0
        expect(expected_depths.get(0) ?? 0).toBe(0);
        // Line 1: capture { -> depth 1
        expect(expected_depths.get(1) ?? 0).toBe(1);
        // Line 2: display "inside" -> depth 2
        expect(expected_depths.get(2) ?? 0).toBe(2);
        // Line 3: } (capture) -> depth 1
        expect(expected_depths.get(3) ?? 0).toBe(1);
        // Line 4: } (if) -> depth 0
        expect(expected_depths.get(4) ?? 0).toBe(0);
    });
});

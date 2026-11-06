/**
 * Property Tests: Embedded Block End Delimiter Indentation
 *
 * Feature: mata-block-end-handling
 * Property 1: End delimiter indentation correctness
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 *
 * Tests, through IndentationDiagnosticAnalyzer.analyze(), that Mata/Python
 * block end delimiters are held to the right block depth, ensuring no
 * false positive unnecessary indentation diagnostics.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { StataDiagnosticCode } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import {
    create_indentation_config,
    expect_line_at_depth,
    indentation_codes_by_line,
    indentation_diagnostics,
} from './helpers/indentation-test-utils';

describe('Embedded Block End Delimiter Indentation Properties', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();

    const config = create_indentation_config();

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
        'clear'
    );

    /**
     * Indentation of a block's `end` line. Stata 18 accepts leading
     * blanks before a Mata `end`, but ends a Python block only at an
     * `end` in column 0 (an indented `end` is passed to Python and the
     * block stays open, even inside `if 1 { ... }`), so a nested Python
     * `end` stays at depth 0.
     */
    function end_indent(language: string, indent: string): string {
        return language === 'python' ? '' : indent;
    }

    /**
     * Assert a block's `end` line sits at `depth` (a Mata `end`). A
     * Python `end` must stay in column 0: indenting it would make it
     * Python code rather than move it, so it is checked in place only.
     */
    function expect_end_at_depth(
        language: string,
        source: string,
        line: number,
        depth: number
    ): void {
        if (language === 'python') {
            expect(indentation_codes_by_line(source).get(line)).toBeUndefined();
            return;
        }
        expect_line_at_depth(source, line, depth);
    }

    /**
     * Property 1: End delimiter indentation correctness (top-level)
     * 
     * For any Mata or Python block at the top level, the `end` statement
     * should have expected depth 0 (same as the opening keyword).
     * 
     * Feature: mata-block-end-handling, Property 1: End delimiter indentation correctness
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     */
    it('Property 1: Top-level embedded block end has depth 0', () => {
        fc.assert(
            fc.property(
                language_arb,
                embedded_content_arb,
                (language, content) => {
                    const source = `${language}
${content}
end`;
                    expect(indentation_diagnostics(source)).toEqual([]);

                    // Line 0 (mata/python): depth 0
                    expect_line_at_depth(source, 0, 0);
                    
                    // Line 2 (end): depth 0 (same as opening keyword)
                    expect_end_at_depth(language, source, 2, 0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1: End delimiter indentation correctness (inside if block)
     * 
     * For any Mata or Python block inside an if block, the `end` statement
     * should have expected depth 1 (same as the opening keyword inside the if).
     * 
     * Feature: mata-block-end-handling, Property 1: End delimiter indentation correctness
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     */
    it('Property 1: Embedded block inside if has end at depth 1', () => {
        fc.assert(
            fc.property(
                language_arb,
                embedded_content_arb,
                stata_statement_arb,
                (language, content, after_stmt) => {
                    const source = `if 1 {
    ${language}
    ${content}
${end_indent(language, '    ')}end
    ${after_stmt}
}`;
                    expect(indentation_diagnostics(source)).toEqual([]);

                    // Line 0 (if): depth 0
                    expect_line_at_depth(source, 0, 0);
                    
                    // Line 1 (mata/python): depth 1 (inside if)
                    expect_line_at_depth(source, 1, 1);
                    
                    // Line 3 (end): depth 1 (same as opening keyword),
                    // or 0 for Python
                    expect_end_at_depth(language, source, 3, 1);
                    
                    // Line 4 (statement after end): depth 1 (still inside if)
                    expect_line_at_depth(source, 4, 1);
                    
                    // Line 5 (closing brace): depth 0
                    expect_line_at_depth(source, 5, 0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1: End delimiter indentation correctness (inside program)
     * 
     * For any Mata or Python block inside a program, StataMP 18 ends the
     * program definition at the block's `end`, so that `end` is the
     * program's and has expected depth 0.
     * 
     * Feature: mata-block-end-handling, Property 1: End delimiter indentation correctness
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     */
    it('Property 1: Embedded block inside program has end at the program depth', () => {
        fc.assert(
            fc.property(
                language_arb,
                embedded_content_arb,
                (language, content) => {
                    const source = `program define test
    ${language}
    ${content}
${end_indent(language, '    ')}end
end`;
                    // Line 0 (program define): depth 0
                    expect_line_at_depth(source, 0, 0);
                    
                    // Line 1 (mata/python): depth 1 (inside program)
                    expect_line_at_depth(source, 1, 1);
                    
                    // Line 3 (end for mata/python): Stata ends the program
                    // definition here (the first line whose first word is
                    // `end`), so it is the program's `end`: depth 0. The
                    // source indents a Mata `end` one level, so that
                    // `end` is reported as unnecessarily indented.
                    expect(indentation_codes_by_line(source).get(3)).toBe(
                        language === 'mata'
                            ? StataDiagnosticCode.UNNECESSARY_INDENTATION
                            : undefined
                    );
                    expect_line_at_depth(source, 3, 0);
                    
                    // Line 4 (the program's own end, now unexpected): depth 0
                    expect_line_at_depth(source, 4, 0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1: End delimiter indentation correctness (nested in foreach)
     * 
     * For any Mata or Python block inside a foreach loop, the `end` statement
     * should have expected depth 1 (same as the opening keyword inside the loop).
     * 
     * Feature: mata-block-end-handling, Property 1: End delimiter indentation correctness
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     */
    it('Property 1: Embedded block inside foreach has end at depth 1', () => {
        fc.assert(
            fc.property(
                language_arb,
                embedded_content_arb,
                (language, content) => {
                    const source = `foreach x in a b c {
    ${language}
    ${content}
${end_indent(language, '    ')}end
}`;
                    expect(indentation_diagnostics(source)).toEqual([]);

                    // Line 0 (foreach): depth 0
                    expect_line_at_depth(source, 0, 0);
                    
                    // Line 1 (mata/python): depth 1 (inside foreach)
                    expect_line_at_depth(source, 1, 1);
                    
                    // Line 3 (end): depth 1 (same as opening keyword),
                    // or 0 for Python
                    expect_end_at_depth(language, source, 3, 1);
                    
                    // Line 4 (closing brace): depth 0
                    expect_line_at_depth(source, 4, 0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1: No false positive diagnostics for correctly indented end
     * 
     * For any Mata or Python block with correctly indented `end` statement,
     * the analyzer SHALL NOT emit an UNNECESSARY_INDENTATION diagnostic.
     * 
     * Feature: mata-block-end-handling, Property 1: End delimiter indentation correctness
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     */
    it('Property 1: No unnecessary indentation diagnostic for correctly indented end', () => {
        fc.assert(
            fc.property(
                language_arb,
                embedded_content_arb,
                stata_statement_arb,
                (language, content, after_stmt) => {
                    // Correctly indented: 4 spaces for depth 1 inside if block
                    const source = `if 1 {
    ${language}
    ${content}
${end_indent(language, '    ')}end
    ${after_stmt}
}`;
                    const diagnostics = analyzer.analyze(
                        create_document_state(source), config
                    );

                    // Filter for UNNECESSARY_INDENTATION diagnostics on line 3 (end line)
                    const end_line_diags = diagnostics.filter(
                        d => d.range.start.line === 3 && 
                             d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                    );

                    // Should have NO unnecessary indentation diagnostics for the end line
                    expect(end_line_diags.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1: Deeply nested embedded blocks
     * 
     * For Mata/Python blocks nested inside multiple control structures,
     * the `end` statement should have the correct cumulative depth.
     * 
     * Feature: mata-block-end-handling, Property 1: End delimiter indentation correctness
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     */
    it('Property 1: Deeply nested embedded block has correct end depth', () => {
        fc.assert(
            fc.property(
                language_arb,
                embedded_content_arb,
                (language, content) => {
                    // Nested: if > foreach > mata/python
                    const source = `if 1 {
    foreach x in a b {
        ${language}
        ${content}
${end_indent(language, '        ')}end
    }
}`;
                    expect(indentation_diagnostics(source)).toEqual([]);

                    // Line 0 (if): depth 0
                    expect_line_at_depth(source, 0, 0);
                    
                    // Line 1 (foreach): depth 1 (inside if)
                    expect_line_at_depth(source, 1, 1);
                    
                    // Line 2 (mata/python): depth 2 (inside if > foreach)
                    expect_line_at_depth(source, 2, 2);
                    
                    // Line 4 (end): depth 2 (same as opening keyword),
                    // or 0 for Python
                    expect_end_at_depth(language, source, 4, 2);
                    
                    // Line 5 (foreach closing brace): depth 1
                    expect_line_at_depth(source, 5, 1);
                    
                    // Line 6 (if closing brace): depth 0
                    expect_line_at_depth(source, 6, 0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

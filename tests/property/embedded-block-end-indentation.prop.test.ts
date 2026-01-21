/**
 * Property Tests: Embedded Block End Delimiter Indentation
 *
 * Feature: mata-block-end-handling
 * Property 1: End delimiter indentation correctness
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 *
 * Tests that the indentation analyzer correctly computes expected depths
 * for Mata/Python block end delimiters, ensuring no false positive
 * unnecessary indentation diagnostics.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { create_document_state } from './helpers/document-utils';

describe('Embedded Block End Delimiter Indentation Properties', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();

    const config: StataLSPConfig = {
        diagnostics: {
            enabled: true,
            indentation: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'information',
                styleWarnings: 'hint'
            },
        },
        adoPaths: [],
        cross_file: {},
        formatting: { indentSize: 4 }
    };

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
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (mata/python): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 2 (end): depth 0 (same as opening keyword)
                    expect(expected_depths.get(2) ?? 0).toBe(0);

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
    end
    ${after_stmt}
}`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (if): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 1 (mata/python): depth 1 (inside if)
                    expect(expected_depths.get(1) ?? 0).toBe(1);
                    
                    // Line 3 (end): depth 1 (same as opening keyword)
                    expect(expected_depths.get(3) ?? 0).toBe(1);
                    
                    // Line 4 (statement after end): depth 1 (still inside if)
                    expect(expected_depths.get(4) ?? 0).toBe(1);
                    
                    // Line 5 (closing brace): depth 0
                    expect(expected_depths.get(5) ?? 0).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1: End delimiter indentation correctness (inside program)
     * 
     * For any Mata or Python block inside a program, the `end` statement
     * should have expected depth 1 (same as the opening keyword inside the program).
     * 
     * Feature: mata-block-end-handling, Property 1: End delimiter indentation correctness
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     */
    it('Property 1: Embedded block inside program has end at depth 1', () => {
        fc.assert(
            fc.property(
                language_arb,
                embedded_content_arb,
                (language, content) => {
                    const source = `program define test
    ${language}
    ${content}
    end
end`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (program define): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 1 (mata/python): depth 1 (inside program)
                    expect(expected_depths.get(1) ?? 0).toBe(1);
                    
                    // Line 3 (end for mata/python): depth 1 (same as opening keyword)
                    expect(expected_depths.get(3) ?? 0).toBe(1);
                    
                    // Line 4 (end for program): depth 0
                    expect(expected_depths.get(4) ?? 0).toBe(0);

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
    end
}`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (foreach): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 1 (mata/python): depth 1 (inside foreach)
                    expect(expected_depths.get(1) ?? 0).toBe(1);
                    
                    // Line 3 (end): depth 1 (same as opening keyword)
                    expect(expected_depths.get(3) ?? 0).toBe(1);
                    
                    // Line 4 (closing brace): depth 0
                    expect(expected_depths.get(4) ?? 0).toBe(0);

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
    end
    ${after_stmt}
}`;
                    const doc = create_document_state(source);
                    const diagnostics = analyzer.analyze(doc, config);

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
        end
    }
}`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (if): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 1 (foreach): depth 1 (inside if)
                    expect(expected_depths.get(1) ?? 0).toBe(1);
                    
                    // Line 2 (mata/python): depth 2 (inside if > foreach)
                    expect(expected_depths.get(2) ?? 0).toBe(2);
                    
                    // Line 4 (end): depth 2 (same as opening keyword)
                    expect(expected_depths.get(4) ?? 0).toBe(2);
                    
                    // Line 5 (foreach closing brace): depth 1
                    expect(expected_depths.get(5) ?? 0).toBe(1);
                    
                    // Line 6 (if closing brace): depth 0
                    expect(expected_depths.get(6) ?? 0).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

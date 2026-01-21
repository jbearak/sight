/**
 * Property Tests: Else Block Indentation Depth Computation
 *
 * Feature: else-block-indentation-false-positive
 * Property 3: Indentation depth computation for nested blocks
 * Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6
 *
 * Tests that the indentation analyzer correctly computes expected depths
 * for lines inside else blocks, including nested structures.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { create_document_state } from './helpers/document-utils';

describe('Else Block Indentation Depth Properties', () => {
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

    // Generator for valid Stata macro names
    const macro_name_arb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,8}$/);

    // Generator for simple string arguments
    const string_arg_arb = fc.stringMatching(/^[a-zA-Z0-9_]{1,10}$/).map(s => `"${s}"`);

    // Generator for simple statements inside blocks
    const simple_statement_arb = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'count',
        'assert 1 == 1'
    );

    // Generator for macro command statements (the bug case)
    const macro_command_arb = fc.tuple(
        macro_name_arb,
        fc.array(string_arg_arb, { minLength: 0, maxLength: 2 })
    ).map(([name, args]) => {
        const arg_str = args.length > 0 ? ' ' + args.join(' ') : '';
        return `\`${name}'${arg_str}`;
    });

    // Generator for else block body statements (mix of regular and macro commands)
    const else_body_statement_arb = fc.oneof(
        simple_statement_arb,
        macro_command_arb
    );


    /**
     * Property 3: Indentation depth computation for nested blocks
     * 
     * For any else block at nesting level N, the indentation analyzer SHALL
     * compute expected depth N+1 for all lines inside the else block body.
     * 
     * Feature: else-block-indentation-false-positive, Property 3: Indentation depth computation
     * Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6
     */
    it('Property 3: Else block body lines have depth one greater than else block itself', () => {
        fc.assert(
            fc.property(
                else_body_statement_arb,
                (body_statement) => {
                    // Top-level if/else: else is at depth 0, body should be at depth 1
                    const source = `if 1 {
    display "then"
}
else {
    ${body_statement}
}`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (if): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 3 (else {): depth 0
                    expect(expected_depths.get(3) ?? 0).toBe(0);
                    
                    // Line 4 (body statement): depth 1 (inside else)
                    // This is the KEY property - body lines should be depth 1
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
     * Property 3 (continued): Else blocks inside programs
     * 
     * When an else block is inside a program (depth 1), the else block body
     * should be at depth 2.
     * 
     * Feature: else-block-indentation-false-positive, Property 3: Indentation depth computation
     * Validates: Requirements 2.4, 2.5
     */
    it('Property 3: Else block inside program has correct cumulative depth', () => {
        fc.assert(
            fc.property(
                else_body_statement_arb,
                (body_statement) => {
                    const source = `program define test
    if 1 {
        display "then"
    }
    else {
        ${body_statement}
    }
end`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (program define): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 1 (if): depth 1 (inside program)
                    expect(expected_depths.get(1) ?? 0).toBe(1);
                    
                    // Line 2 (display): depth 2 (inside program > inside if)
                    expect(expected_depths.get(2) ?? 0).toBe(2);
                    
                    // Line 4 (else {): depth 1 (inside program)
                    expect(expected_depths.get(4) ?? 0).toBe(1);
                    
                    // Line 5 (body statement): depth 2 (inside program > inside else)
                    // This is the KEY property for nested case
                    expect(expected_depths.get(5) ?? 0).toBe(2);
                    
                    // Line 7 (end): depth 0
                    expect(expected_depths.get(7) ?? 0).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });


    /**
     * Property 3 (continued): Nested else blocks
     * 
     * When else blocks are nested (if inside else), depths should stack correctly.
     * 
     * Feature: else-block-indentation-false-positive, Property 3: Indentation depth computation
     * Validates: Requirements 2.5
     */
    it('Property 3: Nested if/else structures have correct stacking depths', () => {
        fc.assert(
            fc.property(
                else_body_statement_arb,
                else_body_statement_arb,
                (outer_body, inner_body) => {
                    const source = `if 1 {
    display "outer then"
}
else {
    if 2 {
        display "inner then"
    }
    else {
        ${inner_body}
    }
    ${outer_body}
}`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (outer if): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 3 (outer else {): depth 0
                    expect(expected_depths.get(3) ?? 0).toBe(0);
                    
                    // Line 4 (inner if): depth 1 (inside outer else)
                    expect(expected_depths.get(4) ?? 0).toBe(1);
                    
                    // Line 5 (inner then body): depth 2 (inside outer else > inside inner if)
                    expect(expected_depths.get(5) ?? 0).toBe(2);
                    
                    // Line 7 (inner else {): depth 1 (inside outer else)
                    expect(expected_depths.get(7) ?? 0).toBe(1);
                    
                    // Line 8 (inner else body): depth 2 (inside outer else > inside inner else)
                    expect(expected_depths.get(8) ?? 0).toBe(2);
                    
                    // Line 10 (outer else body after inner if/else): depth 1
                    expect(expected_depths.get(10) ?? 0).toBe(1);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3 (continued): No false positive diagnostics for correctly indented else blocks
     * 
     * For any else block with correctly indented content (depth * indent_size spaces),
     * the analyzer SHALL NOT emit an UNNECESSARY_INDENTATION diagnostic.
     * 
     * Feature: else-block-indentation-false-positive, Property 3: Indentation depth computation
     * Validates: Requirements 2.1, 2.3
     */
    it('Property 3: No unnecessary indentation diagnostic for correctly indented else block content', () => {
        fc.assert(
            fc.property(
                else_body_statement_arb,
                (body_statement) => {
                    // Correctly indented: 4 spaces for depth 1
                    const source = `if 1 {
    display "then"
}
else {
    ${body_statement}
}`;
                    const doc = create_document_state(source);
                    const diagnostics = analyzer.analyze(doc, config);

                    // Filter for UNNECESSARY_INDENTATION diagnostics on line 4 (body line)
                    const body_line_diags = diagnostics.filter(
                        d => d.range.start.line === 4 && 
                             d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                    );

                    // Should have NO unnecessary indentation diagnostics for the body line
                    expect(body_line_diags.length).toBe(0);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3 (continued): Else blocks inside foreach loops
     * 
     * When an else block is inside a foreach loop, depths should stack correctly.
     * 
     * Feature: else-block-indentation-false-positive, Property 3: Indentation depth computation
     * Validates: Requirements 2.5
     */
    it('Property 3: Else block inside foreach has correct cumulative depth', () => {
        fc.assert(
            fc.property(
                else_body_statement_arb,
                (body_statement) => {
                    const source = `foreach x in a b c {
    if 1 {
        display "then"
    }
    else {
        ${body_statement}
    }
}`;
                    const doc = create_document_state(source);
                    const range = { start: 0, end: source.split('\n').length - 1 };
                    const expected_depths = analyzer.compute_expected_depths(doc, range);

                    // Line 0 (foreach): depth 0
                    expect(expected_depths.get(0) ?? 0).toBe(0);
                    
                    // Line 1 (if): depth 1 (inside foreach)
                    expect(expected_depths.get(1) ?? 0).toBe(1);
                    
                    // Line 4 (else {): depth 1 (inside foreach)
                    expect(expected_depths.get(4) ?? 0).toBe(1);
                    
                    // Line 5 (body statement): depth 2 (inside foreach > inside else)
                    expect(expected_depths.get(5) ?? 0).toBe(2);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

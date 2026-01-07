/**
 * Property tests for parenthesized group parsing refactor.
 *
 * Feature: parenthesized-group-parsing-refactor
 * Property 1: Nested Parenthesis Depth Tracking
 * Property 2: Word Token Spacing Preservation
 * Property 3: Parsing Consistency After Refactoring
 * Property 4: Direct vs Frame-Prefixed Equivalence
 * Validates: Requirements 1.3, 1.4, 2.3, 3.3, 4.1, 4.2, 4.3, 4.4, 5.3, 5.4
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { CommandNode } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

/**
 * Parse source code and return the first command node.
 */
function parse(source: string): CommandNode | null {
    const lexer = new StataLexer();
    const tokens = lexer.tokenize(source);
    const parser = new StataParser();
    const result = parser.parse(tokens.tokens);
    const node = result.ast?.nodes?.[0];
    return node?.type === 'command' ? node : null;
}

/**
 * Get parenthesized group content from varlist.
 */
function get_parenthesized_content(cmd: CommandNode): string | null {
    const paren_item = cmd.varlist?.find(
        v => v.name.startsWith('(') && v.name.endsWith(')')
    );
    return paren_item?.name ?? null;
}

describe('parenthesized group parsing property tests', () => {
    /**
     * Property 1: Nested Parenthesis Depth Tracking
     * For any parenthesized group with N levels of nesting, the parser SHALL
     * correctly track depth and produce content that includes exactly N-1 pairs
     * of inner parentheses.
     * Validates: Requirements 1.3, 4.2
     */
    it('should track nested parenthesis depth correctly (Property 1)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                fc.integer({ min: 1, max: 4 }),
                arbitrary_non_reserved_identifier(),
                (cmd_name, nesting_depth, var_name) => {
                    // Build nested parentheses: depth 1 = (var), depth 2 = ((var))
                    const open_parens = '('.repeat(nesting_depth);
                    const close_parens = ')'.repeat(nesting_depth);
                    const source = `${cmd_name} ${open_parens}${var_name}${close_parens}`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const content = get_parenthesized_content(cmd);
                    expect(content).toBe(`${open_parens}${var_name}${close_parens}`);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Word Token Spacing Preservation
     * For any parenthesized group containing two or more consecutive word-like
     * tokens, the parser SHALL insert exactly one space between each pair.
     * Validates: Requirements 1.4
     */
    it('should preserve spacing between word tokens (Property 2)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                fc.array(arbitrary_non_reserved_identifier(), {
                    minLength: 2,
                    maxLength: 5
                }),
                (cmd_name, the_vars) => {
                    const source = `${cmd_name} (${the_vars.join(' ')})`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const content = get_parenthesized_content(cmd);
                    expect(content).toBe(`(${the_vars.join(' ')})`);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Parsing Consistency After Refactoring
     * For any valid Stata command with parenthesized groups, parsing SHALL
     * produce an AST where the varlist contains the parenthesized content with
     * surrounding parentheses, and any subsequent assignment expression is
     * correctly captured.
     * Validates: Requirements 2.3, 3.3, 4.1, 4.3, 5.3, 5.4
     */
    it('should parse parenthesized groups with assignment (Property 3)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (cmd_name, var_name, expr_name) => {
                    const source = `${cmd_name} (${var_name})=${expr_name}`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const content = get_parenthesized_content(cmd);
                    expect(content).toBe(`(${var_name})`);
                    expect(cmd.expression).toBeDefined();
                    expect(cmd.expression).toContain(expr_name);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4: Direct vs Frame-Prefixed Equivalence
     * For any command with parenthesized groups, parsing as a direct command
     * and as a frame-prefixed command SHALL produce equivalent varlist content.
     * Validates: Requirements 4.4
     */
    it('should produce equivalent results for direct and frame-prefixed (Property 4)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, cmd_name, var_name) => {
                    const direct_source = `${cmd_name} (${var_name})`;
                    const frame_source = `frame ${frame_name}: ${cmd_name} (${var_name})`;

                    const direct_cmd = parse(direct_source);
                    const frame_cmd = parse(frame_source);

                    expect(direct_cmd).not.toBeNull();
                    expect(frame_cmd).not.toBeNull();
                    if (!direct_cmd || !frame_cmd) return false;

                    const direct_content = get_parenthesized_content(direct_cmd);
                    const frame_content = get_parenthesized_content(frame_cmd);
                    expect(direct_content).toBe(frame_content);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('parenthesized group parsing unit tests', () => {
    it('should handle basic parenthesized group', () => {
        const cmd = parse('cmd (var1)');
        expect(cmd).not.toBeNull();
        expect(get_parenthesized_content(cmd!)).toBe('(var1)');
    });

    it('should handle multiple variables in parenthesized group', () => {
        const cmd = parse('cmd (var1 var2 var3)');
        expect(cmd).not.toBeNull();
        expect(get_parenthesized_content(cmd!)).toBe('(var1 var2 var3)');
    });

    it('should handle nested parentheses', () => {
        const cmd = parse('cmd ((a b))');
        expect(cmd).not.toBeNull();
        expect(get_parenthesized_content(cmd!)).toBe('((a b))');
    });

    it('should handle assignment after parenthesized group', () => {
        const cmd = parse('getmata (xy)=m');
        expect(cmd).not.toBeNull();
        expect(get_parenthesized_content(cmd!)).toBe('(xy)');
        expect(cmd?.expression).toBe('m');
    });

    it('should handle empty parentheses gracefully', () => {
        const cmd = parse('cmd ()');
        expect(cmd).not.toBeNull();
        // Empty parens should not be added to varlist
        const content = get_parenthesized_content(cmd!);
        expect(content).toBeNull();
    });

    it('should handle unclosed parentheses gracefully', () => {
        // Should not crash
        const cmd = parse('cmd (var1');
        expect(cmd).not.toBeNull();
    });

    it('should handle parenthesized group with operators', () => {
        const cmd = parse('cmd (a+b)');
        expect(cmd).not.toBeNull();
        expect(get_parenthesized_content(cmd!)).toBe('(a+b)');
    });
});

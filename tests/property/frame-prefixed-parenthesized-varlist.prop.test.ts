/**
 * Property tests for frame-prefixed command parenthesized varlist handling.
 *
 * Feature: pr-28-feedback-3
 * Property 1: Frame-Prefixed Command Parenthesized Group Recognition
 * Property 2: Consistent Parenthesized Group Parsing
 * Property 3: Post-Parenthesis Token Parsing
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
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
 * Check if varlist contains a parenthesized group.
 */
function has_parenthesized_group(cmd: CommandNode): boolean {
    return cmd.varlist?.some(v => v.name.startsWith('(') && v.name.endsWith(')')) ?? false;
}

/**
 * Get parenthesized group content from varlist.
 */
function get_parenthesized_content(cmd: CommandNode): string | null {
    const paren_item = cmd.varlist?.find(v => v.name.startsWith('(') && v.name.endsWith(')'));
    return paren_item?.name ?? null;
}

describe('frame-prefixed parenthesized varlist property tests', () => {
    /**
     * Property 1: Frame-Prefixed Command Parenthesized Group Recognition
     * For any frame-prefixed command with parenthesized varlist groups, the parser
     * should recognize and process LPAREN tokens without dropping the content.
     * Validates: Requirements 1.1, 1.5
     */
    it('should recognize parenthesized groups in frame-prefixed commands (Property 1)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, cmd_name, var_name) => {
                    const source = `frame ${frame_name}: ${cmd_name} (${var_name})`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    // Parenthesized group should be present in varlist
                    expect(has_parenthesized_group(cmd)).toBe(true);
                    const content = get_parenthesized_content(cmd);
                    expect(content).toBe(`(${var_name})`);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle multiple variables in parenthesized group (Property 1)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                fc.array(arbitrary_non_reserved_identifier(), { minLength: 2, maxLength: 4 }),
                (frame_name, cmd_name, the_vars) => {
                    const source = `frame ${frame_name}: ${cmd_name} (${the_vars.join(' ')})`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    expect(has_parenthesized_group(cmd)).toBe(true);
                    const content = get_parenthesized_content(cmd);
                    expect(content).toBe(`(${the_vars.join(' ')})`);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Consistent Parenthesized Group Parsing
     * Parsing logic should be consistent between parseCommand and parseCommandBody,
     * producing equivalent AST nodes for the same input.
     * Validates: Requirements 1.2, 1.3
     */
    it('should produce consistent results between direct and frame-prefixed parsing (Property 2)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, cmd_name, var_name) => {
                    // Parse direct command
                    const direct_source = `${cmd_name} (${var_name})`;
                    const direct_cmd = parse(direct_source);

                    // Parse frame-prefixed command
                    const frame_source = `frame ${frame_name}: ${cmd_name} (${var_name})`;
                    const frame_cmd = parse(frame_source);

                    expect(direct_cmd).not.toBeNull();
                    expect(frame_cmd).not.toBeNull();
                    if (!direct_cmd || !frame_cmd) return false;

                    // Both should have parenthesized groups
                    expect(has_parenthesized_group(direct_cmd)).toBe(true);
                    expect(has_parenthesized_group(frame_cmd)).toBe(true);

                    // Content should match
                    const direct_content = get_parenthesized_content(direct_cmd);
                    const frame_content = get_parenthesized_content(frame_cmd);
                    expect(direct_content).toBe(frame_content);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Post-Parenthesis Token Parsing
     * For any command with parenthesized groups followed by assignment operators,
     * the parser should correctly parse the subsequent "=" and expression tokens.
     * Validates: Requirements 1.4
     */
    it('should parse assignment after parenthesized group (Property 3)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, cmd_name, var_name, expr_name) => {
                    const source = `frame ${frame_name}: ${cmd_name} (${var_name})=${expr_name}`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    // Parenthesized group should be present
                    expect(has_parenthesized_group(cmd)).toBe(true);

                    // Expression should be captured
                    expect(cmd.expression).toBeDefined();
                    expect(cmd.expression).toContain(expr_name);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should parse assignment with spaces around equals (Property 3)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, cmd_name, var_name, expr_name) => {
                    const source = `frame ${frame_name}: ${cmd_name} (${var_name}) = ${expr_name}`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    expect(has_parenthesized_group(cmd)).toBe(true);
                    expect(cmd.expression).toBeDefined();
                    expect(cmd.expression).toContain(expr_name);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('frame-prefixed parenthesized varlist unit tests', () => {
    it('should handle frame myframe: command (xy)=m', () => {
        const source = 'frame myframe: getmata (xy)=m';
        const cmd = parse(source);

        expect(cmd).not.toBeNull();
        expect(cmd?.name).toBe('getmata');
        expect(has_parenthesized_group(cmd!)).toBe(true);
        expect(get_parenthesized_content(cmd!)).toBe('(xy)');
        expect(cmd?.expression).toBe('m');
    });

    it('should handle nested parentheses in frame-prefixed commands', () => {
        const source = 'frame myframe: cmd ((a b))';
        const cmd = parse(source);

        expect(cmd).not.toBeNull();
        expect(has_parenthesized_group(cmd!)).toBe(true);
        expect(get_parenthesized_content(cmd!)).toBe('((a b))');
    });
});

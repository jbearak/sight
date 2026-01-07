/**
 * Property tests for frame prefix whitespace handling.
 *
 * Feature: pr-28-feedback-3
 * Property 4: Frame Prefix Whitespace Tolerance
 * Property 5: Frame Parsing Path Consistency
 * Validates: Requirements 4.1, 4.2, 4.4, 4.5
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { CommandNode, PrefixNode } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

/**
 * Parse source code and return the first command node and any errors.
 */
function parse_with_errors(source: string): { cmd: CommandNode | null; errors: string[] } {
    const lexer = new StataLexer();
    const tokens = lexer.tokenize(source);
    const parser = new StataParser();
    const result = parser.parse(tokens.tokens);
    const node = result.ast?.nodes?.[0];
    const cmd = node?.type === 'command' ? node : null;
    const errors = result.errors?.map(e => e.message) ?? [];
    return { cmd, errors };
}

/**
 * Parse source code and return the first command node.
 */
function parse(source: string): CommandNode | null {
    return parse_with_errors(source).cmd;
}

/**
 * Find frame prefix in a command's prefix list.
 */
function find_frame_prefix(cmd: CommandNode): PrefixNode | undefined {
    return cmd.prefix?.find(p => p.name === 'frame');
}

/**
 * Generate whitespace strings of varying lengths.
 */
function arbitrary_whitespace(): fc.Arbitrary<string> {
    return fc.integer({ min: 1, max: 5 }).map(n => ' '.repeat(n));
}

/**
 * Prefix commands that should not be used as main command names in tests.
 * These are treated specially by the parser and would be consumed as prefixes.
 */
const PREFIX_COMMANDS = ['by', 'bysort', 'quietly', 'qui', 'capture', 'cap', 'noisily', 'noi'];

/**
 * Generate identifiers that are not prefix commands.
 * Use this for command names that should not be treated as prefixes.
 */
function arbitrary_non_prefix_identifier(): fc.Arbitrary<string> {
    return arbitrary_non_reserved_identifier().filter(
        (id) => !PREFIX_COMMANDS.includes(id)
    );
}

describe('frame prefix whitespace tolerance property tests', () => {
    /**
     * Property 4: Frame Prefix Whitespace Tolerance
     * For any frame-prefixed command with whitespace after the colon, the parser
     * should skip trivia tokens appropriately and continue parsing without errors.
     * Validates: Requirements 4.1, 4.2, 4.5
     */
    it('should handle whitespace after frame prefix colon (Property 4)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_whitespace(),
                arbitrary_non_prefix_identifier(),
                (frame_name, whitespace, cmd_name) => {
                    const source = `frame ${frame_name}:${whitespace}${cmd_name} x`;
                    const { cmd, errors } = parse_with_errors(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    // Should not have "Expected command name" errors
                    const has_cmd_name_error = errors.some(e =>
                        e.includes('Expected command name')
                    );
                    expect(has_cmd_name_error).toBe(false);

                    // Command name should be parsed correctly
                    expect(cmd.name).toBe(cmd_name);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle whitespace with quietly prefix (Property 4)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_whitespace(),
                arbitrary_whitespace(),
                arbitrary_non_prefix_identifier(),
                (frame_name, ws1, ws2, cmd_name) => {
                    const source = `frame ${frame_name}:${ws1}quietly:${ws2}${cmd_name} x`;
                    const { cmd, errors } = parse_with_errors(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const has_cmd_name_error = errors.some(e =>
                        e.includes('Expected command name')
                    );
                    expect(has_cmd_name_error).toBe(false);

                    expect(cmd.name).toBe(cmd_name);

                    // Should have both frame and quietly prefixes
                    const frame_prefix = cmd.prefix?.find(p => p.name === 'frame');
                    const quietly_prefix = cmd.prefix?.find(p => p.name === 'quietly');
                    expect(frame_prefix).toBeDefined();
                    expect(quietly_prefix).toBeDefined();

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle no whitespace after colon (Property 4)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_prefix_identifier(),
                (frame_name, cmd_name) => {
                    const source = `frame ${frame_name}:${cmd_name} x`;
                    const { cmd, errors } = parse_with_errors(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const has_cmd_name_error = errors.some(e =>
                        e.includes('Expected command name')
                    );
                    expect(has_cmd_name_error).toBe(false);

                    expect(cmd.name).toBe(cmd_name);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('frame parsing path consistency property tests', () => {
    /**
     * Property 5: Frame Parsing Path Consistency
     * For any frame command that can be processed through different parsing paths,
     * the parsing results should be consistent.
     * Validates: Requirements 4.4
     */
    it('should produce consistent results regardless of whitespace (Property 5)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_prefix_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, cmd_name, var_name) => {
                    // Parse with no whitespace
                    const source_no_ws = `frame ${frame_name}:${cmd_name} ${var_name}`;
                    const cmd_no_ws = parse(source_no_ws);

                    // Parse with whitespace
                    const source_ws = `frame ${frame_name}:  ${cmd_name} ${var_name}`;
                    const cmd_ws = parse(source_ws);

                    expect(cmd_no_ws).not.toBeNull();
                    expect(cmd_ws).not.toBeNull();
                    if (!cmd_no_ws || !cmd_ws) return false;

                    // Command names should match
                    expect(cmd_no_ws.name).toBe(cmd_ws.name);

                    // Both should have frame prefix
                    const frame_no_ws = find_frame_prefix(cmd_no_ws);
                    const frame_ws = find_frame_prefix(cmd_ws);
                    expect(frame_no_ws).toBeDefined();
                    expect(frame_ws).toBeDefined();

                    // Frame names should match
                    expect(frame_no_ws?.frameName).toBe(frame_ws?.frameName);

                    // Varlist should match
                    expect(cmd_no_ws.varlist?.length).toBe(cmd_ws.varlist?.length);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle frame statement path consistently (Property 5)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, var_name) => {
                    // Test via parseCommand path (command context)
                    const source = `frame ${frame_name}: gen ${var_name} = 1`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    // Should have frame prefix
                    const frame_prefix = find_frame_prefix(cmd);
                    expect(frame_prefix).toBeDefined();
                    expect(frame_prefix?.frameName).toBe(frame_name);

                    // Command should be gen
                    expect(cmd.name).toBe('gen');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('frame prefix whitespace unit tests', () => {
    it('should handle frame myframe: quietly display', () => {
        const source = 'frame myframe:  quietly  display "test"';
        const { cmd, errors } = parse_with_errors(source);

        expect(cmd).not.toBeNull();
        expect(errors.filter(e => e.includes('Expected command name'))).toHaveLength(0);
        expect(cmd?.name).toBe('display');

        const frame_prefix = find_frame_prefix(cmd!);
        expect(frame_prefix?.frameName).toBe('myframe');
    });

    it('should handle frame myframe: noisily: gen', () => {
        const source = 'frame myframe:   noisily:   gen x = 1';
        const { cmd, errors } = parse_with_errors(source);

        expect(cmd).not.toBeNull();
        expect(errors.filter(e => e.includes('Expected command name'))).toHaveLength(0);
        expect(cmd?.name).toBe('gen');
    });
});

/**
 * Property tests for frame prefix parsing semantics.
 *
 * Feature: pr-feedback-fixes
 * Property 2: Frame prefix parsing semantics
 * Property 3: By-prefix parsing preservation
 * Validates: Requirements 3.1, 3.2, 3.3, 3.5
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { CommandNode, PrefixNode } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

/**
 * Parse source code and return AST nodes.
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
 * Find frame prefix in a command's prefix list.
 */
function find_frame_prefix(cmd: CommandNode): PrefixNode | undefined {
    return cmd.prefix?.find(p => p.name === 'frame');
}

/**
 * Find by prefix in a command's prefix list.
 */
function find_by_prefix(cmd: CommandNode): PrefixNode | undefined {
    return cmd.prefix?.find(p => p.name === 'by' || p.name === 'bysort');
}

describe('frame prefix parsing property tests', () => {
    /**
     * Property 2: Frame prefix parsing semantics
     * For any valid frame prefix command, the parser should create a PrefixNode
     * with frameName set to the frame identifier and varlist undefined or empty.
     */
    it('should store frame name in frameName field (Property 2)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (frame_name, var_name) => {
                    const source = `frame ${frame_name}: gen ${var_name} = 1`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const frame_prefix = find_frame_prefix(cmd);
                    expect(frame_prefix).toBeDefined();
                    if (!frame_prefix) return false;

                    // frameName should contain the frame identifier
                    expect(frame_prefix.frameName).toBe(frame_name);
                    // varlist should be undefined for frame prefixes
                    expect(frame_prefix.varlist).toBeUndefined();

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should set has_colon for frame prefixes (Property 2)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                (frame_name) => {
                    const source = `frame ${frame_name}: display "test"`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const frame_prefix = find_frame_prefix(cmd);
                    expect(frame_prefix).toBeDefined();
                    if (!frame_prefix) return false;

                    expect(frame_prefix.has_colon).toBe(true);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('by-prefix parsing property tests', () => {
    /**
     * Property 3: By-prefix parsing preservation
     * For any valid by-prefix command, the parser should create a PrefixNode
     * with frameName undefined (by-prefixes don't use frameName).
     * Note: varlist parsing for by-prefixes is not yet implemented (TODO in parser).
     */
    it('should not use frameName for by-prefix (Property 3)', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_non_reserved_identifier(), {
                    minLength: 1,
                    maxLength: 3,
                }),
                (the_vars) => {
                    const source = `by ${the_vars.join(' ')}: gen x = 1`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const by_prefix = find_by_prefix(cmd);
                    expect(by_prefix).toBeDefined();
                    if (!by_prefix) return false;

                    // frameName should be undefined for by-prefixes
                    expect(by_prefix.frameName).toBeUndefined();

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should not use frameName for bysort prefix (Property 3)', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (var1, var2) => {
                    const source = `bysort ${var1} ${var2}: summarize x`;
                    const cmd = parse(source);

                    expect(cmd).not.toBeNull();
                    if (!cmd) return false;

                    const by_prefix = find_by_prefix(cmd);
                    expect(by_prefix).toBeDefined();
                    if (!by_prefix) return false;

                    expect(by_prefix.frameName).toBeUndefined();

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

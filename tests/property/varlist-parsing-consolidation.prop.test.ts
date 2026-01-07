/**
 * Property tests for varlist parsing consolidation.
 *
 * Feature: varlist-parsing-consolidation
 * Property 1: AST Equivalence for Standard Commands
 * Property 2: Wildcard Operator Handling
 * Property 3: File Command Path Coalescing
 * Validates: Requirements 1.4, 2.1, 2.3, 2.4
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { CommandNode } from '../../src/types';
import { FILE_COMMANDS } from '../../src/utils/file-path-utils';
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

describe('Feature: varlist-parsing-consolidation', () => {
    /**
     * Property 1: AST Equivalence for Standard Commands
     * For any valid Stata command, parsing should produce correct AST with
     * proper varlist, expression, qualifiers, and options.
     * Validates: Requirements 1.4, 2.1
     */
    describe('Property 1: AST Equivalence for Standard Commands', () => {
        it('should parse commands with varlist correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 3 }),
                    (cmd_name, the_vars) => {
                        const source = `${cmd_name} ${the_vars.join(' ')}`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist!.length).toBe(the_vars.length);
                        for (let i = 0; i < the_vars.length; i++) {
                            expect(cmd!.varlist![i].name).toBe(the_vars[i]);
                        }
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse commands with expression correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    fc.integer({ min: 1, max: 100 }),
                    (cmd_name, var_name, value) => {
                        const source = `${cmd_name} ${var_name} = ${value}`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist![0].name).toBe(var_name);
                        expect(cmd!.expression).toBe(String(value));
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse commands with if-qualifier correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    fc.integer({ min: 1, max: 100 }),
                    (cmd_name, var_name, value) => {
                        const source = `${cmd_name} ${var_name} if x > ${value}`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist![0].name).toBe(var_name);
                        expect(cmd!.ifExpression).toBeDefined();
                        expect(cmd!.ifExpression).toContain(String(value));
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse commands with in-qualifier correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    fc.integer({ min: 1, max: 100 }),
                    (cmd_name, var_name, end_val) => {
                        const source = `${cmd_name} ${var_name} in 1/${end_val}`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist![0].name).toBe(var_name);
                        expect(cmd!.inExpression).toBeDefined();
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse commands with options correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    (cmd_name, var_name, opt_name) => {
                        const source = `${cmd_name} ${var_name}, ${opt_name}`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist![0].name).toBe(var_name);
                        expect(cmd!.options).toBeDefined();
                        expect(cmd!.options!.length).toBe(1);
                        expect(cmd!.options![0].name).toBe(opt_name);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse commands with option arguments correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    (cmd_name, var_name, opt_name, opt_arg) => {
                        const source = `${cmd_name} ${var_name}, ${opt_name}(${opt_arg})`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.options).toBeDefined();
                        expect(cmd!.options![0].name).toBe(opt_name);
                        expect(cmd!.options![0].argument).toBe(opt_arg);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse commands with parenthesized groups correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 3 }),
                    (cmd_name, the_vars) => {
                        const source = `${cmd_name} (${the_vars.join(' ')})`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist!.length).toBe(1);
                        expect(cmd!.varlist![0].name).toBe(`(${the_vars.join(' ')})`);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Wildcard Operator Handling
     * For any command with * or ? operators in varlist position,
     * the wildcards should appear correctly in the AST varlist.
     * Validates: Requirements 2.3
     */
    describe('Property 2: Wildcard Operator Handling', () => {


        it('should handle standalone * wildcard', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    (cmd_name) => {
                        const source = `${cmd_name} *`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist!.some(v => v.name === '*')).toBe(true);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: File Command Path Coalescing
     * For any file command (do, run, include) with various path formats,
     * the path tokens should be coalesced correctly.
     * Validates: Requirements 2.4
     */
    describe('Property 3: File Command Path Coalescing', () => {
        function arbitrary_file_command(): fc.Arbitrary<string> {
            return fc.constantFrom(...Array.from(FILE_COMMANDS));
        }

        function arbitrary_simple_path(): fc.Arbitrary<string> {
            return fc
                .array(fc.stringMatching(/^[a-zA-Z0-9_]+$/), { minLength: 1, maxLength: 3 })
                .map((parts) => parts.join('/') + '.do');
        }

        it('should coalesce unquoted file paths', () => {
            fc.assert(
                fc.property(
                    arbitrary_file_command(),
                    arbitrary_simple_path(),
                    (cmd_name, file_path) => {
                        const source = `${cmd_name} ${file_path}`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist!.length).toBe(1);
                        expect(cmd!.varlist![0].name).toBe(file_path);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle file paths with options', () => {
            fc.assert(
                fc.property(
                    arbitrary_file_command(),
                    arbitrary_simple_path(),
                    arbitrary_non_reserved_identifier(),
                    (cmd_name, file_path, opt_name) => {
                        const source = `${cmd_name} ${file_path}, ${opt_name}`;
                        const cmd = parse(source);

                        expect(cmd).not.toBeNull();
                        expect(cmd!.name).toBe(cmd_name);
                        expect(cmd!.varlist).toBeDefined();
                        expect(cmd!.varlist![0].name).toBe(file_path);
                        expect(cmd!.options).toBeDefined();
                        expect(cmd!.options![0].name).toBe(opt_name);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Additional Property: Consistency with Frame-Prefixed Commands
     * Standard commands should produce equivalent varlist/option parsing
     * as frame-prefixed commands (which already use parseCommandBody).
     * Validates: Requirements 1.4, 2.1
     */
    describe('Additional Property: Consistency with Frame-Prefixed Commands', () => {
        it('should produce consistent varlist between direct and frame-prefixed', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 3 }),
                    (frame_name, cmd_name, the_vars) => {
                        const direct_source = `${cmd_name} ${the_vars.join(' ')}`;
                        const frame_source = `frame ${frame_name}: ${cmd_name} ${the_vars.join(' ')}`;

                        const direct_cmd = parse(direct_source);
                        const frame_cmd = parse(frame_source);

                        expect(direct_cmd).not.toBeNull();
                        expect(frame_cmd).not.toBeNull();

                        // Varlist should match
                        expect(direct_cmd!.varlist?.length).toBe(frame_cmd!.varlist?.length);
                        for (let i = 0; i < (direct_cmd!.varlist?.length ?? 0); i++) {
                            expect(direct_cmd!.varlist![i].name).toBe(frame_cmd!.varlist![i].name);
                        }
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should produce consistent options between direct and frame-prefixed', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    (frame_name, cmd_name, var_name, opt_name) => {
                        const direct_source = `${cmd_name} ${var_name}, ${opt_name}`;
                        const frame_source = `frame ${frame_name}: ${cmd_name} ${var_name}, ${opt_name}`;

                        const direct_cmd = parse(direct_source);
                        const frame_cmd = parse(frame_source);

                        expect(direct_cmd).not.toBeNull();
                        expect(frame_cmd).not.toBeNull();

                        // Options should match
                        expect(direct_cmd!.options?.length).toBe(frame_cmd!.options?.length);
                        expect(direct_cmd!.options![0].name).toBe(frame_cmd!.options![0].name);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should produce consistent qualifiers between direct and frame-prefixed', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    fc.integer({ min: 1, max: 100 }),
                    (frame_name, cmd_name, var_name, value) => {
                        const direct_source = `${cmd_name} ${var_name} if x > ${value}`;
                        const frame_source = `frame ${frame_name}: ${cmd_name} ${var_name} if x > ${value}`;

                        const direct_cmd = parse(direct_source);
                        const frame_cmd = parse(frame_source);

                        expect(direct_cmd).not.toBeNull();
                        expect(frame_cmd).not.toBeNull();

                        // If-expression should match
                        expect(direct_cmd!.ifExpression).toBe(frame_cmd!.ifExpression);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

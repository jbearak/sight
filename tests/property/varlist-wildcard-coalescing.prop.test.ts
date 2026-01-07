/**
 * Property tests for varlist wildcard coalescing.
 *
 * Feature: varlist-wildcard-coalescing
 * 
 * Tests that wildcard patterns like `var*` are parsed as single VarlistItems
 * instead of separate tokens, ensuring the AST accurately represents Stata's
 * variable expansion semantics.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { CommandNode, StataNode } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

/**
 * Parse source code and return AST nodes.
 */
function parse(source: string): StataNode[] {
    const lexer = new StataLexer();
    const tokens = lexer.tokenize(source);
    const parser = new StataParser();
    const result = parser.parse(tokens.tokens);
    return result.ast?.nodes ?? [];
}

/**
 * Find all command nodes in the AST.
 */
function find_command_nodes(nodes: StataNode[]): CommandNode[] {
    const commands: CommandNode[] = [];
    for (const node of nodes) {
        if (node.type === 'command') {
            commands.push(node);
        }
    }
    return commands;
}

/**
 * Generator for wildcard suffixes (* or ?).
 */
function arbitrary_wildcard(): fc.Arbitrary<string> {
    return fc.constantFrom('*', '?');
}

/**
 * Generator for multiple wildcard suffixes (e.g., **, ??, *?).
 */
function arbitrary_wildcard_suffix(): fc.Arbitrary<string> {
    return fc.array(arbitrary_wildcard(), { minLength: 1, maxLength: 3 })
        .map(wildcards => wildcards.join(''));
}

/**
 * Generator for valid Stata commands that accept varlists.
 */
function arbitrary_varlist_command(): fc.Arbitrary<string> {
    return fc.constantFrom('describe', 'summarize', 'list', 'drop', 'keep', 'rename');
}

describe('Feature: varlist-wildcard-coalescing', () => {
    describe('Property 1: Wildcard Coalescing', () => {
        /**
         * For any WORD token immediately followed by one or more wildcard tokens
         * (* or ?) without whitespace, the parser SHALL produce a single VarlistItem
         * with the combined name.
         * 
         * Validates: Requirements 1.1, 1.2, 5.1, 5.2
         */
        it('should coalesce adjacent WORD + wildcard into single VarlistItem', () => {
            fc.assert(
                fc.property(
                    arbitrary_varlist_command(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_wildcard_suffix(),
                    (cmd, prefix, wildcard_suffix) => {
                        const source = `${cmd} ${prefix}${wildcard_suffix}`;
                        const nodes = parse(source);
                        const commands = find_command_nodes(nodes);
                        
                        expect(commands.length).toBe(1);
                        const command = commands[0];
                        expect(command.varlist).toBeDefined();
                        expect(command.varlist!.length).toBe(1);
                        
                        // The varlist item should have the combined name
                        const item = command.varlist![0];
                        expect(item.name).toBe(`${prefix}${wildcard_suffix}`);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should coalesce multiple consecutive wildcards (e.g., var??)', () => {
            fc.assert(
                fc.property(
                    arbitrary_varlist_command(),
                    arbitrary_non_reserved_identifier(),
                    fc.integer({ min: 1, max: 4 }),
                    (cmd, prefix, wildcard_count) => {
                        const wildcards = '?'.repeat(wildcard_count);
                        const source = `${cmd} ${prefix}${wildcards}`;
                        const nodes = parse(source);
                        const commands = find_command_nodes(nodes);
                        
                        expect(commands.length).toBe(1);
                        const command = commands[0];
                        expect(command.varlist).toBeDefined();
                        expect(command.varlist!.length).toBe(1);
                        expect(command.varlist![0].name).toBe(`${prefix}${wildcards}`);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 2: Range Correctness', () => {
        /**
         * For any coalesced wildcard pattern, the VarlistItem's range SHALL span
         * from the start of the WORD token to the end of the last wildcard token.
         * 
         * Validates: Requirements 1.3
         */
        it('should set range spanning from WORD start to wildcard end', () => {
            fc.assert(
                fc.property(
                    arbitrary_varlist_command(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_wildcard_suffix(),
                    (cmd, prefix, wildcard_suffix) => {
                        const source = `${cmd} ${prefix}${wildcard_suffix}`;
                        const nodes = parse(source);
                        const commands = find_command_nodes(nodes);
                        
                        expect(commands.length).toBe(1);
                        const command = commands[0];
                        expect(command.varlist).toBeDefined();
                        
                        const item = command.varlist![0];
                        const expected_start = cmd.length + 1; // command + space
                        const expected_end = expected_start + prefix.length + wildcard_suffix.length;
                        
                        expect(item.range.start.character).toBe(expected_start);
                        expect(item.range.end.character).toBe(expected_end);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 3: Whitespace Separation', () => {
        /**
         * For any WORD token followed by a wildcard token with intervening whitespace,
         * the parser SHALL produce two separate VarlistItems.
         * 
         * Validates: Requirements 1.4
         */
        it('should NOT coalesce when whitespace separates WORD and wildcard', () => {
            fc.assert(
                fc.property(
                    arbitrary_varlist_command(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_wildcard(),
                    (cmd, prefix, wildcard) => {
                        // Add whitespace between prefix and wildcard
                        const source = `${cmd} ${prefix} ${wildcard}`;
                        const nodes = parse(source);
                        const commands = find_command_nodes(nodes);
                        
                        expect(commands.length).toBe(1);
                        const command = commands[0];
                        expect(command.varlist).toBeDefined();
                        
                        // Should have two separate items
                        expect(command.varlist!.length).toBe(2);
                        expect(command.varlist![0].name).toBe(prefix);
                        expect(command.varlist![1].name).toBe(wildcard);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 4: Multiple Pattern Independence', () => {
        /**
         * For any command containing N wildcard patterns (each being a WORD
         * immediately followed by wildcards), the parser SHALL produce exactly
         * N coalesced VarlistItems for those patterns.
         * 
         * Validates: Requirements 2.1, 2.2, 2.3
         */
        it('should coalesce multiple patterns independently', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.tuple(
                            arbitrary_non_reserved_identifier(),
                            arbitrary_wildcard_suffix()
                        ),
                        { minLength: 2, maxLength: 4 }
                    ),
                    (patterns) => {
                        const varlist = patterns.map(([prefix, suffix]) => `${prefix}${suffix}`).join(' ');
                        const source = `describe ${varlist}`;
                        const nodes = parse(source);
                        const commands = find_command_nodes(nodes);
                        
                        expect(commands.length).toBe(1);
                        const command = commands[0];
                        expect(command.varlist).toBeDefined();
                        expect(command.varlist!.length).toBe(patterns.length);
                        
                        // Each pattern should be coalesced correctly
                        for (let i = 0; i < patterns.length; i++) {
                            const [prefix, suffix] = patterns[i];
                            expect(command.varlist![i].name).toBe(`${prefix}${suffix}`);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle mixed varlists (wildcards + regular variables)', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_wildcard_suffix(),
                    arbitrary_non_reserved_identifier(),
                    (prefix, suffix, regular_var) => {
                        // Ensure regular_var is different from prefix
                        if (regular_var === prefix) {
                            regular_var = regular_var + '2';
                        }
                        
                        const source = `summarize ${prefix}${suffix} ${regular_var}`;
                        const nodes = parse(source);
                        const commands = find_command_nodes(nodes);
                        
                        expect(commands.length).toBe(1);
                        const command = commands[0];
                        expect(command.varlist).toBeDefined();
                        expect(command.varlist!.length).toBe(2);
                        expect(command.varlist![0].name).toBe(`${prefix}${suffix}`);
                        expect(command.varlist![1].name).toBe(regular_var);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 5: Expression Context Preservation', () => {
        /**
         * For any command with an assignment expression (containing `=`),
         * wildcard operators appearing after the `=` SHALL NOT be coalesced
         * with preceding tokens.
         * 
         * Validates: Requirements 3.1, 3.2
         */
        it('should NOT coalesce * in expression context (after =)', () => {
            fc.assert(
                fc.property(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    fc.integer({ min: 1, max: 100 }),
                    (new_var, existing_var, multiplier) => {
                        const source = `generate ${new_var} = ${existing_var}*${multiplier}`;
                        const nodes = parse(source);
                        const commands = find_command_nodes(nodes);
                        
                        expect(commands.length).toBe(1);
                        const command = commands[0];
                        
                        // The varlist should only contain the new variable name
                        expect(command.varlist).toBeDefined();
                        expect(command.varlist!.length).toBe(1);
                        expect(command.varlist![0].name).toBe(new_var);
                        
                        // The expression should contain the multiplication
                        expect(command.expression).toBeDefined();
                        expect(command.expression).toContain('*');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Unit Tests: Edge Cases', () => {
        it('should parse describe var* as single item var*', () => {
            const nodes = parse('describe var*');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(1);
            expect(commands[0].varlist![0].name).toBe('var*');
        });

        it('should parse describe x? as single item x?', () => {
            const nodes = parse('describe x?');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(1);
            expect(commands[0].varlist![0].name).toBe('x?');
        });

        it('should parse describe var?? as single item var??', () => {
            const nodes = parse('describe var??');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(1);
            expect(commands[0].varlist![0].name).toBe('var??');
        });

        it('should parse rename old* new* as two items', () => {
            const nodes = parse('rename old* new*');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(2);
            expect(commands[0].varlist![0].name).toBe('old*');
            expect(commands[0].varlist![1].name).toBe('new*');
        });

        it('should parse summarize var* other as two items', () => {
            const nodes = parse('summarize var* other');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(2);
            expect(commands[0].varlist![0].name).toBe('var*');
            expect(commands[0].varlist![1].name).toBe('other');
        });

        it('should parse describe var * as two items (whitespace separation)', () => {
            const nodes = parse('describe var *');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(2);
            expect(commands[0].varlist![0].name).toBe('var');
            expect(commands[0].varlist![1].name).toBe('*');
        });

        it('should parse describe _* as single item _*', () => {
            const nodes = parse('describe _*');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(1);
            expect(commands[0].varlist![0].name).toBe('_*');
        });

        it('should parse describe my_var* as single item my_var*', () => {
            const nodes = parse('describe my_var*');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(1);
            expect(commands[0].varlist![0].name).toBe('my_var*');
        });

        it('should NOT coalesce * in generate y = x*2', () => {
            const nodes = parse('generate y = x*2');
            const commands = find_command_nodes(nodes);
            
            expect(commands.length).toBe(1);
            expect(commands[0].varlist).toBeDefined();
            expect(commands[0].varlist!.length).toBe(1);
            expect(commands[0].varlist![0].name).toBe('y');
            expect(commands[0].expression).toBe('x*2');
        });
    });
});

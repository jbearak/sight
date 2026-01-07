/**
 * Property tests for unab command colon field handling.
 *
 * Tests the has_colon_before_varlist field on CommandNode and validates
 * that varlists contain only variable names, not syntax tokens like colons.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { CodeFormatter } from '../../src/providers/formatter';
import { CommandNode, StataNode } from '../../src/types';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
} from './helpers/formatter-test-utils';
import { apply_edits, find_command_nodes, create_document_state } from './helpers';
import { arbitrary_non_reserved_identifier } from './generators';

/**
 * Parse source code and return AST.
 */
function parse(source: string): StataNode[] {
    const lexer = new StataLexer();
    const tokens = lexer.tokenize(source);
    const parser = new StataParser();
    const result = parser.parse(tokens.tokens);
    return result.ast?.nodes ?? [];
}

/**
 * Generator for unab commands with colons.
 */
function arbitrary_unab_command_with_colon(): fc.Arbitrary<string> {
    return fc.tuple(
        arbitrary_non_reserved_identifier(),
        fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 3 })
    ).map(([macro_name, vars]) => `unab ${macro_name}: ${vars.join(' ')}`);
}

/**
 * Generator for unab commands (may or may not have colon).
 */
function arbitrary_unab_command(): fc.Arbitrary<string> {
    return fc.oneof(
        arbitrary_unab_command_with_colon(),
        // Without colon (error case, but should still parse)
        fc.tuple(
            arbitrary_non_reserved_identifier(),
            fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 3 })
        ).map(([macro_name, vars]) => `unab ${macro_name} ${vars.join(' ')}`)
    );
}

describe('CommandNode has_colon_before_varlist field', () => {
    it('should accept has_colon_before_varlist field (type check)', () => {
        // This test validates that the type system accepts the field
        const node: CommandNode = {
            type: 'command',
            name: 'unab',
            fullName: 'unab',
            has_colon_before_varlist: true,
            varlist: [{ name: 'myvar', range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } } }],
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
        };
        expect(node.has_colon_before_varlist).toBe(true);
    });

    it('should accept undefined has_colon_before_varlist field (backward compatibility)', () => {
        const node: CommandNode = {
            type: 'command',
            name: 'unab',
            fullName: 'unab',
            varlist: [{ name: 'myvar', range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } } }],
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
        };
        expect(node.has_colon_before_varlist).toBeUndefined();
    });
});

describe('Unab command colon field consistency (Property 2)', () => {
    it('should set has_colon_before_varlist=true when colon is present', () => {
        fc.assert(
            fc.property(arbitrary_unab_command_with_colon(), (source) => {
                const ast = parse(source);
                const the_commands = find_command_nodes(ast);
                const unab_cmd = the_commands.find(c => c.name === 'unab');
                
                expect(unab_cmd).toBeDefined();
                expect(unab_cmd!.has_colon_before_varlist).toBe(true);
                
                // Verify no colon in varlist
                const has_colon_in_varlist = unab_cmd!.varlist?.some(v => v.name === ':');
                expect(has_colon_in_varlist).toBe(false);
            }),
            { numRuns: 100 }
        );
    });
});

describe('Varlist purity (Property 1)', () => {
    it('should not contain colon tokens in varlist', () => {
        fc.assert(
            fc.property(arbitrary_unab_command(), (source) => {
                const ast = parse(source);
                const the_commands = find_command_nodes(ast);
                
                for (const my_cmd of the_commands) {
                    if (my_cmd.varlist) {
                        const has_colon = my_cmd.varlist.some(v => v.name === ':');
                        expect(has_colon).toBe(false);
                    }
                }
            }),
            { numRuns: 100 }
        );
    });
});

describe('Unab round trip (Property 6)', () => {
    for_each_formatter_mode_property(
        'should preserve colon and varlist structure through parse-format-parse',
        arbitrary_unab_command_with_colon(),
        (mode, source) => {
            const config = create_formatter_config(mode);
            
            // First parse
            const ast1 = parse(source);
            const cmd1 = find_command_nodes(ast1).find(c => c.name === 'unab');
            expect(cmd1).toBeDefined();
            expect(cmd1!.has_colon_before_varlist).toBe(true);
            
            // Format
            const doc_state = create_document_state(source);
            const formatter = new CodeFormatter();
            const edits = formatter.format(doc_state, { tabSize: 4, insertSpaces: true }, config);
            const formatted = apply_edits(source, edits);
            
            // Second parse
            const ast2 = parse(formatted);
            const cmd2 = find_command_nodes(ast2).find(c => c.name === 'unab');
            expect(cmd2).toBeDefined();
            expect(cmd2!.has_colon_before_varlist).toBe(true);
            
            // Varlist should have same length (excluding colon)
            expect(cmd2!.varlist?.length).toBe(cmd1!.varlist?.length);
        },
        100
    );
});

describe('AST structure integrity (Property 9)', () => {
    it('should not have colon in varlist when has_colon_before_varlist is true', () => {
        fc.assert(
            fc.property(arbitrary_unab_command_with_colon(), (source) => {
                const ast = parse(source);
                const the_commands = find_command_nodes(ast);
                
                for (const my_cmd of the_commands) {
                    if (my_cmd.has_colon_before_varlist === true) {
                        const has_colon = my_cmd.varlist?.some(v => v.name === ':');
                        expect(has_colon).toBe(false);
                    }
                }
            }),
            { numRuns: 100 }
        );
    });
});

describe('Backward compatibility (Requirement 5.5)', () => {
    /**
     * Test that old-style ASTs with colons in varlists are handled correctly.
     * This ensures backward compatibility with ASTs created before the
     * has_colon_before_varlist field was added.
     */
    it('should format old-style AST with colon in varlist correctly', () => {
        // Import PrettyPrinter for direct AST formatting
        const { print_ast } = require('../../src/pretty-printer');
        
        // Create an old-style AST with colon in varlist (no has_colon_before_varlist field)
        const old_style_ast = {
            nodes: [{
                type: 'command',
                name: 'unab',
                fullName: 'unab',
                // Old ASTs had colon as a varlist item
                varlist: [
                    { name: 'myvar', range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } } },
                    { name: ':', range: { start: { line: 0, character: 11 }, end: { line: 0, character: 12 } } },
                    { name: 'var1', range: { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } } },
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } },
            }],
        };
        
        const output = print_ast(old_style_ast);
        
        // Colon should be preserved in output
        expect(output).toContain(':');
        // Should have the macro name
        expect(output).toContain('myvar');
        // Should have the variable
        expect(output).toContain('var1');
    });

    it('should format new-style AST with has_colon_before_varlist correctly', () => {
        const { print_ast } = require('../../src/pretty-printer');
        
        // Create a new-style AST with has_colon_before_varlist field
        const new_style_ast = {
            nodes: [{
                type: 'command',
                name: 'unab',
                fullName: 'unab',
                has_colon_before_varlist: true,
                varlist: [
                    { name: 'myvar', range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } } },
                    { name: 'var1', range: { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } } },
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } },
            }],
        };
        
        const output = print_ast(new_style_ast);
        
        // Colon should be emitted after macro name
        expect(output).toContain('myvar:');
        // Should have the variable
        expect(output).toContain('var1');
    });
});

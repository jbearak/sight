/**
 * Pretty Printer Frame Block Deletion Property Tests
 *
 * Feature: pretty-printer-frame-block-deletion
 * Tests that verify the pretty printer correctly preserves frame blocks
 * and prefix command brace blocks during formatting.
 *
 * Validates: Requirements 1.1-1.5, 2.1-2.5, 3.1-3.5, 4.1-4.5, 5.1-5.4
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { PrettyPrinter, print_ast } from '../../src/pretty-printer';
import { StataLexer, StataParser } from '../../src/index';
import { ControlFlowNode, CommandNode, StataAST, StataNode, Range } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';
import { apply_edits, create_document_state } from './helpers';

/**
 * Helper to create a Range object.
 */
function make_range(
    start_line: number,
    start_char: number,
    end_line: number,
    end_char: number
): Range {
    return {
        start: { line: start_line, character: start_char },
        end: { line: end_line, character: end_char },
    };
}

/**
 * Helper to parse source and get AST
 */
function parse_source(source: string): StataAST {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const lex_result = lexer.tokenize(source);
    return parser.parse(lex_result.tokens).ast;
}

/**
 * Format source using CodeFormatter with specified mode.
 */
function formatWithMode(source: string, mode: FormatterMode): string {
    const config = create_formatter_config(mode);
    const doc_state = create_document_state(source);
    const formatter = new CodeFormatter();
    const edits = formatter.format(doc_state, { tabSize: 4, insertSpaces: true }, config);
    return apply_edits(source, edits);
}

/**
 * Generator for valid Stata frame names (identifiers)
 * Uses shared generator that excludes reserved keywords
 */
const arbitrary_frame_name = arbitrary_non_reserved_identifier();

/**
 * Generator for simple command names
 */
const arbitrary_command = fc.constantFrom('display', 'sum', 'list', 'describe', 'clear', 'count');

/**
 * Generator for prefix commands that support brace blocks
 */
const arbitrary_prefix_command = fc.constantFrom('capture', 'quietly', 'noisily', 'cap', 'qui');

/**
 * Generator for simple statements
 */
const arbitrary_statement = fc.constantFrom(
    'display "hello"',
    'gen x = 1',
    'local y = 2',
    'count',
    'sum'
);

describe('Pretty Printer Frame Block Deletion Property Tests', () => {
    const printer = new PrettyPrinter();

    // =========================================================================
    // Property 1: Frame Block Preservation
    // =========================================================================
    describe('Property 1: Frame Block Preservation', () => {
        /**
         * Property 1: Frame Block Preservation
         * For any valid frame block AST node, when formatted by the PrettyPrinter,
         * the output should contain a frame block with the same frame name and
         * all body statements preserved.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 1: Frame Block Preservation
         * Validates: Requirements 1.1, 1.3, 1.4
         */
        it('should preserve frame blocks with correct frame name', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        // Create a frame block AST node
                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(1, 4, 1, 4 + cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [frame_node] };
                        const output = print_ast(ast);

                        // Output should contain frame keyword
                        expect(output).toContain('frame');
                        // Output should contain frame name
                        expect(output).toContain(frame_name);
                        // Output should contain the command
                        expect(output).toContain(cmd);
                        // Output should have opening and closing braces
                        expect(output).toContain('{');
                        expect(output).toContain('}');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should preserve frame blocks with multiple commands', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    fc.array(arbitrary_command, { minLength: 1, maxLength: 5 }),
                    (frame_name, commands) => {
                        const body_nodes: CommandNode[] = commands.map((cmd, idx) => ({
                            type: 'command',
                            name: cmd,
                            fullName: cmd,
                            range: make_range(idx + 1, 4, idx + 1, 4 + cmd.length),
                        }));

                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: body_nodes,
                            range: make_range(0, 0, commands.length + 1, 1),
                        };

                        const ast: StataAST = { nodes: [frame_node] };
                        const output = print_ast(ast);

                        // All commands should be in output
                        for (const cmd of commands) {
                            expect(output).toContain(cmd);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should preserve nested frame blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_frame_name,
                    arbitrary_command,
                    (outer_frame, inner_frame, cmd) => {
                        const inner_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: inner_frame,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(2, 8, 2, 8 + cmd.length),
                            }],
                            range: make_range(1, 4, 3, 5),
                        };

                        const outer_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: outer_frame,
                            body: [inner_node],
                            range: make_range(0, 0, 4, 1),
                        };

                        const ast: StataAST = { nodes: [outer_node] };
                        const output = print_ast(ast);

                        // Both frame names should be present
                        expect(output).toContain(outer_frame);
                        expect(output).toContain(inner_frame);
                        // Command should be present
                        expect(output).toContain(cmd);
                        // Should have multiple braces
                        expect((output.match(/{/g) || []).length).toBeGreaterThanOrEqual(2);
                        expect((output.match(/}/g) || []).length).toBeGreaterThanOrEqual(2);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property 2: Frame Block Format Correctness
    // =========================================================================
    describe('Property 2: Frame Block Format Correctness', () => {
        /**
         * Property 2: Frame Block Format Correctness
         * For any valid frame block, the formatted output should follow the pattern
         * `frame framename {` with the opening brace on the same line.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 2: Frame Block Format Correctness
         * Validates: Requirements 2.1, 2.2, 2.4
         */
        it('should format frame blocks with opening brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(1, 4, 1, 4 + cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [frame_node] };
                        const output = print_ast(ast);
                        const the_lines = output.split('\n');

                        // First line should have format: frame framename {
                        expect(the_lines[0]).toMatch(new RegExp(`^frame\\s+${frame_name}\\s*\\{$`));

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should place closing brace on its own line', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(1, 4, 1, 4 + cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [frame_node] };
                        const output = print_ast(ast);
                        const the_lines = output.split('\n').filter(l => l.trim());

                        // Last non-empty line should be just the closing brace
                        const last_line = the_lines[the_lines.length - 1];
                        expect(last_line.trim()).toBe('}');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property 3: Frame Block Indentation
    // =========================================================================
    describe('Property 3: Frame Block Indentation', () => {
        /**
         * Property 3: Frame Block Indentation
         * For any valid frame block, the body statements should be indented
         * exactly one level deeper than the frame command line.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 3: Frame Block Indentation
         * Validates: Requirements 1.5, 2.3
         */
        it('should indent body statements one level deeper', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(1, 4, 1, 4 + cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [frame_node] };
                        const output = print_ast(ast, { indent_size: 4, indent_style: 'spaces', line_width: 80 });
                        const the_lines = output.split('\n');

                        // First line (frame command) should have no indentation
                        expect(the_lines[0]).toMatch(/^frame/);

                        // Body line should be indented by 4 spaces
                        const body_line = the_lines.find(l => l.includes(cmd));
                        expect(body_line).toBeDefined();
                        expect(body_line!.startsWith('    ')).toBe(true);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});


describe('Pretty Printer Prefix Command Brace Block Property Tests', () => {
    const printer = new PrettyPrinter();

    // =========================================================================
    // Property 4: Prefix Command Brace Block Preservation
    // =========================================================================
    describe('Property 4: Prefix Command Brace Block Preservation', () => {
        /**
         * Property 4: Prefix Command Brace Block Preservation
         * For any valid CommandNode with a body property, when formatted by the
         * PrettyPrinter, the output should contain a brace block with the command
         * name and all body statements preserved.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 4: Prefix Command Brace Block Preservation
         * Validates: Requirements 3.1, 3.3, 3.4
         */
        it('should preserve prefix command brace blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    arbitrary_command,
                    (prefix_cmd, body_cmd) => {
                        const cmd_node: CommandNode = {
                            type: 'command',
                            name: prefix_cmd,
                            fullName: prefix_cmd,
                            body: [{
                                type: 'command',
                                name: body_cmd,
                                fullName: body_cmd,
                                range: make_range(1, 4, 1, 4 + body_cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [cmd_node] };
                        const output = print_ast(ast);

                        // Output should contain prefix command
                        expect(output).toContain(prefix_cmd);
                        // Output should contain body command
                        expect(output).toContain(body_cmd);
                        // Output should have braces
                        expect(output).toContain('{');
                        expect(output).toContain('}');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should preserve prefix command brace blocks with multiple statements', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    fc.array(arbitrary_command, { minLength: 1, maxLength: 5 }),
                    (prefix_cmd, body_commands) => {
                        const body_nodes: CommandNode[] = body_commands.map((cmd, idx) => ({
                            type: 'command',
                            name: cmd,
                            fullName: cmd,
                            range: make_range(idx + 1, 4, idx + 1, 4 + cmd.length),
                        }));

                        const cmd_node: CommandNode = {
                            type: 'command',
                            name: prefix_cmd,
                            fullName: prefix_cmd,
                            body: body_nodes,
                            range: make_range(0, 0, body_commands.length + 1, 1),
                        };

                        const ast: StataAST = { nodes: [cmd_node] };
                        const output = print_ast(ast);

                        // All body commands should be in output
                        for (const cmd of body_commands) {
                            expect(output).toContain(cmd);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should preserve nested prefix command brace blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    arbitrary_prefix_command,
                    arbitrary_command,
                    (outer_prefix, inner_prefix, cmd) => {
                        const inner_node: CommandNode = {
                            type: 'command',
                            name: inner_prefix,
                            fullName: inner_prefix,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(2, 8, 2, 8 + cmd.length),
                            }],
                            range: make_range(1, 4, 3, 5),
                        };

                        const outer_node: CommandNode = {
                            type: 'command',
                            name: outer_prefix,
                            fullName: outer_prefix,
                            body: [inner_node],
                            range: make_range(0, 0, 4, 1),
                        };

                        const ast: StataAST = { nodes: [outer_node] };
                        const output = print_ast(ast);

                        // Both prefix commands should be present
                        expect(output).toContain(outer_prefix);
                        expect(output).toContain(inner_prefix);
                        // Command should be present
                        expect(output).toContain(cmd);
                        // Should have multiple braces
                        expect((output.match(/{/g) || []).length).toBeGreaterThanOrEqual(2);
                        expect((output.match(/}/g) || []).length).toBeGreaterThanOrEqual(2);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should preserve standalone brace blocks', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: '{',
                fullName: '{',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    varlist: [{ name: '"test"', range: make_range(1, 12, 1, 18) }],
                    range: make_range(1, 4, 1, 18),
                }],
                range: make_range(0, 0, 2, 1),
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);

            // Output should have braces
            expect(output).toContain('{');
            expect(output).toContain('}');
            // Output should contain the body command
            expect(output).toContain('display');
        });
    });

    // =========================================================================
    // Property 5: Prefix Command Brace Block Format Correctness
    // =========================================================================
    describe('Property 5: Prefix Command Brace Block Format Correctness', () => {
        /**
         * Property 5: Prefix Command Brace Block Format Correctness
         * For any valid prefix command brace block, the formatted output should
         * follow the pattern `command {` with the opening brace on the same line.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 5: Prefix Command Brace Block Format Correctness
         * Validates: Requirements 4.1, 4.2, 4.4
         */
        it('should format prefix command brace blocks with opening brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    arbitrary_command,
                    (prefix_cmd, body_cmd) => {
                        const cmd_node: CommandNode = {
                            type: 'command',
                            name: prefix_cmd,
                            fullName: prefix_cmd,
                            body: [{
                                type: 'command',
                                name: body_cmd,
                                fullName: body_cmd,
                                range: make_range(1, 4, 1, 4 + body_cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [cmd_node] };
                        const output = print_ast(ast);
                        const the_lines = output.split('\n');

                        // First line should have format: prefix_cmd {
                        expect(the_lines[0]).toMatch(new RegExp(`^${prefix_cmd}\\s*\\{$`));

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should place closing brace on its own line', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    arbitrary_command,
                    (prefix_cmd, body_cmd) => {
                        const cmd_node: CommandNode = {
                            type: 'command',
                            name: prefix_cmd,
                            fullName: prefix_cmd,
                            body: [{
                                type: 'command',
                                name: body_cmd,
                                fullName: body_cmd,
                                range: make_range(1, 4, 1, 4 + body_cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [cmd_node] };
                        const output = print_ast(ast);
                        const the_lines = output.split('\n').filter(l => l.trim());

                        // Last non-empty line should be just the closing brace
                        const last_line = the_lines[the_lines.length - 1];
                        expect(last_line.trim()).toBe('}');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property 6: Prefix Command Brace Block Indentation
    // =========================================================================
    describe('Property 6: Prefix Command Brace Block Indentation', () => {
        /**
         * Property 6: Prefix Command Brace Block Indentation
         * For any valid prefix command brace block, the body statements should
         * be indented exactly one level deeper than the command line.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 6: Prefix Command Brace Block Indentation
         * Validates: Requirements 3.5, 4.3
         */
        it('should indent body statements one level deeper', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    arbitrary_command,
                    (prefix_cmd, body_cmd) => {
                        const cmd_node: CommandNode = {
                            type: 'command',
                            name: prefix_cmd,
                            fullName: prefix_cmd,
                            body: [{
                                type: 'command',
                                name: body_cmd,
                                fullName: body_cmd,
                                range: make_range(1, 4, 1, 4 + body_cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [cmd_node] };
                        const output = print_ast(ast, { indent_size: 4, indent_style: 'spaces', line_width: 80 });
                        const the_lines = output.split('\n');

                        // First line (prefix command) should have no indentation
                        expect(the_lines[0]).toMatch(new RegExp(`^${prefix_cmd}`));

                        // Body line should be indented by 4 spaces
                        const body_line = the_lines.find(l => l.includes(body_cmd));
                        expect(body_line).toBeDefined();
                        expect(body_line!.startsWith('    ')).toBe(true);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});


describe('Pretty Printer Delimiter Mode and Consistency Property Tests', () => {
    // =========================================================================
    // Property 7: Delimiter Mode Handling
    // =========================================================================
    describe('Property 7: Delimiter Mode Handling', () => {
        /**
         * Property 7: Delimiter Mode Handling
         * For any frame block or prefix command brace block, the statement
         * terminator after the closing brace should be a newline in cr mode
         * and a semicolon followed by newline in semicolon mode.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 7: Delimiter Mode Handling
         * Validates: Requirements 2.5, 4.5, 5.4
         */
        it('should use newline terminator in cr mode for frame blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(1, 4, 1, 4 + cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [frame_node] };
                        const output = print_ast(ast);

                        // In cr mode (default), lines should end with newline, not semicolon
                        const the_lines = output.split('\n');
                        for (const line of the_lines) {
                            if (line.trim()) {
                                expect(line.endsWith(';')).toBe(false);
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use semicolon terminator in semicolon mode for frame blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        // Create AST with #delimit ; directive followed by frame block
                        const directive_node: StataNode = {
                            type: 'directive',
                            directive: 'delimit',
                            mode: 'semicolon',
                            range: make_range(0, 0, 0, 12),
                        };

                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(2, 4, 2, 4 + cmd.length),
                            }],
                            range: make_range(1, 0, 3, 1),
                        };

                        const ast: StataAST = { nodes: [directive_node, frame_node] };
                        const output = print_ast(ast);

                        // After #delimit ;, body command lines should end with semicolon
                        const the_lines = output.split('\n');
                        // Find the body command line and verify it has semicolon
                        const body_line = the_lines.find(l => l.includes(cmd));
                        expect(body_line).toBeDefined();
                        expect(body_line!.trim().endsWith(';')).toBe(true);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use newline terminator in cr mode for prefix command brace blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    arbitrary_command,
                    (prefix_cmd, body_cmd) => {
                        const cmd_node: CommandNode = {
                            type: 'command',
                            name: prefix_cmd,
                            fullName: prefix_cmd,
                            body: [{
                                type: 'command',
                                name: body_cmd,
                                fullName: body_cmd,
                                range: make_range(1, 4, 1, 4 + body_cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const ast: StataAST = { nodes: [cmd_node] };
                        const output = print_ast(ast);

                        // In cr mode (default), lines should end with newline, not semicolon
                        const the_lines = output.split('\n');
                        for (const line of the_lines) {
                            if (line.trim()) {
                                expect(line.endsWith(';')).toBe(false);
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property 8: Control Flow Consistency
    // =========================================================================
    describe('Property 8: Control Flow Consistency', () => {
        /**
         * Property 8: Control Flow Consistency
         * For any frame block, the indentation behavior should match the
         * indentation behavior of if/foreach/while blocks.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 8: Control Flow Consistency
         * Validates: Requirements 5.1, 5.2
         */
        it('should format frame blocks consistently with if blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        // Create frame block
                        const frame_node: ControlFlowNode = {
                            type: 'frame',
                            frameName: frame_name,
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(1, 4, 1, 4 + cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        // Create equivalent if block
                        const if_node: ControlFlowNode = {
                            type: 'if',
                            condition: '1 == 1',
                            body: [{
                                type: 'command',
                                name: cmd,
                                fullName: cmd,
                                range: make_range(1, 4, 1, 4 + cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const frame_ast: StataAST = { nodes: [frame_node] };
                        const if_ast: StataAST = { nodes: [if_node] };

                        const frame_output = print_ast(frame_ast);
                        const if_output = print_ast(if_ast);

                        // Both should have same structure: header with {, indented body, }
                        const frame_lines = frame_output.split('\n');
                        const if_lines = if_output.split('\n');

                        // Both should have opening brace on first line
                        expect(frame_lines[0]).toContain('{');
                        expect(if_lines[0]).toContain('{');

                        // Both should have indented body
                        const frame_body = frame_lines.find(l => l.includes(cmd));
                        const if_body = if_lines.find(l => l.includes(cmd));
                        expect(frame_body).toBeDefined();
                        expect(if_body).toBeDefined();

                        // Both body lines should have same indentation
                        const frame_indent = frame_body!.length - frame_body!.trimStart().length;
                        const if_indent = if_body!.length - if_body!.trimStart().length;
                        expect(frame_indent).toBe(if_indent);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should format prefix command brace blocks consistently with control flow', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_command,
                    arbitrary_command,
                    (prefix_cmd, body_cmd) => {
                        // Create prefix command brace block
                        const cmd_node: CommandNode = {
                            type: 'command',
                            name: prefix_cmd,
                            fullName: prefix_cmd,
                            body: [{
                                type: 'command',
                                name: body_cmd,
                                fullName: body_cmd,
                                range: make_range(1, 4, 1, 4 + body_cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        // Create equivalent while block
                        const while_node: ControlFlowNode = {
                            type: 'while',
                            condition: '1 == 1',
                            body: [{
                                type: 'command',
                                name: body_cmd,
                                fullName: body_cmd,
                                range: make_range(1, 4, 1, 4 + body_cmd.length),
                            }],
                            range: make_range(0, 0, 2, 1),
                        };

                        const cmd_ast: StataAST = { nodes: [cmd_node] };
                        const while_ast: StataAST = { nodes: [while_node] };

                        const cmd_output = print_ast(cmd_ast);
                        const while_output = print_ast(while_ast);

                        // Both should have same structure
                        const cmd_lines = cmd_output.split('\n');
                        const while_lines = while_output.split('\n');

                        // Both should have opening brace on first line
                        expect(cmd_lines[0]).toContain('{');
                        expect(while_lines[0]).toContain('{');

                        // Both body lines should have same indentation
                        const cmd_body = cmd_lines.find(l => l.includes(body_cmd));
                        const while_body = while_lines.find(l => l.includes(body_cmd));
                        expect(cmd_body).toBeDefined();
                        expect(while_body).toBeDefined();

                        const cmd_indent = cmd_body!.length - cmd_body!.trimStart().length;
                        const while_indent = while_body!.length - while_body!.trimStart().length;
                        expect(cmd_indent).toBe(while_indent);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property 9: Trivia Preservation
    // =========================================================================
    describe('Property 9: Trivia Preservation', () => {
        /**
         * Property 9: Trivia Preservation
         * For any frame block or prefix command brace block with leading or
         * trailing trivia (comments), the formatted output should preserve
         * all trivia.
         *
         * Feature: pretty-printer-frame-block-deletion, Property 9: Trivia Preservation
         * Validates: Requirements 5.3
         */
        it('should preserve leading trivia on frame blocks', () => {
            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(2, 4, 2, 11),
                }],
                range: make_range(1, 0, 3, 1),
                leadingTrivia: [{
                    type: 'comment',
                    style: 'star',
                    content: '* This is a comment',
                    range: make_range(0, 0, 0, 19),
                }],
            };

            const ast: StataAST = { nodes: [frame_node] };
            const output = print_ast(ast);

            // Comment should be preserved
            expect(output).toContain('* This is a comment');
            // Frame block should still be present
            expect(output).toContain('frame myframe');
        });

        it('should preserve trailing trivia on frame blocks', () => {
            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(1, 4, 1, 11),
                }],
                range: make_range(0, 0, 2, 1),
                trailingTrivia: [{
                    type: 'comment',
                    style: 'slash',
                    content: '// trailing comment',
                    range: make_range(0, 20, 0, 39),
                }],
            };

            const ast: StataAST = { nodes: [frame_node] };
            const output = print_ast(ast);

            // Comment should be preserved
            expect(output).toContain('// trailing comment');
            // Frame block should still be present
            expect(output).toContain('frame myframe');
        });

        it('should preserve leading trivia on prefix command brace blocks', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: 'capture',
                fullName: 'capture',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(2, 4, 2, 11),
                }],
                range: make_range(1, 0, 3, 1),
                leadingTrivia: [{
                    type: 'comment',
                    style: 'star',
                    content: '* Leading comment',
                    range: make_range(0, 0, 0, 17),
                }],
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);

            // Comment should be preserved
            expect(output).toContain('* Leading comment');
            // Prefix command brace block should still be present
            expect(output).toContain('capture');
            expect(output).toContain('{');
        });
    });
});


// =============================================================================
// Unit Tests
// =============================================================================

describe('Pretty Printer Frame Block Unit Tests', () => {
    /**
     * Unit tests for frame block examples
     * Validates: Requirements 1.2, 1.3, 1.4
     */
    describe('Frame Block Examples', () => {
        it('should format simple frame block: frame myframe { display "test" }', () => {
            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    varlist: [{ name: '"test"', range: make_range(1, 12, 1, 18) }],
                    range: make_range(1, 4, 1, 18),
                }],
                range: make_range(0, 0, 2, 1),
            };

            const ast: StataAST = { nodes: [frame_node] };
            const output = print_ast(ast);

            expect(output).toContain('frame myframe {');
            expect(output).toContain('display "test"');
            expect(output).toContain('}');
        });

        it('should format empty frame block: frame myframe { }', () => {
            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [],
                range: make_range(0, 0, 1, 1),
            };

            const ast: StataAST = { nodes: [frame_node] };
            const output = print_ast(ast);

            expect(output).toContain('frame myframe {');
            expect(output).toContain('}');
        });

        it('should format frame block with multiple commands', () => {
            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [
                    {
                        type: 'command',
                        name: 'gen',
                        fullName: 'generate',
                        varlist: [{ name: 'x', range: make_range(1, 8, 1, 9) }],
                        expression: '1',
                        range: make_range(1, 4, 1, 14),
                    },
                    {
                        type: 'command',
                        name: 'sum',
                        fullName: 'summarize',
                        varlist: [{ name: 'x', range: make_range(2, 8, 2, 9) }],
                        range: make_range(2, 4, 2, 9),
                    },
                ],
                range: make_range(0, 0, 3, 1),
            };

            const ast: StataAST = { nodes: [frame_node] };
            const output = print_ast(ast);

            expect(output).toContain('frame myframe {');
            expect(output).toContain('gen x = 1');
            expect(output).toContain('sum x');
            expect(output).toContain('}');
        });

        it('should format nested frame blocks', () => {
            const inner_frame: ControlFlowNode = {
                type: 'frame',
                frameName: 'inner',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    varlist: [{ name: '"nested"', range: make_range(2, 12, 2, 20) }],
                    range: make_range(2, 8, 2, 20),
                }],
                range: make_range(1, 4, 3, 5),
            };

            const outer_frame: ControlFlowNode = {
                type: 'frame',
                frameName: 'outer',
                body: [inner_frame],
                range: make_range(0, 0, 4, 1),
            };

            const ast: StataAST = { nodes: [outer_frame] };
            const output = print_ast(ast);

            expect(output).toContain('frame outer {');
            expect(output).toContain('frame inner {');
            expect(output).toContain('display "nested"');
            // Should have two closing braces
            expect((output.match(/}/g) || []).length).toBe(2);
        });
    });
});

describe('Pretty Printer Prefix Command Brace Block Unit Tests', () => {
    /**
     * Unit tests for prefix command brace block examples
     * Validates: Requirements 3.2, 3.3, 3.4
     */
    describe('Prefix Command Brace Block Examples', () => {
        it('should format simple capture block: capture { display "test" }', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: 'capture',
                fullName: 'capture',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    varlist: [{ name: '"test"', range: make_range(1, 12, 1, 18) }],
                    range: make_range(1, 4, 1, 18),
                }],
                range: make_range(0, 0, 2, 1),
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);

            expect(output).toContain('capture {');
            expect(output).toContain('display "test"');
            expect(output).toContain('}');
        });

        it('should format quietly block: quietly { gen x = 1 }', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: 'quietly',
                fullName: 'quietly',
                body: [{
                    type: 'command',
                    name: 'gen',
                    fullName: 'generate',
                    varlist: [{ name: 'x', range: make_range(1, 8, 1, 9) }],
                    expression: '1',
                    range: make_range(1, 4, 1, 14),
                }],
                range: make_range(0, 0, 2, 1),
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);

            expect(output).toContain('quietly {');
            expect(output).toContain('gen x = 1');
            expect(output).toContain('}');
        });

        it('should format standalone brace block: { display "test" }', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: '{',
                fullName: '{',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    varlist: [{ name: '"test"', range: make_range(1, 12, 1, 18) }],
                    range: make_range(1, 4, 1, 18),
                }],
                range: make_range(0, 0, 2, 1),
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);
            const the_lines = output.split('\n');

            // First line should be just {
            expect(the_lines[0].trim()).toBe('{');
            expect(output).toContain('display "test"');
            expect(output).toContain('}');
        });

        it('should format empty prefix block: capture { }', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: 'capture',
                fullName: 'capture',
                body: [],
                range: make_range(0, 0, 1, 1),
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);

            expect(output).toContain('capture {');
            expect(output).toContain('}');
        });

        it('should format nested prefix blocks', () => {
            const inner_cmd: CommandNode = {
                type: 'command',
                name: 'quietly',
                fullName: 'quietly',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    varlist: [{ name: '"nested"', range: make_range(2, 12, 2, 20) }],
                    range: make_range(2, 8, 2, 20),
                }],
                range: make_range(1, 4, 3, 5),
            };

            const outer_cmd: CommandNode = {
                type: 'command',
                name: 'capture',
                fullName: 'capture',
                body: [inner_cmd],
                range: make_range(0, 0, 4, 1),
            };

            const ast: StataAST = { nodes: [outer_cmd] };
            const output = print_ast(ast);

            expect(output).toContain('capture {');
            expect(output).toContain('quietly {');
            expect(output).toContain('display "nested"');
            // Should have two closing braces
            expect((output.match(/}/g) || []).length).toBe(2);
        });
    });
});

describe('Pretty Printer Delimiter Mode Unit Tests', () => {
    /**
     * Unit tests for delimiter mode examples
     * Validates: Requirements 2.5, 4.5
     */
    describe('Delimiter Mode Examples', () => {
        it('should format frame block in cr mode', () => {
            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(1, 4, 1, 11),
                }],
                range: make_range(0, 0, 2, 1),
            };

            const ast: StataAST = { nodes: [frame_node] };
            const output = print_ast(ast);

            // In cr mode, no semicolons
            expect(output).not.toContain(';');
        });

        it('should format frame block in semicolon mode', () => {
            const directive_node: StataNode = {
                type: 'directive',
                directive: 'delimit',
                mode: 'semicolon',
                range: make_range(0, 0, 0, 12),
            };

            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(2, 4, 2, 11),
                }],
                range: make_range(1, 0, 3, 1),
            };

            const ast: StataAST = { nodes: [directive_node, frame_node] };
            const output = print_ast(ast);

            // After #delimit ;, should have semicolons
            expect(output).toContain(';');
        });

        it('should format prefix block in cr mode', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: 'capture',
                fullName: 'capture',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(1, 4, 1, 11),
                }],
                range: make_range(0, 0, 2, 1),
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);

            // In cr mode, no semicolons
            expect(output).not.toContain(';');
        });

        it('should format prefix block in semicolon mode', () => {
            const directive_node: StataNode = {
                type: 'directive',
                directive: 'delimit',
                mode: 'semicolon',
                range: make_range(0, 0, 0, 12),
            };

            const cmd_node: CommandNode = {
                type: 'command',
                name: 'capture',
                fullName: 'capture',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(2, 4, 2, 11),
                }],
                range: make_range(1, 0, 3, 1),
            };

            const ast: StataAST = { nodes: [directive_node, cmd_node] };
            const output = print_ast(ast);

            // After #delimit ;, should have semicolons
            expect(output).toContain(';');
        });
    });
});

describe('Pretty Printer Trivia Unit Tests', () => {
    /**
     * Unit tests for trivia examples
     * Validates: Requirements 5.3
     */
    describe('Trivia Examples', () => {
        it('should preserve leading comment on frame block', () => {
            const frame_node: ControlFlowNode = {
                type: 'frame',
                frameName: 'myframe',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(2, 4, 2, 11),
                }],
                range: make_range(1, 0, 3, 1),
                leadingTrivia: [{
                    type: 'comment',
                    style: 'star',
                    content: '* Switch to myframe',
                    range: make_range(0, 0, 0, 19),
                }],
            };

            const ast: StataAST = { nodes: [frame_node] };
            const output = print_ast(ast);

            expect(output).toContain('* Switch to myframe');
            expect(output).toContain('frame myframe {');
        });

        it('should preserve trailing comment on prefix block', () => {
            const cmd_node: CommandNode = {
                type: 'command',
                name: 'capture',
                fullName: 'capture',
                body: [{
                    type: 'command',
                    name: 'display',
                    fullName: 'display',
                    range: make_range(1, 4, 1, 11),
                }],
                range: make_range(0, 0, 2, 1),
                trailingTrivia: [{
                    type: 'comment',
                    style: 'slash',
                    content: '// ignore errors',
                    range: make_range(0, 12, 0, 28),
                }],
            };

            const ast: StataAST = { nodes: [cmd_node] };
            const output = print_ast(ast);

            expect(output).toContain('// ignore errors');
            expect(output).toContain('capture {');
        });
    });
});

// =============================================================================
// Dual-Mode Formatter Tests
// =============================================================================
// These tests run through CodeFormatter in both AST and source-preserving modes
// to ensure both formatters handle frame blocks and prefix brace blocks correctly.

describe('Dual-Mode Formatter Frame Block Tests', () => {
    /**
     * Generator for frame block source code.
     */
    function arbitrary_frame_block_source(): fc.Arbitrary<string> {
        return fc.tuple(
            arbitrary_frame_name,
            fc.array(arbitrary_statement, { minLength: 1, maxLength: 3 })
        ).map(([frame_name, stmts]) => {
            const body = stmts.map(s => `    ${s}`).join('\n');
            return `frame ${frame_name} {\n${body}\n}`;
        });
    }

    /**
     * Generator for prefix brace block source code.
     */
    function arbitrary_prefix_brace_block_source(): fc.Arbitrary<string> {
        return fc.tuple(
            arbitrary_prefix_command,
            fc.array(arbitrary_statement, { minLength: 1, maxLength: 3 })
        ).map(([prefix, stmts]) => {
            const body = stmts.map(s => `    ${s}`).join('\n');
            return `${prefix} {\n${body}\n}`;
        });
    }

    for_each_formatter_mode_property(
        'should preserve frame blocks through formatting',
        arbitrary_frame_block_source(),
        (mode, source) => {
            const formatted = formatWithMode(source, mode);
            
            // Frame keyword should be preserved
            expect(formatted).toContain('frame');
            // Opening and closing braces should be preserved
            expect(formatted).toContain('{');
            expect(formatted).toContain('}');
        },
        50
    );

    for_each_formatter_mode_property(
        'should preserve prefix brace blocks through formatting',
        arbitrary_prefix_brace_block_source(),
        (mode, source) => {
            const formatted = formatWithMode(source, mode);
            
            // Opening and closing braces should be preserved
            expect(formatted).toContain('{');
            expect(formatted).toContain('}');
        },
        50
    );

    for_each_formatter_mode_property(
        'should maintain correct indentation in frame blocks',
        arbitrary_frame_block_source(),
        (mode, source) => {
            const formatted = formatWithMode(source, mode);
            const the_lines = formatted.split('\n');
            
            // Find body lines (between { and })
            let in_body = false;
            for (const my_line of the_lines) {
                if (my_line.includes('{')) {
                    in_body = true;
                    continue;
                }
                if (my_line.trim() === '}') {
                    in_body = false;
                    continue;
                }
                if (in_body && my_line.trim().length > 0) {
                    // Body lines should be indented
                    expect(my_line.startsWith('    ') || my_line.startsWith('\t')).toBe(true);
                }
            }
        },
        50
    );

    for_each_formatter_mode_property(
        'should maintain correct indentation in prefix brace blocks',
        arbitrary_prefix_brace_block_source(),
        (mode, source) => {
            const formatted = formatWithMode(source, mode);
            const the_lines = formatted.split('\n');
            
            // Find body lines (between { and })
            let in_body = false;
            for (const my_line of the_lines) {
                if (my_line.includes('{')) {
                    in_body = true;
                    continue;
                }
                if (my_line.trim() === '}') {
                    in_body = false;
                    continue;
                }
                if (in_body && my_line.trim().length > 0) {
                    // Body lines should be indented
                    expect(my_line.startsWith('    ') || my_line.startsWith('\t')).toBe(true);
                }
            }
        },
        50
    );
});

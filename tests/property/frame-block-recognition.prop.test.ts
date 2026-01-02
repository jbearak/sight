/**
 * Frame Block Recognition Property Tests
 *
 * Tests that verify the parser correctly recognizes frame blocks
 * and does not emit false positive brace-related diagnostics.
 *
 * Feature: diagnostic-false-positives
 * Property 2: Frame Block Brace Recognition
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer, StataParser } from '../../src/index';
import { ParseErrorCode, ControlFlowNode } from '../../src/types';

/**
 * Helper to parse a document and get parse result
 */
function parse_document(source: string): {
    errors: Array<{ code: ParseErrorCode; message: string }>;
    nodes: Array<{ type: string; frameName?: string; body?: Array<{ type: string }> }>;
} {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);
    return {
        errors: parse_result.errors,
        nodes: parse_result.ast.nodes as any,
    };
}

/**
 * Helper to check if a specific error code is present
 */
function has_error_code(errors: Array<{ code: ParseErrorCode }>, code: ParseErrorCode): boolean {
    return errors.some(e => e.code === code);
}

/**
 * Generator for valid Stata frame names (identifiers)
 */
const arbitrary_frame_name = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
    { minLength: 1, maxLength: 10 }
).filter(s => /^[a-z_][a-z_0-9]*$/i.test(s));

/**
 * Generator for simple command names that don't require arguments
 */
const arbitrary_command = fc.constantFrom('display', 'sum', 'list', 'describe', 'clear');

describe('Frame Block Recognition Property Tests', () => {
    /**
     * Property 2: Frame Block Brace Recognition
     * For any valid `frame name { ... }` block, the diagnostic provider should NOT emit
     * "open brace must be on the same line as the condition" for the opening brace.
     *
     * Feature: diagnostic-false-positives, Property 2: Frame Block Brace Recognition
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     */
    describe('Property 2: Frame Block Brace Recognition', () => {
        it('should NOT emit OPEN_BRACE_ALONE for frame block with brace on same line', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        // Create document with frame block: frame name { cmd }
                        const document = `frame ${frame_name} {\n    ${cmd}\n}`;
                        const { errors, nodes } = parse_document(document);

                        // Should NOT have OPEN_BRACE_ALONE error
                        const has_brace_error = has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);

                        // Should parse as a frame node
                        const has_frame_node = nodes.some(n => n.type === 'frame');

                        return !has_brace_error && has_frame_node;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse frame block with correct frame name', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        const document = `frame ${frame_name} {\n    ${cmd}\n}`;
                        const { nodes } = parse_document(document);

                        // Find the frame node
                        const frame_node = nodes.find(n => n.type === 'frame') as ControlFlowNode | undefined;

                        // Should have correct frame name
                        return frame_node !== undefined && frame_node.frameName === frame_name;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should parse frame block body correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    fc.array(arbitrary_command, { minLength: 1, maxLength: 5 }),
                    (frame_name, commands) => {
                        // Create document with multiple commands in frame block
                        const body_commands = commands.map(cmd => `    ${cmd}`).join('\n');
                        const document = `frame ${frame_name} {\n${body_commands}\n}`;
                        const { nodes } = parse_document(document);

                        // Find the frame node
                        const frame_node = nodes.find(n => n.type === 'frame') as ControlFlowNode | undefined;

                        // Should have body with commands
                        return frame_node !== undefined && 
                               frame_node.body !== undefined && 
                               frame_node.body.length > 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT emit brace errors for properly closed frame block', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        const document = `frame ${frame_name} {\n    ${cmd}\n}`;
                        const { errors } = parse_document(document);

                        // Should NOT have any brace-related errors
                        const has_brace_not_alone = has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);
                        const has_open_brace_alone = has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE);

                        return !has_brace_not_alone && !has_open_brace_alone;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should distinguish frame blocks from conditional blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_command,
                    (frame_name, cmd) => {
                        // Frame block should NOT require a condition
                        const document = `frame ${frame_name} {\n    ${cmd}\n}`;
                        const { errors, nodes } = parse_document(document);

                        // Should parse as frame, not as an error
                        const frame_node = nodes.find(n => n.type === 'frame');
                        const has_condition_error = errors.some(e => 
                            e.message.includes('condition')
                        );

                        return frame_node !== undefined && !has_condition_error;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle nested frame blocks', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    arbitrary_frame_name,
                    arbitrary_command,
                    (outer_frame, inner_frame, cmd) => {
                        // Nested frame blocks
                        const document = `frame ${outer_frame} {\n    frame ${inner_frame} {\n        ${cmd}\n    }\n}`;
                        const { errors, nodes } = parse_document(document);

                        // Should NOT have brace errors
                        const has_brace_error = has_error_code(errors, ParseErrorCode.OPEN_BRACE_ALONE) ||
                                               has_error_code(errors, ParseErrorCode.BRACE_NOT_ALONE);

                        // Should have outer frame node
                        const outer_node = nodes.find(n => n.type === 'frame') as ControlFlowNode | undefined;

                        return !has_brace_error && outer_node !== undefined;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should still parse non-block frame commands as regular commands', () => {
            fc.assert(
                fc.property(
                    arbitrary_frame_name,
                    (frame_name) => {
                        // Non-block frame commands (no brace)
                        const document = `frame create ${frame_name}`;
                        const { nodes } = parse_document(document);

                        // Should parse as command, not frame block
                        const has_command = nodes.some(n => n.type === 'command');
                        const has_frame_block = nodes.some(n => n.type === 'frame');

                        return has_command && !has_frame_block;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

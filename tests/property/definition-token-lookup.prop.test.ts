/**
 * Property Test: Token Position Lookup Accuracy
 * 
 * Feature: variable-macro-definition-disambiguation
 * Property 6: Token Position Lookup Accuracy
 * 
 * For any cursor position that falls within a token's range (start ≤ position < end),
 * the token lookup function SHALL return that token.
 */

import * as fc from 'fast-check';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentState } from '../../src/document-store';
import { Token, TokenType } from '../../src/types';

describe('Feature: variable-macro-definition-disambiguation, Property 6: Token Position Lookup Accuracy', () => {
    const definition_provider = new DefinitionProvider();

    // Helper to create a mock DocumentState with tokens
    function create_document_with_tokens(tokens: Token[]): DocumentState {
        return {
            uri: 'file:///test.do',
            content: 'test content',
            version: 1,
            tokens: tokens,
            symbols: {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map(),
                scalars: new Map(),
                matrices: new Map(),
                variables: new Map(),
            },
            ast: null,
            line_offsets: [0, 5, 10],
        } as DocumentState;
    }

    it('should return token when position falls within token range', () => {
        fc.assert(
            fc.property(
                fc.record({
                    type: fc.constantFrom('WORD', 'NUMBER', 'STRING') as fc.Arbitrary<TokenType>,
                    value: fc.string({ minLength: 1, maxLength: 10 }),
                    range: fc.record({
                        start: fc.record({
                            line: fc.integer({ min: 0, max: 5 }),
                            character: fc.integer({ min: 0, max: 10 }),
                        }),
                        end: fc.record({
                            line: fc.integer({ min: 0, max: 5 }),
                            character: fc.integer({ min: 1, max: 15 }),
                        }),
                    }),
                }),
                (token) => {
                    fc.pre(
                        token.range.start.line < token.range.end.line ||
                        (token.range.start.line === token.range.end.line &&
                         token.range.start.character < token.range.end.character)
                    );

                    const document = create_document_with_tokens([token]);

                    // Test position at start of range
                    const start_result = (definition_provider as any).get_token_at_position(
                        document,
                        token.range.start
                    );
                    expect(start_result).not.toBeNull();
                    expect(start_result?.type).toBe(token.type);

                    // Test position one character after start (if range is wide enough)
                    if (token.range.start.line === token.range.end.line &&
                        token.range.end.character > token.range.start.character + 1) {
                        const mid_position = {
                            line: token.range.start.line,
                            character: token.range.start.character + 1,
                        };
                        const mid_result = (definition_provider as any).get_token_at_position(
                            document,
                            mid_position
                        );
                        expect(mid_result).not.toBeNull();
                        expect(mid_result?.type).toBe(token.type);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should return null when position falls outside all token ranges', () => {
        fc.assert(
            fc.property(
                fc.record({
                    type: fc.constantFrom('WORD', 'NUMBER', 'STRING') as fc.Arbitrary<TokenType>,
                    value: fc.string({ minLength: 1, maxLength: 10 }),
                    range: fc.record({
                        start: fc.record({
                            line: fc.integer({ min: 2, max: 5 }),
                            character: fc.integer({ min: 5, max: 10 }),
                        }),
                        end: fc.record({
                            line: fc.integer({ min: 2, max: 5 }),
                            character: fc.integer({ min: 11, max: 15 }),
                        }),
                    }),
                }),
                (token) => {
                    fc.pre(
                        token.range.start.line < token.range.end.line ||
                        (token.range.start.line === token.range.end.line &&
                         token.range.start.character < token.range.end.character)
                    );

                    const document = create_document_with_tokens([token]);

                    // Test position clearly outside the range (line 0, character 0)
                    const outside_position = { line: 0, character: 0 };
                    const result = (definition_provider as any).get_token_at_position(
                        document,
                        outside_position
                    );

                    expect(result).toBeNull();
                }
            ),
            { numRuns: 100 }
        );
    });
});


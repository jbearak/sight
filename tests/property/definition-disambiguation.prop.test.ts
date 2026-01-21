/**
 * Property Tests: Token-based Symbol Disambiguation
 * 
 * Feature: variable-macro-definition-disambiguation
 * 
 * Tests the token-based disambiguation logic in DefinitionProvider.get_definition
 * to ensure correct symbol resolution based on token type.
 */

import * as fc from 'fast-check';
import { Position, Range } from 'vscode-languageserver-textdocument';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentState } from '../../src/document-store';
import { Token, TokenType, SymbolTable } from '../../src/types';

describe('Feature: variable-macro-definition-disambiguation', () => {
    const definition_provider = new DefinitionProvider();

    // Helper to create a mock DocumentState with tokens and symbols
    function create_document_with_symbols(
        tokens: Token[],
        symbols: Partial<SymbolTable> = {},
        content?: string
    ): DocumentState {
        // If no content provided, generate content from tokens
        const document_content = content || tokens.map(t => t.value).join(' ');
        
        return {
            uri: 'file:///test.do',
            content: document_content,
            version: 1,
            tokens: tokens,
            symbols: {
                localMacros: symbols.localMacros || new Map(),
                globalMacros: symbols.globalMacros || new Map(),
                programs: symbols.programs || new Map(),
                scalars: symbols.scalars || new Map(),
                matrices: symbols.matrices || new Map(),
                variables: symbols.variables || new Map(),
            },
            ast: null,
            line_offsets: [0, document_content.length + 1],
        } as DocumentState;
    }

    // Helper to create a symbol with location
    function create_symbol(name: string, uri: string = 'file:///test.do') {
        return {
            name,
            location: {
                uri,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: name.length },
                },
            },
            sourceUri: uri,
        };
    }

    describe('Property 1: WORD Token Variable Priority Over Macros', () => {
        it('WORD token with both variable and macro should return variable', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (symbol_name) => {
                        const word_token: Token = {
                            type: 'WORD',
                            value: symbol_name,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: symbol_name.length },
                            },
                        };

                        const variable_symbol = create_symbol(symbol_name);
                        const local_macro_symbol = create_symbol(symbol_name);

                        const document = create_document_with_symbols(
                            [word_token],
                            {
                                variables: new Map([[symbol_name, variable_symbol]]),
                                localMacros: new Map([[symbol_name, local_macro_symbol]]),
                            }
                        );

                        const position = { line: 0, character: 0 };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).not.toBeNull();
                        // Should resolve to variable, not macro
                        expect(result).toEqual({
                            uri: variable_symbol.location.uri,
                            range: variable_symbol.location.range,
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 2: MACRO_REF_LOCAL Token Resolution', () => {
        it('MACRO_REF_LOCAL should resolve to local macro', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (symbol_name) => {
                        const macro_token: Token = {
                            type: 'MACRO_REF_LOCAL',
                            value: symbol_name,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: symbol_name.length },
                            },
                        };

                        const local_macro_symbol = create_symbol(symbol_name);

                        const document = create_document_with_symbols(
                            [macro_token],
                            {
                                localMacros: new Map([[symbol_name, local_macro_symbol]]),
                            }
                        );

                        const position = { line: 0, character: 0 };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).not.toBeNull();
                        expect(result).toEqual({
                            uri: local_macro_symbol.location.uri,
                            range: local_macro_symbol.location.range,
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 3: MACRO_REF_GLOBAL Token Resolution', () => {
        it('MACRO_REF_GLOBAL should resolve to global macro', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (symbol_name) => {
                        const macro_token: Token = {
                            type: 'MACRO_REF_GLOBAL',
                            value: symbol_name,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: symbol_name.length },
                            },
                        };

                        const global_macro_symbol = create_symbol(symbol_name);

                        const document = create_document_with_symbols(
                            [macro_token],
                            {
                                globalMacros: new Map([[symbol_name, global_macro_symbol]]),
                            }
                        );

                        const position = { line: 0, character: 0 };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).not.toBeNull();
                        expect(result).toEqual({
                            uri: global_macro_symbol.location.uri,
                            range: global_macro_symbol.location.range,
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 4: WORD Token Does Not Resolve to Macro', () => {
        it('WORD token with only macro (no variable) should return null', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (symbol_name) => {
                        const word_token: Token = {
                            type: 'WORD',
                            value: symbol_name,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: symbol_name.length },
                            },
                        };

                        const local_macro_symbol = create_symbol(symbol_name);

                        const document = create_document_with_symbols(
                            [word_token],
                            {
                                localMacros: new Map([[symbol_name, local_macro_symbol]]),
                            }
                        );

                        const position = { line: 0, character: 0 };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 5: Extended Macro Context Resolution', () => {
        it('WORD token in extended macro context should resolve to local macro', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (macro_name) => {
                        // Content: local r : list <macro_name>
                        const prefix = 'local r : list ';
                        const content = prefix + macro_name;
                        
                        const word_token: Token = {
                            type: 'WORD',
                            value: macro_name,
                            range: {
                                start: { line: 0, character: prefix.length },
                                end: { line: 0, character: prefix.length + macro_name.length },
                            },
                        };

                        const local_macro_symbol = create_symbol(macro_name);

                        const document = create_document_with_symbols(
                            [word_token],
                            { localMacros: new Map([[macro_name, local_macro_symbol]]) },
                            content
                        );

                        const position = { line: 0, character: prefix.length };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).not.toBeNull();
                        expect(result).toEqual({
                            uri: local_macro_symbol.location.uri,
                            range: local_macro_symbol.location.range,
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('WORD token in extended macro context with missing macro should return null', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (macro_name) => {
                        const prefix = 'local r : list ';
                        const content = prefix + macro_name;
                        
                        const word_token: Token = {
                            type: 'WORD',
                            value: macro_name,
                            range: {
                                start: { line: 0, character: prefix.length },
                                end: { line: 0, character: prefix.length + macro_name.length },
                            },
                        };

                        // No macro defined
                        const document = create_document_with_symbols([word_token], {}, content);

                        const position = { line: 0, character: prefix.length };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 7: Missing Macro Returns Null', () => {
        it('MACRO_REF_LOCAL with no definition should return null', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (symbol_name) => {
                        const macro_token: Token = {
                            type: 'MACRO_REF_LOCAL',
                            value: symbol_name,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: symbol_name.length },
                            },
                        };

                        const document = create_document_with_symbols([macro_token]);
                        const position = { line: 0, character: 0 };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('MACRO_REF_GLOBAL with no definition should return null', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    async (symbol_name) => {
                        const macro_token: Token = {
                            type: 'MACRO_REF_GLOBAL',
                            value: symbol_name,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: symbol_name.length },
                            },
                        };

                        const document = create_document_with_symbols([macro_token]);
                        const position = { line: 0, character: 0 };
                        
                        const result = await definition_provider.get_definition(document, position);
                        expect(result).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});


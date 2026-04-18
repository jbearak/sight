/**
 * Property Tests: Token-based Symbol Disambiguation
 * 
 * Feature: variable-macro-definition-disambiguation
 * 
 * Tests the token-based disambiguation logic in DefinitionProvider.get_definition
 * to ensure correct symbol resolution based on token type.
 */

import * as fc from 'fast-check';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentState } from '../../src/document-store';
import { Token, SymbolTable } from '../../src/types';
import { compute_line_offsets } from '../../src/utils/line-utils';
import { ContextTracker } from '../../src/context-tracker';
import { arbitrary_non_reserved_identifier } from './generators';

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
            line_offsets: compute_line_offsets(document_content),
            diagnostics: [],
            context_ranges: [],
            context_tracker: new ContextTracker(),
            forward_calls: [],
        };
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
                    arbitrary_non_reserved_identifier(),
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
                    arbitrary_non_reserved_identifier(),
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
                    arbitrary_non_reserved_identifier(),
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

    describe('Property 4: WORD Token Away From Macro Declaration Does Not Resolve', () => {
        it('WORD token referenced away from a macro declaration should return null', () => {
            // Stata macro references use `$name`/`${name}` or `` `name' `` — a
            // plain WORD elsewhere must not resolve to a macro of the same name.
            fc.assert(
                fc.asyncProperty(
                    arbitrary_non_reserved_identifier(),
                    async (symbol_name) => {
                        // Place the macro declaration on line 0 and the WORD
                        // reference on line 1, so the cursor is outside the
                        // declaration range.
                        const word_token: Token = {
                            type: 'WORD',
                            value: symbol_name,
                            range: {
                                start: { line: 1, character: 0 },
                                end: { line: 1, character: symbol_name.length },
                            },
                        };

                        const local_macro_symbol = create_symbol(symbol_name);

                        const content = `local ${symbol_name} = 1\n${symbol_name}`;
                        const document = create_document_with_symbols(
                            [word_token],
                            {
                                localMacros: new Map([[symbol_name, local_macro_symbol]]),
                            },
                            content
                        );

                        const position = { line: 1, character: 0 };

                        const result = await definition_provider.get_definition(document, position);
                        expect(result).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('WORD token on a macro declaration name should resolve to that macro', () => {
            // When the cursor sits on the macro's declaration name (which
            // tokenizes as WORD, not MACRO_REF_*), return the declaration.
            fc.assert(
                fc.asyncProperty(
                    arbitrary_non_reserved_identifier(),
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

    describe('Property 5: Extended Macro Context Resolution', () => {
        it('WORD token in extended macro context should resolve to local macro', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitrary_non_reserved_identifier(),
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
                    arbitrary_non_reserved_identifier(),
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
                    arbitrary_non_reserved_identifier(),
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
                    arbitrary_non_reserved_identifier(),
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


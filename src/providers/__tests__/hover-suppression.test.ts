/**
 * Unit tests for HoverProvider out-of-scope suppression functionality.
 * Tests the helper methods and hover suppression behavior.
 */

import { HoverProvider } from '../hover';
import { CommandDatabase } from '../../command-database';
import { DocumentState } from '../../document-store';
import { Position, MarkupKind } from 'vscode-languageserver';
import { ResolvedScope, SymbolTable, OutOfScopeSymbol } from '../../types';
import { ContextTracker } from '../../context-tracker';

// Shared required-field defaults so each fixture literal satisfies the
// full DocumentState shape; individual tests override what they use.
const DOCUMENT_STATE_DEFAULTS = {
    version: 1,
    scopes: [],
    context_ranges: [],
    context_tracker: new ContextTracker(),
    line_offsets: [0],
    forward_calls: [],
    token_line_index: new Map(),
    ignored_lines: new Set<number>(),
};

describe('HoverProvider Out-of-Scope Suppression', () => {
    let hover_provider: HoverProvider;
    let command_db: CommandDatabase;

    beforeEach(() => {
        command_db = new CommandDatabase();
        hover_provider = new HoverProvider(command_db);
    });

    describe('get_reference_type_from_context', () => {
        it('should detect local macro reference', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display `country_name\'',
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                tokens: [],
                ast: null,
                diagnostics: []
            };
            const position: Position = { line: 0, character: 9 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).get_reference_type_from_context(document, position, 'country_name');
            expect(result).toBe('local_macro');
        });

        it('should detect global macro reference with $', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display $country_name',
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                tokens: [],
                ast: null,
                diagnostics: []
            };
            const position: Position = { line: 0, character: 9 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).get_reference_type_from_context(document, position, 'country_name');
            expect(result).toBe('global_macro');
        });

        it('should detect global macro reference with ${}', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display ${country_name}',
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                tokens: [],
                ast: null,
                diagnostics: []
            };
            const position: Position = { line: 0, character: 10 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).get_reference_type_from_context(document, position, 'country_name');
            expect(result).toBe('global_macro');
        });

        it('should detect other reference type for bare identifier', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display country_name',
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                tokens: [],
                ast: null,
                diagnostics: []
            };
            const position: Position = { line: 0, character: 8 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).get_reference_type_from_context(document, position, 'country_name');
            expect(result).toBe('other');
        });
    });

    describe('is_reference_out_of_scope', () => {
        it('should return true for out-of-scope local macro', () => {
            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 10,
                reason: 'inheritance_excludes_locals'
            }];

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols,
                diagnostics: [],
                forward_call_symbols: []
            };

            const result = (hover_provider as any).is_reference_out_of_scope('country_name', 'local_macro', resolved_scope);
            expect(result).toBe(true);
        });

        it('should return false for out-of-scope local macro when reference type is global', () => {
            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 10,
                reason: 'inheritance_excludes_locals'
            }];

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols,
                diagnostics: [],
                forward_call_symbols: []
            };

            const result = (hover_provider as any).is_reference_out_of_scope('country_name', 'global_macro', resolved_scope);
            expect(result).toBe(false);
        });

        it('should return false when symbol is not out-of-scope', () => {
            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols: [],
                diagnostics: [],
                forward_call_symbols: []
            };

            const result = (hover_provider as any).is_reference_out_of_scope('country_name', 'local_macro', resolved_scope);
            expect(result).toBe(false);
        });

        it('should return false when no resolved scope provided', () => {
            const result = (hover_provider as any).is_reference_out_of_scope('country_name', 'local_macro', undefined);
            expect(result).toBe(false);
        });
    });

    describe('collect_all_symbol_matches with suppression', () => {
        it('should return out-of-scope match for out-of-scope local macro reference', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display `country_name\'',
                symbols: { 
                    programs: new Map(), 
                    localMacros: new Map(), 
                    globalMacros: new Map(), 
                    variables: new Map([['country_name', { name: 'country_name', sourceUri: 'file:///test.do' }]]), 
                    scalars: new Map(), 
                    matrices: new Map() 
                },
                tokens: [],
                ast: null,
                diagnostics: []
            };

            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 10,
                reason: 'inheritance_excludes_locals'
            }];

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols,
                diagnostics: [],
                forward_call_symbols: []
            };

            const position: Position = { line: 0, character: 9 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).collect_all_symbol_matches(
                document, position, 'country_name', undefined, resolved_scope, undefined
            );

            expect(result.length).toBe(1);
            expect(result[0].type).toBe('local_macro');
            expect(result[0].content.value).toContain('(out of scope)');
            expect(result[0].content.value).toContain('**Local Macro:**');
            expect(result[0].content.value).toContain('`country_name`');
            expect(result[0].content.value).toContain('line 6'); // 0-indexed 5 becomes 1-indexed 6
        });

        it('should return out-of-scope match for out-of-scope global macro reference', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display $country_name',
                symbols: { 
                    programs: new Map(), 
                    localMacros: new Map(), 
                    globalMacros: new Map(), 
                    variables: new Map([['country_name', { name: 'country_name', sourceUri: 'file:///test.do' }]]), 
                    scalars: new Map(), 
                    matrices: new Map() 
                },
                tokens: [],
                ast: null,
                diagnostics: []
            };

            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'global',
                source_uri: 'file:///parent.do',
                defined_line: 22,
                call_site_line: 10,
                reason: 'after_call_site'
            }];

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols,
                diagnostics: [],
                forward_call_symbols: []
            };

            const position: Position = { line: 0, character: 9 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).collect_all_symbol_matches(
                document, position, 'country_name', undefined, resolved_scope, undefined
            );

            expect(result.length).toBe(1);
            expect(result[0].type).toBe('global_macro');
            expect(result[0].content.value).toContain('(out of scope)');
            expect(result[0].content.value).toContain('**Global Macro:**');
            expect(result[0].content.value).toContain('`country_name`');
            expect(result[0].content.value).toContain('line 23'); // 0-indexed 22 becomes 1-indexed 23
        });

        it('should return normal matches for non-out-of-scope reference', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display country_name',
                symbols: { 
                    programs: new Map(), 
                    localMacros: new Map(), 
                    globalMacros: new Map(), 
                    variables: new Map([['country_name', { 
                        name: 'country_name', 
                        sourceUri: 'file:///test.do',
                        source: 'variable'
                    }]]), 
                    scalars: new Map(), 
                    matrices: new Map() 
                },
                tokens: [],
                ast: null,
                diagnostics: []
            };

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols: [],
                diagnostics: [],
                forward_call_symbols: []
            };

            const position: Position = { line: 0, character: 8 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).collect_all_symbol_matches(
                document, position, 'country_name', undefined, resolved_scope, undefined
            );

            expect(result.length).toBe(1);
            expect(result[0].type).toBe('variable');
        });

        it('should return normal matches when reference type is other but local macro is out-of-scope', () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display country_name', // bare identifier, not `country_name'
                symbols: { 
                    programs: new Map(), 
                    localMacros: new Map(), 
                    globalMacros: new Map(), 
                    variables: new Map([['country_name', { 
                        name: 'country_name', 
                        sourceUri: 'file:///test.do',
                        source: 'variable'
                    }]]), 
                    scalars: new Map(), 
                    matrices: new Map() 
                },
                tokens: [],
                ast: null,
                diagnostics: []
            };

            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 10,
                reason: 'inheritance_excludes_locals'
            }];

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols,
                diagnostics: [],
                forward_call_symbols: []
            };

            const position: Position = { line: 0, character: 8 }; // Position at 'c' in 'country_name'

            const result = (hover_provider as any).collect_all_symbol_matches(
                document, position, 'country_name', undefined, resolved_scope, undefined
            );

            // Should show variable info since this is not a local macro reference
            expect(result.length).toBe(1);
            expect(result[0].type).toBe('variable');
        });
    });

    describe('integration with get_hover', () => {
        it('should return hover with out-of-scope indicator for out-of-scope local macro reference', async () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display `country_name\'',
                symbols: { 
                    programs: new Map(), 
                    localMacros: new Map(), 
                    globalMacros: new Map(), 
                    variables: new Map([['country_name', { 
                        name: 'country_name', 
                        sourceUri: 'file:///test.do',
                        source: 'variable'
                    }]]), 
                    scalars: new Map(), 
                    matrices: new Map() 
                },
                tokens: [],
                ast: null,
                diagnostics: []
            };

            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 10,
                reason: 'inheritance_excludes_locals'
            }];

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols,
                diagnostics: [],
                forward_call_symbols: []
            };

            // Mock scope resolver
            const scope_resolver = {
                resolve: jest.fn().mockResolvedValue(resolved_scope)
            };

            const position: Position = { line: 0, character: 9 }; // Position at 'c' in 'country_name'

            const result = await hover_provider.get_hover(
                document, position, undefined, scope_resolver as any, undefined, undefined, undefined
            );

            expect(result).not.toBeNull();
            expect(result!.contents).toBeDefined();
            const content = result!.contents as { kind: string; value: string };
            expect(content.value).toContain('(out of scope)');
            expect(content.value).toContain('**Local Macro:**');
            expect(content.value).toContain('`country_name`');
            expect(content.value).toContain('line 6'); // 0-indexed 5 becomes 1-indexed 6
        });

        it('should return hover with out-of-scope indicator for out-of-scope global macro reference', async () => {
            const document: DocumentState = {
                ...DOCUMENT_STATE_DEFAULTS,
                uri: 'file:///test.do',
                content: 'display $country_name',
                symbols: { 
                    programs: new Map(), 
                    localMacros: new Map(), 
                    globalMacros: new Map(), 
                    variables: new Map([['country_name', { 
                        name: 'country_name', 
                        sourceUri: 'file:///test.do',
                        source: 'variable'
                    }]]), 
                    scalars: new Map(), 
                    matrices: new Map() 
                },
                tokens: [],
                ast: null,
                diagnostics: []
            };

            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'global',
                source_uri: 'file:///parent.do',
                defined_line: 22,
                call_site_line: 10,
                reason: 'after_call_site'
            }];

            const resolved_scope: ResolvedScope = {
                symbols: { programs: new Map(), localMacros: new Map(), globalMacros: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
                out_of_scope_symbols,
                diagnostics: [],
                forward_call_symbols: []
            };

            // Mock scope resolver
            const scope_resolver = {
                resolve: jest.fn().mockResolvedValue(resolved_scope)
            };

            const position: Position = { line: 0, character: 9 }; // Position at 'c' in 'country_name'

            const result = await hover_provider.get_hover(
                document, position, undefined, scope_resolver as any, undefined, undefined, undefined
            );

            expect(result).not.toBeNull();
            expect(result!.contents).toBeDefined();
            const content = result!.contents as { kind: string; value: string };
            expect(content.value).toContain('(out of scope)');
            expect(content.value).toContain('**Global Macro:**');
            expect(content.value).toContain('`country_name`');
            expect(content.value).toContain('line 23'); // 0-indexed 22 becomes 1-indexed 23
        });
    });
});
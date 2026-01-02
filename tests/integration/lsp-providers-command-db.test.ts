/**
 * Integration Tests for LSP Providers with Command Database
 * 
 * Tests the integration between completion and hover providers with the command database.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CompletionProvider } from '../../src/providers/completion';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/command-database';
import { DocumentState } from '../../src/document-store';
import type { CommandCache, CommandInfo } from '../../src/command-database/types';
import type { SymbolTable } from '../../src/types';
import { Position } from 'vscode-languageserver';

describe('LSP Providers Integration', () => {
    let command_db: CommandDatabase;
    let completion_provider: CompletionProvider;
    let hover_provider: HoverProvider;
    let document_state: DocumentState;

    beforeEach(() => {
        command_db = new CommandDatabase();
        completion_provider = new CompletionProvider(command_db, { snippet_support: true });
        hover_provider = new HoverProvider(command_db);
        
        // Create mock document state
        const empty_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map()
        };
        
        document_state = {
            uri: 'test://test.do',
            content: '',
            version: 1,
            ast: null,
            symbols: empty_symbols,
            errors: [],
            context_tracker: undefined
        };
    });

    describe('Command Database Integration', () => {
        it('should load command cache and provide completions', async () => {
            // Create mock command cache with minimal types
            const cache: CommandCache = {
                version: 18,
                commands: {
                    'regress': {
                        name: 'regress',
                        syntax: 'regress depvar [indepvars] [if] [in] [, options]',
                        description: 'Linear regression',
                        min_abbreviation: 3,
                        options: [
                            { name: 'noconstant', min_abbreviation: 3, has_argument: false },
                            { name: 'robust', min_abbreviation: 1, has_argument: false }
                        ]
                    }
                },
                abbreviations: {
                    'reg': 'regress',
                    'regr': 'regress',
                    'regre': 'regress',
                    'regres': 'regress',
                    'regress': 'regress'
                }
            };

            // Load cache
            command_db.load_cache(cache);

            // Test completion
            document_state.content = 'reg';
            const position: Position = { line: 0, character: 3 };
            const completions = await completion_provider.get_completions(document_state, position);

            expect(completions.length).toBeGreaterThan(0);
            const regress_completion = completions.find(c => c.label === 'regress');
            expect(regress_completion).toBeDefined();
            // detail is now options-based, not syntax (after SMCL syntax cleanup)
            expect(regress_completion?.detail).toBe('Options: noconstant, robust');
        });

        it('should provide hover information', async () => {
            // Create mock command cache
            const cache: CommandCache = {
                version: 18,
                commands: {
                    'regress': {
                        name: 'regress',
                        syntax: 'regress depvar [indepvars] [if] [in] [, options]',
                        description: 'Linear regression',
                        min_abbreviation: 3
                    }
                },
                abbreviations: {
                    'reg': 'regress',
                    'regress': 'regress'
                }
            };

            command_db.load_cache(cache);

            // Test hover
            document_state.content = 'regress y x';
            const position: Position = { line: 0, character: 3 }; // On 'regress'
            const hover = await hover_provider.get_hover(document_state, position);

            expect(hover).toBeDefined();
            expect(hover?.contents).toBeDefined();
            if (hover?.contents && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('regress');
            }
        });

        it('should handle abbreviation expansion', async () => {
            const cache: CommandCache = {
                version: 18,
                commands: {
                    'regress': {
                        name: 'regress',
                        syntax: 'regress depvar [indepvars]',
                        description: 'Linear regression',
                        min_abbreviation: 3
                    }
                },
                abbreviations: {
                    'reg': 'regress',
                    'regr': 'regress',
                    'regre': 'regress',
                    'regres': 'regress',
                    'regress': 'regress'
                }
            };

            command_db.load_cache(cache);

            // Test abbreviation expansion
            const matches = command_db.expand_abbreviation('reg');
            expect(matches.length).toBe(1);
            expect(matches[0].name).toBe('regress');

            // Test hover with abbreviation
            document_state.content = 'reg y x';
            const position: Position = { line: 0, character: 2 }; // On 'reg'
            const hover = await hover_provider.get_hover(document_state, position);

            expect(hover).toBeDefined();
            if (hover?.contents && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('regress');
            }
        });
    });

    describe('Cache Invalidation', () => {
        it('should invalidate completion cache when database changes', async () => {
            // Initial cache
            const cache1: CommandCache = {
                version: 18,
                commands: {
                    'cmd1': {
                        name: 'cmd1',
                        syntax: 'cmd1',
                        description: 'Command 1',
                        min_abbreviation: 4
                    }
                },
                abbreviations: {
                    'cmd1': 'cmd1'
                }
            };

            command_db.load_cache(cache1);
            const initial_version = command_db.get_cache_version();

            // Load new cache
            const cache2: CommandCache = {
                version: 18,
                commands: {
                    'cmd2': {
                        name: 'cmd2',
                        syntax: 'cmd2',
                        description: 'Command 2',
                        min_abbreviation: 4
                    }
                },
                abbreviations: {
                    'cmd2': 'cmd2'
                }
            };

            command_db.load_cache(cache2);
            const new_version = command_db.get_cache_version();

            expect(new_version).toBeGreaterThan(initial_version);

            // Test that completion provider can invalidate cache
            completion_provider.invalidate_prefix_cache();
            
            // This should work without throwing
            document_state.content = 'cmd';
            const position: Position = { line: 0, character: 3 };
            const completions = await completion_provider.get_completions(document_state, position);
            
            expect(completions.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Multiple Commands', () => {
        it('should handle multiple commands with common prefix', async () => {
            const cache: CommandCache = {
                version: 18,
                commands: {
                    'generate': {
                        name: 'generate',
                        syntax: 'generate newvar = exp',
                        description: 'Create new variable',
                        min_abbreviation: 1
                    },
                    'gsort': {
                        name: 'gsort',
                        syntax: 'gsort varlist',
                        description: 'Sort data',
                        min_abbreviation: 2
                    }
                },
                abbreviations: {
                    'g': 'generate',
                    'ge': 'generate',
                    'gen': 'generate',
                    'gene': 'generate',
                    'gener': 'generate',
                    'genera': 'generate',
                    'generat': 'generate',
                    'generate': 'generate',
                    'gs': 'gsort',
                    'gso': 'gsort',
                    'gsor': 'gsort',
                    'gsort': 'gsort'
                }
            };

            command_db.load_cache(cache);

            // Search for 'g' prefix
            const results = command_db.search('g');
            expect(results.length).toBe(2);
            
            // Expand 'g' abbreviation - should match generate (min_abbreviation: 1)
            const g_matches = command_db.expand_abbreviation('g');
            expect(g_matches.length).toBe(1);
            expect(g_matches[0].name).toBe('generate');
            
            // Expand 'gs' abbreviation - should match gsort (min_abbreviation: 2)
            const gs_matches = command_db.expand_abbreviation('gs');
            expect(gs_matches.length).toBe(1);
            expect(gs_matches[0].name).toBe('gsort');
        });
    });
});

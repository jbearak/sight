import { init_tracker_from_source } from '../test-context-helper';
/**
 * Unit tests for the Completion Provider
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Position } from 'vscode-languageserver';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    CompletionProvider,
    detect_completion_context,
    CompletionContext
} from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { DocumentState } from '../../src/document-store';
import { SymbolTable, MacroSymbol, ProgramSymbol, VariableSymbol, ScalarSymbol, MatrixSymbol } from '../../src/types';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext } from '../../src/context-tracker/types';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(content: string, symbols?: Partial<SymbolTable>): DocumentState {
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        ast: null,
        symbols: {
            programs: symbols?.programs || new Map(),
            localMacros: symbols?.localMacros || new Map(),
            globalMacros: symbols?.globalMacros || new Map(),
            variables: symbols?.variables || new Map(),
            scalars: symbols?.scalars || new Map(),
            matrices: symbols?.matrices || new Map(),
        },
        diagnostics: [],
    };
}

/**
 * Helper to create a test command database with sample commands.
 */
function create_test_command_db(): CommandDatabase {
    const db = new CommandDatabase();
    db.register({
        name: 'generate',
        minAbbreviation: 'gen',
        syntax: 'generate [type] newvar = exp',
        description: 'Create a new variable',
        options: [
            { name: 'after', minAbbreviation: 'after', description: 'Place after', hasArgument: true },
            { name: 'before', minAbbreviation: 'before', description: 'Place before', hasArgument: true },
        ],
        category: 'data',
        isBuiltin: true,
    });
    db.register({
        name: 'regress',
        minAbbreviation: 'reg',
        syntax: 'regress depvar [indepvars]',
        description: 'Linear regression',
        options: [
            { name: 'noconstant', minAbbreviation: 'nocons', description: 'No constant', hasArgument: false },
            { name: 'level', minAbbreviation: 'level', description: 'Confidence level', hasArgument: true },
        ],
        category: 'regression',
        isBuiltin: true,
    });
    db.register({
        name: 'summarize',
        minAbbreviation: 'sum',
        syntax: 'summarize [varlist]',
        description: 'Summary statistics',
        options: [
            { name: 'detail', minAbbreviation: 'd', description: 'Detailed output', hasArgument: false },
        ],
        category: 'statistics',
        isBuiltin: true,
    });
    return db;
}

describe('Completion Context Detection', () => {
    describe('Command Context', () => {
        it('should detect command context at start of empty line', () => {
            const doc = create_test_document('');
            const context = detect_completion_context(doc, { line: 0, character: 0 });
            expect(context.type).toBe('command');
        });

        it('should detect command context after whitespace', () => {
            const doc = create_test_document('    ');
            const context = detect_completion_context(doc, { line: 0, character: 4 });
            expect(context.type).toBe('command');
        });

        it('should detect command context while typing first word', () => {
            const doc = create_test_document('gen');
            const context = detect_completion_context(doc, { line: 0, character: 3 });
            expect(context.type).toBe('command');
        });

        it('should detect command context after prefix command', () => {
            const doc = create_test_document('quietly ');
            const context = detect_completion_context(doc, { line: 0, character: 8 });
            expect(context.type).toBe('command');
        });

        it('should detect command context after by prefix', () => {
            const doc = create_test_document('by group: ');
            const context = detect_completion_context(doc, { line: 0, character: 10 });
            expect(context.type).toBe('command');
        });
    });

    describe('Option Context', () => {
        it('should detect option context after comma', () => {
            const doc = create_test_document('regress y x, ');
            const context = detect_completion_context(doc, { line: 0, character: 13 });
            expect(context.type).toBe('option');
        });

        it('should detect option context while typing option', () => {
            const doc = create_test_document('regress y x, noc');
            const context = detect_completion_context(doc, { line: 0, character: 16 });
            expect(context.type).toBe('option');
        });

        it('should not detect option context for comma inside parentheses', () => {
            const doc = create_test_document('gen x = func(a, b)');
            const context = detect_completion_context(doc, { line: 0, character: 16 });
            // Should not be option context since comma is inside parens
            expect(context.type).not.toBe('option');
        });
    });

    describe('Macro Context', () => {
        it('should detect local macro context after backtick', () => {
            const doc = create_test_document('display `');
            const context = detect_completion_context(doc, { line: 0, character: 9 });
            expect(context.type).toBe('macro');
            if (context.type === 'macro') {
                expect(context.scope).toBe('local');
            }
        });

        it('should detect local macro context while typing macro name', () => {
            const doc = create_test_document('display `var');
            const context = detect_completion_context(doc, { line: 0, character: 12 });
            expect(context.type).toBe('macro');
            if (context.type === 'macro') {
                expect(context.scope).toBe('local');
            }
        });

        it('should detect global macro context after dollar sign', () => {
            const doc = create_test_document('display $');
            const context = detect_completion_context(doc, { line: 0, character: 9 });
            expect(context.type).toBe('macro');
            if (context.type === 'macro') {
                expect(context.scope).toBe('global');
            }
        });

        it('should detect global macro context inside ${', () => {
            const doc = create_test_document('display ${var');
            const context = detect_completion_context(doc, { line: 0, character: 13 });
            expect(context.type).toBe('macro');
            if (context.type === 'macro') {
                expect(context.scope).toBe('global');
            }
        });

        it('should not detect macro context after closed local macro', () => {
            const doc = create_test_document("display `var' ");
            const context = detect_completion_context(doc, { line: 0, character: 14 });
            expect(context.type).not.toBe('macro');
        });
    });

    describe('Variable Context', () => {
        it('should detect variable context after command name', () => {
            const doc = create_test_document('summarize ');
            const context = detect_completion_context(doc, { line: 0, character: 10 });
            expect(context.type).toBe('variable');
        });

        it('should detect variable context while typing variable name', () => {
            const doc = create_test_document('summarize inc');
            const context = detect_completion_context(doc, { line: 0, character: 13 });
            expect(context.type).toBe('variable');
        });
    });
});

describe('Completion Provider', () => {
    let command_db: CommandDatabase;
    let provider: CompletionProvider;

    beforeEach(() => {
        command_db = create_test_command_db();
        provider = new CompletionProvider(command_db, { snippet_support: true });
    });

    describe('Command Completions', () => {
        it('should return command completions when typing a prefix', async () => {
            // Empty prefix returns empty array (new behavior)
            // Type a prefix to get completions
            const doc = create_test_document('g');
            const completions = await provider.get_completions(doc, { line: 0, character: 1 });
            
            expect(completions.length).toBeGreaterThan(0);
            const labels = completions.map(c => c.label);
            expect(labels).toContain('generate');
        });

        it('should return empty array for empty prefix', async () => {
            // New behavior: empty prefix returns empty array to reduce noise
            const doc = create_test_document('');
            const completions = await provider.get_completions(doc, { line: 0, character: 0 });
            
            expect(completions.length).toBe(0);
        });

        it('should filter commands by prefix', async () => {
            const doc = create_test_document('gen');
            const completions = await provider.get_completions(doc, { line: 0, character: 3 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('generate');
            // Abbreviations are no longer added as separate completion items
            expect(labels).not.toContain('gen');
        });

        it('should prioritize user programs over built-in commands', async () => {
            const programs = new Map<string, ProgramSymbol>();
            programs.set('myprogram', {
                name: 'myprogram',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
            });
            
            // Type a prefix to get completions (empty prefix returns empty array)
            const doc = create_test_document('m', { programs });
            const completions = await provider.get_completions(doc, { line: 0, character: 1 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('myprogram');
            
            // User program should have lower sortText (higher priority)
            const user_program = completions.find(c => c.label === 'myprogram');
            // Compare as strings - user programs should sort before built-in commands
            expect(user_program?.sortText).toBeDefined();
        });
    });

    describe('Option Completions', () => {
        it('should return options for regress command when typing prefix', async () => {
            const doc = create_test_document('regress y x, n');
            const completions = await provider.get_completions(doc, { line: 0, character: 14 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('noconstant');
        });
    });

    describe('Macro Completions', () => {
        it('should return local macro completions', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('myvar', {
                name: 'myvar',
                scope: 'local',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                value: 'test_value',
            });
            
            const doc = create_test_document('display `', { localMacros: local_macros });
            const completions = await provider.get_completions(doc, { line: 0, character: 9 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('myvar');
        });

        it('should return global macro completions', async () => {
            const global_macros = new Map<string, MacroSymbol>();
            global_macros.set('GLOBAL_VAR', {
                name: 'GLOBAL_VAR',
                scope: 'global',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                value: 'global_value',
            });
            
            const doc = create_test_document('display $', { globalMacros: global_macros });
            const completions = await provider.get_completions(doc, { line: 0, character: 9 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('GLOBAL_VAR');
        });

        it('should suggest apple when typing `a after local apple sauce', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('apple', {
                name: 'apple',
                scope: 'local',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } } },
                sourceUri: 'file:///test.do',
                value: 'sauce',
            });
            
            const doc = create_test_document('local apple sauce\ndisplay `a', { localMacros: local_macros });
            const completions = await provider.get_completions(doc, { line: 1, character: 10 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('apple');
        });

        it('should suggest apple when typing `A (case-insensitive)', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('apple', {
                name: 'apple',
                scope: 'local',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } } },
                sourceUri: 'file:///test.do',
                value: 'sauce',
            });
            
            const doc = create_test_document('local apple sauce\ndisplay `A', { localMacros: local_macros });
            const completions = await provider.get_completions(doc, { line: 1, character: 10 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('apple');
        });

        it('should suggest both apple and apricot when typing `ap', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('apple', {
                name: 'apple',
                scope: 'local',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } } },
                sourceUri: 'file:///test.do',
                value: 'sauce',
            });
            local_macros.set('apricot', {
                name: 'apricot',
                scope: 'local',
                location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 15 } } },
                sourceUri: 'file:///test.do',
                value: 'jam',
            });
            
            const doc = create_test_document('local apple sauce\nlocal apricot jam\ndisplay `ap', { localMacros: local_macros });
            const completions = await provider.get_completions(doc, { line: 2, character: 11 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('apple');
            expect(labels).toContain('apricot');
        });

        // Tests for local vs global macro completion filtering

        describe('Local Macro Filtering with Backtick Prefix', () => {
            it('should return only local macros with backtick prefix (Req 1.5)', async () => {
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('local_var', {
                    name: 'local_var',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('GLOBAL_VAR', {
                    name: 'GLOBAL_VAR',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const doc = create_test_document('display `', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).toContain('local_var');
            });

            it('should NOT return global macros with backtick prefix (Req 1.6)', async () => {
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('local_var', {
                    name: 'local_var',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('GLOBAL_VAR', {
                    name: 'GLOBAL_VAR',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const doc = create_test_document('display `', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).not.toContain('GLOBAL_VAR');
            });
        });

        describe('Global Macro Filtering with Dollar Prefix', () => {
            it('should return only global macros with dollar prefix (Req 2.6)', async () => {
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('local_var', {
                    name: 'local_var',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('GLOBAL_VAR', {
                    name: 'GLOBAL_VAR',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const doc = create_test_document('display $', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).toContain('GLOBAL_VAR');
            });

            it('should NOT return local macros with dollar prefix (Req 2.7)', async () => {
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('local_var', {
                    name: 'local_var',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('GLOBAL_VAR', {
                    name: 'GLOBAL_VAR',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const doc = create_test_document('display $', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).not.toContain('local_var');
            });
        });

        describe('Macro Labeling', () => {
            it('should have "local macro" in detail field for local macros (Req 3.1)', async () => {
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('my_local', {
                    name: 'my_local',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'test_value',
                });

                const doc = create_test_document('display `', { localMacros: local_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const my_local_completion = completions.find(c => c.label === 'my_local');
                expect(my_local_completion).toBeDefined();
                expect(my_local_completion?.detail).toContain('local macro');
            });

            it('should have "global macro" in detail field for global macros (Req 3.2)', async () => {
                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('MY_GLOBAL', {
                    name: 'MY_GLOBAL',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } },
                    sourceUri: 'file:///test.do',
                    value: 'test_value',
                });

                const doc = create_test_document('display $', { globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const my_global_completion = completions.find(c => c.label === 'MY_GLOBAL');
                expect(my_global_completion).toBeDefined();
                expect(my_global_completion?.detail).toContain('global macro');
            });
        });

        describe('Mixed Local and Global Definitions with Same Name', () => {
            it('should return only local macro with backtick prefix when both exist with same name (Req 4.1)', async () => {
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('shared_name', {
                    name: 'shared_name',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('shared_name', {
                    name: 'shared_name',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const doc = create_test_document('display `', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).toContain('shared_name');

                // Verify it's the local macro by checking detail
                const shared_completion = completions.find(c => c.label === 'shared_name');
                expect(shared_completion?.detail).toContain('local macro');
            });

            it('should return only global macro with dollar prefix when both exist with same name (Req 4.2)', async () => {
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('shared_name', {
                    name: 'shared_name',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('shared_name', {
                    name: 'shared_name',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const doc = create_test_document('display $', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 0, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).toContain('shared_name');

                // Verify it's the global macro by checking detail
                const shared_completion = completions.find(c => c.label === 'shared_name');
                expect(shared_completion?.detail).toContain('global macro');
            });
        });

        describe('Order-Independent Filtering', () => {
            it('should return local macro with backtick prefix when global is defined before local (Req 1.4)', async () => {
                // Global defined first (line 0), local defined second (line 1)
                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('FIRST_GLOBAL', {
                    name: 'FIRST_GLOBAL',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('second_local', {
                    name: 'second_local',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const doc = create_test_document('global FIRST_GLOBAL global_value\nlocal second_local local_value\ndisplay `', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 2, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).toContain('second_local');
                expect(labels).not.toContain('FIRST_GLOBAL');
            });

            it('should return global macro with dollar prefix when local is defined before global (Req 2.5)', async () => {
                // Local defined first (line 0), global defined second (line 1)
                const local_macros = new Map<string, MacroSymbol>();
                local_macros.set('first_local', {
                    name: 'first_local',
                    scope: 'local',
                    location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'local_value',
                });

                const global_macros = new Map<string, MacroSymbol>();
                global_macros.set('SECOND_GLOBAL', {
                    name: 'SECOND_GLOBAL',
                    scope: 'global',
                    location: { uri: 'file:///test.do', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 25 } } },
                    sourceUri: 'file:///test.do',
                    value: 'global_value',
                });

                const doc = create_test_document('local first_local local_value\nglobal SECOND_GLOBAL global_value\ndisplay $', { localMacros: local_macros, globalMacros: global_macros });
                const completions = await provider.get_completions(doc, { line: 2, character: 9 });

                const labels = completions.map(c => c.label);
                expect(labels).toContain('SECOND_GLOBAL');
                expect(labels).not.toContain('first_local');
            });
        });
    });

    describe('Variable Completions', () => {
        it('should return variable completions', async () => {
            const variables = new Map<string, VariableSymbol>();
            variables.set('income', {
                name: 'income',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                source: 'gen',
            });
            
            const doc = create_test_document('summarize ', { variables });
            const completions = await provider.get_completions(doc, { line: 0, character: 10 });
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('income');
        });
    });

    describe('Quote Snippet Completions', () => {
        it('should return local macro snippet on backtick trigger', async () => {
            const doc = create_test_document('display `');
            const completions = await provider.get_completions(doc, { line: 0, character: 9 }, '`');
            
            const snippet = completions.find(c => c.label === 'Local macro reference');
            expect(snippet).toBeDefined();
            expect(snippet?.insertText).toContain("'");
        });

        it('should return compound quote snippet on double-quote after backtick', async () => {
            const doc = create_test_document('display `"');
            const completions = await provider.get_completions(doc, { line: 0, character: 10 }, '"');
            
            const snippet = completions.find(c => c.label === 'Compound quote string');
            expect(snippet).toBeDefined();
        });
    });

    describe('Fallback Completions', () => {
        it('should return empty array for empty prefix in fallback context', async () => {
            // New behavior: empty prefix returns empty array to reduce noise
            const doc = create_test_document('');
            const completions = await provider.get_completions(doc, { line: 0, character: 0 });
            
            // Should get empty array for empty prefix
            expect(completions.length).toBe(0);
        });

        it('should return command completions when typing prefix in fallback context', async () => {
            // Type a prefix to get completions
            const doc = create_test_document('g');
            const completions = await provider.get_completions(doc, { line: 0, character: 1 });
            
            // Should get command completions
            expect(completions.length).toBeGreaterThan(0);
            const labels = completions.map(c => c.label);
            expect(labels).toContain('generate');
        });
    });

    describe('Context-Aware Completions', () => {
        it('should suppress command completions in mata context', async () => {
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, 'mata\ngen x = 1\nend');
            
            const provider_with_context = new CompletionProvider(
                command_db,
                { snippet_support: true },
                my_context_tracker
            );
            
            // Position inside mata block (line 1)
            const doc = create_test_document('mata\ngen x = 1\nend');
            const completions = await provider_with_context.get_completions(
                doc,
                { line: 1, character: 0 }
            );
            
            // Should not have command completions
            const labels = completions.map(c => c.label);
            expect(labels).not.toContain('generate');
            expect(labels).not.toContain('regress');
        });

        it('should suppress command completions in python context', async () => {
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, 'python\nprint("hello")\nend python');
            
            const provider_with_context = new CompletionProvider(
                command_db,
                { snippet_support: true },
                my_context_tracker
            );
            
            // Position inside python block (line 1)
            const doc = create_test_document('python\nprint("hello")\nend python');
            const completions = await provider_with_context.get_completions(
                doc,
                { line: 1, character: 0 }
            );
            
            // Should not have command completions
            const labels = completions.map(c => c.label);
            expect(labels).not.toContain('generate');
            expect(labels).not.toContain('regress');
        });

        it('should provide macro completions in mata context', async () => {
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, 'mata\nlocal x = `myvar\nend');
            
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('myvar', {
                name: 'myvar',
                scope: 'local',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                value: 'test_value',
            });
            
            const provider_with_context = new CompletionProvider(
                command_db,
                { snippet_support: true },
                my_context_tracker
            );
            
            // Position inside mata block with macro reference
            const doc = create_test_document('mata\nlocal x = `myvar\nend', { localMacros: local_macros });
            const completions = await provider_with_context.get_completions(
                doc,
                { line: 1, character: 19 }
            );
            
            // Should have macro completions
            const labels = completions.map(c => c.label);
            expect(labels).toContain('myvar');
        });

        it('should provide macro completions in python context', async () => {
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, 'python\nx = `myvar\nend python');
            
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('myvar', {
                name: 'myvar',
                scope: 'local',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                value: 'test_value',
            });
            
            const provider_with_context = new CompletionProvider(
                command_db,
                { snippet_support: true },
                my_context_tracker
            );
            
            // Position inside python block with macro reference
            const doc = create_test_document('python\nx = `myvar\nend python', { localMacros: local_macros });
            const completions = await provider_with_context.get_completions(
                doc,
                { line: 1, character: 9 }
            );
            
            // Should have macro completions
            const labels = completions.map(c => c.label);
            expect(labels).toContain('myvar');
        });

        it('should suggest end command at mata block boundary', async () => {
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, 'mata\ngen x = 1\n');
            
            const provider_with_context = new CompletionProvider(
                command_db,
                { snippet_support: true },
                my_context_tracker
            );
            
            // Position at start of line 2 (inside mata block)
            const doc = create_test_document('mata\ngen x = 1\n');
            const completions = await provider_with_context.get_completions(
                doc,
                { line: 2, character: 0 }
            );
            
            // Should suggest 'end' command
            const labels = completions.map(c => c.label);
            expect(labels).toContain('end');
        });

        it('should suggest end command at python block boundary', async () => {
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, 'python\nprint("hello")\n');
            
            const provider_with_context = new CompletionProvider(
                command_db,
                { snippet_support: true },
                my_context_tracker
            );
            
            // Position at start of line 2 (inside python block)
            const doc = create_test_document('python\nprint("hello")\n');
            const completions = await provider_with_context.get_completions(
                doc,
                { line: 2, character: 0 }
            );
            
            // Should suggest 'end' command
            const labels = completions.map(c => c.label);
            expect(labels).toContain('end');
        });

        it('should provide normal completions in stata context when typing prefix', async () => {
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, 'gen x = 1');
            
            const provider_with_context = new CompletionProvider(
                command_db,
                { snippet_support: true },
                my_context_tracker
            );
            
            // Type a prefix to get completions (empty prefix returns empty array)
            const doc = create_test_document('g');
            const completions = await provider_with_context.get_completions(
                doc,
                { line: 0, character: 1 }
            );
            
            // Should have command completions
            const labels = completions.map(c => c.label);
            expect(labels).toContain('generate');
        });
    });

    describe('Bug Fix: Backtick trigger should return snippet AND macro completions', () => {
        it('should return both snippet and macro completions on backtick trigger', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('apple_color', {
                name: 'apple_color',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 22 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'green',
            });

            const doc = create_test_document(
                'local apple_color green\nlocal fruit `',
                { localMacros: local_macros }
            );
            const completions = await provider.get_completions(
                doc,
                { line: 1, character: 13 },
                '`'
            );

            const labels = completions.map(c => c.label);
            // Should have the snippet
            expect(labels).toContain('Local macro reference');
            // Should also have the macro completion
            expect(labels).toContain('apple_color');
        });

        it('should auto-complete closing quote in snippet', async () => {
            const doc = create_test_document('local fruit `');
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 13 },
                '`'
            );

            const snippet = completions.find(
                c => c.label === 'Local macro reference'
            );
            expect(snippet).toBeDefined();
            // Snippet should include closing apostrophe
            expect(snippet?.insertText).toContain("'");
        });
    });

    describe('Bug Fix: Extended macro syntax should suggest macro names', () => {
        it('should suggest macros after `: list `', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('fruits', {
                name: 'fruits',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 40 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'apple peach pear',
            });
            local_macros.set('veggies', {
                name: 'veggies',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 30 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'lettuce tomato',
            });

            const doc = create_test_document(
                'local fruits apple peach pear\n' +
                'local veggies lettuce tomato\n' +
                'local both : list ',
                { localMacros: local_macros }
            );
            const completions = await provider.get_completions(
                doc,
                { line: 2, character: 18 }
            );

            const labels = completions.map(c => c.label);
            expect(labels).toContain('fruits');
            expect(labels).toContain('veggies');
        });

        it('should suggest macros after `& ` in list expression', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('fruits', {
                name: 'fruits',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 40 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'apple peach pear',
            });
            local_macros.set('veggies', {
                name: 'veggies',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 30 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'lettuce tomato',
            });

            const doc = create_test_document(
                'local fruits apple peach pear\n' +
                'local veggies lettuce tomato\n' +
                'local both : list fruits & ',
                { localMacros: local_macros }
            );
            const completions = await provider.get_completions(
                doc,
                { line: 2, character: 27 }
            );

            const labels = completions.map(c => c.label);
            expect(labels).toContain('fruits');
            expect(labels).toContain('veggies');
        });

        it('should filter macros by prefix in list expression', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('fruits', {
                name: 'fruits',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 40 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'apple peach pear',
            });
            local_macros.set('veggies', {
                name: 'veggies',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 30 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'lettuce tomato',
            });

            const doc = create_test_document(
                'local fruits apple peach pear\n' +
                'local veggies lettuce tomato\n' +
                'local both : list fruits & veg',
                { localMacros: local_macros }
            );
            const completions = await provider.get_completions(
                doc,
                { line: 2, character: 30 }
            );

            const labels = completions.map(c => c.label);
            expect(labels).toContain('veggies');
            expect(labels).not.toContain('fruits');
        });

        it('should suggest macros after `| ` (union) in list expression', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('list_a', {
                name: 'list_a',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 20 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'a b c',
            });
            local_macros.set('list_b', {
                name: 'list_b',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 20 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'd e f',
            });

            const doc = create_test_document(
                'local list_a a b c\n' +
                'local list_b d e f\n' +
                'local union : list list_a | ',
                { localMacros: local_macros }
            );
            const completions = await provider.get_completions(
                doc,
                { line: 2, character: 28 }
            );

            const labels = completions.map(c => c.label);
            expect(labels).toContain('list_a');
            expect(labels).toContain('list_b');
        });

        it('should suggest macros after `- ` (difference) in list expression', async () => {
            const local_macros = new Map<string, MacroSymbol>();
            local_macros.set('all_items', {
                name: 'all_items',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 25 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'a b c d',
            });
            local_macros.set('exclude', {
                name: 'exclude',
                scope: 'local',
                location: {
                    uri: 'file:///test.do',
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 20 }
                    }
                },
                sourceUri: 'file:///test.do',
                value: 'c d',
            });

            const doc = create_test_document(
                'local all_items a b c d\n' +
                'local exclude c d\n' +
                'local diff : list all_items - ',
                { localMacros: local_macros }
            );
            const completions = await provider.get_completions(
                doc,
                { line: 2, character: 30 }
            );

            const labels = completions.map(c => c.label);
            expect(labels).toContain('all_items');
            expect(labels).toContain('exclude');
        });
    });
    describe('Workspace Symbol Filtering', () => {
        it('should exclude workspace symbols from current document (stale) when merging', async () => {
            const uri = 'file:///test.do';
            const doc = create_test_document('display $', { globalMacros: new Map() });
            // Override URI to match test case
            doc.uri = uri;

            const workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            };
            
            // Stale symbol in workspace from SAME file
            workspace_symbols.globalMacros.set('STALE_FROM_HERE', {
                name: 'STALE_FROM_HERE',
                scope: 'global',
                location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                sourceUri: uri,
                containingScope: 'dofile',
                definition_line: 0
            });

            // Symbol from OTHER file
            workspace_symbols.globalMacros.set('FROM_OTHER', {
                name: 'FROM_OTHER',
                scope: 'global',
                location: { uri: 'file:///other.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                sourceUri: 'file:///other.do',
                containingScope: 'dofile',
                definition_line: 0
            });

            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 9 },
                '$',
                undefined,
                workspace_symbols
            );

            const labels = completions.map(c => c.label);
            expect(labels).toContain('FROM_OTHER');
            expect(labels).not.toContain('STALE_FROM_HERE');
        });

        it('should not surface workspace local macros when no directives or auto-parents apply', async () => {
            const uri = 'file:///test.do';
            const doc = create_test_document('display `', { localMacros: new Map() });
            doc.uri = uri;

            const workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            };

            workspace_symbols.localMacros.set('cwd', {
                name: 'cwd',
                scope: 'local',
                location: {
                    uri: 'file:///other.do',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                },
                sourceUri: 'file:///other.do',
                containingScope: 'dofile',
                definition_line: 0,
            } as MacroSymbol);

            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 9 },
                '`',
                undefined,
                workspace_symbols
            );

            const labels = completions.map(c => c.label);
            expect(labels).not.toContain('cwd');
        });
    });

    /**
     * Unit tests for Brace Trigger Completion Suppression
     * 
     * Feature: brace-trigger-completion-suppression
     * Validates: Requirements 1.1, 1.2, 1.3, 1.4
     * 
     * Tests that verify the completion provider correctly suppresses completions
     * when `{` is typed outside of a macro context, while still providing
     * completions when `{` is typed in a global macro braced context (`${`).
     */
    describe('Brace Trigger Completion Suppression', () => {
        it('should return empty completions for `if (fruit) {` (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` after `if (fruit) `
            const doc = create_test_document('if (fruit) {');
            // Position is after the `{` was typed (character 12)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 12 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });

        it('should return macro completions for `${` (Req 1.2, 1.3)', async () => {
            // Simulate typing `{` after `$`
            const global_macros = new Map<string, MacroSymbol>();
            global_macros.set('myvar', {
                name: 'myvar',
                scope: 'global',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                value: 'test_value',
            });

            const doc = create_test_document('${', { globalMacros: global_macros });
            // Position is after the `{` was typed (character 2)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 2 },
                '{'  // trigger character
            );

            // Should return macro completions (not empty)
            expect(completions.length).toBeGreaterThan(0);
            const labels = completions.map(c => c.label);
            expect(labels).toContain('myvar');
        });

        it('should return empty completions for `foreach x in {` (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` after `foreach x in `
            const doc = create_test_document('foreach x in {');
            // Position is after the `{` was typed (character 14)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 14 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });

        it('should return empty completions for `{` at start of line (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` at the start of a line
            const doc = create_test_document('{');
            // Position is after the `{` was typed (character 1)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 1 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });

        it('should return macro completions for `$${` (double dollar) (Req 1.2, 1.3)', async () => {
            // Test $$ (double dollar) followed by brace
            // In Stata, $$ is used for indirect macro reference
            // The character before `{` is `$`, so it should be treated as macro context
            const global_macros = new Map<string, MacroSymbol>();
            global_macros.set('nested', {
                name: 'nested',
                scope: 'global',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                value: 'test_value',
            });

            const doc = create_test_document('$${', { globalMacros: global_macros });
            // Position is after the `{` was typed (character 3)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 3 },
                '{'  // trigger character
            );

            // Should return macro completions since the character before `{` is `$`
            expect(completions.length).toBeGreaterThan(0);
        });

        it('should return empty completions for `while (x > 0) {` (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` after `while (x > 0) `
            const doc = create_test_document('while (x > 0) {');
            // Position is after the `{` was typed (character 15)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 15 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });

        it('should return empty completions for `else {` (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` after `else `
            const doc = create_test_document('else {');
            // Position is after the `{` was typed (character 6)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 6 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });

        it('should return empty completions for `program define myprogram {` (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` after `program define myprogram `
            const doc = create_test_document('program define myprogram {');
            // Position is after the `{` was typed (character 26)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 26 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });

        it('should return macro completions for `display ${` (Req 1.2, 1.3)', async () => {
            // Simulate typing `{` after `display $`
            const global_macros = new Map<string, MacroSymbol>();
            global_macros.set('result', {
                name: 'result',
                scope: 'global',
                location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
                sourceUri: 'file:///test.do',
                value: 'test_value',
            });

            const doc = create_test_document('display ${', { globalMacros: global_macros });
            // Position is after the `{` was typed (character 10)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 10 },
                '{'  // trigger character
            );

            // Should return macro completions (not empty)
            expect(completions.length).toBeGreaterThan(0);
            const labels = completions.map(c => c.label);
            expect(labels).toContain('result');
        });

        it('should return empty completions for `forvalues i = 1/10 {` (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` after `forvalues i = 1/10 `
            const doc = create_test_document('forvalues i = 1/10 {');
            // Position is after the `{` was typed (character 20)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 20 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });

        it('should return empty completions for brace after whitespace only (Req 1.1, 1.4)', async () => {
            // Simulate typing `{` after whitespace
            const doc = create_test_document('    {');
            // Position is after the `{` was typed (character 5)
            const completions = await provider.get_completions(
                doc,
                { line: 0, character: 5 },
                '{'  // trigger character
            );

            expect(completions).toEqual([]);
        });
    });
});

describe('Out-of-scope ranking', () => {
    it('should rank out-of-scope items below in-scope items for the same symbol type', () => {
        const { compute_ranking_key } = require('../../src/providers/completion');
        const in_scope_key = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'global-macro',
            alphabetical_order: 'zzz',
            parent_uri: 'file:///a.do',
        });
        const out_of_scope_key = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'out-of-scope',
            symbol_type: 'global-macro',
            alphabetical_order: 'aaa',
            parent_uri: 'file:///b.do',
        });
        expect(in_scope_key < out_of_scope_key).toBe(true);
    });

    it('should keep in-scope symbol-type tiering above out-of-scope entries of other categories', () => {
        const { compute_ranking_key } = require('../../src/providers/completion');
        const in_scope_local = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'local-macro',
            alphabetical_order: 'x',
            parent_uri: 'file:///a.do',
        });
        const out_of_scope_program = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'out-of-scope',
            symbol_type: 'user-program',
            alphabetical_order: 'x',
            parent_uri: 'file:///b.do',
        });
        // Programs (priority 0) still sort before locals (10), but both compare
        // the existing scope+directive prefix first; an out-of-scope program
        // must sort AFTER an in-scope local of the same name.
        expect(in_scope_local < out_of_scope_program).toBe(true);
    });
});

describe('Out-of-scope global macro completion', () => {
    let command_db: CommandDatabase;
    let provider: CompletionProvider;

    beforeEach(() => {
        command_db = create_test_command_db();
        provider = new CompletionProvider(command_db, { snippet_support: true });
    });

    it('should list workspace globals as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('display $f', { globalMacros: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.globalMacros.set('foo_cfg', {
            name: 'foo_cfg',
            scope: 'global',
            location: {
                uri: 'file:///helper.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///helper.do',
            containingScope: 'dofile',
            definition_line: 0,
        } satisfies MacroSymbol);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 10 },
            undefined,
            undefined,
            workspace_symbols
        );

        const foo = completions.find(c => c.label === 'foo_cfg');
        expect(foo).toBeDefined();
        expect(foo!.detail).toContain('out of scope');
        expect(foo!.detail).toContain('helper.do');
    });

    it('should still emit in-scope document globals alongside out-of-scope workspace globals', async () => {
        const uri = 'file:///test.do';
        const local_globals = new Map();
        local_globals.set('here_cfg', {
            name: 'here_cfg',
            scope: 'global',
            location: {
                uri,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: uri,
            containingScope: 'dofile',
            definition_line: 0,
        });
        const doc = create_test_document('display $', { globalMacros: local_globals });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.globalMacros.set('there_cfg', {
            name: 'there_cfg',
            scope: 'global',
            location: {
                uri: 'file:///other.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///other.do',
            containingScope: 'dofile',
            definition_line: 0,
        } satisfies MacroSymbol);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            '$',
            undefined,
            workspace_symbols
        );
        const here = completions.find(c => c.label === 'here_cfg');
        const there = completions.find(c => c.label === 'there_cfg');
        expect(here).toBeDefined();
        expect(there).toBeDefined();
        expect((here!.detail || '')).not.toContain('out of scope');
        expect((there!.detail || '')).toContain('out of scope');
        // Out-of-scope sorts after in-scope.
        expect(here!.sortText! < there!.sortText!).toBe(true);
    });
});

describe('Out-of-scope program completion', () => {
    let command_db: CommandDatabase;
    let provider: CompletionProvider;

    beforeEach(() => {
        command_db = create_test_command_db();
        provider = new CompletionProvider(command_db, { snippet_support: true });
    });

    it('should list workspace programs as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('my_', { programs: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.programs.set('my_helper', {
            name: 'my_helper',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
        } satisfies ProgramSymbol);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 3 },
            undefined,
            undefined,
            workspace_symbols
        );

        const helper = completions.find(c => c.label === 'my_helper');
        expect(helper).toBeDefined();
        expect(helper!.detail).toContain('out of scope');
        expect(helper!.detail).toContain('lib.do');
    });

    it('should not shadow built-in commands when a workspace program shares a built-in name', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('sum', { programs: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.programs.set('summarize', {
            name: 'summarize',
            location: {
                uri: 'file:///shadow.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///shadow.do',
        } satisfies ProgramSymbol);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 3 },
            undefined,
            undefined,
            workspace_symbols
        );

        // Built-in command must still appear.
        const summarize_items = completions.filter(c => c.label === 'summarize');
        expect(summarize_items.length).toBeGreaterThanOrEqual(1);
        const builtin = summarize_items.find(
            c => !(c.detail || '').includes('out of scope')
        );
        expect(builtin).toBeDefined();
    });
});

describe('Out-of-scope scalar and matrix completion', () => {
    let command_db: CommandDatabase;
    let provider: CompletionProvider;

    beforeEach(() => {
        command_db = create_test_command_db();
        provider = new CompletionProvider(command_db, { snippet_support: true });
    });

    it('should list workspace scalars as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('display s', { scalars: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.scalars.set('s_alpha', {
            name: 's_alpha',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
        } satisfies ScalarSymbol);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            undefined,
            undefined,
            workspace_symbols
        );

        const item = completions.find(c => c.label === 's_alpha');
        expect(item).toBeDefined();
        expect(item!.detail).toContain('out of scope');
        expect(item!.detail).toContain('lib.do');
    });

    it('should list workspace matrices as out-of-scope when no directives link the file', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('display m', { matrices: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.matrices.set('m_beta', {
            name: 'm_beta',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
        } satisfies MatrixSymbol);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            undefined,
            undefined,
            workspace_symbols
        );

        const item = completions.find(c => c.label === 'm_beta');
        expect(item).toBeDefined();
        expect(item!.detail).toContain('out of scope');
        expect(item!.detail).toContain('lib.do');
    });

    it('should not list variables as out-of-scope — variables remain workspace-wide', async () => {
        const uri = 'file:///test.do';
        const doc = create_test_document('summarize v', { variables: new Map() });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.variables.set('v_shared', {
            name: 'v_shared',
            location: {
                uri: 'file:///lib.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///lib.do',
            // Dataset columns are synthesized; `inferred` is the closest valid
            // `VariableSymbol.source` value for "not tied to a gen/egen/etc.".
            source: 'inferred',
        } satisfies VariableSymbol);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 11 },
            undefined,
            undefined,
            workspace_symbols
        );

        const item = completions.find(c => c.label === 'v_shared');
        expect(item).toBeDefined();
        // Variables keep their normal detail (never the out-of-scope marker).
        expect((item!.detail || '')).not.toContain('out of scope');
    });
});

describe('In-scope global keeps normal completion rank', () => {
    let provider: CompletionProvider;

    beforeEach(() => {
        const command_db = create_test_command_db();
        provider = new CompletionProvider(command_db, { snippet_support: true });
    });

    it('should not label a workspace global as out-of-scope when it is in the in-scope bag', async () => {
        const uri = 'file:///test.do';
        // Simulate an in-scope workspace global by placing it in the document's own symbol table
        // (no separate scope_resolver needed — the filter uses in-scope membership, not provenance).
        const doc_globals = new Map<string, MacroSymbol>();
        doc_globals.set('shared_cfg', {
            name: 'shared_cfg',
            scope: 'global',
            location: {
                uri: 'file:///helper.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///helper.do',
            containingScope: 'dofile',
            definition_line: 0,
        });
        const doc = create_test_document('display $', { globalMacros: doc_globals });
        doc.uri = uri;

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.globalMacros.set('shared_cfg', doc_globals.get('shared_cfg')!);

        const completions = await provider.get_completions(
            doc,
            { line: 0, character: 9 },
            '$',
            undefined,
            workspace_symbols
        );

        const shared = completions.find(c => c.label === 'shared_cfg');
        expect(shared).toBeDefined();
        expect((shared!.detail || '')).not.toContain('out of scope');
    });
});

describe('Local macro completion respects position within file', () => {
    let provider: CompletionProvider;

    beforeEach(() => {
        const command_db = create_test_command_db();
        provider = new CompletionProvider(command_db, { snippet_support: true });
    });

    it('should exclude local macros defined after the cursor line', async () => {
        const uri = 'file:///demo.do';
        const local_macros = new Map();
        local_macros.set('fruit', {
            name: 'fruit',
            scope: 'local',
            location: {
                uri,
                range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
            },
            sourceUri: uri,
            containingScope: 'dofile',
            definition_line: 0,
            definition_index: 0,
            value: 'apple banana cherry',
        });
        local_macros.set('color', {
            name: 'color',
            scope: 'local',
            location: {
                uri,
                range: { start: { line: 2, character: 6 }, end: { line: 2, character: 11 } },
            },
            sourceUri: uri,
            containingScope: 'dofile',
            definition_line: 2,
            definition_index: 1,
            value: 'red blue green',
        });

        // Document:
        //   line 0: local fruit "apple banana cherry"
        //   line 1: di "`           <-- cursor here
        //   line 2: local color "red blue green"
        const content = [
            'local fruit "apple banana cherry"',
            'di "`',
            'local color "red blue green"',
        ].join('\n');
        const doc = create_test_document(content, { localMacros: local_macros });
        doc.uri = uri;

        const completions = await provider.get_completions(
            doc,
            { line: 1, character: 5 }, // cursor after the backtick on line 1
            '`',
        );

        const labels = completions.map(c => c.label);
        expect(labels).toContain('fruit');
        expect(labels).not.toContain('color');
    });
});

describe('partition_symbols_for_completion: resolved_scope out-of-scope filtering', () => {
    let provider: CompletionProvider;

    beforeEach(() => {
        const command_db = create_test_command_db();
        provider = new CompletionProvider(command_db, { snippet_support: true });
    });

    it('should exclude call-site-filtered parent symbols from the workspace out-of-scope bucket', () => {
        const doc = create_test_document('');
        doc.uri = 'file:///child.do';

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        // Parent-defined global that lives in the workspace index but was
        // filtered out of the resolved scope by call-site filtering.
        workspace_symbols.globalMacros.set('foo_cfg', {
            name: 'foo_cfg',
            scope: 'global',
            location: {
                uri: 'file:///parent.do',
                range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
            },
            sourceUri: 'file:///parent.do',
            containingScope: 'dofile',
            definition_line: 5,
        } satisfies MacroSymbol);

        const in_scope: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };

        const resolved_scope = {
            chain: [],
            symbols: in_scope,
            out_of_scope_symbols: [{
                name: 'foo_cfg',
                type: 'global' as const,
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 3,
                reason: 'after_call_site' as const,
            }],
            diagnostics: [],
            has_directives: false,
            has_auto_parents: true,
        };

        // Call the private method via bracket access.
        const result = (provider as any).partition_symbols_for_completion(
            doc,
            workspace_symbols,
            in_scope,
            resolved_scope,
        ) as SymbolTable;

        // The call-site-filtered global must NOT appear in the workspace
        // out-of-scope bucket — it is already accounted for via
        // resolved_scope.out_of_scope_symbols.
        expect(result.globalMacros.has('foo_cfg')).toBe(false);
    });

    it('should still include out-of-scope workspace symbols not tracked by resolved_scope', () => {
        const doc = create_test_document('');
        doc.uri = 'file:///child.do';

        const workspace_symbols: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        workspace_symbols.globalMacros.set('unrelated_cfg', {
            name: 'unrelated_cfg',
            scope: 'global',
            location: {
                uri: 'file:///unrelated.do',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
            sourceUri: 'file:///unrelated.do',
            containingScope: 'dofile',
            definition_line: 0,
        } satisfies MacroSymbol);

        const in_scope: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };

        const resolved_scope = {
            chain: [],
            symbols: in_scope,
            out_of_scope_symbols: [{
                name: 'foo_cfg',
                type: 'global' as const,
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 3,
                reason: 'after_call_site' as const,
            }],
            diagnostics: [],
            has_directives: false,
            has_auto_parents: true,
        };

        const result = (provider as any).partition_symbols_for_completion(
            doc,
            workspace_symbols,
            in_scope,
            resolved_scope,
        ) as SymbolTable;

        // unrelated_cfg is NOT in resolved_scope.out_of_scope_symbols, so it
        // should still surface through the workspace out-of-scope bucket.
        expect(result.globalMacros.has('unrelated_cfg')).toBe(true);
    });
});

// ─── Regression guard: path completion preserves on-disk casing ───────────────
// Spec consumer #5 (2026-06-26-case-only-path-mismatch-design.md):
// Path completion lists real directory entries from disk, so it inherently
// presents correct casing. This block guards that no future refactor
// accidentally lowercases entry names before returning them.
describe('Path completion preserves on-disk casing', () => {
    let temp_dir: string;
    let provider: CompletionProvider;

    beforeEach(() => {
        // Create a workspace with a .git marker so get_workspace_root finds it.
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-path-casing-'));
        fs.mkdirSync(path.join(temp_dir, '.git'));
        // Mixed-case subdirectory and file names.
        fs.mkdirSync(path.join(temp_dir, 'Helpers'));
        fs.writeFileSync(path.join(temp_dir, 'Helpers', 'Clean.do'), '');
        fs.writeFileSync(path.join(temp_dir, 'Helpers', 'loadData.do'), '');
        fs.writeFileSync(path.join(temp_dir, 'analysis.do'), '');

        provider = new CompletionProvider(new CommandDatabase());
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Build a minimal DocumentState whose URI lives inside the temp workspace.
     */
    function make_doc(content: string): DocumentState {
        const file_uri = `file://${path.join(temp_dir, 'main.do')}`;
        return {
            uri: file_uri,
            version: 1,
            content,
            tokens: [],
            ast: null,
            symbols: {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            diagnostics: [],
            context_ranges: [],
            // context_tracker, forward_calls, etc. not needed for path
            // completion (the switch hits command_path before using them).
        } as unknown as DocumentState;
    }

    it('command_path (do): lists mixed-case files with real on-disk names', async () => {
        // Cursor is at end of "do Helpers/" — the provider should list
        // the real entries Clean.do and loadData.do, not lowercase them.
        const content = 'do Helpers/';
        const doc = make_doc(content);
        const position = Position.create(0, content.length);

        const completions = await provider.get_completions(doc, position);

        const the_labels = completions.map(c => c.label);
        expect(the_labels).toContain('Clean.do');
        expect(the_labels).toContain('loadData.do');
        // Guard: none of the labels should be lowercased versions
        expect(the_labels).not.toContain('clean.do');
        expect(the_labels).not.toContain('loaddata.do');
    });

    it('command_path (do): lists mixed-case directory with real on-disk name', async () => {
        // Typing "do " at root — should see Helpers/ not helpers/
        const content = 'do ';
        const doc = make_doc(content);
        const position = Position.create(0, content.length);

        const completions = await provider.get_completions(doc, position);

        const the_labels = completions.map(c => c.label);
        expect(the_labels).toContain('Helpers/');
        expect(the_labels).not.toContain('helpers/');
    });

    it('directive_path (@lsp-done-by): lists files with real on-disk casing', async () => {
        // Directive path context — same filesystem read, must preserve casing.
        const content = '// @lsp-done-by: Helpers/';
        const doc = make_doc(content);
        const position = Position.create(0, content.length);

        const completions = await provider.get_completions(doc, position);

        const the_labels = completions.map(c => c.label);
        expect(the_labels).toContain('Clean.do');
        expect(the_labels).toContain('loadData.do');
        expect(the_labels).not.toContain('clean.do');
        expect(the_labels).not.toContain('loaddata.do');
    });
});

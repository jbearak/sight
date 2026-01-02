/**
 * Unit tests for the Context-Aware Hover Provider
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { init_tracker_from_source } from '../test-context-helper';
import { Position } from 'vscode-languageserver';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { DocumentState } from '../../src/document-store';
import { SymbolTable, MacroSymbol, ProgramSymbol, VariableSymbol } from '../../src/types';
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
        options: [],
        category: 'data',
        isBuiltin: true,
    });
    db.register({
        name: 'regress',
        minAbbreviation: 'reg',
        syntax: 'regress depvar [indepvars]',
        description: 'Linear regression',
        options: [],
        category: 'regression',
        isBuiltin: true,
    });
    return db;
}

describe('HoverProvider - Context-Aware Behavior', () => {
    let hover_provider: HoverProvider;
    let context_tracker: ContextTracker;
    let command_db: CommandDatabase;

    beforeEach(() => {
        command_db = create_test_command_db();
        context_tracker = new ContextTracker();
        hover_provider = new HoverProvider(command_db, context_tracker);
    });

    describe('Stata Context Hover', () => {
        it('should provide command hover in Stata context', async () => {
            const my_content = 'generate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 2 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('generate');
            }
        });

        it('should provide macro hover in Stata context', async () => {
            const my_content = 'local x = 5\nuse `x`';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    ['x', {
                        name: 'x',
                        sourceUri: 'file:///test.do',
                        value: '5',
                        type: 'local',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 6 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Local Macro');
            }
        });
    });

    describe('Embedded Language Context Hover', () => {
        it('should suppress command hover in Mata context', async () => {
            const my_content = `mata
generate x = 1
end`;
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // Position is inside mata block (line 1)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 2 });

            // Should not provide Stata command hover
            expect(my_hover).toBeNull();
        });

        it('should suppress command hover in Python context', async () => {
            const my_content = `python
generate x = 1
end python`;
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // Position is inside python block (line 1)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 2 });

            // Should not provide Stata command hover
            expect(my_hover).toBeNull();
        });

        it('should still provide macro hover in Mata context', async () => {
            const my_content = 'mata\nmatrix A = `x\nend';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    ['x', {
                        name: 'x',
                        sourceUri: 'file:///test.do',
                        value: '5',
                        type: 'local',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on macro reference inside mata block
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 12 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Local Macro');
            }
        });

        it('should still provide macro hover in Python context', async () => {
            const my_content = 'python\nx = `y\nend python';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    ['y', {
                        name: 'y',
                        sourceUri: 'file:///test.do',
                        value: '10',
                        type: 'local',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on macro reference inside python block
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 6 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Local Macro');
            }
        });
    });

    describe('Block Delimiter Hover', () => {
        it('should provide hover for mata delimiter', async () => {
            const my_content = 'mata\nend';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 1 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Mata Block Start');
                expect(my_hover.contents.value).toContain('mata:');
            }
        });

        it('should provide hover for python delimiter', async () => {
            const my_content = 'python\nend python';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 2 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Python Block Start');
                expect(my_hover.contents.value).toContain('python:');
            }
        });

        it('should provide context-specific hover for end in Mata context', async () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'end' command in mata context (line 2, character 0-2)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 0 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('End Mata Block');
            }
        });

        it('should provide context-specific hover for end in Python context', async () => {
            const my_content = 'python\nx = 1\nend';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'end' in Python context (line 2, character 0)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 0 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('End Python Block');
                expect(my_hover.contents.value).toContain('**Syntax:** `end`');
                expect(my_hover.contents.value).not.toContain('end python');
            }
        });

        it('should show updated Python block start syntax', async () => {
            const my_content = 'python\nend';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 2 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Python Block Start');
                expect(my_hover.contents.value).toContain('must end with `end`');
                expect(my_hover.contents.value).toContain('```stata\npython\n  # Python code here\nend\n```');
                expect(my_hover.contents.value).not.toContain('end python');
            }
        });

        it('should provide correct hover for end in Mata context', async () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'end' command in mata context (line 2, character 0)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 0 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('End Mata Block');
                expect(my_hover.contents.value).toContain('**Syntax:** `end`');
                expect(my_hover.contents.value).not.toContain('end mata');
            }
        });
    });

    describe('Hover without Context Tracker', () => {
        it('should work without context tracker (backward compatibility)', async () => {
            const my_provider = new HoverProvider(command_db);
            const my_content = 'generate x = 1';
            const my_doc = create_test_document(my_content);

            const my_hover = await my_provider.get_hover(my_doc, { line: 0, character: 2 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('generate');
            }
        });
    });

    describe('Hover with Global Macros', () => {
        it('should provide global macro hover in Stata context', async () => {
            const my_content = 'global x = 5\nuse $x';
            const my_doc = create_test_document(my_content, {
                globalMacros: new Map([
                    ['x', {
                        name: 'x',
                        sourceUri: 'file:///test.do',
                        value: '5',
                        type: 'global',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 6 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Global Macro');
            }
        });

        it('should provide global macro hover in Mata context', async () => {
            const my_content = 'mata\nmatrix A = $x\nend';
            const my_doc = create_test_document(my_content, {
                globalMacros: new Map([
                    ['x', {
                        name: 'x',
                        sourceUri: 'file:///test.do',
                        value: '5',
                        type: 'global',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'x' in '$x' (line 1, character 16)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 16 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Global Macro');
            }
        });
    });

    describe('Hover with Programs', () => {
        it('should provide program hover in Stata context', async () => {
            const my_content = 'program my_prog\nend\nmy_prog';
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    ['my_prog', {
                        name: 'my_prog',
                        sourceUri: 'file:///test.do',
                        type: 'program',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 2 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Program');
            }
        });

        it('should not provide program hover in Mata context', async () => {
            const my_content = `mata
my_prog
end`;
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    ['my_prog', {
                        name: 'my_prog',
                        sourceUri: 'file:///test.do',
                        type: 'program',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 2 });

            // Should not provide program hover in embedded context
            expect(my_hover).toBeNull();
        });

        it('should provide hover for program with exact case match (MyProg)', async () => {
            const my_content = 'program MyProg\nend\nMyProg';
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    ['MyProg', {
                        name: 'MyProg',
                        sourceUri: 'file:///test.do',
                        type: 'program',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 2 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Program');
                expect(my_hover.contents.value).toContain('MyProg');
            }
        });

        it('should NOT provide hover for program with wrong case (myprog vs MyProg)', async () => {
            const my_content = 'program MyProg\nend\nmyprog';
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    ['MyProg', {
                        name: 'MyProg',
                        sourceUri: 'file:///test.do',
                        type: 'program',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Hover over 'myprog' (lowercase) - should NOT match 'MyProg'
            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 2 });

            expect(my_hover).toBeNull();
        });
    });

    describe('Hover with Variables', () => {
        it('should provide variable hover in Stata context', async () => {
            const my_content = 'use mydata\nuse x';
            const my_doc = create_test_document(my_content, {
                variables: new Map([
                    ['x', {
                        name: 'x',
                        type: 'numeric',
                        label: 'Variable X',
                        source: 'mydata.dta',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 6 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Variable');
            }
        });

        it('should not provide variable hover in Python context', async () => {
            const my_content = `python
x = 1
end python`;
            const my_doc = create_test_document(my_content, {
                variables: new Map([
                    ['x', {
                        name: 'x',
                        type: 'numeric',
                        label: 'Variable X',
                        source: 'mydata.dta',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 1 });

            // Should not provide variable hover in embedded context
            expect(my_hover).toBeNull();
        });
    });

    describe('Updated Block Delimiter Hover Tests', () => {
        it('should show correct end delimiter hover when hovering over end in Python block from Stata context', async () => {
            const my_content = 'python\nx = 1\nend';
            const my_doc = create_test_document(my_content);
            my_doc.context_tracker = context_tracker;
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'end' delimiter (line 2, character 1)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 1 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('End Python Block');
                expect(my_hover.contents.value).toContain('**Syntax:** `end`');
                expect(my_hover.contents.value).not.toContain('end python');
            }
        });

        it('should show correct end delimiter hover when hovering over end in Mata block from Stata context', async () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_doc = create_test_document(my_content);
            my_doc.context_tracker = context_tracker;
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'end' delimiter (line 2, character 1)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 2, character: 1 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('End Mata Block');
                expect(my_hover.contents.value).toContain('**Syntax:** `end`');
                expect(my_hover.contents.value).not.toContain('end mata');
            }
        });

        it('should provide hover for python delimiter with updated syntax documentation', async () => {
            const my_content = 'python\nend';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 2 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Python Block Start');
                expect(my_hover.contents.value).toContain('python:');
                expect(my_hover.contents.value).toContain('must end with `end`');
                expect(my_hover.contents.value).not.toContain('end python');
            }
        });

        it('should provide hover for mata delimiter with consistent syntax documentation', async () => {
            const my_content = 'mata\nend';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 1 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Mata Block Start');
                expect(my_hover.contents.value).toContain('mata:');
                expect(my_hover.contents.value).toContain('must end with `end`');
                expect(my_hover.contents.value).not.toContain('end mata');
            }
        });
    });
});

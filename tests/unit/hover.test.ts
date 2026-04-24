/**
 * Unit tests for the Context-Aware Hover Provider
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { init_tracker_from_source } from '../test-context-helper';
import { Position } from 'vscode-languageserver';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import type { CommandCache } from '../../src/command-database/types';
import { DocumentState } from '../../src/document-store';
import { SymbolTable, MacroSymbol, ProgramSymbol, VariableSymbol } from '../../src/types';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext } from '../../src/context-tracker/types';
import { StataLexer } from '../../src/lexer';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(content: string, symbols?: Partial<SymbolTable>): DocumentState {
    const my_lexer = new StataLexer();
    const my_lex_result = my_lexer.tokenize(content);
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        tokens: my_lex_result.tokens,
        ast: null,
        symbols: {
            programs: symbols?.programs || new Map(),
            localMacros: symbols?.localMacros || new Map(),
            globalMacros: symbols?.globalMacros || new Map(),
            variables: symbols?.variables || new Map(),
        },
        diagnostics: [],
    } as unknown as DocumentState;
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

function create_mi_missing_command_db(): CommandDatabase {
    const db = new CommandDatabase();
    const cache: CommandCache = {
        version: 18,
        commands: {
            mi: {
                name: 'mi',
                min_abbreviation: 2,
                options: [
                    {
                        name: 'offset',
                        min_abbreviation: 3,
                        has_argument: true,
                    },
                    {
                        name: 'augment',
                        min_abbreviation: 3,
                        has_argument: false,
                    },
                    {
                        name: 'conditional',
                        min_abbreviation: 4,
                        has_argument: true,
                    },
                    {
                        name: 'bootstrap',
                        min_abbreviation: 4,
                        has_argument: false,
                    },
                ],
                priority: 3,
            },
            missing: {
                name: 'missing',
                min_abbreviation: 4,
                options: [
                    {
                        name: 'within',
                        min_abbreviation: 6,
                        has_argument: true,
                    },
                ],
                priority: 3,
            },
        },
        abbreviations: {
            miss: 'missing',
            missi: 'missing',
            missin: 'missing',
        },
    };
    db.load_cache(cache);
    return db;
}

function create_frame_command_db(): CommandDatabase {
    const db = new CommandDatabase();
    const cache: CommandCache = {
        version: 18,
        commands: {
            frame: {
                name: 'frame',
                min_abbreviation: 5,
                options: [],
                subcommands: [
                    { name: 'create', min_abbreviation: 6 },
                    { name: 'drop', min_abbreviation: 4 },
                ],
                priority: 3,
            },
        },
        abbreviations: {},
    };
    db.load_cache(cache);
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

        it('should return subcommand hover for valid lowercase `by` prefix', async () => {
            command_db = create_frame_command_db();
            hover_provider = new HoverProvider(command_db, context_tracker);

            const my_content = 'by x: frame create mygood';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // cursor is on "create" at column 15
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 15 });

            expect(my_hover).not.toBeNull();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Frame Subcommand');
            }
        });

        it('should not treat uppercase `BY` as a prefix command (Stata is case-sensitive)', async () => {
            command_db = create_frame_command_db();
            hover_provider = new HoverProvider(command_db, context_tracker);

            const my_content = 'BY x: frame create mygood';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // cursor is on "create" at column 15
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 15 });

            if (my_hover && typeof my_hover.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).not.toContain('Frame Subcommand');
            }
        });

        it('should not treat non-by colons as by-prefix syntax in line fallback', () => {
            command_db = create_frame_command_db();
            hover_provider = new HoverProvider(command_db, context_tracker);

            const my_content = 'merge 1:m frame create mygood';
            const my_doc = {
                uri: 'file:///test.do',
                version: 1,
                content: my_content,
                tokens: [],
            } as unknown as DocumentState;

            const my_result = (hover_provider as any).get_subcommand_context_from_line(
                my_doc,
                { line: 0, character: 16 } as Position,
                'create'
            );

            expect(my_result).toEqual({
                is_subcommand: false,
                prefix_command: null,
            });
        });

        it('should not show command hover for an option name after a top-level comma', async () => {
            // `replace` is a Stata command and also a merge option. In option
            // position the command hover would mislead the user.
            const my_db = new CommandDatabase();
            my_db.load_cache({
                version: 18,
                commands: {
                    merge: {
                        name: 'merge',
                        min_abbreviation: 5,
                        options: [
                            { name: 'replace', min_abbreviation: 3, has_argument: false },
                        ],
                        priority: 3,
                    },
                    replace: {
                        name: 'replace',
                        min_abbreviation: 3,
                        options: [],
                        priority: 3,
                    },
                },
                abbreviations: {},
            });
            const my_provider = new HoverProvider(my_db, context_tracker);

            const my_content = 'merge 1:1 id using foo, replace';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // cursor inside "replace" (starts at column 24)
            const my_hover = await my_provider.get_hover(my_doc, { line: 0, character: 26 });

            if (my_hover && typeof my_hover.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).not.toContain('help replace');
            }
        });

        it('should provide macro hover inside an option argument', async () => {
            const my_content = "regress y x, cluster(`mymacro')";
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    ['mymacro', {
                        name: 'mymacro',
                        sourceUri: 'file:///test.do',
                        value: 'id',
                        type: 'local',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // cursor is on "mymacro" at column 23
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 23 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Local Macro');
            }
        });

        it(
            'should resolve mi() expression hover to missing, not the mi prefix command',
            async () => {
                command_db = create_mi_missing_command_db();
                hover_provider = new HoverProvider(command_db, context_tracker);

                const my_content = 'replace foo = . if mi(bar)';
                const my_doc = create_test_document(my_content);
                init_tracker_from_source(context_tracker, my_content);

                const my_hover = await hover_provider.get_hover(
                    my_doc,
                    { line: 0, character: 20 }
                );

                expect(my_hover).not.toBeNull();
                expect(my_hover?.contents).toBeDefined();
                if (
                    typeof my_hover?.contents === 'object'
                    && 'value' in my_hover.contents
                ) {
                    expect(my_hover.contents.value).toContain('**missing**');
                    expect(my_hover.contents.value).not.toContain('offset');
                    expect(my_hover.contents.value).not.toContain('augment');
                    expect(my_hover.contents.value)
                        .not.toContain('conditional');
                    expect(my_hover.contents.value).not.toContain('bootstrap');
                }
            }
        );
    });

    describe('Comment Context Hover', () => {
        it('should suppress hover inside star line comment', async () => {
            const my_content = '* see generate below\ngenerate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "generate" in the comment starts at character 6 on line 0
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 9 });

            expect(my_hover).toBeNull();
        });

        it('should suppress hover inside slash-slash line comment', async () => {
            const my_content = '// run generate here\ngenerate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "generate" in the comment starts at character 7 on line 0
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 10 });

            expect(my_hover).toBeNull();
        });

        it('should suppress hover inside block comment', async () => {
            const my_content = '/* calls regress here */\nregress y x';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "regress" inside /* ... */ on line 0 around character 12
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 12 });

            expect(my_hover).toBeNull();
        });

        it('should suppress hover inside a multi-line block comment', async () => {
            // Block comment spans two lines; "regress" appears on line 1 inside the comment
            const my_content = '/* start comment\nregress inside comment */\nregress y x';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "regress" on line 1 inside the comment starts at character 0
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 2 });

            expect(my_hover).toBeNull();
        });

        it('should suppress hover inside triple-slash line comment', async () => {
            const my_content = '/// run generate here\ngenerate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "generate" in the comment starts at character 8 on line 0
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 10 });

            expect(my_hover).toBeNull();
        });

        it('should suppress hover inside triple-slash continuation after code', async () => {
            // '/// generate' starts at column 13 on line 0
            const my_content = 'local y = 1 /// generate here\ngenerate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "generate" in the continuation comment starts at column 16 on line 0
            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 19 });

            expect(my_hover).toBeNull();
        });

        it('should still provide hover for code on the line after a /// continuation', async () => {
            const my_content = 'local y = 1 /// suppress hover here\ngenerate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "generate" on line 1 is real code
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 2 });

            expect(my_hover).not.toBeNull();
        });

        it('should still provide hover on code adjacent to a comment', async () => {
            const my_content = '* Define global configuration\ngenerate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            // "generate" on line 1 is real code
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 2 });

            expect(my_hover).not.toBeNull();
        });

        it('should provide hover on character immediately after an inline block comment', async () => {
            // "/* note */" ends at column 10; "generate" begins at column 10
            const my_content = '/* note */generate x = 1';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 0, character: 10 });

            expect(my_hover).not.toBeNull();
        });
    });

    describe('String Literal Context Hover', () => {
        it('should suppress hover on literal text inside a double-quoted string', async () => {
            // `di "fruit: `fruit'"` — hovering on the literal word "fruit"
            // inside the quotes should not trigger symbol lookup even when a
            // local macro named `fruit` exists.
            const my_content = 'local fruit = "apple"\ndi "fruit: `fruit\'"';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    ['fruit', {
                        name: 'fruit',
                        sourceUri: 'file:///test.do',
                        value: 'apple',
                        type: 'local',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Literal "fruit" begins at character 4 on line 1 (inside `"fruit: `)
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 6 });

            expect(my_hover).toBeNull();
        });

        it('should still hover on a macro reference embedded in a string', async () => {
            const my_content = 'local fruit = "apple"\ndi "fruit: `fruit\'"';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    ['fruit', {
                        name: 'fruit',
                        sourceUri: 'file:///test.do',
                        value: 'apple',
                        type: 'local',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // `fruit' begins at character 12 on line 1; the macro name starts at 13
            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 15 });

            expect(my_hover).not.toBeNull();
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
                        value_label_name: 'origin',
                        value_labels: new Map([
                            [0, 'Domestic'],
                            [1, 'Foreign'],
                        ]),
                        source: 'directive',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_hover = await hover_provider.get_hover(my_doc, { line: 1, character: 6 });

            expect(my_hover).not.toBeNull();
            expect(my_hover?.contents).toBeDefined();
            if (typeof my_hover?.contents === 'object' && 'value' in my_hover.contents) {
                expect(my_hover.contents.value).toContain('Variable');
                expect(my_hover.contents.value).toContain('Label: Variable X');
                expect(my_hover.contents.value).toContain('Value Label: `origin`');
                expect(my_hover.contents.value).toContain('`0` => Domestic');
                expect(my_hover.contents.value).toContain('`1` => Foreign');
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
                        source: 'directive',
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

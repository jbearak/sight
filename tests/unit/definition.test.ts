/**
 * Unit tests for the Context-Aware Definition Provider
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { init_tracker_from_source } from '../test-context-helper';
import { Position } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentState } from '../../src/document-store';
import { SymbolTable, MacroSymbol } from '../../src/types';
import { ContextTracker } from '../../src/context-tracker';
import { StataLexer } from '../../src/lexer';
import { host_is_case_sensitive } from '../../src/utils/file-path-utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(
    content: string,
    symbols?: Partial<SymbolTable>,
    uri?: string
): DocumentState {
    const my_lexer = new StataLexer();
    const my_lex_result = my_lexer.tokenize(content);
    return {
        uri: uri || URI.file(`${process.cwd()}/test.do`).toString(),
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

describe('DefinitionProvider - Context-Aware Behavior', () => {
    let definition_provider: DefinitionProvider;
    let context_tracker: ContextTracker;
    let temp_dir: string;

    beforeEach(() => {
        definition_provider = new DefinitionProvider();
        context_tracker = new ContextTracker();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
    });

    afterEach(() => {
        // Clean up temporary files
        if (fs.existsSync(temp_dir)) {
            fs.rmSync(temp_dir, { recursive: true, force: true });
        }
    });

    describe('Stata Context Definition Resolution', () => {
        it('should resolve local macro definition in Stata context', async () => {
            const my_content = 'local x = 5\nuse `x`';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'x',
                        {
                            name: 'x',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 6 },
                                    end: { line: 0, character: 7 },
                                },
                            },
                            value: '5',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 6 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
            expect(my_definition?.range.start.line).toBe(0);
        });

        it('should resolve global macro definition in Stata context', async () => {
            const my_content = 'global y = 10\nuse $y';
            const my_doc = create_test_document(my_content, {
                globalMacros: new Map([
                    [
                        'y',
                        {
                            name: 'y',
                            scope: 'global',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 8 },
                                },
                            },
                            value: '10',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 6 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
            expect(my_definition?.range.start.line).toBe(0);
        });

        it('should return definition when cursor is on global macro declaration name', async () => {
            const my_content = 'global data_path "data"';
            const my_doc = create_test_document(my_content, {
                globalMacros: new Map([
                    [
                        'data_path',
                        {
                            name: 'data_path',
                            scope: 'global',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 16 },
                                },
                            },
                            value: 'data',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Cursor in the middle of `data_path` (the declaration name)
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 10 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition).toMatchObject({
                uri: 'file:///test.do',
                range: {
                    start: { line: 0, character: 7 },
                    end: { line: 0, character: 16 },
                },
            });
        });

        it('should resolve to the global macro declaration when a variable of the same name exists', async () => {
            // Stata permits name collisions across namespaces. A cursor on
            // `data_path` in `global data_path "..."` must point to the macro,
            // not the variable that happens to share the name.
            const my_content = 'gen data_path = 1\nglobal data_path "data"\n';
            const my_doc = create_test_document(my_content, {
                variables: new Map([
                    ['data_path', {
                        name: 'data_path',
                        sourceUri: 'file:///test.do',
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 0, character: 4 },
                                end: { line: 0, character: 13 },
                            },
                        },
                        type: 'numeric' as const,
                        source: 'directive' as const,
                    }],
                ]),
                globalMacros: new Map([
                    ['data_path', {
                        name: 'data_path',
                        scope: 'global',
                        sourceUri: 'file:///test.do',
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 1, character: 7 },
                                end: { line: 1, character: 16 },
                            },
                        },
                        value: 'data',
                    }],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Cursor inside `data_path` in the `global` declaration on line 1
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 10 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition).toMatchObject({
                uri: 'file:///test.do',
                range: {
                    start: { line: 1, character: 7 },
                    end: { line: 1, character: 16 },
                },
            });
        });

        it('should prefer macro declaration over same-named variable via heuristic fallback (no tokens)', async () => {
            // Regression: the heuristic fallback path (taken when token lookup
            // fails) must match the WORD-token path, preferring a macro
            // declaration over a same-named variable.
            const my_content = 'gen data_path = 1\nglobal data_path "data"\n';
            const my_doc = create_test_document(my_content, {
                variables: new Map([
                    ['data_path', {
                        name: 'data_path',
                        sourceUri: 'file:///test.do',
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 0, character: 4 },
                                end: { line: 0, character: 13 },
                            },
                        },
                        type: 'numeric' as const,
                        source: 'directive' as const,
                    }],
                ]),
                globalMacros: new Map([
                    ['data_path', {
                        name: 'data_path',
                        scope: 'global',
                        sourceUri: 'file:///test.do',
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 1, character: 7 },
                                end: { line: 1, character: 16 },
                            },
                        },
                        value: 'data',
                    }],
                ]),
            });
            // Force heuristic fallback by stripping tokens so
            // get_token_at_position returns null.
            (my_doc as any).tokens = [];
            (my_doc as any).token_line_index = undefined;
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 10 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition).toMatchObject({
                uri: 'file:///test.do',
                range: {
                    start: { line: 1, character: 7 },
                    end: { line: 1, character: 16 },
                },
            });
        });

        it('should return definition when cursor is on local macro declaration name', async () => {
            const my_content = 'local my_var = 5';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'my_var',
                        {
                            name: 'my_var',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 6 },
                                    end: { line: 0, character: 12 },
                                },
                            },
                            value: '5',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Cursor in the middle of `my_var` (the declaration name)
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition).toMatchObject({
                uri: 'file:///test.do',
                range: {
                    start: { line: 0, character: 6 },
                    end: { line: 0, character: 12 },
                },
            });
        });

        it('should resolve program definition in Stata context', async () => {
            const my_content = 'program my_prog\nend\nmy_prog';
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    [
                        'my_prog',
                        {
                            name: 'my_prog',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 8 },
                                    end: { line: 0, character: 15 },
                                },
                            },
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 2, character: 2 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
            expect(my_definition?.range.start.line).toBe(0);
        });
    });

    describe('Embedded Language Context Definition Resolution', () => {
        it('should resolve macro in Mata context but not programs', async () => {
            const my_content = 'mata\nlocal x = `myvar\nend';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'myvar',
                        {
                            name: 'myvar',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 5 },
                                },
                            },
                            value: '42',
                        },
                    ],
                ]),
                programs: new Map([
                    [
                        'myvar',
                        {
                            name: 'myvar',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 5 },
                                },
                            },
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on macro reference inside mata block
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 12 },
                undefined,
                context_tracker
            );

            // Should resolve to macro, not program
            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });

        it('should resolve macro in Python context but not programs', async () => {
            const my_content = 'python\nx = `myvar\nend python';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'myvar',
                        {
                            name: 'myvar',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 5 },
                                },
                            },
                            value: '42',
                        },
                    ],
                ]),
                programs: new Map([
                    [
                        'myvar',
                        {
                            name: 'myvar',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 5 },
                                },
                            },
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on macro reference inside python block
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 6 },
                undefined,
                context_tracker
            );

            // Should resolve to macro, not program
            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });

        it('should not resolve program in Mata context', async () => {
            const my_content = 'mata\nmy_prog\nend';
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    [
                        'my_prog',
                        {
                            name: 'my_prog',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 7 },
                                },
                            },
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on program name inside mata block
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 2 },
                undefined,
                context_tracker
            );

            // Should not resolve program in embedded context
            expect(my_definition).toBeNull();
        });

        it('should not resolve program in Python context', async () => {
            const my_content = 'python\nmy_prog\nend python';
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    [
                        'my_prog',
                        {
                            name: 'my_prog',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 7 },
                                },
                            },
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on program name inside python block
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 2 },
                undefined,
                context_tracker
            );

            // Should not resolve program in embedded context
            expect(my_definition).toBeNull();
        });
    });

    describe('Macro Resolution Across Contexts', () => {
        it('should resolve global macro in Mata context', async () => {
            const my_content = 'mata\nmatrix A = $x\nend';
            const my_doc = create_test_document(my_content, {
                globalMacros: new Map([
                    [
                        'x',
                        {
                            name: 'x',
                            scope: 'global',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 1 },
                                },
                            },
                            value: '5',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'x' in '$x' inside mata block
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 16 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });

        it('should resolve local macro in Python context', async () => {
            const my_content = 'python\nx = `y\nend python';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'y',
                        {
                            name: 'y',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 1 },
                                },
                            },
                            value: '10',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on 'y' in '`y' inside python block
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 6 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });
    });

    describe('Definition without Context Tracker', () => {
        it('should work without context tracker (backward compatibility)', async () => {
            const my_content = 'local x = 5\nuse `x`';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'x',
                        {
                            name: 'x',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 6 },
                                    end: { line: 0, character: 7 },
                                },
                            },
                            value: '5',
                        },
                    ],
                ]),
            });

            // Call without context tracker
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 6 }
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });

        it('should resolve program without context tracker', async () => {
            const my_content = 'program my_prog\nend\nmy_prog';
            const my_doc = create_test_document(my_content, {
                programs: new Map([
                    [
                        'my_prog',
                        {
                            name: 'my_prog',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 8 },
                                    end: { line: 0, character: 15 },
                                },
                            },
                        },
                    ],
                ]),
            });

            // Call without context tracker
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 2, character: 2 }
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });
    });

    describe('Workspace Symbol Resolution', () => {
        it('should resolve macro from workspace symbols', async () => {
            const my_content = 'use $x';
            const my_doc = create_test_document(my_content);
            const my_workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map([
                    [
                        'x',
                        {
                            name: 'x',
                            scope: 'global',
                            sourceUri: 'file:///other.do',
                            location: {
                                uri: 'file:///other.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 1 },
                                },
                            },
                            value: '5',
                        },
                    ],
                ]),
                variables: new Map(),
            };
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 5 },
                my_workspace_symbols,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///other.do');
        });

        it('should resolve program from workspace symbols', async () => {
            const my_content = 'my_prog';
            const my_doc = create_test_document(my_content);
            const my_workspace_symbols: SymbolTable = {
                programs: new Map([
                    [
                        'my_prog',
                        {
                            name: 'my_prog',
                            sourceUri: 'file:///other.do',
                            location: {
                                uri: 'file:///other.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 7 },
                                },
                            },
                        },
                    ],
                ]),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
            };
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 2 },
                my_workspace_symbols,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///other.do');
        });
    });

    describe('No Definition Found', () => {
        it('should return null when no definition found', async () => {
            const my_content = 'use undefined_macro';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 6 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should return null for empty position', async () => {
            const my_content = '   ';
            const my_doc = create_test_document(my_content);
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 0 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });
    });

    describe('Comment Context Definition', () => {
        function make_variable_symbols(name: string) {
            return {
                variables: new Map([
                    [
                        name,
                        {
                            name,
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: name.length },
                                },
                            },
                            type: 'numeric' as const,
                            source: 'directive' as const,
                        },
                    ],
                ]),
            };
        }

        it('should suppress definition inside star line comment', async () => {
            const my_content = 'display 1\n* my_var here';
            const my_doc = create_test_document(my_content, make_variable_symbols('my_var'));
            init_tracker_from_source(context_tracker, my_content);

            // "my_var" in the comment starts at column 2 on line 1
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 4 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should suppress definition inside slash-slash line comment', async () => {
            const my_content = 'display 1\n// my_var here';
            const my_doc = create_test_document(my_content, make_variable_symbols('my_var'));
            init_tracker_from_source(context_tracker, my_content);

            // "my_var" in the comment starts at column 3 on line 1
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 5 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should suppress definition inside triple-slash line comment', async () => {
            const my_content = 'display 1\n/// my_var here';
            const my_doc = create_test_document(my_content, make_variable_symbols('my_var'));
            init_tracker_from_source(context_tracker, my_content);

            // "my_var" in the comment starts at column 4 on line 1
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 6 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should suppress definition inside triple-slash continuation after code', async () => {
            // 'display 1 /// my_var here\ndisplay my_var' — the continuation comment starts at column 10
            const my_content = 'display 1 /// my_var here\ndisplay my_var';
            const my_doc = create_test_document(my_content, make_variable_symbols('my_var'));
            init_tracker_from_source(context_tracker, my_content);

            // "my_var" inside the continuation comment starts at column 14 on line 0
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 16 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should suppress definition inside block comment', async () => {
            const my_content = 'display 1\n/* my_var here */';
            const my_doc = create_test_document(my_content, make_variable_symbols('my_var'));
            init_tracker_from_source(context_tracker, my_content);

            // "my_var" in the /* ... */ comment starts at column 3 on line 1
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 5 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should still resolve definitions on code after a /// continuation', async () => {
            // Line 1 has real code with my_var
            const my_content = 'display 1 /// suppressed here\ndisplay my_var';
            const my_doc = create_test_document(my_content, make_variable_symbols('my_var'));
            init_tracker_from_source(context_tracker, my_content);

            // "my_var" on line 1 starts at column 8
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 10 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
        });

        it('should suppress definition inside a comment in a mata block', async () => {
            const my_content = 'local x = 1\nmata\n// x\nend';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'x',
                        {
                            name: 'x',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 6 },
                                    end: { line: 0, character: 7 },
                                },
                            },
                            value: '1',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // "x" inside "// x" on line 2 (in mata block) is at column 3
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 2, character: 3 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should allow definition on character immediately after an inline block comment', async () => {
            // "/* note */" ends at column 10; "my_var" begins at column 10
            const my_content = '/* note */my_var';
            const my_doc = create_test_document(my_content, make_variable_symbols('my_var'));
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 10 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
        });
    });

    describe('Single-Line Embedded Contexts', () => {
        it('should resolve macro in single-line mata context', async () => {
            const my_content = 'mata: matrix A = `x';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'x',
                        {
                            name: 'x',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 1 },
                                },
                            },
                            value: '5',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on macro reference in single-line mata context
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 18 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });

        it('should resolve macro in single-line python context', async () => {
            const my_content = 'python: x = `y';
            const my_doc = create_test_document(my_content, {
                localMacros: new Map([
                    [
                        'y',
                        {
                            name: 'y',
                            scope: 'local',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 1 },
                                },
                            },
                            value: '10',
                        },
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            // Position is on macro reference in single-line python context
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 13 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });
    });

    describe('File Path Resolution with .do Fallback', () => {
        it('should resolve do command with .do fallback', async () => {
            // Create test file
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');
            
            const my_content = 'do "helper"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 } // Position on "helper"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });

        it('should resolve run command with .do fallback', async () => {
            // Create test file
            const script_path = path.join(temp_dir, 'script.do');
            fs.writeFileSync(script_path, '// Script file');
            
            const my_content = 'run "script"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 } // Position on "script"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('script');
        });

        it('should resolve include command with .do fallback', async () => {
            // Create test file
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');
            
            const my_content = 'include helper';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 10 } // Position on "helper"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });

        it('should resolve @lsp-done-by directive with .do fallback', async () => {
            // Create test file
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');
            
            const my_content = '// @lsp-done-by: "helper"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 20 } // Position on "helper"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });

        it('should resolve @lsp-included-by directive with .do fallback', async () => {
            // Create test file
            const script_path = path.join(temp_dir, 'script.do');
            fs.writeFileSync(script_path, '// Script file');
            
            const my_content = '// @lsp-included-by: "script"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 25 } // Position on "script"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('script');
        });

        it('should resolve @lsp-do directive with .do fallback', async () => {
            // Create test file
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');

            const my_content = '// @lsp-do: "helper"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 15 } // Position on "helper"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });

        it('should resolve canonical sight directive paths with .do fallback', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');

            const my_content = '// sight: do: "helper"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 17 }
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });

        it('should not resolve bare sight directive paths outside comments', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');

            const my_content = 'sight: do: "helper"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 15 }
            );

            expect(my_definition).toBeNull();
        });

        it('should not resolve # sight directive paths', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');

            const my_content = '// # sight: do: "helper"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 19 }
            );

            expect(my_definition).toBeNull();
        });

        it('should resolve @lsp-do directive inside a mata block', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');

            const my_content = 'mata\n// @lsp-do: "helper"\nend';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());
            init_tracker_from_source(context_tracker, my_content);

            // Position on "helper" on line 1 (inside the mata block)
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 16 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });

        it('should prefer exact path over .do fallback when both exist', async () => {
            // Create both files
            const script_path = path.join(temp_dir, 'script.do');
            const script_exact_path = path.join(temp_dir, 'script.do');
            fs.writeFileSync(script_path, '// Script file with .do');
            fs.writeFileSync(script_exact_path, '// Exact script file');
            
            const my_content = 'do "script.do"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 } // Position on "script.do"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('script.do');
        });

        it('should return null when neither exact path nor .do fallback exists', async () => {
            const my_content = 'do "nonexistent"';
            const my_doc = create_test_document(my_content, undefined, URI.file(path.join(temp_dir, 'test.do')).toString());

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 } // Position on "nonexistent"
            );

            expect(my_definition).toBeNull();
        });

        it('should not navigate to directive target when cursor is on a word outside the quoted path', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');

            // Directive is nested inside a star-style comment. Cursor is on
            // "note" — a word that is NOT part of the directive's quoted path.
            const my_content = '* note @lsp-do: "helper"';
            const my_doc = create_test_document(
                my_content,
                undefined,
                URI.file(path.join(temp_dir, 'test.do')).toString()
            );
            init_tracker_from_source(context_tracker, my_content);

            const note_char = my_content.indexOf('note') + 1;
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: note_char },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should still navigate to directive target when cursor is on the quoted path', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');

            const my_content = '* note @lsp-do: "helper"';
            const my_doc = create_test_document(
                my_content,
                undefined,
                URI.file(path.join(temp_dir, 'test.do')).toString()
            );
            init_tracker_from_source(context_tracker, my_content);

            const helper_char = my_content.indexOf('helper') + 1;
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: helper_char },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition).not.toBeInstanceOf(Array);
            const single = my_definition as { uri: string };
            expect(single.uri).toContain('helper');
        });

        // Regression tests: parameterized @lsp-* directives (line=, match="...")
        // See definition.ts L965: path_start must reflect the path-only span,
        // not the full match (which the regex currently truncates at the path
        // boundary, but this contract should hold even if the regex is later
        // broadened to capture trailing parameters).

        it('resolves @lsp-do when the quoted path is a substring of the directive keyword', async () => {
            // `do` appears both inside `@lsp-do` and as the file name. The
            // path_start calculation must not be fooled by the earlier
            // occurrence inside the directive keyword.
            const do_path = path.join(temp_dir, 'do.do');
            fs.writeFileSync(do_path, '// Helper file named "do"');

            const my_content = '// @lsp-do: "do"';
            const my_doc = create_test_document(
                my_content,
                undefined,
                URI.file(path.join(temp_dir, 'test.do')).toString()
            );
            init_tracker_from_source(context_tracker, my_content);

            const path_char = my_content.lastIndexOf('do'); // "do" inside the quotes
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: path_char + 1 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            const single = my_definition as { uri: string };
            expect(single.uri).toContain('do.do');
        });

        const the_parameterized_cases: Array<{
            name: string;
            directive: string;
        }> = [
            { name: '@lsp-done-by with line=', directive: '@lsp-done-by: "parent.do" line=5' },
            { name: '@lsp-included-by with line=', directive: '@lsp-included-by: "parent.do" line=5' },
            { name: '@lsp-do with line=', directive: '@lsp-do: "parent.do" line=5' },
            { name: '@lsp-run with line=', directive: '@lsp-run: "parent.do" line=5' },
            { name: '@lsp-include with line=', directive: '@lsp-include: "parent.do" line=5' },
            { name: '@lsp-done-by with match="..."', directive: '@lsp-done-by: "parent.do" match="some string"' },
            { name: '@lsp-do with match="..."', directive: '@lsp-do: "parent.do" match="some string"' },
            { name: '@lsp-done-by with line= and match="..."', directive: '@lsp-done-by: "parent.do" line=5 match="foo"' },
        ];

        for (const my_case of the_parameterized_cases) {
            it(`resolves ${my_case.name} when cursor sits on the quoted path`, async () => {
                const parent_path = path.join(temp_dir, 'parent.do');
                fs.writeFileSync(parent_path, '// Parent file');

                const my_content = `// ${my_case.directive}`;
                const my_doc = create_test_document(
                    my_content,
                    undefined,
                    URI.file(path.join(temp_dir, 'test.do')).toString()
                );
                init_tracker_from_source(context_tracker, my_content);

                // Cursor on a character that is unambiguously inside "parent.do"
                // and NOT inside the directive keyword substring.
                const path_first_char = my_content.indexOf('parent.do');
                const cursor_char = path_first_char + 3; // middle of "parent.do"

                const my_definition = await definition_provider.get_definition(
                    my_doc,
                    { line: 0, character: cursor_char },
                    undefined,
                    context_tracker
                );

                expect(my_definition).not.toBeNull();
                const single = my_definition as { uri: string };
                expect(single.uri).toContain('parent.do');
            });
        }
    });

    // ────────────────────────────────────────────────────────────────────────
    // Case-only (ci) path resolution via resolve_path_rich
    // ────────────────────────────────────────────────────────────────────────
    describe('Case-only path resolution (resolve_path_rich)', () => {
        it('navigates do command with wrong-cased path to real-cased file', async () => {
            // Create subdirectory + file with specific casing
            const helpers_dir = path.join(temp_dir, 'helpers');
            fs.mkdirSync(helpers_dir, { recursive: true });
            const real_path = path.join(helpers_dir, 'Clean.do');
            fs.writeFileSync(real_path, '// Helper file');

            // Reference uses wrong case for both directory and filename
            const my_content = 'do helpers/clean';
            const my_doc = create_test_document(
                my_content,
                undefined,
                URI.file(path.join(temp_dir, 'test.do')).toString()
            );

            const my_definition = await definition_provider.get_definition(
                my_doc,
                // Position inside "helpers/clean" (character 8 is inside the path)
                { line: 0, character: 8 }
            );

            expect(my_definition).not.toBeNull();
            const single = my_definition as { uri: string };
            // Must navigate to the real-cased file, not the as-typed path
            expect(single.uri).toContain('Clean.do');
        });

        it('navigates @lsp-done-by directive with wrong-cased path', async () => {
            const helpers_dir = path.join(temp_dir, 'helpers');
            fs.mkdirSync(helpers_dir, { recursive: true });
            const real_path = path.join(helpers_dir, 'Parent.do');
            fs.writeFileSync(real_path, '// Parent file');

            const my_content = '// @lsp-done-by: "helpers/parent"';
            const my_doc = create_test_document(
                my_content,
                undefined,
                URI.file(path.join(temp_dir, 'test.do')).toString()
            );

            // Cursor inside "helpers/parent" (quoted path area)
            const path_char = my_content.indexOf('helpers/parent') + 4;
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: path_char }
            );

            expect(my_definition).not.toBeNull();
            const single = my_definition as { uri: string };
            expect(single.uri).toContain('Parent.do');
        });

        it('still resolves exact-cased path (regression)', async () => {
            // Exact casing must still work after the change
            const helper_path = path.join(temp_dir, 'exact.do');
            fs.writeFileSync(helper_path, '// Exact file');

            const my_content = 'do exact';
            const my_doc = create_test_document(
                my_content,
                undefined,
                URI.file(path.join(temp_dir, 'test.do')).toString()
            );

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 5 }
            );

            expect(my_definition).not.toBeNull();
            const single = my_definition as { uri: string };
            expect(single.uri).toContain('exact.do');
        });

        it('returns null for missing path (no file at all)', async () => {
            const my_content = 'do totally_nonexistent_file';
            const my_doc = create_test_document(
                my_content,
                undefined,
                URI.file(path.join(temp_dir, 'test.do')).toString()
            );

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 }
            );

            expect(my_definition).toBeNull();
        });

        it('returns null for ambiguous path (two ci-matches, case-sensitive host only)', async () => {
            // This scenario requires a case-sensitive filesystem: two files
            // whose names differ only in ASCII case (Clean.do and CLEAN.do)
            // both ci-match the reference `do helpers/clean`.  resolve_path_rich
            // classifies this as `ambiguous` and definition should return null.
            //
            // On a case-insensitive host (macOS HFS+) it is impossible to
            // create both files; the second write silently overwrites the first,
            // yielding a single match (`case_only`) rather than `ambiguous`.
            // Guard the meaningful assertions behind the host probe.
            const helpers_dir = path.join(temp_dir, 'helpers');
            fs.mkdirSync(helpers_dir, { recursive: true });

            const the_is_sensitive = host_is_case_sensitive(helpers_dir);

            if (the_is_sensitive) {
                // Case-sensitive host: create two files differing only by case.
                fs.writeFileSync(
                    path.join(helpers_dir, 'Clean.do'),
                    '// Clean.do',
                );
                fs.writeFileSync(
                    path.join(helpers_dir, 'CLEAN.do'),
                    '// CLEAN.do',
                );

                // Both files are now present on disk.  A reference with a
                // third casing (clean.do) is a ci-match for both → ambiguous.
                const my_content = 'do helpers/clean';
                const my_doc = create_test_document(
                    my_content,
                    undefined,
                    URI.file(path.join(temp_dir, 'test.do')).toString()
                );

                const my_definition = await definition_provider.get_definition(
                    my_doc,
                    { line: 0, character: 8 }
                );

                // ambiguous → no navigation
                expect(my_definition).toBeNull();
            } else {
                // Case-insensitive host: the ambiguous scenario cannot be
                // constructed.  Write only one file so the test exercises the
                // case-insensitive code path without vacuously passing.
                fs.writeFileSync(
                    path.join(helpers_dir, 'Clean.do'),
                    '// Clean.do',
                );

                const my_content = 'do helpers/clean';
                const my_doc = create_test_document(
                    my_content,
                    undefined,
                    URI.file(path.join(temp_dir, 'test.do')).toString()
                );

                const my_definition = await definition_provider.get_definition(
                    my_doc,
                    { line: 0, character: 8 }
                );

                // On ci host a single ci-match resolves normally (case_only).
                expect(my_definition).not.toBeNull();
            }
        });
    });

    describe('Cross-directory case-only resolution with workspace roots', () => {
        it(
            'navigates do with wrong-cased cross-dir target when workspace root is set',
            async () => {
                // Layout:
                //   temp_dir/           ← workspace root
                //     sub/main.do       ← document under test
                //     shared/clean.do   ← real on-disk file (lowercase)
                //
                // The document references `do ../shared/Clean` (wrong case).
                // With workspace root set the resolver should walk shared/ and
                // find clean.do via a case-only match.
                const sub_dir = path.join(temp_dir, 'sub');
                const shared_dir = path.join(temp_dir, 'shared');
                fs.mkdirSync(sub_dir, { recursive: true });
                fs.mkdirSync(shared_dir, { recursive: true });

                const real_path = path.join(shared_dir, 'clean.do');
                fs.writeFileSync(real_path, '// Shared helper');

                const my_content = 'do ../shared/Clean';
                const my_doc = create_test_document(
                    my_content,
                    undefined,
                    URI.file(path.join(sub_dir, 'main.do')).toString()
                );

                // Set the workspace root so the provider can reach ../shared/
                definition_provider.set_workspace_roots([temp_dir]);

                // Cursor inside "../shared/Clean" (e.g. character 8)
                const my_definition = await definition_provider.get_definition(
                    my_doc,
                    { line: 0, character: 8 }
                );

                // On a case-insensitive FS (macOS HFS+) resolution succeeds
                // via existsSync regardless of workspace roots; on a
                // case-sensitive FS it depends on resolve_path_rich using the
                // workspace root to walk shared/. Both must be non-null.
                expect(my_definition).not.toBeNull();

                const the_is_sensitive = host_is_case_sensitive(shared_dir);
                if (the_is_sensitive) {
                    // Case-sensitive: must navigate to the real-cased path.
                    const single = my_definition as { uri: string };
                    expect(single.uri).toContain('clean.do');
                }
            }
        );

        it(
            'current_dir still works as fallback when workspace roots are empty',
            async () => {
                // Regression: even with no workspace roots set (e.g. early
                // startup), same-directory resolution must still succeed.
                const real_path = path.join(temp_dir, 'helper.do');
                fs.writeFileSync(real_path, '// Helper');

                const my_content = 'do helper';
                const my_doc = create_test_document(
                    my_content,
                    undefined,
                    URI.file(path.join(temp_dir, 'test.do')).toString()
                );

                // No workspace roots set (empty by default)
                definition_provider.set_workspace_roots([]);

                const my_definition = await definition_provider.get_definition(
                    my_doc,
                    { line: 0, character: 5 }
                );

                expect(my_definition).not.toBeNull();
                const single = my_definition as { uri: string };
                expect(single.uri).toContain('helper.do');
            }
        );
    });

    describe('DefinitionProvider - Symbol Precedence', () => {
        it('should prioritize document symbols over workspace symbols', async () => {
            // Create document with a local symbol
            const my_content = `
global test_var "document_value"
display "$test_var"
            `.trim();
            
            const document_symbols: Partial<SymbolTable> = {
                globalMacros: new Map([
                    ['test_var', {
                        name: 'test_var',
                        scope: 'global',
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 25 }
                            }
                        },
                        sourceUri: 'file:///test.do',
                        value: 'document_value'
                    } as MacroSymbol]
                ])
            };

            // Create workspace symbols with same name but different location
            const workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map([
                    ['test_var', {
                        name: 'test_var',
                        scope: 'global',
                        location: {
                            uri: 'file:///workspace.do',
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 25 }
                            }
                        },
                        sourceUri: 'file:///workspace.do',
                        value: 'workspace_value'
                    } as MacroSymbol]
                ]),
                variables: new Map()
            };

            const my_doc = create_test_document(my_content, document_symbols);
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 10 }, // Position on "test_var" in display command
                workspace_symbols
            );

            expect(my_definition).not.toBeNull();
            // Should return document symbol, not workspace symbol
            expect(my_definition?.uri).toBe('file:///test.do');
        });
    });
});


describe('DefinitionProvider - Case-Sensitive Program Lookup', () => {
    let definition_provider: DefinitionProvider;

    beforeEach(() => {
        definition_provider = new DefinitionProvider();
    });

    it('should resolve program definition with exact case match', async () => {
        const my_content = `program MyProg
    display "hello"
end
MyProg
`;
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['MyProg', {
                    name: 'MyProg',
                    location: {
                        uri: 'file:///test.do',
                        range: {
                            start: { line: 0, character: 8 },
                            end: { line: 0, character: 14 },
                        },
                    },
                    sourceUri: 'file:///test.do',
                }],
            ]),
        });

        // Position on "MyProg" call at line 3
        const my_definition = await definition_provider.get_definition(
            my_doc,
            { line: 3, character: 2 }
        );

        expect(my_definition).not.toBeNull();
        expect(my_definition?.uri).toBe('file:///test.do');
        expect(my_definition?.range.start.line).toBe(0);
    });

    it('should NOT resolve program definition with wrong case', async () => {
        const my_content = `program MyProg
    display "hello"
end
myprog
`;
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['MyProg', {
                    name: 'MyProg',
                    location: {
                        uri: 'file:///test.do',
                        range: {
                            start: { line: 0, character: 8 },
                            end: { line: 0, character: 14 },
                        },
                    },
                    sourceUri: 'file:///test.do',
                }],
            ]),
        });

        // Position on "myprog" call at line 3 (wrong case)
        const my_definition = await definition_provider.get_definition(
            my_doc,
            { line: 3, character: 2 }
        );

        // Should NOT find definition because case doesn't match
        expect(my_definition).toBeNull();
    });

    it('should resolve program from workspace symbols with exact case', async () => {
        const my_content = `MyProg arg1`;
        const my_doc = create_test_document(my_content);

        const workspace_symbols: SymbolTable = {
            programs: new Map([
                ['MyProg', {
                    name: 'MyProg',
                    location: {
                        uri: 'file:///other.do',
                        range: {
                            start: { line: 0, character: 8 },
                            end: { line: 0, character: 14 },
                        },
                    },
                    sourceUri: 'file:///other.do',
                }],
            ]),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
        };

        const my_definition = await definition_provider.get_definition(
            my_doc,
            { line: 0, character: 2 },
            workspace_symbols
        );

        expect(my_definition).not.toBeNull();
        expect(my_definition?.uri).toBe('file:///other.do');
    });

    it('should NOT resolve program from workspace symbols with wrong case', async () => {
        const my_content = `MYPROG arg1`;
        const my_doc = create_test_document(my_content);

        const workspace_symbols: SymbolTable = {
            programs: new Map([
                ['MyProg', {
                    name: 'MyProg',
                    location: {
                        uri: 'file:///other.do',
                        range: {
                            start: { line: 0, character: 8 },
                            end: { line: 0, character: 14 },
                        },
                    },
                    sourceUri: 'file:///other.do',
                }],
            ]),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
        };

        const my_definition = await definition_provider.get_definition(
            my_doc,
            { line: 0, character: 2 },
            workspace_symbols
        );

        // Should NOT find definition because case doesn't match
        expect(my_definition).toBeNull();
    });
});

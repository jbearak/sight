/**
 * Unit tests for the Context-Aware Symbol Provider
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
    SymbolProvider,
    is_position_in_range,
    find_containing_program,
    ProgramInfo,
} from '../../src/providers/symbols';
import { DocumentState } from '../../src/document-store';
import {
    SymbolTable,
    MacroSymbol,
    ProgramSymbol,
    VariableSymbol,
    ScalarSymbol,
    MatrixSymbol,
    StataAST,
    EmbeddedLanguageBlockNode,
} from '../../src/types';
import type {
    WorkspaceSymbolMatch,
    WorkspaceSymbolSource,
} from '../../src/types';
import { SymbolKind, DocumentSymbol } from 'vscode-languageserver';
import { Position, Range } from 'vscode-languageserver-textdocument';

/**
 * Build a WorkspaceSymbolSource stub from a fixed list of matches.
 * Simulates workspace-indexer substring search (case-insensitive).
 */
function build_source(matches: WorkspaceSymbolMatch[]): WorkspaceSymbolSource {
    return {
        find_all_symbol_definitions: (query: string) => {
            const lower = query.toLowerCase();
            return matches.filter(m => m.name.toLowerCase().includes(lower));
        },
    };
}

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(
    content: string,
    symbols?: Partial<SymbolTable>,
    ast?: StataAST
): DocumentState {
    const { ContextTracker } = require('../../src/context-tracker');
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        tokens: [],
        ast: ast || null,
        symbols: {
            programs: symbols?.programs || new Map(),
            localMacros: symbols?.localMacros || new Map(),
            globalMacros: symbols?.globalMacros || new Map(),
            variables: symbols?.variables || new Map(),
            scalars: symbols?.scalars || new Map(),
            matrices: symbols?.matrices || new Map(),
        },
        diagnostics: [],
        context_ranges: [],
        context_tracker: new ContextTracker(),
        line_offsets: [0],
    };
}

/**
 * Helper to create an embedded language block node.
 */
function create_embedded_block(
    language: 'mata' | 'python',
    start_line: number,
    end_line: number,
    start_command: string = language,
    end_command?: string
): EmbeddedLanguageBlockNode {
    return {
        type: 'embedded_block',
        language,
        start_command,
        end_command,
        content: 'matrix A = 1',
        content_range: {
            start: { line: start_line + 1, character: 0 },
            end: { line: end_line - 1, character: 0 },
        },
        is_single_line: false,
        range: {
            start: { line: start_line, character: 0 },
            end: { line: end_line, character: 0 },
        },
    };
}

describe('SymbolProvider - Embedded Language Support', () => {
    let symbol_provider: SymbolProvider;

    beforeEach(() => {
        symbol_provider = new SymbolProvider();
    });

    describe('Document Symbols with Embedded Blocks', () => {
        it('should include embedded language blocks in document symbols', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(1);
            const my_block = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_block).toBeDefined();
            expect(my_block?.kind).toBe(SymbolKind.Module);
            expect(my_block?.detail).toContain('mata');
        });

        it('should include Python blocks in document symbols', () => {
            const my_content = 'python\nx = 1\nend python';
            const my_python_block = create_embedded_block(
                'python',
                0,
                2,
                'python',
                'end python'
            );
            const my_ast: StataAST = {
                nodes: [my_python_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(1);
            const my_block = my_symbols.find(s => s.name === 'Python Block');
            expect(my_block).toBeDefined();
            expect(my_block?.kind).toBe(SymbolKind.Module);
            expect(my_block?.detail).toContain('python');
        });

        it('should include both programs and embedded blocks', () => {
            const my_content = 'program test\nend\nmata\nend';
            const my_mata_block = create_embedded_block('mata', 2, 3, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(
                my_content,
                {
                    programs: new Map([
                        [
                            'test',
                            {
                                name: 'test',
                                sourceUri: 'file:///test.do',
                                location: {
                                    uri: 'file:///test.do',
                                    range: {
                                        start: { line: 0, character: 0 },
                                        end: { line: 1, character: 0 },
                                    },
                                },
                            },
                        ],
                    ]),
                },
                my_ast
            );

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(2);
            const my_program = my_symbols.find(s => s.name === 'test');
            const my_block = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_program).toBeDefined();
            expect(my_program?.kind).toBe(SymbolKind.Function);
            expect(my_block).toBeDefined();
            expect(my_block?.kind).toBe(SymbolKind.Module);
        });

        it('should include macros and embedded blocks together', () => {
            const my_content = 'local x = 5\nmata\nend';
            const my_mata_block = create_embedded_block('mata', 1, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(
                my_content,
                {
                    localMacros: new Map([
                        [
                            'x',
                            {
                                name: 'x',
                                sourceUri: 'file:///test.do',
                                scope: 'local',
                                value: '5',
                                location: {
                                    uri: 'file:///test.do',
                                    range: {
                                        start: { line: 0, character: 0 },
                                        end: { line: 0, character: 11 },
                                    },
                                },
                            },
                        ],
                    ]),
                },
                my_ast
            );

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(2);
            const my_local = my_symbols.find(s => s.name === '`x\'');
            const my_block = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_local).toBeDefined();
            expect(my_local?.kind).toBe(SymbolKind.Variable);
            expect(my_block).toBeDefined();
            expect(my_block?.kind).toBe(SymbolKind.Module);
        });

        it('should handle multiple embedded blocks', () => {
            const my_content = 'mata\nend\npython\nend python';
            const my_mata_block = create_embedded_block('mata', 0, 1, 'mata', 'end');
            const my_python_block = create_embedded_block(
                'python',
                2,
                3,
                'python',
                'end python'
            );
            const my_ast: StataAST = {
                nodes: [my_mata_block, my_python_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(2);
            const my_names = my_symbols.map(s => s.name);
            expect(my_names).toContain('Mata Block');
            expect(my_names).toContain('Python Block');
        });

        it('should set correct range for embedded blocks', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            const my_block = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_block).toBeDefined();
            expect(my_block?.range).toEqual({
                start: { line: 0, character: 0 },
                end: { line: 2, character: 0 },
            });
        });

        it('should set selection range to full block range', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            // Selection range should be the full block range since
            // EmbeddedLanguageBlockNode doesn't have a separate start_delimiter property
            const my_block = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_block).toBeDefined();
            expect(my_block?.selectionRange).toEqual({
                start: { line: 0, character: 0 },
                end: { line: 2, character: 0 },
            });
        });
    });

    describe('Workspace Symbols with Embedded Blocks', () => {
        it('should include embedded blocks in workspace symbol search', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'mata',
                [my_doc]
            );

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('Mata Block');
            expect(my_symbols[0].kind).toBe(SymbolKind.Module);
        });

        it('should find Python blocks in workspace search', () => {
            const my_content = 'python\nx = 1\nend python';
            const my_python_block = create_embedded_block(
                'python',
                0,
                2,
                'python',
                'end python'
            );
            const my_ast: StataAST = {
                nodes: [my_python_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'python',
                [my_doc]
            );

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('Python Block');
        });

        it('should not find embedded blocks with non-matching query', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'nonexistent',
                [my_doc]
            );

            expect(my_symbols.length).toBe(0);
        });

        it('should include embedded blocks with macros in results', () => {
            const my_content = 'local x = 5\nmata\nend';
            const my_mata_block = create_embedded_block('mata', 1, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(
                my_content,
                {
                    localMacros: new Map([
                        [
                            'x',
                            {
                                name: 'x',
                                sourceUri: 'file:///test.do',
                                scope: 'local',
                                value: '5',
                                location: {
                                    uri: 'file:///test.do',
                                    range: {
                                        start: { line: 0, character: 0 },
                                        end: { line: 0, character: 11 },
                                    },
                                },
                            },
                        ],
                    ]),
                },
                my_ast
            );

            const my_symbols = symbol_provider.get_workspace_symbols('', [my_doc]);

            expect(my_symbols.length).toBe(2);
            const my_names = my_symbols.map(s => s.name);
            expect(my_names).toContain('`x\'');
            expect(my_names).toContain('Mata Block');
        });

        it('should set correct container name for embedded blocks', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'mata',
                [my_doc]
            );

            expect(my_symbols[0].containerName).toContain('Embedded Language');
            expect(my_symbols[0].containerName).toContain('test.do');
        });

        it('should handle case-insensitive search for embedded blocks', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'MATA',
                [my_doc]
            );

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('Mata Block');
        });
    });

    describe('Cross-Context Macro Navigation', () => {
        it('should track macro references across contexts', () => {
            const my_content = 'local x = 5\nmata\nmatrix A = `x\nend';
            const my_mata_block = create_embedded_block('mata', 1, 3, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(
                my_content,
                {
                    localMacros: new Map([
                        [
                            'x',
                            {
                                name: 'x',
                                sourceUri: 'file:///test.do',
                                scope: 'local',
                                value: '5',
                                location: {
                                    uri: 'file:///test.do',
                                    range: {
                                        start: { line: 0, character: 0 },
                                        end: { line: 0, character: 11 },
                                    },
                                },
                            },
                        ],
                    ]),
                },
                my_ast
            );

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            // Should include both macro and embedded block
            expect(my_symbols.length).toBe(2);
            const my_macro_symbol = my_symbols.find(s => s.name === '`x\'');
            const my_block_symbol = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_macro_symbol).toBeDefined();
            expect(my_block_symbol).toBeDefined();
        });

        it('should preserve macro definitions across embedded blocks', () => {
            const my_content =
                'local x = 5\nmata\nmatrix A = `x\nend\nuse `x';
            const my_mata_block = create_embedded_block('mata', 1, 3, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(
                my_content,
                {
                    localMacros: new Map([
                        [
                            'x',
                            {
                                name: 'x',
                                sourceUri: 'file:///test.do',
                                scope: 'local',
                                value: '5',
                                location: {
                                    uri: 'file:///test.do',
                                    range: {
                                        start: { line: 0, character: 0 },
                                        end: { line: 0, character: 11 },
                                    },
                                },
                            },
                        ],
                    ]),
                },
                my_ast
            );

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            // Macro should still be visible
            const my_macro_symbol = my_symbols.find(s => s.name === '`x\'');
            expect(my_macro_symbol).toBeDefined();
            expect(my_macro_symbol?.detail).toBe('Local Macro');
        });

        it('should include global macros in embedded blocks', () => {
            const my_content = 'global y = 10\nmata\nmatrix A = $y\nend';
            const my_mata_block = create_embedded_block('mata', 1, 3, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(
                my_content,
                {
                    globalMacros: new Map([
                        [
                            'y',
                            {
                                name: 'y',
                                sourceUri: 'file:///test.do',
                                scope: 'global',
                                value: '10',
                                location: {
                                    uri: 'file:///test.do',
                                    range: {
                                        start: { line: 0, character: 0 },
                                        end: { line: 0, character: 13 },
                                    },
                                },
                            },
                        ],
                    ]),
                },
                my_ast
            );

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            // Should include both global macro and embedded block
            expect(my_symbols.length).toBe(2);
            const my_global_symbol = my_symbols.find(s => s.name === 'y');
            const my_block_symbol = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_global_symbol).toBeDefined();
            expect(my_block_symbol).toBeDefined();
        });
    });

    describe('Embedded Block Details', () => {
        it('should include start command in detail for Mata blocks', () => {
            const my_content = 'mata\nmatrix A = 1\nend';
            const my_mata_block = create_embedded_block('mata', 0, 2, 'mata', 'end');
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            const my_block = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_block).toBeDefined();
            expect(my_block?.detail).toBe('Mata Block (mata)');
        });

        it('should include start command in detail for Python blocks', () => {
            const my_content = 'python\nx = 1\nend python';
            const my_python_block = create_embedded_block(
                'python',
                0,
                2,
                'python',
                'end python'
            );
            const my_ast: StataAST = {
                nodes: [my_python_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            const my_block = my_symbols.find(s => s.name === 'Python Block');
            expect(my_block).toBeDefined();
            expect(my_block?.detail).toBe('Python Block (python)');
        });

        it('should handle single-line Mata blocks', () => {
            const my_content = 'mata: matrix A = 1';
            const my_mata_block = create_embedded_block(
                'mata',
                0,
                0,
                'mata:',
                'mata:'
            );
            my_mata_block.is_single_line = true;
            const my_ast: StataAST = {
                nodes: [my_mata_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            const my_block = my_symbols.find(s => s.name === 'Mata Block');
            expect(my_block).toBeDefined();
            expect(my_block?.detail).toBe('Mata Block (mata:)');
        });

        it('should handle single-line Python blocks', () => {
            const my_content = 'python: x = 1';
            const my_python_block = create_embedded_block(
                'python',
                0,
                0,
                'python:',
                'python:'
            );
            my_python_block.is_single_line = true;
            const my_ast: StataAST = {
                nodes: [my_python_block],
            };
            const my_doc = create_test_document(my_content, undefined, my_ast);

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            const my_block = my_symbols.find(s => s.name === 'Python Block');
            expect(my_block).toBeDefined();
            expect(my_block?.detail).toBe('Python Block (python:)');
        });
    });

    describe('Scalar and Matrix Symbols', () => {
        it('should include scalar with correct kind and detail', () => {
            const my_content = 'scalar S = 1';
            const my_doc = create_test_document(my_content, {
                scalars: new Map([
                    [
                        'S',
                        {
                            name: 'S',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 12 },
                                },
                            },
                        },
                    ],
                ]),
            });

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('S');
            expect(my_symbols[0].kind).toBe(SymbolKind.Variable);
            expect(my_symbols[0].detail).toBe('Scalar');
        });

        it('should include matrix with correct kind and detail', () => {
            const my_content = 'matrix define M = (1, 2 \\ 3, 4)';
            const my_doc = create_test_document(my_content, {
                matrices: new Map([
                    [
                        'M',
                        {
                            name: 'M',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 31 },
                                },
                            },
                        },
                    ],
                ]),
            });

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('M');
            expect(my_symbols[0].kind).toBe(SymbolKind.Variable);
            expect(my_symbols[0].detail).toBe('Matrix');
        });

        it('should filter scalars by sourceUri', () => {
            const my_content = 'scalar S = 1';
            const my_doc = create_test_document(my_content, {
                scalars: new Map([
                    [
                        'S',
                        {
                            name: 'S',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 12 },
                                },
                            },
                        },
                    ],
                    [
                        'other_scalar',
                        {
                            name: 'other_scalar',
                            sourceUri: 'file:///other.do',
                            location: {
                                uri: 'file:///other.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 20 },
                                },
                            },
                        },
                    ],
                ]),
            });

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            // Should only include the scalar from test.do
            const my_scalar_symbols = my_symbols.filter(s => s.detail === 'Scalar');
            expect(my_scalar_symbols.length).toBe(1);
            expect(my_scalar_symbols[0].name).toBe('S');
        });

        it('should filter matrices by sourceUri', () => {
            const my_content = 'matrix M = I(3)';
            const my_doc = create_test_document(my_content, {
                matrices: new Map([
                    [
                        'M',
                        {
                            name: 'M',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 15 },
                                },
                            },
                        },
                    ],
                    [
                        'other_matrix',
                        {
                            name: 'other_matrix',
                            sourceUri: 'file:///other.do',
                            location: {
                                uri: 'file:///other.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 20 },
                                },
                            },
                        },
                    ],
                ]),
            });

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            // Should only include the matrix from test.do
            const my_matrix_symbols = my_symbols.filter(s => s.detail === 'Matrix');
            expect(my_matrix_symbols.length).toBe(1);
            expect(my_matrix_symbols[0].name).toBe('M');
        });

        it('should include both scalars and matrices with other symbols', () => {
            const my_content = 'scalar S = 1\nmatrix M = I(3)\nlocal x = 5';
            const my_doc = create_test_document(my_content, {
                scalars: new Map([
                    [
                        'S',
                        {
                            name: 'S',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 12 },
                                },
                            },
                        },
                    ],
                ]),
                matrices: new Map([
                    [
                        'M',
                        {
                            name: 'M',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 1, character: 0 },
                                    end: { line: 1, character: 15 },
                                },
                            },
                        },
                    ],
                ]),
                localMacros: new Map([
                    [
                        'x',
                        {
                            name: 'x',
                            sourceUri: 'file:///test.do',
                            scope: 'local',
                            value: '5',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 2, character: 0 },
                                    end: { line: 2, character: 11 },
                                },
                            },
                        },
                    ],
                ]),
            });

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols.length).toBe(3);
            const my_names = my_symbols.map(s => s.name);
            expect(my_names).toContain('S');
            expect(my_names).toContain('M');
            expect(my_names).toContain('`x\'');
        });

        it('should set correct range for scalar symbols', () => {
            const my_content = 'scalar my_scalar = 42';
            const my_expected_range = {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 21 },
            };
            const my_doc = create_test_document(my_content, {
                scalars: new Map([
                    [
                        'my_scalar',
                        {
                            name: 'my_scalar',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: my_expected_range,
                            },
                        },
                    ],
                ]),
            });

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols[0].range).toEqual(my_expected_range);
            expect(my_symbols[0].selectionRange).toEqual(my_expected_range);
        });

        it('should set correct range for matrix symbols', () => {
            const my_content = 'matrix my_matrix = (1, 2)';
            const my_expected_range = {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 25 },
            };
            const my_doc = create_test_document(my_content, {
                matrices: new Map([
                    [
                        'my_matrix',
                        {
                            name: 'my_matrix',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: my_expected_range,
                            },
                        },
                    ],
                ]),
            });

            const my_symbols = symbol_provider.get_document_symbols(my_doc);

            expect(my_symbols[0].range).toEqual(my_expected_range);
            expect(my_symbols[0].selectionRange).toEqual(my_expected_range);
        });
    });
});


describe('Range Containment Helpers', () => {
    describe('is_position_in_range', () => {
        const my_range: Range = {
            start: { line: 5, character: 10 },
            end: { line: 10, character: 20 },
        };

        it('should return true for position at range start', () => {
            const my_position: Position = { line: 5, character: 10 };
            expect(is_position_in_range(my_position, my_range)).toBe(true);
        });

        it('should return true for position at range end', () => {
            const my_position: Position = { line: 10, character: 20 };
            expect(is_position_in_range(my_position, my_range)).toBe(true);
        });

        it('should return true for position in middle of range', () => {
            const my_position: Position = { line: 7, character: 15 };
            expect(is_position_in_range(my_position, my_range)).toBe(true);
        });

        it('should return true for position on last line within character bounds', () => {
            const my_position: Position = { line: 10, character: 5 };
            expect(is_position_in_range(my_position, my_range)).toBe(true);
        });

        it('should return false for position before range start line', () => {
            const my_position: Position = { line: 4, character: 15 };
            expect(is_position_in_range(my_position, my_range)).toBe(false);
        });

        it('should return false for position after range end line', () => {
            const my_position: Position = { line: 11, character: 5 };
            expect(is_position_in_range(my_position, my_range)).toBe(false);
        });

        it('should return false for position on start line but before start character', () => {
            const my_position: Position = { line: 5, character: 5 };
            expect(is_position_in_range(my_position, my_range)).toBe(false);
        });

        it('should return false for position on end line but after end character', () => {
            const my_position: Position = { line: 10, character: 25 };
            expect(is_position_in_range(my_position, my_range)).toBe(false);
        });

        it('should handle single-line range correctly', () => {
            const my_single_line_range: Range = {
                start: { line: 3, character: 5 },
                end: { line: 3, character: 15 },
            };
            // Inside
            expect(is_position_in_range({ line: 3, character: 10 }, my_single_line_range)).toBe(true);
            // At start
            expect(is_position_in_range({ line: 3, character: 5 }, my_single_line_range)).toBe(true);
            // At end
            expect(is_position_in_range({ line: 3, character: 15 }, my_single_line_range)).toBe(true);
            // Before
            expect(is_position_in_range({ line: 3, character: 4 }, my_single_line_range)).toBe(false);
            // After
            expect(is_position_in_range({ line: 3, character: 16 }, my_single_line_range)).toBe(false);
        });
    });

    describe('find_containing_program', () => {
        /**
         * Helper to create a DocumentSymbol for testing.
         */
        function create_program_symbol(name: string, range: Range): DocumentSymbol {
            return {
                name,
                kind: SymbolKind.Function,
                range,
                selectionRange: range,
                detail: 'Program',
            };
        }

        it('should return null when no programs exist', () => {
            const my_position: Position = { line: 5, character: 0 };
            const my_programs = new Map<string, ProgramInfo>();

            const my_result = find_containing_program(my_position, my_programs);

            expect(my_result).toBeNull();
        });

        it('should return null when position is outside all programs', () => {
            const my_position: Position = { line: 20, character: 0 };
            const my_range: Range = {
                start: { line: 0, character: 0 },
                end: { line: 10, character: 0 },
            };
            const my_symbol = create_program_symbol('test_prog', my_range);
            const my_programs = new Map<string, ProgramInfo>([
                ['test_prog', { symbol: my_symbol, range: my_range }],
            ]);

            const my_result = find_containing_program(my_position, my_programs);

            expect(my_result).toBeNull();
        });

        it('should return the program when position is inside', () => {
            const my_position: Position = { line: 5, character: 0 };
            const my_range: Range = {
                start: { line: 0, character: 0 },
                end: { line: 10, character: 0 },
            };
            const my_symbol = create_program_symbol('test_prog', my_range);
            const my_programs = new Map<string, ProgramInfo>([
                ['test_prog', { symbol: my_symbol, range: my_range }],
            ]);

            const my_result = find_containing_program(my_position, my_programs);

            expect(my_result).not.toBeNull();
            expect(my_result?.name).toBe('test_prog');
        });

        it('should return the smallest program when multiple programs contain position', () => {
            const my_position: Position = { line: 5, character: 0 };

            // Outer program: lines 0-20
            const my_outer_range: Range = {
                start: { line: 0, character: 0 },
                end: { line: 20, character: 0 },
            };
            const my_outer_symbol = create_program_symbol('outer_prog', my_outer_range);

            // Inner program: lines 3-10 (smaller, should be selected)
            const my_inner_range: Range = {
                start: { line: 3, character: 0 },
                end: { line: 10, character: 0 },
            };
            const my_inner_symbol = create_program_symbol('inner_prog', my_inner_range);

            const my_programs = new Map<string, ProgramInfo>([
                ['outer_prog', { symbol: my_outer_symbol, range: my_outer_range }],
                ['inner_prog', { symbol: my_inner_symbol, range: my_inner_range }],
            ]);

            const my_result = find_containing_program(my_position, my_programs);

            expect(my_result).not.toBeNull();
            expect(my_result?.name).toBe('inner_prog');
        });

        it('should handle position on program boundary (last line)', () => {
            const my_position: Position = { line: 10, character: 0 };
            const my_range: Range = {
                start: { line: 0, character: 0 },
                end: { line: 10, character: 5 },
            };
            const my_symbol = create_program_symbol('boundary_prog', my_range);
            const my_programs = new Map<string, ProgramInfo>([
                ['boundary_prog', { symbol: my_symbol, range: my_range }],
            ]);

            const my_result = find_containing_program(my_position, my_programs);

            expect(my_result).not.toBeNull();
            expect(my_result?.name).toBe('boundary_prog');
        });

        it('should handle position on program start line', () => {
            const my_position: Position = { line: 5, character: 10 };
            const my_range: Range = {
                start: { line: 5, character: 0 },
                end: { line: 15, character: 0 },
            };
            const my_symbol = create_program_symbol('start_line_prog', my_range);
            const my_programs = new Map<string, ProgramInfo>([
                ['start_line_prog', { symbol: my_symbol, range: my_range }],
            ]);

            const my_result = find_containing_program(my_position, my_programs);

            expect(my_result).not.toBeNull();
            expect(my_result?.name).toBe('start_line_prog');
        });
    });
});


describe('Local Macro Nesting', () => {
    let symbol_provider: SymbolProvider;

    beforeEach(() => {
        symbol_provider = new SymbolProvider();
    });

    it('should set program selectionRange to identifier-only when header is parseable', () => {
        const my_content = 'program define test\nend';
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['test', create_program_entry('test', 0, 1)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        expect(my_symbols.length).toBe(1);
        expect(my_symbols[0].name).toBe('test');

        const my_expected_start = 'program define '.length;
        expect(my_symbols[0].selectionRange.start).toEqual({
            line: 0,
            character: my_expected_start,
        });
        expect(my_symbols[0].selectionRange.end).toEqual({
            line: 0,
            character: my_expected_start + 'test'.length,
        });
    });

    /**
     * Helper to create a program symbol entry for the symbol table.
     */
    function create_program_entry(
        name: string,
        start_line: number,
        end_line: number,
        uri: string = 'file:///test.do'
    ) {
        return {
            name,
            sourceUri: uri,
            location: {
                uri,
                range: {
                    start: { line: start_line, character: 0 },
                    end: { line: end_line, character: 3 },
                },
            },
        };
    }

    /**
     * Helper to create a local macro entry for the symbol table.
     */
    function create_local_macro_entry(
        name: string,
        line: number,
        uri: string = 'file:///test.do'
    ) {
        return {
            name,
            sourceUri: uri,
            scope: 'local' as const,
            value: 'test_value',
            location: {
                uri,
                range: {
                    start: { line, character: 0 },
                    end: { line, character: 15 },
                },
            },
        };
    }

    it('should nest local macro inside program as child', () => {
        // Program spans lines 0-5, local macro on line 2
        const my_content = 'program test\nlocal x = 1\nend';
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['test', create_program_entry('test', 0, 5)],
            ]),
            localMacros: new Map([
                ['x', create_local_macro_entry('x', 2)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        // Should have 1 top-level symbol (the program)
        expect(my_symbols.length).toBe(1);
        expect(my_symbols[0].name).toBe('test');
        expect(my_symbols[0].kind).toBe(SymbolKind.Function);

        // Program should have the local macro as a child
        expect(my_symbols[0].children).toBeDefined();
        expect(my_symbols[0].children?.length).toBe(1);
        expect(my_symbols[0].children?.[0].name).toBe('`x\'');
        expect(my_symbols[0].children?.[0].detail).toBe('Local Macro');
    });

    it('should place local macro outside program at top level', () => {
        // Program spans lines 5-10, local macro on line 0 (before program)
        const my_content = 'local x = 1\nprogram test\nend';
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['test', create_program_entry('test', 5, 10)],
            ]),
            localMacros: new Map([
                ['x', create_local_macro_entry('x', 0)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        // Should have 2 top-level symbols: program and local macro
        expect(my_symbols.length).toBe(2);

        const my_program = my_symbols.find(s => s.name === 'test');
        const my_local = my_symbols.find(s => s.name === '`x\'');

        expect(my_program).toBeDefined();
        expect(my_local).toBeDefined();

        // Program should have no children
        expect(my_program?.children?.length ?? 0).toBe(0);

        // Local should be at top level with correct detail
        expect(my_local?.detail).toBe('Local Macro');
    });

    it('should nest local on last line of program (boundary case)', () => {
        // Program spans lines 0-5, local macro on line 5 (last line)
        const my_content = 'program test\nlocal x = 1\nend';
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['test', create_program_entry('test', 0, 5)],
            ]),
            localMacros: new Map([
                ['x', create_local_macro_entry('x', 5)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        // Should have 1 top-level symbol (the program)
        expect(my_symbols.length).toBe(1);
        expect(my_symbols[0].name).toBe('test');

        // Local on last line should still be nested
        expect(my_symbols[0].children?.length).toBe(1);
        expect(my_symbols[0].children?.[0].name).toBe('`x\'');
    });

    it('should place all locals at top level when no programs exist', () => {
        const my_content = 'local x = 1\nlocal y = 2';
        const my_doc = create_test_document(my_content, {
            programs: new Map(),
            localMacros: new Map([
                ['x', create_local_macro_entry('x', 0)],
                ['y', create_local_macro_entry('y', 1)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        // Should have 2 top-level symbols (both locals)
        expect(my_symbols.length).toBe(2);
        expect(my_symbols.every(s => s.detail === 'Local Macro')).toBe(true);

        const my_names = my_symbols.map(s => s.name);
        expect(my_names).toContain('`x\'');
        expect(my_names).toContain('`y\'');
    });

    it('should handle multiple programs with locals in each', () => {
        // Program A spans lines 0-5, Program B spans lines 10-15
        // Local x in program A (line 2), local y in program B (line 12)
        const my_content = 'program A\nlocal x = 1\nend\nprogram B\nlocal y = 2\nend';
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['A', create_program_entry('A', 0, 5)],
                ['B', create_program_entry('B', 10, 15)],
            ]),
            localMacros: new Map([
                ['x', create_local_macro_entry('x', 2)],
                ['y', create_local_macro_entry('y', 12)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        // Should have 2 top-level symbols (both programs)
        expect(my_symbols.length).toBe(2);

        const my_program_a = my_symbols.find(s => s.name === 'A');
        const my_program_b = my_symbols.find(s => s.name === 'B');

        expect(my_program_a?.children?.length).toBe(1);
        expect(my_program_a?.children?.[0].name).toBe('`x\'');

        expect(my_program_b?.children?.length).toBe(1);
        expect(my_program_b?.children?.[0].name).toBe('`y\'');
    });

    it('should handle mixed locals inside and outside programs', () => {
        // Program spans lines 5-10
        // Local x on line 0 (outside), local y on line 7 (inside)
        const my_content = 'local x = 1\nprogram test\nlocal y = 2\nend';
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['test', create_program_entry('test', 5, 10)],
            ]),
            localMacros: new Map([
                ['x', create_local_macro_entry('x', 0)],
                ['y', create_local_macro_entry('y', 7)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        // Should have 2 top-level symbols: program and local x
        expect(my_symbols.length).toBe(2);

        const my_program = my_symbols.find(s => s.name === 'test');
        const my_top_level_local = my_symbols.find(s => s.name === '`x\'');

        expect(my_program).toBeDefined();
        expect(my_top_level_local).toBeDefined();

        // Program should have local y as child
        expect(my_program?.children?.length).toBe(1);
        expect(my_program?.children?.[0].name).toBe('`y\'');
    });

    it('should assign local to smallest containing program when nested', () => {
        // Outer program spans lines 0-20, inner program spans lines 5-15
        // Local on line 10 should be assigned to inner program
        const my_content = 'program outer\nprogram inner\nlocal x = 1\nend\nend';
        const my_doc = create_test_document(my_content, {
            programs: new Map([
                ['outer', create_program_entry('outer', 0, 20)],
                ['inner', create_program_entry('inner', 5, 15)],
            ]),
            localMacros: new Map([
                ['x', create_local_macro_entry('x', 10)],
            ]),
        });

        const my_symbols = symbol_provider.get_document_symbols(my_doc);

        // Should have 2 top-level symbols (both programs)
        expect(my_symbols.length).toBe(2);

        const my_outer = my_symbols.find(s => s.name === 'outer');
        const my_inner = my_symbols.find(s => s.name === 'inner');

        // Outer should have no direct children (local is in inner)
        expect(my_outer?.children?.length ?? 0).toBe(0);

        // Inner should have the local as child
        expect(my_inner?.children?.length).toBe(1);
        expect(my_inner?.children?.[0].name).toBe('`x\'');
    });
});


describe('Workspace Index Symbol Types', () => {
    let symbol_provider: SymbolProvider;

    beforeEach(() => {
        symbol_provider = new SymbolProvider();
    });

    describe('Variables from Workspace Index', () => {
        it('should include variables from workspace_symbols in results', () => {
            const the_source = build_source([
                {
                    name: 'myvar',
                    kind: 'variable',
                    uri: 'file:///workspace/data.do',
                    range: {
                        start: { line: 5, character: 0 },
                        end: { line: 5, character: 10 },
                    },
                },
            ]);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'myvar',
                [],
                the_source
            );

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('myvar');
            expect(my_symbols[0].kind).toBe(SymbolKind.Field);
            expect(my_symbols[0].containerName).toBe('Variable');
            expect(my_symbols[0].location.uri).toBe('file:///workspace/data.do');
        });
    });

    describe('Scalars from Workspace Index', () => {
        it('should include scalars from workspace_symbols in results', () => {
            const the_source = build_source([
                {
                    name: 'my_scalar',
                    kind: 'scalar',
                    uri: 'file:///workspace/analysis.do',
                    range: {
                        start: { line: 10, character: 0 },
                        end: { line: 10, character: 20 },
                    },
                },
            ]);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'scalar',
                [],
                the_source
            );

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('my_scalar');
            expect(my_symbols[0].kind).toBe(SymbolKind.Variable);
            expect(my_symbols[0].containerName).toBe('Scalar');
            expect(my_symbols[0].location.uri).toBe('file:///workspace/analysis.do');
        });
    });

    describe('Matrices from Workspace Index', () => {
        it('should include matrices from workspace_symbols in results', () => {
            const the_source = build_source([
                {
                    name: 'coef_matrix',
                    kind: 'matrix',
                    uri: 'file:///workspace/regression.do',
                    range: {
                        start: { line: 15, character: 0 },
                        end: { line: 15, character: 25 },
                    },
                },
            ]);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'matrix',
                [],
                the_source
            );

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('coef_matrix');
            expect(my_symbols[0].kind).toBe(SymbolKind.Variable);
            expect(my_symbols[0].containerName).toBe('Matrix');
            expect(my_symbols[0].location.uri).toBe('file:///workspace/regression.do');
        });
    });

    describe('Local Macros from Workspace Index', () => {
        it('should include local macros from workspace_symbols in results', () => {
            const the_source = build_source([
                {
                    name: 'varlist',
                    kind: 'local_macro',
                    uri: 'file:///workspace/utils.do',
                    range: {
                        start: { line: 3, character: 0 },
                        end: { line: 3, character: 18 },
                    },
                },
            ]);

            const my_symbols = symbol_provider.get_workspace_symbols(
                'varlist',
                [],
                the_source
            );

            expect(my_symbols.length).toBe(1);
            expect(my_symbols[0].name).toBe('`varlist\'');
            expect(my_symbols[0].kind).toBe(SymbolKind.Variable);
            expect(my_symbols[0].containerName).toBe('Local Macro');
            expect(my_symbols[0].location.uri).toBe('file:///workspace/utils.do');
        });
    });
});

describe('Workspace Symbol Search — multi-definition', () => {
    let symbol_provider: SymbolProvider;

    beforeEach(() => {
        symbol_provider = new SymbolProvider();
    });

    it('returns one SymbolInformation per file when a variable is defined in many files', () => {
        const the_source = build_source([
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/nsfg/a.do',
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } },
            },
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/dhs/b.do',
                range: { start: { line: 2, character: 0 }, end: { line: 2, character: 8 } },
            },
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/mics/c.do',
                range: { start: { line: 3, character: 0 }, end: { line: 3, character: 8 } },
            },
        ]);

        const my_symbols = symbol_provider.get_workspace_symbols('cm_birth', [], the_source);

        const the_uris = my_symbols.map(s => s.location.uri).sort();
        expect(the_uris).toEqual([
            'file:///ws/dhs/b.do',
            'file:///ws/mics/c.do',
            'file:///ws/nsfg/a.do',
        ]);
        for (const sym of my_symbols) {
            expect(sym.name).toBe('cm_birth');
            expect(sym.containerName).toBe('Variable');
            expect(sym.kind).toBe(SymbolKind.Field);
        }
    });

    it('suppresses source entries for URIs that are open documents, and overlays fresh symbols', () => {
        const the_open_uri = 'file:///ws/open.do';
        const the_source = build_source([
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: the_open_uri,
                range: { start: { line: 99, character: 0 }, end: { line: 99, character: 8 } },
            },
            {
                name: 'cm_birth',
                kind: 'variable',
                uri: 'file:///ws/dhs/b.do',
                range: { start: { line: 2, character: 0 }, end: { line: 2, character: 8 } },
            },
        ]);

        const the_fresh_document: any = {
            uri: the_open_uri,
            ast: null,
            symbols: {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    [
                        'cm_birth',
                        {
                            name: 'cm_birth',
                            sourceUri: the_open_uri,
                            location: {
                                uri: the_open_uri,
                                range: {
                                    start: { line: 5, character: 0 },
                                    end: { line: 5, character: 8 },
                                },
                            },
                        },
                    ],
                ]),
                scalars: new Map(),
                matrices: new Map(),
            },
        };

        const my_symbols = symbol_provider.get_workspace_symbols(
            'cm_birth',
            [the_fresh_document],
            the_source
        );

        const the_open_entries = my_symbols.filter(s => s.location.uri === the_open_uri);
        expect(the_open_entries.length).toBe(1);
        expect(the_open_entries[0].location.range.start.line).toBe(5);

        const the_other_entries = my_symbols.filter(s => s.location.uri !== the_open_uri);
        expect(the_other_entries.length).toBe(1);
        expect(the_other_entries[0].location.uri).toBe('file:///ws/dhs/b.do');
    });

    it('overlays open-document programs, globals, scalars, and matrices (not just locals and variables)', () => {
        const the_open_uri = 'file:///ws/open.do';
        const the_source = build_source([]);

        const the_fresh_document: any = {
            uri: the_open_uri,
            ast: null,
            symbols: {
                programs: new Map([
                    ['my_prog', { name: 'my_prog', sourceUri: the_open_uri, location: { uri: the_open_uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } } } }],
                ]),
                localMacros: new Map(),
                globalMacros: new Map([
                    ['my_glob', { name: 'my_glob', sourceUri: the_open_uri, scope: 'global', value: '', location: { uri: the_open_uri, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 7 } } } }],
                ]),
                variables: new Map(),
                scalars: new Map([
                    ['my_scalar', { name: 'my_scalar', sourceUri: the_open_uri, location: { uri: the_open_uri, range: { start: { line: 3, character: 0 }, end: { line: 3, character: 9 } } } }],
                ]),
                matrices: new Map([
                    ['my_mat', { name: 'my_mat', sourceUri: the_open_uri, location: { uri: the_open_uri, range: { start: { line: 4, character: 0 }, end: { line: 4, character: 6 } } } }],
                ]),
            },
        };

        const the_queries = ['my_prog', 'my_glob', 'my_scalar', 'my_mat'];
        for (const q of the_queries) {
            const my_symbols = symbol_provider.get_workspace_symbols(q, [the_fresh_document], the_source);
            expect(my_symbols.some(s => s.location.uri === the_open_uri)).toBe(true);
        }
    });
});

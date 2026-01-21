/**
 * Unit tests for the Context-Aware Definition Provider
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { init_tracker_from_source } from '../test-context-helper';
import { Position } from 'vscode-languageserver';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentState } from '../../src/document-store';
import { SymbolTable, MacroSymbol } from '../../src/types';
import { ContextTracker } from '../../src/context-tracker';
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
    return {
        uri: uri || `file://${process.cwd()}/test.do`,
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
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
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
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
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
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
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
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
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
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
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
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 15 } // Position on "helper"
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
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 } // Position on "script.do"
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('script.do');
        });

        it('should return null when neither exact path nor .do fallback exists', async () => {
            const my_content = 'do "nonexistent"';
            const my_doc = create_test_document(my_content, undefined, `file://${path.join(temp_dir, 'test.do')}`);
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 } // Position on "nonexistent"
            );

            expect(my_definition).toBeNull();
        });
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

/**
 * Backward Compatibility Regression Tests for Definition Provider
 * 
 * Tests that the variable-macro-definition-disambiguation feature maintains
 * backward compatibility for existing functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { init_tracker_from_source } from '../test-context-helper';
import { Position } from 'vscode-languageserver';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentState } from '../../src/document-store';
import { SymbolTable, ProgramSymbol, ScalarSymbol, MatrixSymbol, LanguageContext } from '../../src/types';
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
            scalars: symbols?.scalars || new Map(),
            matrices: symbols?.matrices || new Map(),
        },
        diagnostics: [],
    };
}

describe('Definition Provider - Backward Compatibility', () => {
    let definition_provider: DefinitionProvider;
    let context_tracker: ContextTracker;
    let temp_dir: string;

    beforeEach(() => {
        definition_provider = new DefinitionProvider();
        context_tracker = new ContextTracker();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(temp_dir)) {
            fs.rmSync(temp_dir, { recursive: true, force: true });
        }
    });

    describe('Program Definition Resolution (Req 6.1)', () => {
        it('should resolve program names correctly via WORD tokens', async () => {
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
                        } as ProgramSymbol,
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

        it('should resolve program names from workspace symbols', async () => {
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
                        } as ProgramSymbol,
                    ],
                ]),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
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

    describe('Scalar Definition Resolution (Req 6.2)', () => {
        it('should resolve scalar names correctly via WORD tokens', async () => {
            const my_content = 'scalar my_scalar = 5\ndisplay my_scalar';
            const my_doc = create_test_document(my_content, {
                scalars: new Map([
                    [
                        'my_scalar',
                        {
                            name: 'my_scalar',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 16 },
                                },
                            },
                        } as ScalarSymbol,
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 10 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
            expect(my_definition?.range.start.line).toBe(0);
        });

        it('should resolve scalar names from workspace symbols', async () => {
            const my_content = 'display my_scalar';
            const my_doc = create_test_document(my_content);
            const my_workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map([
                    [
                        'my_scalar',
                        {
                            name: 'my_scalar',
                            sourceUri: 'file:///other.do',
                            location: {
                                uri: 'file:///other.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 9 },
                                },
                            },
                        } as ScalarSymbol,
                    ],
                ]),
                matrices: new Map(),
            };
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 10 },
                my_workspace_symbols,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///other.do');
        });
    });

    describe('Matrix Definition Resolution (Req 6.3)', () => {
        it('should resolve matrix names correctly via WORD tokens', async () => {
            const my_content = 'matrix my_matrix = (1,2)\ndisplay my_matrix';
            const my_doc = create_test_document(my_content, {
                matrices: new Map([
                    [
                        'my_matrix',
                        {
                            name: 'my_matrix',
                            sourceUri: 'file:///test.do',
                            location: {
                                uri: 'file:///test.do',
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 16 },
                                },
                            },
                        } as MatrixSymbol,
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 10 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
            expect(my_definition?.range.start.line).toBe(0);
        });

        it('should resolve matrix names from workspace symbols', async () => {
            const my_content = 'display my_matrix';
            const my_doc = create_test_document(my_content);
            const my_workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map([
                    [
                        'my_matrix',
                        {
                            name: 'my_matrix',
                            sourceUri: 'file:///other.do',
                            location: {
                                uri: 'file:///other.do',
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 9 },
                                },
                            },
                        } as MatrixSymbol,
                    ],
                ]),
            };
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 10 },
                my_workspace_symbols,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///other.do');
        });
    });

    describe('File Path Navigation (Req 6.4)', () => {
        it('should navigate to do command file paths correctly', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');
            
            const my_content = 'do "helper"';
            const my_doc = create_test_document(
                my_content, 
                undefined, 
                `file://${path.join(temp_dir, 'test.do')}`
            );
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 }
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });

        it('should navigate to run command file paths correctly', async () => {
            const script_path = path.join(temp_dir, 'script.do');
            fs.writeFileSync(script_path, '// Script file');
            
            const my_content = 'run "script"';
            const my_doc = create_test_document(
                my_content, 
                undefined, 
                `file://${path.join(temp_dir, 'test.do')}`
            );
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 8 }
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('script');
        });

        it('should navigate to include command file paths correctly', async () => {
            const helper_path = path.join(temp_dir, 'helper.do');
            fs.writeFileSync(helper_path, '// Helper file');
            
            const my_content = 'include helper';
            const my_doc = create_test_document(
                my_content, 
                undefined, 
                `file://${path.join(temp_dir, 'test.do')}`
            );
            
            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 0, character: 10 }
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toContain('helper');
        });
    });

    describe('Embedded Context Behavior (Req 6.5)', () => {
        it('should resolve only macros in Mata context, not programs', async () => {
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
                        } as ProgramSymbol,
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 12 },
                undefined,
                context_tracker
            );

            expect(my_definition).not.toBeNull();
            expect(my_definition?.uri).toBe('file:///test.do');
        });

        it('should resolve only macros in Python context, not programs', async () => {
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
                        } as ProgramSymbol,
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
        });

        it('should not resolve programs in Mata context', async () => {
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
                        } as ProgramSymbol,
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 2 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });

        it('should not resolve programs in Python context', async () => {
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
                        } as ProgramSymbol,
                    ],
                ]),
            });
            init_tracker_from_source(context_tracker, my_content);

            const my_definition = await definition_provider.get_definition(
                my_doc,
                { line: 1, character: 2 },
                undefined,
                context_tracker
            );

            expect(my_definition).toBeNull();
        });
    });
});
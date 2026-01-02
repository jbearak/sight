import { describe, it, expect, beforeEach } from 'vitest';
import { HoverProvider } from '../../../src/providers/hover';
import { CommandDatabase } from '../../../src/command-database';
import { SymbolTable, ProgramSymbol, ProgramSignature, LocalMacro, GlobalMacro, ResolvedScope } from '../../../src/types';
import { DocumentState } from '../../../src/document-store';
import { Position } from 'vscode-languageserver';

describe('HoverProvider Helper Methods', () => {
    let hover_provider: HoverProvider;

    beforeEach(() => {
        const command_db = new CommandDatabase();
        hover_provider = new HoverProvider(command_db);
    });

    describe('get_display_path', () => {
        it('should convert file:// URI to filesystem path', () => {
            const uri = 'file:///Users/test/project/file.do';
            const result = (hover_provider as any).get_display_path(uri);
            expect(result).toBe('/Users/test/project/file.do');
        });

        it('should handle URI without file:// prefix', () => {
            const uri = '/Users/test/project/file.do';
            const result = (hover_provider as any).get_display_path(uri);
            expect(result).toBe('/Users/test/project/file.do');
        });

        it('should return relative path when file is within workspace root', () => {
            const uri = 'file:///Users/test/project/src/analysis.do';
            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_display_path(uri, workspace_root);
            expect(result).toBe('src/analysis.do');
        });

        it('should handle workspace root without file:// prefix', () => {
            const uri = 'file:///Users/test/project/src/analysis.do';
            const workspace_root = '/Users/test/project';
            const result = (hover_provider as any).get_display_path(uri, workspace_root);
            expect(result).toBe('src/analysis.do');
        });

        it('should return full path when file is outside workspace', () => {
            const uri = 'file:///Users/test/other/file.do';
            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_display_path(uri, workspace_root);
            expect(result).toBe('/Users/test/other/file.do');
        });

        it('should return full path when workspace_root is undefined', () => {
            const uri = 'file:///Users/test/project/file.do';
            const result = (hover_provider as any).get_display_path(uri);
            expect(result).toBe('/Users/test/project/file.do');
        });

        it('should handle relative path with leading slash correctly', () => {
            const uri = 'file:///Users/test/project/src/analysis.do';
            const workspace_root = 'file:///Users/test/project/';
            const result = (hover_provider as any).get_display_path(uri, workspace_root);
            expect(result).toBe('src/analysis.do');
        });

        it('should handle nested subdirectories', () => {
            const uri = 'file:///Users/test/project/src/data/clean.do';
            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_display_path(uri, workspace_root);
            expect(result).toBe('src/data/clean.do');
        });
    });

    describe('format_source_link', () => {
        it('should return empty string when sourceUri equals currentUri', () => {
            const source_uri = 'file:///Users/test/project/main.do';
            const current_uri = 'file:///Users/test/project/main.do';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri);
            expect(result).toBe('');
        });

        it('should return markdown link for cross-file symbols', () => {
            const source_uri = 'file:///Users/test/project/utils.do';
            const current_uri = 'file:///Users/test/project/main.do';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri);
            expect(result).toBe('[/Users/test/project/utils.do](file:///Users/test/project/utils.do)');
        });

        it('should use get_display_path for link text with workspace root', () => {
            const source_uri = 'file:///Users/test/project/src/utils.do';
            const current_uri = 'file:///Users/test/project/main.do';
            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri, workspace_root);
            expect(result).toBe('[src/utils.do](file:///Users/test/project/src/utils.do)');
        });

        it('should handle files outside workspace', () => {
            const source_uri = 'file:///Users/test/other/external.do';
            const current_uri = 'file:///Users/test/project/main.do';
            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri, workspace_root);
            expect(result).toBe('[/Users/test/other/external.do](file:///Users/test/other/external.do)');
        });

        it('should work without workspace root', () => {
            const source_uri = 'file:///Users/test/project/utils.do';
            const current_uri = 'file:///Users/test/project/main.do';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri);
            expect(result).toBe('[/Users/test/project/utils.do](file:///Users/test/project/utils.do)');
        });

        it('should handle identical URIs with different formats', () => {
            // After normalization, these should be recognized as the same file
            const source_uri = 'file:///Users/test/project/main.do';
            const current_uri = '/Users/test/project/main.do';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri);
            expect(result).toBe('');
        });

        it('should handle nested directory structures', () => {
            const source_uri = 'file:///Users/test/project/src/data/clean.do';
            const current_uri = 'file:///Users/test/project/main.do';
            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri, workspace_root);
            expect(result).toBe('[src/data/clean.do](file:///Users/test/project/src/data/clean.do)');
        });

        it('should escape markdown special characters in link display text', () => {
            const source_uri = 'file:///Users/test/project/dir[1]/file(2).do';
            const current_uri = 'file:///Users/test/project/main.do';
            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri, workspace_root);
            // Display text is workspace-relative and must escape [],()
            expect(result).toBe('[dir\\[1\\]/file\\(2\\).do](file:///Users/test/project/dir[1]/file(2).do)');
        });

        it('should return plain text for non-file URIs', () => {
            const source_uri = 'https://example.com/some/path.do';
            const current_uri = 'file:///Users/test/project/main.do';
            const result = (hover_provider as any).format_source_link(source_uri, current_uri);
            expect(result).toBe('`https://example.com/some/path.do`');
        });
    });

    describe('get_macro_hover', () => {
        let document: DocumentState;
        let position: Position;

        beforeEach(() => {
            document = {
                uri: 'file:///Users/test/project/main.do',
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            } as DocumentState;
            position = { line: 0, character: 0 };
        });

        it('should show clickable link for local macro from another file', () => {
            const local_macro: LocalMacro = {
                name: 'test_local',
                sourceUri: 'file:///Users/test/project/utils.do',
                value: 'test_value',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                preorderIndex: 0,
                definition_line: 5,
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map([['test_local', local_macro]]),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_macro_hover(
                document,
                position,
                'test_local',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Local Macro:** `test_local`');
            expect(result.value).toContain('Source: [utils.do](file:///Users/test/project/utils.do), line');
            expect(result.value).toContain('Expansion: ```\ntest_value\n```');
        });

        it('should show clickable link for global macro from another file', () => {
            const global_macro: GlobalMacro = {
                name: 'test_global',
                sourceUri: 'file:///Users/test/project/config.do',
                value: 'global_value',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                preorderIndex: 0,
                definition_line: 3,
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map([['test_global', global_macro]]),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_macro_hover(
                document,
                position,
                'test_global',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Global Macro:** `test_global`');
            expect(result.value).toContain('Source: [config.do](file:///Users/test/project/config.do), line');
            expect(result.value).toContain('Expansion: ```\nglobal_value\n```');
        });

        it('should not show redundant link for macro from current file', () => {
            const local_macro: LocalMacro = {
                name: 'test_local',
                sourceUri: 'file:///Users/test/project/main.do', // Same as document.uri
                value: 'test_value',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                preorderIndex: 0,
                definition_line: 2,
            };

            document.symbols.localMacros.set('test_local', local_macro);

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_macro_hover(
                document,
                position,
                'test_local',
                undefined,
                undefined,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Local Macro:** `test_local`');
            expect(result.value).not.toContain('Source: [');
            expect(result.value).toContain('Defined at: this file, line');
            expect(result.value).toContain('Expansion: ```\ntest_value\n```');
        });
    });

    describe('get_scalar_matrix_hover', () => {
        let document: DocumentState;
        let position: Position;

        beforeEach(() => {
            document = {
                uri: 'file:///Users/test/project/main.do',
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            } as DocumentState;
            position = { line: 0, character: 0 };
        });

        it('should show clickable link for scalar from another file', () => {
            const scalar_symbol = {
                name: 'test_scalar',
                sourceUri: 'file:///Users/test/project/utils.do',
                definition_line: 5,
                location: {
                    uri: 'file:///Users/test/project/utils.do',
                    range: { start: { line: 5, character: 0 }, end: { line: 5, character: 12 } }
                }
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map([['test_scalar', scalar_symbol]]),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_scalar_matrix_hover(
                document,
                'test_scalar',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Scalar:** `test_scalar`');
            expect(result.value).toContain('Source: [utils.do](file:///Users/test/project/utils.do), line 6');
            expect(result.value).not.toContain('Defined at:');
        });

        it('should show clickable link for matrix from another file', () => {
            const matrix_symbol = {
                name: 'test_matrix',
                sourceUri: 'file:///Users/test/project/analysis.do',
                definition_line: 10,
                location: {
                    uri: 'file:///Users/test/project/analysis.do',
                    range: { start: { line: 10, character: 0 }, end: { line: 10, character: 11 } }
                }
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map([['test_matrix', matrix_symbol]]),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_scalar_matrix_hover(
                document,
                'test_matrix',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Matrix:** `test_matrix`');
            expect(result.value).toContain('Source: [analysis.do](file:///Users/test/project/analysis.do), line 11');
            expect(result.value).not.toContain('Defined at:');
        });

        it('should not show redundant link for scalar from current file', () => {
            const scalar_symbol = {
                name: 'local_scalar',
                sourceUri: 'file:///Users/test/project/main.do', // Same as document.uri
                definition_line: 3,
                location: {
                    uri: 'file:///Users/test/project/main.do',
                    range: { start: { line: 3, character: 0 }, end: { line: 3, character: 12 } }
                }
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map([['local_scalar', scalar_symbol]]),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_scalar_matrix_hover(
                document,
                'local_scalar',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Scalar:** `local_scalar`');
            expect(result.value).toContain('Defined at: this file, line 4');
            expect(result.value).not.toContain('Source: [');
        });

        it('should not show redundant link for matrix from current file', () => {
            const matrix_symbol = {
                name: 'local_matrix',
                sourceUri: 'file:///Users/test/project/main.do', // Same as document.uri
                definition_line: 7,
                location: {
                    uri: 'file:///Users/test/project/main.do',
                    range: { start: { line: 7, character: 0 }, end: { line: 7, character: 12 } }
                }
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map([['local_matrix', matrix_symbol]]),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_scalar_matrix_hover(
                document,
                'local_matrix',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Matrix:** `local_matrix`');
            expect(result.value).toContain('Defined at: this file, line 8');
            expect(result.value).not.toContain('Source: [');
        });

        it('should handle scalar without definition_line', () => {
            const scalar_symbol = {
                name: 'no_line_scalar',
                sourceUri: 'file:///Users/test/project/main.do',
                location: {
                    uri: 'file:///Users/test/project/main.do',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }
                }
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map([['no_line_scalar', scalar_symbol]]),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_scalar_matrix_hover(
                document,
                'no_line_scalar',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Scalar:** `no_line_scalar`');
            expect(result.value).toContain('Defined at: this file');
            expect(result.value).not.toContain(', line');
        });

        it('should handle matrix without definition_line', () => {
            const matrix_symbol = {
                name: 'no_line_matrix',
                sourceUri: 'file:///Users/test/project/main.do',
                location: {
                    uri: 'file:///Users/test/project/main.do',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }
                }
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map([['no_line_matrix', matrix_symbol]]),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const workspace_root = 'file:///Users/test/project';
            const result = (hover_provider as any).get_scalar_matrix_hover(
                document,
                'no_line_matrix',
                undefined,
                resolved_scope,
                workspace_root
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Matrix:** `no_line_matrix`');
            expect(result.value).toContain('Defined at: this file');
            expect(result.value).not.toContain(', line');
        });
    });

    describe('get_hover_for_user_program', () => {
        let workspace_symbols: SymbolTable;
        let program_symbol: ProgramSymbol;

        beforeEach(() => {
            program_symbol = {
                name: 'my_program',
                sourceUri: 'file:///Users/test/project/utils.do',
                location: {
                    range: {
                        start: { line: 10, character: 0 },
                        end: { line: 15, character: 3 }
                    }
                }
            };

            workspace_symbols = {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map([['my_program', program_symbol]]),
                scalars: new Map(),
                matrices: new Map(),
                variables: new Map()
            };
        });

        it('should show clickable link for program from another file', () => {
            const current_uri = 'file:///Users/test/project/main.do';
            const workspace_root = 'file:///Users/test/project';

            const result = (hover_provider as any).get_hover_for_user_program(
                'my_program',
                workspace_symbols,
                current_uri,
                workspace_root
            );

            expect(result).toEqual({
                kind: 'markdown',
                value: '**Program:** `my_program`\n\n**Source:** [utils.do](file:///Users/test/project/utils.do)'
            });
        });

        it('should show no redundant link for program from current file', () => {
            const current_uri = 'file:///Users/test/project/utils.do';
            const workspace_root = 'file:///Users/test/project';

            const result = (hover_provider as any).get_hover_for_user_program(
                'my_program',
                workspace_symbols,
                current_uri,
                workspace_root
            );

            expect(result).toEqual({
                kind: 'markdown',
                value: '**Program:** `my_program`\n\n**Defined at:** `file:///Users/test/project/utils.do`'
            });
        });

        it('should work without workspace root', () => {
            const current_uri = 'file:///Users/test/project/main.do';

            const result = (hover_provider as any).get_hover_for_user_program(
                'my_program',
                workspace_symbols,
                current_uri
            );

            expect(result).toEqual({
                kind: 'markdown',
                value: '**Program:** `my_program`\n\n**Source:** [/Users/test/project/utils.do](file:///Users/test/project/utils.do)'
            });
        });

        it('should include signature when available', () => {
            const signature: ProgramSignature = {
                arguments: [
                    { name: 'varlist', type: 'varlist', isOptional: false }
                ],
                options: [
                    { name: 'replace', isOptional: true, minAbbreviation: 'r' }
                ],
                allowsArbitraryOptions: false
            };

            program_symbol.signature = signature;

            const current_uri = 'file:///Users/test/project/main.do';
            const workspace_root = 'file:///Users/test/project';

            const result = (hover_provider as any).get_hover_for_user_program(
                'my_program',
                workspace_symbols,
                current_uri,
                workspace_root
            );

            expect(result?.value).toContain('**Program:** `my_program`');
            expect(result?.value).toContain('**Syntax:**');
            expect(result?.value).toContain('**Source:** [utils.do](file:///Users/test/project/utils.do)');
        });

        it('should return null for non-existent program', () => {
            const current_uri = 'file:///Users/test/project/main.do';
            const workspace_root = 'file:///Users/test/project';

            const result = (hover_provider as any).get_hover_for_user_program(
                'non_existent',
                workspace_symbols,
                current_uri,
                workspace_root
            );

            expect(result).toBeNull();
        });

        it('should fallback to plain text when format_source_link returns empty', () => {
            const current_uri = 'file:///Users/test/project/utils.do'; // Same as program source
            const workspace_root = 'file:///Users/test/project';

            const result = (hover_provider as any).get_hover_for_user_program(
                'my_program',
                workspace_symbols,
                current_uri,
                workspace_root
            );

            expect(result?.value).toContain('**Defined at:** `file:///Users/test/project/utils.do`');
            expect(result?.value).not.toContain('[');
        });
    });

    describe('escape_markdown_link_text', () => {
        it('should escape backslashes', () => {
            const result = (hover_provider as any).escape_markdown_link_text('path\\to\\file.do');
            expect(result).toBe('path\\\\to\\\\file.do');
        });

        it('should escape square brackets', () => {
            const result = (hover_provider as any).escape_markdown_link_text('file[1].do');
            expect(result).toBe('file\\[1\\].do');
        });

        it('should escape parentheses', () => {
            const result = (hover_provider as any).escape_markdown_link_text('file(copy).do');
            expect(result).toBe('file\\(copy\\).do');
        });

        it('should escape all special characters together', () => {
            const result = (hover_provider as any).escape_markdown_link_text('path\\[test](copy).do');
            expect(result).toBe('path\\\\\\[test\\]\\(copy\\).do');
        });

        it('should leave normal paths unchanged', () => {
            const result = (hover_provider as any).escape_markdown_link_text('src/utils.do');
            expect(result).toBe('src/utils.do');
        });
    });

    describe('looks_like_uri_scheme', () => {
        it('should detect file:// URIs', () => {
            expect((hover_provider as any).looks_like_uri_scheme('file:///path/to/file')).toBe(true);
        });

        it('should detect http:// URIs', () => {
            expect((hover_provider as any).looks_like_uri_scheme('http://example.com')).toBe(true);
        });

        it('should detect https:// URIs', () => {
            expect((hover_provider as any).looks_like_uri_scheme('https://example.com')).toBe(true);
        });

        it('should detect custom scheme URIs', () => {
            expect((hover_provider as any).looks_like_uri_scheme('vscode://extension/id')).toBe(true);
            expect((hover_provider as any).looks_like_uri_scheme('git+ssh://host/repo')).toBe(true);
        });

        it('should not detect filesystem paths as URIs', () => {
            expect((hover_provider as any).looks_like_uri_scheme('/Users/test/file.do')).toBe(false);
            expect((hover_provider as any).looks_like_uri_scheme('./relative/path.do')).toBe(false);
            expect((hover_provider as any).looks_like_uri_scheme('relative/path.do')).toBe(false);
        });

        it('should not detect Windows drive paths as URIs', () => {
            expect((hover_provider as any).looks_like_uri_scheme('C:\\Users\\test\\file.do')).toBe(false);
            expect((hover_provider as any).looks_like_uri_scheme('C:/Users/test/file.do')).toBe(false);
            expect((hover_provider as any).looks_like_uri_scheme('D:\\project\\main.do')).toBe(false);
        });
    });

    describe('normalize_file_path with non-file URIs', () => {
        it('should return null for http:// URIs', () => {
            const result = (hover_provider as any).normalize_file_path('http://example.com/file.do');
            expect(result).toBeNull();
        });

        it('should return null for https:// URIs', () => {
            const result = (hover_provider as any).normalize_file_path('https://example.com/file.do');
            expect(result).toBeNull();
        });

        it('should return null for custom scheme URIs', () => {
            const result = (hover_provider as any).normalize_file_path('vscode://extension/id');
            expect(result).toBeNull();
        });

        it('should still handle file:// URIs', () => {
            const result = (hover_provider as any).normalize_file_path('file:///Users/test/file.do');
            expect(result).toBe('/Users/test/file.do');
        });

        it('should still handle filesystem paths', () => {
            const result = (hover_provider as any).normalize_file_path('/Users/test/file.do');
            expect(result).toBe('/Users/test/file.do');
        });

        it('should return non-null for Windows drive paths', () => {
            const result = (hover_provider as any).normalize_file_path('C:\\Users\\test\\project\\file.do');
            expect(result).not.toBeNull();
        });

        it('should return non-null for Windows drive paths with forward slashes', () => {
            const result = (hover_provider as any).normalize_file_path('C:/Users/test/project/file.do');
            expect(result).not.toBeNull();
        });
    });

    describe('format_source_link with non-file URIs', () => {
        it('should return plain text for http:// URIs', () => {
            const result = (hover_provider as any).format_source_link(
                'http://example.com/file.do',
                'file:///Users/test/main.do'
            );
            expect(result).toBe('`http://example.com/file.do`');
        });

        it('should return plain text for https:// URIs', () => {
            const result = (hover_provider as any).format_source_link(
                'https://example.com/file.do',
                'file:///Users/test/main.do'
            );
            expect(result).toBe('`https://example.com/file.do`');
        });

        it('should return plain text for custom scheme URIs', () => {
            const result = (hover_provider as any).format_source_link(
                'vscode://extension/id',
                'file:///Users/test/main.do'
            );
            expect(result).toBe('`vscode://extension/id`');
        });

        it('should still produce clickable links for file:// URIs', () => {
            const result = (hover_provider as any).format_source_link(
                'file:///Users/test/utils.do',
                'file:///Users/test/main.do'
            );
            expect(result).toBe('[/Users/test/utils.do](file:///Users/test/utils.do)');
        });

        it('should escape markdown in display text for file URIs', () => {
            const result = (hover_provider as any).format_source_link(
                'file:///Users/test/file[1](copy).do',
                'file:///Users/test/main.do'
            );
            expect(result).toContain('[/Users/test/file\\[1\\]\\(copy\\).do]');
        });

        it('should return markdown link for Windows drive paths', () => {
            const result = (hover_provider as any).format_source_link(
                'C:\\Users\\test\\project\\utils.do',
                'C:\\Users\\test\\project\\main.do'
            );
            expect(result).toMatch(/^\[.*\]\(file:\/\/\/.*\)$/);
        });

        it('should return empty string for same Windows file', () => {
            const result = (hover_provider as any).format_source_link(
                'C:\\Users\\test\\project\\main.do',
                'C:\\Users\\test\\project\\main.do'
            );
            expect(result).toBe('');
        });
    });

    describe('scalar/matrix hover with workspace_symbols fallback', () => {
        // Regression test: when resolved_scope exists but has no directives (global mode),
        // scalar/matrix hover should still fall back to workspace_symbols
        let document: DocumentState;

        beforeEach(() => {
            document = {
                uri: 'file:///Users/test/project/main.do',
                content: 'display my_scalar',
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            } as DocumentState;
        });

        it('should find scalar from workspace_symbols when resolved_scope has empty symbols', () => {
            const workspace_symbols: SymbolTable = {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map(),
                scalars: new Map([['my_scalar', {
                    name: 'my_scalar',
                    sourceUri: 'file:///Users/test/project/other.do',
                    definition_line: 5,
                }]]),
                matrices: new Map(),
                variables: new Map(),
            };

            // Simulate resolved_scope with empty symbols (no directives case)
            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const result = (hover_provider as any).get_scalar_hover(
                document,
                'my_scalar',
                workspace_symbols,
                resolved_scope,
                'file:///Users/test/project'
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Scalar:** `my_scalar`');
            expect(result.value).toContain('Source: [other.do](file:///Users/test/project/other.do)');
        });

        it('should find matrix from workspace_symbols when resolved_scope has empty symbols', () => {
            const workspace_symbols: SymbolTable = {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map(),
                scalars: new Map(),
                matrices: new Map([['my_matrix', {
                    name: 'my_matrix',
                    sourceUri: 'file:///Users/test/project/other.do',
                    definition_line: 10,
                }]]),
                variables: new Map(),
            };

            // Simulate resolved_scope with empty symbols (no directives case)
            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const result = (hover_provider as any).get_matrix_hover(
                document,
                'my_matrix',
                workspace_symbols,
                resolved_scope,
                'file:///Users/test/project'
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('**Matrix:** `my_matrix`');
            expect(result.value).toContain('Source: [other.do](file:///Users/test/project/other.do)');
        });

        it('should prefer resolved_scope scalar over workspace_symbols', () => {
            const workspace_symbols: SymbolTable = {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map(),
                scalars: new Map([['my_scalar', {
                    name: 'my_scalar',
                    sourceUri: 'file:///Users/test/project/workspace.do',
                    definition_line: 1,
                }]]),
                matrices: new Map(),
                variables: new Map(),
            };

            const resolved_scope: ResolvedScope = {
                symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map([['my_scalar', {
                        name: 'my_scalar',
                        sourceUri: 'file:///Users/test/project/resolved.do',
                        definition_line: 99,
                    }]]),
                    matrices: new Map(),
                    variables: new Map(),
                },
                diagnostics: [],
                out_of_scope_symbols: {
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    programs: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                    variables: new Map(),
                },
            };

            const result = (hover_provider as any).get_scalar_hover(
                document,
                'my_scalar',
                workspace_symbols,
                resolved_scope,
                'file:///Users/test/project'
            );

            expect(result).toBeTruthy();
            expect(result.value).toContain('resolved.do');
            expect(result.value).not.toContain('workspace.do');
        });
    });
});

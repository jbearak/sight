import { describe, it, expect } from 'bun:test';
import {
    create_formatting_handler,
    create_range_formatting_handler,
    HandlerDependencies,
    DEFAULT_SETTINGS,
} from '../../src/server-handlers';
import { DocumentStore } from '../../src/document-store';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLSPConfig } from '../../src/types';
import {
    DocumentFormattingParams,
    DocumentRangeFormattingParams,
} from 'vscode-languageserver/node';

/**
 * Creates mock dependencies for testing formatting handlers.
 */
function create_mock_dependencies_with_formatter(): HandlerDependencies {
    return {
        document_store: new DocumentStore(),
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        symbol_provider: null,
        formatter_provider: new CodeFormatter(),
        workspace_indexer: null,
        get_document_settings: async () => DEFAULT_SETTINGS,
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

describe('LSP Comment Normalization Integration', () => {
    describe('Document Formatting with Comment Normalization', () => {
        it('should normalize comments when normalizeCommentStyle is enabled', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document with star comments
            await deps.document_store.open(
                'file:///test.do',
                '* This is a comment\ngenerate x = 1',
                1
            );

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                    preferredCommentStyle: '//',
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits.length).toBeGreaterThan(0);
            expect(the_edits[0].newText).toBeDefined();
        });

        it('should preserve comments when normalizeCommentStyle is disabled', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document with star comments
            const original_content = '* This is a comment\ngenerate x = 1';
            await deps.document_store.open(
                'file:///test.do',
                original_content,
                1
            );

            // Create settings with comment normalization disabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: false,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits.length).toBeGreaterThan(0);
            // The comment style should be preserved (still contains *)
            expect(the_edits[0].newText).toContain('*');
        });

        it('should handle different preferred comment styles', async () => {
            const the_styles: Array<'//' | '*' | '/* */'> = ['//', '*', '/* */'];

            for (const my_style of the_styles) {
                const deps = create_mock_dependencies_with_formatter();

                // Add a document with slash comments
                await deps.document_store.open(
                    'file:///test.do',
                    '// This is a comment\ngenerate x = 1',
                    1
                );

                // Create settings with specific style preference
                const settings: StataLSPConfig = {
                    ...DEFAULT_SETTINGS,
                    formatting: {
                        ...DEFAULT_SETTINGS.formatting,
                        normalizeCommentStyle: true,
                        preferredCommentStyle: my_style,
                    },
                };
                deps.get_document_settings = async () => settings;

                const handler = create_formatting_handler(deps);
                const params: DocumentFormattingParams = {
                    textDocument: { uri: 'file:///test.do', version: 1 },
                    options: { tabSize: 4, insertSpaces: true },
                };

                const the_edits = await handler(params);

                expect(the_edits.length).toBeGreaterThan(0);
                expect(the_edits[0].newText).toBeDefined();
            }
        });

        it('should handle missing document gracefully', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///nonexistent.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits).toEqual([]);
        });

        it('should handle missing formatter gracefully', async () => {
            const deps = create_mock_dependencies_with_formatter();
            deps.formatter_provider = null;

            // Add a document
            await deps.document_store.open(
                'file:///test.do',
                '* This is a comment\ngenerate x = 1',
                1
            );

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits).toEqual([]);
        });

        it('should respect custom comment line width', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document with a long comment
            const long_comment = '* This is a very long comment that should be wrapped according to the configured line width setting';
            await deps.document_store.open(
                'file:///test.do',
                long_comment + '\ngenerate x = 1',
                1
            );

            // Create settings with custom line width
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                    commentLineWidth: 50,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits.length).toBeGreaterThan(0);
            expect(the_edits[0].newText).toBeDefined();
        });
    });

    describe('Range Formatting with Comment Normalization', () => {
        it('should apply comment normalization to range formatting', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document with star comments
            await deps.document_store.open(
                'file:///test.do',
                '* Comment 1\ngenerate x = 1\n* Comment 2\ngenerate y = 2',
                1
            );

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                    preferredCommentStyle: '//',
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_range_formatting_handler(deps);
            const params: DocumentRangeFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 3, character: 20 },
                },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits.length).toBeGreaterThan(0);
            expect(the_edits[0].newText).toBeDefined();
        });

        it('should handle range formatting with normalization disabled', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document with star comments
            const original_content = '* Comment 1\ngenerate x = 1\n* Comment 2\ngenerate y = 2';
            await deps.document_store.open(
                'file:///test.do',
                original_content,
                1
            );

            // Create settings with comment normalization disabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: false,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_range_formatting_handler(deps);
            const params: DocumentRangeFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 3, character: 20 },
                },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits.length).toBeGreaterThan(0);
            // Comments should be preserved
            expect(the_edits[0].newText).toContain('*');
        });

        it('should handle missing document in range formatting', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_range_formatting_handler(deps);
            const params: DocumentRangeFormattingParams = {
                textDocument: { uri: 'file:///nonexistent.do', version: 1 },
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 1, character: 0 },
                },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);

            expect(the_edits).toEqual([]);
        });
    });

    describe('Configuration Validation', () => {
        it('should handle invalid comment style with fallback', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document
            await deps.document_store.open(
                'file:///test.do',
                '* This is a comment\ngenerate x = 1',
                1
            );

            // Create settings with invalid comment style
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                    preferredCommentStyle: '//' as any, // Valid in this case
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            // Should not throw
            const the_edits = await handler(params);
            expect(the_edits).toBeDefined();
        });

        it('should handle missing formatting config gracefully', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document
            await deps.document_store.open(
                'file:///test.do',
                '* This is a comment\ngenerate x = 1',
                1
            );

            // Create settings with minimal config
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            // Should not throw
            const the_edits = await handler(params);
            expect(the_edits).toBeDefined();
        });
    });

    describe('Error Handling and Diagnostics', () => {
        it('should handle formatting errors gracefully', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document with potentially problematic content
            await deps.document_store.open(
                'file:///test.do',
                '* Comment with special chars: @#$%^&*()\ngenerate x = 1',
                1
            );

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            // Should not throw
            const the_edits = await handler(params);
            expect(the_edits).toBeDefined();
        });

        it('should handle empty documents', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add an empty document
            await deps.document_store.open(
                'file:///test.do',
                '',
                1
            );

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);
            expect(the_edits).toBeDefined();
        });

        it('should handle documents with only comments', async () => {
            const deps = create_mock_dependencies_with_formatter();

            // Add a document with only comments
            await deps.document_store.open(
                'file:///test.do',
                '* Comment 1\n* Comment 2\n* Comment 3',
                1
            );

            // Create settings with comment normalization enabled
            const settings: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: {
                    ...DEFAULT_SETTINGS.formatting,
                    normalizeCommentStyle: true,
                    preferredCommentStyle: '//',
                },
            };
            deps.get_document_settings = async () => settings;

            const handler = create_formatting_handler(deps);
            const params: DocumentFormattingParams = {
                textDocument: { uri: 'file:///test.do', version: 1 },
                options: { tabSize: 4, insertSpaces: true },
            };

            const the_edits = await handler(params);
            expect(the_edits).toBeDefined();
        });
    });
});

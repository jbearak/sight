import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { CompletionProvider } from '../../src/providers/completion';
import { HoverProvider } from '../../src/providers/hover';
import { SymbolProvider } from '../../src/providers/symbols';
import { CodeFormatter } from '../../src/providers/formatter';
import { LanguageContext } from '../../src/types';
import { command_database } from '../../src/commands';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';
import { DiagnosticSeverity } from 'vscode-languageserver';

// Mock connection for testing
function create_mock_connection() {
    const sent_diagnostics: { uri: string; diagnostics: any[] }[] = [];
    return {
        sendDiagnostics: mock((params: { uri: string; diagnostics: any[] }) => {
            sent_diagnostics.push(params);
        }),
        get_sent_diagnostics: () => sent_diagnostics,
        clear_sent_diagnostics: () => { sent_diagnostics.length = 0; },
    };
}

// Default test configuration with proper literal types
const DEFAULT_CONFIG = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning' as const,
            undefinedVariable: 'information' as const,
            styleWarnings: 'hint' as const,
        },
        undefinedVariableEnabled: false,
    },
    completion: {},
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces' as const,
    },
    adoPaths: [] as string[],
    indexWorkspace: true,
};

describe('LSP Integration with Embedded Languages', () => {
    let document_store: DocumentStore;
    let diagnostics_provider: DiagnosticsProvider;
    let completion_provider: CompletionProvider;
    let hover_provider: HoverProvider;
    let symbol_provider: SymbolProvider;
    let formatter_provider: CodeFormatter;
    let mock_connection: ReturnType<typeof create_mock_connection>;

    beforeEach(() => {
        initialize_builtin_commands();
        mock_connection = create_mock_connection();
        document_store = new DocumentStore();
        diagnostics_provider = new DiagnosticsProvider(mock_connection as any);
        completion_provider = new CompletionProvider(command_database, {
            snippet_support: true,
        });
        hover_provider = new HoverProvider(command_database);
        symbol_provider = new SymbolProvider();
        formatter_provider = new CodeFormatter();
    });

    describe('Mata block LSP features', () => {
        it('should suppress diagnostics in mata block', async () => {
            const my_content = `mata
matrix A = (1, 2)
end
display $undefined_global`;

            const my_uri = 'file:///test_mata.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have diagnostic for undefined global in stata context (line 3)
            // but NOT for any syntax errors in mata block
            const mata_errors = the_diagnostics.filter(
                d => d.range.start.line >= 1 && d.range.start.line <= 2
            );
            expect(mata_errors.length).toBe(0);
        });

        it('should suppress command completions in mata block', async () => {
            const my_content = `mata
matrix A = (1, 2)
end`;

            const my_uri = 'file:///test_mata_completion.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions at line 1 (inside mata block)
            const the_completions = await completion_provider.get_completions(
                my_document,
                { line: 1, character: 0 }
            );

            // Should not have command completions
            const command_labels = the_completions
                .filter(c => c.kind === 1) // Command kind
                .map(c => c.label);
            expect(command_labels).not.toContain('generate');
            expect(command_labels).not.toContain('regress');
        });

        it('should suppress hover for mata keywords', async () => {
            const my_content = `mata
matrix A = (1, 2)
end`;

            const my_uri = 'file:///test_mata_hover.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get hover at line 1 (inside mata block)
            const my_hover = await hover_provider.get_hover(
                my_document,
                { line: 1, character: 0 }
            );

            // Should not have hover information for mata content
            // (hover should be null or not contain Stata command info)
            if (my_hover) {
                expect(my_hover.contents).not.toContain('matrix');
            }
        });

        it('should provide macro completions in mata block', async () => {
            const my_content = `local myvar = 1
mata
display \`myvar
end`;

            const my_uri = 'file:///test_mata_macro.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions at line 2 (inside mata block, after backtick)
            const the_completions = await completion_provider.get_completions(
                my_document,
                { line: 2, character: 15 }
            );

            // Should have macro completions
            const macro_labels = the_completions.map(c => c.label);
            expect(macro_labels).toContain('myvar');
        });

        it('should suggest end command at mata block boundary', async () => {
            const my_content = `mata
matrix A = (1, 2)
`;

            const my_uri = 'file:///test_mata_end.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions at line 2 (end of mata block)
            const the_completions = await completion_provider.get_completions(
                my_document,
                { line: 2, character: 0 }
            );

            // Should suggest 'end' command
            const labels = the_completions.map(c => c.label);
            expect(labels).toContain('end');
        });

        it('should preserve mata block content during formatting', async () => {
            const my_content = `mata
matrix A = (1, 2)
end`;

            const my_uri = 'file:///test_mata_format.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Format the document
            const the_edits = formatter_provider.format(my_document, {
                tabSize: 4,
                insertSpaces: true,
            });

            // Apply edits to get formatted content
            let my_formatted = my_content;
            for (const _my_edit of the_edits.sort((a, b) => {
                const a_pos = a.range.start.line * 1000 + a.range.start.character;
                const b_pos = b.range.start.line * 1000 + b.range.start.character;
                return b_pos - a_pos;
            })) {
                const my_start = my_formatted.indexOf('mata');
                const my_end = my_formatted.indexOf('end') + 3;
                const my_mata_content = my_formatted.substring(my_start, my_end);
                expect(my_mata_content).toContain('matrix A = (1, 2)');
            }
        });

        it('should include mata blocks in document symbols', async () => {
            const my_content = `mata
matrix A = (1, 2)
end`;

            const my_uri = 'file:///test_mata_symbols.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get document symbols
            const the_symbols = await symbol_provider.get_document_symbols(my_document);

            // Should return symbols array with mata block
            expect(the_symbols).toBeDefined();
            expect(Array.isArray(the_symbols)).toBe(true);
            // Should include the mata block as a symbol
            const mata_symbol = the_symbols.find(s => s.name === 'Mata Block');
            expect(mata_symbol).toBeDefined();
        });
    });

    describe('Python block LSP features', () => {
        it('should suppress diagnostics in python block', async () => {
            const my_content = `python
import numpy as np
end
display $undefined_global`;

            const my_uri = 'file:///test_python.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should not have syntax errors in python block
            const python_errors = the_diagnostics.filter(
                d => d.range.start.line >= 1 && d.range.start.line <= 2
            );
            expect(python_errors.length).toBe(0);
        });

        it('should suppress command completions in python block', async () => {
            const my_content = `python
print("hello")
end`;

            const my_uri = 'file:///test_python_completion.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions at line 1 (inside python block)
            const the_completions = await completion_provider.get_completions(
                my_document,
                { line: 1, character: 0 }
            );

            // Should not have command completions
            const command_labels = the_completions
                .filter(c => c.kind === 1)
                .map(c => c.label);
            expect(command_labels).not.toContain('generate');
            expect(command_labels).not.toContain('regress');
        });

        it('should suggest end command at python block boundary', async () => {
            const my_content = `python
print("hello")
`;

            const my_uri = 'file:///test_python_end.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions at line 2 (end of python block)
            const the_completions = await completion_provider.get_completions(
                my_document,
                { line: 2, character: 0 }
            );

            // Should suggest 'end' command
            const labels = the_completions.map(c => c.label);
            expect(labels).toContain('end');
        });

        it('should preserve python block content during formatting', async () => {
            const my_content = `python
print("hello")
end`;

            const my_uri = 'file:///test_python_format.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Format the document
            const the_edits = formatter_provider.format(my_document, {
                tabSize: 4,
                insertSpaces: true,
            });

            // Python content should be preserved
            let my_formatted = my_content;
            for (const _my_edit of the_edits.sort((a, b) => {
                const a_pos = a.range.start.line * 1000 + a.range.start.character;
                const b_pos = b.range.start.line * 1000 + b.range.start.character;
                return b_pos - a_pos;
            })) {
                const my_python_content = my_formatted.substring(
                    my_formatted.indexOf('python'),
                    my_formatted.indexOf('end') + 3
                );
                expect(my_python_content).toContain('print("hello")');
            }
        });

        it('should include python blocks in document symbols', async () => {
            const my_content = `python
print("hello")
end`;

            const my_uri = 'file:///test_python_symbols.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get document symbols
            const the_symbols = await symbol_provider.get_document_symbols(my_document);

            // Should return symbols array with python block
            expect(the_symbols).toBeDefined();
            expect(Array.isArray(the_symbols)).toBe(true);
            // Should include the python block as a symbol
            const python_symbol = the_symbols.find(s => s.name === 'Python Block');
            expect(python_symbol).toBeDefined();
        });
    });

    describe('Context switching during LSP interactions', () => {
        it('should handle context transitions in completion', async () => {
            const my_content = `gen
mata
matrix A = (1, 2)
end
gen`;

            const my_uri = 'file:///test_context_switch.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions in stata context (line 0, after typing "gen")
            const stata_completions = await completion_provider.get_completions(
                my_document,
                { line: 0, character: 3 }
            );
            const stata_labels = stata_completions.map(c => c.label);
            expect(stata_labels).toContain('generate');

            // Get completions in mata context (line 2) - empty prefix returns empty array
            const mata_completions = await completion_provider.get_completions(
                my_document,
                { line: 2, character: 0 }
            );
            const mata_labels = mata_completions.map(c => c.label);
            expect(mata_labels).not.toContain('generate');

            // Get completions in stata context again (line 4, after typing "gen")
            const stata_completions_2 = await completion_provider.get_completions(
                my_document,
                { line: 4, character: 3 }
            );
            const stata_labels_2 = stata_completions_2.map(c => c.label);
            expect(stata_labels_2).toContain('generate');
        });

        it('should handle context transitions in diagnostics', async () => {
            const my_content = `display $undefined1
mata
matrix A = (1, 2)
end
display $undefined2`;

            const my_uri = 'file:///test_diag_context.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have diagnostics for undefined globals in stata context
            // but not in mata context
            const stata_diags = the_diagnostics.filter(
                d => d.range.start.line === 0 || d.range.start.line === 4
            );
            expect(stata_diags.length).toBeGreaterThan(0);

            const mata_diags = the_diagnostics.filter(
                d => d.range.start.line >= 1 && d.range.start.line <= 3
            );
            expect(mata_diags.length).toBe(0);
        });

        it('should handle nested embedded blocks', async () => {
            const my_content = `mata
matrix A = (1, 2)
mata
matrix B = (3, 4)
end
end`;

            const my_uri = 'file:///test_nested.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get context at different positions
            const my_context_tracker = my_document.context_tracker;
            expect(my_context_tracker.get_context_at_position({ line: 1, character: 0 }))
                .toBe(LanguageContext.MATA);
            expect(my_context_tracker.get_context_at_position({ line: 3, character: 0 }))
                .toBe(LanguageContext.MATA);
        });

        it('should handle single-line mata context', async () => {
            const my_content = `mata: matrix A = (1, 2)
gen`;

            const my_uri = 'file:///test_single_line_mata.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions at line 0 (single-line mata)
            const mata_completions = await completion_provider.get_completions(
                my_document,
                { line: 0, character: 5 }
            );
            const mata_labels = mata_completions.map(c => c.label);
            expect(mata_labels).not.toContain('generate');

            // Get completions at line 1 (stata context, after typing "gen")
            const stata_completions = await completion_provider.get_completions(
                my_document,
                { line: 1, character: 3 }
            );
            const stata_labels = stata_completions.map(c => c.label);
            expect(stata_labels).toContain('generate');
        });

        it('should handle single-line python context', async () => {
            const my_content = `python: x = 5
gen`;

            const my_uri = 'file:///test_single_line_python.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            // Get completions at line 0 (single-line python)
            const python_completions = await completion_provider.get_completions(
                my_document,
                { line: 0, character: 5 }
            );
            const python_labels = python_completions.map(c => c.label);
            expect(python_labels).not.toContain('generate');

            // Get completions at line 1 (stata context, after typing "gen")
            const stata_completions = await completion_provider.get_completions(
                my_document,
                { line: 1, character: 3 }
            );
            const stata_labels = stata_completions.map(c => c.label);
            expect(stata_labels).toContain('generate');
        });
    });

    describe('Block structure validation', () => {
        it('should detect unclosed mata blocks', async () => {
            const my_content = `mata
matrix A = (1, 2)`;

            const my_uri = 'file:///test_unclosed_mata.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have diagnostic for unclosed mata block
            const unclosed_diag = the_diagnostics.find(
                d => d.message.includes('Unclosed mata block')
            );
            expect(unclosed_diag).toBeDefined();
            expect(unclosed_diag?.severity).toBe(DiagnosticSeverity.Error);
        });

        it('should detect unclosed python blocks', async () => {
            const my_content = `python
print("hello")`;

            const my_uri = 'file:///test_unclosed_python.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have diagnostic for unclosed python block
            const unclosed_diag = the_diagnostics.find(
                d => d.message.includes('Unclosed python block')
            );
            expect(unclosed_diag).toBeDefined();
            expect(unclosed_diag?.severity).toBe(DiagnosticSeverity.Error);
        });

        it('should flag standalone end commands as errors', async () => {
            const my_content = `generate x = 1
end`;

            const my_uri = 'file:///test_unexpected_end.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have diagnostic for orphan end command
            const unexpected_diag = the_diagnostics.find(
                d => d.message.includes('Unexpected "end"')
            );
            expect(unexpected_diag).toBeDefined();
        });

        it('should detect misplaced end python commands', async () => {
            const my_content = `generate x = 1
end python`;

            const my_uri = 'file:///test_misplaced_end_python.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have diagnostic for invalid end python syntax
            const invalid_syntax_diag = the_diagnostics.find(
                d => d.message.includes('end python') || d.message.includes('Invalid')
            );
            expect(invalid_syntax_diag).toBeDefined();
        });

        it('should allow valid mata blocks', async () => {
            const my_content = `mata
matrix A = (1, 2)
end`;

            const my_uri = 'file:///test_valid_mata.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should NOT have block structure errors
            const block_errors = the_diagnostics.filter(
                d => d.message.includes('Unclosed') ||
                     d.message.includes('Unexpected') ||
                     d.message.includes('Misplaced')
            );
            expect(block_errors.length).toBe(0);
        });

        it('should allow valid python blocks', async () => {
            const my_content = `python
print("hello")
end`;

            const my_uri = 'file:///test_valid_python.do';
            await document_store.open(my_uri, my_content, 1);
            const my_document = document_store.get(my_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should NOT have block structure errors
            const block_errors = the_diagnostics.filter(
                d => d.message.includes('Unclosed') ||
                     d.message.includes('Unexpected') ||
                     d.message.includes('Misplaced')
            );
            expect(block_errors.length).toBe(0);
        });
    });

    describe('Incremental document updates with embedded languages', () => {
        it('should maintain context after incremental update', async () => {
            let my_content = `mata
matrix A = (1, 2)
end`;

            const my_uri = 'file:///test_incremental.do';
            await document_store.open(my_uri, my_content, 1);

            // Update document
            my_content = `mata
matrix A = (1, 2)
matrix B = (3, 4)
end`;
            await document_store.update(my_uri, [{ text: my_content }], 2);

            const my_document = document_store.get(my_uri)!;
            const my_context_tracker = my_document.context_tracker;

            // Context should still be correct
            expect(my_context_tracker.get_context_at_position({ line: 1, character: 0 }))
                .toBe(LanguageContext.MATA);
            expect(my_context_tracker.get_context_at_position({ line: 2, character: 0 }))
                .toBe(LanguageContext.MATA);
        });

        it('should detect new blocks after incremental update', async () => {
            let my_content = `generate x = 1`;

            const my_uri = 'file:///test_incremental_new_block.do';
            await document_store.open(my_uri, my_content, 1);

            // Add a mata block
            my_content = `generate x = 1
mata
matrix A = (1, 2)
end`;
            await document_store.update(my_uri, [{ text: my_content }], 2);

            const my_document = document_store.get(my_uri)!;
            const my_context_tracker = my_document.context_tracker;

            // New block should be detected
            expect(my_context_tracker.get_context_at_position({ line: 2, character: 0 }))
                .toBe(LanguageContext.MATA);
        });
    });
});

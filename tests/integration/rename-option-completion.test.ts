/**
 * Integration test for rename command option completions.
 * Validates that hardcoded options for the rename command appear in completions.
 * 
 * Feature: rename-command-options
 * Validates: Requirements 1.1, 1.2
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Position } from 'vscode-languageserver';
import { CompletionProvider, detect_completion_context } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { DocumentState } from '../../src/document-store';
import { SymbolTable } from '../../src/types';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(content: string): DocumentState {
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        ast: null,
        symbols: {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        } as SymbolTable,
        diagnostics: [],
        tokens: [],
        context_ranges: [],
        line_offsets: [],
    };
}

describe('Rename Command Option Completions', () => {
    let command_db: CommandDatabase;
    let completion_provider: CompletionProvider;

    beforeEach(() => {
        command_db = new CommandDatabase();
        command_db.register_all(BUILTIN_COMMANDS);
        completion_provider = new CompletionProvider(command_db);
    });

    describe('Option Context Detection', () => {
        it('should detect option context after "rename *,"', () => {
            const content = 'rename *, ';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const context = detect_completion_context(document, position);
            
            expect(context.type).toBe('option');
            if (context.type === 'option') {
                expect(context.command).toBe('rename');
            }
        });
    });

    describe('Option Completions', () => {
        it('should include upper and lower options for rename command (Req 1.2)', async () => {
            const content = 'rename *, ';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const completions = await completion_provider.get_completions(document, position);
            const labels = completions.map(c => c.label);
            
            expect(labels).toContain('upper');
            expect(labels).toContain('lower');
        });

        it('should include all 7 rename options (Req 1.1)', async () => {
            const content = 'rename *, ';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const completions = await completion_provider.get_completions(document, position);
            const labels = completions.map(c => c.label);
            
            // All 7 options should be present
            expect(labels).toContain('addnumber');
            expect(labels).toContain('renumber');
            expect(labels).toContain('sort');
            expect(labels).toContain('dryrun');
            expect(labels).toContain('upper');
            expect(labels).toContain('lower');
            expect(labels).toContain('proper');
        });

        it('should include parentheses for addnumber option (Req 1.3)', async () => {
            const content = 'rename *, ';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const completions = await completion_provider.get_completions(document, position);
            const addnumber_completion = completions.find(c => c.label === 'addnumber');
            
            expect(addnumber_completion).toBeDefined();
            expect(addnumber_completion?.insertText).toBe('addnumber()');
        });

        it('should include parentheses for renumber option (Req 1.4)', async () => {
            const content = 'rename *, ';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const completions = await completion_provider.get_completions(document, position);
            const renumber_completion = completions.find(c => c.label === 'renumber');
            
            expect(renumber_completion).toBeDefined();
            expect(renumber_completion?.insertText).toBe('renumber()');
        });

        it('should NOT include parentheses for non-argument options (Req 1.5)', async () => {
            const content = 'rename *, ';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const completions = await completion_provider.get_completions(document, position);
            
            const non_arg_options = ['sort', 'dryrun', 'upper', 'lower', 'proper'];
            for (const opt_name of non_arg_options) {
                const completion = completions.find(c => c.label === opt_name);
                expect(completion).toBeDefined();
                // Non-argument options should insert just the name, not name()
                expect(completion?.insertText).toBe(opt_name);
            }
        });

        it('should filter options by prefix', async () => {
            const content = 'rename *, up';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const completions = await completion_provider.get_completions(document, position);
            const labels = completions.map(c => c.label);
            
            // Should include 'upper' which starts with 'up'
            expect(labels).toContain('upper');
            // Should not include options that don't start with 'up'
            expect(labels).not.toContain('lower');
            expect(labels).not.toContain('sort');
        });

        it('should filter options by prefix with wildcard varlist (rename *,l)', async () => {
            // Regression test: when typing "rename *,l", the AST incorrectly parses "l"
            // as a separate command. The completion provider should use text-based
            // command extraction to correctly identify "rename" as the command.
            const content = 'rename *,l';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const context = detect_completion_context(document, position);
            expect(context.type).toBe('option');
            if (context.type === 'option') {
                expect(context.command).toBe('rename');
            }
            
            const completions = await completion_provider.get_completions(document, position);
            const labels = completions.map(c => c.label);
            
            // Should include 'lower' which starts with 'l'
            expect(labels).toContain('lower');
            // Should not include options that don't start with 'l'
            expect(labels).not.toContain('upper');
            expect(labels).not.toContain('sort');
        });

        it('should filter options by prefix with wildcard and space (rename *, l)', async () => {
            const content = 'rename *, l';
            const position = Position.create(0, content.length);
            const document = create_test_document(content);
            
            const context = detect_completion_context(document, position);
            expect(context.type).toBe('option');
            if (context.type === 'option') {
                expect(context.command).toBe('rename');
            }
            
            const completions = await completion_provider.get_completions(document, position);
            const labels = completions.map(c => c.label);
            
            // Should include 'lower' which starts with 'l'
            expect(labels).toContain('lower');
        });
    });
});

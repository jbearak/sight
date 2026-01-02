/**
 * Unit tests for frame subcommand completion and hover
 * Tests spec requirements for frame prefix command handling
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Position } from 'vscode-languageserver';
import { 
    CompletionProvider, 
    detect_completion_context,
} from '../../src/providers/completion';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { DocumentState } from '../../src/document-store';
import { SymbolTable } from '../../src/types';

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
            scalars: symbols?.scalars || new Map(),
            matrices: symbols?.matrices || new Map(),
        },
        diagnostics: [],
    };
}

/**
 * Helper to create a test command database with frame command.
 */
function create_test_command_db(): CommandDatabase {
    const db = new CommandDatabase();
    db.register({
        name: 'frame',
        minAbbreviation: 'frame',
        syntax: 'frame subcommand [arguments]',
        options: [],
        subcommands: [
            { name: 'create', minAbbreviation: 'create' },
            { name: 'change', minAbbreviation: 'change' },
            { name: 'drop', minAbbreviation: 'drop' },
            { name: 'copy', minAbbreviation: 'copy' },
            { name: 'rename', minAbbreviation: 'rename' },
            { name: 'put', minAbbreviation: 'put' },
            { name: 'post', minAbbreviation: 'post' },
            { name: 'dir', minAbbreviation: 'dir' },
            { name: 'reset', minAbbreviation: 'reset' },
            { name: 'list', minAbbreviation: 'list' },
            { name: 'prefix', minAbbreviation: 'prefix' },
        ],
        category: 'prefix',
        isBuiltin: true,
    });
    // Add mi command with subcommands
    db.register({
        name: 'mi',
        minAbbreviation: 'mi',
        syntax: 'mi subcommand [arguments]',
        options: [],
        subcommands: [
            { name: 'set', minAbbreviation: 'set' },
            { name: 'describe', minAbbreviation: 'd' },
            { name: 'estimate', minAbbreviation: 'est' },
            { name: 'impute', minAbbreviation: 'imp' },
        ],
        category: 'prefix',
        isBuiltin: true,
    });
    // Add a standalone 'create' command to test disambiguation
    db.register({
        name: 'create',
        minAbbreviation: 'create',
        syntax: 'create varname',
        options: [],
        category: 'data',
        isBuiltin: true,
    });
    return db;
}

describe('Frame Subcommand Completion', () => {
    let completion_provider: CompletionProvider;
    let command_db: CommandDatabase;

    beforeEach(() => {
        command_db = create_test_command_db();
        completion_provider = new CompletionProvider(command_db);
    });

    describe('Context Detection', () => {
        it('should detect subcommand context after "frame "', () => {
            const doc = create_test_document('frame ');
            const context = detect_completion_context(doc, { line: 0, character: 6 }, undefined, command_db);
            expect(context.type).toBe('subcommand');
            if (context.type === 'subcommand') {
                expect(context.prefix_command).toBe('frame');
            }
        });

        it('should detect subcommand context while typing subcommand', () => {
            const doc = create_test_document('frame cr');
            const context = detect_completion_context(doc, { line: 0, character: 8 }, undefined, command_db);
            expect(context.type).toBe('subcommand');
            if (context.type === 'subcommand') {
                expect(context.prefix_command).toBe('frame');
            }
        });

        it('should detect subcommand context after "quietly frame "', () => {
            const doc = create_test_document('quietly frame ');
            const context = detect_completion_context(doc, { line: 0, character: 14 }, undefined, command_db);
            expect(context.type).toBe('subcommand');
            if (context.type === 'subcommand') {
                expect(context.prefix_command).toBe('frame');
            }
        });

        it('should NOT detect subcommand context after "frame create " (past subcommand)', () => {
            const doc = create_test_document('frame create ');
            const context = detect_completion_context(doc, { line: 0, character: 13 }, undefined, command_db);
            expect(context.type).not.toBe('subcommand');
        });
    });

    describe('Completion Results', () => {
        it('should suggest frame subcommands after "frame "', async () => {
            const doc = create_test_document('frame ');
            const completions = await completion_provider.get_completions(
                doc,
                { line: 0, character: 6 }
            );
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('create');
            expect(labels).toContain('change');
            expect(labels).toContain('drop');
            expect(labels).toContain('copy');
            expect(labels).toContain('rename');
        });

        it('should filter subcommands by prefix', async () => {
            const doc = create_test_document('frame cr');
            const completions = await completion_provider.get_completions(
                doc,
                { line: 0, character: 8 }
            );
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('create');
            expect(labels).not.toContain('drop');
            expect(labels).not.toContain('change');
        });

        it('should suggest subcommands after "quietly frame "', async () => {
            const doc = create_test_document('quietly frame ');
            const completions = await completion_provider.get_completions(
                doc,
                { line: 0, character: 14 }
            );
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('create');
            expect(labels).toContain('change');
        });
    });
});

describe('Frame Subcommand Hover', () => {
    let hover_provider: HoverProvider;
    let command_db: CommandDatabase;

    beforeEach(() => {
        command_db = create_test_command_db();
        hover_provider = new HoverProvider(command_db);
    });

    describe('Subcommand Hover', () => {
        it('should show frame-subcommand hover for "create" in "frame create"', async () => {
            const doc = create_test_document('frame create myframe');
            // Position on 'create' (character 6-12)
            const hover = await hover_provider.get_hover(doc, { line: 0, character: 8 });
            
            expect(hover).not.toBeNull();
            if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('Frame Subcommand');
                expect(hover.contents.value).toContain('create');
                // Should NOT show standalone 'create' command
                expect(hover.contents.value).not.toContain('Standalone');
            }
        });

        it('should show frame-subcommand hover for "drop" in "frame drop"', async () => {
            const doc = create_test_document('frame drop myframe');
            // Position on 'drop' (character 6-10)
            const hover = await hover_provider.get_hover(doc, { line: 0, character: 8 });
            
            expect(hover).not.toBeNull();
            if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('Frame Subcommand');
                expect(hover.contents.value).toContain('drop');
            }
        });

        it('should show frame-subcommand hover after prefix commands', async () => {
            const doc = create_test_document('quietly frame create myframe');
            // Position on 'create' (character 14-20)
            const hover = await hover_provider.get_hover(doc, { line: 0, character: 16 });
            
            expect(hover).not.toBeNull();
            if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('Frame Subcommand');
                expect(hover.contents.value).toContain('create');
            }
        });
    });

    describe('Non-Subcommand Position', () => {
        it('should NOT show subcommand hover for later token with same name', async () => {
            // In "frame create create", hovering over the second "create" should NOT
            // trigger frame-subcommand hover
            const doc = create_test_document('frame create create');
            // Position on second 'create' (character 13-19)
            const hover = await hover_provider.get_hover(doc, { line: 0, character: 15 });
            
            // Should either be null or NOT contain "frame create" subcommand info
            if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
                // If we get hover, it should be for standalone 'create' command, not frame subcommand
                expect(hover.contents.value).not.toContain('Subcommand of');
            }
        });

        it('should NOT show subcommand hover for frame name position', async () => {
            // In "frame myframe { ... }", hovering over "myframe" should not trigger subcommand hover
            const doc = create_test_document('frame myframe { display "hi" }');
            // Position on 'myframe' (character 6-13)
            const hover = await hover_provider.get_hover(doc, { line: 0, character: 9 });
            
            // Should be null since 'myframe' is not a valid subcommand
            expect(hover).toBeNull();
        });

        it('should show frame command hover when hovering over "frame"', async () => {
            const doc = create_test_document('frame create myframe');
            // Position on 'frame' (character 0-5)
            const hover = await hover_provider.get_hover(doc, { line: 0, character: 2 });
            
            expect(hover).not.toBeNull();
            if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('frame');
                // Should NOT contain subcommand info
                expect(hover.contents.value).not.toContain('Subcommand');
            }
        });
    });
});

describe('Mi Subcommand Support', () => {
    let completion_provider: CompletionProvider;
    let hover_provider: HoverProvider;
    let command_db: CommandDatabase;

    beforeEach(() => {
        command_db = create_test_command_db();
        completion_provider = new CompletionProvider(command_db);
        hover_provider = new HoverProvider(command_db);
    });

    describe('Context Detection', () => {
        it('should detect subcommand context after "mi "', () => {
            const doc = create_test_document('mi ');
            const context = detect_completion_context(doc, { line: 0, character: 3 }, undefined, command_db);
            expect(context.type).toBe('subcommand');
            if (context.type === 'subcommand') {
                expect(context.prefix_command).toBe('mi');
            }
        });

        it('should detect subcommand context while typing mi subcommand', () => {
            const doc = create_test_document('mi est');
            const context = detect_completion_context(doc, { line: 0, character: 6 }, undefined, command_db);
            expect(context.type).toBe('subcommand');
            if (context.type === 'subcommand') {
                expect(context.prefix_command).toBe('mi');
            }
        });
    });

    describe('Completion Results', () => {
        it('should suggest mi subcommands after "mi "', async () => {
            const doc = create_test_document('mi ');
            const completions = await completion_provider.get_completions(
                doc,
                { line: 0, character: 3 }
            );
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('set');
            expect(labels).toContain('describe');
            expect(labels).toContain('estimate');
            expect(labels).toContain('impute');
        });

        it('should filter mi subcommands by prefix', async () => {
            const doc = create_test_document('mi est');
            const completions = await completion_provider.get_completions(
                doc,
                { line: 0, character: 6 }
            );
            
            const labels = completions.map(c => c.label);
            expect(labels).toContain('estimate');
            expect(labels).not.toContain('set');
            expect(labels).not.toContain('describe');
        });
    });

    describe('Hover', () => {
        it('should show mi-subcommand hover for "estimate" in "mi estimate"', async () => {
            const doc = create_test_document('mi estimate: regress y x');
            // Position on 'estimate' (character 3-11)
            const hover = await hover_provider.get_hover(doc, { line: 0, character: 6 });
            
            expect(hover).not.toBeNull();
            if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('Mi Subcommand');
                expect(hover.contents.value).toContain('estimate');
                expect(hover.contents.value).toContain('Subcommand of');
            }
        });
    });
});

import { describe, it, expect, beforeEach } from 'bun:test';
import { DocumentStore } from '../../src/document-store';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { ContextTracker } from '../../src/context-tracker';

// Note: this test intentionally exercises the real DocumentStore.open(...) pipeline,
// because HoverProvider is called with DocumentState instances sourced from DocumentStore
// in the running LSP.

describe('Integration - hover uses DocumentStore document tokens', () => {
    let document_store: DocumentStore;
    let command_db: CommandDatabase;
    let hover_provider: HoverProvider;

    beforeEach(() => {
        document_store = new DocumentStore();
        command_db = new CommandDatabase();

        // Load builtin commands into our isolated command database.
        // (initialize_builtin_commands() registers into the singleton command_database,
        // but HoverProvider in this test uses this local instance.)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const builtin_commands = require('../../src/commands/builtin-commands').BUILTIN_COMMANDS;
        command_db.register_all(builtin_commands);

        const context_tracker = new ContextTracker();
        hover_provider = new HoverProvider(command_db, context_tracker);
    });

    it('DocumentStore.open populates tokens (non-empty) before hover is computed', async () => {
        const uri = 'file:///hover-token-test.do';
        const content = 'frame create myframe';

        await document_store.open(uri, content, 1);
        const document_state = document_store.get(uri);

        expect(document_state).toBeDefined();
        expect(document_state!.tokens).toBeDefined();
        expect(document_state!.tokens.length).toBeGreaterThan(0);

        const hover = await hover_provider.get_hover(document_state!, { line: 0, character: 8 });
        expect(hover).not.toBeNull();

        if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
            // This hover should be the prefix-subcommand hover, not standalone create.
            expect(hover.contents.value).toContain('Frame Subcommand');
            expect(hover.contents.value).toContain('create');
        }
    });
});

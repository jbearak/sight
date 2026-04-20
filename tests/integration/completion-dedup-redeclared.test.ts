/**
 * Regression guard (issue #135): completion dedups redeclared local macros.
 *
 * Two `local fruit` declarations in the same file must surface exactly one
 * `fruit` completion item. The completion provider's existing `seen_labels`
 * deduplication set is the mechanism that enforces this — this test simply
 * pins that behavior now that `local fruit` records are pooled (rather than
 * split into distinct identities) under the new identity model.
 */

import { describe, it, expect } from 'bun:test';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { DocumentStore } from '../../src/document-store';

describe('Completion dedups redeclared symbols', () => {
    it('offers `fruit` exactly once when two `local fruit` declarations exist', async () => {
        const source = [
            'local fruit apple',
            'local fruit banana',
            'di "`fru',
        ].join('\n');
        const document_store = new DocumentStore();
        const uri = 'file:///test.do';
        await document_store.open(uri, source, 1);
        const document_state = document_store.get(uri)!;

        const completion_provider = new CompletionProvider(new CommandDatabase());
        const the_items = await completion_provider.get_completions(
            document_state,
            { line: 2, character: 7 },
        );

        const the_fruit_items = the_items.filter(item => item.label === 'fruit');
        expect(the_fruit_items.length).toBe(1);
    });
});

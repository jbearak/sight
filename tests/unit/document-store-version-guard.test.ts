import { describe, expect, it } from 'bun:test';
import { DocumentStore } from '../../src/document-store';

describe('DocumentStore version guard', () => {
    it('rejects older-version updates even when scope config is present', async () => {
        const document_store = new DocumentStore();
        const uri = 'file:///version-guard.do';

        await document_store.open(uri, 'content v1', 1);
        await document_store.update(uri, [{ text: 'content v3' }], 3);

        await document_store.update(
            uri,
            [{ text: 'content v2' }],
            2,
            undefined,
            { backward_dependencies: 'auto' }
        );

        const state = document_store.get(uri);
        expect(state).toBeDefined();
        expect(state!.version).toBe(3);
        expect(state!.content).toBe('content v3');
    });
});

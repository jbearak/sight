import { describe, expect, it } from 'bun:test';
import { DocumentState, DocumentStore } from '../../src/document-store';

type InspectableDocumentStore = DocumentStore & {
    documents: Map<string, DocumentState>;
    generations: Map<string, number>;
    commit_state(
        uri: string,
        state: DocumentState,
        generation: number
    ): void;
    create_document_state(
        uri: string,
        content: string,
        version: number
    ): Promise<DocumentState>;
};

describe('DocumentStore version guard', () => {
    it('rejects older commit state while allowing equal-version reparses', async () => {
        const document_store = new DocumentStore();
        const store = document_store as unknown as InspectableDocumentStore;
        const uri = 'file:///version-guard-commit.do';

        await document_store.open(uri, 'content v3', 3);
        const state_v3 = document_store.get(uri);
        expect(state_v3).toBeDefined();

        const stale_state_v2 = {
            ...state_v3!,
            version: 2,
            content: 'content v2',
        };
        store.commit_state(uri, stale_state_v2, 2);

        expect(store.documents.get(uri)).toBe(state_v3);
        expect(store.documents.get(uri)!.version).toBe(3);
        expect(store.documents.get(uri)!.content).toBe('content v3');

        const reparse_state_v3 = {
            ...state_v3!,
            content: 'content v3 reparse',
        };
        store.commit_state(uri, reparse_state_v3, 3);

        expect(store.documents.get(uri)).toBe(reparse_state_v3);
        expect(store.documents.get(uri)!.version).toBe(3);
        expect(store.documents.get(uri)!.content).toBe('content v3 reparse');
    });

    it('keeps newer content when concurrent updates commit out of order', async () => {
        const document_store = new DocumentStore();
        const store = document_store as unknown as InspectableDocumentStore;
        const uri = 'file:///version-guard-concurrent.do';
        let release_v2_parse: (() => void) | undefined;
        const v2_parse_can_finish = new Promise<void>(resolve => {
            release_v2_parse = resolve;
        });
        const create_document_state = store.create_document_state.bind(store);

        store.create_document_state = async (
            state_uri: string,
            content: string,
            version: number
        ) => {
            const state = await create_document_state(state_uri, content, version);
            if (version === 2) {
                await v2_parse_can_finish;
            }
            return state;
        };

        await document_store.open(uri, 'content v1', 1);

        const update_v3 = document_store.update(uri, [{ text: 'content v3' }], 3);
        const update_v2 = document_store.update(uri, [{ text: 'content v2' }], 2);

        await update_v3;
        release_v2_parse!();
        await update_v2;

        const state = document_store.get(uri);
        expect(state).toBeDefined();
        expect(state!.version).toBe(3);
        expect(state!.content).toBe('content v3');
    });

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

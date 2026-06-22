import { describe, expect, it } from 'bun:test';
import { DocumentStore } from '../../src/document-store';

type InspectableDocumentStore = DocumentStore & {
    documents: Map<string, unknown>;
    access_order: Set<string>;
    in_flight_counts: Map<string, number>;
    MAX_DOCUMENTS: number;
    evict_if_needed(incoming_bytes: number): void;
};

describe('DocumentStore eviction', () => {
    it('skips in-flight documents when evicting by count', () => {
        const document_store = new DocumentStore();
        const store = document_store as unknown as InspectableDocumentStore;
        const in_flight_uri = 'file:///in-flight.do';
        const evictable_uri = 'file:///evictable.do';

        store.MAX_DOCUMENTS = 2;
        store.documents.set(in_flight_uri, { content: '', tokens: [] });
        store.documents.set(evictable_uri, { content: '', tokens: [] });
        store.access_order.add(in_flight_uri);
        store.access_order.add(evictable_uri);
        store.in_flight_counts.set(in_flight_uri, 1);

        store.evict_if_needed(1);

        expect(store.documents.has(in_flight_uri)).toBe(true);
        expect(store.documents.has(evictable_uri)).toBe(false);
    });
});

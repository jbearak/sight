/**
 * Verifies that the server-factory wires
 * `resolve_sthlp_handler.clear_negative_cache()` to indexer events.
 *
 * The handler's negative cache is a per-handler in-memory FIFO; if it
 * is never cleared in production, newly indexed files cannot satisfy
 * previously-unresolvable topics until restart. This test guards
 * against the wiring regressing by inspecting `server-factory.ts` for
 * the two expected call sites (post-initialize, and graph-change
 * callback).
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('server-factory clears sthlp negative cache on indexer events', () => {
    const source = readFileSync(
        join(__dirname, '../../src/server-factory.ts'),
        'utf8'
    );

    it('clears the negative cache after workspace_indexer.initialize() resolves', () => {
        // Post-initialize block must call clear_negative_cache before
        // (or alongside) revalidate_all_open_docs.
        const my_pattern =
            /workspace_indexer\.initialize[\s\S]*?\.then\([\s\S]*?clear_negative_cache\(\)/;
        expect(my_pattern.test(source)).toBe(true);
    });

    it('clears the negative cache from the graph-change callback', () => {
        const my_pattern =
            /function invalidate_and_revalidate_callees[\s\S]*?clear_negative_cache\(\)/;
        expect(my_pattern.test(source)).toBe(true);
    });
});

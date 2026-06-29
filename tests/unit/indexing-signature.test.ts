import { describe, expect, it } from 'bun:test';
import type { DeepPartial } from '../../src/config-file';
import { StataLSPConfig } from '../../src/types';
import { indexing_affecting_signature } from '../../src/server-factory';

// The signature is the decision predicate for "should a runtime/project config
// change trigger a full workspace re-index?" (#223). Two configs that differ
// only in an indexing-affecting key MUST yield different signatures; two that
// differ only in a non-indexing key (severity, formatting, debug, ...) MUST
// yield equal signatures (so they take the lightweight revalidation path, not
// an expensive teardown + re-scan).
describe('indexing_affecting_signature', () => {
    const base: DeepPartial<StataLSPConfig> = {
        adoPaths: ['/a'],
        indexWorkspace: true,
        cross_file: {
            index_workspace: true,
            max_indexed_files: 1000,
            max_backward_depth: 10,
        },
        indexing: { maxFileSizeBytes: 1_000_000 },
    };

    function with_change(
        mutate: (config: DeepPartial<StataLSPConfig>) => void
    ): DeepPartial<StataLSPConfig> {
        const my_copy: DeepPartial<StataLSPConfig> = JSON.parse(
            JSON.stringify(base)
        );
        mutate(my_copy);
        return my_copy;
    }

    it('differs when adoPaths changes', () => {
        const changed = with_change((c) => { c.adoPaths = ['/a', '/b']; });
        expect(indexing_affecting_signature(changed)).not.toBe(
            indexing_affecting_signature(base)
        );
    });

    it('differs when indexWorkspace changes', () => {
        const changed = with_change((c) => { c.indexWorkspace = false; });
        expect(indexing_affecting_signature(changed)).not.toBe(
            indexing_affecting_signature(base)
        );
    });

    it('differs when cross_file.index_workspace changes', () => {
        const changed = with_change((c) => {
            c.cross_file!.index_workspace = false;
        });
        expect(indexing_affecting_signature(changed)).not.toBe(
            indexing_affecting_signature(base)
        );
    });

    it('differs when cross_file.max_indexed_files changes', () => {
        const changed = with_change((c) => {
            c.cross_file!.max_indexed_files = 500;
        });
        expect(indexing_affecting_signature(changed)).not.toBe(
            indexing_affecting_signature(base)
        );
    });

    it('differs when indexing.maxFileSizeBytes changes', () => {
        const changed = with_change((c) => {
            c.indexing!.maxFileSizeBytes = 2_000_000;
        });
        expect(indexing_affecting_signature(changed)).not.toBe(
            indexing_affecting_signature(base)
        );
    });

    it('differs when cross_file.max_backward_depth changes', () => {
        const changed = with_change((c) => {
            c.cross_file!.max_backward_depth = 5;
        });
        expect(indexing_affecting_signature(changed)).not.toBe(
            indexing_affecting_signature(base)
        );
    });

    it('differs when exclude changes', () => {
        // exclude governs which files are scanned/indexed (#255), so changing
        // it must trigger a full re-scan rather than leaving stale symbols for
        // newly-excluded (or newly-included) paths.
        const changed = with_change((c) => { c.exclude = ['output/**']; });
        expect(indexing_affecting_signature(changed)).not.toBe(
            indexing_affecting_signature(base)
        );
    });

    it('is equal when only a non-indexing field changes', () => {
        // A severity / debug tweak must NOT trigger a re-index.
        const changed = with_change((c) => {
            (c as DeepPartial<StataLSPConfig> & { debug?: boolean }).debug =
                true;
        });
        expect(indexing_affecting_signature(changed)).toBe(
            indexing_affecting_signature(base)
        );
    });

    it('treats undefined as an all-absent config', () => {
        expect(indexing_affecting_signature(undefined)).toBe(
            indexing_affecting_signature({})
        );
    });

    it('never returns the empty-string sentinel', () => {
        // The pre-baseline sentinel is '' which a real signature must never
        // collide with (real signatures are JSON object strings).
        expect(indexing_affecting_signature(undefined)).not.toBe('');
        expect(indexing_affecting_signature(base)).not.toBe('');
    });
});

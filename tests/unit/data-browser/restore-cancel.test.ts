import { describe, expect, it, mock, beforeEach } from 'bun:test';

// vscode is mocked so browser-panel can be imported headless. Includes
// showWarningMessage (used by the real-error restore path).
let warnings: string[] = [];
mock.module('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, default_value: unknown) => default_value,
        }),
    },
    window: {
        showErrorMessage: () => undefined,
        showWarningMessage: (msg: string) => {
            warnings.push(msg);
            return undefined;
        },
    },
}));

import {
    EMPTY_SORT,
    EMPTY_FILTER,
    type SortState,
    type FilterState,
} from '../../../client/src/data-browser/types';

function abort_error(): Error {
    const my_err = new Error('The read was aborted');
    my_err.name = 'AbortError';
    return my_err;
}

interface RestoreHarness {
    panel_like: any;
    posted: any[];
    sort_set: SortState[];
    filter_set: FilterState[];
}

const STORED_SORT: SortState = {
    keys: [{ col_index: 0, direction: 'asc' }],
    labels_on_when_sorted: true,
};

const STORED_FILTER: FilterState = {
    entries: [{
        id: 'f1',
        col_index: 1,
        predicate: { kind: 'isNotEmpty' },
        enabled: true,
        include_missing: false,
    }],
    labels_on_when_filtered: true,
};

async function make_restore_panel(opts: {
    stored_sort?: SortState | undefined;
    stored_filter?: FilterState | undefined;
} = {}): Promise<RestoreHarness> {
    const { DataBrowserPanel } = await import(
        '../../../client/src/data-browser/browser-panel'
    );
    const posted: any[] = [];
    const sort_set: SortState[] = [];
    const filter_set: FilterState[] = [];
    const panel_like: any = Object.create(DataBrowserPanel.prototype);

    panel_like.dta_file = {
        nobs: 10,
        nvar: 2,
        variables: [
            { name: 'a', type: 'int', format: '%9.0g',
                label: '', value_label_name: '' },
            { name: 'b', type: 'str10', format: '%10s',
                label: '', value_label_name: '' },
        ],
        value_label_tables: new Map(),
    };
    panel_like.sidecar = { name: 'ds', subsetted: false };
    panel_like.dataset_key = 'k';
    panel_like.dataset_key_aliases = [];
    panel_like.generation = 0;
    panel_like.sort = EMPTY_SORT;
    panel_like.permutation = null;
    panel_like.sort_restored = false;
    panel_like.filter = EMPTY_FILTER;
    panel_like.filtered_indices = null;
    panel_like.filter_restored = false;
    panel_like.effective_perm = null;
    panel_like.restore_abort = null;
    panel_like.restore_cancelled = false;
    panel_like.restoring = false;
    panel_like.restore_failed = false;
    panel_like.restore_id = -1;
    panel_like.send_metadata_chain = Promise.resolve();
    panel_like.row_cache = { clear: () => undefined };

    panel_like.panel = {
        webview: {
            postMessage: (m: any) => { posted.push(m); return true; },
        },
    };
    panel_like.sort_state_store = {
        get: () => opts.stored_sort,
        set: async (_k: string, _h: string, s: SortState) => {
            sort_set.push(s);
        },
    };
    panel_like.filter_state_store = {
        get: () => opts.stored_filter,
        set: async (_k: string, _h: string, f: FilterState) => {
            filter_set.push(f);
        },
    };
    panel_like.column_width_store = { get: () => undefined };
    panel_like.column_visibility_store = { get: () => undefined };

    return { panel_like, posted, sort_set, filter_set };
}

beforeEach(() => { warnings = []; });

describe('maybe_begin_restore', () => {
    it('posts restorePending and arms the restore when prefs apply', async () => {
        const { panel_like, posted } = await make_restore_panel({
            stored_sort: STORED_SORT,
            stored_filter: STORED_FILTER,
        });

        const my_began = panel_like.maybe_begin_restore('h');

        expect(my_began).toBe(true);
        expect(panel_like.restoring).toBe(true);
        expect(panel_like.restore_abort).not.toBeNull();
        expect(panel_like.restore_id).toBe(0);
        expect(posted[0]).toEqual({
            type: 'restorePending',
            restore_id: 0,
            sort: true,
            filter: true,
        });
    });

    it('does not begin when no prefs are stored', async () => {
        const { panel_like, posted } = await make_restore_panel();
        expect(panel_like.maybe_begin_restore('h')).toBe(false);
        expect(panel_like.restoring).toBe(false);
        expect(posted).toEqual([]);
    });

    it('does not begin once already restored', async () => {
        const { panel_like, posted } = await make_restore_panel({
            stored_sort: STORED_SORT,
        });
        panel_like.sort_restored = true;
        panel_like.filter_restored = true;
        expect(panel_like.maybe_begin_restore('h')).toBe(false);
        expect(posted).toEqual([]);
    });

    it('flags sort-only vs filter-only correctly', async () => {
        const { panel_like, posted } = await make_restore_panel({
            stored_filter: STORED_FILTER,
        });
        panel_like.maybe_begin_restore('h');
        expect(posted[0].sort).toBe(false);
        expect(posted[0].filter).toBe(true);
    });
});

describe('send_metadata restore', () => {
    it('completed sort + cancelled filter ends in natural order (finding #1)', async () => {
        const { panel_like, posted, sort_set, filter_set } =
            await make_restore_panel({
                stored_sort: STORED_SORT,
                stored_filter: STORED_FILTER,
            });

        // Sort restore completes (applies sort + permutation)...
        panel_like.compute_sort_permutation = async () =>
            new Uint32Array(10);
        // ...then a cancel lands during the filter read: the controller
        // is aborted and the read rejects with AbortError.
        panel_like.compute_filter_indices = async () => {
            panel_like.restore_abort?.abort();
            throw abort_error();
        };

        await panel_like.send_metadata();

        // In-memory restore effects fully undone.
        expect(panel_like.sort.keys.length).toBe(0);
        expect(panel_like.permutation).toBeNull();
        expect(panel_like.filter.entries.length).toBe(0);
        expect(panel_like.filtered_indices).toBeNull();

        // Persisted prefs forgotten (set with empty state).
        expect(sort_set.length).toBe(1);
        expect(sort_set[0].keys.length).toBe(0);
        expect(filter_set.length).toBe(1);
        expect(filter_set[0].entries.length).toBe(0);

        // restorePending preceded metadata; metadata carries no chips.
        expect(posted[0].type).toBe('restorePending');
        const my_meta = posted.find(m => m.type === 'metadata');
        expect(my_meta).toBeDefined();
        expect(my_meta.stored_sort).toBeUndefined();
        expect(my_meta.stored_filter).toBeUndefined();

        // No spurious filterApplied, and restore state cleaned up.
        expect(posted.some(m => m.type === 'filterApplied')).toBe(false);
        expect(panel_like.restoring).toBe(false);
        expect(panel_like.restore_abort).toBeNull();
    });

    it('normal completion applies and ships the saved prefs', async () => {
        const { panel_like, posted, sort_set, filter_set } =
            await make_restore_panel({
                stored_sort: STORED_SORT,
                stored_filter: STORED_FILTER,
            });
        panel_like.compute_sort_permutation = async () =>
            new Uint32Array(10);
        panel_like.compute_filter_indices = async () =>
            new Uint32Array([0, 1, 2]);

        await panel_like.send_metadata();

        expect(panel_like.sort.keys.length).toBe(1);
        expect(panel_like.filter.entries.length).toBe(1);
        // Nothing forgotten.
        expect(sort_set).toEqual([]);
        expect(filter_set).toEqual([]);

        expect(posted[0].type).toBe('restorePending');
        const my_meta = posted.find(m => m.type === 'metadata');
        expect(my_meta.stored_sort).toEqual(STORED_SORT);
        expect(my_meta.stored_filter).toEqual(STORED_FILTER);
        // Active filter → effective count announced.
        expect(posted.some(m => m.type === 'filterApplied')).toBe(true);
    });

    it('clears restoring even if it throws before metadata (finding #3)', async () => {
        const { panel_like } = await make_restore_panel({
            stored_sort: STORED_SORT,
        });
        panel_like.compute_sort_permutation = async () =>
            new Uint32Array(10);
        // Throw after the restore began but before metadata is posted.
        panel_like.recompute_effective = () => {
            throw new Error('boom');
        };

        await panel_like.send_metadata();

        expect(panel_like.restoring).toBe(false);
        expect(panel_like.restore_abort).toBeNull();
    });

    it('serializes send_metadata so a reload cannot start a concurrent restore', async () => {
        const { panel_like, posted } = await make_restore_panel({
            stored_sort: STORED_SORT,
        });
        let release_first: (() => void) | null = null;
        const my_gate = new Promise<void>(r => { release_first = r; });
        let calls = 0;
        panel_like.compute_sort_permutation = async () => {
            if (calls++ === 0) await my_gate;
            return new Uint32Array(10);
        };

        const p1 = panel_like.send_metadata();
        const p2 = panel_like.send_metadata();
        // Let microtasks settle; without serialization p2 would begin its
        // own restore (and post a second restorePending) before p1 ends.
        await Promise.resolve();
        release_first!();
        await Promise.all([p1, p2]);

        const the_pendings = posted.filter(
            m => m.type === 'restorePending'
        );
        expect(the_pendings.length).toBe(1);
    });

    it('bails without posting or forgetting if generation changes mid-restore (round 4)', async () => {
        const { panel_like, posted, sort_set } = await make_restore_panel({
            stored_sort: STORED_SORT,
        });
        // Simulate a refresh / webview-reload bumping generation while
        // the restore column read is in flight.
        panel_like.compute_sort_permutation = async () => {
            panel_like.generation++;
            return new Uint32Array(10);
        };

        await panel_like.send_metadata();

        // Stale attempt: no metadata posted, prefs left intact.
        expect(posted.some(m => m.type === 'metadata')).toBe(false);
        expect(sort_set).toEqual([]);
    });

    it('real read error keeps prefs and warns (finding #7)', async () => {
        const { panel_like, posted, sort_set, filter_set } =
            await make_restore_panel({ stored_sort: STORED_SORT });
        // A genuine (non-abort) failure during the sort column read.
        panel_like.compute_sort_permutation = async () => {
            throw new Error('decode failed');
        };

        await panel_like.send_metadata();

        // Natural order + warning, but prefs are NOT forgotten.
        expect(warnings.length).toBe(1);
        expect(panel_like.sort.keys.length).toBe(0);
        expect(sort_set).toEqual([]);
        expect(filter_set).toEqual([]);
        const my_meta = posted.find(m => m.type === 'metadata');
        expect(my_meta.stored_sort).toBeUndefined();
    });
});

describe('handle_cancel_restore', () => {
    it('ignores a stale restore_id', async () => {
        const { panel_like } = await make_restore_panel();
        panel_like.restore_id = 5;
        panel_like.restoring = true;
        let aborted = false;
        panel_like.restore_abort = { abort: () => { aborted = true; } };

        await panel_like.handle_cancel_restore({
            type: 'cancelRestore', restore_id: 4,
        });

        expect(aborted).toBe(false);
    });

    it('aborts an in-flight restore on a matching id', async () => {
        const { panel_like } = await make_restore_panel();
        panel_like.restore_id = 7;
        panel_like.restoring = true;
        let aborted = false;
        panel_like.restore_abort = { abort: () => { aborted = true; } };

        await panel_like.handle_cancel_restore({
            type: 'cancelRestore', restore_id: 7,
        });

        expect(aborted).toBe(true);
    });

    it('honors a late cancel as clear-and-forget (finding #5)', async () => {
        const { panel_like, posted, sort_set, filter_set } =
            await make_restore_panel({
                stored_sort: STORED_SORT,
                stored_filter: STORED_FILTER,
            });
        // Restore already completed: not restoring, sort applied.
        panel_like.restore_id = 3;
        panel_like.restoring = false;
        panel_like.sort = STORED_SORT;
        panel_like.permutation = new Uint32Array(10);
        panel_like.current_schema_hash = () => 'h';
        panel_like.recompute_effective = () => undefined;
        panel_like.post_sort_applied = () =>
            posted.push({ type: 'sortApplied' });
        panel_like.post_filter_applied = () =>
            posted.push({ type: 'filterApplied' });

        await panel_like.handle_cancel_restore({
            type: 'cancelRestore', restore_id: 3,
        });

        expect(panel_like.sort.keys.length).toBe(0);
        expect(panel_like.permutation).toBeNull();
        expect(sort_set[0].keys.length).toBe(0);
        expect(filter_set[0].entries.length).toBe(0);
        expect(panel_like.restore_id).toBe(-1); // consumed
        expect(posted.some(m => m.type === 'sortApplied')).toBe(true);
        expect(posted.some(m => m.type === 'filterApplied')).toBe(true);

        // A duplicate late cancel is now ignored (id consumed).
        const my_before = sort_set.length;
        await panel_like.handle_cancel_restore({
            type: 'cancelRestore', restore_id: 3,
        });
        expect(sort_set.length).toBe(my_before);
    });
});

describe('reset_restored_prefs / forget_persisted_prefs', () => {
    it('reset clears memory and consumes the id synchronously', async () => {
        const { panel_like, sort_set, filter_set } =
            await make_restore_panel();
        panel_like.sort = STORED_SORT;
        panel_like.permutation = new Uint32Array(3);
        panel_like.filter = STORED_FILTER;
        panel_like.filtered_indices = new Uint32Array(2);
        panel_like.restore_id = 9;

        panel_like.reset_restored_prefs();

        expect(panel_like.sort.keys.length).toBe(0);
        expect(panel_like.permutation).toBeNull();
        expect(panel_like.filter.entries.length).toBe(0);
        expect(panel_like.filtered_indices).toBeNull();
        expect(panel_like.restore_id).toBe(-1);
        // No persistence writes from the synchronous reset.
        expect(sort_set).toEqual([]);
        expect(filter_set).toEqual([]);
    });

    it('forget writes empty state to both stores', async () => {
        const { panel_like, sort_set, filter_set } =
            await make_restore_panel();
        await panel_like.forget_persisted_prefs('h');
        expect(sort_set[0].keys.length).toBe(0);
        expect(filter_set[0].entries.length).toBe(0);
    });
});

describe('late-cancel invalidation ordering (finding C-2)', () => {
    it('bumps generation and clears cache before awaiting persistence', async () => {
        const { panel_like } = await make_restore_panel({
            stored_sort: STORED_SORT,
        });
        panel_like.restore_id = 2;
        panel_like.restoring = false;
        panel_like.sort = STORED_SORT;
        panel_like.permutation = new Uint32Array(10);
        panel_like.current_schema_hash = () => 'h';
        panel_like.recompute_effective = () => undefined;
        panel_like.post_sort_applied = () => undefined;
        panel_like.post_filter_applied = () => undefined;

        let cache_cleared_at: number | null = null;
        let order = 0;
        panel_like.row_cache = {
            clear: () => { cache_cleared_at = order++; },
        };
        // A slow store write: generation/cache must already be
        // invalidated by the time this is awaited.
        let persisted_at: number | null = null;
        panel_like.sort_state_store.set = async () => {
            persisted_at = order++;
        };

        const my_gen_before = panel_like.generation;
        await panel_like.handle_cancel_restore({
            type: 'cancelRestore', restore_id: 2,
        });

        expect(panel_like.generation).toBe(my_gen_before + 1);
        expect(cache_cleared_at).toBe(0);
        // Persistence happened strictly after invalidation.
        expect(persisted_at).not.toBeNull();
        expect(persisted_at! > cache_cleared_at!).toBe(true);
    });
});

describe('stale restore state does not leak across opens (code-review root cause)', () => {
    it('a later send_metadata without a restore does not forget manual prefs', async () => {
        const { panel_like, sort_set, filter_set } =
            await make_restore_panel({ stored_sort: STORED_SORT });
        // Simulate: a prior restore was cancelled (its aborted
        // controller lingers), the user then manually applied a sort,
        // and the webview re-sends 'ready'. The new send_metadata begins
        // no restore (already restored), so it must read no cancel.
        const my_stale = new AbortController();
        my_stale.abort();
        panel_like.restore_abort = my_stale;
        panel_like.sort_restored = true;
        panel_like.filter_restored = true;
        panel_like.sort = STORED_SORT;
        panel_like.permutation = new Uint32Array(10);

        await panel_like.send_metadata();

        // The manually-applied sort survives; nothing forgotten.
        expect(panel_like.sort.keys.length).toBe(1);
        expect(sort_set).toEqual([]);
        expect(filter_set).toEqual([]);
    });
});

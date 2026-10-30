/**
 * Data-browser host benchmark: one scenario per process.
 *
 * Drives the real DataBrowserPanel (with a stub `vscode` module and a
 * fake webview) through the same messages the webview sends, and
 * measures, per scenario:
 *   - wall time from the triggering message to the host's reply;
 *   - the extension host's event loop: longest single stall and the
 *     total time spent in stalls > STALL_THRESHOLD_MS, from a 2 ms
 *     heartbeat;
 *   - JSON size of the reply. The fake webview serializes every posted
 *     message with JSON.stringify, as VS Code does, so serialization
 *     cost is inside the measured stalls;
 *   - peak resident memory of the process (`maxRSS`).
 *
 * Run through run.ts, which bundles this file for Node and spawns one
 * process per scenario with a kill timeout: a scenario that blocks the
 * event loop indefinitely (a catastrophic regex) cannot time itself
 * out from inside.
 *
 * Usage (after bundling): node bench.mjs <fixture.dta> '<scenario json>'
 */

import { DataBrowserPanel } from '../../client/src/data-browser/browser-panel.js';
import type {
    ExtensionMessage,
    FilterPredicate,
    FilterState,
    MetadataMessage,
    SortState,
    WebviewMessage,
} from '../../client/src/data-browser/types.js';

const HEARTBEAT_MS = 2;
const STALL_THRESHOLD_MS = 16;
const SCROLL_PAGES = 20;
const SCROLL_DURING_SORT_INTERVAL_MS = 16;
const DROPPED_GRACE_MS = 1000;

export type Scenario =
    | { kind: 'open' }
    | { kind: 'sort'; column: string; direction?: 'asc' | 'desc';
        labels_on?: boolean }
    | { kind: 'filter'; column: string; predicate: FilterPredicate }
    | { kind: 'histogram'; column: string }
    | { kind: 'sorted_page'; column: string }
    | { kind: 'copy'; column: string }
    | { kind: 'scroll' }
    | { kind: 'scroll_during_sort'; column: string }
    | { kind: 'restore'; sort_column: string; filter_column: string;
        predicate: FilterPredicate };

interface LoopStats {
    max_stall_ms: number;
    stalled_ms: number;
}

class LoopMonitor {
    private timer: NodeJS.Timeout | null = null;
    private last = 0;
    private max_stall = 0;
    private stalled = 0;

    start(): void {
        this.last = performance.now();
        this.max_stall = 0;
        this.stalled = 0;
        this.timer = setInterval(() => this.tick(), HEARTBEAT_MS);
    }

    private tick(): void {
        const my_now = performance.now();
        const my_stall = my_now - this.last - HEARTBEAT_MS;
        if (my_stall > this.max_stall) this.max_stall = my_stall;
        if (my_stall > STALL_THRESHOLD_MS) this.stalled += my_stall;
        this.last = my_now;
    }

    stop(): LoopStats {
        this.tick();
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return {
            max_stall_ms: round(Math.max(0, this.max_stall)),
            stalled_ms: round(this.stalled),
        };
    }
}

function round(n: number): number {
    return Math.round(n * 10) / 10;
}

function percentile(values: number[], p: number): number {
    const the_sorted = [...values].sort((a, b) => a - b);
    const my_index = Math.min(
        the_sorted.length - 1,
        Math.ceil(p * the_sorted.length) - 1
    );
    return round(the_sorted[Math.max(0, my_index)] ?? 0);
}

/** Peak resident set size of this process, in MiB. */
function peak_rss_mib(): number {
    // maxRSS is reported in kilobytes.
    return Math.round(process.resourceUsage().maxRSS / 1024);
}

interface Posted {
    at: number;
    json_bytes: number;
    msg: ExtensionMessage;
}

class FakeWebview {
    posted: Posted[] = [];
    private receive: ((msg: WebviewMessage) => unknown) | null = null;
    private waiters: {
        pred: (m: ExtensionMessage) => boolean;
        resolve: (p: Posted) => void;
    }[] = [];

    readonly panel = {
        webview: {
            html: '',
            postMessage: (msg: ExtensionMessage) => {
                // VS Code serializes webview messages on the host
                // thread; do the same so the cost lands in the stalls.
                const my_json_bytes = JSON.stringify(msg).length;
                const my_posted = {
                    at: performance.now(),
                    json_bytes: my_json_bytes,
                    msg,
                };
                this.posted.push(my_posted);
                this.waiters = this.waiters.filter(my_w => {
                    if (!my_w.pred(msg)) return true;
                    my_w.resolve(my_posted);
                    return false;
                });
                return Promise.resolve(true);
            },
            onDidReceiveMessage: (cb: (msg: WebviewMessage) => unknown) => {
                this.receive = cb;
                return { dispose: () => undefined };
            },
        },
        onDidDispose: () => ({ dispose: () => undefined }),
        reveal: () => undefined,
        dispose: () => undefined,
    };

    send(msg: WebviewMessage): void {
        if (!this.receive) throw new Error('panel not listening');
        void this.receive(msg);
    }

    wait_for(pred: (m: ExtensionMessage) => boolean): Promise<Posted> {
        const my_hit = this.posted.find(my_p => pred(my_p.msg));
        if (my_hit) return Promise.resolve(my_hit);
        return new Promise(resolve => {
            this.waiters.push({ pred, resolve });
        });
    }

    /** Wait for a matching message posted after index `from`. */
    wait_for_after(
        from: number,
        pred: (m: ExtensionMessage) => boolean
    ): Promise<Posted> {
        const my_hit = this.posted.slice(from).find(my_p => pred(my_p.msg));
        if (my_hit) return Promise.resolve(my_hit);
        return this.wait_for(pred);
    }
}

/** Persisted-preference stores whose values are read on each `get`. */
interface Stores {
    sort?: SortState;
    filter?: FilterState;
}

function make_store(read: () => unknown) {
    return {
        get: read,
        set: async () => undefined,
    };
}

let request_seq = 0;

function request_rows(
    webview: FakeWebview,
    start: number,
    count: number
): Promise<Posted> {
    const my_id = `r${request_seq++}`;
    webview.send({ type: 'requestRows', start, count, request_id: my_id });
    return webview.wait_for(
        my_m => my_m.type === 'rowData' && my_m.request_id === my_id
    );
}

/** Deterministic page starts spread over the dataset. */
function page_starts(nobs: number, page_rows: number, count: number): number[] {
    const my_pages = Math.max(1, Math.floor(nobs / page_rows));
    const the_starts: number[] = [];
    for (let i = 0; i < count; i++) {
        the_starts.push(((i * 7919 + 13) % my_pages) * page_rows);
    }
    return the_starts;
}

function open_panel(
    webview: FakeWebview,
    file_path: string,
    stores: Stores
): void {
    // The fakes implement only the members DataBrowserPanel uses, so
    // they are passed through the constructor's parameter types.
    type Args = ConstructorParameters<typeof DataBrowserPanel>;
    const my_null_store = make_store(() => undefined);
    new DataBrowserPanel(
        webview.panel as unknown as Args[0],
        {
            version: 1, uuid: 'bench', timestamp: '', source: file_path,
            cwd: '', name: 'bench', dtapath: file_path, varlist: [],
            if: '', in: '', N: 0, k: 0, replace: false, subsetted: false,
        },
        file_path,
        '',
        my_null_store as unknown as Args[4],
        my_null_store as unknown as Args[5],
        make_store(() => stores.sort) as unknown as Args[6],
        make_store(() => stores.filter) as unknown as Args[7]
    );
}

async function main(): Promise<void> {
    const [my_path, my_scenario_json] = process.argv.slice(2);
    const my_scenario = JSON.parse(my_scenario_json) as Scenario;
    const my_monitor = new LoopMonitor();
    const webview = new FakeWebview();
    const my_result: Record<string, unknown> = { scenario: my_scenario };

    // Restore needs stored prefs in place before `ready`; the stores
    // read them lazily, so they can be filled in after construction.
    const my_stores: Stores = {};

    // --- Open: constructor + ready -> metadata -> first page. ---
    my_monitor.start();
    const my_t0 = performance.now();
    open_panel(webview, my_path, my_stores);
    if (my_scenario.kind === 'restore') {
        // Resolve the columns from the file's header before `ready`.
        const { DtaFile } = await import('@jbearak/dta-parser/node');
        const my_header = await DtaFile.open(my_path);
        const index_of = (name: string): number =>
            my_header.variables.findIndex(my_v => my_v.name === name);
        my_stores.sort = {
            keys: [{ col_index: index_of(my_scenario.sort_column),
                direction: 'asc' }],
            labels_on_when_sorted: true,
        };
        my_stores.filter = {
            entries: [{
                id: 'f1',
                col_index: index_of(my_scenario.filter_column),
                predicate: my_scenario.predicate,
                enabled: true,
                include_missing: false,
            }],
            labels_on_when_filtered: true,
        };
        my_header.close();
    }
    webview.send({ type: 'ready' });
    const my_meta_posted = await webview.wait_for(
        my_m => my_m.type === 'metadata'
    );
    const my_meta = my_meta_posted.msg as MetadataMessage;
    const my_page_size = my_meta.page_size ?? 200;
    const my_first = await request_rows(webview, 0, my_page_size);
    const my_open_loop = my_monitor.stop();
    my_result.open = {
        metadata_ms: round(my_meta_posted.at - my_t0),
        first_rows_ms: round(my_first.at - my_t0),
        metadata_json_bytes: my_meta_posted.json_bytes,
        first_page_json_bytes: my_first.json_bytes,
        page_rows: my_page_size,
        ...my_open_loop,
    };

    const col = (name: string): number => {
        const my_index = my_meta.variables.findIndex(my_v => my_v.name === name);
        if (my_index < 0) throw new Error(`no column ${name}`);
        return my_index;
    };

    const time_action = async (
        trigger: () => void,
        done: (m: ExtensionMessage) => boolean
    ): Promise<Record<string, unknown>> => {
        const my_before = webview.posted.length;
        my_monitor.start();
        const my_start = performance.now();
        trigger();
        const my_done = await webview.wait_for_after(my_before, done);
        return {
            ms: round(my_done.at - my_start),
            reply_json_bytes: my_done.json_bytes,
            ...my_monitor.stop(),
        };
    };

    const send_sort = (column: string, direction: 'asc' | 'desc',
        labels_on: boolean) => webview.send({
        type: 'setSort',
        keys: [{ col_index: col(column), direction }],
        labels_on,
    });

    switch (my_scenario.kind) {
        case 'open':
            break;
        case 'sort': {
            const my_s = my_scenario;
            my_result.sort = await time_action(
                () => send_sort(my_s.column, my_s.direction ?? 'asc',
                    my_s.labels_on ?? true),
                my_m => my_m.type === 'sortApplied'
            );
            break;
        }
        case 'sorted_page': {
            const my_s = my_scenario;
            my_result.sort = await time_action(
                () => send_sort(my_s.column, 'asc', true),
                my_m => my_m.type === 'sortApplied'
            );
            my_monitor.start();
            const my_t = performance.now();
            const my_page = await request_rows(
                webview, Math.floor(my_meta.nobs / 2), my_page_size
            );
            my_result.page = {
                ms: round(my_page.at - my_t),
                reply_json_bytes: my_page.json_bytes,
                ...my_monitor.stop(),
            };
            break;
        }
        case 'scroll': {
            // Pages the viewport would fetch while scrolling, one at a
            // time, as the webview requests them.
            const the_ms: number[] = [];
            my_monitor.start();
            for (const my_start of page_starts(
                my_meta.nobs, my_page_size, SCROLL_PAGES
            )) {
                const my_t = performance.now();
                await request_rows(webview, my_start, my_page_size);
                the_ms.push(performance.now() - my_t);
            }
            my_result.scroll = {
                pages: the_ms.length,
                p50_ms: percentile(the_ms, 0.5),
                p95_ms: percentile(the_ms, 0.95),
                ...my_monitor.stop(),
            };
            break;
        }
        case 'scroll_during_sort': {
            // The user keeps scrolling while a sort computes: request a
            // page every frame until the sort lands, and record how long
            // each page took to arrive.
            const my_before = webview.posted.length;
            my_monitor.start();
            const my_t0_sort = performance.now();
            send_sort(my_scenario.column, 'asc', true);
            const my_sorted = webview.wait_for_after(
                my_before, my_m => my_m.type === 'sortApplied'
            );
            let my_sort_done = false;
            void my_sorted.then(() => { my_sort_done = true; });
            const the_pending: Promise<number>[] = [];
            const the_starts = page_starts(my_meta.nobs, my_page_size, 1000);
            let my_i = 0;
            while (!my_sort_done) {
                const my_t = performance.now();
                the_pending.push(
                    request_rows(webview, the_starts[my_i++ % 1000],
                        my_page_size)
                        .then(my_p => my_p.at - my_t)
                );
                await new Promise(resolve =>
                    setTimeout(resolve, SCROLL_DURING_SORT_INTERVAL_MS));
            }
            const my_sort_posted = await my_sorted;
            // Today the host silently drops a page read that was in
            // flight when the sort bumped its generation (the webview
            // re-requests after sortApplied). Give stragglers a grace
            // period, then count the rest as dropped.
            const my_grace = new Promise<undefined>(resolve =>
                setTimeout(() => resolve(undefined), DROPPED_GRACE_MS));
            const the_settled = await Promise.all(
                the_pending.map(my_p => Promise.race([my_p, my_grace]))
            );
            const the_latencies = the_settled.filter(
                (my_v): my_v is number => my_v !== undefined
            );
            my_result.scroll_during_sort = {
                sort_ms: round(my_sort_posted.at - my_t0_sort),
                pages_requested: the_settled.length,
                pages_dropped: the_settled.length - the_latencies.length,
                page_p50_ms: percentile(the_latencies, 0.5),
                page_max_ms: percentile(the_latencies, 1),
                ...my_monitor.stop(),
            };
            break;
        }
        case 'restore': {
            // The restore runs after the paint-first open above; time
            // from opening to restoreSettled, and watch the event loop
            // from the first page to the settle.
            my_monitor.start();
            const my_settled = await webview.wait_for(
                my_m => my_m.type === 'restoreSettled'
            );
            my_result.restore = {
                ms: round(my_settled.at - my_t0),
                ...my_monitor.stop(),
            };
            break;
        }
        case 'filter': {
            const my_index = col(my_scenario.column);
            const my_predicate = my_scenario.predicate;
            my_result.filter = await time_action(
                () => webview.send({
                    type: 'setFilters',
                    entries: [{
                        id: 'f1',
                        col_index: my_index,
                        predicate: my_predicate,
                        enabled: true,
                        include_missing: false,
                    }],
                    labels_on: true,
                }),
                my_m => my_m.type === 'filterApplied'
            );
            const my_applied = webview.posted.find(
                my_p => my_p.msg.type === 'filterApplied'
            );
            if (my_applied?.msg.type === 'filterApplied') {
                my_result.survivors = my_applied.msg.nobs_filtered;
            }
            break;
        }
        case 'histogram': {
            const my_index = col(my_scenario.column);
            my_result.histogram = await time_action(
                () => webview.send({
                    type: 'requestHistogram', col_index: my_index,
                }),
                my_m => my_m.type === 'histogramData'
            );
            break;
        }
        case 'copy': {
            // Copy has no reply message; the vscode stub's clipboard
            // write calls this hook when the host finishes.
            const my_index = col(my_scenario.column);
            const my_copied = new Promise<string>(resolve => {
                (globalThis as { __bench_clipboard?: (t: string) => void })
                    .__bench_clipboard = resolve;
            });
            my_monitor.start();
            const my_t = performance.now();
            webview.send({
                type: 'copyColumn', col_index: my_index,
                show_labels: true, show_formats: true,
            });
            const my_text = await my_copied;
            my_result.copy = {
                ms: round(performance.now() - my_t),
                clipboard_bytes: my_text.length,
                ...my_monitor.stop(),
            };
            break;
        }
    }

    const my_mem = process.memoryUsage();
    my_result.rss_mib = Math.round(my_mem.rss / (1 << 20));
    my_result.peak_rss_mib = peak_rss_mib();
    my_result.heap_used_mib = Math.round(my_mem.heapUsed / (1 << 20));
    process.stdout.write(`RESULT ${JSON.stringify(my_result)}\n`);
    process.exit(0);
}

main().catch(my_err => {
    console.error(my_err);
    process.exit(1);
});

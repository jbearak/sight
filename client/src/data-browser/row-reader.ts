/**
 * Where the data browser's page reads run.
 *
 * {@link WorkerPageReader} keeps one row reader thread
 * (row-reader-worker.ts) per open file, started when the panel opens it,
 * so page reads never run on the extension host's event loop: a cold
 * disk, a strL index build or a long page delays only the grid, not the
 * editor. {@link InProcessPageReader} reads on the panel's own source,
 * for tests and for hosts where the reader bundle is missing.
 *
 * See "Row reader thread" in specs/2026-10-30-data-browser-redesign.md.
 */

import { Worker } from 'worker_threads';
import { format_page } from './cell-format.js';
import {
    ComputeAbortError,
    FileChangedError,
    wait_for_exits,
} from './compute-runner.js';
import type {
    FileIdentity,
    RowReaderReply,
    RowReaderRequest,
    RowReaderWorkerData,
} from './compute-protocol.js';
import type { DtaSource, PageRows } from './dta-source.js';
import type { CellValue } from './types.js';

/** A cell given by file row and column. */
export interface CellAddress {
    row: number;
    col: number;
}

/** Cells that complete a page sent with some cells `pending`. */
export interface CellPatch {
    /** Variable indices of the cells, in each row's order. */
    columns: number[];
    rows: CellValue[][];
}

export interface PageRead {
    /** The page, for the grid; some strL cells may be `pending`. */
    rows: CellValue[][];
    /** The pending cells, when there are any. */
    rest: Promise<CellPatch> | null;
}

export interface PageReader {
    /** Cells of columns `[col_start, col_end)` for `rows`, for the grid. */
    read_page(
        rows: PageRows,
        col_start: number,
        col_end: number
    ): Promise<PageRead>;
    /** Whole text of strLs a page sent as previews. */
    read_full_text(cells: CellAddress[]): Promise<string[]>;
    /** Stop reading; true when no read can still touch the descriptor. */
    dispose(): Promise<boolean>;
}

/** Reads on the caller's thread, from the panel's source. */
export class InProcessPageReader implements PageReader {
    constructor(private readonly source: DtaSource) {}

    async read_page(
        rows: PageRows,
        col_start: number,
        col_end: number
    ): Promise<PageRead> {
        const the_columns = this.source.column_range(col_start, col_end);
        return {
            rows: format_page(
                this.source,
                this.source.read_page(rows, the_columns),
                the_columns
            ),
            rest: null,
        };
    }

    async read_full_text(cells: CellAddress[]): Promise<string[]> {
        return this.source.read_full_text(cells);
    }

    async dispose(): Promise<boolean> {
        return true;
    }
}

type OkReply = RowReaderReply & { ok: true };

interface PendingRead {
    resolve: (reply: OkReply) => void;
    reject: (error: unknown) => void;
    /** Set once a page arrived with `more`: where its cells go. */
    rest?: {
        resolve: (patch: CellPatch) => void;
        reject: (error: unknown) => void;
    };
}

export interface WorkerPageReaderOptions {
    /** Absolute path of the bundled row-reader entry point. */
    script_path: string;
    /** The descriptor the panel opened, and its identity at open. */
    fd: number;
    identity: FileIdentity;
}

/** Reads in one long-lived worker thread. */
export class WorkerPageReader implements PageReader {
    private worker: Worker | null = null;
    private readonly pending = new Map<number, PendingRead>();
    private next_id = 1;
    private exit: Promise<number> | null = null;
    private disposed = false;

    constructor(private readonly options: WorkerPageReaderOptions) {
        // Start at open, so the first page does not wait for the spawn.
        this.ensure_worker();
    }

    async read_page(
        rows: PageRows,
        col_start: number,
        col_end: number
    ): Promise<PageRead> {
        let my_rest: Promise<CellPatch> | null = null;
        const my_reply = await this.request(
            { kind: 'page', rows, col_start, col_end },
            my_pending => {
                my_rest = new Promise<CellPatch>((resolve, reject) => {
                    my_pending.rest = { resolve, reject };
                });
                // A caller that stops waiting must not see a rejection
                // as unhandled.
                my_rest.catch(() => undefined);
            }
        );
        return {
            rows: my_reply.kind === 'page' ? my_reply.rows : [],
            rest: my_rest,
        };
    }

    read_full_text(cells: CellAddress[]): Promise<string[]> {
        return this.request({ kind: 'fullText', cells })
            .then(my_reply =>
                my_reply.kind === 'fullText' ? my_reply.texts : []
            );
    }

    /**
     * Send `body`; resolves with the first reply. `on_more` runs if that
     * reply says a second (`cells`) follows, before the caller resumes.
     */
    private request(
        body: DistributiveOmit<RowReaderRequest, 'id'>,
        on_more?: (pending: PendingRead) => void
    ): Promise<OkReply> {
        if (this.disposed) return Promise.reject(new ComputeAbortError());
        let my_worker: Worker;
        try {
            my_worker = this.ensure_worker();
        } catch (my_err) {
            return Promise.reject(my_err);
        }
        const my_id = this.next_id++;
        return new Promise((resolve, reject) => {
            const my_pending: PendingRead = {
                resolve: my_reply => {
                    if (my_reply.kind === 'page' && my_reply.more) {
                        on_more?.(my_pending);
                    }
                    resolve(my_reply);
                },
                reject,
            };
            this.pending.set(my_id, my_pending);
            my_worker.postMessage({ ...body, id: my_id });
        });
    }

    /** The running thread; a new one after a crash. */
    private ensure_worker(): Worker {
        if (this.worker) return this.worker;
        const my_data: RowReaderWorkerData = {
            fd: this.options.fd,
            identity: this.options.identity,
        };
        const my_worker = new Worker(this.options.script_path, {
            workerData: my_data,
        });
        this.worker = my_worker;
        this.exit = new Promise(resolve => my_worker.once('exit', resolve));
        my_worker.on('message', (my_reply: RowReaderReply) => {
            const my_pending = this.pending.get(my_reply.id);
            if (!my_pending) return;
            const my_error = my_reply.ok
                ? null
                : my_reply.reason === 'changed'
                    ? new FileChangedError('changed')
                    : new Error(my_reply.message);
            if (my_pending.rest) {
                // The second part of a page.
                this.pending.delete(my_reply.id);
                if (my_reply.ok && my_reply.kind === 'cells') {
                    my_pending.rest.resolve({
                        columns: my_reply.columns,
                        rows: my_reply.rows,
                    });
                } else {
                    my_pending.rest.reject(
                        my_error ?? new Error('Unexpected reader reply')
                    );
                }
                return;
            }
            if (my_reply.ok) {
                // A page with more to come stays pending for its cells.
                if (!(my_reply.kind === 'page' && my_reply.more)) {
                    this.pending.delete(my_reply.id);
                }
                my_pending.resolve(my_reply);
            } else {
                this.pending.delete(my_reply.id);
                my_pending.reject(my_error);
            }
        });
        const fail_all = (my_error: unknown) => {
            if (this.worker === my_worker) this.worker = null;
            for (const my_pending of this.pending.values()) {
                if (my_pending.rest) my_pending.rest.reject(my_error);
                else my_pending.reject(my_error);
            }
            this.pending.clear();
        };
        my_worker.once('error', my_err => fail_all(my_err));
        my_worker.once('exit', my_code => {
            fail_all(this.disposed
                ? new ComputeAbortError()
                : new Error(`The data browser reader exited (code ${my_code})`));
        });
        return my_worker;
    }

    async dispose(): Promise<boolean> {
        if (this.disposed) return this.worker === null;
        this.disposed = true;
        const my_worker = this.worker;
        const my_exit = this.exit;
        if (!my_worker || !my_exit) return true;
        void my_worker.terminate();
        // A read stuck on a slow disk may not stop; don't hang close.
        const my_exited = await wait_for_exits([my_exit]);
        if (my_exited) this.worker = null;
        return my_exited;
    }
}

/** `Omit` over each member of a union. */
type DistributiveOmit<T, K extends keyof T> =
    T extends unknown ? Omit<T, K> : never;

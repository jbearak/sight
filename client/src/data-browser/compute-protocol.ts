/**
 * Messages between the host and the data browser's worker threads: the
 * step workers (compute-worker.ts, driven by {@link WorkerComputeRunner})
 * and the row reader (row-reader-worker.ts, driven by row-reader.ts).
 * Kept free of `vscode` and of `worker_threads` so both sides and the
 * tests can import it.
 *
 * Every thread reads the descriptor the host opened (worker threads
 * share the process's descriptor table), so a thread always reads the
 * file the host opened, even after a vview temp file is unlinked or a
 * file is replaced at its path. What a descriptor cannot rule out is a
 * file rewritten in place; each thread compares `fstat` of the
 * descriptor with the identity the host recorded at open.
 */

import type { ComputeJob, ComputeResult } from './compute-jobs.js';
import type { PageRows } from './dta-source.js';
import type { CellValue } from './types.js';

/** What identifies the file the host opened, from `fs.fstatSync`. */
export interface FileIdentity {
    ino: number;
    size: number;
    mtime_ms: number;
}

/** The fields of `fs.Stats` an identity is built from. */
interface StatLike {
    ino: number;
    size: number;
    mtimeMs: number;
}

export function file_identity(stat: StatLike): FileIdentity {
    return { ino: stat.ino, size: stat.size, mtime_ms: stat.mtimeMs };
}

/**
 * Whether `stat` describes the file `identity` was taken from. Best
 * effort: a same-size rewrite within the filesystem's mtime granularity
 * is not detected.
 */
export function same_file_identity(
    stat: StatLike,
    identity: FileIdentity
): boolean {
    return stat.ino === identity.ino
        && stat.size === identity.size
        && stat.mtimeMs === identity.mtime_ms;
}

/** `workerData` of a step worker. */
export interface ComputeWorkerData {
    /** The descriptor the host opened the dataset on. */
    fd: number;
    identity: FileIdentity;
    job: ComputeJob;
}

/** The single message a step worker posts before it exits. */
export type ComputeWorkerReply =
    | { ok: true; result: ComputeResult }
    | { ok: false; reason: 'changed' | 'missing' }
    | { ok: false; reason: 'failed'; message: string };

/** `workerData` of the row reader. */
export interface RowReaderWorkerData {
    fd: number;
    identity: FileIdentity;
}

/** A request to the row reader; `id` matches the reply. */
export type RowReaderRequest =
    | {
        id: number;
        kind: 'page';
        rows: PageRows;
        col_start: number;
        col_end: number;
    }
    | {
        /** Whole values of strLs a page sent as previews (for copying). */
        id: number;
        kind: 'fullText';
        cells: { row: number; col: number }[];
    };

/**
 * Replies to the row reader's requests. A page whose strLs would wait
 * for the file's strL index (the first page that shows any) comes in
 * two: `page` with those cells `pending`, then `cells` with them. A
 * failure after the first part answers the second.
 */
export type RowReaderReply =
    | {
        id: number;
        ok: true;
        kind: 'page';
        rows: CellValue[][];
        /** A `cells` reply for this id follows. */
        more: boolean;
    }
    | {
        id: number;
        ok: true;
        kind: 'cells';
        /** Variable indices of the cells, in each row's order. */
        columns: number[];
        rows: CellValue[][];
    }
    | { id: number; ok: true; kind: 'fullText'; texts: string[] }
    | { id: number; ok: false; reason: 'changed' }
    | { id: number; ok: false; reason: 'failed'; message: string };

/**
 * Messages between the host's {@link WorkerComputeRunner} and a step
 * worker (compute-worker.ts). Kept free of `vscode` and of
 * `worker_threads` so both sides and the tests can import it.
 */

import type { ComputeJob, ComputeResult } from './compute-jobs.js';

/** What identifies the file the host opened, from `fs.statSync`. */
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
    path: string;
    identity: FileIdentity;
    job: ComputeJob;
}

/** The single message a step worker posts before it exits. */
export type ComputeWorkerReply =
    | { ok: true; result: ComputeResult }
    | { ok: false; reason: 'changed' | 'missing' }
    | { ok: false; reason: 'failed'; message: string };

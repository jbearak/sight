/**
 * Where the data browser's full-column jobs run.
 *
 * {@link WorkerComputeRunner} runs each job in a short-lived step worker
 * (compute-worker.ts) so the extension host's event loop never blocks on
 * a sort, filter, histogram or copy, and so any job can be stopped at
 * once with `terminate()` (a catastrophic regex has no other way out).
 * Workers come from two pools, so neither kind of work can starve the
 * other:
 *
 * - `transform` (2 slots): sort and filter computes and saved-state
 *   restores, the work that changes the row order;
 * - `action` (2 slots): copies and histogram brushes.
 *
 * A third job of a kind waits for a slot. {@link InProcessComputeRunner}
 * runs the same jobs on the panel's own reader, for tests and for hosts
 * where the worker bundle is missing.
 *
 * See "Step workers" in specs/2026-10-30-data-browser-redesign.md.
 */

import { Worker } from 'worker_threads';
import {
    run_compute_job,
    type ColumnSource,
    type ComputeJob,
    type ComputeResult,
} from './compute-jobs.js';
import type {
    ComputeWorkerData,
    ComputeWorkerReply,
    FileIdentity,
} from './compute-protocol.js';

export type ComputePool = 'transform' | 'action';

const POOL_SLOTS: Record<ComputePool, number> = {
    transform: 2,
    action: 2,
};

/** A job running longer than this is stopped (a regex that never ends). */
export const COMPUTE_DEADLINE_MS = 10 * 60 * 1000;

/** How long dispose waits for a terminated worker to exit. */
const TERMINATE_WAIT_MS = 5000;

/**
 * A job stopped by its caller. `name` is `AbortError`, as dta-parser's
 * aborted reads are, so the panel's `is_abort_error` treats both alike.
 */
export class ComputeAbortError extends Error {
    constructor() {
        super('The computation was cancelled');
        this.name = 'AbortError';
    }
}

/** A job that ran past {@link COMPUTE_DEADLINE_MS}. */
export class ComputeDeadlineError extends Error {
    constructor() {
        super('The computation was stopped after 10 minutes');
        this.name = 'ComputeDeadlineError';
    }
}

/** The file on disk is no longer the one the panel opened. */
export class FileChangedError extends Error {
    readonly reason: 'changed' | 'missing';

    constructor(reason: 'changed' | 'missing') {
        super(reason === 'changed'
            ? 'The file changed on disk'
            : 'The file was deleted or moved');
        this.name = 'FileChangedError';
        this.reason = reason;
    }
}

export interface ComputeRunner {
    /** Run `job` in `pool`; aborting `signal` stops it and rejects with
     *  {@link ComputeAbortError}. */
    run(
        job: ComputeJob,
        pool: ComputePool,
        signal?: AbortSignal
    ): Promise<ComputeResult>;
    /** Stop every job (pending ones reject with ComputeAbortError) and
     *  wait, bounded, for running workers to exit. Resolves true when
     *  every worker exited, so the descriptor they read can be closed. */
    dispose(): Promise<boolean>;
}

/** Runs jobs on the caller's thread, against the panel's reader. */
export class InProcessComputeRunner implements ComputeRunner {
    constructor(private readonly source: ColumnSource) {}

    async run(
        job: ComputeJob,
        _pool: ComputePool,
        signal?: AbortSignal
    ): Promise<ComputeResult> {
        if (signal?.aborted) throw new ComputeAbortError();
        const my_result = run_compute_job(job, this.source);
        if (signal?.aborted) throw new ComputeAbortError();
        return my_result;
    }

    async dispose(): Promise<boolean> {
        /* nothing runs outside the caller */
        return true;
    }
}

interface PendingJob {
    job: ComputeJob;
    signal: AbortSignal | undefined;
    resolve: (result: ComputeResult) => void;
    reject: (error: unknown) => void;
}

export interface WorkerComputeRunnerOptions {
    /** Absolute path of the bundled compute-worker entry point. */
    script_path: string;
    /** The descriptor the panel opened the dataset on, and its identity
     *  at open. The panel keeps it open until every worker has exited. */
    fd: number;
    identity: FileIdentity;
    deadline_ms?: number;
    /** Called as each worker is spawned (tests count them). */
    on_spawn?: () => void;
}

/** Runs each job in its own worker thread. */
export class WorkerComputeRunner implements ComputeRunner {
    private readonly queues: Record<ComputePool, PendingJob[]> = {
        transform: [],
        action: [],
    };
    // Each running worker with the function that stops it as aborted.
    private readonly running: Record<ComputePool, Map<Worker, () => void>> = {
        transform: new Map(),
        action: new Map(),
    };
    private readonly exits = new Set<Promise<number>>();
    private disposed = false;

    constructor(private readonly options: WorkerComputeRunnerOptions) {}

    run(
        job: ComputeJob,
        pool: ComputePool,
        signal?: AbortSignal
    ): Promise<ComputeResult> {
        if (this.disposed || signal?.aborted) {
            return Promise.reject(new ComputeAbortError());
        }
        return new Promise<ComputeResult>((resolve, reject) => {
            const my_pending: PendingJob = { job, signal, resolve, reject };
            this.queues[pool].push(my_pending);
            // A job aborted while it waits for a slot leaves the queue.
            signal?.addEventListener('abort', () => {
                const my_queue = this.queues[pool];
                const my_index = my_queue.indexOf(my_pending);
                if (my_index >= 0) {
                    my_queue.splice(my_index, 1);
                    reject(new ComputeAbortError());
                }
            }, { once: true });
            this.pump(pool);
        });
    }

    private pump(pool: ComputePool): void {
        while (
            !this.disposed
            && this.running[pool].size < POOL_SLOTS[pool]
            && this.queues[pool].length > 0
        ) {
            const my_pending = this.queues[pool].shift();
            if (my_pending) this.start(pool, my_pending);
        }
    }

    private start(pool: ComputePool, pending: PendingJob): void {
        const my_data: ComputeWorkerData = {
            fd: this.options.fd,
            identity: this.options.identity,
            job: pending.job,
        };
        this.options.on_spawn?.();
        let my_worker: Worker;
        try {
            my_worker = new Worker(this.options.script_path, {
                workerData: my_data,
            });
        } catch (my_err) {
            pending.reject(my_err);
            return;
        }

        let my_settled = false;
        const settle = (outcome: () => void) => {
            if (my_settled) return;
            my_settled = true;
            clearTimeout(my_deadline);
            pending.signal?.removeEventListener('abort', on_abort);
            this.running[pool].delete(my_worker);
            outcome();
            this.pump(pool);
        };
        const stop = () => {
            const my_exit = my_worker.terminate();
            this.exits.add(my_exit);
            void my_exit.finally(() => this.exits.delete(my_exit));
        };
        const on_abort = () => {
            settle(() => pending.reject(new ComputeAbortError()));
            stop();
        };
        const my_deadline = setTimeout(() => {
            settle(() => pending.reject(new ComputeDeadlineError()));
            stop();
        }, this.options.deadline_ms ?? COMPUTE_DEADLINE_MS);

        this.running[pool].set(my_worker, on_abort);
        pending.signal?.addEventListener('abort', on_abort, { once: true });
        my_worker.once('message', (my_reply: ComputeWorkerReply) => {
            settle(() => {
                if (my_reply.ok) {
                    pending.resolve(my_reply.result);
                } else if (my_reply.reason === 'failed') {
                    pending.reject(new Error(my_reply.message));
                } else {
                    pending.reject(new FileChangedError(my_reply.reason));
                }
            });
        });
        my_worker.once('error', my_err => {
            settle(() => pending.reject(my_err));
        });
        my_worker.once('exit', my_code => {
            settle(() => pending.reject(new Error(
                `The data browser worker exited (code ${my_code})`
            )));
        });
    }

    async dispose(): Promise<boolean> {
        if (this.disposed) return this.exits.size === 0;
        this.disposed = true;
        for (const my_pool of ['transform', 'action'] as ComputePool[]) {
            for (const my_pending of this.queues[my_pool].splice(0)) {
                my_pending.reject(new ComputeAbortError());
            }
            for (const my_abort of [...this.running[my_pool].values()]) {
                my_abort();
            }
        }
        // A worker stuck in a native read may not exit; don't hang the
        // panel's close on it.
        return wait_for_exits([...this.exits], TERMINATE_WAIT_MS);
    }
}

/**
 * Wait up to `wait_ms` for `exits`; true when all settled in time.
 * Shared with the row reader.
 */
export async function wait_for_exits(
    exits: Promise<unknown>[],
    wait_ms: number = TERMINATE_WAIT_MS
): Promise<boolean> {
    let my_timer: ReturnType<typeof setTimeout> | undefined;
    const my_all = Promise.allSettled(exits).then(() => true);
    const my_timeout = new Promise<boolean>(resolve => {
        my_timer = setTimeout(() => resolve(false), wait_ms);
    });
    const my_done = await Promise.race([my_all, my_timeout]);
    clearTimeout(my_timer);
    return my_done;
}

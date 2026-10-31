/**
 * Step worker for the data browser: runs one full-column job off the
 * extension host's event loop, then exits.
 *
 * Spawned by {@link WorkerComputeRunner} (compute-runner.ts) with the
 * job, the descriptor the host opened the dataset on and the identity
 * (inode, size, mtime) the host recorded then. The worker reads that
 * descriptor, so it reads the file the host opened even if the path now
 * names another file. If the file was rewritten in place since, the job
 * fails with "The file changed on disk" rather than computing an order
 * for different data.
 *
 * Bundled as its own CommonJS entry point (dist/data-browser-worker.js).
 */

import * as fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { run_compute_job, type ComputeResult } from './compute-jobs.js';
import {
    same_file_identity,
    type ComputeWorkerData,
    type ComputeWorkerReply,
} from './compute-protocol.js';
import { DtaSource } from './dta-source.js';

function transfer_list(result: ComputeResult): ArrayBuffer[] {
    if (result.kind !== 'order') return [];
    const the_buffers: ArrayBuffer[] = [];
    for (const my_array of [result.permutation, result.filtered_indices]) {
        if (my_array && my_array.buffer instanceof ArrayBuffer) {
            the_buffers.push(my_array.buffer);
        }
    }
    return the_buffers;
}

function main(): void {
    const my_data = workerData as ComputeWorkerData;
    let my_source: DtaSource | null = null;
    let my_reply: ComputeWorkerReply;
    let the_transfer: ArrayBuffer[] = [];
    const unchanged = () =>
        same_file_identity(fs.fstatSync(my_data.fd), my_data.identity);
    try {
        if (!unchanged()) {
            my_reply = { ok: false, reason: 'changed' };
        } else {
            my_source = DtaSource.open(my_data.fd);
            const my_result = run_compute_job(my_data.job, my_source);
            // A rewrite during the job may have mixed old and new data.
            if (!unchanged()) {
                my_reply = { ok: false, reason: 'changed' };
            } else {
                the_transfer = transfer_list(my_result);
                my_reply = { ok: true, result: my_result };
            }
        }
    } catch (my_err) {
        // A read error from a file rewritten under the job is the change.
        let my_changed = false;
        try {
            my_changed = !unchanged();
        } catch {
            /* report the original error */
        }
        my_reply = my_changed
            ? { ok: false, reason: 'changed' }
            : { ok: false, reason: 'failed', message: String(my_err) };
    } finally {
        try {
            // The descriptor is the host's; this releases the reader only.
            my_source?.close();
        } catch {
            /* the reply below is what matters */
        }
    }
    parentPort?.postMessage(my_reply, the_transfer);
}

main();

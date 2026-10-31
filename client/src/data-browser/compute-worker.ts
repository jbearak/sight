/**
 * Step worker for the data browser: runs one full-column job off the
 * extension host's event loop, then exits.
 *
 * Spawned by {@link WorkerComputeRunner} (compute-runner.ts) with the
 * job, the dataset path and the identity (inode, size, mtime) the host
 * recorded when it opened the file. dta-parser 0.6 opens by path only,
 * so the worker opens the file itself; if the path no longer names the
 * file the host opened, the job fails with "The file changed on disk"
 * rather than computing an order for different data.
 *
 * Bundled as its own CommonJS entry point (dist/data-browser-worker.js).
 */

import * as fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { DtaFile } from '@jbearak/dta-parser/node';
import { run_compute_job, type ComputeResult } from './compute-jobs.js';
import {
    same_file_identity,
    type ComputeWorkerData,
    type ComputeWorkerReply,
} from './compute-protocol.js';

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

async function main(): Promise<void> {
    const my_data = workerData as ComputeWorkerData;
    let my_file: DtaFile | null = null;
    let my_reply: ComputeWorkerReply;
    let the_transfer: ArrayBuffer[] = [];
    try {
        my_file = await DtaFile.open(my_data.path);
        const my_stat = fs.statSync(my_data.path);
        if (!same_file_identity(my_stat, my_data.identity)) {
            my_reply = { ok: false, reason: 'changed' };
        } else {
            const my_result = await run_compute_job(my_data.job, my_file);
            the_transfer = transfer_list(my_result);
            my_reply = { ok: true, result: my_result };
        }
    } catch (my_err) {
        const my_code = (my_err as NodeJS.ErrnoException | null)?.code;
        my_reply = my_code === 'ENOENT'
            ? { ok: false, reason: 'missing' }
            : { ok: false, reason: 'failed', message: String(my_err) };
    } finally {
        try {
            my_file?.close();
        } catch {
            /* the reply below is what matters */
        }
    }
    parentPort?.postMessage(my_reply, the_transfer);
}

void main();

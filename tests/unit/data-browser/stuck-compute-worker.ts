/**
 * Test-only step worker for compute-runner.test.ts.
 *
 * A job whose first filter entry has id {@link STUCK_ENTRY_ID} spins
 * forever without yielding, like a regex stuck in backtracking, so only
 * `terminate()` can stop it. A busy loop never finishes on any engine,
 * where a slow regex finishes once the engine gets fast enough. Every
 * other job runs in the real worker (compute-worker.ts).
 */

import { workerData } from 'worker_threads';
import type { ComputeWorkerData } from '../../../client/src/data-browser/compute-protocol';

export const STUCK_ENTRY_ID = 'never-finishes';

const my_data = workerData as ComputeWorkerData | null;
const my_job = my_data?.job;
const is_stuck = my_job?.kind === 'order'
    && my_job.filter?.entries[0]?.id === STUCK_ENTRY_ID;

if (is_stuck) {
    for (;;) {
        /* never yields; only terminate() ends this worker */
    }
} else if (my_data) {
    await import('../../../client/src/data-browser/compute-worker');
}

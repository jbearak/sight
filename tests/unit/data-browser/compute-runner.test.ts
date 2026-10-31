import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { make_fixture } from '../../../scripts/bench-data-browser/make-fixtures';
import {
    ComputeDeadlineError,
    FileChangedError,
    InProcessComputeRunner,
    WorkerComputeRunner,
} from '../../../client/src/data-browser/compute-runner';
import { file_identity } from '../../../client/src/data-browser/compute-protocol';
import { DtaSource } from '../../../client/src/data-browser/dta-source';
import type {
    ComputeJob,
    OrderResult,
} from '../../../client/src/data-browser/compute-jobs';

// The step worker runs from source here: Bun loads TypeScript workers.
const WORKER_PATH = path.resolve(
    import.meta.dir,
    '../../../client/src/data-browser/compute-worker.ts'
);

// A district regex that backtracks exponentially on every row (the
// benchmark's catastrophic case): it never finishes on 100k rows.
const STUCK_FILTER: ComputeJob = {
    kind: 'order',
    sort: null,
    filter: {
        entries: [{
            id: 'f1',
            col_index: 8,
            predicate: {
                kind: 'strRegex',
                pattern: '^([a-z_]+\\d?)+!$',
                case_sensitive: true,
            },
            enabled: true,
            include_missing: false,
        }],
        labels_on_when_filtered: true,
    },
};

const SORT_INCOME: ComputeJob = {
    kind: 'order',
    sort: {
        keys: [{ col_index: 3, direction: 'desc' }],
        labels_on_when_sorted: true,
    },
    filter: null,
};

let the_dir = '';
let the_path = '';
// The descriptor every worker reads, as the panel opens it.
let the_fd = -1;

beforeAll(() => {
    the_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-compute-'));
    the_path = make_fixture(the_dir, 'small', 1);
    the_fd = fs.openSync(the_path, 'r');
});

afterAll(() => {
    fs.closeSync(the_fd);
    fs.rmSync(the_dir, { recursive: true, force: true });
});

function make_runner(deadline_ms?: number): WorkerComputeRunner {
    return new WorkerComputeRunner({
        script_path: WORKER_PATH,
        fd: the_fd,
        identity: file_identity(fs.fstatSync(the_fd)),
        deadline_ms,
    });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (my_err) {
        return my_err;
    }
    throw new Error('expected a rejection');
}

describe('WorkerComputeRunner', () => {
    it('reads the descriptor, so an unlinked file still computes', async () => {
        // vview temp files are unlinked right after the panel opens them.
        const my_copy = path.join(the_dir, 'unlinked.dta');
        fs.copyFileSync(the_path, my_copy);
        const my_fd = fs.openSync(my_copy, 'r');
        fs.unlinkSync(my_copy);
        try {
            const my_runner = new WorkerComputeRunner({
                script_path: WORKER_PATH,
                fd: my_fd,
                identity: file_identity(fs.fstatSync(my_fd)),
            });
            const my_result = await my_runner.run(
                SORT_INCOME,
                'transform'
            ) as OrderResult;
            expect(my_result.permutation?.length).toBeGreaterThan(0);
            await my_runner.dispose();
        } finally {
            fs.closeSync(my_fd);
        }
    });

    it('computes the same order in a worker as in-process', async () => {
        const my_file = DtaSource.open(the_fd);
        try {
            expect(my_file.variables[3].name).toBe('income');
            expect(my_file.variables[8].name).toBe('district');
            const my_expected = await new InProcessComputeRunner(my_file)
                .run(SORT_INCOME, 'transform') as OrderResult;
            const my_runner = make_runner();
            const my_actual = await my_runner.run(
                SORT_INCOME,
                'transform'
            ) as OrderResult;
            await my_runner.dispose();
            expect(my_actual.permutation).toEqual(
                my_expected.permutation
            );
            expect(my_actual.permutation?.length).toBe(my_file.nobs);
        } finally {
            my_file.close();
        }
    });

    it('stops a stuck regex at once on abort and keeps working', async () => {
        const my_runner = make_runner();
        const my_abort = new AbortController();
        const my_stuck = my_runner.run(
            STUCK_FILTER,
            'transform',
            my_abort.signal
        );
        await new Promise(resolve => setTimeout(resolve, 300));
        const my_started_ms = performance.now();
        my_abort.abort();
        const my_err = await rejection(my_stuck);
        expect((my_err as Error).name).toBe('AbortError');
        expect(performance.now() - my_started_ms).toBeLessThan(250);

        // The slot is free again and the runner still computes.
        const my_result = await my_runner.run(
            SORT_INCOME,
            'transform'
        ) as OrderResult;
        expect(my_result.permutation).not.toBeNull();
        await my_runner.dispose();
    });

    it('stops a job at its deadline', async () => {
        const my_runner = make_runner(300);
        const my_err = await rejection(
            my_runner.run(STUCK_FILTER, 'transform')
        );
        expect(my_err).toBeInstanceOf(ComputeDeadlineError);
        await my_runner.dispose();
    });

    it('refuses a file that no longer matches the open one', async () => {
        const my_runner = new WorkerComputeRunner({
            script_path: WORKER_PATH,
            fd: the_fd,
            identity: {
                ...file_identity(fs.fstatSync(the_fd)),
                size: 1,
            },
        });
        const my_err = await rejection(
            my_runner.run(SORT_INCOME, 'transform')
        );
        expect(my_err).toBeInstanceOf(FileChangedError);
        expect((my_err as FileChangedError).reason).toBe('changed');
        await my_runner.dispose();
    });

    it('runs at most two jobs per pool; a third waits', async () => {
        let my_spawns = 0;
        const my_runner = new WorkerComputeRunner({
            script_path: WORKER_PATH,
            fd: the_fd,
            identity: file_identity(fs.fstatSync(the_fd)),
            on_spawn: () => { my_spawns++; },
        });
        const my_aborts = [0, 1, 2].map(() => new AbortController());
        const the_jobs = my_aborts.map(my_abort => my_runner.run(
            STUCK_FILTER,
            'transform',
            my_abort.signal
        ).catch(my_err => my_err));
        // A copy is in the other pool, so it is not held up.
        const my_copy = await my_runner.run({
            kind: 'copy',
            col_index: 0,
            show_labels: false,
            show_formats: false,
            order: null,
        }, 'action');
        expect(my_copy.kind).toBe('copy');
        expect(my_spawns).toBe(3);
        my_aborts[0].abort();
        await the_jobs[0];
        expect(my_spawns).toBe(4);
        await my_runner.dispose();
        const the_errors = await Promise.all(the_jobs);
        for (const my_err of the_errors) {
            expect((my_err as Error).name).toBe('AbortError');
        }
    });

    it('rejects running and queued jobs on dispose', async () => {
        const my_runner = make_runner();
        const the_jobs = [0, 1, 2].map(() => my_runner.run(
            STUCK_FILTER,
            'transform'
        ).catch(my_err => my_err));
        await new Promise(resolve => setTimeout(resolve, 100));
        // True: every worker exited, so the descriptor may be closed.
        expect(await my_runner.dispose()).toBe(true);
        for (const my_err of await Promise.all(the_jobs)) {
            expect((my_err as Error).name).toBe('AbortError');
        }
        const my_after = await rejection(
            my_runner.run(SORT_INCOME, 'transform')
        );
        expect((my_after as Error).name).toBe('AbortError');
    });
});

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { make_fixture } from '../../../scripts/bench-data-browser/make-fixtures';
import { FileChangedError } from '../../../client/src/data-browser/compute-runner';
import { file_identity } from '../../../client/src/data-browser/compute-protocol';
import {
    DtaSource,
    STRL_PREVIEW_BYTES,
} from '../../../client/src/data-browser/dta-source';
import {
    InProcessPageReader,
    WorkerPageReader,
    type PageRead,
} from '../../../client/src/data-browser/row-reader';
import type { CellValue } from '../../../client/src/data-browser/types';

/** A page with its follow-up cells, if any, filled in. */
async function complete(
    read: PageRead,
    col_start: number
): Promise<CellValue[][]> {
    if (!read.rest) return read.rows;
    const my_patch = await read.rest;
    return read.rows.map((my_row, i) => {
        const my_out = my_row.slice();
        my_patch.columns.forEach((my_col, j) => {
            my_out[my_col - col_start] = my_patch.rows[i][j];
        });
        return my_out;
    });
}

// The reader thread runs from source here: Bun loads TypeScript workers.
const READER_PATH = path.resolve(
    import.meta.dir,
    '../../../client/src/data-browser/row-reader-worker.ts'
);

let the_dir = '';
let the_path = '';
let the_fd = -1;
let the_source: DtaSource;

beforeAll(() => {
    the_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-reader-'));
    // 2,000 rows of the wide benchmark fixture: labelled numerics,
    // missing codes, dates, strN and strL columns (some strLs long).
    the_path = make_fixture(the_dir, 'wide', 0.002);
    the_fd = fs.openSync(the_path, 'r');
    the_source = DtaSource.open(the_fd);
});

afterAll(() => {
    the_source.close();
    fs.closeSync(the_fd);
    fs.rmSync(the_dir, { recursive: true, force: true });
});

function make_reader(fd = the_fd): WorkerPageReader {
    return new WorkerPageReader({
        script_path: READER_PATH,
        fd,
        identity: file_identity(fs.fstatSync(fd)),
    });
}

describe('WorkerPageReader', () => {
    it('reads the same pages in its thread as in-process', async () => {
        const my_local = new InProcessPageReader(the_source);
        const my_reader = make_reader();
        try {
            const my_window = { start: 1500, count: 131 };
            expect(await complete(await my_reader.read_page(my_window, 0, 500), 0))
                .toEqual((await my_local.read_page(my_window, 0, 500)).rows);
            // A sorted page: scattered rows, repeats, and a column window
            // that holds strN and strL columns.
            const my_sorted = { rows: [1999, 0, 7, 7, 1200, 3, 4, 5] };
            expect(await complete(await my_reader.read_page(my_sorted, 460, 500), 460))
                .toEqual((await my_local.read_page(my_sorted, 460, 500)).rows);
        } finally {
            expect(await my_reader.dispose()).toBe(true);
        }
    });

    it('sends long strLs as previews and reads them whole on request', async () => {
        const my_strl_cols = the_source.variables
            .map((my_v, i) => my_v.type === 'strL' ? i : -1)
            .filter(i => i >= 0);
        expect(my_strl_cols.length).toBeGreaterThan(0);
        const my_reader = make_reader();
        try {
            const my_first = my_strl_cols[0];
            // Only strL columns: nothing else to send first, so whole.
            const my_read = await my_reader.read_page(
                { start: 0, count: the_source.nobs },
                my_first,
                my_first + my_strl_cols.length
            );
            expect(my_read.rest).toBeNull();
            const my_page = my_read.rows;
            const the_previews = my_page.flatMap((my_row, i) =>
                my_row.flatMap((my_cell, j) => my_cell.truncated
                    ? [{ cell: my_cell, row: i, col: my_first + j }]
                    : [])
            );
            expect(the_previews.length).toBeGreaterThan(0);
            const the_texts = await my_reader.read_full_text(
                the_previews.map(my_p => ({
                    row: my_p.cell.file_row!,
                    col: my_p.col,
                }))
            );
            the_previews.forEach((my_p, i) => {
                const my_preview = my_p.cell.raw as string;
                expect(my_p.cell.file_row).toBe(my_p.row);
                expect(Buffer.byteLength(my_preview))
                    .toBeLessThanOrEqual(STRL_PREVIEW_BYTES);
                expect(Buffer.byteLength(the_texts[i]))
                    .toBe(my_p.cell.stored_bytes!);
                expect(the_texts[i].startsWith(my_preview)).toBe(true);
            });
        } finally {
            await my_reader.dispose();
        }
    });

    it('sends a first page before its strLs, then whole pages', async () => {
        const my_strl = the_source.variables.findIndex(
            my_v => my_v.type === 'strL'
        );
        const my_reader = make_reader();
        try {
            const my_first = await my_reader.read_page(
                { start: 0, count: 50 }, 0, 500
            );
            // The strLs wait for the file's strL index; the rest do not.
            expect(my_first.rest).not.toBeNull();
            expect(my_first.rows[0][my_strl]).toEqual({ raw: null, pending: true });
            expect(my_first.rows[0][0].pending).toBeUndefined();
            const my_patch = await my_first.rest!;
            expect(my_patch.columns).toContain(my_strl);
            expect(my_patch.rows).toHaveLength(50);
            // The index is built now: later pages come whole.
            const my_next = await my_reader.read_page(
                { start: 50, count: 50 }, 0, 500
            );
            expect(my_next.rest).toBeNull();
            expect(my_next.rows[0][my_strl].pending).toBeUndefined();
        } finally {
            await my_reader.dispose();
        }
    });

    it('reads a file unlinked after open (a vview temp file)', async () => {
        const my_copy = path.join(the_dir, 'unlinked.dta');
        fs.copyFileSync(the_path, my_copy);
        const my_fd = fs.openSync(my_copy, 'r');
        fs.unlinkSync(my_copy);
        const my_reader = make_reader(my_fd);
        try {
            const my_page = await my_reader.read_page(
                { start: 0, count: 3 },
                0,
                5
            );
            expect(my_page.rows).toHaveLength(3);
        } finally {
            await my_reader.dispose();
            fs.closeSync(my_fd);
        }
    });

    it('answers "changed" for a file rewritten in place', async () => {
        const my_copy = path.join(the_dir, 'rewritten.dta');
        fs.copyFileSync(the_path, my_copy);
        const my_fd = fs.openSync(my_copy, 'r');
        const my_reader = make_reader(my_fd);
        try {
            await my_reader.read_page({ start: 0, count: 1 }, 0, 5);
            fs.appendFileSync(my_copy, Buffer.alloc(16));
            let my_error: unknown = null;
            try {
                await my_reader.read_page({ start: 1, count: 1 }, 0, 5);
            } catch (my_err) {
                my_error = my_err;
            }
            expect(my_error).toBeInstanceOf(FileChangedError);
        } finally {
            await my_reader.dispose();
            fs.closeSync(my_fd);
        }
    });

    it('rejects reads after dispose', async () => {
        const my_reader = make_reader();
        expect(await my_reader.dispose()).toBe(true);
        let my_error: unknown = null;
        try {
            await my_reader.read_page({ start: 0, count: 1 }, 0, 1);
        } catch (my_err) {
            my_error = my_err;
        }
        expect((my_error as Error).name).toBe('AbortError');
    });
});

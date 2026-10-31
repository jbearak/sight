/**
 * Row reader thread for the data browser: answers page reads (and
 * whole-value reads for copying long strLs) off the extension host's
 * event loop, for as long as its panel has the file open.
 *
 * Spawned by {@link WorkerPageReader} (row-reader.ts) with the
 * descriptor the host opened the dataset on. It keeps one reader on it
 * and holds no order: the host maps display rows to file rows before
 * asking. Cells come back formatted for the grid, so the host only
 * forwards them. After every read it compares `fstat` of the descriptor
 * with the identity the host recorded at open, and answers `changed`
 * instead of data read from a file rewritten in place.
 *
 * The first page that shows a strL builds the file's strL index (about
 * 100 ms for a million strLs). So that the grid does not wait for it,
 * that page goes out in two parts: every other column first, with its
 * strL cells pending, then the strLs.
 *
 * Bundled as its own CommonJS entry point (dist/data-browser-reader.js).
 */

import * as fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import {
    same_file_identity,
    type RowReaderReply,
    type RowReaderRequest,
    type RowReaderWorkerData,
} from './compute-protocol.js';
import { format_page } from './cell-format.js';
import { DtaSource, PENDING_CELL, type PageRows } from './dta-source.js';

const my_data = workerData as RowReaderWorkerData;
let my_source: DtaSource | null = null;
let my_open_error: unknown = null;
try {
    my_source = DtaSource.open(my_data.fd);
} catch (my_err) {
    my_open_error = my_err;
}

function unchanged(): boolean {
    return same_file_identity(fs.fstatSync(my_data.fd), my_data.identity);
}

function post(reply: RowReaderReply): void {
    parentPort?.postMessage(reply);
}

/** A failure reply: `changed` if the file was rewritten under the read. */
function failure(id: number, error: unknown): RowReaderReply {
    let my_changed = false;
    try {
        my_changed = !unchanged();
    } catch {
        /* report the original error */
    }
    return my_changed
        ? { id, ok: false, reason: 'changed' }
        : { id, ok: false, reason: 'failed', message: String(error) };
}

function answer_page(
    source: DtaSource,
    id: number,
    rows: PageRows,
    columns: number[]
): void {
    const the_strl = columns.filter(my_col => source.is_strl(my_col));
    const my_split = the_strl.length > 0
        && the_strl.length < columns.length
        && !source.strl_index_built;
    if (!my_split) {
        const my_rows = format_page(
            source,
            source.read_page(rows, columns),
            columns
        );
        post(unchanged()
            ? { id, ok: true, kind: 'page', rows: my_rows, more: false }
            : { id, ok: false, reason: 'changed' });
        return;
    }
    // The other columns now, the strLs once the index is built.
    const the_plain = columns.filter(my_col => !source.is_strl(my_col));
    const the_plain_cells = source.read_page(rows, the_plain);
    const the_strl_set = new Set(the_strl);
    const the_page = the_plain_cells.map(my_cells => {
        let j = 0;
        return columns.map(my_col =>
            the_strl_set.has(my_col) ? PENDING_CELL : my_cells[j++]
        );
    });
    if (!unchanged()) {
        post({ id, ok: false, reason: 'changed' });
        return;
    }
    post({
        id,
        ok: true,
        kind: 'page',
        rows: format_page(source, the_page, columns),
        more: true,
    });
    try {
        const my_strl_rows = format_page(
            source,
            source.read_page(rows, the_strl),
            the_strl
        );
        post(unchanged()
            ? { id, ok: true, kind: 'cells', columns: the_strl, rows: my_strl_rows }
            : { id, ok: false, reason: 'changed' });
    } catch (my_err) {
        post(failure(id, my_err));
    }
}

function answer(request: RowReaderRequest): void {
    const my_id = request.id;
    try {
        if (!my_source) throw my_open_error;
        if (request.kind === 'page') {
            answer_page(
                my_source,
                my_id,
                request.rows,
                my_source.column_range(request.col_start, request.col_end)
            );
            return;
        }
        const the_texts = my_source.read_full_text(request.cells);
        post(unchanged()
            ? { id: my_id, ok: true, kind: 'fullText', texts: the_texts }
            : { id: my_id, ok: false, reason: 'changed' });
    } catch (my_err) {
        post(failure(my_id, my_err));
    }
}

parentPort?.on('message', (my_request: RowReaderRequest) => {
    answer(my_request);
});

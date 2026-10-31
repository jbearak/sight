/* eslint-env node, mocha */
/**
 * Data-browser timing in a real VS Code: open each fixture through the
 * custom editor with `sight.dataBrowser.debugTiming` on, wait until the
 * webview reports the first rows painted, and report the marks plus the
 * extension host's longest event-loop stall during the open.
 *
 * Numbers are reported, not asserted (budgets live in the redesign
 * spec, specs/2026-10-30-data-browser-redesign.md, and are set from
 * these measurements). The test fails only if a fixture never paints.
 *
 * Fixtures come from SIGHT_PERF_FIXTURES (comma-separated .dta paths),
 * which runTest.js fills in; results are written to SIGHT_PERF_OUT when
 * set.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const HEARTBEAT_MS = 2;
const PAINT_TIMEOUT_MS = 150000;
const POLL_MS = 50;
const SIGHT_EXTENSION_ID = 'jbearak.sight';

function start_loop_monitor() {
    let my_last = performance.now();
    let my_max_stall = 0;
    const my_timer = setInterval(() => {
        const my_now = performance.now();
        my_max_stall = Math.max(my_max_stall, my_now - my_last - HEARTBEAT_MS);
        my_last = my_now;
    }, HEARTBEAT_MS);
    return () => {
        clearInterval(my_timer);
        return Math.round(Math.max(0, my_max_stall) * 10) / 10;
    };
}

async function wait_for_paint(name, after_count) {
    const my_deadline = Date.now() + PAINT_TIMEOUT_MS;
    while (Date.now() < my_deadline) {
        const the_records = await vscode.commands.executeCommand(
            'sight.dataBrowser.debugTimingSnapshot'
        );
        const my_record = the_records
            .slice(after_count)
            .find(my_r => my_r.name === name
                && my_r.first_rows_painted_epoch_ms !== undefined);
        if (my_record) return my_record;
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
    return null;
}

function since(record, key) {
    const my_value = record[key];
    return my_value === undefined ? null : my_value - record.opened_epoch_ms;
}

describe('data browser timing (VS Code-hosted)', function () {
    const the_fixtures = (process.env.SIGHT_PERF_FIXTURES || '')
        .split(',')
        .filter(Boolean);
    const the_results = [];

    before(async function () {
        // Activate Sight first: on a fresh profile its onStartupFinished
        // activation may still be pending, and the snapshot command below
        // is registered only by activate().
        const my_extension = vscode.extensions.getExtension(SIGHT_EXTENSION_ID);
        assert.ok(my_extension, `${SIGHT_EXTENSION_ID} is not installed`);
        await my_extension.activate();
        await vscode.workspace
            .getConfiguration('sight.dataBrowser')
            .update('debugTiming', true, vscode.ConfigurationTarget.Global);
    });

    after(function () {
        const my_out = process.env.SIGHT_PERF_OUT;
        if (my_out) {
            fs.writeFileSync(my_out, JSON.stringify(the_results, null, 2));
        }
        console.log(JSON.stringify(the_results, null, 2));
    });

    it('has fixtures to open', function () {
        assert.ok(
            the_fixtures.length > 0,
            'SIGHT_PERF_FIXTURES lists no fixtures'
        );
    });

    for (const my_fixture of the_fixtures) {
        it(`opens ${path.basename(my_fixture)} and paints its first rows`, async function () {
            const my_before = (await vscode.commands.executeCommand(
                'sight.dataBrowser.debugTimingSnapshot'
            )).length;
            const stop = start_loop_monitor();
            await vscode.commands.executeCommand(
                'vscode.openWith',
                vscode.Uri.file(my_fixture),
                'sight.dataBrowserEditor'
            );
            // A directly opened file is named by its base name without
            // the extension (build_direct_open_sidecar).
            const my_record = await wait_for_paint(
                path.parse(my_fixture).name,
                my_before
            );
            const my_max_stall_ms = stop();
            assert.ok(my_record, `${my_fixture}: first rows never painted`);
            the_results.push({
                fixture: path.basename(my_fixture),
                metadata_posted_ms: since(my_record, 'metadata_posted_epoch_ms'),
                metadata_received_ms: since(my_record, 'metadata_received_epoch_ms'),
                first_rows_posted_ms: since(my_record, 'first_rows_posted_epoch_ms'),
                first_rows_received_ms: since(my_record, 'first_rows_received_epoch_ms'),
                first_rows_painted_ms: since(my_record, 'first_rows_painted_epoch_ms'),
                host_max_stall_ms: my_max_stall_ms,
            });
            await vscode.commands.executeCommand(
                'workbench.action.closeActiveEditor'
            );
        });
    }
});

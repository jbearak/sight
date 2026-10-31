/**
 * vview signal latency: time from vview.ado's last write (the signal
 * file) to SignalWatcher handing the sidecar to the panel manager.
 *
 * Mirrors vview.ado's write order: sidecar JSON first, then
 * signal_<uuid>. Uses a private browse directory and a zero claim
 * delay (the workspace-match case); the extension adds 300 ms
 * (WORKSPACE_MATCH_DELAY_MS) when Stata's cwd is outside every
 * workspace folder.
 *
 * Also times a raw sequential write of `--write-bytes` bytes: a lower
 * bound for Stata's own `save` of a dataset that size on this disk,
 * which cannot be measured without Stata.
 *
 * Usage (bundled): node vview-latency.mjs <tmp-dir> [samples] [write-bytes]
 */

import * as fs from 'fs';
import * as path from 'path';
import { SignalWatcher } from '../../client/src/data-browser/signal-watcher.js';

async function main(): Promise<void> {
    const [my_dir, my_samples_arg = '20', my_write_arg = '0'] =
        process.argv.slice(2);
    const my_browse = path.join(my_dir, `browse-${process.pid}`);
    fs.mkdirSync(my_browse, { recursive: true });
    let on_claim: (() => void) | null = null;
    const my_watcher = new SignalWatcher(
        () => { on_claim?.(); },
        () => undefined,
        my_browse,
        () => 0
    );
    my_watcher.start();
    await new Promise(resolve => setTimeout(resolve, 200));

    const the_latencies: number[] = [];
    for (let i = 0; i < Number(my_samples_arg); i++) {
        const my_uuid = `bench${i}`;
        const my_claimed = new Promise<void>(resolve => {
            on_claim = resolve;
        });
        fs.writeFileSync(
            path.join(my_browse, `${my_uuid}.json`),
            JSON.stringify({
                version: 1, uuid: my_uuid, timestamp: '', source: '',
                cwd: my_dir, name: 'bench',
                dtapath: path.join(my_browse, `${my_uuid}.dta`),
                varlist: [], if: '', in: '', N: 1, k: 1,
                replace: false, subsetted: false,
            })
        );
        const my_t = performance.now();
        fs.writeFileSync(path.join(my_browse, `signal_${my_uuid}`), my_uuid);
        await my_claimed;
        the_latencies.push(performance.now() - my_t);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    my_watcher.stop();
    the_latencies.sort((a, b) => a - b);
    const my_result: Record<string, unknown> = {
        samples: the_latencies.length,
        signal_to_claim_median_ms:
            Math.round(the_latencies[the_latencies.length >> 1] * 10) / 10,
        signal_to_claim_max_ms:
            Math.round(the_latencies[the_latencies.length - 1] * 10) / 10,
    };

    const my_write_bytes = Number(my_write_arg);
    if (my_write_bytes > 0) {
        const my_path = path.join(my_browse, 'write-probe.dta');
        const my_chunk = Buffer.alloc(8 << 20, 7);
        const my_fd = fs.openSync(my_path, 'w');
        const my_t = performance.now();
        for (let my_done = 0; my_done < my_write_bytes; my_done += my_chunk.length) {
            fs.writeSync(my_fd, my_chunk, 0,
                Math.min(my_chunk.length, my_write_bytes - my_done));
        }
        fs.fsyncSync(my_fd);
        fs.closeSync(my_fd);
        my_result.raw_write_mib = Math.round(my_write_bytes / (1 << 20));
        my_result.raw_write_ms = Math.round(performance.now() - my_t);
        fs.unlinkSync(my_path);
    }
    fs.rmSync(my_browse, { recursive: true, force: true });
    process.stdout.write(`RESULT ${JSON.stringify(my_result)}\n`);
}

main().catch(my_err => {
    console.error(my_err);
    process.exit(1);
});

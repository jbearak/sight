import {
    afterEach,
    describe,
    expect,
    it,
} from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    SignalWatcher,
    type SignalCallback,
} from '../../client/src/data-browser/signal-watcher';
import type { VviewSidecar } from '../../client/src/data-browser/types';

let temp_dir: string | null = null;

afterEach(() => {
    if (temp_dir) {
        fs.rmSync(temp_dir, {
            recursive: true,
            force: true,
        });
        temp_dir = null;
    }
});

function make_temp_dir(): string {
    temp_dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sight-signal-watcher-')
    );
    return temp_dir;
}

function wait_for_signal(
    browse_dir: string,
    write_files: () => void,
    timeout_ms: number = 1000
): Promise<VviewSidecar> {
    return new Promise((resolve, reject) => {
        const my_errors: string[] = [];
        let my_done = false;
        const my_callback: SignalCallback = (
            sidecar: VviewSidecar
        ) => {
            if (my_done) {
                return;
            }
            my_done = true;
            clearTimeout(my_timeout);
            my_watcher.stop();
            resolve(sidecar);
        };
        const my_watcher = new SignalWatcher(
            my_callback,
            (msg: string) => {
                my_errors.push(msg);
            },
            browse_dir
        );
        const my_timeout = setTimeout(() => {
            if (my_done) {
                return;
            }
            my_done = true;
            my_watcher.stop();
            reject(new Error(
                'Timed out waiting for signal. Logs: '
                + my_errors.join(' | ')
            ));
        }, timeout_ms);

        my_watcher.start();
        write_files();
    });
}

// Bun's fs.watch() does not emit events on macOS
// (tested with Bun 1.3.11). These tests pass under
// Node.js and in the VS Code extension host.
describe.skip('SignalWatcher integration', () => {
    it('consumes a vview-style signal and sidecar from disk', async () => {
        const my_browse_dir = make_temp_dir();
        const my_uuid = '_27Mar202619_02_55_2668857098';
        const my_sidecar = {
            version: 1,
            uuid: my_uuid,
            name: 'auto',
            dtapath: path.join(
                my_browse_dir,
                `${my_uuid}.dta`
            ),
            N: 74,
            k: 12,
            replace: false,
            subsetted: false,
        } satisfies VviewSidecar;

        const my_result = await wait_for_signal(
            my_browse_dir,
            () => {
                fs.writeFileSync(
                    path.join(
                        my_browse_dir,
                        `${my_uuid}.json`
                    ),
                    JSON.stringify(my_sidecar)
                );
                fs.writeFileSync(
                    path.join(
                        my_browse_dir,
                        `signal_${my_uuid}`
                    ),
                    my_uuid
                );
            }
        );

        expect(my_result).toEqual(my_sidecar);
        expect(fs.existsSync(path.join(
            my_browse_dir,
            `${my_uuid}.json`
        ))).toBe(false);
        expect(fs.existsSync(path.join(
            my_browse_dir,
            `signal_${my_uuid}`
        ))).toBe(false);
    });

    it('handles the signal appearing before the json sidecar is written', async () => {
        const my_browse_dir = make_temp_dir();
        const my_uuid = '_27Mar202620_11_03_1234567890';
        const my_sidecar = {
            version: 1,
            uuid: my_uuid,
            name: 'auto',
            dtapath: path.join(
                my_browse_dir,
                `${my_uuid}.dta`
            ),
            N: 74,
            k: 12,
            replace: false,
            subsetted: false,
        } satisfies VviewSidecar;

        const my_result = await wait_for_signal(
            my_browse_dir,
            () => {
                fs.writeFileSync(
                    path.join(
                        my_browse_dir,
                        `signal_${my_uuid}`
                    ),
                    my_uuid
                );
                setTimeout(() => {
                    fs.writeFileSync(
                        path.join(
                            my_browse_dir,
                            `${my_uuid}.json`
                        ),
                        JSON.stringify(my_sidecar)
                    );
                }, 40);
            },
            1500
        );

        expect(my_result).toEqual(my_sidecar);
    });
});

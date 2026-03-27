import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type { VviewSidecar } from './types';

export const BROWSE_DIR = path.join(
    homedir(),
    '.sight',
    'browse'
);
const SIGNAL_PREFIX = 'signal_';
const MAX_TEMP_FILE_AGE_MS = 24 * 60 * 60 * 1000;

// -------------------------------------------------------
// Sidecar JSON parser
// -------------------------------------------------------

/**
 * Parse a JSON string into a VviewSidecar.
 * Returns null if JSON is invalid, required fields are
 * missing, or field types are wrong.
 */
export function parse_sidecar_json(
    content: string
): VviewSidecar | null {
    let my_obj: unknown;
    try {
        my_obj = JSON.parse(content);
    } catch {
        return null;
    }
    if (typeof my_obj !== 'object' || my_obj === null) {
        return null;
    }
    const my_rec = my_obj as Record<string, unknown>;

    // Required fields with type checks
    if (typeof my_rec.uuid !== 'string') return null;
    if (typeof my_rec.name !== 'string') return null;
    if (typeof my_rec.N !== 'number') return null;
    if (typeof my_rec.k !== 'number') return null;
    if (typeof my_rec.replace !== 'boolean') return null;
    if (
        my_rec.timestamp !== undefined
        && typeof my_rec.timestamp !== 'string'
    ) {
        return null;
    }
    if (
        my_rec.source !== undefined
        && typeof my_rec.source !== 'string'
    ) {
        return null;
    }
    if (
        my_rec.varlist !== undefined
        && (
            !Array.isArray(my_rec.varlist)
            || my_rec.varlist.some(
                my_value => typeof my_value !== 'string'
            )
        )
    ) {
        return null;
    }
    if (my_rec.if !== undefined && typeof my_rec.if !== 'string') {
        return null;
    }
    if (my_rec.in !== undefined && typeof my_rec.in !== 'string') {
        return null;
    }

    return {
        version: typeof my_rec.version === 'number'
            ? my_rec.version
            : 0,
        uuid: my_rec.uuid,
        name: my_rec.name,
        dtapath: typeof my_rec.dtapath === 'string'
            ? my_rec.dtapath
            : '',
        N: my_rec.N,
        k: my_rec.k,
        replace: my_rec.replace,
        subsetted: typeof my_rec.subsetted === 'boolean'
            ? my_rec.subsetted
            : false,
        timestamp: my_rec.timestamp as string | undefined,
        source: my_rec.source as string | undefined,
        varlist: my_rec.varlist as string[] | undefined,
        if: my_rec.if as string | undefined,
        in: my_rec.in as string | undefined,
    };
}

function is_browse_temp_filename(filename: string): boolean {
    return (
        filename.endsWith('.dta')
        || filename.endsWith('.json')
        || filename.startsWith(SIGNAL_PREFIX)
    );
}

export function prune_stale_browse_files(
    browse_dir: string = BROWSE_DIR,
    now_ms: number = Date.now()
): void {
    let the_filenames: string[];
    try {
        the_filenames = fs.readdirSync(browse_dir);
    } catch {
        return;
    }

    for (const my_filename of the_filenames) {
        if (!is_browse_temp_filename(my_filename)) {
            continue;
        }

        const my_path = path.join(browse_dir, my_filename);
        try {
            const my_stat = fs.statSync(my_path);
            if (
                now_ms - my_stat.mtimeMs
                > MAX_TEMP_FILE_AGE_MS
            ) {
                fs.unlinkSync(my_path);
            }
        } catch {
            // Ignore races and permission issues.
        }
    }
}

// -------------------------------------------------------
// Signal watcher
// -------------------------------------------------------

export type SignalCallback =
    (sidecar: VviewSidecar) => void;

/**
 * Watches ~/.sight/browse/ for signal files created by
 * vview.ado. When a signal_<uuid> file appears, reads the
 * companion <uuid>.json sidecar, parses it, cleans up
 * both files, and invokes the callback.
 */
export class SignalWatcher {
    private readonly on_signal: SignalCallback;
    private readonly log: (msg: string) => void;
    private watcher: fs.FSWatcher | null = null;

    constructor(
        on_signal: SignalCallback,
        log?: (msg: string) => void
    ) {
        this.on_signal = on_signal;
        this.log = log ?? (() => {});
    }

    /** Begin watching ~/.sight/browse/. */
    start(): void {
        if (this.watcher) {
            return;
        }

        try {
            fs.mkdirSync(BROWSE_DIR, { recursive: true });
        } catch (my_err) {
            this.log(
                `Failed to create ${BROWSE_DIR}: `
                + String(my_err)
            );
            return;
        }

        try {
            this.watcher = fs.watch(
                BROWSE_DIR,
                (event_type: string, filename: string | null) => {
                    if (
                        event_type === 'rename'
                        && filename
                        && filename.startsWith(SIGNAL_PREFIX)
                    ) {
                        this.handle_signal(filename);
                    }
                }
            );
        } catch (my_err) {
            this.log(
                `Failed to watch ${BROWSE_DIR}: `
                + String(my_err)
            );
        }
    }

    /** Stop watching. */
    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }

    private handle_signal(signal_filename: string): void {
        const my_signal_path = path.join(
            BROWSE_DIR,
            signal_filename
        );

        // Read UUID from the signal file content
        let my_uuid: string;
        try {
            my_uuid = fs.readFileSync(
                my_signal_path,
                'utf-8'
            ).trim();
        } catch {
            // Signal file may have been deleted already
            return;
        }

        if (!my_uuid) {
            this.log('Empty signal file: ' + signal_filename);
            this.try_unlink(my_signal_path);
            return;
        }

        // Read companion sidecar JSON
        const my_json_path = path.join(
            BROWSE_DIR,
            my_uuid + '.json'
        );
        let my_content: string;
        try {
            my_content = fs.readFileSync(
                my_json_path,
                'utf-8'
            );
        } catch (my_err) {
            this.log(
                `Failed to read sidecar ${my_json_path}: `
                + String(my_err)
            );
            this.try_unlink(my_signal_path);
            return;
        }

        // Parse sidecar
        const my_sidecar = parse_sidecar_json(my_content);
        if (!my_sidecar) {
            this.log(
                'Invalid sidecar JSON: ' + my_json_path
            );
            this.try_unlink(my_signal_path);
            this.try_unlink(my_json_path);
            return;
        }

        // Cleanup both files before callback
        this.try_unlink(my_signal_path);
        this.try_unlink(my_json_path);

        this.on_signal(my_sidecar);
    }

    private try_unlink(file_path: string): void {
        try {
            fs.unlinkSync(file_path);
        } catch {
            // File may already be gone; ignore
        }
    }
}

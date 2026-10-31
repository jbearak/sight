import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type { VviewSidecar } from './types.js';

export const BROWSE_DIR = path.join(
    homedir(),
    '.sight',
    'browse'
);
const SIGNAL_PREFIX = 'signal_';
const MAX_TEMP_FILE_AGE_MS = 24 * 60 * 60 * 1000;
const SIGNAL_READ_RETRY_DELAY_MS = 25;
const MAX_SIGNAL_READ_RETRIES = 8;

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
        my_rec.cwd !== undefined
        && typeof my_rec.cwd !== 'string'
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
        cwd: my_rec.cwd as string | undefined,
        varlist: my_rec.varlist as string[] | undefined,
        if: my_rec.if as string | undefined,
        in: my_rec.in as string | undefined,
    };
}

export function get_signal_uuid(
    signal_filename: string
): string | null {
    if (!signal_filename.startsWith(SIGNAL_PREFIX)) {
        return null;
    }

    const my_uuid = signal_filename.slice(
        SIGNAL_PREFIX.length
    ).trim();
    return my_uuid !== '' ? my_uuid : null;
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
    (sidecar: VviewSidecar) => void | Promise<void>;

/**
 * Returns the number of milliseconds to wait before
 * attempting to claim a signal. A matching workspace
 * returns 0 (claim immediately); a non-matching one
 * returns a positive delay to give the right window
 * a head start.
 */
export type ClaimDelayFn =
    (sidecar: VviewSidecar) => number;

/**
 * Watches ~/.sight/browse/ for signal files created by
 * vview.ado. When a signal_<uuid> file appears, reads the
 * companion <uuid>.json sidecar, parses it, cleans up
 * both files, and invokes the callback.
 *
 * An optional claim_delay_fn controls how long to wait
 * before attempting the atomic claim. This allows windows
 * whose workspace matches the Stata cwd to claim first.
 */
export class SignalWatcher {
    private readonly on_signal: SignalCallback;
    private readonly log: (msg: string) => void;
    private readonly browse_dir: string;
    private readonly claim_delay_fn: ClaimDelayFn;
    private watcher: fs.FSWatcher | null = null;

    constructor(
        on_signal: SignalCallback,
        log?: (msg: string) => void,
        browse_dir: string = BROWSE_DIR,
        claim_delay_fn: ClaimDelayFn = () => 0
    ) {
        this.on_signal = on_signal;
        this.log = log ?? (() => {});
        this.browse_dir = browse_dir;
        this.claim_delay_fn = claim_delay_fn;
    }

    /** Begin watching ~/.sight/browse/. */
    start(): void {
        if (this.watcher) {
            return;
        }

        try {
            fs.mkdirSync(this.browse_dir, {
                recursive: true,
            });
        } catch (my_err) {
            this.log(
                `Failed to create ${this.browse_dir}: `
                + String(my_err)
            );
            return;
        }

        try {
            this.watcher = fs.watch(
                this.browse_dir,
                (event_type: string, filename: string | null) => {
                    if (
                        event_type === 'rename'
                        && filename
                        && filename.startsWith(SIGNAL_PREFIX)
                    ) {
                        this.read_sidecar(filename);
                    }
                }
            );
        } catch (my_err) {
            this.log(
                `Failed to watch ${this.browse_dir}: `
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

    /**
     * Phase 1: Read the companion JSON sidecar
     * (non-destructive, with retries). Once parsed,
     * hand off to schedule_claim.
     */
    private read_sidecar(
        signal_filename: string,
        retry_count: number = 0
    ): void {
        const my_uuid = get_signal_uuid(signal_filename);
        if (!my_uuid) {
            this.log(
                'Invalid signal filename: '
                + signal_filename
            );
            this.try_unlink(
                path.join(
                    this.browse_dir,
                    signal_filename
                )
            );
            return;
        }

        const my_json_path = path.join(
            this.browse_dir,
            my_uuid + '.json'
        );

        let my_content: string;
        try {
            my_content = fs.readFileSync(
                my_json_path,
                'utf-8'
            );
        } catch {
            if (
                retry_count
                < MAX_SIGNAL_READ_RETRIES
            ) {
                setTimeout(() => {
                    this.read_sidecar(
                        signal_filename,
                        retry_count + 1
                    );
                }, SIGNAL_READ_RETRY_DELAY_MS);
                return;
            }

            this.log(
                'Failed to read sidecar '
                + my_json_path
            );
            return;
        }

        const my_sidecar = parse_sidecar_json(my_content);
        if (!my_sidecar) {
            if (
                retry_count
                < MAX_SIGNAL_READ_RETRIES
            ) {
                setTimeout(() => {
                    this.read_sidecar(
                        signal_filename,
                        retry_count + 1
                    );
                }, SIGNAL_READ_RETRY_DELAY_MS);
                return;
            }

            this.log(
                'Invalid sidecar JSON: ' + my_json_path
            );
            return;
        }

        this.schedule_claim(
            signal_filename,
            my_sidecar,
            my_json_path
        );
    }

    /**
     * Phase 2: Compute claim delay and schedule the
     * atomic claim attempt.
     */
    private schedule_claim(
        signal_filename: string,
        sidecar: VviewSidecar,
        json_path: string
    ): void {
        const my_delay_ms = this.claim_delay_fn(sidecar);
        if (my_delay_ms <= 0) {
            this.attempt_claim(
                signal_filename,
                sidecar,
                json_path
            );
            return;
        }
        setTimeout(() => {
            this.attempt_claim(
                signal_filename,
                sidecar,
                json_path
            );
        }, my_delay_ms);
    }

    /**
     * Phase 3: Atomically claim the signal by deleting
     * the signal file. On POSIX, unlink is atomic —
     * exactly one process succeeds, others get ENOENT.
     * This prevents multiple VS Code windows from
     * processing the same signal.
     */
    private attempt_claim(
        signal_filename: string,
        sidecar: VviewSidecar,
        json_path: string
    ): void {
        const my_signal_path = path.join(
            this.browse_dir,
            signal_filename
        );
        try {
            fs.unlinkSync(my_signal_path);
        } catch (my_err: unknown) {
            const my_code = (
                my_err as NodeJS.ErrnoException
            ).code;
            if (my_code === 'ENOENT') {
                return;
            }
            this.log(
                'Failed to claim signal '
                + signal_filename + ': '
                + String(my_err)
            );
            return;
        }

        this.try_unlink(json_path);

        Promise.resolve(this.on_signal(sidecar))
            .catch(my_err => {
                this.log(
                    'Signal callback error: '
                    + String(my_err)
                );
            });
    }

    private try_unlink(file_path: string): void {
        try {
            fs.unlinkSync(file_path);
        } catch {
            // File may already be gone; ignore
        }
    }
}

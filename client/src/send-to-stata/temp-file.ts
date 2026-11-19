import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// Stata reads the temp do-file asynchronously after we hand it off, so
// the file must outlive that read. For the integrated terminal the file
// is now handed to Stata as a launch argument, and a cold first console
// launch (license check, init) can take many seconds before Stata reads
// it. Delete late enough to clear a slow cold start; the file is tiny so
// a longer lifetime is cheap.
export const DEFAULT_TEMP_FILE_CLEANUP_DELAY_MS = 30000;

export function get_temp_dir(): string {
    return os.tmpdir();
}

const MAX_RETRY_ATTEMPTS = 5;

export async function create_temp_file(content: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
        const random_bytes = crypto.randomBytes(16);
        const random_hex = random_bytes.toString('hex');
        const filename = `stata_send_${random_hex}.do`;
        const file_path = path.join(get_temp_dir(), filename);
        
        try {
            await fs.writeFile(file_path, content, { encoding: 'utf8', flag: 'wx' });
            return file_path;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                // File already exists, retry with new random value
                continue;
            }
            throw error;
        }
    }
    
    throw new Error(
        `Failed to create temp file after ${MAX_RETRY_ATTEMPTS} attempts`
    );
}

/**
 * Files a Stata pane has typed but its console hasn't given to Stata
 * yet (it may be running something long). The pane deletes each one
 * itself; cleanup scheduled by whoever handed it over skips it.
 */
const the_held_files = new Set<string>();

export function hold_temp_file(file_path: string): void {
    the_held_files.add(file_path);
}

export function release_temp_file(file_path: string): void {
    the_held_files.delete(file_path);
}

export function schedule_temp_file_cleanup(
    file_path: string,
    delay_ms = DEFAULT_TEMP_FILE_CLEANUP_DELAY_MS
): NodeJS.Timeout {
    return setTimeout(() => {
        if (the_held_files.has(file_path)) {
            return;
        }
        fs.unlink(file_path).catch(() => {});
    }, delay_ms);
}

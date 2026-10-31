/**
 * Console input history, kept across sessions in a plain text file (one
 * entry per line, oldest first).
 *
 * Entries that start with a space are not saved, as in bash's
 * `ignorespace`, so a command can be kept out of the file. Consecutive
 * duplicates are collapsed. File errors never stop the console; history
 * then lasts only for the session.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const MAX_HISTORY_ENTRIES = 10_000;

/** History file location for this platform, or the override. */
export function default_history_path(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): string {
    const override = env.SIGHT_CONSOLE_HISTORY;
    if (override) {
        return override;
    }
    const home = os.homedir();
    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'sight', 'console_history');
    }
    if (platform === 'win32') {
        const app_data = env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return path.join(app_data, 'sight', 'console_history');
    }
    const data_home = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return path.join(data_home, 'sight', 'console_history');
}

export class History {
    private entries: string[] = [];
    private readonly file_path: string | null;

    /** `file_path` null keeps history in memory only. */
    constructor(file_path: string | null) {
        this.file_path = file_path;
        if (file_path) {
            this.load(file_path);
        }
    }

    all(): readonly string[] {
        return this.entries;
    }

    add(line: string): void {
        if (line.trim().length === 0 || line.startsWith(' ') || line.includes('\n')) {
            return;
        }
        if (this.entries[this.entries.length - 1] === line) {
            return;
        }
        this.entries.push(line);
        if (this.entries.length > MAX_HISTORY_ENTRIES) {
            this.entries.splice(0, this.entries.length - MAX_HISTORY_ENTRIES);
        }
        if (this.file_path) {
            try {
                fs.appendFileSync(this.file_path, line + '\n', { mode: 0o600 });
            } catch {
                // Keep the in-memory entry; the file is best-effort.
            }
        }
    }

    private load(file_path: string): void {
        try {
            const directory = path.dirname(file_path);
            // New directories are private; an existing one keeps its mode.
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            if (!fs.existsSync(file_path)) {
                return;
            }
            try {
                fs.chmodSync(file_path, 0o600);
            } catch {
                // Continue with the existing mode.
            }
            const lines = fs.readFileSync(file_path, 'utf8').split('\n')
                .filter((my_line) => my_line.length > 0);
            this.entries = lines.slice(-MAX_HISTORY_ENTRIES);
            if (lines.length > MAX_HISTORY_ENTRIES * 2) {
                // Compact so appends don't grow the file without bound.
                fs.writeFileSync(file_path, this.entries.join('\n') + '\n', { mode: 0o600 });
            }
        } catch {
            this.entries = [];
        }
    }
}

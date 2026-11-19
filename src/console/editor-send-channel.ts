/**
 * Editor sends to the console on a terminal (editor-console-tty.ts),
 * carried in its input stream: a Perch session's only way in is input
 * typed through Perch, and a send typed as keys would answer
 * `--more--` and join what the user is typing. The extension wraps
 * each send in an APC escape sequence, which no key produces:
 *
 *   ESC _ sight-send; {"line": "...", "file": "..."} ESC \
 *
 * JSON escapes control characters, so none appears inside the
 * payload. `file` is the send's temporary do-file, which the console
 * deletes once Stata has read the line (or at once if it never will).
 *
 * The key decoder (keys.ts) reads these outside a bracketed paste
 * only, so pasted text is never taken for a send. The channel is not
 * authenticated otherwise: a program that can type into the terminal
 * can write one, and its line runs as if typed. So the console deletes
 * only a file that is plainly one of the extension's own temporary
 * do-files (is_editor_send_file), and ignores a send naming any other.
 *
 * The extension mirrors these constants (perch-core.ts, temp-file.ts).
 */

import * as fs from 'fs';
import * as path from 'path';

export const EDITOR_SEND_START = '\x1b_sight-send;';
export const EDITOR_SEND_END = '\x1b\\';
/** A longer payload is read to its end and dropped. */
export const MAX_EDITOR_SEND_LENGTH = 1024 * 1024;
/** The extension's temp do-files (client/src/send-to-stata/temp-file.ts). */
const SEND_FILE_NAME = /^stata_send_[0-9a-f]{32}\.do$/;

export interface EditorSend {
    line: string;
    file: string;
}

export function encode_editor_send(send: EditorSend): string {
    return EDITOR_SEND_START + JSON.stringify(send) + EDITOR_SEND_END;
}

/** The send in a payload, or null if it isn't a well-formed one. */
export function parse_editor_send(payload: string): EditorSend | null {
    try {
        const value: unknown = JSON.parse(payload);
        if (typeof value !== 'object' || value === null) {
            return null;
        }
        const line: unknown = Reflect.get(value, 'line');
        const file: unknown = Reflect.get(value, 'file');
        if (typeof line !== 'string' || typeof file !== 'string') {
            return null;
        }
        return { line, file };
    } catch {
        return null;
    }
}

/**
 * True if `file` names one of the extension's temp do-files directly
 * in `send_dir` (the directory the extension writes them to): an
 * absolute path, no `..` or other directory, the extension's file
 * name pattern. Nothing else may be deleted for a send.
 */
export function is_editor_send_file(file: string, send_dir: string): boolean {
    return path.isAbsolute(file)
        && path.dirname(file) === path.resolve(send_dir)
        && SEND_FILE_NAME.test(path.basename(file));
}

/**
 * Delete a send's temp do-file if it is still a regular file (not,
 * say, a symbolic link put in its place).
 */
export function delete_editor_send_file(file: string): void {
    try {
        if (fs.lstatSync(file).isFile()) {
            fs.unlinkSync(file);
        }
    } catch {
        // Gone already.
    }
}

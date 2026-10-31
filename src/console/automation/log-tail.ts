/**
 * Reads what Stata appends to the console's text log.
 *
 * Stata holds the log open for writing, so it is read through a fresh
 * handle each poll (Node and Bun open files with read/write sharing on
 * Windows, which Stata's lock requires). Text is decoded as UTF-8
 * across reads and newlines are normalized to `\n`.
 */

import * as fs from 'fs';

export interface LogPoll {
    /** New text since the last poll, newlines as `\n`. */
    text: string;
    /** Bytes read so far (the file size at this poll). */
    size: number;
    /** The file shrank or vanished since the last poll. */
    lost: boolean;
}

export interface LogSource {
    poll(): LogPoll;
}

const READ_CHUNK_BYTES = 1 << 16;

export class LogTail implements LogSource {
    private offset: number;
    private decoder = new TextDecoder('utf-8');
    private carry_cr = false;

    /** Start reading at `start_offset` (the log's size when tailing began). */
    constructor(private readonly file_path: string, start_offset: number) {
        this.offset = start_offset;
    }

    poll(): LogPoll {
        let size: number;
        try {
            size = fs.statSync(this.file_path).size;
        } catch {
            return { text: '', size: this.offset, lost: true };
        }
        if (size < this.offset) {
            this.offset = size;
            return { text: '', size, lost: true };
        }
        if (size === this.offset) {
            return { text: '', size, lost: false };
        }
        const parts: string[] = [];
        let fd: number | null = null;
        try {
            fd = fs.openSync(this.file_path, 'r');
            const buffer = Buffer.alloc(READ_CHUNK_BYTES);
            while (this.offset < size) {
                const length = Math.min(READ_CHUNK_BYTES, size - this.offset);
                const read = fs.readSync(fd, buffer, 0, length, this.offset);
                if (read <= 0) {
                    break;
                }
                this.offset += read;
                parts.push(this.decoder.decode(buffer.subarray(0, read), { stream: true }));
            }
        } catch {
            return { text: this.normalize(parts.join('')), size: this.offset, lost: false };
        } finally {
            if (fd !== null) {
                try {
                    fs.closeSync(fd);
                } catch {
                    // Ignore.
                }
            }
        }
        return { text: this.normalize(parts.join('')), size: this.offset, lost: false };
    }

    /** `\r\n` (and a `\r` split from its `\n` across reads) to `\n`. */
    private normalize(text: string): string {
        let input = this.carry_cr ? '\r' + text : text;
        this.carry_cr = false;
        if (input.endsWith('\r')) {
            this.carry_cr = true;
            input = input.slice(0, -1);
        }
        return input.replace(/\r\n/g, '\n');
    }
}

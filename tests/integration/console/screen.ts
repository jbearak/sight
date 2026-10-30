/**
 * A minimal terminal emulator for console tests: enough of VT100 to
 * replay the console's output and read back what the user would see.
 * It handles printable text with wrapping, CR, LF, BS, cursor up/forward,
 * erase to end of screen/line, home, and clear screen; SGR and other
 * private sequences are ignored.
 */

export class Screen {
    private lines: string[][] = [[]];
    private row = 0;
    private column = 0;
    private pending_wrap = false;
    private readonly columns: number;

    constructor(columns: number) {
        this.columns = columns;
    }

    write(text: string): void {
        let i = 0;
        while (i < text.length) {
            const char = text[i] ?? '';
            if (char === '\x1b') {
                const match = /^\x1b\[([0-9;?]*)([A-Za-z~])/.exec(text.slice(i));
                if (match) {
                    this.csi(match[1] ?? '', match[2] ?? '');
                    i += match[0].length;
                } else {
                    i += 2;
                }
                continue;
            }
            i++;
            if (char === '\r') {
                this.column = 0;
                this.pending_wrap = false;
            } else if (char === '\n') {
                this.move_to_row(this.row + 1);
                this.pending_wrap = false;
            } else if (char === '\b') {
                this.column = Math.max(0, this.column - 1);
                this.pending_wrap = false;
            } else if (char >= ' ') {
                if (this.pending_wrap) {
                    this.move_to_row(this.row + 1);
                    this.column = 0;
                    this.pending_wrap = false;
                }
                const line = this.current_line();
                while (line.length < this.column) {
                    line.push(' ');
                }
                line[this.column] = char;
                if (this.column === this.columns - 1) {
                    this.pending_wrap = true;
                } else {
                    this.column++;
                }
            }
        }
    }

    /** Visible text, trailing blanks trimmed. */
    text(): string {
        return this.lines.map((my_line) => my_line.join('').trimEnd()).join('\n').trimEnd();
    }

    private csi(parameters: string, final: string): void {
        const count = Number(parameters.split(';')[0] || '1');
        this.pending_wrap = false;
        switch (final) {
            case 'A':
                this.row = Math.max(0, this.row - count);
                break;
            case 'C':
                this.column = Math.min(this.columns - 1, this.column + count);
                break;
            case 'J':
                if (parameters === '2') {
                    this.lines = [[]];
                    this.row = 0;
                    this.column = 0;
                } else {
                    this.current_line().length = Math.min(this.current_line().length, this.column);
                    this.lines.length = this.row + 1;
                }
                break;
            case 'K':
                this.current_line().length = Math.min(this.current_line().length, this.column);
                break;
            case 'H':
                this.row = 0;
                this.column = 0;
                break;
            default:
                break;
        }
    }

    private move_to_row(row: number): void {
        this.row = row;
        while (this.lines.length <= row) {
            this.lines.push([]);
        }
    }

    private current_line(): string[] {
        while (this.lines.length <= this.row) {
            this.lines.push([]);
        }
        return this.lines[this.row] ?? [];
    }
}

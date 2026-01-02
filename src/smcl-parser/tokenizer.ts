export interface SmclToken {
    type: SmclTokenType;
    content: string;
    start_pos: number;
    end_pos: number;
    line: number;
    column: number;
}

export type SmclTokenType =
    | 'directive_start'  // {
    | 'directive_end'    // }
    | 'directive_name'   // cmd, opt, synopt, etc.
    | 'colon'           // :
    | 'text'            // plain text
    | 'newline'         // \n
    | 'whitespace'      // spaces, tabs
    | 'eof';

export class SmclTokenizer {
    private content: string;
    private position: number = 0;
    private line: number = 1;
    private column: number = 1;

    constructor(content: string) {
        this.content = content;
    }

    tokenize(): SmclToken[] {
        const the_tokens: SmclToken[] = [];
        
        while (this.position < this.content.length) {
            const my_token = this.next_token();
            if (my_token) {
                the_tokens.push(my_token);
            }
        }
        
        the_tokens.push({
            type: 'eof',
            content: '',
            start_pos: this.position,
            end_pos: this.position,
            line: this.line,
            column: this.column
        });
        
        return the_tokens;
    }

    private next_token(): SmclToken | null {
        if (this.position >= this.content.length) {
            return null;
        }

        const my_start_pos = this.position;
        const my_start_line = this.line;
        const my_start_column = this.column;
        const my_char = this.content[this.position];

        // Handle newlines
        if (my_char === '\n') {
            this.advance();
            return this.create_token('newline', '\n', my_start_pos, my_start_line, my_start_column);
        }

        // Handle whitespace
        if (/\s/.test(my_char) && my_char !== '\n') {
            return this.read_whitespace(my_start_pos, my_start_line, my_start_column);
        }

        // Handle directive start
        if (my_char === '{') {
            this.advance();
            return this.create_token('directive_start', '{', my_start_pos, my_start_line, my_start_column);
        }

        // Handle directive end
        if (my_char === '}') {
            this.advance();
            return this.create_token('directive_end', '}', my_start_pos, my_start_line, my_start_column);
        }

        // Handle colon
        if (my_char === ':') {
            this.advance();
            return this.create_token('colon', ':', my_start_pos, my_start_line, my_start_column);
        }

        // Check if we're inside a directive (after { and before })
        const is_in_directive = this.is_inside_directive();
        
        // Handle directive names (alphanumeric + underscore) only when inside directives
        if (/[a-zA-Z_]/.test(my_char) && is_in_directive) {
            return this.read_directive_name(my_start_pos, my_start_line, my_start_column);
        }

        // Everything else is text
        return this.read_text(my_start_pos, my_start_line, my_start_column);
    }

    /**
     * Check if we're currently inside a directive (between { and }).
     */
    private is_inside_directive(): boolean {
        // Look backwards to find the most recent { or }
        let brace_count = 0;
        for (let i = this.position - 1; i >= 0; i--) {
            const char = this.content[i];
            if (char === '}') {
                brace_count--;
            } else if (char === '{') {
                brace_count++;
                break;
            }
        }
        return brace_count > 0;
    }

    private read_whitespace(start_pos: number, start_line: number, start_column: number): SmclToken {
        let my_content = '';
        while (this.position < this.content.length && /\s/.test(this.content[this.position]) && this.content[this.position] !== '\n') {
            my_content += this.content[this.position];
            this.advance();
        }
        return this.create_token('whitespace', my_content, start_pos, start_line, start_column);
    }

    private read_directive_name(start_pos: number, start_line: number, start_column: number): SmclToken {
        let my_content = '';
        while (this.position < this.content.length && /[a-zA-Z0-9_]/.test(this.content[this.position])) {
            my_content += this.content[this.position];
            this.advance();
        }
        return this.create_token('directive_name', my_content, start_pos, start_line, start_column);
    }

    private read_text(start_pos: number, start_line: number, start_column: number): SmclToken {
        let my_content = '';
        while (this.position < this.content.length) {
            const my_char = this.content[this.position];
            if (my_char === '{' || my_char === '}' || my_char === '\n' || /\s/.test(my_char)) {
                break;
            }
            my_content += my_char;
            this.advance();
        }
        return this.create_token('text', my_content, start_pos, start_line, start_column);
    }

    private advance(): void {
        if (this.position < this.content.length) {
            if (this.content[this.position] === '\n') {
                this.line++;
                this.column = 1;
            } else {
                this.column++;
            }
            this.position++;
        }
    }

    private create_token(type: SmclTokenType, content: string, start_pos: number, start_line: number, start_column: number): SmclToken {
        return {
            type,
            content,
            start_pos,
            end_pos: this.position,
            line: start_line,
            column: start_column
        };
    }
}
import { SmclToken, SmclTokenType, SmclTokenizer } from './tokenizer.js';

export interface SmclDocument {
    directives: SmclDirective[];
    sections: Map<string, SmclSection>;
}

export interface SmclDirective {
    type: SmclDirectiveType;
    content: string;
    children?: SmclDirective[];
    attributes?: Record<string, string>;
    start_pos: number;
    end_pos: number;
}

export interface SmclSection {
    title: string;
    content: SmclDirective[];
    start_line: number;
    end_line: number;
}

export type SmclDirectiveType = 
    | 'smcl'      // File header
    | 'title'     // Section title
    | 'cmd'       // Command text
    | 'opt'       // Option text
    | 'synopt'    // Syntax option entry
    | 'synoptset' // Option table start
    | 'p_end'     // Paragraph end
    | 'help'      // Cross-reference
    | 'marker'    // Anchor
    | 'p'         // Paragraph
    | 'text';     // Plain text

export class SmclParser {
    private tokens: SmclToken[] = [];
    private position: number = 0;

    parse_content(content: string): SmclDocument {
        const my_tokenizer = new SmclTokenizer(content);
        this.tokens = my_tokenizer.tokenize();
        this.position = 0;

        const the_directives = this.parse_directives();
        const the_sections = this.extract_sections(the_directives);

        return {
            directives: the_directives,
            sections: the_sections
        };
    }

    private parse_directives(): SmclDirective[] {
        const the_directives: SmclDirective[] = [];

        while (!this.is_at_end()) {
            const my_directive = this.parse_directive();
            if (my_directive) {
                the_directives.push(my_directive);
            }
        }

        return the_directives;
    }

    private parse_directive(): SmclDirective | null {
        this.skip_whitespace_and_newlines();
        
        if (this.is_at_end()) {
            return null;
        }

        // Check for directive start
        if (this.current_token().type === 'directive_start') {
            return this.parse_smcl_directive();
        }

        // Parse plain text
        return this.parse_text_directive();
    }

    private parse_smcl_directive(): SmclDirective {
        const my_start_pos = this.current_token().start_pos;
        this.advance(); // consume '{'

        // Get directive name
        this.skip_whitespace();
        const my_name_token = this.current_token();
        if (my_name_token.type !== 'directive_name') {
            return this.create_text_directive('', my_start_pos, my_start_pos);
        }
        
        const my_directive_type = this.map_directive_type(my_name_token.content);
        this.advance(); // consume directive name

        // Skip optional colon
        this.skip_whitespace();
        if (this.current_token().type === 'colon') {
            this.advance();
        }

        // Parse content until closing brace
        let my_content = '';
        while (!this.is_at_end() && this.current_token().type !== 'directive_end') {
            const my_token = this.current_token();
            if (my_token.type === 'directive_start') {
                // Handle nested directives by treating them as text for now
                my_content += my_token.content;
            } else if (my_token.type !== 'whitespace' && my_token.type !== 'newline') {
                my_content += my_token.content;
            } else if (my_token.type === 'whitespace') {
                my_content += ' ';
            }
            this.advance();
        }

        let my_end_pos = this.current_token().start_pos;
        if (this.current_token().type === 'directive_end') {
            my_end_pos = this.current_token().end_pos;
            this.advance(); // consume '}'
        }

        return {
            type: my_directive_type,
            content: my_content.trim(),
            start_pos: my_start_pos,
            end_pos: my_end_pos
        };
    }

    private parse_text_directive(): SmclDirective {
        const my_start_pos = this.current_token().start_pos;
        let my_content = '';
        let my_end_pos = my_start_pos;

        while (!this.is_at_end() && this.current_token().type !== 'directive_start') {
            const my_token = this.current_token();
            if (my_token.type !== 'whitespace' && my_token.type !== 'newline') {
                my_content += my_token.content;
            } else if (my_token.type === 'whitespace') {
                my_content += ' ';
            } else if (my_token.type === 'newline') {
                my_content += '\n';
            }
            my_end_pos = my_token.end_pos;
            this.advance();
        }

        return this.create_text_directive(my_content.trim(), my_start_pos, my_end_pos);
    }

    private extract_sections(directives: SmclDirective[]): Map<string, SmclSection> {
        const the_sections = new Map<string, SmclSection>();
        let my_current_section: string | null = null;
        let my_section_content: SmclDirective[] = [];
        let my_section_start_line = 1;

        for (let i = 0; i < directives.length; i++) {
            const my_directive = directives[i];
            
            if (my_directive.type === 'title') {
                // Save previous section
                if (my_current_section) {
                    the_sections.set(my_current_section, {
                        title: my_current_section,
                        content: [...my_section_content],
                        start_line: my_section_start_line,
                        end_line: this.get_line_from_pos(my_directive.start_pos) - 1
                    });
                }

                // The title content is usually in the next text directive
                let my_title_text = '';
                if (i + 1 < directives.length && directives[i + 1].type === 'text') {
                    my_title_text = directives[i + 1].content;
                    i++; // Skip the text directive as we've consumed it
                }

                // Start new section
                my_current_section = my_title_text.toLowerCase();
                my_section_content = [];
                my_section_start_line = this.get_line_from_pos(my_directive.start_pos);
            } else if (my_current_section && my_directive.type !== 'p_end') {
                my_section_content.push(my_directive);
            }
        }

        // Save final section
        if (my_current_section) {
            the_sections.set(my_current_section, {
                title: my_current_section,
                content: my_section_content,
                start_line: my_section_start_line,
                end_line: this.tokens[this.tokens.length - 1]?.line || 1
            });
        }

        return the_sections;
    }

    private map_directive_type(name: string): SmclDirectiveType {
        const the_type_map: Record<string, SmclDirectiveType> = {
            'smcl': 'smcl',
            'title': 'title',
            'cmd': 'cmd',
            'opt': 'opt',
            'synopt': 'synopt',
            'synoptset': 'synoptset',
            'p_end': 'p_end',
            'help': 'help',
            'marker': 'marker',
            'p': 'p'
        };
        return the_type_map[name] || 'text';
    }

    private create_text_directive(content: string, start_pos: number, end_pos: number): SmclDirective {
        return {
            type: 'text',
            content,
            start_pos,
            end_pos
        };
    }

    private current_token(): SmclToken {
        return this.tokens[this.position] || { type: 'eof', content: '', start_pos: 0, end_pos: 0, line: 1, column: 1 };
    }

    private advance(): void {
        if (this.position < this.tokens.length - 1) {
            this.position++;
        }
    }

    private is_at_end(): boolean {
        return this.position >= this.tokens.length - 1 || this.current_token().type === 'eof';
    }

    private skip_whitespace(): void {
        while (this.current_token().type === 'whitespace') {
            this.advance();
        }
    }

    private skip_whitespace_and_newlines(): void {
        while (this.current_token().type === 'whitespace' || this.current_token().type === 'newline') {
            this.advance();
        }
    }

    private get_line_from_pos(pos: number): number {
        for (const my_token of this.tokens) {
            if (my_token.start_pos >= pos) {
                return my_token.line;
            }
        }
        return 1;
    }
}
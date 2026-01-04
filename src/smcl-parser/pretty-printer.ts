/**
 * SMCL Pretty Printer
 * 
 * Converts SMCL markup to readable text formats for hover tooltips and documentation.
 * Handles common SMCL directives and formatting.
 */

import { SmclTokenizer, SmclToken, SmclTokenType } from './tokenizer';

export interface SmclPrettyPrinter {
    to_plain_text(smcl: string): string;
    to_markdown(smcl: string): string;
}

export class SmclPrettyPrinterImpl implements SmclPrettyPrinter {
    /**
     * Convert SMCL to plain text by removing markup and formatting directives.
     */
    to_plain_text(smcl: string): string {
        const tokenizer = new SmclTokenizer(smcl);
        const the_tokens = tokenizer.tokenize();
        
        const parts = [];
        let i = 0;
        
        while (i < the_tokens.length) {
            const my_token = the_tokens[i];
            
            if (my_token.type === 'directive_start') {
                const directive_result = this.process_directive_plain(the_tokens, i);
                parts.push(directive_result.text);
                i = directive_result.next_index;
            } else if (my_token.type === 'text') {
                parts.push(my_token.content);
                i++;
            } else if (my_token.type === 'newline') {
                parts.push('\n');
                i++;
            } else if (my_token.type === 'whitespace') {
                parts.push(my_token.content);
                i++;
            } else if (my_token.type === 'directive_name') {
                // Handle directive names that appear outside of braces
                parts.push(my_token.content);
                i++;
            } else if (my_token.type === 'colon') {
                parts.push(':');
                i++;
            } else {
                i++;
            }
        }
        
        return this.clean_whitespace(parts.join(''));
    }

    /**
     * Convert SMCL to Markdown format.
     */
    to_markdown(smcl: string): string {
        const tokenizer = new SmclTokenizer(smcl);
        const the_tokens = tokenizer.tokenize();
        
        const parts = [];
        let i = 0;
        
        while (i < the_tokens.length) {
            const my_token = the_tokens[i];
            
            if (my_token.type === 'directive_start') {
                const directive_result = this.process_directive_markdown(the_tokens, i);
                parts.push(directive_result.text);
                i = directive_result.next_index;
            } else if (my_token.type === 'text') {
                parts.push(my_token.content);
                i++;
            } else if (my_token.type === 'newline') {
                parts.push('\n');
                i++;
            } else if (my_token.type === 'whitespace') {
                parts.push(my_token.content);
                i++;
            } else if (my_token.type === 'directive_name') {
                // Handle directive names that appear outside of braces
                parts.push(my_token.content);
                i++;
            } else if (my_token.type === 'colon') {
                parts.push(':');
                i++;
            } else {
                i++;
            }
        }
        
        return this.clean_whitespace(parts.join(''));
    }

    /**
     * Process SMCL directive for plain text output.
     */
    private process_directive_plain(the_tokens: SmclToken[], start_index: number): { text: string; next_index: number } {
        let i = start_index + 1; // Skip opening brace
        
        if (i >= the_tokens.length || the_tokens[i].type !== 'directive_name') {
            return { text: '{', next_index: start_index + 1 };
        }
        
        const directive_name = the_tokens[i].content;
        i++; // Skip directive name
        
        // Skip colon if present
        if (i < the_tokens.length && the_tokens[i].type === 'colon') {
            i++;
        }
        
        // Extract content until closing brace
        let content = '';
        while (i < the_tokens.length && the_tokens[i].type !== 'directive_end') {
            if (the_tokens[i].type === 'text') {
                content += the_tokens[i].content;
            } else if (the_tokens[i].type === 'whitespace') {
                content += the_tokens[i].content;
            } else if (the_tokens[i].type === 'newline') {
                content += '\n';
            } else if (the_tokens[i].type === 'directive_name') {
                content += the_tokens[i].content;
            } else if (the_tokens[i].type === 'colon') {
                content += ':';
            }
            i++;
        }
        
        if (i < the_tokens.length && the_tokens[i].type === 'directive_end') {
            i++; // Skip closing brace
        }
        
        return { text: this.format_directive_plain(directive_name, content), next_index: i };
    }

    /**
     * Process SMCL directive for Markdown output.
     */
    private process_directive_markdown(the_tokens: SmclToken[], start_index: number): { text: string; next_index: number } {
        let i = start_index + 1; // Skip opening brace
        
        if (i >= the_tokens.length || the_tokens[i].type !== 'directive_name') {
            return { text: '{', next_index: start_index + 1 };
        }
        
        const directive_name = the_tokens[i].content;
        i++; // Skip directive name
        
        // Skip colon if present
        if (i < the_tokens.length && the_tokens[i].type === 'colon') {
            i++;
        }
        
        // Extract content until closing brace
        let content = '';
        while (i < the_tokens.length && the_tokens[i].type !== 'directive_end') {
            if (the_tokens[i].type === 'text') {
                content += the_tokens[i].content;
            } else if (the_tokens[i].type === 'whitespace') {
                content += the_tokens[i].content;
            } else if (the_tokens[i].type === 'newline') {
                content += '\n';
            } else if (the_tokens[i].type === 'directive_name') {
                content += the_tokens[i].content;
            } else if (the_tokens[i].type === 'colon') {
                content += ':';
            }
            i++;
        }
        
        if (i < the_tokens.length && the_tokens[i].type === 'directive_end') {
            i++; // Skip closing brace
        }
        
        return { text: this.format_directive_markdown(directive_name, content), next_index: i };
    }

    /**
     * Format directive content for plain text output.
     */
    private format_directive_plain(directive: string, content: string): string {
        const trimmed_content = content.trim();
        
        switch (directive.toLowerCase()) {
            case 'cmd':
            case 'opt':
                return trimmed_content;
            case 'it':
                return trimmed_content;
            case 'bf':
                return trimmed_content;
            case 'ul':
                return trimmed_content;
            case 'title':
                return trimmed_content.toUpperCase();
            case 'p':
            case 'p_end':
                return '';
            case 'synopt':
                return `  ${trimmed_content}`;
            case 'synoptset':
                return '';
            case 'syntab':
                return `\n${trimmed_content}\n`;
            case 'help':
            case 'manhelp':
                return trimmed_content;
            default:
                return trimmed_content;
        }
    }

    /**
     * Format directive content for Markdown output.
     */
    private format_directive_markdown(directive: string, content: string): string {
        const trimmed_content = content.trim();
        
        switch (directive.toLowerCase()) {
            case 'cmd':
                return `\`${trimmed_content}\``;
            case 'opt':
                return `\`${trimmed_content}\``;
            case 'it':
                return `*${trimmed_content}*`;
            case 'bf':
                return `**${trimmed_content}**`;
            case 'ul':
                return `<u>${trimmed_content}</u>`;
            case 'title':
                return `# ${trimmed_content}`;
            case 'p':
            case 'p_end':
                return '';
            case 'synopt':
                return `- ${trimmed_content}`;
            case 'synoptset':
                return '';
            case 'syntab':
                return `\n## ${trimmed_content}\n`;
            case 'help':
                return `[${trimmed_content}]`;
            case 'manhelp':
                return `[${trimmed_content}]`;
            default:
                return trimmed_content;
        }
    }

    /**
     * Clean up excessive whitespace while preserving intentional formatting.
     */
    private clean_whitespace(text: string): string {
        let result = text
            .replace(/[ \t]+/g, ' ')           // Multiple spaces/tabs to single space
            .replace(/\n[ \t]+/g, '\n')       // Remove leading whitespace on lines
            .replace(/[ \t]+\n/g, '\n')       // Remove trailing whitespace on lines
            .replace(/\n{3,}/g, '\n\n');      // Multiple newlines to double newline
        
        // Only trim trailing whitespace, preserve leading indentation
        result = result.replace(/\s+$/, '');
        
        return result;
    }
}

// Export singleton instance
export const smcl_pretty_printer = new SmclPrettyPrinterImpl();
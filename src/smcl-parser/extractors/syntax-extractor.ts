import { SmclDocument, SmclDirective } from '../parser.js';

export interface CommandSyntax {
    pattern: string;
    required_elements: string[];
    optional_elements: string[];
}

export class SyntaxExtractor {
    extract_syntax(doc: SmclDocument): CommandSyntax[] {
        const my_syntax_section = doc.sections.get('syntax');
        if (!my_syntax_section) {
            return [];
        }

        const the_syntax_patterns: CommandSyntax[] = [];
        
        for (const my_directive of my_syntax_section.content) {
            if (my_directive.type === 'cmd' || my_directive.type === 'text') {
                const my_syntax = this.parse_syntax_pattern(my_directive.content);
                if (my_syntax) {
                    the_syntax_patterns.push(my_syntax);
                }
            }
        }

        return the_syntax_patterns;
    }

    private parse_syntax_pattern(pattern: string): CommandSyntax | null {
        if (!pattern.trim()) {
            return null;
        }

        const my_cleaned_pattern = this.clean_pattern(pattern);
        const my_required_elements = this.extract_required_elements(my_cleaned_pattern);
        const my_optional_elements = this.extract_optional_elements(my_cleaned_pattern);

        return {
            pattern: my_cleaned_pattern,
            required_elements: my_required_elements,
            optional_elements: my_optional_elements
        };
    }

    private clean_pattern(pattern: string): string {
        return pattern
            .replace(/\s+/g, ' ')
            .replace(/\{[^}]*\}/g, '')  // Remove SMCL directives
            .trim();
    }

    private extract_required_elements(pattern: string): string[] {
        const the_elements: string[] = [];
        const my_tokens = pattern.split(/\s+/);

        for (const my_token of my_tokens) {
            // Required elements are not in brackets or parentheses
            if (!my_token.includes('[') && !my_token.includes('(') && 
                !my_token.includes(',') && my_token.length > 0) {
                the_elements.push(my_token);
            }
        }

        return the_elements;
    }

    private extract_optional_elements(pattern: string): string[] {
        const the_elements: string[] = [];
        
        // Extract elements in square brackets [element]
        const my_bracket_matches = pattern.match(/\[([^\]]+)\]/g);
        if (my_bracket_matches) {
            for (const my_match of my_bracket_matches) {
                const my_content = my_match.slice(1, -1); // Remove brackets
                const my_tokens = my_content.split(/\s+/);
                for (const my_token of my_tokens) {
                    if (my_token.length > 0 && !my_token.includes(',')) {
                        the_elements.push(my_token);
                    }
                }
            }
        }

        return the_elements;
    }
}
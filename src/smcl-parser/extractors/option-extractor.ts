import { SmclDocument, SmclDirective } from '../parser.js';

export interface CommandOption {
    name: string;
    syntax: string;
    description: string;
    abbreviation?: string;
    min_abbreviation_length: number;
    value_type?: 'enum' | 'varname' | 'numlist' | 'string' | 'expression';
    enum_values?: string[];
}

export class OptionExtractor {
    extract_options(doc: SmclDocument): CommandOption[] {
        const my_options_section = doc.sections.get('options');
        if (!my_options_section) {
            return [];
        }

        const the_options: CommandOption[] = [];
        let my_current_option: Partial<CommandOption> | null = null;

        for (const my_directive of my_options_section.content) {
            if (my_directive.type === 'synopt') {
                // Save previous option
                if (my_current_option && my_current_option.name) {
                    the_options.push(this.finalize_option(my_current_option));
                }
                
                // Start new option
                my_current_option = this.parse_synopt(my_directive.content);
            } else if (my_directive.type === 'text' && my_current_option) {
                // Add to description
                my_current_option.description = (my_current_option.description || '') + ' ' + my_directive.content;
            }
        }

        // Save final option
        if (my_current_option && my_current_option.name) {
            the_options.push(this.finalize_option(my_current_option));
        }

        return the_options;
    }

    private parse_synopt(content: string): Partial<CommandOption> {
        // Parse synopt format: {synopt:{opt option_name(args)}}description{p_end}
        const my_cleaned = content.replace(/\{[^}]*\}/g, '').trim();
        const my_parts = my_cleaned.split(/\s+/);
        
        if (my_parts.length === 0) {
            return {};
        }

        const my_option_text = my_parts[0];
        const my_option_name = this.extract_option_name(my_option_text);
        const my_syntax = my_option_text;
        const my_value_type = this.detect_value_type(my_option_text);
        const my_enum_values = this.extract_enum_values(my_option_text);

        return {
            name: my_option_name,
            syntax: my_syntax,
            description: '',
            min_abbreviation_length: this.calculate_min_abbreviation(my_option_name),
            value_type: my_value_type,
            enum_values: my_enum_values
        };
    }

    private extract_option_name(option_text: string): string {
        // Extract option name before parentheses or other syntax
        const my_match = option_text.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
        return my_match ? my_match[1] : option_text;
    }

    private detect_value_type(option_text: string): CommandOption['value_type'] {
        if (option_text.includes('varname') || option_text.includes('varlist')) {
            return 'varname';
        }
        if (option_text.includes('numlist') || option_text.includes('#')) {
            return 'numlist';
        }
        if (option_text.includes('string') || option_text.includes('"')) {
            return 'string';
        }
        if (option_text.includes('|')) {
            return 'enum';
        }
        if (option_text.includes('(') && option_text.includes(')')) {
            return 'expression';
        }
        return undefined;
    }

    private extract_enum_values(option_text: string): string[] | undefined {
        // Extract enum values from syntax like "method(value1|value2|value3)"
        const my_enum_match = option_text.match(/\(([^)]*)\)/);
        if (my_enum_match && my_enum_match[1].includes('|')) {
            return my_enum_match[1].split('|').map(v => v.trim());
        }
        return undefined;
    }

    private calculate_min_abbreviation(option_name: string): number {
        // Simple heuristic: minimum 3 characters or half the length
        return Math.min(3, Math.ceil(option_name.length / 2));
    }

    private finalize_option(partial_option: Partial<CommandOption>): CommandOption {
        return {
            name: partial_option.name || '',
            syntax: partial_option.syntax || '',
            description: (partial_option.description || '').trim(),
            min_abbreviation_length: partial_option.min_abbreviation_length || 1,
            value_type: partial_option.value_type,
            enum_values: partial_option.enum_values
        };
    }
}
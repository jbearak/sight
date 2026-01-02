import { SmclDocument, SmclDirective } from '../parser.js';

export interface StoredResult {
    name: string;
    type: 'scalar' | 'matrix' | 'macro';
    result_class: 'e' | 'r' | 's';
    description: string;
}

export class StoredResultsExtractor {
    extract_stored_results(doc: SmclDocument): StoredResult[] {
        const the_stored_results: StoredResult[] = [];
        
        // Check multiple possible section names
        const the_section_names = [
            'stored results',
            'saved results', 
            'returned results',
            'results'
        ];

        for (const my_section_name of the_section_names) {
            const my_section = doc.sections.get(my_section_name);
            if (my_section) {
                the_stored_results.push(...this.extract_from_section(my_section.content));
            }
        }

        return the_stored_results;
    }

    private extract_from_section(directives: SmclDirective[]): StoredResult[] {
        const the_results: StoredResult[] = [];
        let my_current_description = '';

        for (const my_directive of directives) {
            if (my_directive.type === 'text' || my_directive.type === 'cmd') {
                const my_results = this.parse_stored_result_line(my_directive.content, my_current_description);
                the_results.push(...my_results);
                my_current_description = '';
            } else {
                my_current_description += ' ' + my_directive.content;
            }
        }

        return the_results;
    }

    private parse_stored_result_line(line: string, description: string): StoredResult[] {
        const the_results: StoredResult[] = [];
        
        // Match patterns like "e(N)", "r(mean)", "s(vars)"
        const my_result_pattern = /([ers])\(([^)]+)\)/g;
        let my_match;

        while ((my_match = my_result_pattern.exec(line)) !== null) {
            const my_result_class = my_match[1] as 'e' | 'r' | 's';
            const my_result_name = my_match[2];
            const my_full_name = `${my_result_class}(${my_result_name})`;
            
            // Extract description from the same line
            const my_line_description = this.extract_description_from_line(line, my_full_name);
            const my_final_description = my_line_description || description.trim();

            const my_result_type = this.detect_result_type(my_result_name, my_final_description);

            the_results.push({
                name: my_full_name,
                type: my_result_type,
                result_class: my_result_class,
                description: my_final_description
            });
        }

        return the_results;
    }

    private extract_description_from_line(line: string, result_name: string): string {
        // Find text after the result name
        const my_result_index = line.indexOf(result_name);
        if (my_result_index === -1) {
            return '';
        }

        const my_after_result = line.substring(my_result_index + result_name.length);
        return my_after_result.replace(/^\s*[:\-\s]+/, '').trim();
    }

    private detect_result_type(result_name: string, description: string): StoredResult['type'] {
        const my_lower_name = result_name.toLowerCase();
        const my_lower_desc = description.toLowerCase();

        // Matrix indicators
        if (my_lower_name.includes('matrix') || 
            my_lower_desc.includes('matrix') ||
            my_lower_name.includes('_b') ||
            my_lower_name.includes('_V')) {
            return 'matrix';
        }

        // Macro indicators
        if (my_lower_desc.includes('macro') ||
            my_lower_desc.includes('string') ||
            my_lower_name.includes('cmd') ||
            my_lower_name.includes('depvar')) {
            return 'macro';
        }

        // Default to scalar
        return 'scalar';
    }
}
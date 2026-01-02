import { SmclDocument, SmclDirective } from '../parser.js';

export interface CrossReference {
    target_command: string;
    reference_type: 'help' | 'manhelp' | 'see_also';
    manual_section?: string;
}

export class CrossReferenceExtractor {
    extract_cross_references(doc: SmclDocument): CrossReference[] {
        const the_references: CrossReference[] = [];

        // Extract from all directives
        for (const my_directive of doc.directives) {
            the_references.push(...this.extract_from_directive(my_directive));
        }

        // Extract from see also section specifically
        const my_see_also_section = doc.sections.get('also see') || doc.sections.get('see also');
        if (my_see_also_section) {
            the_references.push(...this.extract_see_also_references(my_see_also_section.content));
        }

        return this.deduplicate_references(the_references);
    }

    private extract_from_directive(directive: SmclDirective): CrossReference[] {
        const the_references: CrossReference[] = [];

        if (directive.type === 'help') {
            const my_reference = this.parse_help_directive(directive.content);
            if (my_reference) {
                the_references.push(my_reference);
            }
        } else if (directive.type === 'text') {
            // Look for inline help references in text
            the_references.push(...this.extract_inline_references(directive.content));
        }

        return the_references;
    }

    private parse_help_directive(content: string): CrossReference | null {
        // Parse {help command} or {manhelp command section}
        const my_trimmed = content.trim();
        
        if (my_trimmed.includes('manhelp')) {
            return this.parse_manhelp_reference(my_trimmed);
        } else {
            return this.parse_help_reference(my_trimmed);
        }
    }

    private parse_help_reference(content: string): CrossReference | null {
        // Extract command name from help reference
        const my_command_match = content.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (!my_command_match) {
            return null;
        }

        return {
            target_command: my_command_match[1],
            reference_type: 'help'
        };
    }

    private parse_manhelp_reference(content: string): CrossReference | null {
        // Parse "manhelp command section" format
        const my_parts = content.split(/\s+/);
        if (my_parts.length < 2) {
            return null;
        }

        const my_command = my_parts[0];
        const my_section = my_parts[1];

        return {
            target_command: my_command,
            reference_type: 'manhelp',
            manual_section: my_section
        };
    }

    private extract_inline_references(text: string): CrossReference[] {
        const the_references: CrossReference[] = [];
        
        // Look for {help command} patterns in text
        const my_help_pattern = /\{help\s+([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
        let my_match;

        while ((my_match = my_help_pattern.exec(text)) !== null) {
            the_references.push({
                target_command: my_match[1],
                reference_type: 'help'
            });
        }

        // Look for {manhelp command section} patterns
        const my_manhelp_pattern = /\{manhelp\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z]+)\}/g;
        while ((my_match = my_manhelp_pattern.exec(text)) !== null) {
            the_references.push({
                target_command: my_match[1],
                reference_type: 'manhelp',
                manual_section: my_match[2]
            });
        }

        return the_references;
    }

    private extract_see_also_references(directives: SmclDirective[]): CrossReference[] {
        const the_references: CrossReference[] = [];

        for (const my_directive of directives) {
            if (my_directive.type === 'text') {
                // Parse comma-separated list of commands
                const my_commands = this.parse_command_list(my_directive.content);
                for (const my_command of my_commands) {
                    the_references.push({
                        target_command: my_command,
                        reference_type: 'see_also'
                    });
                }
            } else if (my_directive.type === 'help') {
                const my_reference = this.parse_help_directive(my_directive.content);
                if (my_reference) {
                    my_reference.reference_type = 'see_also';
                    the_references.push(my_reference);
                }
            }
        }

        return the_references;
    }

    private parse_command_list(text: string): string[] {
        // Parse comma-separated command names, handling various formats
        const my_cleaned = text
            .replace(/\{[^}]*\}/g, '') // Remove SMCL directives
            .replace(/[()]/g, '')      // Remove parentheses
            .trim();

        if (!my_cleaned) {
            return [];
        }

        return my_cleaned
            .split(/[,;]/)
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cmd));
    }

    private deduplicate_references(references: CrossReference[]): CrossReference[] {
        const my_seen = new Set<string>();
        const the_unique_references: CrossReference[] = [];

        for (const my_ref of references) {
            const my_key = `${my_ref.target_command}:${my_ref.reference_type}:${my_ref.manual_section || ''}`;
            if (!my_seen.has(my_key)) {
                my_seen.add(my_key);
                the_unique_references.push(my_ref);
            }
        }

        return the_unique_references;
    }
}
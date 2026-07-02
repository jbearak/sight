export type OutOfScopeSymbolKind = 'local' | 'global' | 'variable';

export type OutOfScopeReason =
    | {
        kind: 'after_call_site';
        call_site_line_0: number;
        source_file: string;
    }
    | {
        kind: 'inheritance_excludes_locals';
        source_file: string;
    }
    | {
        kind: 'same_file_forward';
        defined_line_0: number;
    }
    | {
        kind: 'scope_isolated_in_program';
        program_names: string[];
        // When a do/run-called file ALSO defines the name (its locals
        // excluded by do/run semantics), name it so the message refers
        // to both facts instead of picking one.
        do_excluded_source_file?: string;
    };

function format_symbol_display_name(
    symbol_name: string,
    symbol_kind: OutOfScopeSymbolKind
): string {
    switch (symbol_kind) {
        case 'local':
            return `\`${symbol_name}'`;
        case 'global':
            return `$${symbol_name}`;
        case 'variable':
            return symbol_name;
    }
}

export function format_out_of_scope_message(
    symbol_name: string,
    symbol_kind: OutOfScopeSymbolKind,
    reason: OutOfScopeReason
): string {
    const display_name = format_symbol_display_name(
        symbol_name,
        symbol_kind
    );

    switch (reason.kind) {
        case 'after_call_site':
            return (
                `${display_name} is defined in ${reason.source_file} ` +
                `but after the call site (line ${reason.call_site_line_0 + 1})`
            );
        case 'inheritance_excludes_locals':
            return (
                `${display_name} is defined in ${reason.source_file} but ` +
                'local macros are not inherited via do or run ' +
                '(use include instead)'
            );
        case 'same_file_forward':
            return (
                `${display_name} is used before it is defined ` +
                `(line ${reason.defined_line_0 + 1})`
            );
        case 'scope_isolated_in_program': {
            const the_names = reason.program_names;
            const listed = the_names.length === 1
                ? `program ${the_names[0]}`
                : 'programs ' +
                    `${the_names.slice(0, -1).join(', ')} and ` +
                    `${the_names[the_names.length - 1]}`;
            const scope_part =
                `${display_name} is defined only inside ${listed}`;
            if (reason.do_excluded_source_file === undefined) {
                return scope_part;
            }
            return (
                `${scope_part} in this file; it is also defined in ` +
                `${reason.do_excluded_source_file} but local macros ` +
                'are not inherited via do or run (use include instead)'
            );
        }
    }
}

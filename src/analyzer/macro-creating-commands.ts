/**
 * Allowlist of built-in Stata commands that create macros via options.
 */

export interface MacroCreatingOption {
    /** Option name (full form) */
    name: string;
    /** Minimum abbreviation length (0 = no abbreviation) */
    min_abbreviation: number;
}

export interface MacroCreatingCommand {
    /** Command name (full form) */
    name: string;
    /** Minimum abbreviation length for the command (0 = no abbreviation) */
    min_abbreviation: number;
    /** Options that create local macros */
    local_options: MacroCreatingOption[];
    /** Options that create global macros */
    global_options: MacroCreatingOption[];
}

/**
 * Hardcoded allowlist of built-in commands that create macros via options.
 */
export const MACRO_CREATING_COMMANDS: MacroCreatingCommand[] = [
    {
        name: 'levelsof',
        min_abbreviation: 0,
        local_options: [{ name: 'local', min_abbreviation: 1 }],
        global_options: [{ name: 'global', min_abbreviation: 1 }],
    },
    {
        name: 'glevelsof',
        min_abbreviation: 0,
        local_options: [{ name: 'local', min_abbreviation: 5 }],
        global_options: [{ name: 'global', min_abbreviation: 0 }],
    },
];

/**
 * Check if a command name matches a macro-creating command (case-sensitive, with abbreviation support).
 */
export function find_macro_creating_command(cmd_name: string): MacroCreatingCommand | undefined {
    for (const cmd of MACRO_CREATING_COMMANDS) {
        if (cmd_name === cmd.name) return cmd;
        if (cmd.min_abbreviation > 0 && cmd_name.length >= cmd.min_abbreviation && cmd.name.startsWith(cmd_name)) {
            return cmd;
        }
    }
    return undefined;
}

/**
 * Check if an option name matches a macro-creating option (case-sensitive, with abbreviation support).
 */
export function matches_option(option_name: string, option_spec: MacroCreatingOption): boolean {
    if (option_name === option_spec.name) return true;
    if (option_spec.min_abbreviation > 0 && option_name.length >= option_spec.min_abbreviation && option_spec.name.startsWith(option_name)) {
        return true;
    }
    return false;
}

// Legacy exports for backward compatibility
export function isMacroCreatingCommand(command: string): boolean {
    return find_macro_creating_command(command) !== undefined;
}

export function expandMacroCreatingCommand(command: string): string | undefined {
    return find_macro_creating_command(command)?.name;
}

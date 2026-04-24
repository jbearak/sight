// Minimal command metadata types
export type StataVersion = 15 | 16 | 17 | 18;

/**
 * Represents an option in the command cache.
 */
export interface OptionInfo {
    /** Option name (e.g., "noconstant") */
    name: string;
    /** Minimum abbreviation length (e.g., 6 for "nocons" -> "noconstant") */
    min_abbreviation: number;
    /** Whether the option takes an argument (e.g., level(#)) */
    has_argument: boolean;
}

/**
 * Represents a subcommand for prefix commands (e.g., frame create, mi estimate).
 */
export interface SubcommandInfo {
    /** Subcommand name (e.g., "create", "estimate") */
    name: string;
    /** Minimum abbreviation length */
    min_abbreviation: number;
}

export interface CommandInfo {
    name: string;
    min_abbreviation: number;
    /** Options available for this command */
    options: OptionInfo[];
    /** Subcommands for prefix commands (e.g., frame create, mi estimate) */
    subcommands?: SubcommandInfo[];
    /** Priority tier for completion ordering (1=highest, 3=lowest) */
    priority?: 1 | 2 | 3;
    /**
     * Basename (without `.sthlp`) of the help file that actually documents
     * this command when different from `name`. Used by the
     * `sight/resolveSthlpFile` handler so topics like `local` resolve to
     * `macro.sthlp`. Left unset when the help file matches the command
     * name to keep the cache compact.
     */
    help_file?: string;
}

export interface CommandCache {
    version: StataVersion;
    commands: Record<string, CommandInfo>;
    abbreviations: Record<string, string>; // abbrev -> full_name
}

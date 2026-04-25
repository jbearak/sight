import { CommandCache, CommandInfo, StataVersion, SubcommandInfo } from './types';
import { CommandInfo as ProviderCommandInfo, SubcommandInfo as ProviderSubcommandInfo } from '../types';
import { get_command_priority } from './priority-tiers';
import { ADDON_COMMANDS } from './addon-commands';

export type { StataVersion } from './types';
export { CommandDatabase };

/**
 * Command Database for Sight
 * 
 * Provides fast command lookup, search, and abbreviation expansion
 * from pre-generated JSON cache files.
 */
class CommandDatabase {
    private cache: CommandCache | null = null;
    private cache_version: number = 0;
    private resolved_abbreviations: Record<string, string> = Object.create(null);
    
    // Pre-computed static completions (computed once, reused on every request)
    private all_commands_cached: ProviderCommandInfo[] | null = null;

    /**
     * Load command cache from JSON data.
     */
    load_cache(cache: CommandCache): void {
        // Sanitize cache objects to avoid prototype key collisions (e.g. "constructor").
        const commands_safe: Record<string, CommandInfo> = Object.create(null);
        const abbreviations_safe: Record<string, string> = Object.create(null);

        for (const [key, value] of Object.entries(cache.commands)) {
            commands_safe[key] = value;
        }
        for (const [key, value] of Object.entries(cache.abbreviations)) {
            abbreviations_safe[key] = value;
        }

        this.cache = {
            ...cache,
            commands: commands_safe,
            abbreviations: abbreviations_safe,
        };
        this.recompute_resolved_abbreviations();
        this.all_commands_cached = null; // Invalidate cached array
        this.cache_version++;
    }

    /**
     * Load addon commands into the database.
     */
    load_addon_commands(): void {
        if (!this.cache) {
            this.cache = {
                version: 18,
                commands: Object.create(null),
                abbreviations: Object.create(null)
            };
        }

        for (const addon_cmd of ADDON_COMMANDS) {
            const normalized = addon_cmd.name.toLowerCase();
            this.cache.commands[normalized] = addon_cmd;
        }
        this.recompute_resolved_abbreviations();
        this.all_commands_cached = null; // Invalidate cached array
        this.cache_version++;
    }

    /**
     * Get cache version for invalidation tracking.
     */
    get_cache_version(): number {
        return this.cache_version;
    }

    /**
     * Look up a command by exact name (case-insensitive).
     */
    lookup(name: string): ProviderCommandInfo | undefined {
        if (!this.cache) return undefined;
        
        const normalized = name.toLowerCase();
        
        // Try direct lookup (own properties only)
        if (Object.prototype.hasOwnProperty.call(this.cache.commands, normalized)) {
            const cmd = this.cache.commands[normalized];
            return this.to_provider_command_info(cmd);
        }

        // Try abbreviation expansion using the collision-aware resolution map.
        if (Object.prototype.hasOwnProperty.call(this.resolved_abbreviations, normalized)) {
            const full_name = this.resolved_abbreviations[normalized];
            if (Object.prototype.hasOwnProperty.call(this.cache.commands, full_name)) {
                return this.to_provider_command_info(this.cache.commands[full_name]);
            }
        }
        
        return undefined;
    }

    /**
     * Look up a command by name (alias for lookup).
     */
    lookup_command(name: string): CommandInfo | null {
        if (!this.cache) return null;
        
        const normalized = name.toLowerCase();
        
        if (Object.prototype.hasOwnProperty.call(this.cache.commands, normalized)) {
            return this.cache.commands[normalized];
        }

        if (Object.prototype.hasOwnProperty.call(this.resolved_abbreviations, normalized)) {
            const full_name = this.resolved_abbreviations[normalized];
            if (Object.prototype.hasOwnProperty.call(this.cache.commands, full_name)) {
                return this.cache.commands[full_name];
            }
        }
        
        return null;
    }

    /**
     * Get a command by name (case-insensitive).
     * Normalizes lookup name to lowercase before accessing commands object.
     */
    get_command(name: string): CommandInfo | undefined {
        if (!this.cache) return undefined;
        
        const normalized = name.toLowerCase();
        
        if (Object.prototype.hasOwnProperty.call(this.cache.commands, normalized)) {
            return this.cache.commands[normalized];
        }

        if (Object.prototype.hasOwnProperty.call(this.resolved_abbreviations, normalized)) {
            const full_name = this.resolved_abbreviations[normalized];
            if (Object.prototype.hasOwnProperty.call(this.cache.commands, full_name)) {
                return this.cache.commands[full_name];
            }
        }
        
        return undefined;
    }

    /**
     * Get subcommands for a prefix command (e.g., frame, mi).
     * Returns subcommands in provider format, or undefined if command has no subcommands.
     */
    get_subcommands(name: string): ProviderSubcommandInfo[] | undefined {
        const cmd = this.get_command(name);
        if (!cmd || !cmd.subcommands || cmd.subcommands.length === 0) {
            return undefined;
        }
        return cmd.subcommands.map(sub => ({
            name: sub.name,
            minAbbreviation: sub.name.substring(0, sub.min_abbreviation)
        }));
    }

    /**
     * Check if a command has subcommands (is a prefix command like frame, mi).
     */
    has_subcommands(name: string): boolean {
        const cmd = this.get_command(name);
        return !!(cmd && cmd.subcommands && cmd.subcommands.length > 0);
    }

    /**
     * Search for commands matching a prefix.
     */
    search(prefix: string): ProviderCommandInfo[] {
        if (!this.cache) return [];
        
        const normalized_prefix = prefix.toLowerCase();
        const the_results: ProviderCommandInfo[] = [];
        
        for (const my_cmd of Object.values(this.cache.commands)) {
            if (my_cmd.name.toLowerCase().startsWith(normalized_prefix)) {
                the_results.push(this.to_provider_command_info(my_cmd));
            }
        }
        
        return the_results;
    }

    /**
     * Get all commands (pre-computed, cached).
     * Returns the same array instance on repeated calls for efficiency.
     */
    get_all(): ProviderCommandInfo[] {
        if (!this.cache) return [];
        
        // Return cached array if available
        if (this.all_commands_cached) {
            return this.all_commands_cached;
        }
        
        // Compute and cache
        this.all_commands_cached = Object.values(this.cache.commands).map(cmd => 
            this.to_provider_command_info(cmd)
        );
        return this.all_commands_cached;
    }

    /**
     * Get all commands (raw format).
     */
    get_all_commands(): CommandInfo[] {
        if (!this.cache) return [];
        return Object.values(this.cache.commands);
    }

    /**
     * Expand an abbreviation to matching commands.
     */
    expand_abbreviation(abbrev: string): ProviderCommandInfo[] {
        if (!this.cache) return [];
        
        const normalized = abbrev.toLowerCase();
        const the_matches: ProviderCommandInfo[] = [];
        
        for (const my_cmd of Object.values(this.cache.commands)) {
            const cmd_name = my_cmd.name.toLowerCase();
            const min_len = my_cmd.min_abbreviation;
            
            // Check if abbrev is valid for this command:
            // 1. abbrev length >= min_abbreviation
            // 2. abbrev is a prefix of the command name
            if (normalized.length >= min_len && cmd_name.startsWith(normalized)) {
                the_matches.push(this.to_provider_command_info(my_cmd));
            }
        }
        
        return the_matches;
    }

    /**
     * Get formatted help content for a command.
     * Returns null since the minimal cache doesn't include SMCL help.
     */
    get_help_content(_name: string, _format: 'plain' | 'markdown'): string | null {
        // Minimal cache doesn't include help content
        // This would require loading the full CommandMetadata cache
        return null;
    }

    /**
     * Register a command (for compatibility with legacy API).
     */
    register(info: ProviderCommandInfo): void {
        this.register_raw(info);
        this.recompute_resolved_abbreviations();
        this.all_commands_cached = null; // Invalidate cached array
        this.cache_version++;
    }

    /**
     * Register multiple commands.
     */
    register_all(the_commands: ProviderCommandInfo[]): void {
        for (const my_cmd of the_commands) {
            this.register_raw(my_cmd);
        }
        this.recompute_resolved_abbreviations();
        this.all_commands_cached = null; // Invalidate cached array
        this.cache_version++;
    }

    private register_raw(info: ProviderCommandInfo): void {
        if (!this.cache) {
            this.cache = {
                version: 18,
                commands: Object.create(null),
                abbreviations: Object.create(null)
            };
        }

        const normalized = info.name.toLowerCase();

        const the_cache_options = (info.options || []).map(my_opt => ({
            name: my_opt.name,
            min_abbreviation: my_opt.minAbbreviation.length,
            has_argument: my_opt.hasArgument
        }));

        const the_cache_subcommands = info.subcommands?.map(sub => ({
            name: sub.name,
            min_abbreviation: sub.minAbbreviation.length
        }));

        const my_command_info: CommandInfo = {
            name: info.name,
            min_abbreviation: info.minAbbreviation.length,
            options: the_cache_options,
            subcommands: the_cache_subcommands,
            priority: info.priority || get_command_priority(info.name),
            help_file: info.helpFile
        };

        this.cache.commands[normalized] = my_command_info;
    }

    /**
     * Check if database has a command.
     */
    has(name: string): boolean {
        return this.lookup(name) !== undefined;
    }

    /**
     * Get number of commands.
     */
    get size(): number {
        if (!this.cache) return 0;
        return Object.keys(this.cache.commands).length;
    }

    /**
     * Get all command names (normalized, lowercase keys).
     */
    get_all_command_names(): string[] {
        if (!this.cache) return [];
        return Object.keys(this.cache.commands);
    }

    /**
     * Clear all commands.
     */
    clear(): void {
        this.cache = null;
        this.resolved_abbreviations = Object.create(null);
        this.all_commands_cached = null;
        this.cache_version++;
    }

    /**
     * Rebuilds the collision-aware abbreviation map.
     *
     * Phase 1 seeds from `cache.abbreviations` so hand-curated entries
     * survive. Phase 2 walks all commands in priority order; a stronger
     * candidate overrides a seed only on a strict priority win, so curated
     * cache mappings keep same-tier ties while still losing to a real higher
     * priority command.
     *
     * Exact command names are never placed in the map because direct
     * lookup precedence handles those. The sort order
     *
     *   priority -> min_abbreviation -> name length -> alphabetical
     *
     * keeps same-tier backfill deterministic.
     */
    private recompute_resolved_abbreviations(): void {
        this.resolved_abbreviations = Object.create(null);
        if (!this.cache) return;

        const exact_command_names = new Set(Object.keys(this.cache.commands));
        for (const [abbrev, full_name] of Object.entries(this.cache.abbreviations)) {
            if (exact_command_names.has(abbrev)) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(this.cache.commands, full_name)) {
                this.resolved_abbreviations[abbrev] = full_name;
            }
        }
        const the_sorted_commands = Object.values(this.cache.commands).sort(
            (cmd_a, cmd_b) => {
                const priority_a = cmd_a.priority || get_command_priority(cmd_a.name);
                const priority_b = cmd_b.priority || get_command_priority(cmd_b.name);
                if (priority_a !== priority_b) {
                    return priority_a - priority_b;
                }
                if (cmd_a.min_abbreviation !== cmd_b.min_abbreviation) {
                    return cmd_a.min_abbreviation - cmd_b.min_abbreviation;
                }
                if (cmd_a.name.length !== cmd_b.name.length) {
                    return cmd_a.name.length - cmd_b.name.length;
                }
                return cmd_a.name.localeCompare(cmd_b.name);
            }
        );

        for (const my_command of the_sorted_commands) {
            const normalized_name = my_command.name.toLowerCase();
            const my_priority =
                my_command.priority || get_command_priority(my_command.name);
            const min_len = Math.max(1, my_command.min_abbreviation);
            for (let i = min_len; i < normalized_name.length; i++) {
                const abbrev = normalized_name.substring(0, i);
                if (exact_command_names.has(abbrev)) {
                    continue;
                }
                if (!Object.prototype.hasOwnProperty.call(this.resolved_abbreviations, abbrev)) {
                    this.resolved_abbreviations[abbrev] = normalized_name;
                    continue;
                }

                const existing_name = this.resolved_abbreviations[abbrev];
                if (!Object.prototype.hasOwnProperty.call(this.cache.commands, existing_name)) {
                    this.resolved_abbreviations[abbrev] = normalized_name;
                    continue;
                }

                const existing_command = this.cache.commands[existing_name];
                const existing_priority =
                    existing_command.priority
                    || get_command_priority(existing_command.name);
                if (my_priority < existing_priority) {
                    this.resolved_abbreviations[abbrev] = normalized_name;
                }
            }
        }
    }

    /**
     * Convert internal CommandInfo to provider-compatible format.
     */
    private to_provider_command_info(cmd: CommandInfo): ProviderCommandInfo {
        // Map cache OptionInfo (min_abbreviation: number) to provider OptionInfo (minAbbreviation: string)
        const the_provider_options = (cmd.options || []).map(my_opt => ({
            name: my_opt.name,
            minAbbreviation: my_opt.name.substring(0, my_opt.min_abbreviation),
            hasArgument: my_opt.has_argument
        }));

        // Map cache SubcommandInfo to provider SubcommandInfo
        const the_provider_subcommands = cmd.subcommands?.map(sub => ({
            name: sub.name,
            minAbbreviation: sub.name.substring(0, sub.min_abbreviation)
        }));

        // Build provider command info, handling optional syntax
        const my_provider_info: ProviderCommandInfo = {
            name: cmd.name,
            minAbbreviation: cmd.name.substring(0, cmd.min_abbreviation),
            options: the_provider_options,
            subcommands: the_provider_subcommands,
            category: 'builtin',
            isBuiltin: true,
            priority: cmd.priority || get_command_priority(cmd.name),
            helpFile: cmd.help_file
        };

        return my_provider_info;
    }
}

// Export singleton instance
export const command_database = new CommandDatabase();

#!/usr/bin/env bun

// Manual cache generation script - run when needed, commit results
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { CommandCache, CommandInfo, OptionInfo, StataVersion } from '../src/command-database/types.js';
import { extract_commands_from_file, ExtractedCommand } from '../src/command-database/smcl-extractor.js';
import { BUILTIN_COMMANDS } from '../src/commands/builtin-commands.js';
// Note: Grammar sync removed - the TextMate grammar is now manually maintained
// with a richer structure (nested depth highlighting, categorized commands, etc.)
// See: .kiro/specs/textmate-grammar-enhancement/
import { get_command_priority } from '../src/command-database/priority-tiers.js';

const BATCH_SIZE = 100;  // Process 100 files concurrently

const COMMAND_ABBREVIATION_OVERRIDES: Record<string, string> = {
    di: 'display',
};

/**
 * Fundamental Stata commands that MUST be in the cache.
 * These are hardcoded as a safety net in case help file parsing misses them.
 */
const FUNDAMENTAL_COMMANDS = [
    // Programming constructs
    'local', 'global', 'tempvar', 'tempname', 'tempfile',
    'if', 'else', 'while', 'foreach', 'forvalues', 'args',
    // Prefix commands
    'by', 'bysort', 'quietly', 'noisily', 'capture',
    // Data manipulation pairs
    'generate', 'replace', 'drop', 'keep',
    'preserve', 'restore', 'sort', 'gsort',
    'destring', 'tostring', 'encode', 'decode',
    // Correlation commands
    'correlate', 'pwcorr',
    // File operations
    'do', 'run', 'use', 'save', 'clear', 'insheet',
    // Directory operations
    'cd', 'pwd',
    // Logging
    'log', 'cmdlog',
    // Multiple imputation
    'mi',
];

interface GenerateOptions {
    stata_path?: string;
    version: StataVersion;
    output_path: string;
    max_files?: number;  // Limit for testing
    force?: boolean;     // Override monotonicity check
}

interface GenerationResult {
    commands_generated: number;
    commands_previous: number;
    commands_added: number;
}

function find_stata_path(): string {
    const common_paths = [
        '/Applications/Stata',
        '/usr/local/stata',
        'C:\\Program Files\\Stata18',
        'C:\\Program Files\\Stata17'
    ];
    
    for (const my_path of common_paths) {
        try {
            statSync(my_path);
            return my_path;
        } catch {
            continue;
        }
    }
    throw new Error(`Stata not found in: ${common_paths.join(', ')}`);
}

/**
 * Build abbreviations map from commands.
 * Maps each valid abbreviation to its full command name.
 */
export function build_abbreviations(
    commands: Record<string, CommandInfo>
): Record<string, string> {
    const abbreviations: Record<string, string> = {};
    
    for (const [name, info] of Object.entries(commands)) {
        // Add all valid abbreviations with lowercase keys
        for (let i = info.min_abbreviation; i < name.length; i++) {
            const abbrev = name.substring(0, i).toLowerCase();
            if (!abbreviations[abbrev]) {
                abbreviations[abbrev] = name;
            }
        }
    }
    for (const [abbrev, command_name] of Object.entries(
        COMMAND_ABBREVIATION_OVERRIDES
    )) {
        const command_info = commands[command_name];
        if (
            command_info
            && abbrev.length >= command_info.min_abbreviation
            && command_name.startsWith(abbrev)
        ) {
            abbreviations[abbrev] = command_name;
        }
    }
    return abbreviations;
}

/**
 * Check that the new cache doesn't shrink compared to existing cache.
 * This prevents accidental loss of command coverage.
 */
function check_monotonicity(
    output_path: string,
    new_count: number,
    force: boolean
): { previous_count: number } {
    if (!existsSync(output_path)) {
        return { previous_count: 0 };
    }
    
    try {
        const existing_content = readFileSync(output_path, 'utf-8');
        const existing_cache = JSON.parse(existing_content) as CommandCache;
        const existing_count = Object.keys(existing_cache.commands).length;
        
        if (new_count < existing_count && !force) {
            throw new Error(
                `Cache would shrink from ${existing_count} to ${new_count} commands. ` +
                `Use --force to override.`
            );
        }
        
        return { previous_count: existing_count };
    } catch (error) {
        if (error instanceof SyntaxError) {
            // Invalid JSON in existing file, treat as no previous cache
            console.warn(`Warning: Existing cache file has invalid JSON, ignoring`);
            return { previous_count: 0 };
        }
        throw error;
    }
}

/**
 * Convert BUILTIN_COMMANDS OptionInfo format (minAbbreviation: string)
 * to cache format (min_abbreviation: number).
 */
export function convert_builtin_option_to_cache_format(
    builtin_opt: { name: string; minAbbreviation: string; hasArgument: boolean }
): OptionInfo {
    return {
        name: builtin_opt.name,
        min_abbreviation: builtin_opt.minAbbreviation.length,
        has_argument: builtin_opt.hasArgument
    };
}

/**
 * Merge options from SMCL extraction with BUILTIN_COMMANDS fallback.
 *
 * Priority:
 * 1. SMCL-extracted options (if any)
 * 2. BUILTIN_COMMANDS options (as fallback)
 *
 * @param smcl_options - Options extracted from SMCL help files
 * @param builtin_options - Options from BUILTIN_COMMANDS (provider format)
 * @returns Merged options in cache format
 */
export function merge_options(
    smcl_options: OptionInfo[],
    builtin_options: Array<{ name: string; minAbbreviation: string; hasArgument: boolean }> | undefined
): OptionInfo[] {
    // If SMCL extraction found options, use those
    if (smcl_options.length > 0) {
        return smcl_options;
    }
    
    // Otherwise, use BUILTIN_COMMANDS options if available
    if (builtin_options && builtin_options.length > 0) {
        return builtin_options.map(convert_builtin_option_to_cache_format);
    }
    
    return [];
}

function convert_builtin_subcommand_to_cache_format(
    builtin_subcommand: { name: string; minAbbreviation: string }
): { name: string; min_abbreviation: number } {
    return {
        name: builtin_subcommand.name,
        min_abbreviation: builtin_subcommand.minAbbreviation.length,
    };
}

export function apply_builtin_metadata_fallback(
    commands: Record<string, CommandInfo>
): { options_fallback_count: number; subcommands_fallback_count: number } {
    const builtin_map = new Map<string, typeof BUILTIN_COMMANDS[0]>();
    for (const my_cmd of BUILTIN_COMMANDS) {
        builtin_map.set(my_cmd.name.toLowerCase(), my_cmd);
    }

    let options_fallback_count = 0;
    let subcommands_fallback_count = 0;

    for (const [cmd_name, cmd_info] of Object.entries(commands)) {
        const builtin_info = builtin_map.get(cmd_name);
        if (!builtin_info) {
            continue;
        }

        if (builtin_info.options) {
            const merged = merge_options(cmd_info.options, builtin_info.options);
            if (merged.length > 0 && cmd_info.options.length === 0) {
                cmd_info.options = merged;
                options_fallback_count++;
            }
        }

        if (
            builtin_info.subcommands
            && builtin_info.subcommands.length > 0
            && (!cmd_info.subcommands || cmd_info.subcommands.length === 0)
        ) {
            cmd_info.subcommands = builtin_info.subcommands.map(
                convert_builtin_subcommand_to_cache_format
            );
            subcommands_fallback_count++;
        }
    }

    return { options_fallback_count, subcommands_fallback_count };
}

/**
 * Process a single file and extract all commands from it.
 * Uses the SMCL extractor to properly handle multi-command files.
 * Returns an array of [name, CommandInfo] tuples.
 */
async function extract_minimal_metadata(file_path: string): Promise<Array<[string, CommandInfo]>> {
    try {
        const result = extract_commands_from_file(file_path);
        
        // Log any warnings
        for (const my_warning of result.warnings) {
            console.warn(my_warning);
        }
        
        // Convert ExtractedCommand to [name, CommandInfo] tuples
        const the_tuples: Array<[string, CommandInfo]> = [];
        for (const my_cmd of result.commands) {
            // Skip invalid command names (e.g., "kap (2 raters)" documentation entries)
            if (!/^[a-z_][a-z0-9_]*$/i.test(my_cmd.name)) {
                continue;
            }

            // Convert ExtractedOption[] to OptionInfo[] for cache format
            const cache_options: OptionInfo[] = my_cmd.options.map(opt => ({
                name: opt.name,
                min_abbreviation: opt.min_abbreviation,
                has_argument: opt.has_argument
            }));
            
            // Normalize command name to lowercase for cache key
            const normalized_key = my_cmd.name.toLowerCase();
            
            the_tuples.push([
                normalized_key,
                {
                    name: my_cmd.name,
                    // syntax field removed - see smcl-syntax-cleanup spec
                    min_abbreviation: my_cmd.min_abbreviation,
                    options: cache_options,
                    priority: get_command_priority(my_cmd.name)
                }
            ]);
        }
        
        return the_tuples;
    } catch (error) {
        console.warn(`Failed to process ${file_path}: ${error}`);
        return [];
    }
}

/**
 * Add fundamental commands that may be missing from SMCL extraction.
 * Uses metadata from BUILTIN_COMMANDS when available.
 */
function add_fundamental_commands(
    commands: Record<string, CommandInfo>
): { added: string[]; from_builtin: string[] } {
    const added: string[] = [];
    const from_builtin: string[] = [];
    
    // Build a lookup map from BUILTIN_COMMANDS
    const builtin_map = new Map<string, typeof BUILTIN_COMMANDS[0]>();
    for (const my_cmd of BUILTIN_COMMANDS) {
        builtin_map.set(my_cmd.name.toLowerCase(), my_cmd);
    }
    
    for (const my_cmd_name of FUNDAMENTAL_COMMANDS) {
        // Normalize command name to lowercase for cache key
        const normalized_key = my_cmd_name.toLowerCase();
        
        if (!commands[normalized_key]) {
            // Try to get metadata from BUILTIN_COMMANDS
            const builtin_info = builtin_map.get(normalized_key);
            
            if (builtin_info) {
                // Use metadata from BUILTIN_COMMANDS
                // Convert minAbbreviation string to length
                const min_abbrev = builtin_info.minAbbreviation
                    ? builtin_info.minAbbreviation.length
                    : my_cmd_name.length;
                
                // Convert builtin options to cache format
                const cache_options = builtin_info.options
                    ? builtin_info.options.map(convert_builtin_option_to_cache_format)
                    : [];
                
                commands[normalized_key] = {
                    name: my_cmd_name,
                    // syntax field removed - see smcl-syntax-cleanup spec
                    min_abbreviation: min_abbrev,
                    options: cache_options,
                    priority: get_command_priority(my_cmd_name)
                };
                from_builtin.push(my_cmd_name);
            } else {
                // Use default metadata
                commands[normalized_key] = {
                    name: my_cmd_name,
                    // syntax field removed - see smcl-syntax-cleanup spec
                    min_abbreviation: my_cmd_name.length,
                    options: [],
                    priority: get_command_priority(my_cmd_name)
                };
            }
            added.push(my_cmd_name);
        }
    }
    
    return { added, from_builtin };
}

/**
 * Validate that all legacy BUILTIN_COMMANDS are present in the cache.
 * Logs warnings for any missing commands.
 */
function validate_legacy_commands(
    commands: Record<string, CommandInfo>
): { missing: string[]; present: number } {
    const missing: string[] = [];
    let present = 0;
    
    for (const my_builtin of BUILTIN_COMMANDS) {
        const cmd_name = my_builtin.name.toLowerCase();
        if (commands[cmd_name]) {
            present++;
        } else {
            missing.push(cmd_name);
        }
    }
    
    return { missing, present };
}

export async function generate_cache(options: GenerateOptions): Promise<{ cache: CommandCache; result: GenerationResult }> {
    const stata_path = options.stata_path || find_stata_path();
    const base_path = join(stata_path, 'ado', 'base');
    
    console.log(`Processing SMCL files from: ${base_path}`);
    
    const commands: Record<string, CommandInfo> = {};
    
    // Collect all file paths first
    const the_all_files: string[] = [];
    for (const my_letter of 'abcdefghijklmnopqrstuvwxyz_'.split('')) {
        const letter_dir = join(base_path, my_letter);
        try {
            const the_files = readdirSync(letter_dir).filter(f => f.endsWith('.sthlp'));
            for (const my_file of the_files) {
                the_all_files.push(join(letter_dir, my_file));
                if (options.max_files && the_all_files.length >= options.max_files) break;
            }
        } catch {
            // Directory doesn't exist, skip
        }
        if (options.max_files && the_all_files.length >= options.max_files) break;
    }
    
    console.log(`Found ${the_all_files.length} SMCL files to process`);
    
    // Process files in parallel batches of BATCH_SIZE
    let files_processed = 0;
    let commands_extracted = 0;
    
    for (let i = 0; i < the_all_files.length; i += BATCH_SIZE) {
        const my_batch = the_all_files.slice(i, i + BATCH_SIZE);
        const my_batch_results = await Promise.all(
            my_batch.map(file => extract_minimal_metadata(file))
        );
        
        // Collect results from this batch - now handles multiple commands per file
        for (const my_result of my_batch_results) {
            for (const [command_name, command_info] of my_result) {
                // Only add if not already present (first occurrence wins)
                if (!commands[command_name]) {
                    commands[command_name] = command_info;
                    commands_extracted++;
                }
            }
            if (my_result.length > 0) {
                files_processed++;
            }
        }
        
        // Progress reporting
        if (files_processed % 100 === 0 || i + BATCH_SIZE >= the_all_files.length) {
            console.log(`Processed ${files_processed} files, extracted ${commands_extracted} commands...`);
        }
    }
    
    console.log(`Extracted ${commands_extracted} commands from ${files_processed} files`);
    
    // Add fundamental commands that may be missing
    const { added: fundamental_added, from_builtin } = add_fundamental_commands(commands);
    if (fundamental_added.length > 0) {
        console.log(`\nAdded ${fundamental_added.length} fundamental commands:`);
        console.log(`  From BUILTIN_COMMANDS: ${from_builtin.join(', ') || 'none'}`);
        const from_default = fundamental_added.filter(c => !from_builtin.includes(c));
        if (from_default.length > 0) {
            console.log(`  With default metadata: ${from_default.join(', ')}`);
        }
    }
    
    const {
        options_fallback_count,
        subcommands_fallback_count,
    } = apply_builtin_metadata_fallback(commands);
    
    if (options_fallback_count > 0) {
        console.log(`\nApplied hardcoded options fallback to ${options_fallback_count} commands`);
    }
    if (subcommands_fallback_count > 0) {
        console.log(
            `Applied hardcoded subcommands fallback to ${subcommands_fallback_count} commands`
        );
    }
    
    // Validate legacy command coverage
    const { missing: legacy_missing, present: legacy_present } = validate_legacy_commands(commands);
    console.log(`\nLegacy command validation:`);
    console.log(`  Present: ${legacy_present}/${BUILTIN_COMMANDS.length}`);
    if (legacy_missing.length > 0) {
        console.warn(`  WARNING: Missing ${legacy_missing.length} legacy commands:`);
        for (const my_cmd of legacy_missing) {
            console.warn(`    - ${my_cmd}`);
        }
    }
    
    const total_commands = Object.keys(commands).length;
    
    // Check monotonicity before building final cache
    const { previous_count } = check_monotonicity(
        options.output_path,
        total_commands,
        options.force || false
    );
    
    const cache: CommandCache = {
        version: options.version,
        commands,
        abbreviations: build_abbreviations(commands)
    };
    
    const result: GenerationResult = {
        commands_generated: total_commands,
        commands_previous: previous_count,
        commands_added: total_commands - previous_count
    };
    
    return { cache, result };
}

// CLI interface
if (import.meta.main) {
    const the_args = process.argv.slice(2);
    const force = the_args.includes('--force');
    const the_positional_args = the_args.filter(arg => !arg.startsWith('--'));
    
    const version = parseInt(the_positional_args[0]) as StataVersion || 18;
    const output_path = the_positional_args[1] || `src/command-database/caches/v${version}.json`;
    const max_files = the_positional_args[2] ? parseInt(the_positional_args[2]) : undefined;
    
    console.log(`Generating cache for Stata ${version}...`);
    if (force) {
        console.log(`Force mode enabled - monotonicity check will be skipped`);
    }
    
    try {
        const { cache, result } = await generate_cache({ version, output_path, max_files, force });
        writeFileSync(output_path, `${JSON.stringify(cache, null, 2)}\n`);
        
        console.log(`\nCache written to: ${output_path}`);
        console.log(`Commands: ${Object.keys(cache.commands).length}`);
        console.log(`Abbreviations: ${Object.keys(cache.abbreviations).length}`);
        
        // Report monotonicity results
        if (result.commands_previous > 0) {
            console.log(`\nMonotonicity check:`);
            console.log(`  Previous commands: ${result.commands_previous}`);
            console.log(`  New commands: ${result.commands_generated}`);
            console.log(`  Commands added: ${result.commands_added >= 0 ? '+' : ''}${result.commands_added}`);
        }
        
        // Note: Grammar sync removed - the TextMate grammar is now manually maintained
        // with a richer structure (nested depth highlighting, categorized commands, etc.)
        // See: .kiro/specs/textmate-grammar-enhancement/
    } catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
    }
}

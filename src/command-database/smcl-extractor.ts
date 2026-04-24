/**
 * SMCL Command Extractor
 *
 * Extracts command names, abbreviations, and syntax patterns from Stata
 * SMCL help files. Handles multi-command files where a single .sthlp file
 * documents multiple commands (e.g., generate.sthlp documents both
 * `generate` and `replace`).
 */

import * as fs from 'fs';
import { get_line_text, get_line_count, compute_line_offsets } from '../utils/line-utils';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Represents an option extracted from an SMCL help file.
 */
export interface ExtractedOption {
    /** Option name (e.g., "noconstant") */
    name: string;
    /** Minimum abbreviation length (e.g., 5 for "nocons" -> "noconstant") */
    min_abbreviation: number;
    /** Brief description of the option */
    description: string;
    /** Whether the option takes an argument (e.g., level(#)) */
    has_argument: boolean;
    /** Argument type if has_argument is true (e.g., "#", "varname") */
    argument_type?: string;
}

/**
 * Represents a command extracted from an SMCL help file.
 */
export interface ExtractedCommand {
    /** Command name (e.g., "replace") */
    name: string;
    /** Minimum abbreviation length (e.g., 3 for "gen" -> "generate") */
    min_abbreviation: number;
    /** Syntax pattern for the command (deprecated - no longer extracted) */
    syntax?: string;
    /** Brief description of the command */
    description: string;
    /** Path to the source help file */
    source_file: string;
    /** Whether this is the primary command documented in the file */
    is_primary: boolean;
    /**
     * Whether this command had a {viewerdialog} tag in the help file.
     * Combined with `is_primary`, this is the strongest signal that the
     * current file is the canonical home of the command's help page.
     */
    has_viewerdialog: boolean;
    /**
     * Whether this command appears as the first token of a syntax paragraph
     * (i.e., `{p ...}{cmdab:...}` or `{p ...}{cmd:NAME}` with no intervening
     * alternation delimiters like `{c -(}`). This distinguishes files that
     * genuinely document the command (e.g. `macro.sthlp`'s `{cmdab:loc:al}`
     * leading a syntax paragraph) from files that merely reference it as
     * one alternative inside another command's syntax (e.g. `char.sthlp`'s
     * `{c -(}{cmdab:loc:al} | {cmdab:gl:obal}{c )-}`).
     */
    is_paragraph_lead: boolean;
    /** Options available for this command */
    options: ExtractedOption[];
}

/**
 * Result of extracting commands from an SMCL file.
 */
export interface ExtractionResult {
    /** Array of extracted commands */
    commands: ExtractedCommand[];
    /** Warnings encountered during extraction */
    warnings: string[];
}

/**
 * Intermediate representation of a command with abbreviation info.
 */
export interface CommandAbbreviation {
    /** Full command name */
    name: string;
    /** Minimum abbreviation length */
    min_abbrev: number;
}

// ============================================================================
// Non-Command Filtering
// ============================================================================

/**
 * Tokens that appear in syntax sections but are NOT actual Stata commands.
 * These are system matrix names, special tokens, or syntax keywords.
 */
const NON_COMMAND_TOKENS = new Set<string>([
    // System matrix names (used with get())
    '_b', 'vce', 'rr', 'cns',
    // Special tokens in expressions
    '_all', '_cons', '_asis', '_n', '_n', '_pi', '_rc',
    // Single underscore (not a command)
    '_',
    // Syntax keywords that appear in {cmd:...} but aren't commands
    'using', 'in', 'if', 'of', 'to', 'or', 'and', 'not',
    // Common non-command tokens found in help files (syntax placeholders)
    'varlist', 'varname', 'newvar', 'newvarlist', 'exp', 'numlist',
    'string', 'filename', 'filenamelist', 'name', 'namelist',
    'depvar', 'indepvars', 'term', 'eqname', 'matname',
    'anything', 'everything', 'nothing',
    // Note: "framework" was previously here as a workaround but is now handled
    // structurally by PREFIX_COMMANDS subcommand detection
]);

/**
 * Stata commands that take subcommands. When a {cmdab:...} pattern
 * immediately follows one of these in {cmd:PREFIX} form, it should
 * be treated as a subcommand, not a standalone command.
 */
export const PREFIX_COMMANDS = new Set<string>([
    'estat',
    'mi',
    'graph',
    'sts',
    'stcox',
    'streg',
    'me',
    'sem',
    'gsem',
    'bayes',
    'bayesmh',
    'collect',
    'dtable',
    'etable',
    'table',
    'meta',
    'fmm',
]);

// Module-level regex for prefix command detection (hoisted for performance)
const PREFIX_CMD_PATTERN = /\{cmd:([a-z_][a-z0-9_]*)\}/g;

/**
 * Check if a match position is preceded by a prefix command on the same line.
 * 
 * Looks backwards from the match index to find a {cmd:PREFIX} pattern
 * where PREFIX is a known prefix command. This handles both direct prefix
 * patterns like `{cmd:estat} {cmdab:...}` and colon-separated patterns like
 * `{cmd:bayes} [...] {cmd::} {opt reg:ress}`.
 * 
 * @param content - The full SMCL content
 * @param match_index - The starting index of the {cmdab:...} or {opt:...} match
 * @returns true if preceded by {cmd:PREFIX} where PREFIX is a known prefix command
 */
export function is_preceded_by_prefix_command(
    content: string,
    match_index: number
): boolean {
    // Find the start of the current line
    let line_start = match_index;
    while (line_start > 0 && content[line_start - 1] !== '\n') {
        line_start--;
    }

    // Get the text from line start to match position
    const line_before_match = content.substring(line_start, match_index);

    // Look for any {cmd:PREFIX} pattern on this line where PREFIX is a known prefix command
    // Reset lastIndex since we're reusing a module-level regex
    PREFIX_CMD_PATTERN.lastIndex = 0;
    let my_match: RegExpExecArray | null;
    while ((my_match = PREFIX_CMD_PATTERN.exec(line_before_match)) !== null) {
        // The regex only captures lowercase chars, so no need for toLowerCase()
        const prefix_name = my_match[1];
        if (PREFIX_COMMANDS.has(prefix_name)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a potential command name should be excluded from extraction.
 * 
 * Filters out:
 * - Known non-command tokens (system matrices, special tokens) - unless they have viewerdialog
 * - Internal utilities (commands starting with _ that aren't in viewerdialog)
 * - Single-character names (except known single-char commands)
 * 
 * @param name - The potential command name to check
 * @param has_viewerdialog - Whether this name was found in a viewerdialog tag
 * @param is_primary - Whether this is the primary command from the title
 * @returns true if the name should be excluded, false if it's a valid command
 */
export function should_exclude_command(
    name: string,
    has_viewerdialog: boolean,
    is_primary: boolean
): boolean {
    const lower_name = name.toLowerCase();

    // If it has viewerdialog, it's definitely a user-facing command
    // This takes precedence over other filters
    if (has_viewerdialog) {
        return false;
    }

    // If it's the primary command in the title, include it
    if (is_primary) {
        return false;
    }

    // Always exclude known non-command tokens (unless they had viewerdialog above)
    if (NON_COMMAND_TOKENS.has(lower_name)) {
        return true;
    }

    // Single-character names are almost never commands
    // Exception: 'q' (quit) is a real command
    if (lower_name.length === 1 && lower_name !== 'q') {
        return true;
    }

    // Commands starting with _ are internal utilities
    // Only include them if they have viewerdialog (checked above) or are primary (checked above)
    if (lower_name.startsWith('_')) {
        return true;
    }

    return false;
}

// ============================================================================
// Regex Patterns
// ============================================================================

/**
 * Pattern 1: viewerdialog - indicates command has dialog interface.
 * Both quoted (`{viewerdialog "replace" "dialog replace"}`) and
 * unquoted (`{viewerdialog encode "dialog encode"}`) first-name
 * forms appear in the wild, and both are accepted here.
 */
export const VIEWERDIALOG_PATTERN =
    /\{viewerdialog\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*(?:\s+[a-z_][a-z0-9_]*)*))\s+"dialog\s+[^"]+"\}/gi;

/**
 * Pattern 2: cmdab - command with abbreviation
 * Example: {cmdab:gl:obal} means "global" with min abbreviation "gl" (length 2)
 */
export const CMDAB_PATTERN = /\{cmdab:([a-z]+):([a-z]+)\}/gi;

/**
 * Pattern 3: cmd - command without abbreviation info
 * Example: {cmd:replace}
 */
export const CMD_PATTERN = /\{cmd:([a-z_][a-z0-9_]*)\}/gi;

/**
 * Pattern 4: opt - option/command with abbreviation
 * Example: {opt g:enerate} means "generate" with min abbreviation "g" (length 1)
 */
export const OPT_PATTERN = /\{opt\s+([a-z]+):([a-z]+)\}/gi;

/**
 * Pattern 5: Title line - primary command in the help file
 * Example: {p2col:{bf:[D] generate} {hline 2}}
 */
export const TITLE_PATTERN = /\{p2col:\{bf:\[[A-Z0-9-]+\]\s+([a-z_][a-z0-9_]*)\}/i;

// ============================================================================
// Option Extraction Patterns
// ============================================================================

/**
 * Pattern for {opt abbrev:rest} - option with abbreviation (no argument)
 * Example: {opt nocons:tant} -> name="noconstant", min_abbrev=6
 * Groups: 1=abbreviation, 2=rest of name
 */
export const OPT_ABBREV_PATTERN = /\{opt\s+([a-z][a-z0-9_]*):([a-z0-9_]+)\}/gi;

/**
 * Pattern for {opt name} - option without abbreviation (no argument)
 * Example: {opt plus} -> name="plus", min_abbrev=4
 * Group: 1=full name
 */
export const OPT_SIMPLE_PATTERN = /\{opt\s+([a-z][a-z0-9_]*)\}/gi;

/**
 * Pattern for {opt name(argtype)} - option with argument (no abbreviation)
 * Example: {opt level(#)} -> name="level", has_argument=true, argument_type="#"
 * Groups: 1=name, 2=argument type
 */
export const OPT_ARG_PATTERN = /\{opt\s+([a-z][a-z0-9_]*)\(([^)]+)\)\}/gi;

/**
 * Pattern for {opt abbrev:rest(argtype)} - option with abbreviation and argument
 * Example: {opt l:evel(#)} -> name="level", min_abbrev=1, has_argument=true
 * Groups: 1=abbreviation, 2=rest, 3=argument type
 */
export const OPT_ABBREV_ARG_PATTERN = /\{opt\s+([a-z][a-z0-9_]*):([a-z0-9_]+)\(([^)]+)\)\}/gi;

/**
 * Pattern for {opth abbrev:rest(argtype)} - hyperlinked option with abbreviation and argument
 * Example: {opth ef:orm(string)} -> name="eform", min_abbrev=2, has_argument=true
 * Groups: 1=abbreviation, 2=rest, 3=argument type
 */
export const OPTH_ABBREV_ARG_PATTERN = /\{opth\s+([a-z][a-z0-9_]*):([a-z0-9_]+)\(([^)]+)\)\}/gi;

/**
 * Pattern for {opth name(argtype)} - hyperlinked option with argument (no abbreviation)
 * Example: {opth vce(vcetype)} -> name="vce", has_argument=true
 * Groups: 1=name, 2=argument type
 */
export const OPTH_ARG_PATTERN = /\{opth\s+([a-z][a-z0-9_]*)\(([^)]+)\)\}/gi;

/**
 * Pattern for {synopt :{...}} wrapper - extracts the inner tag(s) and description.
 *
 * Most commonly, the inner content is an {opt ...} or {opth ...} tag.
 * Some help files (notably merge.sthlp) use cmd-based tags inside synopt rows,
 * e.g. {synopt :{cmd:assert(}{help ...}{cmd:)}}...
 *
 * Groups:
 * 1 = inner tag content (one or more SMCL tags)
 * 2 = description text
 */
export const SYNOPT_WRAPPER_PATTERN =
    /\{synopt\s*:\s*((?:\{opt[h]?\s+[^}]+\}|\{cmd:[^}]+\})(?:\{[^}]+\})*)\s*\}([^{]*(?:\{(?!p_end)[^}]*\}[^{]*)*)/gi;

/**
 * Pattern for {opt[h] abbrev:rest:(topic:display)} - hyperlinked argument with abbreviation
 * Example: {opth ef:orm:(strings:string)} -> name="eform", min_abbrev=2, has_argument=true
 * Groups: 1=abbreviation, 2=rest, 3=hyperlinked argument content
 *
 * Note: Uses [^)]+ which works for all real Stata help files. Nested parentheses in
 * topic references are not used in practice.
 */
export const OPT_ABBREV_HYPERLINK_ARG_PATTERN =
    /\{opt[h]?\s+([a-z][a-z0-9_]*):([a-z0-9_]+):\(([^)]+)\)\}/i;

/**
 * Pattern for {opt[h] name:(topic:display)} - hyperlinked argument without abbreviation
 * Example: {opth vce:(regress##vcetype:vcetype)} -> name="vce", has_argument=true
 * Groups: 1=name, 2=hyperlinked argument content
 *
 * Note: Uses [^)]+ which works for all real Stata help files. Nested parentheses in
 * topic references are not used in practice.
 */
export const OPT_HYPERLINK_ARG_PATTERN =
    /\{opt[h]?\s+([a-z][a-z0-9_]*):\(([^)]+)\)\}/i;

// ============================================================================
// Compiled RegExp Constants
// ============================================================================

const VIEWERDIALOG_REGEX = new RegExp(VIEWERDIALOG_PATTERN.source, 'gi');
const CMDAB_REGEX = new RegExp(CMDAB_PATTERN.source, 'gi');
const OPT_REGEX = new RegExp(OPT_PATTERN.source, 'gi');
const SYNOPT_WRAPPER_REGEX = new RegExp(SYNOPT_WRAPPER_PATTERN.source, 'gi');

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract command names from {viewerdialog} tags.
 *
 * @param content - SMCL file content
 * @returns Array of command names found in viewerdialog tags
 */
export function extract_viewerdialog_commands(content: string): string[] {
    const the_commands: string[] = [];
    // Reset lastIndex to ensure we start from the beginning
    VIEWERDIALOG_REGEX.lastIndex = 0;

    let my_match: RegExpExecArray | null;
    while ((my_match = VIEWERDIALOG_REGEX.exec(content)) !== null) {
        // my_match[1] captures the quoted form, my_match[2] the unquoted.
        const my_command_name = my_match[1] ?? my_match[2];
        if (my_command_name && !the_commands.includes(my_command_name)) {
            the_commands.push(my_command_name);
        }
    }

    return the_commands;
}

/**
 * Extract commands with abbreviation info from {cmdab:} and {opt} patterns.
 *
 * Skips patterns that immediately follow a known prefix command (e.g.,
 * {cmd:estat} {cmdab:fra:mework} - "framework" is a subcommand, not standalone).
 *
 * @param content - SMCL file content
 * @param include_opt_patterns - Whether to also extract from {opt} patterns
 * @returns Array of command names with their minimum abbreviation lengths
 */
export function extract_cmdab_patterns(
    content: string,
    include_opt_patterns: boolean = true
): CommandAbbreviation[] {
    const the_commands: CommandAbbreviation[] = [];
    const seen_names = new Set<string>();

    // Extract from {cmdab:abbr:full} patterns
    CMDAB_REGEX.lastIndex = 0;
    let my_match: RegExpExecArray | null;

    while ((my_match = CMDAB_REGEX.exec(content)) !== null) {
        const my_abbrev = my_match[1];
        const my_suffix = my_match[2];
        const my_full_name = my_abbrev + my_suffix;
        const my_match_index = my_match.index;

        // Skip if this pattern is preceded by a prefix command (it's a subcommand)
        if (is_preceded_by_prefix_command(content, my_match_index)) {
            continue;
        }

        if (!seen_names.has(my_full_name.toLowerCase())) {
            seen_names.add(my_full_name.toLowerCase());
            the_commands.push({
                name: my_full_name.toLowerCase(),
                min_abbrev: my_abbrev.length
            });
        }
    }

    if (include_opt_patterns) {
        // Extract from {opt abbr:full} patterns.
        // Help files sometimes use {opt ...} to display command abbreviations
        // (e.g., {opt mer:ge} in merge.sthlp). We MUST NOT enable this for
        // full-file scans, or we'd treat option lists as commands.
        OPT_REGEX.lastIndex = 0;

        while ((my_match = OPT_REGEX.exec(content)) !== null) {
            const my_abbrev = my_match[1];
            const my_suffix = my_match[2];
            const my_full_name = my_abbrev + my_suffix;
            const my_match_index = my_match.index;

            // Skip if this pattern is preceded by a prefix command (it's a subcommand)
            if (is_preceded_by_prefix_command(content, my_match_index)) {
                continue;
            }

            if (!seen_names.has(my_full_name.toLowerCase())) {
                seen_names.add(my_full_name.toLowerCase());
                the_commands.push({
                    name: my_full_name.toLowerCase(),
                    min_abbrev: my_abbrev.length
                });
            }
        }
    }

    return the_commands;
}

/**
 * Extract the Syntax section from SMCL content.
 *
 * Looks for content between {marker syntax} (or {title:Syntax}) and the
 * next {marker} or {title:} tag.
 *
 * @param content - SMCL file content
 * @returns The syntax section content, or empty string if not found
 */
export function extract_syntax_section(content: string): string {
    // Prefer {marker syntax} (which often appears as {marker syntax}{...})
    const marker_regex = /\{marker\s+syntax\}[^\n]*\n?/i;
    const title_regex = /\{title:\s*Syntax\s*\}[^\n]*\n?/i;

    let syntax_start = -1;
    let start_offset = 0;

    const marker_match = marker_regex.exec(content);
    if (marker_match && marker_match.index !== undefined) {
        syntax_start = marker_match.index;
        start_offset = marker_match[0].length;
    } else {
        const title_match = title_regex.exec(content);
        if (title_match && title_match.index !== undefined) {
            syntax_start = title_match.index;
            start_offset = title_match[0].length;
        }
    }

    if (syntax_start === -1) {
        return '';
    }

    let content_after_start = content.substring(syntax_start + start_offset);

    // Many help files have a {title:Syntax} line immediately after {marker syntax}.
    // If so, consume it so we don't immediately terminate the section.
    const leading_title_match = content_after_start.match(/^\s*\{title:\s*Syntax\s*\}[^\n]*\n?/i);
    if (leading_title_match) {
        content_after_start = content_after_start.substring(leading_title_match[0].length);
    }

    // Find the end of the syntax section (next {marker ...} or {title:...}).
    const marker_end_match = content_after_start.match(/\{marker\s+[^}]+\}/i);
    const title_end_match = content_after_start.match(/\{title:[^}]+\}/i);

    let end_offset = content_after_start.length;

    if (marker_end_match && marker_end_match.index !== undefined) {
        end_offset = Math.min(end_offset, marker_end_match.index);
    }

    if (title_end_match && title_end_match.index !== undefined) {
        end_offset = Math.min(end_offset, title_end_match.index);
    }

    return content_after_start.substring(0, end_offset);
}

/**
 * Extract the Options section from SMCL content.
 *
 * Looks for content between {marker options} (or {title:Options}) and the
 * next {marker} or {title:} tag. Handles {dlgtab:} subsections within
 * the Options section.
 *
 * @param content - SMCL file content
 * @returns The options section content, or empty string if not found
 */
export function extract_options_section(content: string): string {
    // Try to find {marker options} first (case-insensitive)
    let options_start = -1;
    let start_offset = 0;

    // Try {marker options}
    const marker_options_regex = /\{marker\s+options\}/i;
    const marker_match = content.match(marker_options_regex);
    if (marker_match && marker_match.index !== undefined) {
        options_start = marker_match.index;
        start_offset = marker_match[0].length;
    }

    // If not found, try {title:Options}
    if (options_start === -1) {
        const title_options_regex = /\{title:\s*Options\s*\}/i;
        const title_match = content.match(title_options_regex);
        if (title_match && title_match.index !== undefined) {
            options_start = title_match.index;
            start_offset = title_match[0].length;
        }
    }

    if (options_start === -1) {
        return '';
    }

    // Find the end of the options section (next {marker} or {title:})
    const content_after_start = content.substring(options_start + start_offset);

    // Look for the next section marker (but not {marker options} itself)
    // Also skip {dlgtab:} which are subsections within Options
    const next_marker_regex = /\{marker\s+(?!options)[^}]+\}/i;
    const next_title_regex = /\{title:(?!\s*Options)[^}]+\}/i;

    const marker_end_match = content_after_start.match(next_marker_regex);
    const title_end_match = content_after_start.match(next_title_regex);

    let end_offset = content_after_start.length;

    if (marker_end_match && marker_end_match.index !== undefined) {
        end_offset = Math.min(end_offset, marker_end_match.index);
    }

    if (title_end_match && title_end_match.index !== undefined) {
        end_offset = Math.min(end_offset, title_end_match.index);
    }

    return content_after_start.substring(0, end_offset);
}

/**
 * Strip SMCL tags from text and normalize whitespace.
 *
 * @param text - Text potentially containing SMCL tags
 * @returns Clean text with tags removed and whitespace normalized
 */
export function strip_smcl_tags(text: string): string {
    // Remove all {tag} and {tag:content} patterns
    let cleaned = text.replace(/\{[^}]*\}/g, '');
    // Normalize whitespace (multiple spaces/newlines to single space)
    cleaned = cleaned.replace(/\s+/g, ' ');
    // Trim leading/trailing whitespace
    return cleaned.trim();
}

/**
 * Parse a single option pattern and return ExtractedOption or null.
 *
 * Handles all pattern variants:
 * - {opt abbrev:rest} - option with abbreviation
 * - {opt name} - simple option
 * - {opt name(argtype)} - option with argument
 * - {opt abbrev:rest(argtype)} - option with abbreviation and argument
 * - {opth ...} variants (same patterns but hyperlinked)
 *
 * @param pattern - The {opt} or {opth} pattern string
 * @param description_text - Optional description text following the pattern
 * @returns ExtractedOption or null if pattern is malformed
 */
export function parse_option_pattern(
    pattern: string,
    description_text: string = ''
): ExtractedOption | null {
    // Clean the description
    const cleaned_description = strip_smcl_tags(description_text)
        .substring(0, 200);

    // Support cmd-based synopt option forms like:
    //   {cmd:assert(}{help ...}{cmd:)}
    //   {cmd:keep(}{help ...}{cmd:)}
    // We only attempt this in a very narrow form to avoid false positives.
    const trimmed_pattern = pattern.trim();
    if (trimmed_pattern.startsWith('{cmd:')) {
        const cmd_arg_match = trimmed_pattern.match(/\{cmd:([a-z][a-z0-9_]*)\(\}/i);
        if (cmd_arg_match) {
            const name = cmd_arg_match[1];
            return {
                name: name.toLowerCase(),
                min_abbreviation: name.length,
                description: cleaned_description,
                has_argument: true
            };
        }

        const cmd_simple_match = trimmed_pattern.match(/\{cmd:([a-z][a-z0-9_]*)\}/i);
        if (cmd_simple_match) {
            const name = cmd_simple_match[1];
            return {
                name: name.toLowerCase(),
                min_abbreviation: name.length,
                description: cleaned_description,
                has_argument: false
            };
        }
    }

    // Try {opt abbrev:rest:(topic:display)} or {opth abbrev:rest:(topic:display)} first
    // This is the hyperlinked argument format with abbreviation (most specific)
    const abbrev_hyperlink_arg_match = pattern.match(OPT_ABBREV_HYPERLINK_ARG_PATTERN);
    if (abbrev_hyperlink_arg_match) {
        const abbrev = abbrev_hyperlink_arg_match[1];
        const rest = abbrev_hyperlink_arg_match[2];
        const arg_content = abbrev_hyperlink_arg_match[3];
        return {
            name: (abbrev + rest).toLowerCase(),
            min_abbreviation: abbrev.length,
            description: cleaned_description,
            has_argument: true,
            argument_type: arg_content
        };
    }

    // Try {opt name:(topic:display)} or {opth name:(topic:display)}
    // This is the hyperlinked argument format without abbreviation
    const hyperlink_arg_match = pattern.match(OPT_HYPERLINK_ARG_PATTERN);
    if (hyperlink_arg_match) {
        const name = hyperlink_arg_match[1];
        const arg_content = hyperlink_arg_match[2];
        return {
            name: name.toLowerCase(),
            min_abbreviation: name.length,
            description: cleaned_description,
            has_argument: true,
            argument_type: arg_content
        };
    }

    // Try {opt abbrev:rest(argtype)} or {opth abbrev:rest(argtype)} (abbreviation with simple argument)
    const abbrev_arg_match = pattern.match(
        /\{opt[h]?\s+([a-z][a-z0-9_]*):([a-z0-9_]+)\(([^)]+)\)\}/i
    );
    if (abbrev_arg_match) {
        const abbrev = abbrev_arg_match[1];
        const rest = abbrev_arg_match[2];
        const arg_type = abbrev_arg_match[3];
        return {
            name: (abbrev + rest).toLowerCase(),
            min_abbreviation: abbrev.length,
            description: cleaned_description,
            has_argument: true,
            argument_type: arg_type
        };
    }

    // Try {opt abbrev:rest} or {opth abbrev:rest} (no argument)
    const abbrev_match = pattern.match(
        /\{opt[h]?\s+([a-z][a-z0-9_]*):([a-z0-9_]+)\}/i
    );
    if (abbrev_match) {
        const abbrev = abbrev_match[1];
        const rest = abbrev_match[2];
        return {
            name: (abbrev + rest).toLowerCase(),
            min_abbreviation: abbrev.length,
            description: cleaned_description,
            has_argument: false
        };
    }

    // Try {opt name(argtype)} or {opth name(argtype)} (argument, no abbreviation)
    const arg_match = pattern.match(
        /\{opt[h]?\s+([a-z][a-z0-9_]*)\(([^)]+)\)\}/i
    );
    if (arg_match) {
        const name = arg_match[1];
        const arg_type = arg_match[2];
        return {
            name: name.toLowerCase(),
            min_abbreviation: name.length,
            description: cleaned_description,
            has_argument: true,
            argument_type: arg_type
        };
    }

    // Try {opt name} or {opth name} (simple, no argument, no abbreviation)
    const simple_match = pattern.match(
        /\{opt[h]?\s+([a-z][a-z0-9_]*)\}/i
    );
    if (simple_match) {
        const name = simple_match[1];
        return {
            name: name.toLowerCase(),
            min_abbreviation: name.length,
            description: cleaned_description,
            has_argument: false
        };
    }

    // Pattern is malformed
    return null;
}

/**
 * Extract all options from an Options section.
 *
 * Finds all option patterns ({opt}, {opth}, {synopt:{opt ...}}) in the section,
 * parses each one, deduplicates by name (first occurrence wins), and skips
 * malformed patterns gracefully.
 *
 * @param options_section - The Options section content
 * @returns Array of ExtractedOption objects
 */
export function extract_options_from_section(
    options_section: string
): ExtractedOption[] {
    const the_options: ExtractedOption[] = [];
    const seen_names = new Set<string>();

    // First, try to extract from {synopt:{opt ...}} wrappers (most common format)
    SYNOPT_WRAPPER_REGEX.lastIndex = 0;
    let my_match: RegExpExecArray | null;

    while ((my_match = SYNOPT_WRAPPER_REGEX.exec(options_section)) !== null) {
        const inner_opt_tag = my_match[1];
        const description_text = my_match[2] || '';

        const my_option = parse_option_pattern(inner_opt_tag, description_text);
        if (my_option && !seen_names.has(my_option.name)) {
            seen_names.add(my_option.name);
            the_options.push(my_option);
        }
    }

    // Also look for standalone {opt} and {opth} patterns not in synopt wrappers
    // We need to find patterns that weren't already captured by synopt
    // Match {opt ...} or {opth ...} followed by optional description text

    // Pattern to find {opt}/{opth} tags with following text up to {p_end} or newline
    const standalone_pattern = /\{(opt[h]?)\s+([^}]+)\}([^{]*)/gi;

    while ((my_match = standalone_pattern.exec(options_section)) !== null) {
        const full_tag = `{${my_match[1]} ${my_match[2]}}`;
        const description_text = my_match[3] || '';

        const my_option = parse_option_pattern(full_tag, description_text);
        if (my_option && !seen_names.has(my_option.name)) {
            seen_names.add(my_option.name);
            the_options.push(my_option);
        }
    }

    return the_options;
}


// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract the primary command name from the title line.
 *
 * @param content - SMCL file content
 * @returns The primary command name, or null if not found
 */
export function extract_primary_command(content: string): string | null {
    const my_match = content.match(TITLE_PATTERN);
    if (my_match && my_match[1]) {
        return my_match[1].toLowerCase();
    }
    return null;
}

/**
 * Extract the set of command names that appear as the *first* command
 * token of a syntax paragraph. Used as a "this file documents the
 * command" signal so the cache generator can pick `macro.sthlp` over
 * `char.sthlp` for `local`: macro.sthlp leads a paragraph with
 * `{cmdab:loc:al}` while char.sthlp nests it inside `{c -(} | {c )-}`.
 *
 * A paragraph lead must follow optional `{p ...}` tags with no
 * intervening alternation delimiter (`{c -(}` / `{c )-}`), bracket
 * (`[`), or `{cmd:,}` separator. Multi-word subcommand syntax such as
 * `{cmdab:ma:cro} {cmdab:di:r}` still returns `macro` as the lead.
 */
// Module-level regexes for paragraph-lead detection (hoisted for
// performance — avoids re-creating on every call during cache
// generation across thousands of help files).
const INLINE_PARAGRAPH_LEAD_PATTERN =
    /^\s*(?:\{p[^}]*\}\s*)+(?:\{cmdab:([a-z][a-z0-9_]*):([a-z0-9_]+)\}|\{cmd:([a-z_][a-z0-9_]*)\})/i;
const STANDALONE_CMD_PATTERN =
    /^\s*(?:\{cmdab:([a-z][a-z0-9_]*):([a-z0-9_]+)\}|\{cmd:([a-z_][a-z0-9_]*)\})/i;
const P_MARKER_PATTERN =
    /^\s*(?:\{p[^}]*\}|\{phang[^}]*\}|\{pstd\})\s*$/i;

export function extract_paragraph_lead_commands(syntax_section: string): Set<string> {
    const the_commands = new Set<string>();
    const my_doc = { content: syntax_section, line_offsets: compute_line_offsets(syntax_section) };
    const my_line_count = get_line_count(my_doc);
    // Recognise the indented line layout used by files like
    // `quietly.sthlp`, where syntax lines are simply tab-indented and
    // separated by blank lines rather than paragraph tags. A command
    // tag that begins at the start of such a line (after a blank
    // separator) also counts as a paragraph lead.
    let previous_line_was_blank = true;
    let previous_was_paragraph_marker = false;
    for (let i = 0; i < my_line_count; i++) {
        const my_line = get_line_text(my_doc, i);

        if (my_line.trim().length === 0) {
            previous_was_paragraph_marker = false;
            previous_line_was_blank = true;
            continue;
        }

        const my_inline = my_line.match(INLINE_PARAGRAPH_LEAD_PATTERN);
        if (my_inline) {
            const my_command_name = my_inline[1]
                ? (my_inline[1] + my_inline[2]).toLowerCase()
                : my_inline[3].toLowerCase();
            the_commands.add(my_command_name);
        } else if (previous_was_paragraph_marker || previous_line_was_blank) {
            const my_standalone = my_line.match(STANDALONE_CMD_PATTERN);
            if (my_standalone) {
                const my_command_name = my_standalone[1]
                    ? (my_standalone[1] + my_standalone[2]).toLowerCase()
                    : my_standalone[3].toLowerCase();
                the_commands.add(my_command_name);
            }
        }

        previous_was_paragraph_marker = P_MARKER_PATTERN.test(my_line);
        previous_line_was_blank = false;
    }

    return the_commands;
}

/**
 * Extract command names from {cmd:name} patterns in the syntax section.
 *
 * @param syntax_section - The syntax section content
 * @returns Array of command names found
 */
export function extract_cmd_patterns(syntax_section: string): string[] {
    const the_commands: string[] = [];

    // Only treat {cmd:NAME} as a command when it appears at the start of a
    // syntax line (after optional paragraph tags and any leading {cmdab:...}
    // tokens). This avoids picking up things like {cmd:_merge} mentioned in
    // option descriptions, while still supporting syntax like:
    //   {cmdab:mat:rix} {cmd:dispCns} [{cmd:,} ...]
    const line_start_cmd_pattern =
        /^\s*(?:\{p[^}]*\}\s*)*(?:\{cmdab:[^}]+\}\s*)*\{cmd:([a-z_][a-z0-9_]*)\}/i;

    // Stata help syntax frequently includes {cmd:using} / {cmd:in} etc.
    // These are syntax keywords, not actual commands.
    const the_syntax_keywords = new Set<string>([
        'using',
        'in'
    ]);

    const my_doc = { content: syntax_section, line_offsets: compute_line_offsets(syntax_section) };
    const my_line_count = get_line_count(my_doc);

    // Track prefix command context across lines.
    // When we see a prefix command (like {cmd:mi}), subsequent lines that
    // start with {cmd:NAME} may be continuations (subcommands) rather than
    // standalone commands. We reset the context when we see a clear statement
    // boundary (like {p_end}, empty line, or a new {p ...} paragraph start).
    let in_prefix_context = false;

    for (let i = 0; i < my_line_count; i++) {
        const my_line = get_line_text(my_doc, i);

        // Check if this line resets the prefix context
        // - Empty or whitespace-only lines reset and skip
        // - Lines starting with {p_end} reset and skip
        // - Lines starting with {synopt (option table rows) reset and skip
        const is_hard_reset = /^\s*$/.test(my_line) ||
            /^\s*\{p_end\}/.test(my_line) ||
            /^\s*\{synopt/.test(my_line);

        if (is_hard_reset) {
            in_prefix_context = false;
            continue;
        }

        // Lines starting with {p ...} (new paragraph, but not {p_end}) reset context
        // but should still be processed since they may contain valid syntax
        const is_paragraph_start = /^\s*\{p(?!_end)\b/.test(my_line);
        if (is_paragraph_start) {
            in_prefix_context = false;
            // Don't continue - process the line for commands
        }

        // Check if this line contains a prefix command
        const prefix_on_line = check_line_has_prefix_command(my_line);
        if (prefix_on_line) {
            in_prefix_context = true;
        }

        const my_match = my_line.match(line_start_cmd_pattern);
        if (!my_match) {
            continue;
        }

        const my_command_name = my_match[1].toLowerCase();
        if (the_syntax_keywords.has(my_command_name)) {
            continue;
        }

        // Skip if this command is itself a prefix command (we'll add it)
        // but also check if we're in a prefix context from a previous line
        if (in_prefix_context && !PREFIX_COMMANDS.has(my_command_name)) {
            // This is likely a subcommand of a prefix command from a previous line
            // Check if the line also has a prefix command before this {cmd:}
            if (!prefix_on_line) {
                // The prefix was on a previous line, skip this as a subcommand
                continue;
            }
            // If prefix is on this line, is_preceded_by_prefix_command will handle it
            // via the existing check in the pattern match
        }

        // Also check if preceded by prefix command on the same line
        const cmd_index = my_line.indexOf(`{cmd:${my_match[1]}`);
        if (cmd_index > 0 && is_preceded_by_prefix_command(my_line, cmd_index)) {
            continue;
        }

        if (!the_commands.includes(my_command_name)) {
            the_commands.push(my_command_name);
        }
    }

    return the_commands;
}

// Module-level regexes for check_line_has_prefix_command (hoisted for performance)
const LINE_CMD_PATTERN = /\{cmd:([a-z_][a-z0-9_]*)\}/g;
const LINE_CMDAB_PATTERN = /\{cmdab:([a-z]+):([a-z]+)\}/g;

/**
 * Check if a line contains a prefix command ({cmd:PREFIX} or {cmdab:...} for PREFIX).
 * 
 * @param line - A single line of SMCL content
 * @returns true if the line contains a prefix command
 */
function check_line_has_prefix_command(line: string): boolean {
    // Check for {cmd:PREFIX} patterns
    // Reset lastIndex since we're reusing module-level regexes
    LINE_CMD_PATTERN.lastIndex = 0;
    let my_match: RegExpExecArray | null;
    while ((my_match = LINE_CMD_PATTERN.exec(line)) !== null) {
        // The regex only captures lowercase chars, so no need for toLowerCase()
        if (PREFIX_COMMANDS.has(my_match[1])) {
            return true;
        }
    }

    // Check for {cmdab:PREFIX:...} patterns
    LINE_CMDAB_PATTERN.lastIndex = 0;
    while ((my_match = LINE_CMDAB_PATTERN.exec(line)) !== null) {
        // The regex only captures lowercase chars, so no need for toLowerCase()
        const full_name = my_match[1] + my_match[2];
        if (PREFIX_COMMANDS.has(full_name)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a {cmd:X} pattern at the given index appears in an option context.
 * Option contexts are within brackets [...] and typically after commas.
 */
function is_in_option_context(text: string, match_index: number): boolean {
    // Look backwards from the match to find the nearest bracket or start
    let bracket_depth = 0;
    let found_comma = false;

    for (let i = match_index - 1; i >= 0; i--) {
        const char = text[i];
        if (char === ']') {
            bracket_depth++;
        } else if (char === '[') {
            bracket_depth--;
            if (bracket_depth < 0) {
                // We're inside brackets
                return true;
            }
        } else if (char === '}' && text.substring(i - 4, i + 1) === '{cmd:') {
            // Check if this is {cmd:,} indicating an option separator
            const prev_match = text.substring(i - 5, i + 1).match(/\{cmd:,\}$/);
            if (prev_match) {
                found_comma = true;
            }
        }
    }

    return found_comma;
}

/**
 * Extract a brief description from the SMCL content.
 *
 * Looks for the description in the title line or first paragraph.
 *
 * @param content - SMCL file content
 * @param command_name - The command name to find description for
 * @returns A brief description, or a default message
 */
export function extract_description(
    content: string,
    command_name: string
): string {
    // Try to find description from {pstd} paragraph after title
    const pstd_match = content.match(/\{pstd\}([^{]+)/);
    if (pstd_match && pstd_match[1]) {
        const my_description = pstd_match[1]
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
        if (my_description.length > 10) {
            return my_description;
        }
    }

    // Try to find description from title line
    // Pattern: {p2col:{bf:[X] command} {hline 2}}description{p_end}
    const title_desc_pattern = new RegExp(
        `\\{p2col:\\{bf:\\[[A-Z0-9-]+\\]\\s+${command_name}\\}[^}]*\\}([^{]+)`,
        'i'
    );
    const title_match = content.match(title_desc_pattern);
    if (title_match && title_match[1]) {
        const my_description = title_match[1]
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
        if (my_description.length > 5) {
            return my_description;
        }
    }

    return `Stata ${command_name} command`;
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract all commands from an SMCL help file.
 *
 * This function reads the full file content and extracts:
 * - Commands from {viewerdialog} tags
 * - Commands from the Syntax section ({cmd:} and {cmdab:} patterns)
 * - The primary command from the title
 * - Options from the Options section
 *
 * @param file_path - Path to the SMCL help file
 * @returns ExtractionResult with commands and warnings
 */
export function extract_commands_from_file(file_path: string): ExtractionResult {
    const the_commands: ExtractedCommand[] = [];
    const the_warnings: string[] = [];

    // Read full file content
    let content: string;
    try {
        content = fs.readFileSync(file_path, 'utf-8');
    } catch (error) {
        const my_error_message = error instanceof Error
            ? error.message
            : String(error);
        return {
            commands: [],
            warnings: [`Failed to read file ${file_path}: ${my_error_message}`]
        };
    }

    // Step 1: Extract primary command from title
    const primary_name = extract_primary_command(content);

    // Step 2: Extract commands from viewerdialog tags
    const dialog_commands = extract_viewerdialog_commands(content);

    // Step 3: Extract syntax section and parse for commands
    const syntax_section = extract_syntax_section(content);

    // {opt ab:brev} is used both for command abbreviations (e.g., {opt mer:ge})
    // and for option lists (which we must NOT treat as commands). Heuristic:
    // only allow {opt ...} -> "command abbreviation" extraction before the
    // synopt options block begins.
    const synopt_table_start_index = syntax_section.search(/\{synopt(set|hdr|line)\b/i);
    const syntax_pre_synopt = synopt_table_start_index === -1
        ? syntax_section
        : syntax_section.substring(0, synopt_table_start_index);

    // Option blocks can start with a plain {synopt...} even without synoptset/hdr/line.
    const synopt_any_start_index = syntax_section.search(/\{synopt\b/i);

    const cmdab_commands_raw = [
        ...extract_cmdab_patterns(syntax_section, false),
        ...extract_cmdab_patterns(syntax_pre_synopt, true)
    ];

    const cmdab_commands = cmdab_commands_raw.filter((my_cmd, my_index) =>
        cmdab_commands_raw.findIndex(other => other.name === my_cmd.name) === my_index
    );

    const cmd_commands = extract_cmd_patterns(syntax_section);
    const paragraph_lead_commands = extract_paragraph_lead_commands(syntax_section);

    // Avoid scanning the full file for {cmdab:...} patterns.
    // Many help files use cmdab tags for non-command tokens (tables, labels,
    // result codes, etc.), which creates false positives.
    const full_cmdab_commands: CommandAbbreviation[] = [];

    // Step 4: Build a map of command names to abbreviation info
    const abbrev_map = new Map<string, number>();

    // Add cmdab commands with their abbreviations
    for (const my_cmd of cmdab_commands) {
        abbrev_map.set(my_cmd.name, my_cmd.min_abbrev);
    }

    // Add full content cmdab commands (may have more)
    for (const my_cmd of full_cmdab_commands) {
        if (!abbrev_map.has(my_cmd.name)) {
            abbrev_map.set(my_cmd.name, my_cmd.min_abbrev);
        }
    }

    // Step 5: Collect all unique command names
    const all_names = new Set<string>();
    const dialog_names = new Set<string>();  // Track names from viewerdialog

    if (primary_name) {
        all_names.add(primary_name);
    }

    for (const my_name of dialog_commands) {
        const lower_name = my_name.toLowerCase();
        all_names.add(lower_name);
        dialog_names.add(lower_name);  // Mark as having viewerdialog
    }

    for (const my_cmd of cmdab_commands) {
        all_names.add(my_cmd.name);
    }

    for (const my_name of cmd_commands) {
        all_names.add(my_name);
    }

    for (const my_cmd of full_cmdab_commands) {
        all_names.add(my_cmd.name);
    }

    // Step 6: Extract options
    //
    // Some help files list options compactly inside the Syntax section (synopt)
    // and then repeat/expand them later under {marker options}. We union both.
    //
    // Options are shared across all commands in a multi-command file.
    const options_section = extract_options_section(content);
    const syntax_for_options = synopt_any_start_index === -1
        ? ''
        : syntax_section.substring(synopt_any_start_index);
    const extracted_options = extract_options_from_section(
        `${options_section}\n${syntax_for_options}`
    );

    // Step 7: Build ExtractedCommand entries (with filtering)
    for (const my_name of all_names) {
        const is_primary = my_name === primary_name;
        const has_viewerdialog = dialog_names.has(my_name);
        const is_paragraph_lead = paragraph_lead_commands.has(my_name);

        // Filter out non-command tokens
        if (should_exclude_command(my_name, has_viewerdialog, is_primary)) {
            continue;
        }

        const my_min_abbrev = abbrev_map.get(my_name) || my_name.length;
        const my_description = extract_description(content, my_name);

        the_commands.push({
            name: my_name,
            min_abbreviation: my_min_abbrev,
            // syntax field is no longer populated (deprecated)
            description: my_description,
            source_file: file_path,
            is_primary: is_primary,
            has_viewerdialog: has_viewerdialog,
            is_paragraph_lead: is_paragraph_lead,
            options: extracted_options
        });
    }

    // Add warning if no commands found
    if (the_commands.length === 0) {
        the_warnings.push(`No commands extracted from ${file_path}`);
    }

    return {
        commands: the_commands,
        warnings: the_warnings
    };
}

/**
 * Extract commands from SMCL content string (for testing).
 *
 * @param content - SMCL content string
 * @param source_file - Source file path for metadata
 * @returns ExtractionResult with commands and warnings
 */
export function extract_commands_from_content(
    content: string,
    source_file: string = 'test.sthlp'
): ExtractionResult {
    const the_commands: ExtractedCommand[] = [];
    const the_warnings: string[] = [];

    // Step 1: Extract primary command from title
    const primary_name = extract_primary_command(content);

    // Step 2: Extract commands from viewerdialog tags
    const dialog_commands = extract_viewerdialog_commands(content);

    // Step 3: Extract syntax section and parse for commands
    const syntax_section = extract_syntax_section(content);

    // {opt ab:brev} is used both for command abbreviations (e.g., {opt mer:ge})
    // and for option lists (which we must NOT treat as commands). Heuristic:
    // only allow {opt ...} -> "command abbreviation" extraction before the
    // synopt options block begins.
    const synopt_table_start_index = syntax_section.search(/\{synopt(set|hdr|line)\b/i);
    const syntax_pre_synopt = synopt_table_start_index === -1
        ? syntax_section
        : syntax_section.substring(0, synopt_table_start_index);

    // Option blocks can start with a plain {synopt...} even without synoptset/hdr/line.
    const synopt_any_start_index = syntax_section.search(/\{synopt\b/i);

    const cmdab_commands_raw = [
        ...extract_cmdab_patterns(syntax_section, false),
        ...extract_cmdab_patterns(syntax_pre_synopt, true)
    ];

    const cmdab_commands = cmdab_commands_raw.filter((my_cmd, my_index) =>
        cmdab_commands_raw.findIndex(other => other.name === my_cmd.name) === my_index
    );

    const cmd_commands = extract_cmd_patterns(syntax_section);
    const paragraph_lead_commands = extract_paragraph_lead_commands(syntax_section);

    // Avoid scanning the full file for {cmdab:...} patterns.
    // Many help files use cmdab tags for non-command tokens (tables, labels,
    // result codes, etc.), which creates false positives.
    const full_cmdab_commands: CommandAbbreviation[] = [];

    // Step 4: Build a map of command names to abbreviation info
    const abbrev_map = new Map<string, number>();

    for (const my_cmd of cmdab_commands) {
        abbrev_map.set(my_cmd.name, my_cmd.min_abbrev);
    }

    for (const my_cmd of full_cmdab_commands) {
        if (!abbrev_map.has(my_cmd.name)) {
            abbrev_map.set(my_cmd.name, my_cmd.min_abbrev);
        }
    }

    // Step 5: Collect all unique command names
    const all_names = new Set<string>();
    const dialog_names = new Set<string>();  // Track names from viewerdialog

    if (primary_name) {
        all_names.add(primary_name);
    }

    for (const my_name of dialog_commands) {
        const lower_name = my_name.toLowerCase();
        all_names.add(lower_name);
        dialog_names.add(lower_name);  // Mark as having viewerdialog
    }

    for (const my_cmd of cmdab_commands) {
        all_names.add(my_cmd.name);
    }

    for (const my_name of cmd_commands) {
        all_names.add(my_name);
    }

    for (const my_cmd of full_cmdab_commands) {
        all_names.add(my_cmd.name);
    }

    // Step 6: Extract options
    //
    // Some help files list options compactly inside the Syntax section (synopt)
    // and then repeat/expand them later under {marker options}. We union both.
    //
    // Options are shared across all commands in a multi-command file.
    const options_section = extract_options_section(content);
    const syntax_for_options = synopt_any_start_index === -1
        ? ''
        : syntax_section.substring(synopt_any_start_index);
    const extracted_options = extract_options_from_section(
        `${options_section}\n${syntax_for_options}`
    );

    // Step 7: Build ExtractedCommand entries (with filtering)
    for (const my_name of all_names) {
        const is_primary = my_name === primary_name;
        const has_viewerdialog = dialog_names.has(my_name);
        const is_paragraph_lead = paragraph_lead_commands.has(my_name);

        // Filter out non-command tokens
        if (should_exclude_command(my_name, has_viewerdialog, is_primary)) {
            continue;
        }

        const my_min_abbrev = abbrev_map.get(my_name) || my_name.length;
        const my_description = extract_description(content, my_name);

        the_commands.push({
            name: my_name,
            min_abbreviation: my_min_abbrev,
            // syntax field is no longer populated (deprecated)
            description: my_description,
            source_file: source_file,
            is_primary: is_primary,
            has_viewerdialog: has_viewerdialog,
            is_paragraph_lead: is_paragraph_lead,
            options: extracted_options
        });
    }

    if (the_commands.length === 0) {
        the_warnings.push(`No commands extracted from ${source_file}`);
    }

    return {
        commands: the_commands,
        warnings: the_warnings
    };
}

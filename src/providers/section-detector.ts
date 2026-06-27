/**
 * Section Detector for Stata Code Sections
 *
 * Detects structured comment patterns in Stata .do files that represent
 * logical code sections, for display in VS Code's Outline panel.
 *
 * Supports four pattern types:
 * 1. Single-line sections: `// Section Name ----` or `* Section Name ----`
 * 2. Banner sections: 3-line delimiter/name/delimiter blocks
 * 3. Starred inline sections: `*** SECTION NAME ***`
 * 4. Numbered sections: `* 1.1 Section Name` with hierarchy from numbering depth
 */

import { Range } from 'vscode-languageserver-textdocument';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Delimiter character types for banner detection */
export type DelimiterKind = 'dash' | 'asterisk' | 'slash' | 'equals' | 'plus';

/** How a section was detected */
export type SectionDetectionType = 'single_line' | 'banner' | 'starred_inline' | 'numbered';

/** Intermediate section representation before hierarchy building */
export interface RawSection {
    name: string;
    level: number;
    range: Range;
    selection_range: Range;
    detection_type: SectionDetectionType;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DELIMITER_CHARS = new Set(['*', '-', '=', '+', '/', '#']);

// Single-line section patterns. These capture only the comment marker and the
// body (from the first non-space char to end-of-line); the trailing delimiter
// is split off in code by `split_trailing_delimiter`. The earlier single-regex
// form (`(\S.*?)\s+(-{4,}|...)\s*$`) was rejected by CodeQL as polynomial ReDoS
// because the lazy `.*?` and the surrounding `\s+` can both match the separating
// whitespace. These body patterns have no two overlapping repetitions.
//
// Slash-style: // Section Name ---- (delimiter: 4+ of - = * +)
const SLASH_SECTION_BODY_PATTERN = /^\s*\/\/\s+(\S.*)$/;

// Star-style: * Section Name ---- (delimiter: 4+ of - = +, NOT * to avoid starred inline ambiguity)
const STAR_SECTION_BODY_PATTERN = /^\s*\*\s+(\S.*)$/;

// Starred inline: ** Section Name ** or *** Section Name *** (delimiter: 2+ *)
const STARRED_INLINE_BODY_PATTERN = /^\s*(\*{2,})\s+(\S.*)$/;

// Numbered section: * 1. Name, // 1.1 Name, * 1.1.1 Name
const NUMBERED_SECTION_PATTERN = /^\s*(?:\*|\/\/)\s+(\d+(?:\.\d+)*\.?)\s+(\S.*)$/;

// Delimiter-line patterns for banner detection
const ALL_ASTERISK_PATTERN = /^\*{4,}$/;
const ALL_SLASH_PATTERN = /^\/{4,}$/;
const SLASH_DELIM_PATTERN = /^\/\/\s*([-=*+])\1{3,}\s*$/;
const STAR_DELIM_PATTERN = /^\*\s+([-=+])\1{3,}\s*$/;
const SLASH_COMMENT_PREFIX_PATTERN = /^\/\/\s*/;
const STAR_COMMENT_PREFIX_PATTERN = /^\*\s+/;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Check if a string consists only of delimiter characters and/or whitespace.
 * Returns true for empty strings.
 */
export function is_delimiter_only(s: string): boolean {
    if (s.length === 0) return true;
    for (let my_i = 0; my_i < s.length; my_i++) {
        const my_char = s[my_i];
        if (my_char !== ' ' && my_char !== '\t' && !DELIMITER_CHARS.has(my_char)) {
            return false;
        }
    }
    return true;
}

/**
 * Whitespace test matching the regex `\s` class, for a single character.
 * Using `/\s/.test(c)` on one char is linear and carries no ReDoS risk.
 */
function is_whitespace(c: string): boolean {
    return /\s/.test(c);
}

/**
 * Remove trailing characters matching `is_strip_char` from `text`.
 *
 * Linear-time replacement for `text.replace(/[...]+$/, '')`. CodeQL flags the
 * unanchored trailing-character-class form as polynomial ReDoS because the
 * engine retries the run from every start position; scanning from the end is
 * O(n) and behaves identically.
 */
function strip_trailing(
    text: string,
    is_strip_char: (c: string) => boolean
): string {
    let my_end = text.length;
    while (my_end > 0 && is_strip_char(text[my_end - 1])) {
        my_end--;
    }
    return text.substring(0, my_end);
}

/**
 * Given a comment body (already stripped of its comment marker and leading
 * whitespace, so it begins with a non-space character), detect a trailing
 * section delimiter of the form `<name> <run>`, where `<run>` is `min_run`+
 * repetitions of a single character drawn from `allowed_delims`, separated
 * from the name by whitespace and optionally followed by trailing whitespace.
 *
 * Returns the trimmed name, or null if the body does not end in such a
 * delimiter. This replaces a regex of the form `(\S.*?)\s+(-{4,}|...)\s*$`
 * whose lazy `.*?` and surrounding `\s+` overlap (both can match the
 * separating whitespace), which CodeQL flags as polynomial ReDoS. The manual
 * scan is linear.
 */
function split_trailing_delimiter(
    body: string,
    allowed_delims: string,
    min_run: number
): string | null {
    // Skip trailing whitespace (the regex's `\s*$`).
    let my_end = body.length;
    while (my_end > 0 && is_whitespace(body[my_end - 1])) {
        my_end--;
    }
    if (my_end === 0) return null;

    // Measure the trailing run of a single delimiter character.
    const my_delim_char = body[my_end - 1];
    if (!allowed_delims.includes(my_delim_char)) return null;
    let my_run_start = my_end;
    while (my_run_start > 0 && body[my_run_start - 1] === my_delim_char) {
        my_run_start--;
    }
    if (my_end - my_run_start < min_run) return null;

    // The run must be separated from the name by whitespace (the regex's
    // `\s+`), and a non-empty name must precede that whitespace.
    if (my_run_start === 0 || !is_whitespace(body[my_run_start - 1])) {
        return null;
    }
    const my_name = body.substring(0, my_run_start).trim();
    if (my_name.length === 0) return null;
    return my_name;
}

/**
 * Check if a line is a valid asterisk delimiter for block comment headings.
 * Returns true for lines with 4+ asterisks and optional whitespace.
 *
 * Recognized forms:
 * - Pure asterisks (4+): ****...
 * - With whitespace: "  ****  "
 * - Comment-prefixed: /****...
 * - Comment-suffixed: ****... followed by asterisk-slash
 *
 * @param line - The line to check
 * @returns true if the line is a valid asterisk delimiter
 */
export function is_asterisk_delimiter(line: string): boolean {
    const my_trimmed = line.trim();
    if (my_trimmed.length < 4) return false;

    // Check for comment-prefixed form: /****...
    // Strip leading slash if present
    let my_content = my_trimmed;
    if (my_content.startsWith('/')) {
        my_content = my_content.substring(1);
    }

    // Check for comment-suffixed form: ...*/
    // Strip trailing / if present (handles both ****/ and ****/)
    if (my_content.endsWith('/')) {
        my_content = my_content.substring(0, my_content.length - 1);
    }

    // After stripping, must have at least 4 asterisks
    if (my_content.length < 4) return false;

    // Check that remaining content is all asterisks
    for (let my_i = 0; my_i < my_content.length; my_i++) {
        if (my_content[my_i] !== '*') {
            return false;
        }
    }

    return true;
}

/**
 * Check if a line is a standalone heading (not an indented list item).
 * Returns true for lines at column 0 or with minimal indentation (< 4 spaces).
 * Returns false for lines with 4+ spaces or starting with a tab character.
 *
 * This function filters out indented list items from numbered section detection.
 * Valid section headings are typically at column 0 or minimally indented,
 * while list items are indented to show they're subordinate to explanatory text.
 *
 * @param line - The line to check
 * @returns true if the line is a standalone heading candidate
 */
export function is_standalone_heading(line: string): boolean {
    // Calculate leading whitespace count
    const my_leading_whitespace = line.length - line.trimStart().length;

    // Reject lines with any tab in leading whitespace (including after spaces)
    if (my_leading_whitespace > 0 && line.slice(0, my_leading_whitespace).includes('\t')) {
        return false;
    }

    // Reject lines with 4+ spaces of leading whitespace
    if (my_leading_whitespace >= 4) {
        return false;
    }

    return true;
}

/**
 * Count the number of delimiter characters in a line.
 *
 * For pure delimiter lines (e.g., `****`, `//////`), counts total delimiter characters.
 * For comment-prefixed delimiters (e.g., `// ====`, `* ----`), counts repeated
 * delimiter chars after the prefix.
 *
 * The delimiter character is determined by the `kind` parameter:
 * - 'dash' → '-'
 * - 'asterisk' → '*'
 * - 'slash' → '/'
 * - 'equals' → '='
 * - 'plus' → '+'
 *
 * @param line - The line to analyze
 * @param kind - The delimiter kind to count
 * @returns The count of delimiter characters
 */
export function count_delimiter_chars(line: string, kind: DelimiterKind): number {
    const my_trimmed = line.trim();
    if (my_trimmed.length === 0) return 0;

    // Map delimiter kind to character
    const my_delim_char = delimiter_kind_to_char(kind);
    if (my_delim_char === null) return 0;

    // Check for pure delimiter line (all same character)
    if (is_pure_delimiter_line(my_trimmed, my_delim_char)) {
        return count_char_occurrences(my_trimmed, my_delim_char);
    }

    // Check for comment-prefixed delimiter patterns
    // Pattern: // ====... or * ----...
    const my_slash_prefix_match = my_trimmed.match(SLASH_COMMENT_PREFIX_PATTERN);
    if (my_slash_prefix_match) {
        const my_after_prefix = my_trimmed.substring(my_slash_prefix_match[0].length);
        return count_leading_delimiter_chars(my_after_prefix, my_delim_char);
    }

    const my_star_prefix_match = my_trimmed.match(STAR_COMMENT_PREFIX_PATTERN);
    if (my_star_prefix_match) {
        const my_after_prefix = my_trimmed.substring(my_star_prefix_match[0].length);
        return count_leading_delimiter_chars(my_after_prefix, my_delim_char);
    }

    // For asterisk kind, also handle /****... and ****/ patterns
    if (kind === 'asterisk') {
        let my_content = my_trimmed;

        // Strip leading slash if present
        if (my_content.startsWith('/')) {
            my_content = my_content.substring(1);
        }

        // Strip trailing slash if present
        if (my_content.endsWith('/')) {
            my_content = my_content.substring(0, my_content.length - 1);
        }

        // Count asterisks if remaining content is all asterisks
        if (is_pure_delimiter_line(my_content, '*')) {
            return count_char_occurrences(my_content, '*');
        }
    }

    return 0;
}

/**
 * Map a delimiter kind to its character.
 */
function delimiter_kind_to_char(kind: DelimiterKind): string | null {
    switch (kind) {
        case 'dash': return '-';
        case 'asterisk': return '*';
        case 'slash': return '/';
        case 'equals': return '=';
        case 'plus': return '+';
        default: return null;
    }
}

/**
 * Check if a string consists only of a single delimiter character.
 */
function is_pure_delimiter_line(s: string, delim_char: string): boolean {
    if (s.length === 0) return false;
    for (let my_i = 0; my_i < s.length; my_i++) {
        if (s[my_i] !== delim_char) {
            return false;
        }
    }
    return true;
}

/**
 * Count occurrences of a character in a string.
 */
function count_char_occurrences(s: string, char: string): number {
    let my_count = 0;
    for (let my_i = 0; my_i < s.length; my_i++) {
        if (s[my_i] === char) {
            my_count++;
        }
    }
    return my_count;
}

/**
 * Count leading delimiter characters in a string.
 * Stops counting at the first non-delimiter character.
 */
function count_leading_delimiter_chars(s: string, delim_char: string): number {
    let my_count = 0;
    for (let my_i = 0; my_i < s.length; my_i++) {
        if (s[my_i] === delim_char) {
            my_count++;
        } else {
            break;
        }
    }
    return my_count;
}

/**
 * Derive nesting level from delimiter character count.
 *
 * Level calculation formula:
 * - 4 characters → level 1
 * - 5-7 characters → level 2
 * - 8-11 characters → level 3
 * - 12+ characters → level 4
 *
 * @param count - The number of delimiter characters
 * @returns The nesting level (1-4)
 */
export function derive_level_from_delimiter_count(count: number): number {
    if (count <= 4) return 1;
    if (count <= 7) return 2;
    if (count <= 11) return 3;
    return 4;
}

/**
 * Derive banner section level from the middle line's comment prefix.
 *
 * The level is determined by the comment prefix on the middle line
 * (the one containing the section name), not by the delimiter lines.
 *
 * Slash prefixes: `/` chars counted, level = min(count - 1, 4), floor 1
 *   `//`  → 1, `///` → 2, `////` → 3, `/////+` → 4
 *
 * Asterisk prefixes: `*` chars counted, level = min(count, 4)
 *   `*`   → 1, `**`  → 2, `***`  → 3, `****+` → 4
 *
 * No comment prefix (e.g., ` Section Name`) → level 1
 *
 * @param line - The middle line of a banner section
 * @returns The nesting level (1-4)
 */
export function derive_banner_level_from_middle_line(line: string): number {
    const my_trimmed = line.trim();

    // Count leading `/` chars
    if (my_trimmed.startsWith('/')) {
        let my_count = 0;
        while (my_count < my_trimmed.length && my_trimmed[my_count] === '/') {
            my_count++;
        }
        // `//` → 1, `///` → 2, `////` → 3, `/////+` → 4
        return Math.max(1, Math.min(my_count - 1, 4));
    }

    // Count leading `*` chars
    if (my_trimmed.startsWith('*')) {
        let my_count = 0;
        while (my_count < my_trimmed.length && my_trimmed[my_count] === '*') {
            my_count++;
        }
        // `*` → 1, `**` → 2, `***` → 3, `****+` → 4
        return Math.min(my_count, 4);
    }

    // No comment prefix → level 1
    return 1;
}

/**
 * Classify a line as a delimiter line for banner detection.
 * Returns the delimiter kind if the line is a pure delimiter line, null otherwise.
 *
 * Recognized forms:
 * - `****...****` (all asterisks, 4+)
 * - `///...///` (all slashes, 4+)
 * - `// ========...` (slash-comment + repeated char 4+)
 * - `* --------...` (star-comment + repeated char 4+)
 */
export function classify_delimiter_line(line: string): DelimiterKind | null {
    const my_trimmed = line.trim();
    if (my_trimmed.length < 4) return null;

    // Check all-asterisk line: ****...
    if (ALL_ASTERISK_PATTERN.test(my_trimmed)) return 'asterisk';

    // Check all-slash line: ////...
    if (ALL_SLASH_PATTERN.test(my_trimmed)) return 'slash';

    // Check slash-comment + single delimiter type: // ====...
    const my_slash_delim_match = my_trimmed.match(SLASH_DELIM_PATTERN);
    if (my_slash_delim_match) {
        return char_to_delimiter_kind(my_slash_delim_match[1]);
    }

    // Check star-comment + single delimiter type: * ----...
    const my_star_delim_match = my_trimmed.match(STAR_DELIM_PATTERN);
    if (my_star_delim_match) {
        return char_to_delimiter_kind(my_star_delim_match[1]);
    }

    return null;
}

/**
 * Extract section name from a banner middle line.
 * Strips leading comment markers and trailing delimiter characters.
 * Returns null if the result is empty or delimiter-only.
 */
export function extract_banner_name(line: string): string | null {
    let my_text = line.trim();

    // Strip leading comment markers
    if (my_text.startsWith('//')) {
        my_text = my_text.substring(2);
    } else if (my_text.startsWith('*')) {
        my_text = my_text.substring(1);
    } else {
        return null;
    }

    // Strip leading delimiter chars and whitespace
    my_text = my_text.replace(/^[\s*\-=+/#]+/, '');

    // Strip trailing delimiter chars and whitespace
    my_text = strip_trailing(
        my_text,
        c => is_whitespace(c) || '*-=+/#'.includes(c)
    );

    // Trim again
    my_text = my_text.trim();

    if (my_text.length === 0 || is_delimiter_only(my_text)) {
        return null;
    }

    return my_text;
}

/**
 * Extract heading text from the middle line of a block comment.
 * Strips leading/trailing asterisks, whitespace, and comment markers.
 * Returns null if the result is empty or delimiter-only.
 *
 * Expected input patterns:
 * - " Current contraceptive methods..." (leading space)
 * - "* Current contraceptive methods..." (leading asterisk)
 * - " * Current contraceptive methods..." (leading space + asterisk)
 *
 * @param line - The middle line of a block comment
 * @returns The extracted heading text, or null if invalid
 */
export function extract_block_comment_heading(line: string): string | null {
    let my_text = line.trim();

    // Strip leading asterisks and whitespace
    my_text = my_text.replace(/^[\s*]+/, '');

    // Strip trailing asterisks and whitespace
    my_text = strip_trailing(my_text, c => is_whitespace(c) || c === '*');

    // Trim again
    my_text = my_text.trim();

    if (my_text.length === 0 || is_delimiter_only(my_text)) {
        return null;
    }

    return my_text;
}



/**
 * Map a delimiter character to its kind.
 */
function char_to_delimiter_kind(c: string): DelimiterKind | null {
    switch (c) {
        case '-': return 'dash';
        case '*': return 'asterisk';
        case '/': return 'slash';
        case '=': return 'equals';
        case '+': return 'plus';
        default: return null;
    }
}

/**
 * Get a line from content using line_offsets for O(1) lookup.
 */
function get_line(content: string, line_offsets: number[], line_number: number): string {
    if (line_number < 0 || line_number >= line_offsets.length) return '';
    const my_start = line_offsets[line_number];
    if (my_start >= content.length) return '';
    const my_end = content.indexOf('\n', my_start);
    return my_end === -1
        ? content.substring(my_start)
        : content.substring(my_start, my_end);
}

/**
 * Get the total number of lines from line_offsets.
 */
function get_total_lines(line_offsets: number[]): number {
    return line_offsets.length;
}

/**
 * Create a Range spanning a single line.
 */
function single_line_range(line_number: number, line_length: number): Range {
    return {
        start: { line: line_number, character: 0 },
        end: { line: line_number, character: line_length },
    };
}

/**
 * Derive heading level from a numbered section prefix.
 * Counts the number of dot-separated number groups.
 * Examples: "1." → 1, "1.1" → 2, "1.1.1" → 3, "2.10.1" → 3
 */
export function derive_numbered_level(prefix: string): number {
    // Remove trailing dot if present
    const my_clean = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;
    return my_clean.split('.').length;
}

// ---------------------------------------------------------------------------
// Detection phases
// ---------------------------------------------------------------------------

/**
 * Phase 1: Detect single-line sections.
 */
function detect_single_line_sections(
    content: string,
    line_offsets: number[],
    consumed_lines: Set<number>
): RawSection[] {
    const my_sections: RawSection[] = [];
    const my_total_lines = get_total_lines(line_offsets);

    for (let my_line_num = 0; my_line_num < my_total_lines; my_line_num++) {
        const my_line = get_line(content, line_offsets, my_line_num);

        // Try slash-style first, then star-style. Each captures the comment
        // body; the trailing delimiter is split off in code.
        let my_name: string | null = null;
        const my_slash = my_line.match(SLASH_SECTION_BODY_PATTERN);
        if (my_slash) {
            my_name = split_trailing_delimiter(my_slash[1], '-=*+', 4);
        }
        if (my_name === null) {
            const my_star = my_line.match(STAR_SECTION_BODY_PATTERN);
            if (my_star) {
                my_name = split_trailing_delimiter(my_star[1], '-=+', 4);
            }
        }

        if (my_name !== null) {
            if (is_delimiter_only(my_name)) continue;

            const my_line_length = my_line.length;
            my_sections.push({
                name: my_name,
                level: 1,
                range: single_line_range(my_line_num, my_line_length),
                selection_range: single_line_range(my_line_num, my_line_length),
                detection_type: 'single_line',
            });
            consumed_lines.add(my_line_num);
        }
    }

    return my_sections;
}

/**
 * Phase 2: Detect banner-style sections (3-line patterns).
 *
 * This phase includes two sub-phases:
 * 1. Block comment headings: asterisk delimiters on lines i-1 and i+1
 * 2. Standard banner sections: matching delimiter kinds on lines i-1 and i+1
 */
function detect_banner_sections(
    content: string,
    line_offsets: number[],
    consumed_lines: Set<number>
): RawSection[] {
    const my_sections: RawSection[] = [];
    const my_total_lines = get_total_lines(line_offsets);

    // Sub-phase 2a: Detect block comment headings
    // Pattern: asterisk delimiter / heading text / asterisk delimiter
    for (let my_line_num = 1; my_line_num < my_total_lines - 1; my_line_num++) {
        // Skip if any of the 3 lines are already consumed
        if (consumed_lines.has(my_line_num - 1) ||
            consumed_lines.has(my_line_num) ||
            consumed_lines.has(my_line_num + 1)) {
            continue;
        }

        const my_line_above = get_line(content, line_offsets, my_line_num - 1);
        const my_line_below = get_line(content, line_offsets, my_line_num + 1);

        // Check if both lines are asterisk delimiters
        if (!is_asterisk_delimiter(my_line_above)) continue;
        if (!is_asterisk_delimiter(my_line_below)) continue;

        // Extract heading text from middle line
        const my_middle_line = get_line(content, line_offsets, my_line_num);
        const my_name = extract_block_comment_heading(my_middle_line);
        if (my_name === null) continue;

        // Derive level from middle line's comment prefix
        const my_level = derive_banner_level_from_middle_line(my_middle_line);

        const my_middle_length = my_middle_line.length;
        const my_bottom_length = my_line_below.length;

        my_sections.push({
            name: my_name,
            level: my_level,
            range: {
                start: { line: my_line_num - 1, character: 0 },
                end: { line: my_line_num + 1, character: my_bottom_length },
            },
            selection_range: {
                start: { line: my_line_num, character: 0 },
                end: { line: my_line_num, character: my_middle_length },
            },
            detection_type: 'banner',
        });

        // Mark all three lines as consumed
        consumed_lines.add(my_line_num - 1);
        consumed_lines.add(my_line_num);
        consumed_lines.add(my_line_num + 1);
    }

    // Sub-phase 2b: Detect standard banner sections
    // Pattern: delimiter line / heading text / delimiter line (matching kinds)
    for (let my_line_num = 1; my_line_num < my_total_lines - 1; my_line_num++) {
        // Skip if any of the 3 lines are already consumed
        if (consumed_lines.has(my_line_num - 1) ||
            consumed_lines.has(my_line_num) ||
            consumed_lines.has(my_line_num + 1)) {
            continue;
        }

        const my_line_above = get_line(content, line_offsets, my_line_num - 1);
        const my_line_below = get_line(content, line_offsets, my_line_num + 1);

        const my_kind_top = classify_delimiter_line(my_line_above);
        if (my_kind_top === null) continue;

        const my_kind_bottom = classify_delimiter_line(my_line_below);
        if (my_kind_bottom === null) continue;

        if (my_kind_top !== my_kind_bottom) continue;

        const my_middle_line = get_line(content, line_offsets, my_line_num);
        const my_name = extract_banner_name(my_middle_line);
        if (my_name === null) continue;

        // Derive level from middle line's comment prefix
        const my_level = derive_banner_level_from_middle_line(my_middle_line);

        const my_middle_length = my_middle_line.length;
        const my_bottom_length = my_line_below.length;

        my_sections.push({
            name: my_name,
            level: my_level,
            range: {
                start: { line: my_line_num - 1, character: 0 },
                end: { line: my_line_num + 1, character: my_bottom_length },
            },
            selection_range: {
                start: { line: my_line_num, character: 0 },
                end: { line: my_line_num, character: my_middle_length },
            },
            detection_type: 'banner',
        });
        consumed_lines.add(my_line_num - 1);
        consumed_lines.add(my_line_num);
        consumed_lines.add(my_line_num + 1);
    }

    return my_sections;
}

/**
 * Phase 3: Detect starred inline sections (** Name ** or *** Name ***).
 */
function detect_starred_inline_sections(
    content: string,
    line_offsets: number[],
    consumed_lines: Set<number>
): RawSection[] {
    const my_sections: RawSection[] = [];
    const my_total_lines = get_total_lines(line_offsets);

    for (let my_line_num = 0; my_line_num < my_total_lines; my_line_num++) {
        if (consumed_lines.has(my_line_num)) continue;

        const my_line = get_line(content, line_offsets, my_line_num);
        const my_match = my_line.match(STARRED_INLINE_BODY_PATTERN);
        if (!my_match) continue;

        // my_match[2] is the body after the opening `**`; the closing `**` is
        // split off in code (delimiter: 2+ asterisks).
        const my_name = split_trailing_delimiter(my_match[2], '*', 2);
        if (my_name === null) continue;
        if (is_delimiter_only(my_name)) continue;

        const my_line_length = my_line.length;
        my_sections.push({
            name: my_name,
            level: 1,
            range: single_line_range(my_line_num, my_line_length),
            selection_range: single_line_range(my_line_num, my_line_length),
            detection_type: 'starred_inline',
        });
        consumed_lines.add(my_line_num);
    }

    return my_sections;
}

/**
 * Phase 4: Detect numbered sections (* 1. Name, // 1.1 Name, etc.).
 *
 * This phase filters out indented list items by checking if the line is a
 * standalone heading (not indented with 4+ spaces or tabs). This prevents
 * false positives from patterns like:
 *     * 0 not using
 *     * 1 pill
 * which are list items, not section headings.
 */
function detect_numbered_sections(
    content: string,
    line_offsets: number[],
    consumed_lines: Set<number>
): RawSection[] {
    const my_sections: RawSection[] = [];
    const my_total_lines = get_total_lines(line_offsets);

    for (let my_line_num = 0; my_line_num < my_total_lines; my_line_num++) {
        if (consumed_lines.has(my_line_num)) continue;

        const my_line = get_line(content, line_offsets, my_line_num);
        const my_match = my_line.match(NUMBERED_SECTION_PATTERN);
        if (!my_match) continue;

        // Filter out indented list items (4+ spaces or tabs)
        // Valid section headings are at column 0 or minimally indented (< 4 spaces)
        if (!is_standalone_heading(my_line)) continue;

        const my_number_prefix = my_match[1];
        const my_rest = my_match[2].trim();
        if (is_delimiter_only(my_rest)) continue;

        const my_name = `${my_number_prefix} ${my_rest}`;
        const my_level = derive_numbered_level(my_number_prefix);
        const my_line_length = my_line.length;

        my_sections.push({
            name: my_name,
            level: my_level,
            range: single_line_range(my_line_num, my_line_length),
            selection_range: single_line_range(my_line_num, my_line_length),
            detection_type: 'numbered',
        });
        consumed_lines.add(my_line_num);
    }

    return my_sections;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Extract all sections from document content.
 *
 * Runs four detection phases in priority order, then merges, sorts, and
 * deduplicates the results. Each phase skips lines already consumed by
 * earlier phases to prevent overlapping detections.
 *
 * @param content - Raw document content string
 * @param line_offsets - Array where line_offsets[i] is the character offset of line i
 * @returns Array of RawSection entries sorted by start line
 */
export function extract_sections(
    content: string,
    line_offsets: number[]
): RawSection[] {
    const my_consumed_lines = new Set<number>();

    // Phase 1: Single-line sections (highest priority)
    const my_single_line = detect_single_line_sections(content, line_offsets, my_consumed_lines);

    // Phase 2: Banner sections
    const my_banner = detect_banner_sections(content, line_offsets, my_consumed_lines);

    // Phase 3: Starred inline sections
    const my_starred = detect_starred_inline_sections(content, line_offsets, my_consumed_lines);

    // Phase 4: Numbered sections (lowest priority)
    const my_numbered = detect_numbered_sections(content, line_offsets, my_consumed_lines);

    // Merge all
    const my_all_sections = [
        ...my_single_line,
        ...my_banner,
        ...my_starred,
        ...my_numbered,
    ];

    // Sort by start line
    my_all_sections.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
    });

    // Deduplicate by start line (first detection wins)
    const my_seen_lines = new Set<number>();
    const my_deduplicated: RawSection[] = [];
    for (const my_section of my_all_sections) {
        if (!my_seen_lines.has(my_section.range.start.line)) {
            my_seen_lines.add(my_section.range.start.line);
            my_deduplicated.push(my_section);
        }
    }

    return my_deduplicated;
}

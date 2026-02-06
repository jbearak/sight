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

// Single-line section patterns:
// Slash-style: // Section Name ---- (delimiter: 4+ of - = * +)
const SLASH_SECTION_PATTERN = /^\s*\/\/\s+(\S.*?)\s+(-{4,}|={4,}|\*{4,}|\+{4,})\s*$/;

// Star-style: * Section Name ---- (delimiter: 4+ of - = +, NOT * to avoid starred inline ambiguity)
const STAR_SECTION_PATTERN = /^\s*\*\s+(\S.*?)\s+(-{4,}|={4,}|\+{4,})\s*$/;

// Starred inline: ** Section Name ** or *** Section Name ***
const STARRED_INLINE_PATTERN = /^\s*(\*{2,})\s+(\S.*?)\s+(\*{2,})\s*$/;

// Numbered section: * 1. Name, // 1.1 Name, * 1.1.1 Name
const NUMBERED_SECTION_PATTERN = /^\s*(?:\*|\/\/)\s+(\d+(?:\.\d+)*\.?)\s+(\S.*)$/;

// Delimiter-line patterns for banner detection
const ALL_ASTERISK_PATTERN = /^\*{4,}$/;
const ALL_SLASH_PATTERN = /^\/{4,}$/;
const SLASH_DELIM_PATTERN = /^\/\/\s*([-=*+])\1{3,}\s*$/;
const STAR_DELIM_PATTERN = /^\*\s+([-=+])\1{3,}\s*$/;

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
    my_text = my_text.replace(/[\s*\-=+/#]+$/, '');

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

        // Try slash-style first
        let my_match = my_line.match(SLASH_SECTION_PATTERN);
        if (!my_match) {
            // Try star-style
            my_match = my_line.match(STAR_SECTION_PATTERN);
        }

        if (my_match) {
            const my_name = my_match[1].trim();
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
 */
function detect_banner_sections(
    content: string,
    line_offsets: number[],
    consumed_lines: Set<number>
): RawSection[] {
    const my_sections: RawSection[] = [];
    const my_total_lines = get_total_lines(line_offsets);

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

        const my_middle_length = my_middle_line.length;
        const my_bottom_length = my_line_below.length;

        my_sections.push({
            name: my_name,
            level: 1,
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
        const my_match = my_line.match(STARRED_INLINE_PATTERN);
        if (!my_match) continue;

        const my_name = my_match[2].trim();
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

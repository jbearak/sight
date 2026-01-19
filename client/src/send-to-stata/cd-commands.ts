/**
 * Escape a directory path for use in Stata cd command.
 * Handles:
 * - Double quotes: Uses compound string syntax `"..."' instead of backslash escaping
 * - Windows backslashes: Doubles backslashes for Stata compatibility
 * @param path - The directory path to escape
 * @returns Object with escaped path and whether compound string is needed
 */
export function escape_path_for_stata(path: string): { escaped: string; use_compound: boolean } {
    const has_quotes = path.includes('"');
    const escaped = path.replace(/\\/g, '\\\\');
    
    return {
        escaped,
        use_compound: has_quotes
    };
}
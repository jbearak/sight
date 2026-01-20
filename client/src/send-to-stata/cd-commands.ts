import { WorkingDirectoryOption } from './commands';

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

/**
 * Compute whether CD menu should be visible based on working directory setting.
 * @param working_directory - The workingDirectory setting value
 * @returns true if CD menu should be visible (when value is 'none' or 'lsp')
 */
export function compute_cd_menu_visible(
    working_directory: WorkingDirectoryOption
): boolean {
    return working_directory === 'none' || working_directory === 'lsp';
}

/**
 * Format a CD command for Stata with proper escaping.
 * @param directory_path - The directory path
 * @returns The formatted cd command string
 */
export function format_cd_command(directory_path: string): string {
    const { escaped, use_compound } = escape_path_for_stata(directory_path);
    
    if (use_compound) {
        return `cd \`"${escaped}"'`;
    } else {
        return `cd "${escaped}"`;
    }
}

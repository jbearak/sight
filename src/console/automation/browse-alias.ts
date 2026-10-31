/**
 * `browse` in the Windows console. Console Stata on macOS and Linux has
 * no built-in `browse`, so Sight's `browse.ado` (and `br.ado` etc.)
 * forward it to `vview`, which opens the data in the editor. The
 * Windows console drives the Stata GUI, whose built-in `browse` always
 * wins, so the console rewrites the command itself before sending it.
 *
 * Exact case: these are Stata command names.
 */

// `browse` and its abbreviations down to `br`, after any `capture`,
// `quietly` or `noisily` prefixes (also abbreviated, optionally with
// a colon).
const BROWSE_COMMAND = new RegExp(
    '^(\\s*(?:(?:cap(?:t(?:u(?:re?)?)?)?|qui(?:e(?:t(?:ly?)?)?)?'
    + '|n(?:o(?:i(?:s(?:i(?:ly?)?)?)?)?)?)\\s*:?\\s+)*)'
    + 'br(?:o(?:w(?:se?)?)?)?(?=$|[\\s,])'
);

/** Is `line` a `browse` command (or an abbreviation of it)? */
export function is_browse_command(line: string): boolean {
    return BROWSE_COMMAND.test(line);
}

/** `line` with its `browse` command replaced by `vview`, if it has one. */
export function browse_to_vview(line: string): string {
    return line.replace(BROWSE_COMMAND, '$1vview');
}

export const BROWSE_IN_STATA_NOTE =
    '`browse` opened in the Stata window. To see data in VS Code instead, '
    + 'run "Sight: Install Stata Commands" there and restart the console.';

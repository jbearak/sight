/**
 * Canonical set of Stata single-line execution-prefix commands — the prefixes
 * that may precede another command on the same line (optionally with a colon),
 * e.g. `quietly: local x ...`, `capture noisily local y ...`.
 *
 * Centralized so analyzer/provider code that needs to skip leading prefixes
 * shares one source of truth instead of maintaining divergent hardcoded lists.
 * Includes the documented minimum abbreviations Stata accepts.
 */
export const SINGLE_LINE_PREFIX_COMMANDS: ReadonlySet<string> = new Set([
    'capture', 'cap',
    'quietly', 'qui', 'quie',
    'noisily', 'noi',
]);

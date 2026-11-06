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
    'nobreak', 'break',
]);

/**
 * Prefix commands that take no arguments of their own (other than the
 * `by` varlist), mapped to canonical names. Keys are every abbreviation
 * Stata accepts, exact case.
 */
export const PREFIX_COMMANDS: ReadonlyMap<string, string> = new Map([
    ['by', 'by'],
    ['bys', 'bysort'], ['byso', 'bysort'], ['bysor', 'bysort'], ['bysort', 'bysort'],
    ['qui', 'quietly'], ['quie', 'quietly'], ['quiet', 'quietly'],
    ['quietl', 'quietly'], ['quietly', 'quietly'],
    ['cap', 'capture'], ['capt', 'capture'], ['captu', 'capture'],
    ['captur', 'capture'], ['capture', 'capture'],
    ['n', 'noisily'], ['no', 'noisily'], ['noi', 'noisily'], ['nois', 'noisily'],
    ['noisi', 'noisily'], ['noisil', 'noisily'], ['noisily', 'noisily'],
    // No abbreviations: StataMP 18 rejects `nobrea` and `brea`. Each
    // takes a command or a `{ }` block (`nobreak {`).
    ['nobreak', 'nobreak'],
    ['break', 'break'],
]);

/**
 * Commands that act as a prefix only when a top-level colon follows,
 * e.g. `svy: regress ...` or `version 14: ...`, mapped to canonical
 * names. Without the colon they are ordinary commands (`version 14`).
 */
export const COLON_PREFIX_COMMANDS: ReadonlyMap<string, string> = new Map([
    ['version', 'version'], ['vers', 'version'], ['versi', 'version'],
    ['versio', 'version'],
    ['svy', 'svy'],
    ['xi', 'xi'],
    ['bootstrap', 'bootstrap'], ['bs', 'bootstrap'],
    ['jackknife', 'jackknife'], ['jknife', 'jackknife'],
    ['simulate', 'simulate'],
    ['statsby', 'statsby'],
    ['rolling', 'rolling'],
    ['permute', 'permute'],
    ['mi', 'mi'],
    ['nestreg', 'nestreg'],
    ['stepwise', 'stepwise'], ['sw', 'stepwise'],
    ['fp', 'fp'],
    ['mfp', 'mfp'],
    ['collect', 'collect'],
    ['eststo', 'eststo'],
]);

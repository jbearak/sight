/**
 * Shared regex fragments for matching Stata `do`/`run`/`include` call sites.
 *
 * Used by both `directive-parser` (which captures the called path) and
 * `scope-resolver` (which only checks the prefix). Keeping the prefix
 * alternatives in one place prevents the two patterns from silently drifting
 * when Stata prefix commands are added or removed.
 */

// Stata prefix commands that can legally precede `do`, `run`, or `include`.
// Keywords must be lowercase (Stata is case-sensitive). Written so that every
// whitespace run is consumed by exactly one `\s+` when this fragment is wrapped
// in `(?:(?:<prefix>)\s+)*`, avoiding nested-quantifier ReDoS (CodeQL js/redos).
//
// Intentionally excluded: `timer` is a standalone command in Stata
// (`timer on 1`, `timer off 1`, `timer clear`, `timer list`), not a prefix
// command — `timer do "x.do"` is not legal syntax.
export const CALL_PREFIX_ALTERNATIVES =
    /qui(?:etly)?|cap(?:ture)?|noi(?:sily)?|version\s+\d+(?:\.\d+)?/.source;

/**
 * Mode for {@link build_do_include_pattern}:
 *  - `'prefix'`: prefix-only check (no path suffix appended).
 *  - `'capture'`: also capture the called path (quoted in group 2, unquoted in group 3).
 */
export type DoIncludePatternMode = 'prefix' | 'capture';

// Safe, fixed suffix that captures a quoted or unquoted path. Kept as an
// internal constant so no external regex source can reach `new RegExp`.
const PATH_CAPTURE_SUFFIX = '(?:"([^"]+)"|([^\\s,]+))';

/**
 * Build a regex that matches a `do`/`run`/`include` call line with optional
 * prefix commands. The returned regex captures the call keyword as group 1.
 *
 * The regex is assembled exclusively from fixed, internally generated strings
 * (selected via {@link DoIncludePatternMode}) and {@link CALL_PREFIX_ALTERNATIVES};
 * no external regex source is ever interpolated.
 */
export function build_do_include_pattern(mode: DoIncludePatternMode): RegExp {
    const path_suffix = mode === 'capture' ? PATH_CAPTURE_SUFFIX : '';
    return new RegExp(
        `^\\s*(?:(?:${CALL_PREFIX_ALTERNATIVES})\\s+)*\\s*(do|include|run)\\s+${path_suffix}`,
    );
}

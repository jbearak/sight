/**
 * Shared directive prefix handling.
 *
 * `sight:` is the canonical user-facing directive namespace. Most directives
 * must occupy their own Stata line-comment line (`// sight: ...` or
 * `* sight: ...`). `ignore` may also appear as a trailing `//` comment to
 * suppress diagnostics on that same source line; `ignore-next` always targets
 * the next non-trivia statement. The older `@lsp-` prefix remains a permanent
 * alias with the same line shape.
 */

export const DIRECTIVE_BODY_PREFIX_PATTERN = String.raw`(?:@lsp-|sight:\s*)`;
export const DIRECTIVE_PREFIX_PATTERN = String.raw`^\s*(?://|\*)\s*${DIRECTIVE_BODY_PREFIX_PATTERN}`;

export const FORWARD_DIRECTIVE_KEYWORDS = 'do|run|include';
export const BACKWARD_DIRECTIVE_KEYWORDS = 'done-by|run-by|included-by';

// Trailing call-site parameters for path-bearing directives: zero or more
// `line=<n>` / `match="<string>"` params. A `match=` string must be non-empty
// (an empty `match=""` matches every line, so it is treated as malformed, as on
// `main`) and may embed an escaped quote `\"` (the documented form is
// `match="do \"analysis.do\""`); a `\` is only special directly before a `"`, so
// lone backslashes (e.g. Windows paths) stay literal. Non-capturing so it can be
// embedded in patterns with their own capture groups.
export const CALL_SITE_PARAMS_FRAGMENT =
    String.raw`(?:\s+(?:line=\d+|match="(?:\\"|[^"])+"))*`;
export const WORKING_DIR_DIRECTIVE_KEYWORDS =
    'working-directory|working-dir|current-directory|current-dir|cd|wd';
export const DECLARATION_DIRECTIVE_KEYWORDS =
    'local|global|scalar|matrix|program';

export type DirectivePrefix = '@lsp-' | 'sight:';

export function make_directive_pattern(
    keywords: string,
    suffix: string,
    flags?: string,
): RegExp {
    return new RegExp(`${DIRECTIVE_PREFIX_PATTERN}(${keywords})${suffix}`, flags);
}

// These probes run once per line/token during analysis and diagnostics, so the
// regexes are compiled once at module load rather than on every call (see the
// "RegExp in Loops" guidance in CLAUDE.md). None carry the global flag, so they
// hold no `lastIndex` state and are safe to share across calls.
const DIRECTIVE_PREFIX_REGEX = new RegExp(DIRECTIVE_PREFIX_PATTERN);
const IGNORE_DIRECTIVE_REGEX = new RegExp(`${DIRECTIVE_PREFIX_PATTERN}ignore:?\\s*$`);
const IGNORE_NEXT_DIRECTIVE_REGEX = new RegExp(`${DIRECTIVE_PREFIX_PATTERN}ignore-next:?\\s*$`);

// Shared compiled pattern for `@lsp-variables` / `sight: variables` declarations.
// Capture group 1 is the space-separated variable list.
export const VARIABLES_DIRECTIVE_PATTERN = new RegExp(
    `${DIRECTIVE_PREFIX_PATTERN}variables:?\\s+(.+)\\s*$`,
);

// Shared compiled pattern for declaration directives (`local`/`global`/
// `scalar`/`matrix`/`program`). Capture group 1 is the keyword, group 2 the
// space-separated name list. Like the probes above it requires a `//` or
// line-leading `*` comment prefix, so it never matches text inside a
// `/* ... */` block comment.
export const DECLARATION_DIRECTIVE_PATTERN = new RegExp(
    `${DIRECTIVE_PREFIX_PATTERN}(${DECLARATION_DIRECTIVE_KEYWORDS}):?\\s+(.+)\\s*$`,
);

export function has_directive_prefix(text: string): boolean {
    return DIRECTIVE_PREFIX_REGEX.test(text);
}

export function has_ignore_directive(text: string): boolean {
    return IGNORE_DIRECTIVE_REGEX.test(text);
}

// Matches a trailing `// sight: ignore` (or `// @lsp-ignore`) on a full source
// line, i.e. NOT anchored to the start of the line, so it recognizes a same-line
// suppression comment after code (`gen x = 1 // sight: ignore`). `ignore-next`
// is excluded by the trailing `$`. Used by the diagnostics fallback for
// synthetic documents that never ran the tokenized analyzer pass.
const TRAILING_IGNORE_DIRECTIVE_REGEX = new RegExp(
    `//\\s*${DIRECTIVE_BODY_PREFIX_PATTERN}ignore:?\\s*$`,
);

export function has_trailing_ignore_directive(text: string): boolean {
    return TRAILING_IGNORE_DIRECTIVE_REGEX.test(text);
}

export function has_ignore_next_directive(text: string): boolean {
    return IGNORE_NEXT_DIRECTIVE_REGEX.test(text);
}

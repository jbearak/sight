/**
 * Shared directive prefix handling.
 *
 * `sight:` is the canonical user-facing directive namespace. Directives must
 * occupy their own Stata line-comment line (`// sight: ...` or `* sight: ...`).
 * The older `@lsp-` prefix remains a permanent alias with the same line shape.
 */

export const DIRECTIVE_BODY_PREFIX_PATTERN = String.raw`(?:@lsp-|sight:\s*)`;
export const DIRECTIVE_PREFIX_PATTERN = String.raw`^\s*(?://|\*)\s*${DIRECTIVE_BODY_PREFIX_PATTERN}`;

export const FORWARD_DIRECTIVE_KEYWORDS = 'do|run|include';
export const BACKWARD_DIRECTIVE_KEYWORDS = 'done-by|run-by|included-by';
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

export function has_directive_prefix(text: string): boolean {
    return DIRECTIVE_PREFIX_REGEX.test(text);
}

export function has_ignore_directive(text: string): boolean {
    return IGNORE_DIRECTIVE_REGEX.test(text);
}

export function has_ignore_next_directive(text: string): boolean {
    return IGNORE_NEXT_DIRECTIVE_REGEX.test(text);
}

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

export function has_directive_prefix(text: string): boolean {
    return new RegExp(DIRECTIVE_PREFIX_PATTERN).test(text);
}

export function has_ignore_directive(text: string): boolean {
    return new RegExp(`${DIRECTIVE_PREFIX_PATTERN}ignore:?\\s*$`).test(text);
}

export function has_ignore_next_directive(text: string): boolean {
    return new RegExp(`${DIRECTIVE_PREFIX_PATTERN}ignore-next:?\\s*$`).test(text);
}

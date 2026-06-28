/**
 * Shared directive prefix handling.
 *
 * `sight:` is the canonical user-facing directive namespace. In Stata files
 * it appears inside a Stata comment (`// sight: ...` or `* sight: ...`).
 * The older `@lsp-` prefix remains a permanent alias.
 */

export const DIRECTIVE_PREFIX_PATTERN = String.raw`(?:@lsp-|(?:^|//|\*)\s*sight:\s*)`;

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
    return /@lsp-|(?:^|\/\/|\*)\s*sight:\s*/.test(text);
}

export function has_ignore_directive(text: string): boolean {
    return /@lsp-ignore(?!-next)(?=\s|$|[:])|(?:^|\/\/|\*)\s*sight:\s*ignore(?!-next)(?=\s|$|[:])/.test(
        comment_region(text),
    );
}

export function has_ignore_next_directive(text: string): boolean {
    return /@lsp-ignore-next(?=\s|$|[:])|(?:^|\/\/|\*)\s*sight:\s*ignore-next(?=\s|$|[:])/.test(
        comment_region(text),
    );
}

function comment_region(text: string): string {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        return trimmed;
    }

    const slash_comment = text.indexOf('//');
    if (slash_comment >= 0) return text.slice(slash_comment);

    return '';
}

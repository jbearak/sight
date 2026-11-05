/**
 * Severity of each lexer and parser error code.
 *
 * The editor's diagnostics (src/providers/diagnostics.ts) and the
 * `errors` list of `sight parse --json` (src/cli/parse-json.ts) both
 * read these tables, so the two cannot disagree. The names are the LSP
 * DiagnosticSeverity names in lower case. Each table is a `Record` over
 * its enum, so a new code does not compile until it has a severity.
 *
 * This module has no LSP dependency; the provider maps the names to
 * DiagnosticSeverity with resolve_diagnostic_severity().
 */

import { LexerErrorCode, ParseErrorCode } from '../types';

export type SyntaxErrorSeverity =
    'error' | 'warning' | 'information' | 'hint';

const LEXER_ERROR_SEVERITIES: Readonly<
    Record<LexerErrorCode, SyntaxErrorSeverity>
> = {
    [LexerErrorCode.UNBALANCED_QUOTES]: 'error',
    [LexerErrorCode.UNBALANCED_BLOCK_COMMENT]: 'error',
    [LexerErrorCode.UNTERMINATED_STATEMENT]: 'error',
    // A `///` with no space before it is text, so the next line runs
    // as its own command: not a matter of style.
    [LexerErrorCode.CONTINUATION_NO_SPACE]: 'warning',
    // Likewise a column-0 `//` or `///` in the middle of a
    // `#delimit ;` statement, which Stata reads as code.
    [LexerErrorCode.SLASHES_MID_STATEMENT]: 'warning',
    [LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT]: 'warning',
};

const PARSER_ERROR_SEVERITIES: Readonly<
    Record<ParseErrorCode, SyntaxErrorSeverity>
> = {
    [ParseErrorCode.SYNTAX_ERROR]: 'error',
    [ParseErrorCode.BRACE_ELSE_SAME_LINE]: 'error',
    [ParseErrorCode.BRACE_NOT_ALONE]: 'error',
    [ParseErrorCode.MISSING_PROGRAM_END]: 'error',
    [ParseErrorCode.OPEN_BRACE_ALONE]: 'error',
    [ParseErrorCode.UNCLOSED_BLOCK]: 'error',
    // After an `if` header, Stata runs the block but ignores what
    // follows the `{`.
    [ParseErrorCode.CODE_AFTER_OPEN_BRACE]: 'warning',
    // After any other header, Stata stops: "code follows on the same
    // line as open brace" (r(198)).
    [ParseErrorCode.CODE_FOLLOWS_OPEN_BRACE]: 'error',
    [ParseErrorCode.FORVALUES_SYNTAX]: 'error',
    [ParseErrorCode.REDUNDANT_MACRO_SUFFIX]: 'warning',
    [ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS]: 'error',
    [ParseErrorCode.UNBALANCED_PARENTHESES]: 'error',
    [ParseErrorCode.ORPHAN_CLOSE_BRACE]: 'error',
    [ParseErrorCode.STRAY_TOKEN_IN_CONDITION]: 'error',
    [ParseErrorCode.SPLIT_LITERAL_IN_CONDITION]: 'error',
    // Stata stops with "{ required" (r(100)).
    [ParseErrorCode.MISSING_OPEN_BRACE]: 'error',
};

/**
 * Severity of a lexer error code. A code outside the enum, which the
 * types rule out, is an error.
 */
export function lexer_error_severity(
    code: LexerErrorCode
): SyntaxErrorSeverity {
    return LEXER_ERROR_SEVERITIES[code] ?? 'error';
}

/**
 * Severity of a parser error code. A code outside the enum, which the
 * types rule out, is an error.
 */
export function parser_error_severity(
    code: ParseErrorCode
): SyntaxErrorSeverity {
    return PARSER_ERROR_SEVERITIES[code] ?? 'error';
}

/**
 * The Sight directive each comment carries, for `sight parse --json`.
 *
 * Every rule comes from the code the editor runs: the comment-token
 * rules the semantic analyzer applies (`ignore`, `ignore-next`,
 * declarations, `variables`; see directive-parser/comment-directives.ts)
 * and the line rules of DirectiveParser (forward calls anywhere, and
 * backward, `standalone`, and working-directory directives in the
 * header). A comment gets a directive only where Sight honors it.
 */

import { Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import {
    DirectiveParser,
    backward_directive_keyword,
} from '../directive-parser';
import {
    declaration_directive_of,
    ignore_directive_of,
    trivia_ignore_target_line,
    variables_directive_of,
    walk_directive_trivia,
} from '../directive-parser/comment-directives';
import { StataNode, Token } from '../types';

type Json = Record<string, unknown>;

/**
 * Tokens that are not code: an ignore target's range starts and ends
 * at code tokens.
 */
const NON_CODE_TOKEN_TYPES: ReadonlySet<string> = new Set([
    'COMMENT_LINE',
    'COMMENT_BLOCK',
    'CONTINUATION',
    'WHITESPACE',
    'STATEMENT_TERMINATOR',
    'DELIMIT_DIRECTIVE',
    'EOF',
]);

const BACKWARD_CALL_TYPES = {
    'done-by': 'do',
    'run-by': 'run',
    'included-by': 'include',
} as const;

export function comment_key(range: Range): string {
    return `${range.start.line}:${range.start.character}-` +
        `${range.end.line}:${range.end.character}`;
}

interface CodeLine {
    first: Token;
    last: Token;
    count: number;
    all_braces: boolean;
}

/** Only `}`s or a lone `end`: a block closer, never a diagnostic site. */
function is_closer_only(line: CodeLine): boolean {
    return line.all_braces ||
        (line.count === 1 && line.first.type === 'WORD' && line.first.value === 'end');
}

/**
 * Code tokens grouped by the line they start on, for turning a set of
 * suppressed lines into a range.
 */
function group_code_lines(tokens: Token[]): Map<number, CodeLine> {
    const the_lines = new Map<number, CodeLine>();
    for (const my_token of tokens) {
        if (NON_CODE_TOKEN_TYPES.has(my_token.type)) {
            continue;
        }
        const my_line = my_token.range.start.line;
        const is_brace = my_token.type === 'RBRACE';
        const existing = the_lines.get(my_line);
        if (existing === undefined) {
            the_lines.set(my_line, {
                first: my_token,
                last: my_token,
                count: 1,
                all_braces: is_brace,
            });
            continue;
        }
        existing.last = my_token;
        existing.count++;
        existing.all_braces = existing.all_braces && is_brace;
    }
    return the_lines;
}

interface IgnoreRecord {
    kind: 'ignore' | 'ignore_next';
    lines: Set<number>;
}

/**
 * Directives Sight honors in one file, looked up by comment range.
 */
export class CommentDirectives {
    private readonly by_key = new Map<string, Json>();

    constructor(path: string, content: string, tokens: Token[], nodes: StataNode[]) {
        const the_ignores = new Map<string, IgnoreRecord>();

        // Comment-token rules, as the analyzer applies them.
        for (let i = 0; i < tokens.length; i++) {
            const my_token = tokens[i];
            if (my_token.type !== 'COMMENT_LINE') {
                continue;
            }
            const my_key = comment_key(my_token.range);
            const my_declaration = declaration_directive_of(my_token);
            if (my_declaration && my_declaration.names.length > 0) {
                this.by_key.set(my_key, {
                    kind: 'declare',
                    symbol_kind: my_declaration.type,
                    names: my_declaration.names,
                });
                continue;
            }
            const the_variables = variables_directive_of(my_token);
            if (the_variables && the_variables.length > 0) {
                this.by_key.set(my_key, {
                    kind: 'declare',
                    symbol_kind: 'variables',
                    names: the_variables,
                });
                continue;
            }
            const my_ignore = ignore_directive_of(tokens, i);
            if (my_ignore) {
                const the_lines = new Set<number>();
                if (my_ignore.lines) {
                    for (
                        let my_line = my_ignore.lines.start_line;
                        my_line <= my_ignore.lines.end_line;
                        my_line++
                    ) {
                        the_lines.add(my_line);
                    }
                }
                the_ignores.set(my_key, { kind: my_ignore.kind, lines: the_lines });
            }
        }

        // The analyzer also suppresses the first line of the statement a
        // leading or block-ending comment precedes.
        walk_directive_trivia(nodes, (trivia, following_node) => {
            const my_line = trivia_ignore_target_line(trivia, following_node);
            if (my_line !== undefined) {
                the_ignores.get(comment_key(trivia.range))?.lines.add(my_line);
            }
        });

        const the_code_lines = group_code_lines(tokens);
        for (const [my_key, my_record] of the_ignores) {
            this.by_key.set(my_key, {
                kind: my_record.kind,
                target_range: target_range_of(my_record.lines, the_code_lines),
            });
        }

        this.add_line_directives(path, content, tokens);
    }

    /** The directive for the comment at `range`, or null. */
    directive_at(range: Range): Json | null {
        return this.by_key.get(comment_key(range)) ?? null;
    }

    /**
     * Forward, backward, standalone, and working-directory directives,
     * from DirectiveParser. It reports each by line; the comment is the
     * first token on that line.
     */
    private add_line_directives(path: string, content: string, tokens: Token[]): void {
        const result = new DirectiveParser().parse(
            content, URI.file(path).toString(), tokens);

        const the_first_tokens = new Map<number, Token>();
        for (const my_token of tokens) {
            const my_line = my_token.range.start.line;
            if (my_token.type !== 'WHITESPACE' && !the_first_tokens.has(my_line)) {
                the_first_tokens.set(my_line, my_token);
            }
        }
        const set_on_line = (line: number, directive: Json): void => {
            const my_token = the_first_tokens.get(line);
            if (my_token?.type !== 'COMMENT_LINE') {
                return;
            }
            const my_key = comment_key(my_token.range);
            if (!this.by_key.has(my_key)) {
                this.by_key.set(my_key, directive);
            }
        };

        for (const my_call of result.forward_calls ?? []) {
            set_on_line(my_call.range.start.line, {
                kind: 'forward',
                call_type: my_call.type,
                raw_path: my_call.raw_path,
            });
        }
        for (const my_directive of result.directives) {
            const my_line = my_directive.range.start.line;
            const my_text = the_first_tokens.get(my_line)?.value ?? '';
            const my_keyword = backward_directive_keyword(my_text) ??
                (my_directive.type === 'included-by' ? 'included-by' : 'done-by');
            set_on_line(my_line, {
                kind: 'backward',
                call_type: BACKWARD_CALL_TYPES[my_keyword],
                raw_path: my_directive.raw_path,
            });
        }
        if (result.standalone) {
            set_on_line(result.standalone.range.start.line, { kind: 'standalone' });
        }
        if (result.working_directory) {
            set_on_line(result.working_directory.range.start.line, {
                kind: 'working_directory',
                raw_path: result.working_directory.path,
            });
        }
    }
}

/**
 * The range from the first to the last code token on the suppressed
 * lines, skipping lines that only close a block. Null when no code is
 * suppressed.
 */
function target_range_of(
    lines: Set<number>,
    code_lines: Map<number, CodeLine>
): Range | null {
    let first: Token | undefined;
    let last: Token | undefined;
    for (const my_line of [...lines].sort((a, b) => a - b)) {
        const my_code = code_lines.get(my_line);
        if (my_code === undefined || is_closer_only(my_code)) {
            continue;
        }
        first ??= my_code.first;
        last = my_code.last;
    }
    if (first === undefined || last === undefined) {
        return null;
    }
    return { start: first.range.start, end: last.range.end };
}

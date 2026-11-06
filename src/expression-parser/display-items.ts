/**
 * Split the arguments of `display` into items ([P] display): quoted
 * strings, `%fmt` formats, `[=]exp` expressions, and directives such as
 * `_n`, `_col(#)`, `as result`, and `,`.
 *
 * Item boundaries follow StataMP 18, which was checked directly:
 * - A quoted string at the start of an item is the whole item: `di "a"
 *   + "b"` is an error, while `di ("a" + "b")` shows `ab`.
 * - An expression goes on across whitespace only through a binary
 *   operator: `di 1 2` shows `12`, `di 1 -2` shows `-1`, and `di 1 (2)`
 *   shows `12`. A function call or subscript must touch its name: `di
 *   abs (-1)` reads `abs` as a variable.
 * - `%fmt` runs to the next whitespace (`%tdD/M/Y`; `%5.2f(1)` is an
 *   invalid format), and applies to the next string or expression,
 *   past any directives (`di %5.2f _n 2` shows `2.00`).
 * - A directive is read only at the start of an item, and by exact
 *   case: `di _n+1` is a newline then `1`, `di 1+_n` is `2`, and `_N`
 *   is never a directive. Abbreviations are those Stata 18 accepts:
 *   `_n` to `_newline`, `_col` to `_column`, `_c` to `_continue`
 *   (`_co` is `_continue`), `_s` to `_skip`, `_d` to `_dup`, `_r` to
 *   `_request`; `_char` and `_asis` in full. A directive's `(#)` may
 *   follow a space (`_n (2)` is two newlines).
 * - `as` takes `text` or `txt`, `result` down to `r`, `error` down to
 *   `er`, and `input` down to `inp`. `in` takes `smcl` or an old color
 *   name (`in red`, `in gr`).
 * - Two commas in a row show nothing, even with a space between them:
 *   `,,,` is `,,` then `,`.
 *
 * A macro reference at the start of an item is read as an expression;
 * what it expands to is unknown here. Like parse_expression, this never
 * throws: text the grammar does not model ends up in an `unparsed` node.
 * Work is linear in the number of tokens.
 */

import { Position, Range } from 'vscode-languageserver-textdocument';
import {
    DisplayDirectiveName,
    DisplayItem,
    ExpressionNode,
    Token,
} from '../types';
import {
    join_tokens,
    parse_expression,
    scan_string,
    significant_tokens,
} from './index';

/** Binary operators, as the lexer spells them. */
const BINARY_OPERATORS: ReadonlySet<string> = new Set([
    '+', '-', '*', '/', '^', '==', '!=', '~=', '<', '>', '<=', '>=',
    '&', '|',
]);

const UNARY_OPERATORS: ReadonlySet<string> = new Set(['-', '+', '!', '~']);

/** Token types that join a touching name or number into one operand. */
const JOINING_TYPES: ReadonlySet<string> = new Set([
    'WORD', 'NUMBER', 'MACRO_REF_LOCAL', 'MACRO_REF_GLOBAL',
    'LPAREN', 'LBRACKET',
]);

/**
 * Underscore directives: full name, shortest abbreviation length, and
 * whether a parenthesized argument may follow.
 */
const UNDERSCORE_DIRECTIVES: ReadonlyArray<{
    name: DisplayDirectiveName;
    min_length: number;
    takes_argument: boolean;
}> = [
    { name: '_newline', min_length: 2, takes_argument: true },
    { name: '_column', min_length: 4, takes_argument: true },
    { name: '_continue', min_length: 2, takes_argument: false },
    { name: '_skip', min_length: 2, takes_argument: true },
    { name: '_dup', min_length: 2, takes_argument: true },
    { name: '_request', min_length: 2, takes_argument: true },
    { name: '_char', min_length: 5, takes_argument: true },
    { name: '_asis', min_length: 5, takes_argument: false },
];

/** `as` styles: canonical name and shortest abbreviation length. */
const AS_STYLES: ReadonlyArray<{ name: string; min_length: number }> = [
    { name: 'text', min_length: 4 },
    { name: 'result', min_length: 1 },
    { name: 'error', min_length: 2 },
    { name: 'input', min_length: 3 },
];

function is_abbreviation(value: string, full: string, min_length: number): boolean {
    return value.length >= min_length && full.startsWith(value);
}

function underscore_directive(
    value: string
): { name: DisplayDirectiveName; takes_argument: boolean } | undefined {
    for (const my_directive of UNDERSCORE_DIRECTIVES) {
        if (is_abbreviation(value, my_directive.name, my_directive.min_length)) {
            return my_directive;
        }
    }
    return undefined;
}

function as_style(value: string): string | null {
    if (value === 'txt') {
        return 'text';
    }
    for (const my_style of AS_STYLES) {
        if (is_abbreviation(value, my_style.name, my_style.min_length)) {
            return my_style.name;
        }
    }
    return null;
}

function is_adjacent(previous: Token, next: Token): boolean {
    return previous.range.end.line === next.range.start.line &&
        previous.range.end.character === next.range.start.character;
}

function is_operator(token: Token | undefined, values: ReadonlySet<string>): boolean {
    return token !== undefined && token.type === 'OPERATOR' && values.has(token.value);
}

function is_open(token: Token): boolean {
    return token.type === 'LPAREN' || token.type === 'LBRACKET';
}

function span_of(tokens: readonly Token[], start: number, end: number): Range {
    return { start: tokens[start].range.start, end: tokens[end - 1].range.end };
}

function empty_expression(position: Position): ExpressionNode {
    return {
        kind: 'unparsed',
        text: '',
        reason: 'empty',
        range: { start: position, end: position },
    };
}

/**
 * For each `(` or `[` that is closed, the index just past its close.
 * An unclosed one runs to the end of the input.
 */
function match_groups(tokens: readonly Token[]): Map<number, number> {
    const the_ends = new Map<number, number>();
    const the_open: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (is_open(tokens[i])) {
            the_open.push(i);
        } else if (tokens[i].type === 'RPAREN' || tokens[i].type === 'RBRACKET') {
            const open = the_open.pop();
            if (open !== undefined) {
                the_ends.set(open, i + 1);
            }
        }
    }
    return the_ends;
}

class DisplayItemParser {
    private readonly ends: Map<number, number>;
    private readonly the_items: DisplayItem[] = [];
    private pending_format: string | null = null;
    private i = 0;

    constructor(private readonly tokens: readonly Token[]) {
        this.ends = match_groups(tokens);
    }

    parse(): DisplayItem[] {
        while (this.i < this.tokens.length) {
            this.parse_item();
        }
        return this.the_items;
    }

    private parse_item(): void {
        const token = this.tokens[this.i];
        if (token.type === 'COMMA') {
            const is_pair = this.tokens[this.i + 1]?.type === 'COMMA';
            this.push_directive(is_pair ? ',,' : ',', this.i, this.i + (is_pair ? 2 : 1));
            return;
        }
        if (token.type === 'STRING') {
            // The lexer splits `"n = `n' done"` at its macros.
            const scan = scan_string(this.tokens, this.i, this.tokens.length);
            if (scan !== null) {
                this.the_items.push({ ...scan.node, format: this.take_format() });
                this.i = scan.end;
                return;
            }
        }
        if (token.type === 'WORD') {
            if (token.value === '%') {
                this.parse_format();
                return;
            }
            if (token.value === 'as' || token.value === 'in') {
                this.parse_style_directive(token.value);
                return;
            }
            const directive = underscore_directive(token.value);
            if (directive !== undefined) {
                this.parse_underscore_directive(directive.name, directive.takes_argument);
                return;
            }
        }
        this.parse_expression_item();
    }

    private take_format(): string | null {
        const format = this.pending_format;
        this.pending_format = null;
        return format;
    }

    private parse_format(): void {
        const start = this.i;
        let end = start + 1;
        while (end < this.tokens.length && is_adjacent(this.tokens[end - 1], this.tokens[end])) {
            end++;
        }
        const text = join_tokens(this.tokens, start, end);
        this.the_items.push({ kind: 'format', text, range: span_of(this.tokens, start, end) });
        this.pending_format = text;
        this.i = end;
    }

    /** `as style` or `in style`. */
    private parse_style_directive(name: 'as' | 'in'): void {
        const start = this.i;
        const next = this.tokens[start + 1];
        let end = start + 1;
        let style: string | null = null;
        if (next !== undefined && next.type === 'WORD') {
            style = name === 'as' ? as_style(next.value) : next.value;
            end++;
        } else if (next !== undefined &&
            (next.type === 'MACRO_REF_LOCAL' || next.type === 'MACRO_REF_GLOBAL')) {
            // The style is known only when the macro is expanded.
            end++;
        }
        this.push_directive(name, start, end, null, style);
    }

    private parse_underscore_directive(
        name: DisplayDirectiveName,
        takes_argument: boolean
    ): void {
        const start = this.i;
        const open = start + 1;
        if (!takes_argument || this.tokens[open]?.type !== 'LPAREN') {
            this.push_directive(name, start, open);
            return;
        }
        const closed_end = this.ends.get(open);
        const end = closed_end ?? this.tokens.length;
        const inner_start = open + 1;
        const inner_end = closed_end !== undefined ? closed_end - 1 : end;
        const has_inner = inner_end > inner_start;
        const range: Range = has_inner
            ? span_of(this.tokens, inner_start, inner_end)
            : {
                start: this.tokens[open].range.end,
                end: this.tokens[open].range.end,
            };
        let expression: ExpressionNode | null = null;
        if (name !== '_request') {
            expression = has_inner
                ? parse_expression(this.tokens.slice(inner_start, inner_end))
                : empty_expression(range.start);
        }
        const argument = {
            text: join_tokens(this.tokens, inner_start, inner_end),
            expression,
            range,
        };
        this.push_directive(name, start, end, argument);
    }

    private push_directive(
        name: DisplayDirectiveName,
        start: number,
        end: number,
        argument: { text: string; expression: ExpressionNode | null; range: Range } | null = null,
        style: string | null = null
    ): void {
        this.the_items.push({
            kind: 'directive',
            name,
            text: join_tokens(this.tokens, start, end),
            argument,
            style,
            range: span_of(this.tokens, start, end),
        });
        this.i = end;
    }

    /** `[=]exp`, ending where Stata's display ends it. */
    private parse_expression_item(): void {
        const start = this.i;
        const equals = this.tokens[start];
        const has_equals = equals.type === 'OPERATOR' && equals.value === '=';
        const expression_start = has_equals ? start + 1 : start;
        let end = this.scan_expression(expression_start);
        if (end === start) {
            // A token no item can start with, such as a stray `)`.
            end = start + 1;
        }
        const expression = end > expression_start
            ? parse_expression(this.tokens.slice(expression_start, end))
            : empty_expression(equals.range.end);
        this.the_items.push({
            kind: 'expression',
            text: join_tokens(this.tokens, start, end),
            format: this.take_format(),
            expression,
            range: span_of(this.tokens, start, end),
        });
        this.i = end;
    }

    /** One operand, then any number of `binary_operator operand`. */
    private scan_expression(start: number): number {
        let end = this.scan_operand(start);
        while (end > start && is_operator(this.tokens[end], BINARY_OPERATORS)) {
            end = this.scan_operand(end + 1);
        }
        return end;
    }

    private scan_operand(start: number): number {
        let i = start;
        while (is_operator(this.tokens[i], UNARY_OPERATORS)) {
            i++;
        }
        const token = this.tokens[i];
        if (token === undefined) {
            return i;
        }
        if (is_open(token)) {
            return this.ends.get(i) ?? this.tokens.length;
        }
        if (token.type === 'STRING') {
            return scan_string(this.tokens, i, this.tokens.length)?.end ?? i + 1;
        }
        if (!JOINING_TYPES.has(token.type)) {
            return i;
        }
        // A name or number, with whatever touches it: a call's or
        // subscript's brackets, or the pieces of `` x`i' ``.
        i++;
        while (i < this.tokens.length &&
            is_adjacent(this.tokens[i - 1], this.tokens[i]) &&
            JOINING_TYPES.has(this.tokens[i].type)) {
            i = is_open(this.tokens[i])
                ? this.ends.get(i) ?? this.tokens.length
                : i + 1;
        }
        return i;
    }
}

/** The items of a `display` statement, from the tokens after its name. */
export function parse_display_items(tokens: readonly Token[]): DisplayItem[] {
    return new DisplayItemParser(significant_tokens(tokens)).parse();
}

/**
 * Stata expression parser.
 *
 * Builds the structured expression AST (see ExpressionNode in
 * src/types) from lexer tokens. The statement parser hands it the tokens
 * it already collected for an `= exp`, an `if` qualifier, an `in` range,
 * a weight, or a `using` clause, so this module never re-lexes source.
 *
 * Contracts:
 * - Parsing never throws. Anything the grammar does not model becomes an
 *   `unparsed` node that keeps its text and range. Failures are local
 *   where the token structure allows it: one bad function argument or
 *   one `L.x` operand does not discard the rest of the expression.
 * - Every node carries a range.
 * - Matching is exact-case (Stata is case-sensitive): `_N` and `_n` are
 *   different system variables, and `R(mean)` is a function call, not a
 *   stored result.
 * - Work is linear in the number of tokens. Bracket pairs are matched
 *   once per top-level call, and nested groups are skipped by index.
 *
 * Operator precedence, highest first, as Stata 18 evaluates it:
 *   ^   unary - and ! (or ~)   * /   + -   comparisons   &   |
 * Binary operators, `^` included, associate to the left. Checked against
 * StataMP 18: `2^3^2` is 64, `-2^2` is -4, `!2^-1` is 0 (so `^` binds
 * tighter than `!`, although [U] 13.2.5 lists `!` first), `!0 == 5` is 0
 * (so `!` binds tighter than `==`), and `2^-1^2` is .25.
 */

import { Position, Range } from 'vscode-languageserver-textdocument';
import {
    BinaryOperator,
    CallExpressionNode,
    CoefficientExpressionNode,
    ExpressionNode,
    InRangeNode,
    MacroRefExpressionNode,
    PathNode,
    StoredResultExpressionNode,
    StringExpressionNode,
    TextOrMacroPart,
    Token,
    UnparsedExpressionNode,
    UnparsedReason,
    VarlistExpressionNode,
    WeightKind,
} from '../types';
import { StataLexer } from '../lexer';

/** Token types that never carry expression content. */
const TRIVIA_TYPES: ReadonlySet<string> = new Set([
    'COMMENT_LINE',
    'COMMENT_BLOCK',
    'CONTINUATION',
    'WHITESPACE',
    'STATEMENT_TERMINATOR',
    'EOF',
]);

/** Binary operators below `^`: canonical form and precedence. */
const BINARY_OPERATORS: ReadonlyMap<string, { op: BinaryOperator; precedence: number }> = new Map([
    ['|', { op: '|', precedence: 1 }],
    ['&', { op: '&', precedence: 2 }],
    ['==', { op: '==', precedence: 3 }],
    ['!=', { op: '!=', precedence: 3 }],
    ['~=', { op: '!=', precedence: 3 }],
    ['<', { op: '<', precedence: 3 }],
    ['>', { op: '>', precedence: 3 }],
    ['<=', { op: '<=', precedence: 3 }],
    ['>=', { op: '>=', precedence: 3 }],
    ['+', { op: '+', precedence: 4 }],
    ['-', { op: '-', precedence: 4 }],
    ['*', { op: '*', precedence: 5 }],
    ['/', { op: '/', precedence: 5 }],
]);

/** Stata system variables usable in expressions (exact case). */
const SYSTEM_VARIABLES: ReadonlySet<string> = new Set([
    '_n', '_N', '_pi', '_rc', '_cons',
]);

type CoefficientName = CoefficientExpressionNode['which'];
type StoredResultClass = StoredResultExpressionNode['result_class'];

const COEFFICIENT_NAMES: ReadonlySet<string> = new Set<CoefficientName>([
    '_b', '_se', '_coef',
]);

const STORED_RESULT_CLASSES: ReadonlySet<string> = new Set<StoredResultClass>([
    'r', 'e', 's', 'c',
]);

function is_coefficient_name(value: string): value is CoefficientName {
    return COEFFICIENT_NAMES.has(value);
}

function is_stored_result_class(value: string): value is StoredResultClass {
    return STORED_RESULT_CLASSES.has(value);
}

/** Weight keywords and their canonical kinds (exact case). */
export const WEIGHT_KEYWORDS: ReadonlyMap<string, WeightKind> = new Map([
    ['weight', 'weight'],
    ['fweight', 'fweight'],
    ['fw', 'fweight'],
    ['frequency', 'fweight'],
    ['aweight', 'aweight'],
    ['aw', 'aweight'],
    ['cellsize', 'aweight'],
    ['pweight', 'pweight'],
    ['pw', 'pweight'],
    ['iweight', 'iweight'],
    ['iw', 'iweight'],
]);

/**
 * egen functions whose arguments are varlists rather than expressions.
 * Others (mean, total, max, ...) take an expression.
 */
const EGEN_VARLIST_FUNCTIONS: ReadonlySet<string> = new Set([
    'anycount', 'anymatch', 'anyvalue', 'concat', 'cut', 'diff', 'ends',
    'group', 'mode', 'mtr', 'rowfirst', 'rowlast', 'rowmax', 'rowmean',
    'rowmedian', 'rowmin', 'rowmiss', 'rownonmiss', 'rowpctile', 'rowsd',
    'rowtotal', 'tag',
]);

const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const ASCII_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `.` or `.a` through `.z`. */
function is_missing_literal(value: string): boolean {
    if (value.charCodeAt(0) !== 46 /* . */) {
        return false;
    }
    if (value.length === 1) {
        return true;
    }
    const code = value.charCodeAt(1);
    return value.length === 2 && code >= 97 && code <= 122;
}

function is_name(value: string): boolean {
    return ASCII_NAME_PATTERN.test(value) || NAME_PATTERN.test(value);
}
const NAME_CHAR_PATTERN = /[\p{L}\p{N}_]/u;

class ExpressionParseFailure extends Error {}

// ---------------------------------------------------------------------------
// Range and text helpers

function span(start: Range, end: Range): Range {
    return { start: start.start, end: end.end };
}

function is_adjacent(previous: Token, next: Token): boolean {
    return previous.range.end.line === next.range.start.line &&
        previous.range.end.character === next.range.start.character;
}

/**
 * Join token values, inserting one space wherever the source had a gap
 * (whitespace, a comment, or a `///` line break).
 */
function join_tokens(tokens: readonly Token[], start: number, end: number): string {
    const the_parts: string[] = [];
    for (let i = start; i < end; i++) {
        const my_token = tokens[i];
        if (i > start && !is_adjacent(tokens[i - 1], my_token)) {
            the_parts.push(' ');
        }
        the_parts.push(my_token.value);
    }
    return the_parts.join('');
}

/** Position `offset` characters into a single-line token. */
function offset_position(token: Token, offset: number): Position {
    return {
        line: token.range.start.line,
        character: token.range.start.character + offset,
    };
}

function sub_range(token: Token, start: number, end: number): Range {
    return {
        start: offset_position(token, start),
        end: offset_position(token, end),
    };
}

function empty_range_at(position: Position): Range {
    return { start: position, end: position };
}

/**
 * Where an empty result sits when every input token is trivia: the
 * start of the first token, so the range stays inside the input.
 */
function input_start(tokens: readonly Token[]): Position | undefined {
    return tokens[0]?.range.start;
}

/**
 * Drop comments, continuations, and swallowed line breaks. Returns the
 * input itself when there is nothing to drop (the common case).
 */
export function significant_tokens(tokens: readonly Token[]): readonly Token[] {
    let first_trivia = -1;
    for (let i = 0; i < tokens.length; i++) {
        if (TRIVIA_TYPES.has(tokens[i].type)) {
            first_trivia = i;
            break;
        }
    }
    if (first_trivia === -1) {
        return tokens;
    }
    const the_result: Token[] = tokens.slice(0, first_trivia);
    for (let i = first_trivia + 1; i < tokens.length; i++) {
        if (!TRIVIA_TYPES.has(tokens[i].type)) {
            the_result.push(tokens[i]);
        }
    }
    return the_result;
}

function make_unparsed(
    tokens: readonly Token[],
    start: number,
    end: number,
    reason: UnparsedReason,
    fallback_position?: Position
): UnparsedExpressionNode {
    if (start >= end) {
        const position = tokens[start]?.range.start ??
            tokens[start - 1]?.range.end ??
            fallback_position ?? { line: 0, character: 0 };
        return {
            kind: 'unparsed',
            text: '',
            reason: 'empty',
            range: empty_range_at(position),
        };
    }
    return {
        kind: 'unparsed',
        text: join_tokens(tokens, start, end),
        reason,
        range: span(tokens[start].range, tokens[end - 1].range),
    };
}

/**
 * Matching close-token index for each open paren/bracket, and the reverse.
 * Unmatched brackets have no entry, so a lookup returns undefined, which
 * the callers treat as "unclosed". Computed once per top-level parse.
 */
type BracketMatches = readonly number[];

const NO_BRACKETS: BracketMatches = [];

function match_brackets(tokens: readonly Token[]): BracketMatches {
    let matches: number[] | undefined;
    const the_stack: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const type = tokens[i].type;
        if (type === 'LPAREN' || type === 'LBRACKET') {
            matches = matches ?? [];
            the_stack.push(i);
        } else if (type === 'RPAREN' || type === 'RBRACKET') {
            const open_type = type === 'RPAREN' ? 'LPAREN' : 'LBRACKET';
            const top = the_stack[the_stack.length - 1];
            if (matches !== undefined && top !== undefined && tokens[top].type === open_type) {
                the_stack.pop();
                matches[top] = i;
                matches[i] = top;
            } else {
                // Mismatched close: leave both unmatched. Drop the stack
                // so later groups do not pair across the damage.
                the_stack.length = 0;
            }
        }
    }
    return matches ?? NO_BRACKETS;
}

/** Close index for the open bracket at `index`, or -1. */
function close_of(matches: BracketMatches, index: number): number {
    const close = matches[index];
    return close !== undefined && close > index ? close : -1;
}

// ---------------------------------------------------------------------------
// Macro references

/** Characters of a `$name` global reference name. */
function global_name_length(text: string, start: number): number {
    let i = start;
    while (i < text.length && NAME_CHAR_PATTERN.test(text[i])) {
        i++;
    }
    return i - start;
}

/**
 * Split a macro name that may contain nested references, e.g. "x`i'"
 * or "a${b}", into text and macro_ref parts. `name_offset` is the
 * name's character offset inside `token`.
 */
function scan_name_parts(
    token: Token,
    name: string,
    name_offset: number
): TextOrMacroPart[] {
    const the_parts: TextOrMacroPart[] = [];
    let text_start = 0;
    let i = 0;

    const flush_text = (end: number): void => {
        if (end > text_start) {
            the_parts.push({
                kind: 'text',
                value: name.slice(text_start, end),
                range: sub_range(token, name_offset + text_start, name_offset + end),
            });
        }
    };

    while (i < name.length) {
        const char = name[i];
        let ref_end = -1;
        let scope: 'local' | 'global' = 'local';
        if (char === '`') {
            let depth = 0;
            for (let j = i; j < name.length; j++) {
                if (name[j] === '`') {
                    depth++;
                } else if (name[j] === "'") {
                    depth--;
                    if (depth === 0) {
                        ref_end = j + 1;
                        break;
                    }
                }
            }
        } else if (char === '$') {
            scope = 'global';
            if (name[i + 1] === '{') {
                const close = name.indexOf('}', i + 2);
                ref_end = close === -1 ? -1 : close + 1;
            } else {
                const length = global_name_length(name, i + 1);
                ref_end = length > 0 ? i + 1 + length : -1;
            }
        }
        if (ref_end === -1) {
            i++;
            continue;
        }
        flush_text(i);
        const ref_token: Token = {
            type: scope === 'local' ? 'MACRO_REF_LOCAL' : 'MACRO_REF_GLOBAL',
            value: name.slice(i, ref_end),
            range: sub_range(token, name_offset + i, name_offset + ref_end),
        };
        the_parts.push(parse_macro_ref_token(ref_token));
        i = ref_end;
        text_start = i;
    }
    flush_text(name.length);
    return the_parts;
}


const MACVAL_OPEN = 'macval(';

/**
 * The text and macro_ref parts of a name built from touching tokens,
 * such as `` v`i' `` or `` foo`x'bar ``. Adjacent text tokens share
 * one text part. Used for varlist names, macro definition names and
 * `args` names, so all three have the same part objects.
 */
export function name_parts_from_tokens(
    tokens: readonly Token[]
): TextOrMacroPart[] {
    const the_parts: TextOrMacroPart[] = [];
    for (const my_token of tokens) {
        if (my_token.type === 'MACRO_REF_LOCAL' || my_token.type === 'MACRO_REF_GLOBAL') {
            the_parts.push(parse_macro_ref_token(my_token));
            continue;
        }
        const previous = the_parts[the_parts.length - 1];
        if (previous && previous.kind === 'text') {
            previous.value += my_token.value;
            previous.range = span(previous.range, my_token.range);
        } else {
            the_parts.push({ kind: 'text', value: my_token.value, range: my_token.range });
        }
    }
    return the_parts;
}

/**
 * Parse one MACRO_REF_LOCAL or MACRO_REF_GLOBAL token into a node.
 * Never throws.
 */
export function parse_macro_ref_token(token: Token): MacroRefExpressionNode {
    const value = token.value;
    const scope: 'local' | 'global' =
        token.type === 'MACRO_REF_GLOBAL' || value.startsWith('$')
            ? 'global' : 'local';
    const node: MacroRefExpressionNode = {
        kind: 'macro_ref',
        scope,
        form: 'name',
        text: value,
        range: token.range,
    };

    let inner: string;
    let inner_offset: number;
    if (scope === 'global') {
        if (value.startsWith('${') && value.endsWith('}')) {
            inner = value.slice(2, -1);
            inner_offset = 2;
        } else {
            inner = value.slice(1);
            inner_offset = 1;
        }
    } else if (value.startsWith('`') && value.endsWith("'") && value.length >= 2) {
        inner = value.slice(1, -1);
        inner_offset = 1;
    } else {
        inner = value;
        inner_offset = 0;
    }

    if (scope === 'local' && inner.startsWith('=')) {
        node.form = 'eval';
        node.expression = parse_expression_text(
            inner.slice(1),
            offset_position(token, inner_offset + 1)
        );
        return node;
    }
    if (scope === 'local' && inner.startsWith(':')) {
        node.form = 'extended';
        node.extended = inner.slice(1).trim();
        return node;
    }

    let name = inner;
    let name_offset = inner_offset;
    if (scope === 'local' && inner.length > 2) {
        const head = inner.slice(0, 2);
        const tail = inner.slice(-2);
        if (head === '++' || head === '--') {
            node.form = 'increment';
            node.increment = head;
            node.increment_position = 'prefix';
            name = inner.slice(2);
            name_offset = inner_offset + 2;
        } else if (tail === '++' || tail === '--') {
            node.form = 'increment';
            node.increment = tail;
            node.increment_position = 'suffix';
            name = inner.slice(0, -2);
        } else if (inner.startsWith(MACVAL_OPEN) && inner.endsWith(')')) {
            node.macval = true;
            name = inner.slice(MACVAL_OPEN.length, -1);
            name_offset = inner_offset + MACVAL_OPEN.length;
        }
    }

    node.name = name;
    if (name.includes('`') || name.includes('$')) {
        node.name_parts = scan_name_parts(token, name, name_offset);
    }
    return node;
}

// ---------------------------------------------------------------------------
// Strings

/** Net change in compound-quote depth across `text`. */
function compound_depth_delta(text: string): number {
    let delta = 0;
    for (let i = 0; i + 1 < text.length; i++) {
        if (text[i] === '`' && text[i + 1] === '"') {
            delta++;
            i++;
        } else if (text[i] === '"' && text[i + 1] === "'") {
            delta--;
            i++;
        }
    }
    return delta;
}

interface StringScan {
    node: StringExpressionNode;
    end: number;   // Index after the string's last token
}

/**
 * Read a string starting at tokens[start]. The lexer splits a string
 * with embedded macro references into adjacent fragments
 * (`"a ` + `` `b' `` + ` c"`), which are merged back here. Returns null
 * when tokens[start] does not open a string or the string never closes.
 */
function scan_string(
    tokens: readonly Token[],
    start: number,
    end: number
): StringScan | null {
    const first = tokens[start];
    if (first.type !== 'STRING') {
        return null;
    }
    const quote: 'simple' | 'compound' =
        first.value.startsWith('`"') ? 'compound' : 'simple';
    if (quote === 'simple' && !first.value.startsWith('"')) {
        return null;
    }

    const open_length = quote === 'compound' ? 2 : 1;
    const the_parts: TextOrMacroPart[] = [];
    let depth = 1;

    // Text of one STRING token, minus quotes consumed at either end.
    const add_text = (token: Token, from: number, to: number): void => {
        if (to <= from) {
            return;
        }
        const value = token.value.slice(from, to);
        const previous = the_parts[the_parts.length - 1];
        const range = sub_range(token, from, to);
        if (previous && previous.kind === 'text') {
            previous.value += value;
            previous.range = span(previous.range, range);
        } else {
            the_parts.push({ kind: 'text', value, range });
        }
    };

    // Does a STRING token close the string, and where does its content end?
    const closing_end = (token: Token, from: number): number => {
        const value = token.value;
        if (quote === 'simple') {
            const is_close = value.endsWith('"') &&
                value.length - 1 >= from;
            return is_close ? value.length - 1 : -1;
        }
        depth += compound_depth_delta(value.slice(from));
        return depth === 0 ? value.length - 2 : -1;
    };

    const first_close = closing_end(first, open_length);
    if (first_close !== -1) {
        add_text(first, open_length, first_close);
        return {
            node: {
                kind: 'string',
                quote,
                text: first.value,
                parts: the_parts,
                range: first.range,
            },
            end: start + 1,
        };
    }
    add_text(first, open_length, first.value.length);

    let i = start + 1;
    while (i < end && is_adjacent(tokens[i - 1], tokens[i])) {
        const my_token = tokens[i];
        if (my_token.type === 'MACRO_REF_LOCAL' || my_token.type === 'MACRO_REF_GLOBAL') {
            the_parts.push(parse_macro_ref_token(my_token));
            i++;
            continue;
        }
        if (my_token.type !== 'STRING') {
            break;
        }
        const close = closing_end(my_token, 0);
        if (close !== -1) {
            add_text(my_token, 0, close);
            return {
                node: {
                    kind: 'string',
                    quote,
                    text: tokens.slice(start, i + 1).map((t) => t.value).join(''),
                    parts: the_parts,
                    range: span(first.range, my_token.range),
                },
                end: i + 1,
            };
        }
        add_text(my_token, 0, my_token.value.length);
        i++;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Expression grammar

class ExpressionParser {
    private pos: number;

    constructor(
        private readonly tokens: readonly Token[],
        private readonly matches: BracketMatches,
        start: number,
        private readonly end: number
    ) {
        this.pos = start;
    }

    /** Parse [start, end) completely or throw. */
    parse_all(): ExpressionNode {
        if (this.pos >= this.end) {
            throw new ExpressionParseFailure('empty expression');
        }
        const node = this.parse_binary(0);
        if (this.pos !== this.end) {
            throw new ExpressionParseFailure('unexpected token');
        }
        return node;
    }

    private peek(): Token | undefined {
        return this.pos < this.end ? this.tokens[this.pos] : undefined;
    }

    private peek_operator(): string | undefined {
        const token = this.peek();
        return token?.type === 'OPERATOR' ? token.value : undefined;
    }

    private advance(): Token {
        const token = this.peek();
        if (!token) {
            throw new ExpressionParseFailure('unexpected end');
        }
        this.pos++;
        return token;
    }

    private binary(
        op: BinaryOperator,
        op_text: string,
        left: ExpressionNode,
        right: ExpressionNode
    ): ExpressionNode {
        return {
            kind: 'binary',
            op,
            op_text,
            left,
            right,
            range: span(left.range, right.range),
        };
    }

    /**
     * Binary operators below `^`, by precedence climbing. All associate
     * to the left.
     */
    private parse_binary(min_precedence: number): ExpressionNode {
        let left = this.parse_negation();
        for (;;) {
            const token = this.peek();
            if (token === undefined || token.type !== 'OPERATOR') {
                return left;
            }
            const operator = BINARY_OPERATORS.get(token.value);
            if (operator === undefined || operator.precedence < min_precedence) {
                return left;
            }
            this.pos++;
            const right = this.parse_binary(operator.precedence + 1);
            left = this.binary(operator.op, token.value, left, right);
        }
    }

    /**
     * Prefix `-`, `+`, `!`, and `~` bind below `^` and above `*`:
     * `-2^2` is `-(2^2)` and `!x == 1` is `(!x) == 1`.
     */
    private parse_negation(): ExpressionNode {
        const op_text = this.peek_operator();
        if (op_text === '-' || op_text === '+' || op_text === '!' || op_text === '~') {
            const op_token = this.advance();
            const operand = this.parse_negation();
            return {
                kind: 'unary',
                op: op_text === '~' ? '!' : op_text,
                op_text,
                operand,
                range: span(op_token.range, operand.range),
            };
        }
        return this.parse_power();
    }

    private parse_power(): ExpressionNode {
        let left = this.parse_postfix();
        while (this.peek_operator() === '^') {
            const op_text = this.advance().value;
            left = this.binary('^', op_text, left, this.parse_power_operand());
        }
        return left;
    }

    /**
     * An exponent may carry its own sign, which applies to that operand
     * only: `2^-1^2` is `(2^-1)^2`.
     */
    private parse_power_operand(): ExpressionNode {
        const op_text = this.peek_operator();
        if (op_text === '-' || op_text === '+' || op_text === '!' || op_text === '~') {
            const op_token = this.advance();
            const operand = this.parse_power_operand();
            return {
                kind: 'unary',
                op: op_text === '~' ? '!' : op_text,
                op_text,
                operand,
                range: span(op_token.range, operand.range),
            };
        }
        return this.parse_postfix();
    }

    private parse_postfix(): ExpressionNode {
        let node = this.parse_primary();
        while (this.peek()?.type === 'LBRACKET') {
            const open = this.pos;
            const close = close_of(this.matches, open);
            if (close === -1 || close >= this.end) {
                throw new ExpressionParseFailure('unclosed subscript');
            }
            const indices = this.parse_list(open + 1, close);
            this.pos = close + 1;
            node = {
                kind: 'subscript',
                target: node,
                indices,
                range: span(node.range, this.tokens[close].range),
            };
        }
        return node;
    }

    /** Comma-separated expressions in [start, end), each parsed alone. */
    private parse_list(start: number, end: number): ExpressionNode[] {
        const the_items: ExpressionNode[] = [];
        if (start >= end) {
            return the_items;
        }
        let item_start = start;
        let i = start;
        while (i <= end) {
            if (i === end || this.tokens[i].type === 'COMMA') {
                the_items.push(parse_range(this.tokens, this.matches, item_start, i));
                item_start = i + 1;
                i++;
                continue;
            }
            const close = close_of(this.matches, i);
            const type = this.tokens[i].type;
            i = (type === 'LPAREN' || type === 'LBRACKET') && close > i ? close + 1 : i + 1;
        }
        return the_items;
    }

    /**
     * End of the run of tokens touching tokens[start], with paren groups
     * included, and whether it contains a factor-variable or time-series
     * operator (`L.x`, `i.g#c.z`, `L(1/2).x`).
     */
    private scan_operand_run(start: number): { end: number; has_operator: boolean } {
        let i = start + 1;
        let has_operator = false;
        while (i < this.end) {
            const my_token = this.tokens[i];
            if (!is_adjacent(this.tokens[i - 1], my_token)) {
                break;
            }
            const type = my_token.type;
            if (type === 'LPAREN') {
                const close = close_of(this.matches, i);
                if (close === -1 || close >= this.end) {
                    break;
                }
                i = close + 1;
                continue;
            }
            if (type === 'WORD' || type === 'NUMBER' ||
                type === 'MACRO_REF_LOCAL' || type === 'MACRO_REF_GLOBAL') {
                if (my_token.value.startsWith('.') || my_token.value === '#') {
                    has_operator = true;
                }
                i++;
                continue;
            }
            break;
        }
        return { end: i, has_operator };
    }

    private parse_primary(): ExpressionNode {
        const token = this.peek();
        if (!token) {
            throw new ExpressionParseFailure('missing operand');
        }
        const start = this.pos;

        if (token.type === 'STRING') {
            const scan = scan_string(this.tokens, start, this.end);
            if (!scan) {
                throw new ExpressionParseFailure('unterminated string');
            }
            this.pos = scan.end;
            return scan.node;
        }

        if (token.type === 'LPAREN') {
            const close = close_of(this.matches, start);
            if (close === -1 || close >= this.end) {
                throw new ExpressionParseFailure('unclosed parenthesis');
            }
            const inner = parse_range(this.tokens, this.matches, start + 1, close);
            this.pos = close + 1;
            return {
                kind: 'paren',
                expression: inner,
                range: span(token.range, this.tokens[close].range),
            };
        }

        const is_name_token = token.type === 'WORD' || token.type === 'NUMBER' ||
            token.type === 'MACRO_REF_LOCAL' || token.type === 'MACRO_REF_GLOBAL';
        if (!is_name_token) {
            throw new ExpressionParseFailure(`unexpected ${token.type}`);
        }

        // A leading `.x`/`#` or a run like `L.x` is operator syntax the
        // grammar does not model. A lone `.` or `.a` is a missing literal.
        const is_missing = is_missing_literal(token.value);
        const starts_with_operator = !is_missing &&
            (token.value.startsWith('.') && token.type === 'WORD' ||
             token.value === '#');
        const run = this.scan_operand_run(start);
        if (starts_with_operator || run.has_operator) {
            this.pos = run.end;
            return make_unparsed(
                this.tokens, start, run.end, 'factor_or_time_series_operator'
            );
        }

        if (is_missing) {
            this.advance();
            return {
                kind: 'missing',
                text: token.value,
                extended: token.value.length > 1 ? token.value.slice(1) : null,
                range: token.range,
            };
        }

        if (token.type === 'NUMBER') {
            const next = this.tokens[start + 1];
            if (start + 1 < this.end && next && is_adjacent(token, next) &&
                next.type !== 'OPERATOR' && next.type !== 'COMMA' &&
                next.type !== 'RPAREN' && next.type !== 'RBRACKET' &&
                next.type !== 'LBRACKET') {
                // `1e` fused to a name, hex floats, etc.
                this.pos = run.end;
                return make_unparsed(this.tokens, start, run.end, 'syntax_error');
            }
            this.advance();
            const value = Number(token.value);
            if (!Number.isFinite(value)) {
                return make_unparsed(this.tokens, start, start + 1, 'syntax_error');
            }
            return { kind: 'number', text: token.value, value, range: token.range };
        }

        const next = start + 1 < this.end ? this.tokens[start + 1] : undefined;

        if (token.type === 'WORD') {
            if (!is_name(token.value)) {
                this.pos = run.end;
                return make_unparsed(this.tokens, start, run.end, 'syntax_error');
            }
            if (next?.type === 'LBRACKET' && is_coefficient_name(token.value)) {
                return this.parse_coefficient();
            }
            if (next?.type === 'LPAREN') {
                return is_stored_result_class(token.value)
                    ? this.parse_stored_result()
                    : this.parse_call();
            }
        }

        return this.parse_name();
    }

    /**
     * A variable, system variable, macro reference, or a name built from
     * adjacent pieces such as `` `v'_lag `` or `` x`i' ``.
     */
    private parse_name(): ExpressionNode {
        const start = this.pos;
        let i = start + 1;
        while (i < this.end && is_adjacent(this.tokens[i - 1], this.tokens[i])) {
            const type = this.tokens[i].type;
            const is_piece = type === 'MACRO_REF_LOCAL' || type === 'MACRO_REF_GLOBAL' ||
                ((type === 'WORD' || type === 'NUMBER') &&
                 !this.tokens[i].value.startsWith('.'));
            if (!is_piece) {
                break;
            }
            i++;
        }

        const first = this.tokens[start];
        if (i < this.end && this.tokens[i].type === 'LPAREN' &&
            is_adjacent(this.tokens[i - 1], this.tokens[i])) {
            // A macro-built function name such as `` `f'(x) ``.
            const close = close_of(this.matches, i);
            if (close === -1 || close >= this.end) {
                throw new ExpressionParseFailure('unclosed parenthesis');
            }
            this.pos = close + 1;
            return make_unparsed(this.tokens, start, close + 1, 'syntax_error');
        }
        this.pos = i;

        if (i === start + 1) {
            if (first.type === 'MACRO_REF_LOCAL' || first.type === 'MACRO_REF_GLOBAL') {
                return parse_macro_ref_token(first);
            }
            if (SYSTEM_VARIABLES.has(first.value)) {
                return { kind: 'system_variable', name: first.value, range: first.range };
            }
            return { kind: 'variable', name: first.value, range: first.range };
        }

        return {
            kind: 'variable',
            name: this.tokens.slice(start, i).map((t) => t.value).join(''),
            parts: this.name_parts(start, i),
            range: span(first.range, this.tokens[i - 1].range),
        };
    }

    private name_parts(start: number, end: number): TextOrMacroPart[] {
        return name_parts_from_tokens(this.tokens.slice(start, end));
    }

    private parse_call(): CallExpressionNode {
        const name_token = this.advance();
        const open = this.pos;
        const close = close_of(this.matches, open);
        if (close === -1 || close >= this.end) {
            throw new ExpressionParseFailure('unclosed call');
        }
        const args = this.parse_list(open + 1, close);
        this.pos = close + 1;
        return {
            kind: 'call',
            name: name_token.value,
            name_range: name_token.range,
            args,
            range: span(name_token.range, this.tokens[close].range),
        };
    }

    private parse_stored_result(): ExpressionNode {
        const class_token = this.advance();
        const open = this.pos;
        const close = close_of(this.matches, open);
        if (close === -1 || close >= this.end) {
            throw new ExpressionParseFailure('unclosed stored result');
        }
        this.pos = close + 1;
        const result_class = class_token.value;
        if (!is_stored_result_class(result_class)) {
            throw new ExpressionParseFailure('not a stored result');
        }
        const has_macro = this.tokens
            .slice(open + 1, close)
            .some((t) => t.type === 'MACRO_REF_LOCAL' || t.type === 'MACRO_REF_GLOBAL');
        return {
            kind: 'stored_result',
            result_class,
            name: join_tokens(this.tokens, open + 1, close),
            ...(has_macro ? { name_parts: this.name_parts(open + 1, close) } : {}),
            range: span(class_token.range, this.tokens[close].range),
        };
    }

    private parse_coefficient(): ExpressionNode {
        const name_token = this.advance();
        const which = name_token.value;
        if (!is_coefficient_name(which)) {
            throw new ExpressionParseFailure('not a coefficient');
        }
        const open = this.pos;
        const close = close_of(this.matches, open);
        if (close === -1 || close >= this.end) {
            throw new ExpressionParseFailure('unclosed coefficient');
        }
        this.pos = close + 1;
        const spec_range = close > open + 1
            ? span(this.tokens[open + 1].range, this.tokens[close - 1].range)
            : empty_range_at(this.tokens[open].range.end);
        return {
            kind: 'coefficient',
            which,
            spec: join_tokens(this.tokens, open + 1, close),
            spec_range,
            range: span(name_token.range, this.tokens[close].range),
        };
    }
}

/**
 * Parse tokens[start, end) as one expression; on any failure return an
 * `unparsed` node for exactly that span.
 */
function parse_range(
    tokens: readonly Token[],
    matches: BracketMatches,
    start: number,
    end: number
): ExpressionNode {
    if (start >= end) {
        return make_unparsed(tokens, start, end, 'empty');
    }
    try {
        return new ExpressionParser(tokens, matches, start, end).parse_all();
    } catch {
        // ExpressionParseFailure, or a RangeError from absurd nesting.
        return make_unparsed(tokens, start, end, 'syntax_error');
    }
}

// ---------------------------------------------------------------------------
// Varlists

/** `*`, `?`, or `~` in a varlist; the lexer emits `?` as a WORD. */
function is_wildcard_operator(token: Token): boolean {
    return (token.type === 'OPERATOR' || token.type === 'WORD') &&
        (token.value === '*' || token.value === '?' || token.value === '~');
}

/** One varlist item: a name, wildcard, or fv/ts operand run. */
function scan_varlist_item(
    tokens: readonly Token[],
    matches: BracketMatches,
    start: number,
    end: number
): { node: ExpressionNode; end: number } {
    let i = start + 1;
    let has_wildcard = is_wildcard_operator(tokens[start]);
    let has_operator = tokens[start].value.startsWith('.') ||
        tokens[start].value === '#';
    while (i < end && is_adjacent(tokens[i - 1], tokens[i])) {
        const my_token = tokens[i];
        const close = my_token.type === 'LPAREN' ? close_of(matches, i) : -1;
        if (close !== -1 && close < end) {
            has_operator = true;
            i = close + 1;
            continue;
        }
        if (is_wildcard_operator(my_token)) {
            has_wildcard = true;
            i++;
            continue;
        }
        const type = my_token.type;
        if (type === 'WORD' || type === 'NUMBER' ||
            type === 'MACRO_REF_LOCAL' || type === 'MACRO_REF_GLOBAL') {
            if (my_token.value.startsWith('.') || my_token.value === '#') {
                has_operator = true;
            }
            i++;
            continue;
        }
        break;
    }

    if (has_operator) {
        return {
            node: make_unparsed(tokens, start, i, 'factor_or_time_series_operator'),
            end: i,
        };
    }
    if (has_wildcard) {
        return {
            node: {
                kind: 'wildcard',
                pattern: tokens.slice(start, i).map((t) => t.value).join(''),
                range: span(tokens[start].range, tokens[i - 1].range),
            },
            end: i,
        };
    }
    const first = tokens[start];
    const is_name = first.type === 'WORD' || first.type === 'MACRO_REF_LOCAL' ||
        first.type === 'MACRO_REF_GLOBAL';
    if (!is_name) {
        return { node: make_unparsed(tokens, start, i, 'syntax_error'), end: i };
    }
    return {
        node: parse_range(tokens, matches, start, i),
        end: i,
    };
}

/**
 * Parse tokens[start, end) as a varlist: names, wildcards (`x*`, `a?b`,
 * `x~`), ranges (`a-c` or `a - c`), and macro references. Factor-variable
 * and time-series operands become `unparsed` items.
 */
function parse_varlist_range(
    tokens: readonly Token[],
    matches: BracketMatches,
    start: number,
    end: number
): VarlistExpressionNode {
    const the_items: ExpressionNode[] = [];
    let i = start;
    while (i < end) {
        const my_token = tokens[i];
        const can_start_item = my_token.type === 'WORD' || my_token.type === 'NUMBER' ||
            my_token.type === 'MACRO_REF_LOCAL' || my_token.type === 'MACRO_REF_GLOBAL' ||
            is_wildcard_operator(my_token);
        if (!can_start_item) {
            // A stray operator or group: keep it as an unparsed item.
            const close = close_of(matches, i);
            const item_end = (my_token.type === 'LPAREN' || my_token.type === 'LBRACKET') &&
                close > i && close < end ? close + 1 : i + 1;
            the_items.push(make_unparsed(tokens, i, item_end, 'syntax_error'));
            i = item_end;
            continue;
        }
        const item = scan_varlist_item(tokens, matches, i, end);
        i = item.end;
        const dash = tokens[i];
        const after_dash = tokens[i + 1];
        const is_range = i + 1 < end && dash?.type === 'OPERATOR' && dash.value === '-' &&
            after_dash !== undefined &&
            (after_dash.type === 'WORD' || after_dash.type === 'MACRO_REF_LOCAL' ||
             after_dash.type === 'MACRO_REF_GLOBAL');
        if (is_range && item.node.kind !== 'unparsed') {
            const to = scan_varlist_item(tokens, matches, i + 1, end);
            the_items.push({
                kind: 'variable_range',
                from: item.node,
                to: to.node,
                range: span(item.node.range, to.node.range),
            });
            i = to.end;
            continue;
        }
        the_items.push(item.node);
    }
    const range = start < end
        ? span(tokens[start].range, tokens[end - 1].range)
        : empty_range_at(tokens[start]?.range.start ?? { line: 0, character: 0 });
    return { kind: 'varlist', items: the_items, range };
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Parse an expression from lexer tokens. Trivia (comments, `///`
 * continuations) is ignored. Never throws.
 */
export function parse_expression(tokens: readonly Token[]): ExpressionNode {
    const the_tokens = significant_tokens(tokens);
    if (the_tokens.length === 0) {
        return make_unparsed(the_tokens, 0, 0, 'empty', input_start(tokens));
    }
    return parse_range(the_tokens, match_brackets(the_tokens), 0, the_tokens.length);
}

/** Parse a varlist from lexer tokens. Never throws. */
export function parse_varlist(tokens: readonly Token[]): VarlistExpressionNode {
    const the_tokens = significant_tokens(tokens);
    if (the_tokens.length === 0) {
        const range = empty_range_at(input_start(tokens) ?? { line: 0, character: 0 });
        return { kind: 'varlist', items: [], range };
    }
    return parse_varlist_range(
        the_tokens, match_brackets(the_tokens), 0, the_tokens.length
    );
}

/**
 * Parse the `fcn(arguments)` of `egen newvar = fcn(arguments)`. Row and
 * grouping functions (rowtotal, group, tag, ...) take varlists; the rest
 * take expressions. Anything not shaped like a call is parsed as a plain
 * expression. Never throws.
 */
export function parse_egen_function(tokens: readonly Token[]): ExpressionNode {
    const the_tokens = significant_tokens(tokens);
    if (the_tokens.length === 0) {
        return make_unparsed(the_tokens, 0, 0, 'empty', input_start(tokens));
    }
    const matches = match_brackets(the_tokens);
    const name_token = the_tokens[0];
    const is_call_shape = the_tokens.length >= 3 &&
        name_token.type === 'WORD' &&
        the_tokens[1].type === 'LPAREN' &&
        close_of(matches, 1) === the_tokens.length - 1;
    if (!is_call_shape || !EGEN_VARLIST_FUNCTIONS.has(name_token.value)) {
        return parse_range(the_tokens, matches, 0, the_tokens.length);
    }
    const close = the_tokens.length - 1;
    const the_args: ExpressionNode[] = [];
    let item_start = 2;
    for (let i = 2; i <= close; i++) {
        if (i === close || the_tokens[i].type === 'COMMA') {
            if (i > item_start) {
                the_args.push(parse_varlist_range(the_tokens, matches, item_start, i));
            }
            item_start = i + 1;
            continue;
        }
        const type = the_tokens[i].type;
        const group_close = close_of(matches, i);
        if ((type === 'LPAREN' || type === 'LBRACKET') && group_close !== -1) {
            i = group_close;
        }
    }
    return {
        kind: 'call',
        name: name_token.value,
        name_range: name_token.range,
        args: the_args,
        range: span(name_token.range, the_tokens[close].range),
    };
}

const OBSERVATION_KEYWORDS: ReadonlyMap<string, 'first' | 'last'> = new Map([
    // Stata documents both cases for these in-range keywords.
    ['f', 'first'],
    ['F', 'first'],
    ['l', 'last'],
    ['L', 'last'],
]);

/**
 * A bound is one observation number, `f`/`l`, or macro reference,
 * optionally negated. Anything else is unparsed.
 */
function is_in_bound(node: ExpressionNode): boolean {
    switch (node.kind) {
        case 'number':
        case 'observation':
        case 'macro_ref':
            return true;
        case 'variable':
            return node.parts !== undefined;  // e.g. `` `n'0 ``
        case 'unary':
            return node.op === '-' && is_in_bound(node.operand) &&
                node.operand.kind !== 'observation';
        default:
            return false;
    }
}

function parse_in_bound(
    tokens: readonly Token[],
    matches: BracketMatches,
    start: number,
    end: number
): ExpressionNode {
    if (end - start === 1) {
        const which = OBSERVATION_KEYWORDS.get(tokens[start].value);
        if (tokens[start].type === 'WORD' && which) {
            return {
                kind: 'observation',
                which,
                text: tokens[start].value,
                range: tokens[start].range,
            };
        }
    }
    const node = parse_range(tokens, matches, start, end);
    return is_in_bound(node) ? node : make_unparsed(tokens, start, end, 'syntax_error');
}

/**
 * Parse the tokens after `in`: `#`, `#/#`, with `f`/`l` and negative
 * counts. Never throws.
 */
export function parse_in_range(
    tokens: readonly Token[],
    fallback_position?: Position
): InRangeNode {
    const the_tokens = significant_tokens(tokens);
    const matches = match_brackets(the_tokens);
    const count = the_tokens.length;
    if (count === 0) {
        const first = make_unparsed(
            the_tokens, 0, 0, 'empty', input_start(tokens) ?? fallback_position
        );
        return { kind: 'in_range', first, range: first.range };
    }
    const range = span(the_tokens[0].range, the_tokens[count - 1].range);
    let slash = -1;
    for (let i = 0; i < count; i++) {
        const my_token = the_tokens[i];
        if (my_token.type === 'OPERATOR' && my_token.value === '/') {
            slash = i;
            break;
        }
        const close = close_of(matches, i);
        if ((my_token.type === 'LPAREN' || my_token.type === 'LBRACKET') && close !== -1) {
            i = close;
        }
    }
    if (slash === -1) {
        return { kind: 'in_range', first: parse_in_bound(the_tokens, matches, 0, count), range };
    }
    const first = parse_in_bound(the_tokens, matches, 0, slash);
    const last = parse_in_bound(the_tokens, matches, slash + 1, count);
    if (first.kind === 'unparsed' || last.kind === 'unparsed') {
        return {
            kind: 'in_range',
            first: make_unparsed(the_tokens, 0, count, 'syntax_error'),
            range,
        };
    }
    return { kind: 'in_range', first, last, range };
}

/**
 * Parse one file name after `using` from adjacent tokens: a quoted
 * string (macros inside become parts) or an unquoted path whose macro
 * references become parts. Never throws.
 */
export function parse_path(tokens: readonly Token[]): PathNode {
    const the_tokens = significant_tokens(tokens);
    const count = the_tokens.length;
    if (count === 0) {
        return {
            text: '',
            quote: null,
            parts: [],
            range: empty_range_at(input_start(tokens) ?? { line: 0, character: 0 }),
        };
    }
    const range = span(the_tokens[0].range, the_tokens[count - 1].range);
    const text = join_tokens(the_tokens, 0, count);
    if (the_tokens[0].type === 'STRING') {
        const scan = scan_string(the_tokens, 0, count);
        if (scan && scan.end === count) {
            return { text, quote: scan.node.quote, parts: scan.node.parts, range };
        }
    }
    const the_parts: TextOrMacroPart[] = [];
    for (const my_token of the_tokens) {
        if (my_token.type === 'MACRO_REF_LOCAL' || my_token.type === 'MACRO_REF_GLOBAL') {
            the_parts.push(parse_macro_ref_token(my_token));
            continue;
        }
        const previous = the_parts[the_parts.length - 1];
        if (previous && previous.kind === 'text' &&
            previous.range.end.line === my_token.range.start.line &&
            previous.range.end.character === my_token.range.start.character) {
            previous.value += my_token.value;
            previous.range = span(previous.range, my_token.range);
        } else {
            the_parts.push({ kind: 'text', value: my_token.value, range: my_token.range });
        }
    }
    return { text, quote: null, parts: the_parts, range };
}

/**
 * Lex and parse expression text that starts at `start` in the document,
 * such as the inside of `` `=exp' ``. Ranges are document positions. The
 * text must be a single line. Never throws.
 */
export function parse_expression_text(text: string, start: Position): ExpressionNode {
    try {
        const { tokens } = new StataLexer().tokenize(text);
        const shift = (position: Position): Position => ({
            line: position.line + start.line,
            character: position.line === 0
                ? position.character + start.character
                : position.character,
        });
        const the_shifted = tokens.map((my_token) => ({
            ...my_token,
            range: { start: shift(my_token.range.start), end: shift(my_token.range.end) },
        }));
        const node = parse_expression(the_shifted);
        if (node.kind === 'unparsed' && node.reason === 'empty') {
            node.range = empty_range_at(start);
        }
        return node;
    } catch {
        return {
            kind: 'unparsed',
            text,
            reason: 'syntax_error',
            range: empty_range_at(start),
        };
    }
}

/**
 * Build the `sight parse --json` document for one Stata file.
 *
 * The document is a versioned, plain-JSON view of Sight's AST for tools
 * that translate Stata (see docs/cli.md for the schema and its
 * versioning policy). It is built from a structured parse
 * (`new StataParser({ structured: true })`) and never fails on bad
 * Stata: syntax errors are reported in `errors`, and expressions the
 * parser does not model are `unparsed` nodes.
 */

import { Position, Range } from 'vscode-languageserver-textdocument';
import { ContextTracker } from '../context-tracker';
import { CommandDatabase } from '../command-database';
import { parse_expression, parse_varlist } from '../expression-parser';
import { StataLexer } from '../lexer';
import { StataParser } from '../parser';
import { CommentDirectives, comment_key } from './parse-directives';
import {
    CommandNode,
    ControlFlowNode,
    ExpressionNode,
    IdentifierNode,
    MacroDefNode,
    MacroRefExpressionNode,
    OptionNode,
    PrefixNode,
    ProgramNode,
    ProgramSignature,
    StataNode,
    TextOrMacroPart,
    Token,
    TriviaNode,
    VarlistExpressionNode,
} from '../types';

/**
 * Version of the JSON shape. Adding a field or a new `kind` value keeps
 * it; removing or renaming a field, or changing a field's meaning, bumps
 * it. See docs/cli.md.
 */
export const PARSE_SCHEMA_VERSION = 1;

type Json = Record<string, unknown>;

/** `foreach ... of <type>` list types (exact case). */
const FOREACH_LIST_TYPES: ReadonlySet<string> = new Set([
    'varlist', 'newlist', 'numlist', 'local', 'global',
]);

function compare_positions(a: Position, b: Position): number {
    return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

/** Does any node in the expression tree fail to parse? */
function contains_unparsed(node: ExpressionNode | TextOrMacroPart): boolean {
    switch (node.kind) {
        case 'unparsed':
            return true;
        case 'unary':
            return contains_unparsed(node.operand);
        case 'binary':
            return contains_unparsed(node.left) || contains_unparsed(node.right);
        case 'call':
            return node.args.some(contains_unparsed);
        case 'subscript':
            return contains_unparsed(node.target) || node.indices.some(contains_unparsed);
        case 'paren':
            return contains_unparsed(node.expression);
        case 'varlist':
            return node.items.some(contains_unparsed);
        case 'variable_range':
            return contains_unparsed(node.from) || contains_unparsed(node.to);
        case 'macro_ref':
            return (node.expression !== undefined && contains_unparsed(node.expression)) ||
                (node.name_parts ?? []).some(contains_unparsed);
        case 'string':
            return node.parts.some(contains_unparsed);
        case 'variable':
            return (node.parts ?? []).some(contains_unparsed);
        case 'stored_result':
            return (node.name_parts ?? []).some(contains_unparsed);
        default:
            return false;
    }
}

/** True for a varlist whose items are all names, wildcards, ranges, or macros. */
function is_clean_varlist(node: VarlistExpressionNode): boolean {
    return node.items.length > 0 && node.items.every((item) =>
        item.kind !== 'unparsed' || item.reason === 'factor_or_time_series_operator'
    );
}

function serialize_signature(signature: ProgramSignature): Json {
    return {
        arguments: signature.arguments.map((my_argument) => ({
            type: my_argument.type,
            name: my_argument.name ?? null,
            optional: my_argument.isOptional,
            range: my_argument.range,
        })),
        options: signature.options.map((my_option) => ({
            name: my_option.name,
            min_abbreviation: my_option.minAbbreviation,
            required: my_option.isRequired,
            optional: my_option.isOptional,
            argument_type: my_option.argumentType ?? null,
            default: my_option.defaultValue ?? null,
            range: my_option.range,
        })),
        allows_arbitrary_options: signature.allowsArbitraryOptions,
    };
}

/**
 * Exact-case canonical command name from the command database: Stata's
 * built-in names are lowercase, so a name with any other case is not a
 * built-in. The database itself lowercases lookups for completion.
 */
function canonical_command_name(
    database: CommandDatabase | undefined,
    name: string
): string | null {
    if (database === undefined || name === '' || name !== name.toLowerCase()) {
        return null;
    }
    return database.lookup_command(name)?.name ?? null;
}

/**
 * Exact-case canonical option name for `command`: the database option
 * that `name` abbreviates (at least its minimum abbreviation). Null when
 * unknown or ambiguous.
 */
function canonical_option_name(
    database: CommandDatabase | undefined,
    command: string,
    name: string
): string | null {
    if (database === undefined || command === '' || command !== command.toLowerCase()) {
        return null;
    }
    const info = database.lookup_command(command);
    if (!info) {
        return null;
    }
    let match: string | null = null;
    for (const my_option of info.options) {
        if (my_option.name === name) {
            return my_option.name;
        }
        const is_abbreviation = my_option.name.startsWith(name) &&
            name.length >= Math.max(1, my_option.min_abbreviation);
        if (is_abbreviation) {
            if (match !== null && match !== my_option.name) {
                return null;
            }
            match = my_option.name;
        }
    }
    return match;
}

export interface ParseDocumentInput {
    /** Absolute path, reported as `path`. */
    path: string;
    content: string;
    sight_version: string;
    command_database?: CommandDatabase;
}

/** Build the JSON document for one file. Never throws on bad Stata. */
export function build_parse_document(input: ParseDocumentInput): Json {
    return new ParseDocumentBuilder(input).build();
}

class ParseDocumentBuilder {
    private readonly content: string;
    private readonly database: CommandDatabase | undefined;
    private tokens: Token[] = [];
    private line_offsets: number[] = [0];
    private delimit: 'cr' | 'semicolon' = 'cr';
    private directives: CommentDirectives | undefined;
    /** Keys of the comments some statement reports. */
    private readonly reported_comments = new Set<string>();
    /** The trivia each statement reports, from `place_comments`. */
    private readonly statement_trivia = new Map<StataNode, StatementTrivia>();

    constructor(private readonly input: ParseDocumentInput) {
        this.content = input.content;
        this.database = input.command_database;
    }

    build(): Json {
        const lex_result = new StataLexer().tokenize(this.content);
        this.tokens = lex_result.tokens;
        this.line_offsets = lex_result.line_offsets;
        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(lex_result.tokens, this.content);
        const parse_result = new StataParser({ structured: true })
            .parse(lex_result.tokens, context_tracker);

        this.directives = new CommentDirectives(
            this.input.path, this.content, this.tokens, parse_result.ast.nodes);
        // Comments left over after the last statement, and the AST's own
        // trailingTrivia, are no statement's: unreported_comments() finds
        // them among the tokens.
        this.place_comments(parse_result.ast.nodes);
        const statements = this.serialize_nodes(parse_result.ast.nodes);
        const comments = this.unreported_comments();
        const errors = [
            ...lex_result.errors.map((my_error) => ({
                source: 'lexer',
                code: my_error.code,
                message: my_error.message,
                range: my_error.range,
            })),
            ...parse_result.errors.map((my_error) => ({
                source: 'parser',
                code: my_error.code,
                message: my_error.message,
                range: my_error.range,
            })),
        ].sort((a, b) => compare_positions(a.range.start, b.range.start));

        return {
            schema_version: PARSE_SCHEMA_VERSION,
            sight_version: this.input.sight_version,
            path: this.input.path,
            line_count: this.line_offsets.length,
            statements,
            comments,
            errors,
        };
    }

    /**
     * Decide which statement reports each comment the parser attached
     * to `nodes`. Only comments on a statement's last line are its
     * `trailing`. The parser's other trailing comments are on lines of
     * their own, so they lead the next statement; after the last
     * statement of a body they precede the closing `}` or `end`
     * (`block_end`). Returns those after the last of `nodes`.
     */
    private place_comments(nodes: StataNode[]): TriviaNode[] {
        let the_carried: TriviaNode[] = [];
        for (const my_node of nodes) {
            const trailing = split_trailing_trivia(my_node);
            const the_body_leftover = this.place_comments(body_of(my_node));
            this.statement_trivia.set(my_node, {
                leading: [...the_carried, ...trivia_of(my_node, 'leadingTrivia')],
                trailing: trailing.same_line,
                block_end: [
                    ...the_body_leftover,
                    ...trivia_of(my_node, 'blockEndingTrivia'),
                ],
            });
            the_carried = trailing.own_line;
        }
        return the_carried;
    }

    /** The trivia `place_comments` gave `node` to report. */
    private trivia_reported_by(node: StataNode): StatementTrivia {
        return this.statement_trivia.get(node) ??
            { leading: [], trailing: [], block_end: [] };
    }

    /**
     * Comments no statement reports, in source order: all of them in a
     * file with no statements, and the comment-only lines after the
     * last statement.
     */
    private unreported_comments(): Json[] {
        const the_comments: Json[] = [];
        for (const my_token of this.tokens) {
            const style = comment_style(my_token);
            if (style !== null && !this.reported_comments.has(comment_key(my_token.range))) {
                the_comments.push(this.serialize_comment(style, my_token.value, my_token.range));
            }
        }
        return the_comments;
    }

    /** A comment object, with the directive Sight honors in it. */
    private serialize_comment(style: string, text: string, range: Range): Json {
        this.reported_comments.add(comment_key(range));
        return {
            style,
            text,
            range,
            directive: this.directives?.directive_at(range) ?? null,
        };
    }

    private serialize_trivia(trivia: TriviaNode): Json {
        return this.serialize_comment(trivia.style, trivia.content, trivia.range);
    }

    // -----------------------------------------------------------------
    // Source helpers

    private offset_of(position: Position): number {
        const line_start = this.line_offsets[position.line] ?? this.content.length;
        return Math.min(line_start + position.character, this.content.length);
    }

    private text_of(range: Range): string {
        return this.content.slice(this.offset_of(range.start), this.offset_of(range.end));
    }

    /** Index of the first token starting at or after `position`. */
    private first_token_at(position: Position): number {
        let low = 0;
        let high = this.tokens.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (compare_positions(this.tokens[middle].range.start, position) < 0) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low;
    }

    /** The lexer tokens inside `range`, comments and EOF included. */
    private tokens_in(range: Range): Token[] {
        const the_tokens: Token[] = [];
        for (let i = this.first_token_at(range.start); i < this.tokens.length; i++) {
            const my_token = this.tokens[i];
            if (my_token.type === 'EOF' ||
                compare_positions(my_token.range.end, range.end) > 0) {
                break;
            }
            the_tokens.push(my_token);
        }
        return the_tokens;
    }

    // -----------------------------------------------------------------
    // Statements

    private serialize_nodes(nodes: StataNode[]): Json[] {
        const the_statements: Json[] = [];
        for (const my_node of nodes) {
            const statement = this.serialize_node(my_node);
            if (statement !== null) {
                the_statements.push(statement);
            }
        }
        return the_statements;
    }

    /** Fields every statement has, in a fixed order. */
    private common(kind: string, node: StataNode): Json {
        return {
            kind,
            range: node.range,
            text: this.text_of(node.range),
            delimit: this.delimit,
            comments: this.comments_of(node),
        };
    }

    /**
     * Comments before and after the statement, inside it (a `///` note or
     * a block comment between tokens), and, for statements with a body,
     * before the closing `}` or `end`. Comments of body statements belong
     * to those statements.
     */
    private comments_of(node: StataNode): Json {
        const { leading, trailing, block_end } = this.trivia_reported_by(node);
        const body = body_of(node);

        const known = new Set<string>();
        for (const my_trivia of [...leading, ...trailing, ...block_end]) {
            known.add(comment_key(my_trivia.range));
        }
        for (const my_child of body) {
            const child_trivia = this.trivia_reported_by(my_child);
            for (const my_trivia of [...child_trivia.leading, ...child_trivia.trailing]) {
                known.add(comment_key(my_trivia.range));
            }
        }

        // Tokens and body statements are both in source order, so one
        // sweep skips the comments inside body statements.
        const the_interior: Json[] = [];
        let child_index = 0;
        for (const my_token of this.tokens_in(node.range)) {
            while (child_index < body.length &&
                compare_positions(body[child_index].range.end, my_token.range.start) <= 0) {
                child_index++;
            }
            const child = body[child_index];
            const inside_child = child !== undefined &&
                compare_positions(child.range.start, my_token.range.start) <= 0;
            const style = comment_style(my_token);
            if (style === null || inside_child || known.has(comment_key(my_token.range))) {
                continue;
            }
            the_interior.push(this.serialize_comment(style, my_token.value, my_token.range));
        }

        return {
            leading: leading.map((trivia) => this.serialize_trivia(trivia)),
            trailing: trailing.map((trivia) => this.serialize_trivia(trivia)),
            interior: the_interior,
            block_end: block_end.map((trivia) => this.serialize_trivia(trivia)),
        };
    }

    /** Tokens of `range` after the statement's prefixes, if any. */
    private tokens_after_prefixes(range: Range, prefixes: PrefixNode[] | undefined): Token[] {
        const last_prefix = prefixes?.[prefixes.length - 1];
        const start = last_prefix !== undefined ? last_prefix.range.end : range.start;
        return this.tokens_in({ start, end: range.end });
    }

    private serialize_node(node: StataNode): Json | null {
        switch (node.type) {
            case 'directive': {
                // The mode applies to the statements after the directive.
                const statement = { ...this.common('delimit', node), mode: node.mode };
                this.delimit = node.mode;
                return statement;
            }
            case 'command':
                return this.serialize_command(node);
            case 'program':
                return this.serialize_program(node);
            case 'macro_def':
                return this.serialize_macro(node);
            case 'syntax':
                return {
                    ...this.common('syntax', node),
                    prefixes: (node.prefix ?? []).map((p) => this.serialize_prefix(p)),
                    signature: serialize_signature(node.signature),
                };
            case 'embedded_block':
                return {
                    ...this.common('embedded', node),
                    language: node.language,
                    inline: node.is_single_line,
                    prefixes: (node.prefix ?? []).map((p) => this.serialize_prefix(p)),
                    content: { text: node.content, range: node.content_range },
                };
            case 'if':
            case 'else':
            case 'foreach':
            case 'forvalues':
            case 'while':
            case 'frame':
                return this.serialize_control_flow(node);
            case 'macro_ref':
            case 'string':
                // Not produced at statement level by the parser.
                return null;
        }
    }

    private serialize_command(node: CommandNode): Json {
        const prefixes = (node.prefix ?? []).map((p) => this.serialize_prefix(p));
        if (node.name === '{' && node.body) {
            const common = this.common('block', node);
            return {
                ...common,
                prefixes,
                body: this.serialize_nodes(node.body),
            };
        }
        const common = this.common('command', node);

        // Arguments in source order, without the `using` clause.
        const using_range = node.using?.range;
        const in_using = (item: IdentifierNode): boolean =>
            using_range !== undefined &&
            compare_positions(item.range.start, using_range.start) >= 0 &&
            compare_positions(item.range.end, using_range.end) <= 0;
        const the_args = [...(node.varlist ?? []), ...(node.extra_args ?? [])]
            .filter((item) => !in_using(item))
            .sort((a, b) => compare_positions(a.range.start, b.range.start));

        let varlist: VarlistExpressionNode | null = null;
        if (the_args.length > 0) {
            const the_tokens = the_args.flatMap((item) => this.tokens_in(item.range));
            const parsed = parse_varlist(the_tokens);
            varlist = is_clean_varlist(parsed) ? parsed : null;
        }

        return {
            ...common,
            name: node.name,
            canonical_name: canonical_command_name(this.database, node.name),
            prefixes,
            args: group_adjacent_items(the_args),
            varlist,
            assignment: node.expression !== undefined
                ? { text: node.expression, expression: node.expression_ast ?? null }
                : null,
            if: node.ifExpression !== undefined
                ? { text: node.ifExpression, expression: node.if_ast ?? null }
                : null,
            in: node.inExpression !== undefined
                ? {
                    text: node.inExpression,
                    first: node.in_range?.first ?? null,
                    last: node.in_range?.last ?? null,
                    range: node.in_range?.range ?? null,
                }
                : null,
            weight: node.weight
                ? {
                    keyword: node.weight.keyword,
                    kind: node.weight.kind,
                    text: node.weight.expression,
                    expression: node.weight.expression_ast ?? null,
                    range: node.weight.range,
                }
                : null,
            using: node.using
                ? {
                    range: node.using.range,
                    paths: node.using.paths.map((my_path) => ({
                        text: my_path.text,
                        quote: my_path.quote,
                        parts: my_path.parts,
                        range: my_path.range,
                    })),
                }
                : null,
            options: (node.options ?? []).map((o) => this.serialize_option(node.name, o)),
        };
    }

    private serialize_option(command: string, option: OptionNode): Json {
        let expression: ExpressionNode | null = null;
        if (option.argument_range !== undefined && !option.argument_unclosed) {
            const parsed = parse_expression(this.tokens_in(option.argument_range));
            expression = contains_unparsed(parsed) ? null : parsed;
        }
        return {
            name: option.name,
            canonical_name: canonical_option_name(this.database, command, option.name),
            // Raw source text; option.argument is normalized for printing.
            argument: option.argument_range !== undefined
                ? this.text_of(option.argument_range)
                : option.argument ?? null,
            argument_range: option.argument_range ?? null,
            expression,
            range: option.range,
        };
    }

    private serialize_prefix(prefix: PrefixNode): Json {
        return {
            name: prefix.name,
            canonical_name: prefix.fullName,
            range: prefix.range,
            by_varlist: prefix.by_varlist ?? null,
            sort_varlist: prefix.sort_varlist ?? null,
            arguments: prefix.arguments ?? null,
            options: (prefix.options ?? []).map((o) => this.serialize_option(prefix.fullName, o)),
            frame: prefix.frameName ?? null,
        };
    }

    private serialize_program(node: ProgramNode): Json {
        const the_args: Json[] = [];
        for (const my_child of node.body) {
            if (my_child.type === 'command' && my_child.name === 'args') {
                for (const my_item of my_child.varlist ?? []) {
                    the_args.push({ name: my_item.name, range: my_item.range });
                }
            }
        }
        const common = this.common('program', node);
        return {
            ...common,
            name: node.name,
            define_options: node.define_options ?? null,
            args: the_args,
            syntax: node.signature ? serialize_signature(node.signature) : null,
            body: this.serialize_nodes(node.body),
        };
    }

    private serialize_macro(node: MacroDefNode): Json {
        const the_tokens = this.tokens_after_prefixes(node.range, node.prefix).filter((t) =>
            t.type !== 'COMMENT_LINE' && t.type !== 'COMMENT_BLOCK' &&
            t.type !== 'CONTINUATION' && t.type !== 'STATEMENT_TERMINATOR'
        );
        // [local|global] [++|--]? name [=]? value...
        let index = 1;
        let increment: string | null = null;
        const maybe_increment = the_tokens[index];
        if (maybe_increment?.type === 'OPERATOR' &&
            (maybe_increment.value === '++' || maybe_increment.value === '--')) {
            increment = maybe_increment.value;
            index++;
        }
        index++; // the name
        if (node.hasEquals && the_tokens[index]?.value === '=') {
            index++;
        }
        const value_tokens = the_tokens.slice(index);

        let form: string;
        if (node.extendedFunction) {
            form = 'extended';
        } else if (increment !== null) {
            form = 'increment';
        } else if (node.hasEquals) {
            form = 'expression';
        } else {
            form = 'value';
        }

        return {
            ...this.common('macro', node),
            prefixes: (node.prefix ?? []).map((p) => this.serialize_prefix(p)),
            scope: node.scope,
            name: node.name,
            form,
            value: node.value,
            value_parts: form === 'value' ? this.value_parts(value_tokens) : [],
            expression: node.expression_ast ?? null,
            extended: node.extendedFunction
                ? { function: node.extendedFunction.name, args: node.extendedFunction.args }
                : null,
            increment,
        };
    }

    /**
     * The separator the parser uses between two value tokens: none when
     * they touch or when `///` directly after `previous` joins `next` at
     * the start of the following line, otherwise one space.
     */
    private gap_between(previous: Token, next: Token): string {
        if (is_adjacent(previous, next)) {
            return '';
        }
        // A clean chain: `///` touching `previous`, then any number of
        // lines that hold only `///` at column 0, then `next` at column 0
        // of the line after the last one (the parser's ContinuationTracker
        // rule).
        let i = this.first_token_at(previous.range.end);
        let continuation = this.tokens[i];
        if (continuation?.type !== 'CONTINUATION' || !is_adjacent(previous, continuation)) {
            return ' ';
        }
        for (;;) {
            i++;
            if (this.tokens[i]?.type === 'STATEMENT_TERMINATOR') {
                i++; // the newline the `///` swallows
            }
            const following = this.tokens[i];
            const expected_line = continuation.range.start.line + 1;
            if (following === undefined || following.range.start.line !== expected_line ||
                following.range.start.character !== 0) {
                return ' ';
            }
            if (following === next) {
                return '';
            }
            if (following.type !== 'CONTINUATION') {
                return ' ';
            }
            continuation = following;
        }
    }

    /** Text and macro parts of a plain macro value, spaced like `value`. */
    private value_parts(tokens: Token[]): TextOrMacroPart[] {
        const the_parts: TextOrMacroPart[] = [];
        tokens.forEach((my_token, i) => {
            const previous = tokens[i - 1];
            const gap = previous !== undefined ? this.gap_between(previous, my_token) : '';
            const last = the_parts[the_parts.length - 1];
            const is_macro = my_token.type === 'MACRO_REF_LOCAL' || my_token.type === 'MACRO_REF_GLOBAL';
            if (is_macro) {
                if (gap !== '' && last?.kind === 'text') {
                    last.value += gap;
                } else if (gap !== '' && previous !== undefined) {
                    the_parts.push({
                        kind: 'text',
                        value: gap,
                        range: { start: previous.range.end, end: my_token.range.start },
                    });
                }
                the_parts.push(parse_macro_ref(my_token));
            } else if (last?.kind === 'text') {
                last.value += gap + my_token.value;
                last.range = { start: last.range.start, end: my_token.range.end };
            } else {
                const start = gap !== '' && previous !== undefined
                    ? previous.range.end
                    : my_token.range.start;
                the_parts.push({
                    kind: 'text',
                    value: gap + my_token.value,
                    range: { start, end: my_token.range.end },
                });
            }
        });
        return the_parts;
    }

    private serialize_control_flow(node: ControlFlowNode): Json {
        const common = {
            ...this.common(node.type, node),
            prefixes: (node.prefix ?? []).map((p) => this.serialize_prefix(p)),
        };
        const body = (): Json[] => this.serialize_nodes(node.body);
        switch (node.type) {
            case 'if':
                return {
                    ...common,
                    condition: {
                        text: node.condition ?? '',
                        expression: node.condition_ast ?? null,
                    },
                    single_statement: node.is_single_statement === true,
                    body: body(),
                };
            case 'else': {
                const the_tokens = this.tokens_in(node.range);
                const is_else_if = the_tokens[1]?.type === 'WORD' && the_tokens[1].value === 'if';
                return { ...common, else_if: is_else_if, body: body() };
            }
            case 'while':
                return {
                    ...common,
                    condition: {
                        text: node.condition ?? '',
                        expression: node.condition_ast ?? null,
                    },
                    body: body(),
                };
            case 'foreach':
                return { ...common, variable: node.loopVar ?? '', spec: this.foreach_spec(node), body: body() };
            case 'forvalues':
                return { ...common, variable: node.loopVar ?? '', spec: this.forvalues_range(node), body: body() };
            case 'frame':
                return { ...common, frame: node.frameName ?? null, body: body() };
        }
    }

    /** Significant tokens of a loop header, from the keyword to before `{`. */
    private header_tokens(node: ControlFlowNode): Token[] {
        const the_tokens: Token[] = [];
        for (const my_token of this.tokens_after_prefixes(node.range, node.prefix)) {
            if (my_token.type === 'LBRACE') {
                break;
            }
            if (my_token.type === 'COMMENT_LINE' || my_token.type === 'COMMENT_BLOCK' ||
                my_token.type === 'CONTINUATION' || my_token.type === 'STATEMENT_TERMINATOR') {
                continue;
            }
            the_tokens.push(my_token);
        }
        return the_tokens;
    }

    private foreach_spec(node: ControlFlowNode): Json {
        // foreach name (in|of) [list_type] items...
        const the_tokens = this.header_tokens(node);
        const keyword = the_tokens[2]?.value ?? null;
        let items_start = 3;
        let list_type: string | null = null;
        if (keyword === 'of' && the_tokens[3] && FOREACH_LIST_TYPES.has(the_tokens[3].value)) {
            list_type = the_tokens[3].value;
            items_start = 4;
        }
        return {
            keyword,
            list_type,
            text: node.loopSpec ?? '',
            items: group_adjacent(the_tokens.slice(items_start)).map((my_group) => ({
                text: my_group.map((t) => t.value).join(''),
                range: { start: my_group[0].range.start, end: my_group[my_group.length - 1].range.end },
            })),
        };
    }

    private forvalues_range(node: ControlFlowNode): Json {
        // forvalues name = range
        const the_tokens = this.header_tokens(node).slice(3);
        const text = (node.loopSpec ?? '').replace(/^=\s*/, '');
        const unparsed = (): Json => ({
            text,
            form: null,
            first: parse_expression(the_tokens),
            second: null,
            step: null,
            last: null,
        });

        const slash = the_tokens.findIndex((t) => t.type === 'OPERATOR' && t.value === '/');
        if (slash > 0) {
            return {
                text,
                form: 'slash',
                first: parse_expression(the_tokens.slice(0, slash)),
                second: null,
                step: null,
                last: parse_expression(the_tokens.slice(slash + 1)),
            };
        }
        const open = the_tokens.findIndex((t) => t.type === 'LPAREN');
        const close = the_tokens.findIndex((t) => t.type === 'RPAREN');
        if (open > 0 && close > open) {
            return {
                text,
                form: 'paren',
                first: parse_expression(the_tokens.slice(0, open)),
                second: null,
                step: parse_expression(the_tokens.slice(open + 1, close)),
                last: parse_expression(the_tokens.slice(close + 1)),
            };
        }
        // `#1 #t to #2` or `#1 #t : #2`: #t is the second value.
        const to = the_tokens.findIndex((t) =>
            (t.type === 'WORD' && t.value === 'to') || t.type === 'COLON');
        if (to > 0) {
            const the_groups = group_adjacent(the_tokens.slice(0, to));
            if (the_groups.length === 2) {
                return {
                    text,
                    form: 'to',
                    first: parse_expression(the_groups[0]),
                    second: parse_expression(the_groups[1]),
                    step: null,
                    last: parse_expression(the_tokens.slice(to + 1)),
                };
            }
        }
        return unparsed();
    }
}

/**
 * Join argument items that touch in the source into one arg, so a quoted
 * path with a macro inside (`"$root/x.dta"`) or `i.region` stays whole.
 */
function group_adjacent_items(items: IdentifierNode[]): Json[] {
    const the_groups: Array<{ text: string; range: Range }> = [];
    for (const my_item of items) {
        const last = the_groups[the_groups.length - 1];
        if (last !== undefined &&
            last.range.end.line === my_item.range.start.line &&
            last.range.end.character === my_item.range.start.character) {
            last.text += my_item.name;
            last.range = { start: last.range.start, end: my_item.range.end };
        } else {
            the_groups.push({ text: my_item.name, range: my_item.range });
        }
    }
    return the_groups;
}

type TriviaField = 'leadingTrivia' | 'trailingTrivia' | 'blockEndingTrivia';

/** The comments one statement reports, before serialization. */
interface StatementTrivia {
    leading: TriviaNode[];
    trailing: TriviaNode[];
    block_end: TriviaNode[];
}

function trivia_of(node: StataNode, field: TriviaField): TriviaNode[] {
    switch (field) {
        case 'leadingTrivia':
            return 'leadingTrivia' in node ? node.leadingTrivia ?? [] : [];
        case 'trailingTrivia':
            return 'trailingTrivia' in node ? node.trailingTrivia ?? [] : [];
        case 'blockEndingTrivia':
            return 'blockEndingTrivia' in node ? node.blockEndingTrivia ?? [] : [];
    }
}

/** The statements in a node's body, or none. */
function body_of(node: StataNode): StataNode[] {
    return 'body' in node && Array.isArray(node.body) ? node.body : [];
}

/**
 * Split a node's trailing trivia where the comments leave its last
 * line, as the AST printer does. The parser also attaches comments
 * from later lines: a comment-only tail at end of file, and comments
 * after `#delimit ;`, which has no terminator token.
 */
function split_trailing_trivia(
    node: StataNode
): { same_line: TriviaNode[]; own_line: TriviaNode[] } {
    const the_trivia = trivia_of(node, 'trailingTrivia');
    let previous_end_line = node.range.end.line;
    let same_line_count = 0;
    for (const my_trivia of the_trivia) {
        if (my_trivia.range.start.line > previous_end_line) {
            break;
        }
        previous_end_line = my_trivia.range.end.line;
        same_line_count++;
    }
    return {
        same_line: the_trivia.slice(0, same_line_count),
        own_line: the_trivia.slice(same_line_count),
    };
}

function comment_style(token: Token): string | null {
    switch (token.type) {
        case 'COMMENT_LINE':
            return token.value.startsWith('*') ? 'star' : 'slash';
        case 'COMMENT_BLOCK':
            return 'block';
        case 'CONTINUATION':
            return 'continuation';
        default:
            return null;
    }
}

function is_adjacent(previous: Token, next: Token): boolean {
    return previous.range.end.line === next.range.start.line &&
        previous.range.end.character === next.range.start.character;
}

/** Split tokens into runs with no source gap between them. */
function group_adjacent(tokens: Token[]): Token[][] {
    const the_groups: Token[][] = [];
    for (const my_token of tokens) {
        const last_group = the_groups[the_groups.length - 1];
        const last_token = last_group?.[last_group.length - 1];
        if (last_group && last_token && is_adjacent(last_token, my_token)) {
            last_group.push(my_token);
        } else {
            the_groups.push([my_token]);
        }
    }
    return the_groups;
}

function parse_macro_ref(token: Token): MacroRefExpressionNode {
    const node = parse_expression([token]);
    if (node.kind === 'macro_ref') {
        return node;
    }
    return {
        kind: 'macro_ref',
        scope: token.type === 'MACRO_REF_GLOBAL' ? 'global' : 'local',
        form: 'name',
        text: token.value,
        range: token.range,
    };
}

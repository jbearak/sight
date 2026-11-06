/**
 * `assert exp` and `display`'s arguments as structured expressions, for
 * consumers that analyze `assert` conditions or `display` output.
 *
 * The item boundaries in `display` were checked on StataMP 18:
 *
 *     di 1 2              12          di 1 -2          -1
 *     di "a" + "b"        error       di ("a" + "b")   ab
 *     di _n+1             newline, 1  di 1+_n          2
 *     di abs (-1)         abs not found (a call must touch its name)
 *     di %5.2f _n 2       newline, 2.00 (a format skips directives)
 *     di %5.2f "a" 2      a2 (a string takes the format)
 *     di "a",,,"b"        a b         di "a", ,"b"     ab
 *     di _n (2) "x"       two newlines, x
 *     as r / as er / as inp work; as e / as te / as in do not
 *     assert (1 > 0       too few ')' or ']'
 *     assert 1 > 0)       too many ')' or ']'
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { build_parse_document } from '../../src/cli/parse-json';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';
import {
    CommandNode,
    DisplayItem,
    ExpressionNode,
    ParseErrorCode,
} from '../../src/types';

function parse(my_source: string, structured = true) {
    return new StataParser({ structured })
        .parse(new StataLexer().tokenize(my_source).tokens);
}

function first_command(my_source: string, structured = true): CommandNode {
    const my_node = parse(my_source, structured).ast.nodes[0];
    if (my_node?.type !== 'command') {
        throw new Error(`not a command: ${my_node?.type}`);
    }
    return my_node;
}

/** A compact, range-free rendering of an expression tree. */
function show(node: ExpressionNode | null | undefined): string {
    if (!node) {
        return '<none>';
    }
    switch (node.kind) {
        case 'binary':
            return `(${show(node.left)} ${node.op} ${show(node.right)})`;
        case 'unary':
            return `${node.op}${show(node.operand)}`;
        case 'call':
            return `${node.name}(${node.args.map(show).join(', ')})`;
        case 'paren':
            return `[${show(node.expression)}]`;
        case 'subscript':
            return `${show(node.target)}[${node.indices.map(show).join(', ')}]`;
        case 'number':
        case 'string':
        case 'missing':
            return node.text;
        case 'variable':
        case 'system_variable':
            return node.name;
        case 'macro_ref':
            return node.text;
        case 'stored_result':
            return `${node.result_class}(${node.name})`;
        case 'unparsed':
            return `?${node.reason}<${node.text}>`;
        default:
            return node.kind;
    }
}

/** Each display item as one short string. */
function items(my_source: string): string[] {
    const the_items = first_command(my_source).display_items;
    if (the_items === undefined) {
        throw new Error('no display items');
    }
    return the_items.map(describe_item);
}

function describe_item(item: DisplayItem): string {
    switch (item.kind) {
        case 'string':
            return `string ${item.text}${item.format ? ` @${item.format}` : ''}`;
        case 'format':
            return `format ${item.text}`;
        case 'expression':
            return `exp ${show(item.expression)}${item.format ? ` @${item.format}` : ''}`;
        case 'directive': {
            const argument = item.argument
                ? `(${item.argument.expression ? show(item.argument.expression) : item.argument.text})`
                : '';
            const style = item.style !== null ? ` ${item.style}` : '';
            return `${item.name}${argument}${style}`;
        }
    }
}

describe('assert: the asserted expression', () => {
    it('parses a compound condition with missing()', () => {
        const my_node = first_command('assert x > 5 & !missing(x)\n');
        expect(show(my_node.assertion_ast)).toBe('((x > 5) & !missing(x))');
    });

    it('parses a macro, and stops at if and the options', () => {
        const my_node = first_command(
            'capture assert `cond\' | (y == 1 & z < .) if year >= 2000, rc0\n');
        expect(show(my_node.assertion_ast)).toBe('(`cond\' | [((y == 1) & (z < .))])');
        expect(show(my_node.if_ast)).toBe('(year >= 2000)');
        expect(my_node.options?.map((o) => o.name)).toEqual(['rc0']);
    });

    it('reads a comma inside a call as the call\'s', () => {
        const my_node = first_command('assert inlist(region, 1, 2), fast\n');
        expect(show(my_node.assertion_ast)).toBe('inlist(region, 1, 2)');
        expect(my_node.options?.map((o) => o.name)).toEqual(['fast']);
    });

    it('reads the condition across a /// continuation', () => {
        const my_node = first_command('assert x > 5 & ///\n    y < 2\n');
        expect(show(my_node.assertion_ast)).toBe('((x > 5) & (y < 2))');
    });

    it('is an empty unparsed node when there is no expression', () => {
        const my_node = first_command('assert if x\n');
        expect(my_node.assertion_ast).toEqual({
            kind: 'unparsed',
            text: '',
            reason: 'empty',
            range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 6 },
            },
        });
    });

    it('is only built by a structured parse, and only for assert', () => {
        expect(first_command('assert x > 1\n', false).assertion_ast).toBeUndefined();
        expect(first_command('count x > 1\n').assertion_ast).toBeUndefined();
        // Exact case: Stata has no `Assert` command.
        expect(first_command('Assert x > 1\n').assertion_ast).toBeUndefined();
    });
});

describe('display: arguments as items', () => {
    it('splits strings, expressions and a format', () => {
        expect(items('display "n = " _N " mean " %5.2f r(mean)\n')).toEqual([
            'string "n = "',
            'exp _N',
            'string " mean "',
            'format %5.2f',
            'exp r(mean) @%5.2f',
        ]);
    });

    it('continues an expression only through a binary operator', () => {
        expect(items('di 1 2 1 -2 3 * 2 1 == 1 2\n')).toEqual([
            'exp 1',
            'exp 2',
            'exp (1 - 2)',
            'exp (3 * 2)',
            'exp (1 == 1)',
            'exp 2',
        ]);
        expect(items('di -1 -1 1 - - 1 !0 1\n')).toEqual([
            'exp (-1 - 1)',
            'exp (1 - -1)',
            'exp !0',
            'exp 1',
        ]);
    });

    it('ends a string item at the string', () => {
        expect(items('di "a" + "b" ("a" + "b") "a"+1 `"q"\' 1\n')).toEqual([
            'string "a"',
            'exp +"b"',
            'exp [("a" + "b")]',
            'string "a"',
            'exp +1',
            'string `"q"\'',
            'exp 1',
        ]);
    });

    it('reads a string with macros in it as one item', () => {
        // The lexer splits these strings at their macros.
        expect(items('di "n = `n\' done" 1 "$root/x" `"a `b\' "c""\' 1 + "`s\'" 2\n')).toEqual([
            'string "n = `n\' done"',
            'exp 1',
            'string "$root/x"',
            'string `"a `b\' "c""\'',
            'exp (1 + "`s\'")',
            'exp 2',
        ]);
        const [my_item] = first_command('di "a `b\' c"\n').display_items ?? [];
        expect(my_item?.kind === 'string' && my_item.parts.map((p) => p.kind))
            .toEqual(['text', 'macro_ref', 'text']);
    });

        it('joins a call or subscript only when it touches its name', () => {
        expect(items('di abs(-1) abs (-1) x[1] x [1] 1 (2)\n')).toEqual([
            'exp abs(-1)',
            'exp abs',
            'exp [-1]',
            'exp x[1]',
            'exp x',
            'exp ?syntax_error<[1]>',
            'exp 1',
            'exp [2]',
        ]);
    });

    it('reads _n as a directive only at the start of an item', () => {
        expect(items('di _n+1 1+_n 1 _n 2 _N\n')).toEqual([
            '_newline',
            'exp +1',
            'exp (1 + _n)',
            'exp 1',
            '_newline',
            'exp 2',
            'exp _N',
        ]);
        expect(items('di -_n _N -_n\n')).toEqual(['exp -_n', 'exp (_N - _n)']);
    });

    it('reads every directive and the abbreviations Stata 18 accepts', () => {
        expect(items(
            'di _n _ne _newline(2) _n (3) _col(10) _colu(5) _column(1) ' +
            '_c _co _cont _continue _s _sk(2) _skip(3) _d(2) _dup(3) ' +
            '_r(a) _request(b) _char(65) _asis\n'
        )).toEqual([
            '_newline', '_newline', '_newline(2)', '_newline(3)',
            '_column(10)', '_column(5)', '_column(1)',
            '_continue', '_continue', '_continue', '_continue',
            '_skip', '_skip(2)', '_skip(3)', '_dup(2)', '_dup(3)',
            '_request(a)', '_request(b)', '_char(65)', '_asis',
        ]);
    });

    it('reads words that are not directives as expressions', () => {
        // `_ch`, `_as` and `_newline2` are not directives in Stata 18,
        // and directives are exact-case.
        expect(items('di _ch(65) _as _newline2 _N(2) _Col(3)\n')).toEqual([
            'exp _ch(65)',
            'exp _as',
            'exp _newline2',
            'exp _N(2)',
            'exp _Col(3)',
        ]);
    });

    it('reads as and in styles', () => {
        expect(items(
            'di as text as txt as r as res as result as er as error ' +
            'as inp as input as e as te as `s\' in smcl in red in gr\n'
        )).toEqual([
            'as text', 'as text', 'as result', 'as result', 'as result',
            'as error', 'as error', 'as input', 'as input',
            'as', 'as', 'as',
            'in smcl', 'in red', 'in gr',
        ]);
    });

    it('applies a format to the next string or expression, past directives', () => {
        expect(items('di %5.2f _n , as res 2 %td 0 1 %9s "abc" 2 %5.2f %9.3f 2\n')).toEqual([
            'format %5.2f',
            '_newline',
            ',',
            'as result',
            'exp 2 @%5.2f',
            'format %td',
            'exp 0 @%td',
            'exp 1',
            'format %9s',
            'string "abc" @%9s',
            'exp 2',
            'format %5.2f',
            'format %9.3f',
            'exp 2 @%9.3f',
        ]);
    });

    it('reads a format up to the next whitespace', () => {
        expect(items('di %tdD/M/Y 0 %-9.2fc 1 %`f\' 3 %5.2f(1)\n')).toEqual([
            'format %tdD/M/Y',
            'exp 0 @%tdD/M/Y',
            'format %-9.2fc',
            'exp 1 @%-9.2fc',
            'format %`f\'',
            'exp 3 @%`f\'',
            'format %5.2f(1)',
        ]);
    });

    it('pairs commas, with or without a space between them', () => {
        expect(items('di "a", "b",, "c", , "d",,, 3\n')).toEqual([
            'string "a"', ',',
            'string "b"', ',,',
            'string "c"', ',,',
            'string "d"', ',,', ',',
            'exp 3',
        ]);
    });

    it('reads = exp as an expression item', () => {
        const the_items = first_command('di = 2 + 2 =3\n').display_items ?? [];
        expect(the_items.map(describe_item)).toEqual(['exp (2 + 2)', 'exp 3']);
        expect(the_items[0]?.text).toBe('= 2 + 2');
        expect(the_items[0]?.kind === 'expression' &&
            the_items[0].expression.range.start.character).toBe(5);
    });

    it('keeps the arguments of directives and their ranges', () => {
        const the_items = first_command('di _col( 10 ) _request(ans) _col()\n').display_items ?? [];
        const [column, request, empty] = the_items;
        expect(column?.kind === 'directive' && column.argument).toEqual({
            text: '10',
            expression: {
                kind: 'number',
                text: '10',
                value: 10,
                range: { start: { line: 0, character: 9 }, end: { line: 0, character: 11 } },
            },
            range: { start: { line: 0, character: 9 }, end: { line: 0, character: 11 } },
        });
        expect(request?.kind === 'directive' && request.argument?.expression).toBeNull();
        expect(request?.kind === 'directive' && request.argument?.text).toBe('ans');
        expect(empty?.kind === 'directive' && show(empty.argument?.expression)).toBe('?empty<>');
    });

    it('treats in, = and brackets as arguments, not qualifiers', () => {
        const my_node = first_command('di in smcl "x" = 1 x [1]\n');
        expect(my_node.inExpression).toBeUndefined();
        expect(my_node.expression).toBeUndefined();
        expect(my_node.weight).toBeUndefined();
        expect(my_node.display_items?.map(describe_item)).toEqual([
            'in smcl', 'string "x"', 'exp 1', 'exp x', 'exp ?syntax_error<[1]>',
        ]);
    });

    it('is empty for display alone, and reads every abbreviation', () => {
        expect(items('display\n')).toEqual([]);
        for (const my_name of ['di', 'dis', 'disp', 'displ', 'displa']) {
            expect(items(`${my_name} 1\n`)).toEqual(['exp 1']);
        }
        expect(first_command('Display 1\n').display_items).toBeUndefined();
        expect(first_command('di 1\n', false).display_items).toBeUndefined();
    });

    it('keeps items after a prefix and leaves comments out', () => {
        expect(items('quietly display "a" /* c */ 1 ///\n    _n\n')).toEqual([
            'string "a"', 'exp 1', '_newline',
        ]);
    });
});

describe('unbalanced parentheses in assert and display', () => {
    function errors(my_source: string, structured = true) {
        return parse(my_source, structured).errors.map((e) => ({
            code: e.code,
            message: e.message,
            character: e.range.start.character,
        }));
    }

    it('reports a missing closing parenthesis', () => {
        expect(errors('assert (x > 5\n')).toEqual([{
            code: ParseErrorCode.UNBALANCED_PARENTHESES,
            message: 'Unbalanced parentheses: missing closing parenthesis',
            character: 12,
        }]);
        expect(errors('di _col(5 "x"\n')).toEqual([{
            code: ParseErrorCode.UNBALANCED_PARENTHESES,
            message: 'Unbalanced parentheses: missing closing parenthesis',
            character: 10,
        }]);
    });

    it('reports an unexpected closing parenthesis', () => {
        expect(errors('assert x > 5)\n')).toEqual([{
            code: ParseErrorCode.UNBALANCED_PARENTHESES,
            message: 'Unbalanced parentheses: unexpected closing parenthesis',
            character: 12,
        }]);
    });

    it('reports them without a structured parse too', () => {
        expect(errors('assert (x > 5\n', false)).toHaveLength(1);
        expect(errors('di (1 + 2\n', false)).toHaveLength(1);
    });

    it('does not count parentheses in strings or after the condition', () => {
        expect(errors('assert inlist(x, 1, 2) if (y > 1), rc0\n')).toEqual([]);
        expect(errors('di "(" ")" `"("\' _col(5) (1 + 2)\n')).toEqual([]);
    });

    it('does not report when the lexer splits a macro with nested quotes', () => {
        // Stata 18 runs this (from its own loadingplot.ado); the lexer
        // ends the macro at the inner quote, leaving `")'` behind.
        expect(errors('display as error "only one `=lower("`fname\'")\' retained"\n'))
            .toEqual([]);
    });

    it('lists them in sight parse --json errors as errors', () => {
        const my_document = build_parse_document({
            path: '/tmp/x.do',
            content: 'assert (x > 5\n',
            sight_version: '0.0.0',
        });
        expect(my_document.errors).toEqual([{
            source: 'parser',
            code: 'UNBALANCED_PARENTHESES',
            severity: 'error',
            message: 'Unbalanced parentheses: missing closing parenthesis',
            range: {
                start: { line: 0, character: 12 },
                end: { line: 0, character: 13 },
            },
        }]);
        const the_statements = my_document.statements as Array<Record<string, unknown>>;
        const assertion = the_statements[0]?.assertion as { text: string; expression: ExpressionNode };
        expect(assertion.text).toBe('(x > 5');
        expect(show(assertion.expression)).toBe('?syntax_error<(x > 5>');
    });
});

describe('sight parse --json: assertion and display fields', () => {
    function statements(my_source: string): Array<Record<string, unknown>> {
        const my_document = build_parse_document({
            path: '/tmp/x.do',
            content: my_source,
            sight_version: '0.0.0',
        });
        return my_document.statements as Array<Record<string, unknown>>;
    }

    it('are null on other commands', () => {
        const [my_statement] = statements('regress y x\n');
        expect(my_statement?.assertion).toBeNull();
        expect(my_statement?.display).toBeNull();
    });

    it('give assert its text and expression', () => {
        const [my_statement] = statements('assert x > 5 & ///\n  !missing(x), rc0\n');
        const assertion = my_statement?.assertion as { text: string; expression: ExpressionNode };
        expect(assertion.text).toBe('x > 5 & !missing(x)');
        expect(show(assertion.expression)).toBe('((x > 5) & !missing(x))');
        expect(my_statement?.display).toBeNull();
    });

    it('give display its items and keep its args', () => {
        const [my_statement] = statements('di "a", %5.2f r(mean)\n');
        expect(my_statement?.assertion).toBeNull();
        const display = my_statement?.display as { items: DisplayItem[] };
        expect(display.items.map(describe_item)).toEqual([
            'string "a"', ',', 'format %5.2f', 'exp r(mean) @%5.2f',
        ]);
        expect((my_statement?.args as Array<{ text: string }>).map((a) => a.text))
            .toEqual(['"a",', '%5.2f', 'r(mean)']);
    });
});

describe('display with in and = still formats as written', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    const UNCHANGED_SOURCES = [
        'di in smcl "{bf:x}" 1 in red "y"\n',
        'di = 2 + 2\n',
        'di x[1] x [1] _col(5) "a",,"b"\n',
        'assert x > 5 & !missing(x) if y, rc0\n',
    ];

    for (const my_source of UNCHANGED_SOURCES) {
        for_each_formatter_mode(
            `leaves ${JSON.stringify(my_source)} unchanged`,
            (my_mode) => {
                const my_once = format_text(my_source, my_mode);
                expect(my_once).toBe(my_source);
                expect(format_text(my_once, my_mode)).toBe(my_once);
            }
        );
    }
});

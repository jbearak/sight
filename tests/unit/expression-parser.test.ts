import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import {
    parse_egen_function,
    parse_expression,
    parse_expression_text,
    parse_in_range,
    parse_macro_ref_token,
    parse_path,
    parse_varlist,
} from '../../src/expression-parser';
import { ExpressionNode, TextOrMacroPart, Token } from '../../src/types';

/** Lex `text` and return its significant tokens (no EOF). */
function tokens_of(text: string): Token[] {
    return new StataLexer()
        .tokenize(text)
        .tokens.filter((t) => t.type !== 'EOF' && t.type !== 'STATEMENT_TERMINATOR');
}

/** Tokens of an expression, lexed after `gen x = ` so the lexer is mid-statement. */
function expression_tokens(text: string): Token[] {
    return tokens_of(`gen x = ${text}`).slice(3);
}

function parse(text: string): ExpressionNode {
    return parse_expression(expression_tokens(text));
}

/**
 * Compact, parenthesized rendering of a node for structural assertions.
 * Paren nodes print as `{...}` so explicit grouping stays visible.
 */
function show(node: ExpressionNode | TextOrMacroPart): string {
    switch (node.kind) {
        case 'number':
        case 'missing':
            return node.text;
        case 'text':
            return JSON.stringify(node.value);
        case 'string':
            return `str(${node.parts.map(show).join(' ')})`;
        case 'variable':
            return node.parts ? `name(${node.parts.map(show).join(' ')})` : node.name;
        case 'system_variable':
            return `sys:${node.name}`;
        case 'macro_ref': {
            const name = node.name !== undefined ? `:${node.name}` : '';
            const inner = node.expression ? `{${show(node.expression)}}` : '';
            return `${node.scope}:${node.form}${name}${inner}`;
        }
        case 'unary':
            return `(${node.op} ${show(node.operand)})`;
        case 'binary':
            return `(${show(node.left)} ${node.op} ${show(node.right)})`;
        case 'call':
            return `${node.name}(${node.args.map(show).join(', ')})`;
        case 'subscript':
            return `${show(node.target)}[${node.indices.map(show).join(', ')}]`;
        case 'coefficient':
            return `${node.which}[${node.spec}]`;
        case 'stored_result':
            return `${node.result_class}(${node.name})`;
        case 'paren':
            return `{${show(node.expression)}}`;
        case 'varlist':
            return `varlist(${node.items.map(show).join(' ')})`;
        case 'wildcard':
            return `wild:${node.pattern}`;
        case 'variable_range':
            return `${show(node.from)}-${show(node.to)}`;
        case 'observation':
            return `obs:${node.which}`;
        case 'unparsed':
            return `unparsed<${node.text}>`;
    }
}

describe('expression parser', () => {
    describe('literals', () => {
        it('parses numbers with their value', () => {
            const node = parse('1.5e-3');
            expect(node).toMatchObject({ kind: 'number', text: '1.5e-3', value: 0.0015 });
            expect(show(parse('.5'))).toBe('.5');
        });

        it('parses system and extended missing values', () => {
            expect(parse('.')).toMatchObject({ kind: 'missing', text: '.', extended: null });
            expect(parse('.a')).toMatchObject({ kind: 'missing', text: '.a', extended: 'a' });
            expect(parse('.z')).toMatchObject({ kind: 'missing', extended: 'z' });
        });

        it('parses simple and compound strings with macro parts', () => {
            expect(show(parse('"plain"'))).toBe('str("plain")');
            expect(show(parse('""'))).toBe('str()');
            expect(show(parse('"a`b\'c"'))).toBe('str("a" local:name:b "c")');
            expect(show(parse('"x $g y"'))).toBe('str("x " global:name:g " y")');
            expect(show(parse('`"say "hi" `who\'"\''))).toBe(
                'str("say \\"hi\\" " local:name:who)'
            );
            const nested = parse('`"a `"b"\' c"\'');
            expect(nested).toMatchObject({ kind: 'string', quote: 'compound' });
            expect(show(nested)).toBe('str("a `\\"b\\"\' c")');
        });

        it('treats `*` after a string as multiplication, not a star comment', () => {
            expect(show(parse('"ab" * 3'))).toBe('(str("ab") * 3)');
            expect(show(parse('"a`b\'" * 2'))).toBe('(str("a" local:name:b) * 2)');
            const types = tokens_of('gen s = "ab" * 3').map((t) => t.type);
            expect(types).not.toContain('COMMENT_LINE');
        });

        it('keeps the source text of a string', () => {
            const node = parse('"a`b\'c"');
            expect(node).toMatchObject({ kind: 'string', quote: 'simple', text: '"a`b\'c"' });
        });
    });

    describe('names', () => {
        it('distinguishes system variables by exact case', () => {
            expect(show(parse('_n + _N'))).toBe('(sys:_n + sys:_N)');
            expect(show(parse('_pi * _rc'))).toBe('(sys:_pi * sys:_rc)');
            // Not system variables: Stata is case-sensitive.
            expect(show(parse('_PI'))).toBe('_PI');
        });

        it('parses macro references of every form', () => {
            expect(show(parse('`x\''))).toBe('local:name:x');
            expect(show(parse('$g + ${h}'))).toBe('(global:name:g + global:name:h)');
            expect(show(parse('`=1+2\''))).toBe('local:eval{(1 + 2)}');
            const extended = parse('`:word 1 of `list\'\'');
            expect(extended).toMatchObject({ kind: 'macro_ref', form: 'extended', extended: 'word 1 of `list\'' });
            expect(parse('`++i\'')).toMatchObject({
                form: 'increment', increment: '++', increment_position: 'prefix', name: 'i',
            });
            expect(parse('`i--\'')).toMatchObject({
                form: 'increment', increment: '--', increment_position: 'suffix', name: 'i',
            });
            expect(parse('`macval(m)\'')).toMatchObject({ form: 'name', name: 'm', macval: true });
        });

        it('splits nested macro names into parts', () => {
            const node = parse('`x`i\'\'');
            expect(node).toMatchObject({ kind: 'macro_ref', name: 'x`i\'' });
            if (node.kind !== 'macro_ref') throw new Error('expected macro_ref');
            expect(node.name_parts?.map(show)).toEqual(['"x"', 'local:name:i']);
            expect(node.name_parts?.[1].range).toEqual({
                start: { line: 0, character: 10 },
                end: { line: 0, character: 13 },
            });
        });

        it('builds variable names from adjacent macro pieces', () => {
            expect(show(parse('`v\'_lag'))).toBe('name(local:name:v "_lag")');
            expect(show(parse('v`i\''))).toBe('name("v" local:name:i)');
            expect(show(parse('`v\'[_n-1]'))).toBe('local:name:v[(sys:_n - 1)]');
        });
    });

    describe('operators', () => {
        // Each case was checked against StataMP 18 (`display`), see the
        // precedence notes in src/expression-parser/index.ts.
        const the_cases: Array<[string, string]> = [
            ['1 + 2 * 3', '(1 + (2 * 3))'],
            ['2^3^2', '((2 ^ 3) ^ 2)'],
            ['-2^2', '(- (2 ^ 2))'],
            ['!x == 1', '((! x) == 1)'],
            ['!2^0', '(! (2 ^ 0))'],
            ['!0*5', '((! 0) * 5)'],
            ['2^-1^2', '((2 ^ (- 1)) ^ 2)'],
            ['3 > 2 > 1', '((3 > 2) > 1)'],
            ['1 | 0 & 0', '(1 | (0 & 0))'],
            ['a - b + c', '((a - b) + c)'],
            ['a / b * c', '((a / b) * c)'],
            ['"a" + "b"', '(str("a") + str("b"))'],
        ];
        for (const [my_text, my_expected] of the_cases) {
            it(`parses ${my_text}`, () => {
                expect(show(parse(my_text))).toBe(my_expected);
            });
        }

        it('reports canonical operators and keeps the written form', () => {
            const node = parse('a ~= b');
            expect(node).toMatchObject({ kind: 'binary', op: '!=', op_text: '~=' });
            expect(parse('~a')).toMatchObject({ kind: 'unary', op: '!', op_text: '~' });
            expect(show(parse('a!=b & c~=d | e>=f'))).toBe(
                '(((a != b) & (c != d)) | (e >= f))'
            );
        });

        it('keeps explicit parentheses as paren nodes', () => {
            expect(show(parse('(1 + 2) * 3'))).toBe('({(1 + 2)} * 3)');
        });
    });

    describe('calls, subscripts, and results', () => {
        it('parses function calls with any number of arguments', () => {
            expect(show(parse('cond(a > 1, "y", "n")'))).toBe('cond((a > 1), str("y"), str("n"))');
            expect(show(parse('inlist(x, 1, 2, .a)'))).toBe('inlist(x, 1, 2, .a)');
            expect(show(parse('missing(x) | !missing(y)'))).toBe('(missing(x) | (! missing(y)))');
            expect(show(parse('real(string(x))'))).toBe('real(string(x))');
            expect(show(parse('substr(s, 1, `n\')'))).toBe('substr(s, 1, local:name:n)');
            expect(show(parse('runiform()'))).toBe('runiform()');
        });

        it('parses subscripts', () => {
            expect(show(parse('x[_n-1]'))).toBe('x[(sys:_n - 1)]');
            expect(show(parse('M[1,2]'))).toBe('M[1, 2]');
        });

        it('parses coefficients and stored results', () => {
            expect(show(parse('_b[x] + _se[_cons]'))).toBe('(_b[x] + _se[_cons])');
            expect(show(parse('_b[eq:x]'))).toBe('_b[eq:x]');
            expect(show(parse('r(mean) + e(N) + c(pwd) + s(x)'))).toBe(
                '(((r(mean) + e(N)) + c(pwd)) + s(x))'
            );
            const node = parse('r(`stat\')');
            expect(node).toMatchObject({ kind: 'stored_result', result_class: 'r', name: '`stat\'' });
        });

        it('matches stored-result and coefficient names by exact case', () => {
            expect(parse('R(mean)')).toMatchObject({ kind: 'call', name: 'R' });
            expect(parse('_B[x]')).toMatchObject({ kind: 'subscript' });
        });
    });

    describe('unparsed recovery', () => {
        it('keeps time-series and factor-variable operands as local unparsed nodes', () => {
            expect(show(parse('L.x + 1'))).toBe('(unparsed<L.x> + 1)');
            expect(show(parse('L2.x'))).toBe('unparsed<L2.x>');
            expect(show(parse('i.g#c.z'))).toBe('unparsed<i.g#c.z>');
            const node = parse('L.x');
            expect(node).toMatchObject({ kind: 'unparsed', reason: 'factor_or_time_series_operator' });
        });

        it('confines a bad function argument to that argument', () => {
            expect(show(parse('max(a, b c, d)'))).toBe('max(a, unparsed<b c>, d)');
        });

        it('returns unparsed for broken input instead of throwing', () => {
            for (const my_text of ['(a + b', 'a b', '+', 'a +', ')', 'f(', '"open', '[1]', 'x[', '* 2']) {
                const node = parse(my_text);
                expect(node.kind).toBe('unparsed');
            }
        });

        it('returns an empty unparsed node for no tokens', () => {
            expect(parse_expression([])).toMatchObject({ kind: 'unparsed', reason: 'empty', text: '' });
        });

        describe('when every token is a comment', () => {
            // `gen x = ` is 8 characters, so the comment starts at 0:8.
            const AT_COMMENT = {
                start: { line: 0, character: 8 },
                end: { line: 0, character: 8 },
            };
            const the_inputs = ['/*', '/* note */', '/* a */ /* b */'];

            it('anchors parse_expression at the first comment', () => {
                for (const my_text of the_inputs) {
                    expect(parse(my_text)).toEqual({
                        kind: 'unparsed',
                        text: '',
                        reason: 'empty',
                        range: AT_COMMENT,
                    });
                }
            });

            it('anchors the other entry points at the first comment', () => {
                for (const my_text of the_inputs) {
                    const tokens = expression_tokens(my_text);
                    expect(parse_varlist(tokens).range).toEqual(AT_COMMENT);
                    expect(parse_egen_function(tokens).range).toEqual(AT_COMMENT);
                    expect(parse_path(tokens).range).toEqual(AT_COMMENT);
                    expect(parse_in_range(tokens).range).toEqual(AT_COMMENT);
                    expect(parse_in_range(tokens, { line: 0, character: 7 }).range)
                        .toEqual(AT_COMMENT);
                }
            });
        });

        it('survives deep nesting', () => {
            const deep = '('.repeat(5000) + 'x' + ')'.repeat(5000);
            const node = parse(deep);
            expect(['paren', 'unparsed']).toContain(node.kind);
        });
    });

    describe('ranges', () => {
        it('gives every node the span of its source', () => {
            const node = parse('a + f(b, 2)');
            if (node.kind !== 'binary' || node.right.kind !== 'call') {
                throw new Error('unexpected shape');
            }
            // `gen x = ` is 8 characters.
            expect(node.range).toEqual({ start: { line: 0, character: 8 }, end: { line: 0, character: 19 } });
            expect(node.right.name_range).toEqual({ start: { line: 0, character: 12 }, end: { line: 0, character: 13 } });
            expect(node.right.args[1].range).toEqual({ start: { line: 0, character: 17 }, end: { line: 0, character: 18 } });
        });

        it('spans continuation lines and ignores comments', () => {
            const tokens = tokens_of('gen x = a ///\n  + b /* c */ - 2').slice(3);
            const node = parse_expression(tokens);
            expect(show(node)).toBe('((a + b) - 2)');
            expect(node.range).toEqual({ start: { line: 0, character: 8 }, end: { line: 1, character: 17 } });
        });

        it('places eval-macro expressions at document positions', () => {
            const node = parse_expression_text('a + b', { line: 3, character: 10 });
            expect(node.range).toEqual({ start: { line: 3, character: 10 }, end: { line: 3, character: 15 } });
        });
    });

    describe('varlists', () => {
        it('parses names, wildcards, ranges, and macros', () => {
            const node = parse_varlist(tokens_of('keep a b* x? c-e f - g `v\'').slice(1));
            expect(show(node)).toBe('varlist(a wild:b* wild:x? c-e f-g local:name:v)');
        });

        it('keeps factor-variable items unparsed', () => {
            const node = parse_varlist(tokens_of('reg y i.g L.x').slice(1));
            expect(show(node)).toBe('varlist(y unparsed<i.g> unparsed<L.x>)');
        });
    });

    describe('egen functions', () => {
        it('parses row functions with varlist arguments', () => {
            const node = parse_egen_function(expression_tokens('rowtotal(a-c d)'));
            expect(show(node)).toBe('rowtotal(varlist(a-c d))');
        });

        it('parses other functions with expression arguments', () => {
            expect(show(parse_egen_function(expression_tokens('mean(x - y)')))).toBe('mean((x - y))');
            expect(show(parse_egen_function(expression_tokens('group(a b)')))).toBe('group(varlist(a b))');
        });
    });

    describe('in ranges', () => {
        function in_range(text: string): string {
            const node = parse_in_range(tokens_of(`list in ${text}`).slice(2));
            return node.last ? `${show(node.first)} / ${show(node.last)}` : show(node.first);
        }

        it('parses observation numbers, f/l, and negative counts', () => {
            expect(in_range('1/10')).toBe('1 / 10');
            expect(in_range('f/l')).toBe('obs:first / obs:last');
            expect(in_range('F/L')).toBe('obs:first / obs:last');
            expect(in_range('-5/l')).toBe('(- 5) / obs:last');
            expect(in_range('5')).toBe('5');
            expect(in_range('`a\'/`b\'')).toBe('local:name:a / local:name:b');
        });

        it('returns an unparsed first bound for other shapes', () => {
            expect(in_range('1/2/3')).toBe('unparsed<1/2/3>');
            expect(in_range('1+2/5')).toBe('unparsed<1+2/5>');
            expect(in_range('x/l')).toBe('unparsed<x/l>');
        });
    });

    describe('paths', () => {
        it('parses quoted paths with macro parts', () => {
            const node = parse_path(tokens_of('use "data`v\'.dta"').slice(1));
            expect(node.text).toBe('"data`v\'.dta"');
            expect(node.quote).toBe('simple');
            expect(node.parts.map(show)).toEqual(['"data"', 'local:name:v', '".dta"']);
        });

        it('parses unquoted paths with globals', () => {
            const node = parse_path(tokens_of('use $root/x`i\'.dta').slice(1));
            expect(node.quote).toBeNull();
            expect(node.parts.map(show)).toEqual(['global:name:root', '"/x"', 'local:name:i', '".dta"']);
        });
    });

    it('parses a lone macro token', () => {
        const [token] = tokens_of('`x\'');
        expect(parse_macro_ref_token(token)).toMatchObject({ kind: 'macro_ref', scope: 'local', name: 'x' });
    });
});

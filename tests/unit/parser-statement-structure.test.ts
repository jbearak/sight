import { describe, expect, it } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import {
    CommandNode,
    ControlFlowNode,
    StataDiagnosticCode,
    ExpressionNode,
    MacroDefNode,
    StataNode,
} from '../../src/types';

function parse_nodes(source: string, structured = true): StataNode[] {
    const { tokens } = new StataLexer().tokenize(source);
    return new StataParser({ structured }).parse(tokens).ast.nodes;
}

/** Parse one statement and return it as a command node. */
function command(source: string, structured = true): CommandNode {
    const nodes = parse_nodes(source, structured);
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    if (node.type !== 'command') {
        throw new Error(`expected a command, got ${node.type}`);
    }
    return node;
}

function names(node: CommandNode): string[] {
    return (node.varlist ?? []).map((item) => item.name);
}

function kind_of(node: ExpressionNode | undefined): string | undefined {
    return node?.kind;
}

describe('statement structure', () => {
    describe('one node per statement', () => {
        // Each of these used to split into several command nodes, or drop
        // part of the statement.
        const the_cases: Array<[string, string]> = [
            ['assert x > 0', 'assert'],
            ['display a + b', 'display'],
            ['svy: reg y x', 'reg'],
            ['xi: reg y i.x', 'reg'],
            ['version 14: gen x = 1', 'gen'],
            ['bootstrap, reps(10): reg y x', 'reg'],
            ['reg y x [aw=w] if a in 1/l, robust', 'reg'],
            ['tab x [fw=n]', 'tab'],
            ['gen x:lbl = 1', 'gen'],
            ['eststo: reg y x', 'reg'],
            ['mi estimate, dots: reg y x', 'reg'],
            ['capture noisily by id: replace x = x[_n-1] if missing(x)', 'replace'],
            ['quietly bys id (t), sort: gen n = _n', 'gen'],
            ['statsby mean=r(mean), by(g) clear: sum x', 'sum'],
            ['reg y x ///\n  z w, robust', 'reg'],
            ['display a /* c */ + b', 'display'],
            ['reg y x, ///\n robust ///\n cluster(id)', 'reg'],
            ['gettoken a b : c, parse(" ")', 'gettoken'],
            ['regress y x [`weight\'`exp\'] if `touse\'', 'regress'],
        ];
        for (const [my_source, my_name] of the_cases) {
            it(`keeps ${JSON.stringify(my_source)} as one ${my_name} node`, () => {
                const node = command(my_source);
                expect(node.name).toBe(my_name);
            });
        }

        it('continues past a block comment followed by ///', () => {
            const node = command('reg y /* explanation */ ///\n    x, robust');
            expect(names(node)).toEqual(['y', 'x']);
            expect(node.options?.map((o) => o.name)).toEqual(['robust']);
        });

        it('keeps a macro value whole across an interior block comment', () => {
            for (const my_source of ['local x a /* note */ b', 'version 14: local x a /* note */ b']) {
                const nodes = parse_nodes(my_source);
                expect(nodes).toHaveLength(1);
                expect(nodes[0]).toMatchObject({ type: 'macro_def', name: 'x', value: 'a b' });
            }
        });

        it('keeps the node range over the whole statement', () => {
            const node = command('reg y x ///\n  z w, robust');
            expect(node.range).toEqual({
                start: { line: 0, character: 0 },
                end: { line: 1, character: 13 },
            });
            expect(names(node)).toEqual(['y', 'x', 'z', 'w']);
        });

        it('leaves a trailing comment as trivia', () => {
            const node = command('reg y x /* note */');
            expect(names(node)).toEqual(['y', 'x']);
            expect(node.trailingTrivia?.map((t) => t.content)).toEqual(['/* note */']);
        });
    });

    describe('prefixes', () => {
        it('parses by with its varlist, sort group, and options', () => {
            const node = command('quietly bys id year (t), sort: gen n = _n');
            const [quietly, by] = node.prefix ?? [];
            expect(quietly).toMatchObject({ name: 'quietly', fullName: 'quietly' });
            expect(by).toMatchObject({ name: 'bys', fullName: 'bysort', has_colon: true });
            expect(by.varlist).toEqual(['id', 'year', '(t)']);
            expect(by.by_varlist?.items.map((i) => i.kind === 'variable' ? i.name : i.kind)).toEqual(['id', 'year']);
            expect(by.sort_varlist?.items.map((i) => i.kind === 'variable' ? i.name : i.kind)).toEqual(['t']);
            expect(by.options?.map((o) => o.name)).toEqual(['sort']);
        });

        it('expands prefix abbreviations to canonical names, exact case', () => {
            const node = command('qui cap n by g: gen x = 1');
            expect(node.prefix?.map((p) => p.fullName)).toEqual(['quietly', 'capture', 'noisily', 'by']);
            // `Quietly` is not a Stata prefix.
            expect(command('Quietly display 1').name).toBe('Quietly');
        });

        it('parses colon prefixes with arguments and options', () => {
            const svy = command('svy linearized, subpop(x): mean y');
            expect(svy.prefix?.[0]).toMatchObject({
                name: 'svy', fullName: 'svy', arguments: 'linearized', has_colon: true,
            });
            expect(svy.prefix?.[0].options?.[0]).toMatchObject({ name: 'subpop', argument: 'x' });

            const version = command('version 14.2: gen x = 1');
            expect(version.prefix?.[0]).toMatchObject({ fullName: 'version', arguments: '14.2' });

            const bs = command('bs, reps(5): reg y x');
            expect(bs.prefix?.[0]).toMatchObject({ name: 'bs', fullName: 'bootstrap' });
            expect(bs.prefix?.[0].arguments).toBeUndefined();
        });

        it('treats colon-prefix commands without a colon as commands', () => {
            expect(command('version 14').name).toBe('version');
            expect(command('mi set mlong').name).toBe('mi');
            expect(command('xi i.x').name).toBe('xi');
        });

        it('keeps a prefixed macro definition a macro definition', () => {
            const [node] = parse_nodes('version 14: local x = 1') as MacroDefNode[];
            expect(node).toMatchObject({ type: 'macro_def', scope: 'local', name: 'x', value: '1' });
            expect(node.prefix?.map((p) => p.fullName)).toEqual(['version']);
            expect(node.range.start.character).toBe(0);

            const source = 'version 14: local x = 1\ndisplay `x\'';
            const { tokens } = new StataLexer().tokenize(source);
            const { ast } = new StataParser().parse(tokens);
            const result = new SemanticAnalyzer().analyze(
                ast, 'test://file.do', undefined, { undefined_macro_enabled: true }, tokens
            );
            const undefined_macros = result.diagnostics.filter(
                (d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            expect(undefined_macros).toEqual([]);
        });

        it('keeps a loop after a colon prefix', () => {
            const [node] = parse_nodes('version 14: foreach x in a b {\n    di 1\n}') as ControlFlowNode[];
            expect(node).toMatchObject({ type: 'foreach', loopVar: 'x' });
            expect(node.body).toHaveLength(1);
            expect(node.prefix?.map((p) => p.fullName)).toEqual(['version']);
        });

        it('defines a variable under a by prefix', () => {
            const source = 'by id: gen x = 1';
            const { tokens } = new StataLexer().tokenize(source);
            const { ast } = new StataParser().parse(tokens);
            const result = new SemanticAnalyzer().analyze(ast, 'test://file.do', undefined, undefined, tokens);
            expect(result.symbols.variables.has('x')).toBe(true);
            expect(result.symbols.variables.has('id')).toBe(false);
        });
    });

    describe('weights', () => {
        it('parses a weight in any qualifier position', () => {
            for (const my_source of [
                'reg y x [aw=w] if a in 1/5, robust',
                'reg y x if a [aw=w] in 1/5, robust',
                'reg y x if a in 1/5 [aw=w], robust',
            ]) {
                const node = command(my_source);
                expect(node.weight).toMatchObject({ keyword: 'aw', kind: 'aweight', expression: 'w' });
                expect(node.ifExpression).toBe('a');
                expect(node.inExpression).toBe('1/5');
                expect(node.options?.map((o) => o.name)).toEqual(['robust']);
            }
        });

        it('maps every weight keyword to a canonical kind', () => {
            const the_cases: Array<[string, string]> = [
                ['fw', 'fweight'], ['fweight', 'fweight'], ['frequency', 'fweight'],
                ['aw', 'aweight'], ['aweight', 'aweight'], ['cellsize', 'aweight'],
                ['pw', 'pweight'], ['pweight', 'pweight'],
                ['iw', 'iweight'], ['iweight', 'iweight'], ['weight', 'weight'],
            ];
            for (const [my_keyword, my_kind] of the_cases) {
                expect(command(`sum x [${my_keyword} = n]`).weight?.kind).toBe(my_kind as never);
            }
        });

        it('parses the weight expression', () => {
            const node = command('sum x [pw = 1/p]');
            expect(node.weight?.expression).toBe('1/p');
            expect(node.weight?.expression_ast).toMatchObject({ kind: 'binary', op: '/' });
            expect(node.weight?.range).toEqual({
                start: { line: 0, character: 6 },
                end: { line: 0, character: 16 },
            });
        });

        it('recognizes the syntax-program weight idiom', () => {
            const node = command('regress y x [`weight\'`exp\'] if `touse\'');
            expect(node.weight).toMatchObject({ keyword: '`weight\'', kind: null, expression: '`exp\'' });
            expect(node.ifExpression).toBe('`touse\'');
        });

        it('leaves subscripts alone', () => {
            const node = command('replace y = x[_n-1] if z[1] > 0');
            expect(node.weight).toBeUndefined();
            expect(node.expression).toBe('x[_n-1]');
            expect(node.ifExpression).toBe('z[1] > 0');
        });

        it('requires an exact-case weight keyword', () => {
            expect(command('sum x [AW=w]').weight).toBeUndefined();
        });
    });

    describe('using', () => {
        it('keeps using in the varlist and adds structured paths', () => {
            const node = command('merge 1:1 id using "data`v\'.dta", keep(match)');
            expect(names(node)).toEqual(['1:1', 'id', 'using', '"data`v\'.dta"']);
            expect(node.using?.paths).toHaveLength(1);
            const [path] = node.using?.paths ?? [];
            expect(path.quote).toBe('simple');
            expect(path.parts.map((p) => p.kind === 'text' ? p.value : `\`${p.name}'`)).toEqual([
                'data', '`v\'', '.dta',
            ]);
        });

        it('parses several file names', () => {
            const node = command('append using a b`i\', force');
            expect(node.using?.paths.map((p) => p.text)).toEqual(['a', 'b`i\'']);
        });

        it('parses using after an if qualifier', () => {
            const node = command('use x y if z == 1 using "f.dta", clear');
            expect(node.ifExpression).toBe('z == 1');
            expect(node.using?.paths.map((p) => p.text)).toEqual(['"f.dta"']);
            expect(node.options?.map((o) => o.name)).toEqual(['clear']);
        });
    });

    describe('extra arguments', () => {
        it('keeps non-varlist argument tokens in order', () => {
            expect(command('assert x > 0').extra_args?.map((a) => a.name)).toEqual(['>', '0']);
            expect(command('gettoken a b : c').extra_args?.map((a) => a.name)).toEqual([':', 'c']);
        });

        it('keeps the varlist unchanged before the first non-varlist token', () => {
            const node = command('gen x:lbl = 1');
            expect(names(node)).toEqual(['x']);
            expect(node.extra_args?.map((a) => a.name)).toEqual([':lbl']);
            expect(node.expression).toBe('1');
        });
    });

    describe('structured expressions', () => {
        it('are built only when requested', () => {
            const plain = command('gen y = x + 1 if z in 1/5', false);
            expect(plain.expression).toBe('x + 1');
            expect(plain.expression_ast).toBeUndefined();
            expect(plain.if_ast).toBeUndefined();
            expect(plain.in_range).toBeUndefined();

            const structured = command('gen y = x + 1 if z in 1/5');
            expect(kind_of(structured.expression_ast)).toBe('binary');
            expect(kind_of(structured.if_ast)).toBe('variable');
            expect(structured.in_range?.last?.kind).toBe('number');
        });

        it('keeps commas inside subscripts in the assignment', () => {
            const node = command('scalar s = M[1,2] + f(a, b), opt');
            expect(node.expression).toBe('M[1,2] + f(a, b)');
            expect(node.expression_ast).toMatchObject({
                kind: 'binary',
                left: { kind: 'subscript', indices: [{ kind: 'number' }, { kind: 'number' }] },
            });
            expect(node.options?.map((o) => o.name)).toEqual(['opt']);
        });

        it('parses egen functions with varlist arguments', () => {
            const node = command('egen t = rowtotal(a-c)');
            expect(node.expression_ast).toMatchObject({ kind: 'call', name: 'rowtotal' });
            if (node.expression_ast?.kind !== 'call') throw new Error('expected call');
            expect(node.expression_ast.args[0]).toMatchObject({ kind: 'varlist' });
        });

        it('marks an empty `=` as an empty unparsed node', () => {
            const node = command('gen x =');
            expect(node.expression_ast).toMatchObject({ kind: 'unparsed', reason: 'empty' });
        });

        it('parses local macro expressions', () => {
            const [node] = parse_nodes('local n = `n\' + 1') as MacroDefNode[];
            expect(node.type).toBe('macro_def');
            expect(node.expression_ast).toMatchObject({ kind: 'binary', op: '+' });
            const [plain] = parse_nodes('local n `n\' + 1') as MacroDefNode[];
            expect(plain.expression_ast).toBeUndefined();
        });

        it('parses if and while conditions', () => {
            const [if_node] = parse_nodes('if x > 1 & `a\' {\n    di 1\n}') as ControlFlowNode[];
            expect(if_node.condition_ast).toMatchObject({ kind: 'binary', op: '&' });
            const [while_node] = parse_nodes('while `i\' < 10 {\n    local ++i\n}') as ControlFlowNode[];
            expect(while_node.condition_ast).toMatchObject({ kind: 'binary', op: '<' });
        });

        it('parses an in qualifier followed by if', () => {
            const node = command('sum x in 1/5 if y');
            expect(node.inExpression).toBe('1/5');
            expect(node.ifExpression).toBe('y');
        });
    });
});

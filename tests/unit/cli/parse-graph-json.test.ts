import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import embedded_cache from '../../../src/command-database/caches/v18.json' with { type: 'json' };
import { CommandDatabase } from '../../../src/command-database';
import type { CommandCache } from '../../../src/command-database/types';
import { find_cycles, parse_graph_args, run_graph_with_cwd } from '../../../src/cli/graph';
import { parse_parse_args, run_parse_with_cwd } from '../../../src/cli/parse';
import { build_parse_document } from '../../../src/cli/parse-json';

type Json = Record<string, any>;

const database = new CommandDatabase();
database.load_cache(embedded_cache as CommandCache);

function statements(source: string): Json[] {
    const document = build_parse_document({
        path: '/x/test.do',
        content: source,
        sight_version: 'test',
        command_database: database,
    });
    return document.statements as Json[];
}

function capture() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return { stdout, stderr, output: { stdout: (t: string) => stdout.push(t), stderr: (t: string) => stderr.push(t) } };
}

describe('sight parse --json', () => {
    it('requires --json and at least one file', () => {
        expect(parse_parse_args(['a.do'])).toMatchObject({ success: false });
        expect(parse_parse_args(['--json'])).toMatchObject({ success: false });
        expect(parse_parse_args(['--json', 'a.do', 'b.do'])).toMatchObject({
            success: true, args: { files: ['a.do', 'b.do'] },
        });
        expect(parse_parse_args(['--bogus'])).toMatchObject({ success: false });
    });

    it('keeps JSON Lines in argument order when a file is unreadable', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-parse-'));
        fs.writeFileSync(path.join(directory, 'a.do'), 'display 1\n');
        const { stdout, stderr, output } = capture();
        const code = run_parse_with_cwd(['--json', 'missing.do', 'a.do'], directory, output);
        expect(code).toBe(2);
        expect(stderr.join('')).toContain('missing.do');
        const the_lines = stdout.join('').trim().split('\n').map((l) => JSON.parse(l));
        expect(the_lines).toHaveLength(2);
        expect(the_lines[0]).toMatchObject({ schema_version: 1, error: {} });
        expect(the_lines[1].statements[0]).toMatchObject({ kind: 'command', name: 'display' });
    });

    it('reports the delimit mode of every statement', () => {
        const the_statements = statements('di 1\n#delimit ;\ndi 2;\n#delimit cr\ndi 3\n');
        expect(the_statements.map((s) => `${s.kind}:${s.delimit}`)).toEqual([
            'command:cr', 'delimit:cr', 'command:semicolon', 'delimit:semicolon', 'command:cr',
        ]);
    });

    it('gives canonical names by exact case only', () => {
        const [reg, upper] = statements('reg y x, rob\nREG y x\n');
        expect(reg.canonical_name).toBe('regress');
        expect(reg.options[0]).toMatchObject({ name: 'rob', canonical_name: 'robust' });
        expect(upper.canonical_name).toBeNull();
    });

    it('keeps the exact statement text, continuations and comments included', () => {
        const [node] = statements('gen x = a /// note\n    + b\n');
        expect(node.text).toBe('gen x = a /// note\n    + b');
        expect(node.assignment.expression).toMatchObject({ kind: 'binary', op: '+' });
    });

    it('parses option arguments only when they are clean expressions', () => {
        const [node] = statements('reghdfe y x, absorb(firm year) level(95) title("a")\n');
        expect(node.options.map((o: Json) => o.expression?.kind ?? null)).toEqual([null, 'number', 'string']);
    });

    it('reports forvalues ranges in each form', () => {
        const forms = statements([
            'forvalues i = 1/10 {\n}',
            'forvalues i = 10(-2)0 {\n}',
            'forvalues i = 1 3 to 9 {\n}',
            'forvalues i = `a\'/`b\' {\n}',
            '',
        ].join('\n')).map((s) => s.spec);
        expect(forms.map((f) => f.form)).toEqual(['slash', 'paren', 'to', 'slash']);
        expect(forms[1].step).toMatchObject({ kind: 'unary', op: '-' });
        expect(forms[2].second).toMatchObject({ kind: 'number', value: 3 });
        expect(forms[3].first).toMatchObject({ kind: 'macro_ref', name: 'a' });
    });

    it('reports foreach list types', () => {
        const [a, b] = statements('foreach v of varlist x* {\n}\nforeach w in a "b c" {\n}\n');
        expect(a.spec).toMatchObject({ keyword: 'of', list_type: 'varlist' });
        expect(a.spec.items.map((i: Json) => i.text)).toEqual(['x*']);
        expect(b.spec).toMatchObject({ keyword: 'in', list_type: null });
        expect(b.spec.items.map((i: Json) => i.text)).toEqual(['a', '"b c"']);
    });

    it('reports the args of a program, including a lone one in brace blocks', () => {
        function args_of(source: string): string[] {
            const program = statements(source).find((s) => s.kind === 'program');
            return (program?.args ?? []).map((my_arg: Json) => my_arg.name);
        }
        expect(args_of('program p\n    args a b\nend\n')).toEqual(['a', 'b']);
        for (const my_opener of ['quietly {', 'capture {', 'capture noisily {', 'frame default {']) {
            expect({ my_opener, args: args_of(`program p\n    ${my_opener}\n        args a b\n    }\nend\n`) })
                .toEqual({ my_opener, args: ['a', 'b'] });
        }
        expect(args_of('program p\n    quietly {\n        capture {\n            args a\n        }\n    }\nend\n'))
            .toEqual(['a']);
        // Several args with any nested: the top-level ones only.
        expect(args_of('program p\n    if 1 {\n        args a\n    }\n    else {\n        args b\n    }\nend\n'))
            .toEqual([]);
        expect(args_of('program p\n    args a\n    quietly {\n        args b\n    }\nend\n'))
            .toEqual(['a']);
        // A lone args in an if branch is not read either.
        expect(args_of('program p\n    if 1 {\n        args a\n    }\nend\n')).toEqual([]);
    });

    it('reports macro forms', () => {
        const [value, expression, extended, increment] = statements(
            'local a x `b\' y\nlocal n = 1 + 2\nlocal w : word 1 of a b\nlocal ++i\n'
        );
        expect(value).toMatchObject({ form: 'value', value: "x `b' y" });
        expect(value.value_parts.map((p: Json) => p.kind === 'text' ? p.value : `<${p.name}>`)).toEqual([
            'x ', '<b>', ' y',
        ]);
        expect(expression).toMatchObject({ form: 'expression', expression: { kind: 'binary' } });
        expect(extended).toMatchObject({ form: 'extended', extended: { function: 'word', args: '1 of a b' } });
        expect(increment).toMatchObject({ form: 'increment', increment: '++', name: 'i' });
    });

    it('reports prefixes on macro definitions and loops', () => {
        const [macro, loop] = statements('version 14: local x = 1\nversion 14: foreach v in a {\n}\n');
        expect(macro).toMatchObject({ kind: 'macro', name: 'x', form: 'expression' });
        expect(macro.prefixes.map((p: Json) => p.canonical_name)).toEqual(['version']);
        expect(loop).toMatchObject({ kind: 'foreach', variable: 'v' });
        expect(loop.prefixes[0]).toMatchObject({ name: 'version', arguments: '14' });
    });

    it('reads prefixed macros and loops after their prefixes', () => {
        const [value, increment, loop, range] = statements([
            'version 14: local x hi `y\'',
            'version 14: local ++i',
            'version 14: foreach v of local list {',
            '}',
            'version 14: forvalues i = 1/3 {',
            '}',
            '',
        ].join('\n'));
        expect(value).toMatchObject({ form: 'value', value: "hi `y'" });
        expect(value.value_parts.map((p: Json) => p.kind)).toEqual(['text', 'macro_ref']);
        expect(value.value_parts[0].value).toBe('hi ');
        expect(increment).toMatchObject({ form: 'increment', increment: '++', name: 'i' });
        expect(loop.spec).toMatchObject({ keyword: 'of', list_type: 'local' });
        expect(loop.spec.items.map((i: Json) => i.text)).toEqual(['list']);
        expect(range.spec).toMatchObject({ form: 'slash', first: { kind: 'number', value: 1 } });
    });

    it('joins value parts across a continuation the way value does', () => {
        for (const [my_source, my_value] of [
            ['local a foo ///\nbar\n', 'foo bar'],
            ['local a foo ///\n  bar\n', 'foo bar'],
            ['local a foo ///\n    ///\nbar\n', 'foo bar'],
            ['local a foo ///\n\nbar\n', 'foo'],
            // Stata 18 stores `foo///` as written: a `///` continues a
            // line only after a space or tab.
            ['local a foo///\nbar\n', 'foo///'],
            ['local a foo///note\nbar\n', 'foo///note'],
        ]) {
            const [node] = statements(my_source);
            expect(node.value).toBe(my_value);
            expect(node.value_parts.map((p: Json) => p.value).join('')).toBe(my_value);
        }
    });

    it('reports comments inside a statement and before a closing brace', () => {
        const [gen, loop] = statements('gen y = 1 /// note\n    + 2\nforeach v in a {\n    di 1\n    // last\n}\n');
        expect(gen.comments.interior).toMatchObject([{ style: 'continuation', text: '/// note' }]);
        expect(loop.comments.block_end).toMatchObject([{ style: 'slash', text: '// last' }]);
        expect(loop.comments.interior).toEqual([]);
        expect(loop.body[0].comments.interior).toEqual([]);
    });

    describe('own-line comments the parser attaches as trailing', () => {
        /** Each statement's comment lists as texts, then the document's. */
        function comment_lists(source: string): string[] {
            const document = build_parse_document({
                path: '/x/test.do', content: source, sight_version: 'test',
            });
            const texts = (the_comments: Json[]) => the_comments.map((c) => c.text).join(',');
            const walk = (the_statements: Json[]): string[] => the_statements.flatMap((s) => [
                `${s.kind} L[${texts(s.comments.leading)}] T[${texts(s.comments.trailing)}]` +
                    ` B[${texts(s.comments.block_end)}]`,
                ...walk(s.body ?? []),
            ]);
            return [...walk(document.statements as Json[]),
                `comments[${texts(document.comments as Json[])}]`];
        }

        it('reports a comment-only tail at end of file as no statement\'s', () => {
            for (const [my_source, my_lists] of [
                ['di 1\n* tail\n', ['command L[] T[] B[]', 'comments[* tail]']],
                ['di 1\n\n/* tail */\n', ['command L[] T[] B[]', 'comments[/* tail */]']],
                ['di 1 /* a\n b */ // c\n* tail\n',
                    ['command L[] T[/* a\n b */,// c] B[]', 'comments[* tail]']],
                ['program p\ndi 1\nend\n* tail\n',
                    ['program L[] T[] B[]', 'command L[] T[] B[]', 'comments[* tail]']],
                ['if 1 {\ndi 1\n}\n* tail\n',
                    ['if L[] T[] B[]', 'command L[] T[] B[]', 'comments[* tail]']],
                ['mata:\nx = 1\nend\n* tail\n', ['embedded L[] T[] B[]', 'comments[* tail]']],
                ['mata {\nx = 1\n}\n* tail\n', ['embedded L[] T[] B[]', 'comments[* tail]']],
            ] as const) {
                expect(comment_lists(my_source)).toEqual([...my_lists]);
            }
        });

        // Under `#delimit ;` a `*` comment runs to its `;` (Stata 18).
        it('makes comments after #delimit ; lead the next statement', () => {
            expect(comment_lists('#delimit ;\n* a;\n* b;\ndi 1;\n')).toEqual([
                'delimit L[] T[] B[]', 'command L[* a;,* b;] T[] B[]', 'comments[]',
            ]);
            expect(comment_lists('program p\n#delimit ;\n* a;\ndi 1;\n#delimit cr\nend\n')).toEqual([
                'program L[] T[] B[]', 'delimit L[] T[] B[]', 'command L[* a;] T[] B[]',
                'delimit L[] T[] B[]', 'comments[]',
            ]);
        });

        it('puts comments after a final #delimit ; before the closing end or brace', () => {
            expect(comment_lists('program p\ndi 1\n#delimit ;\n* c;\nend;\n')).toEqual([
                'program L[] T[] B[* c;]', 'command L[] T[] B[]', 'delimit L[] T[] B[]',
                'comments[]',
            ]);
            expect(comment_lists('if 1 {\n#delimit ;\n* c;\n};\n')).toEqual([
                'if L[] T[] B[* c;]', 'delimit L[] T[] B[]', 'comments[]',
            ]);
            expect(comment_lists('di 1\n#delimit ;\n* c\n')).toEqual([
                'command L[] T[] B[]', 'delimit L[] T[] B[]', 'comments[* c]',
            ]);
        });
    });

    it('reads a block comment inside an expression as whitespace', () => {
        const [gen, keep, reg] = statements(
            'gen x = a /* c */ + b\nkeep if a /* c */ & b\nreg y x [aw = w /* c */ * 2]\n');
        expect(gen.assignment).toMatchObject({ text: 'a + b', expression: { kind: 'binary', op: '+' } });
        expect(gen.args.map((a: Json) => a.text)).toEqual(['x']);
        expect(keep.if).toMatchObject({ text: 'a & b', expression: { kind: 'binary', op: '&' } });
        expect(keep.args).toEqual([]);
        expect(reg.weight).toMatchObject({ text: 'w * 2', expression: { kind: 'binary', op: '*' } });
        for (const my_node of [gen, keep, reg]) {
            expect(my_node.comments.interior).toMatchObject([{ style: 'block', text: '/* c */' }]);
            expect(my_node.comments.trailing).toEqual([]);
        }
    });

    it('gives community commands no canonical name', () => {
        const [node] = statements('reghdfe y x, absorb(id)\n');
        expect(node.canonical_name).toBeNull();
        expect(node.options[0].canonical_name).toBeNull();
    });

    it('reports option arguments as written', () => {
        const [node] = statements('reg y x, title("a"   "b")\n');
        expect(node.options[0].argument).toBe('"a"   "b"');
    });

    it('drops an option expression with an unparsed part anywhere', () => {
        const [node] = statements('reg y x, title("`=L.x\'")\n');
        expect(node.options[0].expression).toBeNull();
    });

    it('marks else if', () => {
        const the_statements = statements('if a {\n}\nelse if b {\n}\nelse {\n    if c {\n    }\n}\n');
        expect(the_statements.map((s) => s.kind === 'else' ? `else:${s.else_if}` : s.kind)).toEqual([
            'if', 'else:true', 'else:false',
        ]);
    });

    it('marks else if after a comment', () => {
        const the_statements = statements('if 0 display 1\nelse /* note */ if 1 display 2\n');
        expect(the_statements[1]).toMatchObject({ kind: 'else', else_if: true });
    });

    it('reads every weight word Stata accepts, and only those', () => {
        // Stata 18 accepts these down to w, fw, freq, aw, cell, pw, iw.
        const the_kinds: Record<string, string> = {
            w: 'weight', weig: 'weight', weight: 'weight',
            fw: 'fweight', fweight: 'fweight',
            freq: 'fweight', frequency: 'fweight',
            aw: 'aweight', aweig: 'aweight', aweight: 'aweight',
            cell: 'aweight', cellsize: 'aweight',
            pw: 'pweight', pweight: 'pweight',
            iw: 'iweight', iweight: 'iweight',
        };
        for (const [my_word, my_kind] of Object.entries(the_kinds)) {
            const [node] = statements(`summarize price [${my_word}=pop]\n`);
            expect(node.weight).toMatchObject({ keyword: my_word, kind: my_kind, text: 'pop' });
            expect(node.args.map((a: Json) => a.text)).toEqual(['price']);
        }
        // r(198) in Stata 18; uppercase is not a weight word either.
        for (const my_word of ['f', 'fre', 'a', 'cel', 'p', 'i', 'W']) {
            const [node] = statements(`summarize price [${my_word}=pop]\n`);
            expect(node.weight).toBeNull();
        }
    });

    it('reads abbreviated foreach list types', () => {
        // Stata 18 accepts three letters or more of each.
        const the_types: Record<string, string> = {
            var: 'varlist', varl: 'varlist', varlist: 'varlist',
            new: 'newlist', num: 'numlist', loc: 'local', glo: 'global',
        };
        for (const [my_word, my_type] of Object.entries(the_types)) {
            const [loop] = statements(`foreach v of ${my_word} a b {\n}\n`);
            expect(loop.spec).toMatchObject({ list_type: my_type });
            expect(loop.spec.items.map((i: Json) => i.text)).toEqual(['a', 'b']);
        }
        for (const my_word of ['va', 'lo', 'gl', 'ne', 'nu', 'Var']) {
            const [loop] = statements(`foreach v of ${my_word} a b {\n}\n`);
            expect(loop.spec.list_type).toBeNull();
        }
    });

    it('reports the default of an integer or real syntax option', () => {
        const [program] = statements(
            'program define p\n    syntax [, Level(integer 95) Tol(real -1e-6) Hi(real)]\nend\n');
        const the_options = program.body[0].signature.options;
        expect(the_options.map((o: Json) => o.default)).toEqual(['95', '-1e-6', null]);
    });

    it('keeps the () of a call with no arguments in its argument', () => {
        const [node] = statements('display runiform()\n');
        expect(node.args.map((a: Json) => a.text)).toEqual(['runiform()']);
    });

    it('keeps Mata blocks opaque', () => {
        const [node] = statements('mata:\nx = 1\nend\n');
        expect(node).toMatchObject({ kind: 'embedded', language: 'mata' });
        expect(node.content.text).toContain('x = 1');
    });

    it('reports programs defined without the define keyword', () => {
        const [node] = statements('program myprog, rclass\n    args a b\nend\n');
        expect(node).toMatchObject({ kind: 'program', name: 'myprog', define_options: 'rclass' });
        expect(node.args.map((a: Json) => a.name)).toEqual(['a', 'b']);
    });
});

describe('sight graph --json', () => {
    it('validates its arguments', () => {
        expect(parse_graph_args(['.'])).toMatchObject({ success: false });
        expect(parse_graph_args(['--json', 'a', 'b'])).toMatchObject({ success: false });
        expect(parse_graph_args(['--json', '--config', 'x.toml', '--no-config'])).toMatchObject({ success: false });
        const result = parse_graph_args(['--json']);
        expect(result.success).toBe(true);
        expect(result.success && result.args.root).toBeUndefined();
    });

    it('rejects a ROOT that is not a directory', async () => {
        const { stderr, output } = capture();
        const code = await run_graph_with_cwd(['--json', 'no-such-dir'], os.tmpdir(), output);
        expect(code).toBe(2);
        expect(stderr.join('')).toContain('invalid ROOT');
    });

    it('resolves a backward directive parent case-aware', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-graph-'));
        fs.writeFileSync(path.join(directory, 'main.do'), 'display 1\n');
        fs.writeFileSync(path.join(directory, 'child.do'), '// sight: done-by MAIN.do\ndisplay 2\n');
        const { stdout, output } = capture();
        const code = await run_graph_with_cwd(['--json', '--no-config', directory], directory, output);
        expect(code).toBe(0);
        const document = JSON.parse(stdout.join(''));
        expect(document.edges).toMatchObject([{
            caller: 'main.do', target: 'child.do', source: 'backward_directive', resolution: 'case_only',
        }]);
        expect(document.entry_points).toEqual(['main.do']);
    });

    it('lists a file it cannot read, with an error, and warns about it', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-graph-'));
        fs.writeFileSync(path.join(directory, 'main.do'), 'do bad.do\n');
        // Not valid UTF-8, like a Latin-1 do-file from before Stata 14.
        fs.writeFileSync(path.join(directory, 'bad.do'), Buffer.from([0x64, 0x69, 0xe9, 0x0a]));
        const { stdout, stderr, output } = capture();
        const code = await run_graph_with_cwd(['--json', '--no-config', directory], directory, output);
        expect(code).toBe(0);
        expect(stderr.join('')).toContain('bad.do');
        const document = JSON.parse(stdout.join(''));
        expect(document.files).toMatchObject([
            { path: 'bad.do', error: expect.stringContaining('UTF-8') },
            { path: 'main.do', error: null },
        ]);
        // The call still resolves to a listed file.
        expect(document.edges).toMatchObject([{ caller: 'main.do', target: 'bad.do', resolution: 'exact' }]);
        expect(document.entry_points).toEqual(['main.do']);
    });

    async function graph_of(files: Record<string, string>): Promise<Json> {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-graph-'));
        for (const [my_name, my_text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(directory, my_name)), { recursive: true });
            fs.writeFileSync(path.join(directory, my_name), my_text);
        }
        const { stdout, output } = capture();
        const code = await run_graph_with_cwd(['--json', '--no-config', directory], directory, output);
        expect(code).toBe(0);
        return JSON.parse(stdout.join(''));
    }

    it('resolves a grandchild in the working directory its caller inherits', async () => {
        // child.do inherits main.do's `sight: cd`, as `sight check` has it.
        const document = await graph_of({
            'main.do': '// sight: cd "work"\ndo jobs/child.do\n',
            'work/jobs/child.do': 'do grand.do\n',
            'work/grand.do': 'display 1\n',
        });
        expect(document.edges).toMatchObject([
            { caller: 'main.do', target: 'work/jobs/child.do', resolution: 'exact' },
            { caller: 'work/jobs/child.do', target: 'work/grand.do', resolution: 'exact' },
        ]);
        expect(document.edges[1].working_directory).toBe(path.join(document.root, 'work'));
        expect(document.unresolved).toEqual([]);
        expect(document.entry_points).toEqual(['main.do']);
    });

    it('passes every word after the file name as an argument', async () => {
        const document = await graph_of({
            'master.do': [
                'do child.do if price > 100',
                'do child.do in 1/2 using y [aw=x] =z+1 , nostop // note',
                'run child.do a ///',
                '    b',
                'do "child.do" 2019 "rural" `a\'b "x`y\'z"',
                'capture noisily do child.do a>b',
                '',
            ].join('\n'),
            'child.do': 'args a b c d\n',
        });
        expect(document.edges.map((my_edge: Json) => my_edge.arguments)).toEqual([
            ['if', 'price', '>', '100'],
            ['in', '1/2', 'using', 'y', '[aw=x]', '=z+1', ',', 'nostop'],
            ['a', 'b'],
            ['2019', '"rural"', "`a'b", '"x`y\'z"'],
            ['a>b'],
        ]);
    });

    it('finds cycles as strongly connected components', () => {
        const adjacency = new Map<string, Set<string>>([
            ['a', new Set(['b'])],
            ['b', new Set(['c'])],
            ['c', new Set(['a', 'd'])],
            ['d', new Set()],
            ['e', new Set(['e'])],
            ['f', new Set(['d'])],
        ]);
        expect(find_cycles(adjacency)).toEqual([['a', 'b', 'c'], ['e']]);
    });
});

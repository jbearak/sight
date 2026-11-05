/**
 * The body of a brace block (`quietly { … }`, `capture { … }`, a bare
 * `{ … }`) is a CommandNode's `body`. It runs in the enclosing scope,
 * so analysis and the providers must walk it like a loop's body.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SemanticAnalyzer } from '../../src/analyzer';
import { run_graph_with_cwd } from '../../src/cli/graph';
import { CommandDatabase } from '../../src/command-database';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CompletionProvider } from '../../src/providers/completion';
import { DefinitionProvider } from '../../src/providers/definition';
import { HoverProvider } from '../../src/providers/hover';
import { ReferencesProvider } from '../../src/providers/references';
import { SymbolProvider } from '../../src/providers/symbols';
import { StataDiagnosticCode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';

function analyze(source: string) {
    const { tokens } = new StataLexer().tokenize(source);
    const { ast } = new StataParser().parse(tokens);
    return new SemanticAnalyzer().analyze(
        ast,
        'file:///test.do',
        undefined,
        { undefined_macro_enabled: true, undefined_variable_enabled: true },
        tokens
    );
}

function undefined_macros(source: string): string[] {
    return analyze(source).diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => `${d.range.start.line}: ${d.message}`);
}

function locations_of(result: unknown): Array<{ line: number }> {
    const the_results = Array.isArray(result) ? result : [result];
    return the_results.map((my_result: { range: { start: { line: number } } }) => ({
        line: my_result.range.start.line,
    }));
}

// Each prefix runs its block's body in Stata 18, which then has `x`.
const THE_BLOCK_OPENERS = [
    'quietly {',
    'qui {',
    'capture {',
    'noisily {',
    'capture noisily {',
    'cap noi {',
];

describe('brace block bodies in analysis', () => {
    it('defines a local set inside the block for code after it', () => {
        for (const my_opener of THE_BLOCK_OPENERS) {
            const source = `${my_opener}\n    local x 5\n}\ndi "\`x'"\ndi \`x'\n`;
            expect({ my_opener, found: undefined_macros(source) })
                .toEqual({ my_opener, found: [] });
        }
    });

    it('defines locals in nested blocks and inside a program', () => {
        expect(undefined_macros(
            'quietly {\n    capture {\n        local w 1\n    }\n}\ndi `w\'\n'
        )).toEqual([]);
        expect(undefined_macros(
            'foreach i in 1 2 {\n    quietly {\n        local v `i\'\n    }\n}\ndi `v\'\n'
        )).toEqual([]);
        expect(undefined_macros(
            'program p\n    quietly {\n        local a 1\n    }\n    di `a\'\nend\n'
        )).toEqual([]);
    });

    it('still warns about an undefined macro inside the block', () => {
        expect(undefined_macros('quietly {\n    di `nope\'\n}\n'))
            .toEqual(["1: `nope' is not defined"]);
    });

    it('checks variables inside the block', () => {
        const the_found = analyze('quietly {\n    summarize nosuchvar\n}\n')
            .diagnostics
            .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE)
            .map((d) => d.range.start.line);
        expect(the_found).toEqual([1]);
    });

    it('lets an ignore on a block header cover the header, not the body', () => {
        // Undefined variables are only checked by the AST pass, which
        // used to skip the whole block under an ignored header.
        for (const my_header of ['quietly {', 'foreach v in a {', 'capture foreach v in a {']) {
            const source = `// sight: ignore-next\n${my_header}\n    summarize nosuchvar\n}\n`;
            const the_found = analyze(source).diagnostics
                .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE)
                .map((d) => d.range.start.line);
            expect({ my_header, the_found }).toEqual({ my_header, the_found: [2] });
        }
    });

    it('keeps both passes aligned after a block', () => {
        // `list` operands are resolved by preorder index; if the
        // reference pass skipped the block's three statements, `a`
        // and `b` would look defined after their reference.
        expect(undefined_macros(
            'quietly {\n    di 1\n    di 2\n    di 3\n}\nlocal a 1\nlocal b 2\nlocal c : list a - b\n'
        )).toEqual([]);
    });

    it('keeps both passes aligned when an ignore directive is on a loop', () => {
        // The ignore covers the loop's header line, not its body, so
        // the reference pass must still walk the body.
        expect(undefined_macros(
            '// sight: ignore-next\nforeach i in 1 2 {\n    di 1\n    di 2\n    di 3\n}\n'
            + 'local a 1\nlocal b 2\nlocal c : list a - b\n'
        )).toEqual([]);
    });

    it('records a do call inside the block as a forward call', () => {
        const the_calls = analyze('quietly {\n    do other.do\n}\n').forward_calls;
        expect(the_calls.map((my_call) => [my_call.call_site_line, my_call.raw_path])).toEqual([[1, 'other.do']]);
    });

    it('reads a c_local set inside a block in a program', () => {
        expect(undefined_macros(
            'program p\n    quietly {\n        c_local r 1\n    }\nend\np\ndi `r\'\n'
        )).toEqual([]);
    });
});

describe('brace block bodies in providers', () => {
    const SOURCE = 'quietly {\n    local x 5\n}\ndi "`x\'"\n';
    // On `x` in `di "`x'"`.
    const REFERENCE = { line: 3, character: 5 };

    it('finds the definition inside the block', async () => {
        const result = await new DefinitionProvider().get_definition(
            create_document_state(SOURCE), REFERENCE
        );
        expect(locations_of(result)).toEqual([{ line: 1 }]);
    });

    it('finds references to and from the definition inside the block', async () => {
        const document = create_document_state(SOURCE);
        const the_results = await new ReferencesProvider().get_references(
            document, REFERENCE, { includeDeclaration: true }
        );
        expect(the_results.map((my_result) => my_result.range.start.line).sort())
            .toEqual([1, 3]);
    });

    it('hovers on a macro defined inside the block', async () => {
        const hover = await new HoverProvider(new CommandDatabase()).get_hover(
            create_document_state(SOURCE), REFERENCE
        );
        expect(JSON.stringify(hover?.contents ?? '')).toContain('x');
    });

    it('offers the macro in completion after the block', async () => {
        const source = 'quietly {\n    local xyz 5\n}\ndi "`\n';
        const the_items = await new CompletionProvider(new CommandDatabase())
            .get_completions(create_document_state(source), { line: 3, character: 5 }, '`');
        expect(the_items.map((my_item) => my_item.label)).toContain('xyz');
    });

    it('lists what the block defines in the outline', () => {
        const source = [
            'quietly {',
            '    local x 5',
            '    gen y = 1',
            '    mata:',
            '    z = 1',
            '    end',
            '}',
            'program p',
            '    quietly {',
            '        local q 1',
            '    }',
            'end',
            '',
        ].join('\n');
        const the_symbols = new SymbolProvider()
            .get_document_symbols(create_document_state(source))
            .map((my_symbol) => ({
                name: my_symbol.name,
                line: my_symbol.range.start.line,
                children: (my_symbol.children ?? []).map((my_child) => my_child.name),
            }));
        expect(the_symbols).toEqual([
            { name: "`x'", line: 1, children: [] },
            { name: 'y', line: 2, children: [] },
            { name: 'Mata Block', line: 3, children: [] },
            { name: 'p', line: 7, children: ["`q'"] },
        ]);
    });
});

describe('brace block bodies in sight graph', () => {
    it('keeps a do call inside quietly { … } as an edge', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-graph-'));
        try {
            fs.writeFileSync(path.join(directory, 'main.do'), 'quietly {\n    do child.do\n}\n');
            fs.writeFileSync(path.join(directory, 'child.do'), 'display 1\n');
            const stdout: string[] = [];
            const code = await run_graph_with_cwd(
                ['--json', '--no-config', directory],
                directory,
                { stdout: (t: string) => stdout.push(t), stderr: () => undefined }
            );
            expect(code).toBe(0);
            const document = JSON.parse(stdout.join(''));
            expect(document.edges).toMatchObject([{
                caller: 'main.do', target: 'child.do', call_type: 'do', resolution: 'exact',
            }]);
            expect(document.entry_points).toEqual(['main.do']);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});

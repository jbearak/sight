/**
 * `marksample touse` defines the local `touse`, which holds the name
 * of a temporary marker variable, as `tempvar touse` would. StataMP 18
 * shows `` `touse' `` as `__000000` after it, the same for
 * `marksample t2, novarlist strok zeroweight`, and defines `tt3`, not
 * `tt`, for `` marksample tt`i' `` when `i` is 3. `mark`, `markout`
 * and `svymarkout` define no local.
 */

import { describe, it, expect } from 'bun:test';
import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import {
    AnalysisResult,
    SemanticAnalyzer,
} from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentStore } from '../../src/document-store';
import { DefinitionProvider } from '../../src/providers/definition';
import { ReferencesProvider } from '../../src/providers/references';
import { CompletionProvider } from '../../src/providers/completion';
import { StataDiagnosticCode } from '../../src/types';
import {
    find_token,
    has_scope,
    tokenize_stata,
} from './helpers/textmate-tokenizer';

function analyze(
    code: string,
    config: Record<string, boolean> = {}
): AnalysisResult {
    const tokens = new StataLexer().tokenize(code).tokens;
    const ast = new StataParser().parse(tokens).ast;
    return new SemanticAnalyzer().analyze(
        ast,
        'file:///test.ado',
        undefined,
        { undefined_macro_enabled: true, ...config },
        tokens
    );
}

function undefined_macros(code: string): string[] {
    return analyze(code).diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => d.symbol_name ?? d.message);
}

function in_program(the_body: string[]): string {
    return [
        'program define p1',
        '    syntax varlist [if] [in]',
        ...the_body.map((my_line) => `    ${my_line}`),
        'end',
    ].join('\n');
}

describe('marksample defines a local', () => {
    it('defines touse for a later `touse\'', () => {
        expect(undefined_macros(in_program([
            'marksample touse',
            'summarize `varlist\' if `touse\'',
        ]))).toEqual([]);
    });

    it('ignores the options after the name', () => {
        expect(undefined_macros(in_program([
            'marksample t2, novarlist strok zeroweight',
            'count if `t2\'',
        ]))).toEqual([]);
    });

    it('defines the name when a comma follows it directly', () => {
        expect(undefined_macros(in_program([
            'marksample t3,novarlist',
            'count if `t3\'',
        ]))).toEqual([]);
    });

    it('defines nothing for a name joined to a macro', () => {
        expect(undefined_macros(in_program([
            'local i 3',
            'marksample tt`i\'',
            'count if `tt\'',
        ]))).toEqual(['tt']);
    });

    it('defines nothing for two names, which Stata rejects', () => {
        expect(undefined_macros(in_program([
            'capture marksample a b',
            'count if `a\' & `b\'',
        ]))).toEqual(['a', 'b']);
    });

    it('keeps the exact case of the name', () => {
        expect(undefined_macros(in_program([
            'marksample Touse',
            'count if `touse\'',
        ]))).toEqual(['touse']);
    });

    it('warns on a use before the marksample', () => {
        expect(undefined_macros(in_program([
            'count if `touse\'',
            'marksample touse',
        ]))).toEqual(['touse']);
    });

    it('records the name as a local, not a variable', () => {
        const result = analyze(in_program(['marksample touse']));
        expect(result.symbols.localMacros.get('touse')?.location.range)
            .toEqual({
                start: { line: 2, character: 15 },
                end: { line: 2, character: 20 },
            });
        expect(result.symbols.variables.has('touse')).toBe(false);
    });

    it('does not report the name as an undefined variable', () => {
        const result = analyze(
            in_program(['marksample touse']),
            { undefined_variable_enabled: true }
        );
        expect(
            result.diagnostics.filter(
                (d) => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE
            )
        ).toEqual([]);
    });

    const NOT_LOCAL_DEFINERS = [
        'mark mk',
        'markout mk price',
        'svymarkout mk',
    ];
    for (const my_statement of NOT_LOCAL_DEFINERS) {
        it(`${my_statement} defines no local`, () => {
            expect(undefined_macros(in_program([
                my_statement,
                'count if `mk\'',
            ]))).toEqual(['mk']);
        });
    }

    it('poisons a loop helper it reassigns', () => {
        // `marksample suffix` reassigns `suffix` inside the loop, so the
        // later `` x_`suffix' `` must not fold the pre-loop "foo".
        const source = [
            'local suffix foo',
            'foreach i in a b {',
            '    marksample suffix',
            '    local x_`suffix\' = 1',
            '}',
            'display `x_foo\'',
        ].join('\n');
        expect(analyze(source).symbols.localMacros.has('x_foo')).toBe(false);
        expect(undefined_macros(source)).toContain('x_foo');
    });
});

describe('marksample local: providers', () => {
    const SOURCE = in_program([
        'marksample touse',                    // line 2
        'summarize `varlist\' if `touse\'',    // line 3
        'count if `',                          // line 4
    ]);
    const URI_TEXT = URI.file('/tmp/marksample-local/p1.ado').toString();

    async function open_document() {
        const document_store = new DocumentStore();
        await document_store.open(URI_TEXT, SOURCE, 1);
        return document_store.get(URI_TEXT)!;
    }

    function as_locations(result: unknown): Location[] {
        if (!result) return [];
        return Array.isArray(result) ? result : [result as Location];
    }

    const USE_POSITION = {
        line: 3,
        character: SOURCE.split('\n')[3].lastIndexOf('touse') + 1,
    };

    it('goes to the marksample name', async () => {
        const document = await open_document();
        const result = await new DefinitionProvider().get_definition(
            document,
            USE_POSITION,
            undefined,
            document.context_tracker
        );
        expect(as_locations(result).map((my_loc) => my_loc.range.start))
            .toEqual([{ line: 2, character: 15 }]);
    });

    it('finds the definition and the use', async () => {
        const document = await open_document();
        const the_locations = await new ReferencesProvider().get_references(
            document,
            USE_POSITION,
            { includeDeclaration: true },
            undefined,
            document.context_tracker
        );
        expect(
            the_locations.map((my_loc) => my_loc.range.start.line).sort()
        ).toEqual([2, 3]);
    });

    it('offers the local in completion', async () => {
        const document = await open_document();
        const the_items = await new CompletionProvider().get_completions(
            document,
            { line: 4, character: SOURCE.split('\n')[4].length },
            '`'
        );
        expect(the_items.map((my_item) => my_item.label)).toContain('touse');
    });
});

describe('marksample local: highlighting', () => {
    it('scopes the name as a local', async () => {
        const the_tokens = await tokenize_stata(
            'marksample touse, novarlist'
        );
        expect(has_scope(find_token(the_tokens, 'marksample'),
            'keyword.other.command.stata')).toBe(true);
        expect(has_scope(find_token(the_tokens, 'touse'),
            'variable.other.local.stata')).toBe(true);
    });

    it('scopes the name before a comment or at the end', async () => {
        for (const my_line of ['marksample touse', 'marksample touse // c']) {
            const the_tokens = await tokenize_stata(my_line);
            expect(has_scope(find_token(the_tokens, 'touse'),
                'variable.other.local.stata')).toBe(true);
        }
    });

    it('does not scope either of two names', async () => {
        const the_tokens = await tokenize_stata('marksample a b');
        expect(
            the_tokens.some((my_token) =>
                my_token.scopes.includes('variable.other.local.stata'))
        ).toBe(false);
    });

    it('does not scope a name joined to a macro', async () => {
        const the_tokens = await tokenize_stata('marksample tt`i\'');
        expect(
            the_tokens.some((my_token) =>
                my_token.scopes.includes('variable.other.local.stata')
                && my_token.text.startsWith('tt'))
        ).toBe(false);
    });
});

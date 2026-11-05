/**
 * A `//` or `///` with code right before it.
 *
 * Stata 18 (checked on StataMP 18) reads `//` and `///` as a comment or a
 * line continuation only at the start of a line, after a space or tab,
 * or after the `;` that ends a statement under `#delimit ;`. Anything
 * else before them makes them text:
 *
 * - `local a b///` then `c` stores `b///` and runs `c` as a command
 *   (r(199)); `local a b///note` stores `b///note`.
 * - `gen y = 2///` and `di 4//2` are r(198): the slashes divide.
 * - Under `#delimit ;`, `local a b///` then `c;` stores `b/// c`.
 * - `local a b ////////` then `c` stores `b c`; so does a line of
 *   slashes inside a ` ///` chain.
 * - `use http://...` keeps the URL.
 */

import { describe, expect, it } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { DocumentStore } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import {
    LanguageContext,
    LexerErrorCode,
    LexerResult,
    StataLSPConfig,
    StataNode,
} from '../../src/types';
import { is_program_definition_header } from '../../src/utils/program-definition';

function lex(source: string, mode: 'cr' | 'semicolon' = 'cr'): LexerResult {
    return new StataLexer().tokenize(source, {
        delimiterMode: mode,
        line: 0,
        column: 0,
        language_context: LanguageContext.STATA,
        context_stack: [LanguageContext.STATA],
    });
}

/** `type:value` for each token other than EOF and terminators. */
function shapes(source: string, mode: 'cr' | 'semicolon' = 'cr'): string[] {
    return lex(source, mode).tokens
        .filter((t) => t.type !== 'EOF' && t.type !== 'STATEMENT_TERMINATOR')
        .map((t) => `${t.type}:${t.value}`);
}

function types_of(source: string): string[] {
    return lex(source).tokens.map((t) => t.type);
}

function nodes_of(source: string): StataNode[] {
    return new StataParser().parse(lex(source).tokens).ast.nodes;
}

function no_space_errors(source: string, mode: 'cr' | 'semicolon' = 'cr') {
    return lex(source, mode).errors.filter(
        (e) => e.code === LexerErrorCode.CONTINUATION_NO_SPACE);
}

describe('lexing // and /// with code right before them', () => {
    it('reads a /// right after a word as three slashes', () => {
        expect(shapes('local a b///\nc')).toEqual([
            'WORD:local', 'WORD:a', 'WORD:b',
            'OPERATOR:/', 'OPERATOR:/', 'OPERATOR:/', 'WORD:c',
        ]);
        expect(types_of('local a b///\nc')).not.toContain('CONTINUATION');
    });

    it('keeps a note after a tight /// as code', () => {
        expect(shapes('local a b///note')).toEqual([
            'WORD:local', 'WORD:a', 'WORD:b',
            'OPERATOR:/', 'OPERATOR:/', 'OPERATOR:/', 'WORD:note',
        ]);
    });

    for (const my_source of [
        'local a "a"///', 'local a (x)///', "local a `x'///",
        'local a b////', 'foreach v in a b {///', '}///',
    ]) {
        it(`reads the slashes in ${JSON.stringify(my_source)} as code`, () => {
            const the_types = types_of(my_source);
            expect(the_types).not.toContain('CONTINUATION');
            expect(the_types).not.toContain('COMMENT_LINE');
        });
    }

    it('reads a // right after code as two slashes', () => {
        expect(shapes('local a b//note')).toEqual([
            'WORD:local', 'WORD:a', 'WORD:b',
            'OPERATOR:/', 'OPERATOR:/', 'WORD:note',
        ]);
        expect(shapes('di 4//2')).toEqual([
            'WORD:di', 'NUMBER:4', 'OPERATOR:/', 'OPERATOR:/', 'NUMBER:2',
        ]);
        expect(types_of('foreach v in a {// note')).not.toContain('COMMENT_LINE');
    });

    it('keeps a URL out of a comment', () => {
        const source = 'use http://www.stata-press.com/data/r18/auto, clear';
        expect(types_of(source)).not.toContain('COMMENT_LINE');
        const [node] = nodes_of(source);
        expect(node).toMatchObject({
            type: 'command',
            name: 'use',
            options: [{ name: 'clear' }],
        });
    });

    it('still reads // and /// after a space or tab, or at line start', () => {
        expect(types_of('local a b ///\nc')).toContain('CONTINUATION');
        expect(types_of('local a b\t///\nc')).toContain('CONTINUATION');
        expect(types_of('local a b\t///note\nc')).toContain('CONTINUATION');
        expect(shapes('local a b // note')).toContain('COMMENT_LINE:// note');
        expect(shapes('// note')).toEqual(['COMMENT_LINE:// note']);
        expect(shapes('/// note')).toEqual(['COMMENT_LINE:/// note']);
    });

    it('reads a // right after the ; that ends a statement as a comment', () => {
        expect(shapes('local a b;// note\ndi 1;', 'semicolon'))
            .toContain('COMMENT_LINE:// note');
        // In cr mode the `;` is text: `local a b;// note` stores all of it.
        expect(types_of('local a b;// note')).not.toContain('COMMENT_LINE');
    });

    it('continues a line after a run of slashes that follows a space', () => {
        // The 7+ slash "visual separator" rule no longer applies.
        expect(types_of('local a b ////////\nc')).toContain('CONTINUATION');
        expect(lex('local a b ///\n//////////////\nc').tokens
            .filter((t) => t.type === 'CONTINUATION')).toHaveLength(2);
        // A line of slashes by itself is a comment.
        expect(shapes('//////////////\ndi 1')[0]).toBe('COMMENT_LINE://////////////');
    });

    it('ends a * comment at a tight /// and continues it after a spaced one', () => {
        expect(nodes_of('* note///\ndi 1')).toHaveLength(1);
        expect(shapes('* note ///\ndi 1')).toEqual(['COMMENT_LINE:* note ///\ndi 1']);
    });

    it('does not continue a // comment with a trailing ///', () => {
        expect(shapes('// note ///\ndi 1')).toEqual([
            'COMMENT_LINE:// note ///', 'WORD:di', 'NUMBER:1',
        ]);
    });

    it('leaves /// inside a string or a block comment alone', () => {
        expect(shapes('local a "b///"')).toEqual([
            'WORD:local', 'WORD:a', 'STRING:"b///"',
        ]);
        expect(shapes('local a b /* x/// */ c')).toEqual([
            'WORD:local', 'WORD:a', 'WORD:b', 'COMMENT_BLOCK:/* x/// */', 'WORD:c',
        ]);
    });
});

describe('parsing a /// with code right before it', () => {
    it('ends the statement at the newline under #delimit cr', () => {
        const the_nodes = nodes_of('local a b///\nc');
        expect(the_nodes).toHaveLength(2);
        expect(the_nodes[0]).toMatchObject({ type: 'macro_def', value: 'b///' });
        expect(the_nodes[1]).toMatchObject({ type: 'command', name: 'c' });
        expect(nodes_of('local a b///note\nc')[0])
            .toMatchObject({ type: 'macro_def', value: 'b///note' });
    });

    it('keeps the slashes and the next line under #delimit ;', () => {
        const the_nodes = new StataParser()
            .parse(lex('local a b///\nc;', 'semicolon').tokens).ast.nodes;
        expect(the_nodes).toHaveLength(1);
        expect(the_nodes[0]).toMatchObject({ type: 'macro_def', value: 'b/// c' });
    });

    it('still joins a /// after a space with one space', () => {
        expect(nodes_of('local a b ///\nc')[0])
            .toMatchObject({ type: 'macro_def', value: 'b c' });
        expect(nodes_of('local a b ///\n  c')[0])
            .toMatchObject({ type: 'macro_def', value: 'b c' });
    });
});

describe('CONTINUATION_NO_SPACE', () => {
    it('is reported once at a /// with code right before it', () => {
        const [error, ...rest] = no_space_errors('local a b////note');
        expect(rest).toEqual([]);
        expect(error.range).toEqual({
            start: { line: 0, character: 9 },
            end: { line: 0, character: 13 },
        });
        expect(error.message).toContain('the next line runs as a separate command');
    });

    it('says what happens under #delimit ;', () => {
        const [error] = no_space_errors('local a b///\nc;', 'semicolon');
        expect(error.message).toContain('stay in the command');
    });

    it('is reported after a quote, a parenthesis, and a macro', () => {
        for (const my_source of ['di "x"///', 'gen y = (x)///', "local a `x'///"]) {
            expect(no_space_errors(my_source)).toHaveLength(1);
        }
    });

    it('is not reported for a spaced ///, a tight //, or text in strings', () => {
        for (const my_source of [
            'local a b ///\nc', 'local a b\t///', 'use http://h/d', 'di 4//2',
            'local a "b///"', 'local a b /* x/// */', '* note///', '// x///',
            'mata:\nx = 4///2\nend',
        ]) {
            expect(no_space_errors(my_source)).toEqual([]);
        }
    });

    it('is a warning, whatever styleWarnings says', async () => {
        const document_store = new DocumentStore();
        const provider = new DiagnosticsProvider({ sendDiagnostics: () => {} } as any);
        const config: StataLSPConfig = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                severity: { ...DEFAULT_SETTINGS.diagnostics.severity, styleWarnings: 'off' },
            },
        };
        const uri = 'file:///tight-slashes.do';
        await document_store.open(uri, 'local a b///\ndisplay 1\n', 1);
        const the_diagnostics = await provider.get_diagnostics(
            document_store.get(uri)!, config);
        expect(the_diagnostics
            .filter((d) => d.code === LexerErrorCode.CONTINUATION_NO_SPACE)
            .map((d) => ({ severity: d.severity, range: d.range })))
            .toEqual([{
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: { line: 0, character: 9 },
                    end: { line: 0, character: 12 },
                },
            }]);
    });
});

describe('is_program_definition_header with a // after code', () => {
    it('finds a plugin option after a URL', () => {
        // `//` right after `http:` is text, so it hides nothing after it.
        expect(is_program_definition_header(
            ' hello, using(http://h/hello.so) plugin')).toBe(false);
        expect(is_program_definition_header(' hello // , plugin')).toBe(true);
    });
});

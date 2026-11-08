/**
 * Find-references for variables used inside factor-variable terms and
 * coefficient references. The lexer splits `i.foo` into WORD `i` and
 * WORD `.foo`; references must report `foo` at the name's own range.
 */

import { describe, it, expect } from 'bun:test';
import { Location, Position } from 'vscode-languageserver';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { Token } from '../../src/types';
import { ContextTracker } from '../../src/context-tracker';

function create_document(
    content: string,
    uri: string = 'file:///factor.do'
): DocumentState {
    const lex_result = new StataLexer().tokenize(content);
    const parse_result = new StataParser().parse(lex_result.tokens);
    const analysis_result = new SemanticAnalyzer().analyze(
        parse_result.ast, uri, undefined, undefined, lex_result.tokens
    );
    const context_tracker = new ContextTracker();
    context_tracker.initialize_from_tokens(lex_result.tokens, content);
    // Line buckets as the document store builds them, so the cursor
    // lookup takes the production path.
    const token_line_index = new Map<number, Token[]>();
    for (const my_token of lex_result.tokens) {
        const my_line = my_token.range.start.line;
        const bucket = token_line_index.get(my_line) ?? [];
        bucket.push(my_token);
        token_line_index.set(my_line, bucket);
    }
    return {
        uri,
        version: 1,
        content,
        tokens: lex_result.tokens,
        ast: parse_result.ast,
        symbols: analysis_result.symbols,
        scopes: analysis_result.scopes,
        diagnostics: [],
        context_ranges: context_tracker.get_all_context_ranges(),
        context_tracker,
        line_offsets: lex_result.line_offsets,
        forward_calls: analysis_result.forward_calls,
        token_line_index,
        ignored_lines: analysis_result.ignored_lines,
    };
}

function format_locations(locations: Location[]): string[] {
    return locations
        .map((my_location) => {
            const { start, end } = my_location.range;
            return `${start.line}:${start.character}-${end.line}:${end.character}`;
        })
        .sort();
}

const CONTENT = [
    'gen foo = 1',                                   // 0
    'gen bar = 2',                                   // 1
    'regress y i.foo c.foo',                         // 2
    'regress y ib3.foo##c.bar ibn.foo',              // 3
    'regress y ib(first).foo ib(last).foo',          // 4
    'regress y (i.foo c.bar)##c.foo c.bar#i.foo',    // 5
    'display _b[2.foo] _se[1.foo#c.bar] _b[foo]',    // 6
    'save results.foo, replace',                     // 7
    'regress y L2.foo',                              // 8
].join('\n');

// Every `foo` that names the variable, at the three-character range of
// the name itself (never the whole `i.foo` term). Line 7 is a file
// name, not a variable use.
const EXPECTED = [
    '0:4-0:7',
    '2:12-2:15', '2:18-2:21',
    '3:14-3:17', '3:29-3:32',
    '4:20-4:23', '4:33-4:36',
    '5:13-5:16', '5:27-5:30', '5:39-5:42',
    '6:13-6:16', '6:24-6:27', '6:38-6:41',
    '8:13-8:16',
].sort();

describe('References Provider - factor-variable terms', () => {
    const provider = new ReferencesProvider();
    const document = create_document(CONTENT);

    it('finds variable uses inside factor terms and _b[]/_se[]', async () => {
        const position: Position = { line: 0, character: 5 };
        const results = await provider.get_references(
            document, position, { includeDeclaration: true }
        );
        expect(format_locations(results)).toEqual(EXPECTED);
    });

    it('finds the same uses from a cursor inside i.foo', async () => {
        const position: Position = { line: 2, character: 13 };
        const results = await provider.get_references(
            document, position, { includeDeclaration: true }
        );
        expect(format_locations(results)).toEqual(EXPECTED);
    });

    it('reports interaction partners at their own names', async () => {
        const position: Position = { line: 1, character: 5 };
        const results = await provider.get_references(
            document, position, { includeDeclaration: true }
        );
        expect(format_locations(results)).toEqual([
            '1:4-1:7',
            '3:21-3:24',
            '5:19-5:22', '5:33-5:36',
            '6:30-6:33',
        ].sort());
    });
});

describe('References Provider - single-letter factor operands', () => {
    // `.x` lexes as an extended missing value (NUMBER), not a WORD.
    const provider = new ReferencesProvider();
    const document = create_document([
        'gen x = 1',                                     // 0
        'regress y i.x ib3.x ib(first).x c.x#c.x',       // 1
        'display _b[2.x]',                               // 2
        'replace y = .x',                                // 3
    ].join('\n'));
    // Line 3's `.x` is a missing value, not a use of `x`.
    const expected = [
        '0:4-0:5',
        '1:12-1:13', '1:18-1:19', '1:30-1:31', '1:34-1:35', '1:38-1:39',
        '2:13-2:14',
    ].sort();

    it('finds i.x, ib3.x, ib(first).x, c.x#c.x and _b[2.x]', async () => {
        const results = await provider.get_references(
            document, { line: 0, character: 4 }, { includeDeclaration: true }
        );
        expect(format_locations(results)).toEqual(expected);
    });

    it('finds the same uses from a cursor inside i.x', async () => {
        const results = await provider.get_references(
            document, { line: 1, character: 12 }, { includeDeclaration: true }
        );
        expect(format_locations(results)).toEqual(expected);
    });
});

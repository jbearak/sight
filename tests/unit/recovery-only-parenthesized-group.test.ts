import { describe, expect, test } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/command-database';
import { SymbolProvider } from '../../src/providers/symbols';
import { LanguageContext, type StataAST, type SymbolTable, type Token } from '../../src/types';

interface ParsedDocument {
    uri: string;
    content: string;
    tokens: Token[];
    ast: StataAST;
    symbols: SymbolTable;
    scopes: ReturnType<SemanticAnalyzer['analyze']>['scopes'];
    line_offsets: number[];
}

function parse_analyze(source: string): ParsedDocument {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexed = lexer.tokenize(source);
    const parsed = parser.parse(lexed.tokens);
    const result = analyzer.analyze(
        parsed.ast,
        'file:///recovery-only.do',
        undefined,
        { undefined_variable_enabled: true },
        lexed.tokens
    );

    return {
        uri: 'file:///recovery-only.do',
        content: source,
        tokens: lexed.tokens,
        ast: parsed.ast,
        symbols: result.symbols,
        scopes: result.scopes,
        line_offsets: lexed.line_offsets,
    };
}

function as_document_state(parsed: ParsedDocument) {
    return {
        uri: parsed.uri,
        content: parsed.content,
        version: 1,
        tokens: parsed.tokens,
        ast: parsed.ast,
        symbols: parsed.symbols,
        scopes: parsed.scopes,
        diagnostics: [],
        context_ranges: [],
        line_offsets: parsed.line_offsets,
        language_context: LanguageContext.STATA,
    };
}

describe('recovery-only parenthesized varlist opener', () => {
    const cases = [
        {
            label: 'cr',
            source: (command: string) => `${command} (\ndisplay `,
            completion_position: { line: 1, character: 'display '.length },
        },
        {
            label: 'semicolon',
            source: (command: string) => `#delimit ;\n${command} (\n;\ndisplay `,
            completion_position: { line: 3, character: 'display '.length },
        },
    ];

    for (const my_case of cases) {
        test(`analyzer ignores bare opener definitions in ${my_case.label} mode`, () => {
            const input = parse_analyze(my_case.source('input'));
            expect(input.symbols.variables.has('(')).toBe(false);

            const gen = parse_analyze(my_case.source('gen'));
            expect(gen.symbols.variables.has('(')).toBe(false);

            const scalar = parse_analyze(my_case.source('scalar'));
            expect(scalar.symbols.scalars.has('(')).toBe(false);
        });

        test(`completion does not offer bare opener symbols in ${my_case.label} mode`, async () => {
            for (const command of ['input', 'gen', 'scalar']) {
                const parsed = parse_analyze(my_case.source(command));
                const provider = new CompletionProvider(new CommandDatabase());
                const completions = await provider.get_completions(
                    as_document_state(parsed),
                    my_case.completion_position
                );
                expect(completions.map(c => c.label)).not.toContain('(');
            }
        });

        test(`document symbols do not include bare opener symbols in ${my_case.label} mode`, () => {
            for (const command of ['gen', 'scalar']) {
                const parsed = parse_analyze(my_case.source(command));
                const symbols = new SymbolProvider().get_document_symbols(
                    as_document_state(parsed)
                );
                expect(symbols.map(s => s.name)).not.toContain('(');
            }
        });
    }
});

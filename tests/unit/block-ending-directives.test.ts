import { describe, expect, test } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

// A comment on its own line just before a block closer is now owned by the
// block's blockEndingTrivia (issue #304). Its directive semantics must be
// unchanged from before the move: a standalone @lsp-ignore / @lsp-ignore-next
// suppresses the statement AFTER the block (the node that held the comment as
// leading trivia before #304), never the block header; @lsp-variables declares
// the variable keyed to its own line. The token path stays authoritative in
// production; these AST-fallback assertions also run the no-tokens path.
function analyze(source: string, opts?: { with_tokens?: boolean }) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const { tokens } = lexer.tokenize(source);
    const { ast } = parser.parse(tokens);
    const config = {
        undefined_macro_enabled: true,
        undefined_variable_enabled: true,
    };
    return analyzer.analyze(
        ast,
        'file:///test.do',
        undefined,
        config,
        opts?.with_tokens === false ? undefined : tokens
    );
}

function warnings_for(source: string, name: string, opts?: { with_tokens?: boolean }) {
    return analyze(source, opts).diagnostics.filter(d => d.message.includes(name));
}

describe('block-ending comment directives', () => {
    // Lines: 0 `if 1 {`, 1 `gen y = 1`, 2 directive, 3 `}`, 4 following stmt.
    const ignore_next =
        'if 1 {\n    gen y = 1\n    // @lsp-ignore-next\n}\nlist missing_var\n';
    const ignore =
        'if 1 {\n    gen y = 1\n    // @lsp-ignore\n}\nlist missing_var\n';

    test('@lsp-ignore-next before a closer suppresses the statement after the block, not the header', () => {
        for (const with_tokens of [true, false]) {
            const result = analyze(ignore_next, { with_tokens });
            expect(result.ignored_lines.has(4)).toBe(true); // list missing_var
            expect(result.ignored_lines.has(0)).toBe(false); // if header
            expect(
                result.diagnostics.filter(d => d.message.includes('missing_var'))
            ).toHaveLength(0);
        }
    });

    test('standalone @lsp-ignore before a closer also targets the following statement', () => {
        for (const with_tokens of [true, false]) {
            const result = analyze(ignore, { with_tokens });
            expect(result.ignored_lines.has(4)).toBe(true);
            expect(result.ignored_lines.has(0)).toBe(false);
        }
    });

    test('block-ending @lsp-ignore-next on the last child of nested blocks targets the statement after all closers', () => {
        // Lines: 0 `if 1 {`, 1 `while 1 {`, 2 `display 1`, 3 directive,
        // 4 `}`, 5 `}`, 6 `list missing_var`. The while block is the last child
        // of the if block, so the directive must reach line 6 (the statement
        // after both closers), matching pre-#304 forward-flow behavior.
        const source =
            'if 1 {\n    while 1 {\n        display 1\n        // @lsp-ignore-next\n    }\n}\nlist missing_var\n';
        for (const with_tokens of [true, false]) {
            const result = analyze(source, { with_tokens });
            expect(result.ignored_lines.has(6)).toBe(true);
            expect(
                result.diagnostics.filter(d => d.message.includes('missing_var'))
            ).toHaveLength(0);
        }
    });

    test('block-ending directive recurses through a prefix brace-command block', () => {
        // capture { if 1 { ... // @lsp-ignore-next } } / list missing_var
        // Lines: 0 capture {, 1 if 1 {, 2 display 1, 3 directive, 4 }, 5 }, 6 stmt.
        const source =
            'capture {\n    if 1 {\n        display 1\n        // @lsp-ignore-next\n    }\n}\nlist missing_var\n';
        for (const with_tokens of [true, false]) {
            const result = analyze(source, { with_tokens });
            expect(result.ignored_lines.has(6)).toBe(true);
            expect(
                result.diagnostics.filter(d => d.message.includes('missing_var'))
            ).toHaveLength(0);
        }
    });

    test('block-ending directive recurses through a frame block', () => {
        // frame scratch { if 1 { ... // @lsp-ignore-next } list missing_var }
        // Lines: 0 frame {, 1 if {, 2 display, 3 directive, 4 }, 5 list, 6 }.
        const source =
            'frame scratch {\n    if 1 {\n        display 1\n        // @lsp-ignore-next\n    }\n    list missing_var\n}\n';
        for (const with_tokens of [true, false]) {
            const result = analyze(source, { with_tokens });
            expect(result.ignored_lines.has(5)).toBe(true);
            expect(
                result.diagnostics.filter(d => d.message.includes('missing_var'))
            ).toHaveLength(0);
        }
    });

    test('@lsp-variables before a closer suppresses the later undefined-variable warning', () => {
        const with_directive =
            'if 1 {\n    display 1\n    // @lsp-variables income_usd\n}\nlist income_usd\n';
        const without_directive = 'if 1 {\n    display 1\n}\nlist income_usd\n';
        expect(warnings_for(without_directive, 'income_usd')).not.toHaveLength(0);
        expect(warnings_for(with_directive, 'income_usd')).toHaveLength(0);
        // AST fallback (no tokens) also honors it.
        expect(
            warnings_for(with_directive, 'income_usd', { with_tokens: false })
        ).toHaveLength(0);
    });
});

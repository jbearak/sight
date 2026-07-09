import { describe, expect, test } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

// The analyzer must still honor range-based comment directives when they sit
// immediately before a block closer and are therefore owned by the block's
// blockEndingTrivia (issue #304). @lsp-ignore-next is intentionally left to the
// authoritative token path: resolving it through the block node would wrongly
// suppress the block header rather than the next statement.
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

function variable_warnings(source: string, name: string, opts?: { with_tokens?: boolean }) {
    return analyze(source, opts).diagnostics.filter(d =>
        d.message.includes(name)
    );
}

describe('block-ending comment directives', () => {
    const with_directive =
        'if 1 {\n    display 1\n    // @lsp-variables income_usd\n}\nlist income_usd\n';
    const without_directive = 'if 1 {\n    display 1\n}\nlist income_usd\n';

    test('@lsp-variables before a closer suppresses the later undefined-variable warning', () => {
        expect(variable_warnings(without_directive, 'income_usd')).not.toHaveLength(0);
        expect(variable_warnings(with_directive, 'income_usd')).toHaveLength(0);
    });

    test('@lsp-variables before a closer works via the AST fallback (no tokens)', () => {
        expect(
            variable_warnings(with_directive, 'income_usd', { with_tokens: false })
        ).toHaveLength(0);
    });

    test('@lsp-ignore before a closer targets its own line, never the block header', () => {
        // Exercise the AST fallback (no tokens) so parse_block_ending_directive
        // is the code under test. The block header (line 0) must NOT be
        // suppressed; only the comment's own line (line 2) is ignored.
        const result = analyze(
            'if 1 {\n    display 1\n    // @lsp-ignore\n}\n',
            { with_tokens: false }
        );
        expect(result.ignored_lines.has(0)).toBe(false);
        expect(result.ignored_lines.has(2)).toBe(true);
    });
});

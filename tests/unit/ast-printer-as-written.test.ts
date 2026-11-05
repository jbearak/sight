/**
 * AST formatting changed three things it should print as written:
 *
 * - A Mata or Python block's first content line lost its indentation,
 *   because the parser trimmed the block's content. Python reads
 *   indentation as code, and StataMP 18 runs indented Mata as written.
 * - `else if` came out as `else {` with the `if` inside it.
 * - Under `#delimit ;`, a `//` comment after a statement's last line and
 *   before its `;` (`local a b // c` then `d // e` then `;`) moved after
 *   the `;` on a second pass. The parser now marks trailing comments that
 *   come before the `;`, so the printer keeps them there.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    mode_specific_assertion,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

function parse(my_source: string) {
    return new StataParser().parse(new StataLexer().tokenize(my_source).tokens);
}

const formatter = new CodeFormatter();

function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
    const the_edits = formatter.format(
        create_document_state(my_source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(my_mode)
    );
    return the_edits.length > 0 ? the_edits[0].newText : my_source;
}

describe('embedded block content keeps its indentation', () => {
    it('keeps the first content line indented in the node', () => {
        const my_node = parse('mata:\n    x = 1\n        y = 2\nend\n').ast.nodes[0];
        expect(my_node?.type === 'embedded_block' && my_node.content)
            .toBe('    x = 1\n        y = 2');
    });

    const SOURCES = [
        'mata:\n    x = 1\n        y = 2\n    printf("%g", x)\nend\n',
        'if 1 {\n    mata:\n        z = 1\n            w = 2\n    end\n}\n',
        'python:\n    import os\nend\n',
        'mata: x = 1\n',
    ];

    for (const my_source of SOURCES) {
        for_each_formatter_mode(`leaves ${JSON.stringify(my_source)} unchanged`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_source);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        });
    }
});

describe('else if', () => {
    it('marks else if in the AST', () => {
        const my_node = parse('if 0 {\n}\nelse if 1 {\n}\n').ast.nodes[1];
        expect(my_node?.type === 'else' && my_node.is_else_if).toBe(true);
        const my_brace_else = parse('if 0 {\n}\nelse {\n    if 1 {\n    }\n}\n').ast.nodes[1];
        expect(my_brace_else?.type === 'else' && my_brace_else.is_else_if).toBeUndefined();
    });

    const SOURCE = [
        'if 0 {',
        '    di 1',
        '}',
        'else if 1 {',
        '    di 2',
        '}',
        'else if 2 di 3',
        'else /* c */ if 3 {',
        '    di 4',
        '} // t',
        'else {',
        '    if 4 {',
        '        di 5',
        '    }',
        '}',
        '',
    ].join('\n');

    for_each_formatter_mode('keeps else if as written', (my_mode) => {
        const my_once = format_text(SOURCE, my_mode);
        expect(my_once).toBe(SOURCE);
        expect(format_text(my_once, my_mode)).toBe(my_once);
    });

    for_each_formatter_mode('indents the body of else if', (my_mode) => {
        const my_once = format_text('if 0 {\n}\nelse if 1 {\ndi 2\n}\n', my_mode);
        expect(my_once).toBe('if 0 {\n}\nelse if 1 {\n    di 2\n}\n');
    });
});

describe('comments before the ; under #delimit ;', () => {
    it('marks trailing comments before the ; but not after it', () => {
        const my_source = '#delimit ;\nlocal a b // c\n    d // e\n;\n// f\n';
        const my_node = parse(my_source).ast.nodes[1];
        expect(my_node?.type).toBe('macro_def');
        expect((my_node?.type === 'macro_def' ? my_node.trailingTrivia ?? [] : [])
            .map((my_trivia) => [my_trivia.content, my_trivia.before_terminator ?? false]))
            .toEqual([['// e', true], ['// f', false]]);
    });

    const CASES: Array<[string, string]> = [
        [
            '#delimit ;\nlocal a b // c\n    d // e\n;\n#delimit cr\n',
            '#delimit ;\nlocal a b d // c\n    // e\n;\n#delimit cr\n',
        ],
        [
            '#delimit ;\nglobal g "x" // c\n    "y" // d\n    ;\n#delimit cr\n',
            '#delimit ;\nglobal g "x" "y" // c\n    // d\n;\n#delimit cr\n',
        ],
    ];

    for (const [my_source, my_expected] of CASES) {
        for_each_formatter_mode(
            `keeps the comments of ${JSON.stringify(my_source)} before the ;`,
            (my_mode) => {
                const my_once = format_text(my_source, my_mode);
                // Source-preserving formatting leaves these lines as they are
                mode_specific_assertion(my_mode, {
                    'ast': () => expect(my_once).toBe(my_expected),
                    'source-preserving': () => expect(my_once).toBe(my_source),
                });
                expect(format_text(my_once, my_mode)).toBe(my_once);
            }
        );
    }
});

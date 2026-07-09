import { describe, expect } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from './helpers/document-utils';
import {
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
    create_formatter_config,
    for_each_formatter_mode,
} from './helpers/formatter-test-utils';

function format_source(source: string, mode: FormatterMode): string {
    const formatter = new CodeFormatter();
    const document = create_document_state(source);
    const edits = formatter.format(
        document,
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(mode)
    );
    return edits.length > 0 ? edits[0].newText : source;
}

function expect_comment_inside_block(
    formatted: string,
    comment: string,
    closer: string = '}'
): void {
    const lines = formatted.split('\n');
    const comment_index = lines.findIndex(line => line.trim() === comment);
    const closer_index = lines.findIndex(
        (line, index) => index > comment_index && line.trim() === closer
    );

    expect(comment_index).toBeGreaterThan(-1);
    expect(closer_index).toBeGreaterThan(comment_index);
    expect(lines[comment_index]).toBe(`    ${comment}`);
}

describe('formatter block-ending trivia placement', () => {
    for_each_formatter_mode(
        'keeps a block-ending comment at body indentation before close brace',
        (mode: FormatterMode) => {
            const source = 'if 1 {\ndisplay 1\n* keep\n}\n';
            const formatted = format_source(source, mode);

            expect_comment_inside_block(formatted, '* keep');
        }
    );

    for_each_formatter_mode(
        'is idempotent for cr-delimit block-ending comments',
        (mode: FormatterMode) => {
            const source = 'while 1 {\ndisplay 1\n* keep\n}\n';
            const formatted = format_source(source, mode);
            const reformatted = format_source(formatted, mode);

            expect(reformatted).toBe(formatted);
        }
    );

    for_each_formatter_mode(
        'keeps a program-ending comment at body indentation before end',
        (mode: FormatterMode) => {
            const source = 'program define p\ndisplay 1\n* keep\nend\n';
            const formatted = format_source(source, mode);

            expect_comment_inside_block(formatted, '* keep', 'end');
        }
    );

    for_each_formatter_mode(
        'keeps a prefix brace-block comment at body indentation before close brace',
        (mode: FormatterMode) => {
            const source = 'capture {\ndisplay 1\n* keep\n}\n';
            const formatted = format_source(source, mode);

            expect_comment_inside_block(formatted, '* keep');
        }
    );

    for_each_formatter_mode(
        'places semicolon-delimit block-ending comments inside the block',
        (mode: FormatterMode) => {
            const source = '#delimit ;\nif 1 {;\ndisplay 1;\n* keep\n};\n#delimit cr';
            const formatted = format_source(source, mode);

            expect_comment_inside_block(formatted, '* keep', '};');
        }
    );
});

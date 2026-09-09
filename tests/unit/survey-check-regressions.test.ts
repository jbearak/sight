import { describe, expect, test } from 'bun:test';
import { create_document_state } from '../property/helpers/document-utils';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    for_each_formatter_mode,
    create_formatter_config,
} from '../property/helpers/formatter-test-utils';
import { StataDiagnosticCode } from '../../src/types';

function macro_diagnostics(source: string) {
    return create_document_state(source).diagnostics.filter(my_diagnostic =>
        my_diagnostic.code === StataDiagnosticCode.INVALID_MACRO_CHAR ||
        my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
    );
}

describe('continued command options', () => {
    for (const my_command of [
        'collapse (sum) women',
        'unab names : women',
        'frame data: unab names : women',
    ]) {
        test(`${my_command} keeps continued options in the command`, () => {
            const my_document = create_document_state(
                `${my_command}, ///\n    by(survey) ///\n    fast\ndisplay 1\n`
            );
            expect(my_document.diagnostics.filter(my_diagnostic =>
                my_diagnostic.code === StataDiagnosticCode.SYNTAX_ERROR
            )).toEqual([]);
            const the_commands = my_document.ast.nodes;
            expect(the_commands).toHaveLength(2);
            expect(the_commands[0].type).toBe('command');
            if (the_commands[0].type !== 'command') return;
            expect(the_commands[0].options?.map(my_option =>
                [my_option.name, my_option.argument]
            )).toEqual([['by', 'survey'], ['fast', undefined]]);
        });
    }

    test('a literal semicolon after continuation ends the options', () => {
        const my_document = create_document_state(
            '#delimit ;\ncollapse (sum) women, fast ///\n;\ndisplay 1;\n'
        );
        const the_commands = my_document.ast.nodes.filter(my_node =>
            my_node.type === 'command'
        );
        expect(the_commands.map(my_node => my_node.name))
            .toEqual(['collapse', 'display']);
        expect(the_commands[0].options?.map(my_option => my_option.name))
            .toEqual(['fast']);
    });
});

for_each_formatter_mode('preserves continued options when formatting', mode => {
    const my_source =
        'collapse (sum) women, ///\n    by(survey) ///\n    fast\ndisplay 1\n';
    const the_edits = new CodeFormatter().format(
        create_document_state(my_source),
        { tabSize: 4, insertSpaces: true },
        create_formatter_config(mode)
    );
    const my_formatted = the_edits[0]?.newText ?? my_source;
    const the_commands = create_document_state(my_formatted).ast.nodes
        .filter(my_node => my_node.type === 'command');
    expect(the_commands.map(my_node => my_node.name))
        .toEqual(['collapse', 'display']);
    expect(the_commands[0].options?.map(my_option =>
        [my_option.name, my_option.argument]
    )).toEqual([['by', 'survey'], ['fast', undefined]]);
});

describe('macval local expansion', () => {
    for (const my_reference of [
        "`macval(line)'",
        '`"`macval(line)\'"\'',
        '"`macval(line)\'"',
    ]) {
        test(`recognizes ${my_reference}`, () => {
            expect(macro_diagnostics(
                `local line "hello"\ndisplay ${my_reference}\n`
            )).toEqual([]);
        });
    }

    test('checks the underlying local name and preserves case', () => {
        const the_diagnostics = macro_diagnostics(
            'local Line "hello"\ndisplay `macval(line)\'\n'
        );
        expect(the_diagnostics).toHaveLength(1);
        expect(the_diagnostics[0].code).toBe(StataDiagnosticCode.UNDEFINED_MACRO);
        expect(the_diagnostics[0].message).toContain('line');
        expect(the_diagnostics[0].message).not.toContain('macval(');
    });

    test('keeps forward-reference and program-scope checks', () => {
        for (const my_source of [
            'display `macval(line)\'\nlocal line "hello"\n',
            'local line "hello"\nprogram define example\n' +
                'display `macval(line)\'\nend\n',
        ]) {
            const the_diagnostics = macro_diagnostics(my_source);
            const the_plain_diagnostics = macro_diagnostics(
                my_source.replace('macval(line)', 'line')
            );
            expect(the_diagnostics.map(my_diagnostic =>
                [my_diagnostic.code, my_diagnostic.message]
            )).toEqual(the_plain_diagnostics.map(my_diagnostic =>
                [my_diagnostic.code, my_diagnostic.message]
            ));
        }
    });

    test('recognizes a local populated by file read', () => {
        expect(macro_diagnostics(
            'tempname handle\nfile read `handle\' line\n' +
            'if (strpos(`"`macval(line)\'"\', "do ") == 1) {\n' +
            '    local survey = substr(`"`macval(line)\'"\', 21, .)\n}\n'
        )).toEqual([]);
    });

    test('recognizes macval in extended function arguments', () => {
        expect(macro_diagnostics(
            'local line "hello"\nlocal size : length `macval(line)\'\n'
        )).toEqual([]);
    });

    for (const my_content of [
        'Macval(line)', 'macval(line.bad)', 'macval(line',
        'macval(line)extra', 'other(line)',
    ]) {
        test(`still rejects ${my_content}`, () => {
            expect(macro_diagnostics(
                `local line "hello"\ndisplay \`${my_content}'\n`
            ).some(my_diagnostic =>
                my_diagnostic.code === StataDiagnosticCode.INVALID_MACRO_CHAR
            )).toBe(true);
        });
    }
});

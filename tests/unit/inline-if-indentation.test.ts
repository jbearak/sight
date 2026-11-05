import { describe, expect, it } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { StataDiagnosticCode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    for_each_formatter_mode,
} from '../property/helpers/formatter-test-utils';
import {
    expect_line_at_depth,
    indentation_diagnostics,
} from '../property/helpers/indentation-test-utils';

describe('single-statement if indentation diagnostics', () => {
    it('keeps multiline inline bodies at the condition depth', () => {
        // Under `#delimit ;` lines 1-3 are one statement: a
        // single-statement `if` opens no block, so the flush-left
        // layout is clean. Lines 2-3 are continuation lines, which
        // Format Document keeps where they sit relative to line 1, so
        // only the statement's first line is held to a block depth.
        const source = [
            '#delimit ;',
            'if (1)',
            'if (2)',
            'local selected yes;',
            '#delimit cr',
            '',
        ].join('\n');
        expect(indentation_diagnostics(source)).toEqual([]);
        expect_line_at_depth(source, 1, 0);
    });

    const the_sources = [
        '#delimit ;\nif 1 if 2 {;\nlocal x yes;\n};\n#delimit cr\n',
        '#delimit ;\nif (1)\n    local x yes;\n#delimit cr\n',
        '#delimit ;\nif (1)\nif (2)\n    local x yes;\n#delimit cr\n',
        [
            '#delimit ;',
            'program define example;',
            'if (1) {;',
            'if (2)',
            'local x yes;',
            '};',
            'end;',
            '#delimit cr',
            '',
        ].join('\n'),
    ];
    for (const [i, my_source] of the_sources.entries()) {
        for_each_formatter_mode(`resolves inline indentation case ${i}`, mode => {
            const config = create_formatter_config(mode);
            config.diagnostics = { ...config.diagnostics, indentation: true };
            const analyzer = new IndentationDiagnosticAnalyzer();
            const formatter = new CodeFormatter();
            const document = create_document_state(my_source);
            const edits = formatter.format(
                document, { tabSize: 4, insertSpaces: true }, config
            );
            const formatted = edits[0]?.newText ?? my_source;
            expect(analyzer.analyze(
                create_document_state(formatted), config
            )).toEqual([]);
        });
    }

    it('still diagnoses missing indentation inside a brace block', () => {
        const source = [
            '#delimit ;',
            'if (1) {;',
            'if (2)',
            'local x yes;',
            '};',
            '#delimit cr',
            '',
        ].join('\n');
        const config = create_formatter_config('source-preserving');
        config.diagnostics = { ...config.diagnostics, indentation: true };
        const diagnostics = new IndentationDiagnosticAnalyzer().analyze(
            create_document_state(source), config
        );
        const the_missing_lines = diagnostics.filter(my_diagnostic =>
            my_diagnostic.code === StataDiagnosticCode.MISSING_INDENTATION
        ).map(my_diagnostic => my_diagnostic.range.start.line);
        expect(the_missing_lines).toContain(2);
        expect(the_missing_lines).toContain(3);
    });
});

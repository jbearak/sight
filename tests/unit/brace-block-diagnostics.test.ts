/**
 * Brace placement as StataMP 18 reads it, through the diagnostics
 * provider (the default editor experience).
 *
 * A standalone `{ ... }` block is valid: Stata runs one at the top
 * level, in a program, after another block, nested, in a loop, and
 * under `#delimit ;`, and a local defined in it stays defined after
 * it. Sight reported each as OPEN_BRACE_ALONE.
 *
 * A block header with no `{` stops Stata with "{ required" (r(100)):
 * `if x` alone (no command), `else if x` alone, and `foreach`,
 * `forvalues`, or `while` with no `{` at the end of the line, even with
 * a command after it; under `#delimit ;` the same with `;` for the end
 * of the line; and after `capture`, which sets `_rc` to 100. Sight said
 * nothing; it now reports MISSING_OPEN_BRACE, or OPEN_BRACE_ALONE on
 * the `{` when the next statement is one.
 *
 * A bare `else` is valid: it is a statement of its own, so a `{` on
 * the next line runs whatever the `if` found. Likewise `capture` or
 * `quietly` alone runs the next line's block without the prefix. Those
 * keep OPEN_BRACE_ALONE.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { CodeFormatter } from '../../src/providers/formatter';
import { ParseErrorCode, StataLSPConfig } from '../../src/types';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

// The editor's default settings.
const CONFIG: StataLSPConfig = DEFAULT_SETTINGS;

const BRACE_CODES = new Set<string>([
    ParseErrorCode.OPEN_BRACE_ALONE,
    ParseErrorCode.MISSING_OPEN_BRACE,
]);

interface BraceDiagnostic {
    code: string;
    line: number;
    severity: DiagnosticSeverity | undefined;
}

let document_count = 0;

/** The OPEN_BRACE_ALONE and MISSING_OPEN_BRACE diagnostics for `my_source`. */
async function brace_diagnostics(my_source: string): Promise<BraceDiagnostic[]> {
    const my_store = new DocumentStore();
    const my_provider = new DiagnosticsProvider({ sendDiagnostics: () => {} });
    const my_uri = `file:///brace-${document_count++}.do`;
    await my_store.open(my_uri, my_source, 1);
    const my_document = my_store.get(my_uri);
    if (my_document === undefined) {
        throw new Error('document did not open');
    }
    const the_diagnostics = await my_provider.get_diagnostics(my_document, CONFIG);
    return the_diagnostics
        .filter((my_diag) => BRACE_CODES.has(String(my_diag.code)))
        .map((my_diag) => ({
            code: String(my_diag.code),
            line: my_diag.range.start.line,
            severity: my_diag.severity,
        }));
}

const ERROR = DiagnosticSeverity.Error;

beforeAll(() => {
    initialize_builtin_commands();
});

describe('a standalone brace block is valid Stata', () => {
    const VALID_SOURCES: Array<[string, string]> = [
        ['at the top level', 'di "start"\n{\n    di "in block"\n}\ndi "after"\n'],
        ['in a program', 'program p\n    {\n        di "in"\n    }\nend\n'],
        ['after another block', 'if 1 {\n    di 1\n}\n{\n    di 2\n}\n'],
        ['nested', '{\n    {\n        di "nested"\n    }\n    local x 5\n}\n'],
        ['in a loop', 'forvalues i = 1/2 {\n    {\n        di `i\'\n    }\n}\n'],
        ['under #delimit ;', '#delimit ;\n{ ;\ndi "x" ;\n} ;\n#delimit cr\n'],
        ['after a comment', '/* c */ {\n    di 1\n}\n'],
        ['after an if continued with ///', 'if 1 ///\n{\n    di 1\n}\n'],
        ['after a bare else and a command', 'if 1 {\n}\nelse\ndi 1\n'],
        ['after an if with a command', 'if 1 di 1\n{\n    di 2\n}\n'],
    ];
    for (const [my_name, my_source] of VALID_SOURCES) {
        it(`reports nothing ${my_name}`, async () => {
            expect(await brace_diagnostics(my_source)).toEqual([]);
        });
    }
});

describe('a block header with no {', () => {
    const MISSING_SOURCES: Array<[string, string, number]> = [
        ['if alone', 'local x 1\nif `x\'\ndi "after"\n', 1],
        ['if alone at the end of the file', 'if 1\n', 0],
        ['if with a comment', 'if 1 // c\ndi "after"\n', 0],
        ['nested if alone', 'if 1 if 1\ndi "after"\n', 0],
        ['else if alone', 'if 0 {\n}\nelse if 1\ndi "after"\n', 2],
        ['foreach in', 'foreach v in a b\ndi "after"\n', 0],
        ['foreach of', 'foreach v of local x\ndi "after"\n', 0],
        ['foreach with a command', 'foreach v in a b di "x"\n', 0],
        ['forvalues', 'forvalues i = 1/3\ndi "after"\n', 0],
        ['forvalues with a command', 'forvalues i = 1/3 di "x"\n', 0],
        ['while', 'local i 0\nwhile `i\' < 3\ndi "after"\n', 1],
        ['while with a command', 'while 0 di "x"\n', 0],
        ['capture if', 'capture if 1\ndi _rc\n', 0],
        ['capture foreach', 'capture foreach v in a b\ndi _rc\n', 0],
        ['quietly if', 'quietly if 1\ndi "after"\n', 0],
        ['if in a program', 'program p\n    if 1\n    di "in"\nend\n', 1],
        ['if under #delimit ;', '#delimit ;\nif 1 ;\ndi "after" ;\n', 1],
        ['foreach under #delimit ;', '#delimit ;\nforeach v in a b ;\ndi "after" ;\n', 1],
        ['forvalues under #delimit ;', '#delimit ;\nforvalues i = 1/3 ;\n', 1],
        ['while under #delimit ;', '#delimit ;\nwhile 0 ;\ndi "after" ;\n', 1],
    ];
    for (const [my_name, my_source, my_line] of MISSING_SOURCES) {
        it(`reports MISSING_OPEN_BRACE for ${my_name}`, async () => {
            expect(await brace_diagnostics(my_source)).toEqual([
                { code: ParseErrorCode.MISSING_OPEN_BRACE, line: my_line, severity: ERROR },
            ]);
        });
    }

    it('reports nothing for an if with a command or a {', async () => {
        expect(await brace_diagnostics('if 1 di "single"\nif 1 {\n}\n')).toEqual([]);
    });

    it('reports nothing for a bare else', async () => {
        expect(await brace_diagnostics('if 0 {\n}\nelse\ndi "after"\n')).toEqual([]);
        expect(await brace_diagnostics('if 0 {\n}\nelse\n')).toEqual([]);
        expect(await brace_diagnostics('#delimit ;\nif 0 { ;\n} ;\nelse ;\ndi 1 ;\n'))
            .toEqual([]);
    });
});

describe('a { that starts the statement after one that needed it', () => {
    const ALONE_SOURCES: Array<[string, string, number]> = [
        ['if', 'if 1\n{\n    di "body"\n}\n', 1],
        ['if, after a blank line', 'if 1\n\n{\n}\n', 2],
        ['else if', 'if 0 {\n}\nelse if 1\n{\n    di "body"\n}\n', 3],
        ['foreach', 'foreach v in a b\n{\n    di "`v\'"\n}\n', 1],
        ['while', 'while 0\n{\n}\n', 1],
        ['else', 'if 1 {\n    di 0\n}\nelse\n{\n    di "always"\n}\n', 4],
        ['else with a comment', 'if 1 {\n}\nelse // c\n{\n    di "always"\n}\n', 3],
        ['capture', 'capture\n{\n    error 7\n}\n', 1],
        ['quietly', 'quietly\n{\n    di "shown"\n}\n', 1],
        ['if; under #delimit ;', '#delimit ;\nif 1 ;\n{ ;\ndi 1 ;\n} ;\n', 2],
        ['else; under #delimit ;', '#delimit ;\nif 1 { ;\n} ;\nelse ;\n{ ;\ndi 1 ;\n} ;\n', 4],
        ['capture; under #delimit ;', '#delimit ;\ncapture ;\n{ ;\nerror 7 ;\n} ;\n', 2],
        ['a command on its line', 'b {\n    di 1\n}\n', 0],
    ];
    for (const [my_name, my_source, my_line] of ALONE_SOURCES) {
        it(`reports OPEN_BRACE_ALONE after ${my_name}`, async () => {
            expect(await brace_diagnostics(my_source)).toEqual([
                { code: ParseErrorCode.OPEN_BRACE_ALONE, line: my_line, severity: ERROR },
            ]);
        });
    }

    it('accepts the { on the next line under #delimit ;', async () => {
        expect(await brace_diagnostics('#delimit ;\nif 1\n{ ;\ndi 1 ;\n} ;\n')).toEqual([]);
        expect(await brace_diagnostics('#delimit ;\nif 1 { ;\n} ;\nelse\n{ ;\n} ;\n'))
            .toEqual([]);
    });
});

describe('brace blocks: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    for_each_formatter_mode('indents a standalone block', (my_mode) => {
        const my_once = format_text('di 1\n{\ndi 3\n  {\n di 4\n }\n}\n', my_mode);
        expect(my_once).toBe('di 1\n{\n    di 3\n    {\n        di 4\n    }\n}\n');
        expect(format_text(my_once, my_mode)).toBe(my_once);
    });

    // Stata stops at `{ di 1` (r(198)); moving `di 1` to its own line
    // would make it run.
    for_each_formatter_mode('keeps code after a block\'s { on its line', (my_mode) => {
        for (const my_source of ['{ di "same"\n    di 2\n}\n', 'quietly { di "same"\n    di 2\n}\n']) {
            expect(format_text(my_source, my_mode)).toBe(my_source);
        }
    });

    // Printing the AST would turn the bare else into `else {` `}`.
    for_each_formatter_mode('keeps an else and the { after it apart', (my_mode) => {
        const my_source = 'if 1 {\n    di 0\n}\nelse\n{\n    di 1\n}\n';
        expect(format_text(my_source, my_mode)).toBe(my_source);
    });

    for_each_formatter_mode('keeps an if and the { after it apart', (my_mode) => {
        const my_source = 'if 1\n{\n    di 1\n}\n';
        expect(format_text(my_source, my_mode)).toBe(my_source);
    });
});

/**
 * `sight parse --json` reports each lexer and parser error with the
 * severity the editor shows for it. Walks every LexerErrorCode and
 * ParseErrorCode, so a new code that the two disagree on fails here.
 */

import { describe, expect, it } from 'bun:test';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import {
    lexer_error_entry,
    parser_error_entry,
    ParseErrorEntry,
} from '../../../src/cli/parse-json';
import { DiagnosticsProvider } from '../../../src/providers/diagnostics';
import { LexerErrorCode, ParseErrorCode } from '../../../src/types';
import { validate_comment_formatting_config } from
    '../../../src/utils/config-validator';

const RANGE = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
};

const SEVERITY_NAMES: Record<DiagnosticSeverity, ParseErrorEntry['severity']> = {
    [DiagnosticSeverity.Error]: 'error',
    [DiagnosticSeverity.Warning]: 'warning',
    [DiagnosticSeverity.Information]: 'information',
    [DiagnosticSeverity.Hint]: 'hint',
};

const provider = new DiagnosticsProvider({ sendDiagnostics: () => {} });
const config = validate_comment_formatting_config(undefined);

/** The severity name of an editor diagnostic, which must have one. */
function editor_severity(
    diagnostic: Diagnostic | null
): ParseErrorEntry['severity'] {
    expect(diagnostic?.severity).toBeDefined();
    return SEVERITY_NAMES[diagnostic?.severity ?? DiagnosticSeverity.Error];
}

describe('sight parse --json error severity', () => {
    for (const my_code of Object.values(LexerErrorCode)) {
        it(`matches the editor for lexer code ${my_code}`, () => {
            const my_error = { code: my_code, message: 'm', range: RANGE };
            const my_entry = lexer_error_entry(my_error);
            const my_diagnostic = provider['convert_lexer_error'](my_error);
            expect(my_entry.source).toBe('lexer');
            expect(my_entry.code).toBe(my_code);
            expect(my_entry.severity).toBe(editor_severity(my_diagnostic));
        });
    }

    for (const my_code of Object.values(ParseErrorCode)) {
        it(`matches the editor for parser code ${my_code}`, () => {
            const my_error = { code: my_code, message: 'm', range: RANGE };
            const my_entry = parser_error_entry(my_error);
            const my_diagnostic =
                provider['convert_parser_error'](my_error, config);
            expect(my_entry.source).toBe('parser');
            expect(my_entry.code).toBe(my_code);
            expect(my_entry.severity).toBe(editor_severity(my_diagnostic));
        });
    }

    it('reports CONTINUATION_NO_SPACE as a warning', () => {
        const my_entry = lexer_error_entry({
            code: LexerErrorCode.CONTINUATION_NO_SPACE,
            message: 'm',
            range: RANGE,
        });
        expect(my_entry.severity).toBe('warning');
    });

    it('reports SYNTAX_ERROR as an error', () => {
        const my_entry = parser_error_entry({
            code: ParseErrorCode.SYNTAX_ERROR,
            message: 'm',
            range: RANGE,
        });
        expect(my_entry.severity).toBe('error');
    });
});

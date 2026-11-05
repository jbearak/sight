/**
 * Helpers for testing indentation diagnostics through
 * `IndentationDiagnosticAnalyzer.analyze()` on fully lexed, parsed, and
 * analyzed documents.
 *
 * The analyzer reports a line exactly when Format Document (in
 * source-preserving mode) would re-indent it, so "line L belongs at
 * block depth d" is tested as: with L at d levels it draws no
 * diagnostic, one level deeper it draws UNNECESSARY_INDENTATION, and
 * one level shallower it draws MISSING_INDENTATION.
 */

import { expect } from 'bun:test';
import { Diagnostic } from 'vscode-languageserver';
import { IndentationDiagnosticAnalyzer } from '../../../src/providers/indentation-diagnostics';
import { DEFAULT_SETTINGS } from '../../../src/server-handlers';
import { StataDiagnosticCode, StataLSPConfig } from '../../../src/types';
import { create_document_state } from './document-utils';

const LEADING_BLANKS_RE = /^[ \t]*/;
const INDENTATION_CODES: ReadonlySet<Diagnostic['code']> = new Set<Diagnostic['code']>([
    StataDiagnosticCode.MISSING_INDENTATION,
    StataDiagnosticCode.UNNECESSARY_INDENTATION,
]);

const the_analyzer = new IndentationDiagnosticAnalyzer();

/** Default settings with indentation diagnostics enabled. */
export function create_indentation_config(indent_size: number = 4): StataLSPConfig {
    return {
        ...DEFAULT_SETTINGS,
        diagnostics: {
            ...DEFAULT_SETTINGS.diagnostics,
            enabled: true,
            indentation: true,
        },
        formatting: {
            ...DEFAULT_SETTINGS.formatting,
            indentSize: indent_size,
        },
    };
}

/** The indentation diagnostics `analyze()` reports for `source`. */
export function indentation_diagnostics(
    source: string,
    indent_size: number = 4
): Diagnostic[] {
    return the_analyzer
        .analyze(create_document_state(source), create_indentation_config(indent_size))
        .filter(my_diagnostic => INDENTATION_CODES.has(my_diagnostic.code));
}

/** The indentation diagnostic code reported on each line of `source`. */
export function indentation_codes_by_line(
    source: string,
    indent_size: number = 4
): Map<number, Diagnostic['code']> {
    const the_codes = new Map<number, Diagnostic['code']>();
    for (const my_diagnostic of indentation_diagnostics(source, indent_size)) {
        the_codes.set(my_diagnostic.range.start.line, my_diagnostic.code);
    }
    return the_codes;
}

/** `source` with line `line`'s leading blanks replaced by `width` spaces. */
export function with_line_indent(source: string, line: number, width: number): string {
    const the_lines = source.split('\n');
    const my_line = the_lines[line];
    if (my_line === undefined) {
        throw new Error(`line ${line} is out of range`);
    }
    the_lines[line] = ' '.repeat(width) + my_line.replace(LEADING_BLANKS_RE, '');
    return the_lines.join('\n');
}

/**
 * Assert that line `line` of `source` belongs at block depth `depth`:
 * indented `depth` levels it draws no indentation diagnostic, one level
 * deeper it draws UNNECESSARY_INDENTATION, and (when `depth > 0`) one
 * level shallower it draws MISSING_INDENTATION. The other lines keep
 * their indentation from `source`.
 */
export function expect_line_at_depth(
    source: string,
    line: number,
    depth: number,
    indent_size: number = 4
): void {
    const code_at = (width: number): Diagnostic['code'] | undefined =>
        indentation_codes_by_line(
            with_line_indent(source, line, width), indent_size
        ).get(line);

    expect({ line, depth, code: code_at(depth * indent_size) })
        .toEqual({ line, depth, code: undefined });
    expect({ line, depth, code: code_at((depth + 1) * indent_size) })
        .toEqual({ line, depth, code: StataDiagnosticCode.UNNECESSARY_INDENTATION });
    if (depth > 0) {
        expect({ line, depth, code: code_at((depth - 1) * indent_size) })
            .toEqual({ line, depth, code: StataDiagnosticCode.MISSING_INDENTATION });
    }
}

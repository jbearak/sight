import { describe, test, expect } from 'bun:test';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { create_document_state } from '../property/helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';

/**
 * Issue #300: the AST-depth indentation check must validate expected depth
 * symmetrically. Too-shallow lines with a known expected depth should emit
 * MISSING_INDENTATION; too-deep lines should keep emitting
 * UNNECESSARY_INDENTATION.
 */
describe('symmetric AST-depth indentation diagnostics (issue #300)', () => {
  const analyzer = new IndentationDiagnosticAnalyzer();

  const make_config = (): StataLSPConfig => ({
    ...DEFAULT_SETTINGS,
    diagnostics: { ...DEFAULT_SETTINGS.diagnostics, indentation: true },
    formatting: { ...DEFAULT_SETTINGS.formatting, indentSize: 4 },
  });

  const missing_lines = (source: string): number[] =>
    analyzer
      .analyze(create_document_state(source), make_config())
      .filter((d) => d.code === StataDiagnosticCode.MISSING_INDENTATION)
      .map((d) => d.range.start.line)
      .sort((a, b) => a - b);

  const unnecessary_lines = (source: string): number[] =>
    analyzer
      .analyze(create_document_state(source), make_config())
      .filter((d) => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION)
      .map((d) => d.range.start.line)
      .sort((a, b) => a - b);

  test('flags an under-indented nested block header and its close brace', () => {
    // The reproduction from the issue: an empty nested block with the header
    // and both braces at column 0.
    const source = 'if (1 == 2) {\nif (2 == 3) {\n\n}\n}';

    // Line 1 (nested `if` header) and line 3 (its close brace) both have
    // expected depth 1 but actual indent 0.
    expect(missing_lines(source)).toEqual([1, 3]);
  });

  test('emits MISSING at most once per line (no duplicate from brace scan)', () => {
    const source = 'if condition {\ndisplay 1\n}';
    const diagnostics = analyzer
      .analyze(create_document_state(source), make_config())
      .filter((d) => d.code === StataDiagnosticCode.MISSING_INDENTATION)
      .filter((d) => d.range.start.line === 1);

    // The textual brace scan and the AST-depth check both flag line 1; the
    // result must be deduped to a single diagnostic.
    expect(diagnostics.length).toBe(1);
  });

  test('preserves too-deep detection via the AST-depth path', () => {
    // Top-level line indented for no reason.
    const source = 'display 1\n        display 2';
    expect(unnecessary_lines(source)).toEqual([1]);
  });

  test('does not flag a correctly formatted else-if block', () => {
    // Regression guard for the compute_brace_block_depths same-line fix:
    // `else if` must stay at column 0, so a correctly formatted block must
    // produce no indentation diagnostics.
    const source =
      'if 1 {\n    display 1\n}\nelse if 2 {\n    display 2\n}';
    expect(missing_lines(source)).toEqual([]);
    expect(unnecessary_lines(source)).toEqual([]);
  });

  test('does not flag a correctly formatted nested block', () => {
    const source = 'if (1 == 2) {\n    if (2 == 3) {\n\n    }\n}';
    expect(missing_lines(source)).toEqual([]);
    expect(unnecessary_lines(source)).toEqual([]);
  });

  test('suppresses MISSING inside a block corrupted by a structural error', () => {
    // `#delimit ;` with braces: the error-recovering parser misparents the
    // trailing `#delimit cr` into the unterminated `if` block, giving that
    // column-0 line a bogus expected depth. The AST-depth check must not flag
    // it (the formatter can't fix it either). Verified via the structural
    // taint gate: the malformed `if` block is tainted, so no false positive.
    const source = '#delimit ;\nif 1 {;\n    display 1;\n};\n#delimit cr';
    expect(missing_lines(source)).toEqual([]);
    expect(unnecessary_lines(source)).toEqual([]);
  });

  test('does not flag a same-line prefix-brace block after else', () => {
    // `else capture {` / `else quietly {` open a prefix brace block on the
    // same line as `else`, like `else if`. They must stay at the parent depth
    // (column 0 here), not be pushed one level deeper.
    for (const my_prefix of ['capture', 'quietly']) {
      const source =
        `if 1 {\n    display 1\n}\nelse ${my_prefix} {\n    display 2\n}`;
      expect(missing_lines(source)).toEqual([]);
      expect(unnecessary_lines(source)).toEqual([]);
    }
  });

  test('does not flag ancestor closers after a single-statement else', () => {
    // A single-statement else (prefix brace or plain command) must not extend
    // its range onto the following ancestor closer / `end`, which would give
    // that correctly-indented closer a bogus depth and a false MISSING.
    const else_capture_in_program =
      'program define p\n    if 1 {\n        display 1\n    }\n' +
      '    else capture {\n        display 2\n    }\nend';
    expect(missing_lines(else_capture_in_program)).toEqual([]);
    expect(unnecessary_lines(else_capture_in_program)).toEqual([]);

    const else_capture_in_brace =
      'if 0 {\n    display 1\n}\nelse {\n    if 1 {\n        display 2\n' +
      '    }\n    else capture {\n        display 3\n    }\n}';
    expect(missing_lines(else_capture_in_brace)).toEqual([]);
    expect(unnecessary_lines(else_capture_in_brace)).toEqual([]);
  });

  test('handles a plain command on the else line', () => {
    // `else display 2` is a same-line child that shares the else's indentation.
    const correct =
      'program define p\n    if 1 {\n        display 1\n    }\n    else display 2\nend';
    expect(missing_lines(correct)).toEqual([]);
    expect(unnecessary_lines(correct)).toEqual([]);

    // ...but a genuinely under-indented one is still flagged.
    const under_indented =
      'program define p\n    if 1 {\n        display 1\n    }\nelse display 2\nend';
    expect(missing_lines(under_indented)).toContain(4);
  });

  test('a statement-local syntax error does not hide a genuine MISSING', () => {
    // A non-structural SYNTAX_ERROR (here `unab m x`) must not taint the whole
    // program body: the genuine MISSING on the under-indented `args a` (line 2)
    // must still be reported.
    const source = 'program define p\n    unab m x\nargs a\nend';
    expect(missing_lines(source)).toContain(2);
  });

  test('an unbalanced paren does not taint the block (nesting intact)', () => {
    // UNBALANCED_PARENTHESES leaves block nesting intact (parens are not block
    // delimiters), so it must NOT suppress a genuine MISSING on a well-formed
    // nested line. Line 2 (`gen z = 1`) is under-indented inside the nested
    // `if 2 {` block; the outer header has an unbalanced paren.
    const source = 'if (x {\n    if 2 {\ngen z = 1\n    }\n}';
    expect(missing_lines(source)).toContain(2);
  });

  test('still flags a healthy under-indented block when a sibling is broken', () => {
    // The taint gate must be local: a structural error in one block must NOT
    // silence MISSING in an unrelated, healthy block elsewhere in the file.
    // Line 1 (`display 1`) is genuinely under-indented inside a well-formed
    // block; the second block is broken by stray close braces.
    const source = 'if 1 {\ndisplay 1\n}\nif 2 {\n}}}';
    expect(missing_lines(source)).toContain(1);
  });
});

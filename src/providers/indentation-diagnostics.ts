/**
 * Indentation diagnostics: a line is misindented exactly when Format
 * Document, in the default source-preserving mode, would re-indent it.
 * The formatter's layout is the one model of where each line belongs
 * (block depth, `///` and `#delimit ;` continuations, comments, aligned
 * continuation runs, mata/python blocks, `input` data), so the
 * diagnostics and the formatter cannot disagree, and a fix applied by
 * Format Document always clears them.
 */
import { Diagnostic, DiagnosticSeverity, Range, Position } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, StataNode, StataAST, TokenType } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';
import { CodeFormatter } from './formatter';

const LEADING_WHITESPACE_RE = /^[ \t]*/;
const NON_CODE_TOKEN_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'COMMENT_LINE', 'COMMENT_BLOCK', 'WHITESPACE', 'STATEMENT_TERMINATOR', 'EOF',
]);

// Parse/lex errors that specifically corrupt BLOCK NESTING (brace pairing /
// program-body extent), making the AST-derived indentation depth untrustworthy
// in the region around them. When one is present, an error-recovering parse can
// misparent following statements into an unterminated block, giving correctly-
// indented lines a bogus expected depth. We suppress the AST-depth indentation
// check on the affected block only (see compute_structural_taint) rather than
// trusting the corrupted depth. Codes are compared as strings because
// parser/lexer codes are not all mirrored into StataDiagnosticCode.
//
// Only errors that specifically corrupt BLOCK NESTING (brace pairing /
// program-body extent / whole-file tokenization) belong here: an
// error-recovering parse can then misparent following statements into an
// unterminated block, giving correctly-indented lines a bogus expected depth.
// We suppress the AST-depth indentation check on the smallest enclosing block
// (see compute_structural_taint) rather than trust the corrupted depth. Codes
// are compared as strings because parser/lexer codes are not all mirrored into
// StataDiagnosticCode.
//
// Deliberately EXCLUDED are codes that leave block nesting intact, where
// tainting would only hide genuine indentation diagnostics with no false
// positive to prevent:
//  - UNBALANCED_PARENTHESES: parentheses are not block delimiters, so a
//    brace-balanced block with a bad paren still has trustworthy depths.
//  - the generic SYNTAX_ERROR: parser recovery emits it for statement-local
//    problems too (e.g. `unab m x`), and since the smallest enclosing block of
//    a program-body error is the whole program, tainting it would swallow the
//    program's real indentation diagnostics. Brace/block misparenting already
//    surfaces a brace-structure code (e.g. an unterminated `#delimit ;` brace
//    block emits ORPHAN_CLOSE_BRACE on the stray close brace), so dropping the
//    generic code loses no genuine coverage.
//  - FORVALUES_SYNTAX, STRAY_TOKEN_IN_CONDITION, etc.: statement-local.
const STRUCTURAL_NESTING_ERROR_CODES = new Set<string>([
  'OPEN_BRACE_ALONE',
  'ORPHAN_CLOSE_BRACE',
  'BRACE_NOT_ALONE',
  'BRACE_ELSE_SAME_LINE',
  'CODE_AFTER_OPEN_BRACE',
  'CODE_FOLLOWS_OPEN_BRACE',
  'UNCLOSED_BLOCK',
  'MISSING_PROGRAM_END',
  'UNBALANCED_QUOTES',
  'UNBALANCED_BLOCK_COMMENT',
]);

export class IndentationDiagnosticAnalyzer {
  private formatter = new CodeFormatter();

  analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
    if (config.diagnostics.indentation === false) {
      return [];
    }
    const indent_size = config.formatting?.indentSize ?? 4;
    const formatted = this.source_preserving_layout(document, config, indent_size);
    if (formatted === null) {
      return [];
    }
    const the_lines = document.content.split('\n');
    const the_formatted_lines = formatted.split('\n');

    // Lines whose layout is untrustworthy because a structural parse
    // error corrupted the enclosing block's nesting. Empty in the common
    // (clean-parse) case.
    const structural_taint = this.compute_structural_taint(document);

    // Comments may sit where their author put them: a line with no code
    // on it is not reported, though Format Document re-indents it.
    const code_lines = this.lines_with_code(document);

    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < the_lines.length && i < the_formatted_lines.length; i++) {
      const line = the_lines[i];
      const formatted_line = the_formatted_lines[i];
      // Blank lines have no indentation to judge, and a line the
      // formatter changed beyond its indentation is not the same line.
      if (!code_lines.has(i) || structural_taint.has(i) ||
          line.trim() !== formatted_line.trim()) {
        continue;
      }
      const actual = this.indent_width(line, indent_size);
      const expected = this.indent_width(formatted_line, indent_size);
      if (actual === expected) {
        continue;
      }
      const code = actual > expected
        ? StataDiagnosticCode.UNNECESSARY_INDENTATION
        : StataDiagnosticCode.MISSING_INDENTATION;
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: Range.create(
          Position.create(i, 0),
          Position.create(i, LEADING_WHITESPACE_RE.exec(line)?.[0].length ?? 0)
        ),
        message: actual > expected
          ? 'Line appears unnecessarily indented. Use Format Document to fix.'
          : 'Line appears under-indented for its block depth. Use Format Document to fix.',
        source: 'sight',
        code,
        ...diagnostic_code_description_fields(code),
      });
    }
    return diagnostics;
  }

  /**
   * The document as Format Document lays it out in source-preserving
   * mode, which keeps every line and changes only whitespace; null when
   * it cannot be formatted (no AST or tokens).
   */
  private source_preserving_layout(
    document: DocumentState,
    config: StataLSPConfig,
    indent_size: number
  ): string | null {
    if (!document.ast || !document.tokens) {
      return null;
    }
    const the_edits = this.formatter.format(
      document,
      { tabSize: indent_size, insertSpaces: true },
      { ...config, formatting: { ...config.formatting, mode: 'source-preserving' } }
    );
    return the_edits[0]?.newText ?? document.content;
  }

  /** The lines on which a code token starts (not only comments). */
  private lines_with_code(document: DocumentState): Set<number> {
    const the_lines = new Set<number>();
    for (const my_token of document.tokens ?? []) {
      if (!NON_CODE_TOKEN_TYPES.has(my_token.type)) {
        the_lines.add(my_token.range.start.line);
      }
    }
    return the_lines;
  }

  /**
   * The visual width of `line`'s leading blanks, a tab advancing to the
   * next multiple of `indent_size`.
   */
  private indent_width(line: string, indent_size: number): number {
    const leading = LEADING_WHITESPACE_RE.exec(line)?.[0] ?? '';
    let width = 0;
    for (const my_char of leading) {
      width = my_char === '\t'
        ? (Math.floor(width / indent_size) + 1) * indent_size
        : width + 1;
    }
    return width;
  }

  /**
   * Compute the set of line numbers whose AST-derived indentation depth is
   * untrustworthy because a structural parse/lex error corrupted the enclosing
   * block's nesting. For each structural error (see
   * STRUCTURAL_NESTING_ERROR_CODES) we taint the smallest AST block that
   * contains the error line, so suppression is confined to the malformed block
   * — healthy sibling and ancestor blocks keep reporting. When no block
   * contains the error line (top-level error), only that line is tainted.
   *
   * `document.diagnostics` and `document.ast` are produced by the same parse
   * pass, so the two are consistent and the taint toggles together with the
   * diagnostics in a single publish — no transient flicker in healthy regions.
   */
  private compute_structural_taint(document: DocumentState): Set<number> {
    const tainted_lines = new Set<number>();

    const the_error_lines: number[] = [];
    for (const my_diagnostic of document.diagnostics) {
      const my_code =
        typeof my_diagnostic.code === 'string' ? my_diagnostic.code : '';
      if (STRUCTURAL_NESTING_ERROR_CODES.has(my_code)) {
        the_error_lines.push(my_diagnostic.range.start.line);
      }
    }

    // Common case: no structural errors, nothing tainted.
    if (the_error_lines.length === 0) {
      return tainted_lines;
    }

    // No AST to locate the enclosing block — taint just the error lines.
    if (!document.ast) {
      for (const my_error_line of the_error_lines) {
        tainted_lines.add(my_error_line);
      }
      return tainted_lines;
    }

    for (const my_error_line of the_error_lines) {
      const my_block = this.find_smallest_block_containing(
        document.ast,
        my_error_line
      );
      if (my_block) {
        for (
          let my_line = my_block.range.start.line;
          my_line <= my_block.range.end.line;
          my_line++
        ) {
          tainted_lines.add(my_line);
        }
      } else {
        tainted_lines.add(my_error_line);
      }
    }

    return tainted_lines;
  }

  /**
   * Find the smallest (deepest) block node whose line span contains `line`,
   * or null if no block node contains it. "Block node" means a control-flow
   * block (if/else/foreach/forvalues/while/program/frame) or a prefix-command
   * brace block (`capture { }`, `quietly { }`, ...) — the constructs whose
   * body indentation the AST-depth check relies on.
   */
  private find_smallest_block_containing(
    ast: StataAST,
    line: number
  ): StataNode | null {
    let best: StataNode | null = null;

    const walk = (node: StataNode): void => {
      const start_line = node.range.start.line;
      const end_line = node.range.end.line;
      if (line < start_line || line > end_line) {
        return;
      }
      if (this.is_indentation_block_node(node)) {
        // Descending depth-first, later matches are deeper; `<=` keeps the
        // smallest-span (deepest) containing block.
        if (
          best === null ||
          end_line - start_line <=
            best.range.end.line - best.range.start.line
        ) {
          best = node;
        }
      }
      if ('body' in node && Array.isArray(node.body)) {
        for (const my_child of node.body) {
          walk(my_child);
        }
      }
    };

    for (const my_node of ast.nodes) {
      walk(my_node);
    }

    return best;
  }

  /**
   * Whether a node opens an indentation block: a control-flow block
   * (if/else/foreach/forvalues/while/program/frame) or a prefix-command brace
   * block (`capture { }`, `quietly { }`, ...). Single sources the "block
   * child" test used by both same-line depth handling and structural taint,
   * so `else capture {` (a prefix brace opened on the same line as `else`) is
   * treated like `else if` and not pushed one level too deep.
   */
  private is_indentation_block_node(node: StataNode): boolean {
    return node.type === 'program' ||
      (node.type === 'if' && !node.is_single_statement) ||
      node.type === 'else' ||
      node.type === 'foreach' ||
      node.type === 'forvalues' ||
      node.type === 'while' ||
      node.type === 'frame' ||
      (node.type === 'command' && node.name === '{');
  }
}

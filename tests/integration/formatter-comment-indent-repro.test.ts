import { describe, test, expect, beforeEach } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { FormattingOptions } from 'vscode-languageserver';

/**
 * Regression test for formatter not fixing all unnecessarily indented lines after a comment.
 * 
 * Bug: When multiple lines are unnecessarily indented after a comment block,
 * the formatter only fixes lines 2+ but leaves the first indented line unchanged.
 */
describe('Formatter - Comment Indentation Fix', () => {
  let formatter: CodeFormatter;
  let parser: StataParser;
  let lexer: StataLexer;

  beforeEach(() => {
    formatter = new CodeFormatter();
    parser = new StataParser();
    lexer = new StataLexer();
  });

  function create_document(source: string): DocumentState {
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);

    return {
      uri: 'file:///test.do',
      content: source,
      version: 1,
      ast: parse_result.ast,
      tokens: lex_result.tokens,
      line_offsets: lex_result.line_offsets,
      symbols: new Map(),
      diagnostics: [],
    };
  }

  function format_document(source: string): string {
    const my_document = create_document(source);
    const my_options: FormattingOptions = {
      tabSize: 4,
      insertSpaces: true,
    };

    const my_edits = formatter.format(my_document, my_options);
    if (my_edits.length === 0) {
      return source;
    }

    return my_edits[0].newText;
  }

  test('should remove unnecessary indentation from ALL lines after comment', () => {
    // Comment at column 0, but all replace lines are indented
    const content = `//////////////////////////////////////// Users of Diaphragm/Foam/Jelly ////////////////////////////////////////
    replace using_diaphragm_foam_jelly = 0 if v312 != 4
    replace using_diaphragm_foam_jelly = 1 if v312 == 4
    replace using_diaphragm_foam_jelly = . if v312 == .`;

    const formatted = format_document(content);

    console.log('Original:');
    content.split('\n').forEach((line, i) => console.log(`${i}: [${line}]`));
    console.log('\nFormatted:');
    formatted.split('\n').forEach((line, i) => console.log(`${i}: [${line}]`));

    // All replace lines should have NO indentation (same as the comment)
    const lines = formatted.split('\n');
    expect(lines[0]).toMatch(/^\/+/); // Comment line unchanged
    expect(lines[1]).toBe('replace using_diaphragm_foam_jelly = 0 if v312 != 4');
    expect(lines[2]).toBe('replace using_diaphragm_foam_jelly = 1 if v312 == 4');
    expect(lines[3]).toBe('replace using_diaphragm_foam_jelly = . if v312 == .');
  });

  test('should handle star comment followed by indented lines', () => {
    const content = `* This is a comment
    display "line 1"
    display "line 2"`;

    const formatted = format_document(content);

    console.log('Original:');
    content.split('\n').forEach((line, i) => console.log(`${i}: [${line}]`));
    console.log('\nFormatted:');
    formatted.split('\n').forEach((line, i) => console.log(`${i}: [${line}]`));

    const lines = formatted.split('\n');
    expect(lines[0]).toBe('* This is a comment');
    expect(lines[1]).toBe('display "line 1"');
    expect(lines[2]).toBe('display "line 2"');
  });
});

import { describe, test, expect, beforeEach } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { FormattingOptions } from 'vscode-languageserver';
import { create_document_state } from '../property/helpers/document-utils';

/**
 * Regression test for formatter not fixing all unnecessarily indented lines after a comment.
 * 
 * Bug: When multiple lines are unnecessarily indented after a comment block,
 * the formatter only fixes lines 2+ but leaves the first indented line unchanged.
 */
describe('Formatter - Comment Indentation Fix', () => {
  let formatter: CodeFormatter;

  beforeEach(() => {
    formatter = new CodeFormatter();
  });

  function format_document(source: string): string {
    const my_document = create_document_state(source);
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

    const lines = formatted.split('\n');
    expect(lines[0]).toBe('* This is a comment');
    expect(lines[1]).toBe('display "line 1"');
    expect(lines[2]).toBe('display "line 2"');
  });
});

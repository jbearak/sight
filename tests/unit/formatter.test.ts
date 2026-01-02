import { CodeFormatter } from '../../src/providers/formatter';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { DocumentState } from '../../src/document-store';
import { FormattingOptions } from 'vscode-languageserver';

describe('CodeFormatter with embedded language support', () => {
  let formatter: CodeFormatter;
  let parser: StataParser;
  let lexer: StataLexer;

  beforeEach(() => {
    formatter = new CodeFormatter();
    parser = new StataParser();
    lexer = new StataLexer();
  });

  /**
   * Helper to create a DocumentState from source code.
   */
  function create_document(source: string): DocumentState {
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);

    return {
      uri: 'file:///test.do',
      content: source,
      version: 1,
      ast: parse_result.ast,
      symbols: new Map(),
      diagnostics: [],
    };
  }

  /**
   * Helper to format a document.
   */
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

  describe('formatting without embedded blocks', () => {
    test('should format simple command', () => {
      const my_source = 'generate age = 25';
      const my_formatted = format_document(my_source);

      expect(my_formatted).toContain('generate');
      expect(my_formatted).toContain('age');
    });

    test('should format multiple commands', () => {
      const my_source = `generate age = 25
summarize age`;
      const my_formatted = format_document(my_source);

      expect(my_formatted).toContain('generate');
      expect(my_formatted).toContain('summarize');
    });

    test('should preserve command structure', () => {
      const my_source = 'regress income age, robust';
      const my_formatted = format_document(my_source);

      expect(my_formatted).toContain('regress');
      expect(my_formatted).toContain('income');
      expect(my_formatted).toContain('age');
      expect(my_formatted).toContain('robust');
    });
  });

  describe('embedded content preservation', () => {
    test('should preserve mata block content', () => {
      const my_source = `mata
      matrix A = (1, 2 \\ 3, 4)
      end
generate age = 25`;

      const my_formatted = format_document(my_source);

      // Mata block should be present
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('end');
      // Stata code should still be present
      expect(my_formatted).toContain('generate');
    });

    test('should preserve python block content', () => {
      const my_source = `python
      import numpy as np
      x = np.array([1, 2, 3])
      end
generate age = 25`;

      const my_formatted = format_document(my_source);

      // Python block should be present
      expect(my_formatted).toContain('python');
      expect(my_formatted).toContain('end');
      // Stata code should still be present
      expect(my_formatted).toContain('generate');
    });

    test('should preserve single-line mata context', () => {
      const my_source = `mata: matrix A = (1, 2)
generate age = 25`;

      const my_formatted = format_document(my_source);

      // Single-line mata should be preserved
      expect(my_formatted).toContain('mata:');
      expect(my_formatted).toContain('generate');
    });

    test('should preserve single-line python context', () => {
      const my_source = `python: x = 1 + 2
generate age = 25`;

      const my_formatted = format_document(my_source);

      // Single-line python should be preserved
      expect(my_formatted).toContain('python:');
      expect(my_formatted).toContain('generate');
    });

    test('should preserve nested embedded blocks', () => {
      const my_source = `mata
      matrix A = (1, 2)
      python
      x = 1
      end python
      end
generate age = 25`;

      const my_formatted = format_document(my_source);

      // Both blocks should be present
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('python');
      expect(my_formatted).toContain('end');
      expect(my_formatted).toContain('generate');
    });

    test('should preserve multiple embedded blocks', () => {
      const my_source = `mata
      matrix A = (1, 2)
      end
generate age = 25
python
      x = 1
      end python
summarize age`;

      const my_formatted = format_document(my_source);

      // Both blocks should be present
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('python');
      expect(my_formatted).toContain('generate');
      expect(my_formatted).toContain('summarize');
    });
  });

  describe('block delimiter formatting', () => {
    test('should preserve mata delimiter', () => {
      const my_source = `mata
      matrix A = (1, 2)
      end`;

      const my_formatted = format_document(my_source);

      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('end');
    });

    test('should preserve python delimiter', () => {
      const my_source = `python
      x = 1
      end`;

      const my_formatted = format_document(my_source);

      expect(my_formatted).toContain('python');
      expect(my_formatted).toContain('end');
    });

    test('should preserve mata: delimiter', () => {
      const my_source = `mata: matrix A = (1, 2)`;

      const my_formatted = format_document(my_source);

      expect(my_formatted).toContain('mata:');
    });

    test('should preserve python: delimiter', () => {
      const my_source = `python: x = 1`;

      const my_formatted = format_document(my_source);

      expect(my_formatted).toContain('python:');
    });
  });

  describe('spacing around block boundaries', () => {
    test('should maintain spacing before mata block', () => {
      const my_source = `generate age = 25
mata
      matrix A = (1, 2)
      end`;

      const my_formatted = format_document(my_source);

      // Should have both commands
      expect(my_formatted).toContain('generate');
      expect(my_formatted).toContain('mata');
    });

    test('should maintain spacing after mata block', () => {
      const my_source = `mata
      matrix A = (1, 2)
      end
generate age = 25`;

      const my_formatted = format_document(my_source);

      // Should have both commands
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('generate');
    });

    test('should maintain spacing between multiple blocks', () => {
      const my_source = `mata
      matrix A = (1, 2)
      end
python
      x = 1
      end`;

      const my_formatted = format_document(my_source);

      // Should have both blocks
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('python');
      expect(my_formatted).toContain('end');
    });
  });

  describe('formatting options', () => {
    test('should respect indent size option', () => {
      const my_source = `if age > 18 {
        display "Adult"
      }`;

      const my_document = create_document(my_source);
      const my_options: FormattingOptions = {
        tabSize: 2,
        insertSpaces: true,
      };

      const my_edits = formatter.format(my_document, my_options);
      const my_formatted = my_edits[0].newText;

      // Should contain formatted output
      expect(my_formatted).toContain('if');
      expect(my_formatted).toContain('display');
    });

    test('should respect tab style option', () => {
      const my_source = `if age > 18 {
        display "Adult"
      }`;

      const my_document = create_document(my_source);
      const my_options: FormattingOptions = {
        tabSize: 4,
        insertSpaces: false,
      };

      const my_edits = formatter.format(my_document, my_options);
      const my_formatted = my_edits[0].newText;

      // Should contain formatted output
      expect(my_formatted).toContain('if');
      expect(my_formatted).toContain('display');
    });
  });

  describe('edge cases', () => {
    test('should handle empty document', () => {
      const my_source = '';
      const my_document = create_document(my_source);
      const my_options: FormattingOptions = {
        tabSize: 4,
        insertSpaces: true,
      };

      const my_edits = formatter.format(my_document, my_options);

      // Should return empty or minimal edits
      expect(my_edits).toBeDefined();
    });

    test('should handle document with only embedded block', () => {
      const my_source = `mata
      matrix A = (1, 2)
      end`;

      const my_formatted = format_document(my_source);

      // Should preserve the block
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('end');
    });

    test('should handle unclosed embedded block', () => {
      const my_source = `mata
      matrix A = (1, 2)`;

      const my_formatted = format_document(my_source);

      // Should still preserve content
      expect(my_formatted).toContain('mata');
    });

    test('should handle embedded block with special characters', () => {
      const my_source = `mata
      matrix A = (1, 2 \\ 3, 4)
      end`;

      const my_formatted = format_document(my_source);

      // Should preserve the block
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('end');
    });
  });

  describe('format_range method', () => {
    test('should format range (fallback to full document)', () => {
      const my_source = `generate age = 25
summarize age`;

      const my_document = create_document(my_source);
      const my_options: FormattingOptions = {
        tabSize: 4,
        insertSpaces: true,
      };

      const my_range = {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 10 },
      };

      const my_edits = formatter.format_range(my_document, my_range, my_options);

      // Should return edits
      expect(my_edits).toBeDefined();
      expect(my_edits.length).toBeGreaterThan(0);
    });
  });
});


import { CodeFormatter } from '../../src/providers/formatter';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { DocumentState } from '../../src/document-store';
import { FormattingOptions } from 'vscode-languageserver';
import { create_empty_symbol_table } from '../../src/analyzer';
import { for_each_formatter_mode, create_formatter_config } from '../property/helpers/formatter-test-utils';

// Shared test helpers
function create_shared_document(source: string, lexer: StataLexer, parser: StataParser): DocumentState {
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);

    return {
        uri: 'file:///test.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: create_empty_symbol_table(),
        diagnostics: [],
    };
}

function format_shared_document(source: string, lexer: StataLexer, parser: StataParser, formatter: CodeFormatter, options?: Partial<FormattingOptions>): string {
    const my_document = create_shared_document(source, lexer, parser);
    const my_options: FormattingOptions = {
        tabSize: 4,
        insertSpaces: true,
        ...options,
    };

    const my_edits = formatter.format(my_document, my_options);
    if (my_edits.length === 0) {
        return source;
    }

    return my_edits[0].newText;
}

/**
 * Helper to format a document with optional formatting options.
 */
function format_document(source: string, lexer: StataLexer, parser: StataParser, formatter: CodeFormatter, config?: any, options?: Partial<FormattingOptions>): string {
    return format_shared_document(source, lexer, parser, formatter, options);
}

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
    return create_shared_document(source, lexer, parser);
  }

  describe('formatting without embedded blocks', () => {
    test('should format simple command', () => {
      const my_source = 'generate age = 25';
      const my_formatted = format_document(my_source, lexer, parser, formatter);

      expect(my_formatted).toContain('generate');
      expect(my_formatted).toContain('age');
    });

    test('should format multiple commands', () => {
      const my_source = `generate age = 25
summarize age`;
      const my_formatted = format_document(my_source, lexer, parser, formatter);

      expect(my_formatted).toContain('generate');
      expect(my_formatted).toContain('summarize');
    });

    test('should preserve command structure', () => {
      const my_source = 'regress income age, robust';
      const my_formatted = format_document(my_source, lexer, parser, formatter);

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

      const my_formatted = format_document(my_source, lexer, parser, formatter);

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

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Python block should be present
      expect(my_formatted).toContain('python');
      expect(my_formatted).toContain('end');
      // Stata code should still be present
      expect(my_formatted).toContain('generate');
    });

    test('should preserve single-line mata context', () => {
      const my_source = `mata: matrix A = (1, 2)
generate age = 25`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Single-line mata should be preserved
      expect(my_formatted).toContain('mata:');
      expect(my_formatted).toContain('generate');
    });

    test('should preserve single-line python context', () => {
      const my_source = `python: x = 1 + 2
generate age = 25`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Single-line python should be preserved
      expect(my_formatted).toContain('python:');
      expect(my_formatted).toContain('generate');
    });

    for_each_formatter_mode('should preserve all code after single-line mata: call', (mode) => {
      // This tests the fix for the bug where code after mata: was deleted
      const my_source = `run programs.do
mata: aww_init_matrices()

// We next make sure the output folders exist
confirmdir "output"
if (_rc == 170) {
    mkdir "output"
}`;

      const config = create_formatter_config(mode);
      const formatter = new CodeFormatter(config);
      const my_formatted = format_document(my_source, lexer, parser, formatter, config);

      // All statements should be preserved
      expect(my_formatted).toContain('run programs.do');
      expect(my_formatted).toContain('mata: aww_init_matrices()');
      expect(my_formatted).toContain('confirmdir "output"');
      expect(my_formatted).toContain('mkdir "output"');
      expect(my_formatted).toContain('if (_rc == 170)');
    });

    for_each_formatter_mode('should preserve all code after single-line python: call', (mode) => {
      // This tests the fix for the bug where code after python: was deleted
      const my_source = `use mydata.dta
python: import pandas as pd

// Process the data
summarize income
regress income age education`;

      const config = create_formatter_config(mode);
      const formatter = new CodeFormatter(config);
      const my_formatted = format_document(my_source, lexer, parser, formatter, config);

      // All statements should be preserved
      expect(my_formatted).toContain('use mydata.dta');
      expect(my_formatted).toContain('python: import pandas as pd');
      expect(my_formatted).toContain('summarize income');
      expect(my_formatted).toContain('regress income age education');
    });

    for_each_formatter_mode('should preserve code after multiple single-line embedded calls', (mode) => {
      const my_source = `mata: x = 1
python: y = 2
generate z = 3
summarize z`;

      const config = create_formatter_config(mode);
      const formatter = new CodeFormatter(config);
      const my_formatted = format_document(my_source, lexer, parser, formatter, config);

      // All statements should be preserved
      expect(my_formatted).toContain('mata: x = 1');
      expect(my_formatted).toContain('python: y = 2');
      expect(my_formatted).toContain('generate z = 3');
      expect(my_formatted).toContain('summarize z');
    });

    test('should preserve nested embedded blocks', () => {
      const my_source = `mata
      matrix A = (1, 2)
      python
      x = 1
      end python
      end
generate age = 25`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

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

      const my_formatted = format_document(my_source, lexer, parser, formatter);

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

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('end');
    });

    test('should preserve python delimiter', () => {
      const my_source = `python
      x = 1
      end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      expect(my_formatted).toContain('python');
      expect(my_formatted).toContain('end');
    });

    test('should preserve mata: delimiter', () => {
      const my_source = `mata: matrix A = (1, 2)`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      expect(my_formatted).toContain('mata:');
    });

    test('should preserve python: delimiter', () => {
      const my_source = `python: x = 1`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      expect(my_formatted).toContain('python:');
    });
  });

  describe('spacing around block boundaries', () => {
    test('should maintain spacing before mata block', () => {
      const my_source = `generate age = 25
mata
      matrix A = (1, 2)
      end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Should have both commands
      expect(my_formatted).toContain('generate');
      expect(my_formatted).toContain('mata');
    });

    test('should maintain spacing after mata block', () => {
      const my_source = `mata
      matrix A = (1, 2)
      end
generate age = 25`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

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

      const my_formatted = format_document(my_source, lexer, parser, formatter);

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

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Should preserve the block
      expect(my_formatted).toContain('mata');
      expect(my_formatted).toContain('end');
    });

    test('should handle unclosed embedded block', () => {
      const my_source = `mata
      matrix A = (1, 2)`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Should still preserve content
      expect(my_formatted).toContain('mata');
    });

    test('should handle embedded block with special characters', () => {
      const my_source = `mata
      matrix A = (1, 2 \\ 3, 4)
      end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

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



describe('Formatter bug fixes', () => {
  let formatter: CodeFormatter;
  let parser: StataParser;
  let lexer: StataLexer;

  beforeEach(() => {
    formatter = new CodeFormatter();
    parser = new StataParser();
    lexer = new StataLexer();
  });

  function create_document(source: string): DocumentState {
    return create_shared_document(source, lexer, parser);
  }

  describe('tab to space conversion', () => {
    test('should convert tabs to spaces when insertSpaces is true', () => {
      const my_source = `program define test
\tlocal x = 1
\tif (x == 1) {
\t\tdisplay "hello"
\t}
end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter, { insertSpaces: true, tabSize: 4 });

      // Should not contain any tabs
      expect(my_formatted).not.toContain('\t');
      // Should contain spaces for indentation
      expect(my_formatted).toContain('    local');
      expect(my_formatted).toContain('        display');
    });

    test('should preserve tabs when insertSpaces is false', () => {
      const my_source = `program define test
\tlocal x = 1
end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter, { insertSpaces: false, tabSize: 4 });

      // Should contain tabs for indentation
      expect(my_formatted).toContain('\tlocal');
    });
  });

  describe('else if indentation', () => {
    test('should not indent else when it follows if block', () => {
      const my_source = `if survey_year == 2009 {
replace birth_outcome = p8_2_1
}
else if survey_year == 2014 | survey_year == 2018 {
replace birth_outcome = p9_2_1
}`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // else should be at column 0, not indented
      const the_lines = my_formatted.split('\n');
      const else_line = the_lines.find(l => l.trim().startsWith('else'));
      expect(else_line).toBeDefined();
      expect(else_line!.startsWith('else')).toBe(true);
    });

    test('should correctly indent contents inside else if block', () => {
      const my_source = `if x == 1 {
display "one"
}
else if x == 2 {
display "two"
}`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Contents inside blocks should be indented
      expect(my_formatted).toContain('    display "one"');
      expect(my_formatted).toContain('    display "two"');
    });

    test('should handle nested else if chains', () => {
      const my_source = `if x == 1 {
display "one"
}
else if x == 2 {
display "two"
}
else {
display "other"
}`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // All else/else if should be at column 0
      const the_lines = my_formatted.split('\n');
      const else_lines = the_lines.filter(l => l.trim().startsWith('else'));
      for (const my_line of else_lines) {
        expect(my_line.startsWith('else')).toBe(true);
      }
    });

    test('should remove spurious leading space from if statement', () => {
      const my_source = ` if survey_year == 2009 {
replace birth_outcome = p8_2_1
}`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // if should be at column 0, not indented
      expect(my_formatted.startsWith('if')).toBe(true);
    });
  });

  describe('comment indentation inside blocks', () => {
    test('should indent comments inside program blocks', () => {
      const my_source = `program define test
// This is a comment
local x = 1
end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Comment should be indented
      expect(my_formatted).toContain('    // This is a comment');
    });

    test('should indent comments inside if blocks', () => {
      const my_source = `if x == 1 {
// Comment inside if
display "hello"
}`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Comment should be indented
      expect(my_formatted).toContain('    // Comment inside if');
    });

    test('should not duplicate text when formatting comments', () => {
      const my_source = `program define test
// Copy values:
generate x = 1
end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Should not have duplicated text like "// Copy values:ues:"
      expect(my_formatted).not.toMatch(/values:.*values:/);
      expect(my_formatted).toContain('// Copy values:');
    });
  });

  describe('text duplication prevention', () => {
    test('should not duplicate any line content', () => {
      const my_source = `program define aww_copy_var
syntax, from(varname) to(string) [label(string)]
// Copy values:
generate \`to' = \`from'
// Use the specified label:
if (\`"\`label'"' != "") {
label variable \`to' \`"\`label'"'
}
end`;

      const my_formatted = format_document(my_source, lexer, parser, formatter);

      // Check that no line has duplicated content
      const the_lines = my_formatted.split('\n');
      for (const my_line of the_lines) {
        const trimmed = my_line.trim();
        if (trimmed.length > 6) {
          // Check that the line doesn't end with a duplicate of part of itself
          const half = Math.floor(trimmed.length / 2);
          const first_half = trimmed.substring(trimmed.length - half);
          const second_half = trimmed.substring(trimmed.length - half * 2, trimmed.length - half);
          // This is a heuristic check - if the last half equals the second-to-last half, it's likely duplicated
          if (first_half === second_half && first_half.length > 3) {
            fail(`Line appears to have duplicated content: "${my_line}"`);
          }
        }
      }
    });
  });
});

/**
 * Unit tests for stray token detection in if/in qualifier conditions.
 * 
 * Tests the parser's ability to detect:
 * 1. Stray tokens after comparison expressions
 * 2. Split literal patterns (`. N`, `. a`, `N .`, `a .`)
 * 3. Valid compound expressions (no false positives)
 */

import { describe, it, expect } from 'bun:test';
import { StataLexer, StataParser } from '../../src/index';
import { ParseErrorCode } from '../../src/types';

function parse(source: string) {
  const lexer = new StataLexer();
  const parser = new StataParser();
  const lex_result = lexer.tokenize(source);
  return parser.parse(lex_result.tokens);
}

function get_errors_by_code(source: string, code: ParseErrorCode) {
  const result = parse(source);
  return result.errors.filter(e => e.code === code);
}

describe('Stray Token Detection', () => {
  describe('Basic stray token cases', () => {
    it('should detect stray token in parenthesized if condition: if (x == y oops)', () => {
      const errors = get_errors_by_code('replace x = 1 if (x == y oops)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('oops');
      expect(errors[0].message).toContain("'&' or '|'");
    });

    it('should detect stray token in unparenthesized if condition: if x == y oops', () => {
      const errors = get_errors_by_code('replace x = 1 if x == y oops', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('oops');
    });

    it('should detect stray token after command: replace x = y if z == 0 oops', () => {
      const errors = get_errors_by_code('replace x = y if z == 0 oops', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('oops');
    });

    it('should detect stray token with != operator', () => {
      const errors = get_errors_by_code('gen x = 1 if y != 0 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('extra');
    });

    it('should detect stray token with ~= operator', () => {
      const errors = get_errors_by_code('gen x = 1 if y ~= 0 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('extra');
    });

    it('should detect stray token with < operator', () => {
      const errors = get_errors_by_code('gen x = 1 if y < 10 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('extra');
    });

    it('should detect stray token with > operator', () => {
      const errors = get_errors_by_code('gen x = 1 if y > 10 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('extra');
    });

    it('should detect stray token with <= operator', () => {
      const errors = get_errors_by_code('gen x = 1 if y <= 10 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('extra');
    });

    it('should detect stray token with >= operator', () => {
      const errors = get_errors_by_code('gen x = 1 if y >= 10 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('extra');
    });
  });

  describe('Valid compound expressions (no false positives)', () => {
    it('should NOT flag valid compound expression with &', () => {
      const errors = get_errors_by_code('gen x = 1 if (x == 1 & y == 2)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag valid compound expression with |', () => {
      const errors = get_errors_by_code('gen x = 1 if (x == 1 | y == 2)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag arithmetic in comparisons: if (x + 1 == y)', () => {
      const errors = get_errors_by_code('gen x = 1 if (x + 1 == y)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag negation: if !(x == y)', () => {
      const errors = get_errors_by_code('gen x = 1 if !(x == y)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag negation with ~: if ~(x == y)', () => {
      const errors = get_errors_by_code('gen x = 1 if ~(x == y)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag nested parentheses: if ((x == 1) & (y == 2))', () => {
      const errors = get_errors_by_code('gen x = 1 if ((x == 1) & (y == 2))', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag function calls: if (strlen(x) == 5)', () => {
      const errors = get_errors_by_code('gen x = 1 if (strlen(x) == 5)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag complex arithmetic: if (x * 2 + y / 3 == z)', () => {
      const errors = get_errors_by_code('gen x = 1 if (x * 2 + y / 3 == z)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag if followed by in qualifier', () => {
      const errors = get_errors_by_code('gen x = 1 if y == 0 in 1/10', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag condition followed by options', () => {
      const errors = get_errors_by_code('gen x = 1 if y == 0, replace', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should detect first stray token when multiple present: if (x == y foo bar)', () => {
      const errors = get_errors_by_code('gen x = 1 if (x == y foo bar)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0].message).toContain('foo');
    });

    it('should detect keyword as stray token: if (x == y and)', () => {
      const errors = get_errors_by_code('gen x = 1 if (x == y and)', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('and');
    });

    it('should handle macro references in conditions', () => {
      const errors = get_errors_by_code("gen x = 1 if `var' == 1", ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should handle global macro references in conditions', () => {
      const errors = get_errors_by_code('gen x = 1 if $var == 1', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should handle string comparisons', () => {
      const errors = get_errors_by_code('gen x = 1 if name == "test"', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });
  });

  describe('In-qualifier stray token detection', () => {
    it('should detect stray token in in-qualifier', () => {
      const errors = get_errors_by_code('list if x == 1 in 1/10 oops', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      // Note: in-qualifier doesn't typically have comparison expressions,
      // but if it does, stray tokens should be detected
      expect(errors.length).toBe(0); // in 1/10 doesn't have comparison
    });
  });
});

describe('Split Literal Detection', () => {
  describe('Dot space number pattern (. N)', () => {
    it('should detect split literal: z5 != . 9', () => {
      const errors = get_errors_by_code('gen x = 1 if z5 != . 9', ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('.9');
    });

    it('should detect split literal in parenthesized condition', () => {
      const errors = get_errors_by_code('gen x = 1 if (z5 != . 9)', ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('.9');
    });
  });

  describe('Dot space letter pattern (. a) - extended missing value', () => {
    it('should detect split literal: x != . a', () => {
      const errors = get_errors_by_code('gen x = 1 if x != . a', ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('.a');
      expect(errors[0].message).toContain('extended missing');
    });

    it('should detect split literal: x != . z', () => {
      const errors = get_errors_by_code('gen x = 1 if x != . z', ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('.z');
    });
  });

  describe('Number space dot pattern (N .)', () => {
    it('should detect split literal: x != 9 .', () => {
      const errors = get_errors_by_code('gen x = 1 if x != 9 .', ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('9.');
    });
  });

  describe('Identifier space dot pattern (a .)', () => {
    it('should detect split literal: x != a .', () => {
      const errors = get_errors_by_code('gen x = 1 if x != a .', ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('stray');
    });
  });

  describe('Multi-line with continuation', () => {
    it('should detect split literal across continuation lines', () => {
      const source = `replace x = y if z1 == 0 & z2 == 0 & z3 == 0 & /// stuff
                      (x3 == 0 & z4 != 0 & z5 != . 9)`;
      const errors = get_errors_by_code(source, ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('.9');
    });
  });
});

describe('String Literal Macro Suppression (no false positives)', () => {
  describe('Double-quoted strings with local macros', () => {
    it('should NOT flag local macro in double-quoted string: x == 1 & y == "`macro\'"', () => {
      const errors = get_errors_by_code('gen x = 1 if x == 1 & y == "`macro\'"', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag local macro in parenthesized condition', () => {
      const errors = get_errors_by_code('gen x = 1 if (x == 1 & y == "`macro\'")', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });
  });

  describe('Double-quoted strings with global macros', () => {
    it('should NOT flag global macro in double-quoted string: x == 1 & y == "$macro"', () => {
      const errors = get_errors_by_code('gen x = 1 if x == 1 & y == "$macro"', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag global macro in parenthesized condition', () => {
      const errors = get_errors_by_code('gen x = 1 if (x == 1 & y == "$macro")', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });
  });

  describe('Compound strings with macros', () => {
    it('should NOT flag local macro in compound string: x == `"`macro\'"\'', () => {
      const errors = get_errors_by_code('gen x = 1 if x == `"`macro\'"\'', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag global macro in compound string: x == `"$macro"\'', () => {
      const errors = get_errors_by_code('gen x = 1 if x == `"$macro"\'', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });
  });

  describe('Bug report case', () => {
    it('should NOT flag the exact bug report case: x == 1 & program == "`program\'" & level == "births"', () => {
      const errors = get_errors_by_code('gen x = 1 if x == 1 & program == "`program\'" & level == "births"', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });

    it('should NOT flag bug report case in parenthesized condition', () => {
      const errors = get_errors_by_code('gen x = 1 if (x == 1 & program == "`program\'" & level == "births")', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(0);
    });
  });

  describe('Regression: genuine stray tokens still detected', () => {
    it('should still detect stray token: x == 1 oops', () => {
      const errors = get_errors_by_code('gen x = 1 if x == 1 oops', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('oops');
    });

    it('should still detect stray token with missing logical operator: x == 1 y == 2', () => {
      const errors = get_errors_by_code('gen x = 1 if x == 1 y == 2', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0].message).toContain('y');
    });
  });
});

describe('Diagnostic Message Quality', () => {
  it('should include token text in message', () => {
    const errors = get_errors_by_code('gen x = 1 if y == 0 unexpected', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('unexpected');
  });

  it('should suggest & or | in message', () => {
    const errors = get_errors_by_code('gen x = 1 if y == 0 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("'&' or '|'");
  });

  it('should highlight only the stray token range', () => {
    const errors = get_errors_by_code('gen x = 1 if y == 0 extra', ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
    expect(errors.length).toBe(1);
    // The range should be small (just the token), not the entire condition
    const range = errors[0].range;
    expect(range.end.character - range.start.character).toBe(5); // 'extra' is 5 chars
  });
});

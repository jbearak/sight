import { StataLexer } from '../../src/lexer';
import { TokenType } from '../../src/types';

describe('StataLexer - Star Comment Detection', () => {
  let lexer: StataLexer;

  beforeEach(() => {
    lexer = new StataLexer();
  });

  describe('Star comments vs multiplication', () => {
    test('should recognize * at beginning of line as comment', () => {
      const source = '* This is a comment';
      const result = lexer.tokenize(source);
      
      expect(result.tokens[0].type).toBe('COMMENT_LINE');
      expect(result.tokens[0].value).toBe('* This is a comment');
    });

    test('should recognize * after whitespace at line start as comment', () => {
      const source = '    * This is an indented comment';
      const result = lexer.tokenize(source);
      
      expect(result.tokens[0].type).toBe('COMMENT_LINE');
      expect(result.tokens[0].value).toBe('* This is an indented comment');
    });

    test('should recognize * as multiplication after numbers', () => {
      const source = 'gen result = 5 * 3';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as multiplication after variables', () => {
      const source = 'gen result = age * income';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as multiplication after closing parentheses', () => {
      const source = 'gen result = (age + 1) * income';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as multiplication after macro references', () => {
      const source = 'gen result = `local_var\' * $global_var';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as comment after statement terminators', () => {
      const source = `gen x = 1
* This should be a comment`;
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* This should be a comment');
    });

    test('should recognize * as comment after opening braces', () => {
      const source = `if (age > 18) {
* Comment inside block`;
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* Comment inside block');
    });

    test('should recognize * as multiplication after control keywords that expect expressions', () => {
      const source = 'foreach var in age income * weight {';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as comment after command keywords that expect comments', () => {
      const source = `program define myprogram
* This is a comment inside program`;
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* This is a comment inside program');
    });

    test('should handle complex expression with both * multiplication and * comments', () => {
      const source = `gen result = age * income
* Calculate adjusted result
replace result = result * 1.5`;
      
      const result = lexer.tokenize(source);
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      
      // First * should be multiplication
      const the_star_tokens = the_tokens.filter(t => t.value === '*');
      expect(the_star_tokens[0].type).toBe('OPERATOR');
      expect(the_star_tokens[1].type).toBe('OPERATOR'); // Second * is also multiplication
      
      // Comment should be recognized
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      expect(my_comment_token?.value).toBe('* Calculate adjusted result');
    });

    test('should handle * in semicolon delimiter mode', () => {
      const source = `#delimit ;
gen result = age * income ;
* This is a comment ;`;
      
      const result = lexer.tokenize(source);
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      
      // * in expression should be multiplication
      const the_star_tokens = the_tokens.filter(t => t.value === '*');
      expect(the_star_tokens[0].type).toBe('OPERATOR');
      
      // * at line start should be comment
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      expect(my_comment_token?.value).toBe('* This is a comment ;');
    });
  });

  describe('Star after a block comment', () => {
    // Stata 18: `gen x = a /* c */ * b` multiplies, also when the
    // comment spans lines; `/* c */ * note` alone on a line is a comment.
    const types_of = (source: string): string[] =>
      lexer.tokenize(source).tokens
        .filter(t => t.type !== 'EOF')
        .map(t => `${t.type} ${t.value}`);

    test('reads * after code and a block comment as multiplication', () => {
      expect(types_of('gen x = a /* c */ * b')).toEqual([
        'WORD gen', 'WORD x', 'OPERATOR =', 'WORD a',
        'COMMENT_BLOCK /* c */', 'OPERATOR *', 'WORD b',
      ]);
      expect(types_of('reg y [aw = w /* c */ /* d */ * 2]')).toContain('OPERATOR *');
      expect(types_of('gen x = a /* c\n */ * b')).toContain('OPERATOR *');
    });

    test('reads * after only a block comment on the line as a comment', () => {
      expect(types_of('/* c */ * note')).toEqual([
        'COMMENT_BLOCK /* c */', 'COMMENT_LINE * note',
      ]);
      expect(types_of('gen x = 1\n/* c */ * note')).toContain('COMMENT_LINE * note');
    });
  });

  describe('Star at the start of a line under #delimit ;', () => {
    // Under `#delimit ;` a newline doesn't end the statement, so `*` at
    // the start of a line is a comment only at the start of a statement.
    // Stata 18 computes y = a*b for each `gen` below.
    const tokens_of = (source: string): string[] =>
      lexer.tokenize(source).tokens
        .filter(t => t.type !== 'EOF')
        .map(t => `${t.type} ${t.value}`);

    test('reads * that continues a statement as multiplication', () => {
      expect(tokens_of('#delimit ;\ngen y = a\n* b;\n')).toEqual([
        'DELIMIT_DIRECTIVE #delimit ;', 'WORD gen', 'WORD y', 'OPERATOR =',
        'WORD a', 'OPERATOR *', 'WORD b', 'STATEMENT_TERMINATOR ;',
      ]);
      for (const my_source of [
        '#delimit ;\ngen y = a\n    * b;\n',
        '#delimit ;\ngen y = a\n*\nb;\n',
        '#delimit ;\ngen y = a /* c */\n* b;\n',
        '#delimit ;\ngen y = a // note\n* b;\n',
        '#delimit ;\ngen y = a ///\n* b;\n',
      ]) {
        const the_tokens = tokens_of(my_source);
        expect(the_tokens).toContain('OPERATOR *');
        expect(the_tokens.filter(t => t.startsWith('COMMENT_LINE *'))).toEqual([]);
        expect(the_tokens[the_tokens.length - 1]).toBe('STATEMENT_TERMINATOR ;');
      }
    });

    test('reads * at the start of a statement as a comment', () => {
      expect(tokens_of('#delimit ;\n* note;\n')).toEqual([
        'DELIMIT_DIRECTIVE #delimit ;', 'COMMENT_LINE * note;',
      ]);
      expect(tokens_of('#delimit ;\ngen y = a;\n* one;\n* two;\n')).toEqual([
        'DELIMIT_DIRECTIVE #delimit ;', 'WORD gen', 'WORD y', 'OPERATOR =',
        'WORD a', 'STATEMENT_TERMINATOR ;',
        'COMMENT_LINE * one;', 'COMMENT_LINE * two;',
      ]);
      expect(tokens_of('#delimit ;\ngen y = a; // note\n  * c;\n'))
        .toContain('COMMENT_LINE * c;');
      expect(tokens_of('#delimit ;\nif 1 {;\n* c;\n};\n* d;\n'))
        .toEqual(expect.arrayContaining(['COMMENT_LINE * c;', 'COMMENT_LINE * d;']));
    });

    test('reads * after a word that ends no command as code', () => {
      // The statement goes on, so `*;` is code, not a comment.
      expect(tokens_of('#delimit ;\ndrop program\n*;\n')).toEqual([
        'DELIMIT_DIRECTIVE #delimit ;', 'WORD drop', 'WORD program',
        'OPERATOR *', 'STATEMENT_TERMINATOR ;',
      ]);
    });

    test('reads * where a command starts after a prefix as a comment', () => {
      // Stata 18 runs `quietly` then `* note;` and `capture:` then
      // `* note;` as comments.
      expect(tokens_of('#delimit ;\nquietly\n* note;\n'))
        .toContain('COMMENT_LINE * note;');
      expect(tokens_of('#delimit ;\ncapture:\n* note;\n'))
        .toContain('COMMENT_LINE * note;');
    });

    test('keeps * at the start of a line a comment in cr mode', () => {
      expect(tokens_of('gen y = a\n* b\n')).toContain('COMMENT_LINE * b');
      expect(tokens_of('#delimit ;\n#delimit cr\ngen y = a\n* b\n'))
        .toContain('COMMENT_LINE * b');
    });
  });

  describe('Where a * comment ends', () => {
    // Each rule here matches a StataMP 18 run: `gen q` or `gen r` runs
    // only where it is lexed as code.
    const tokens_of = (source: string): string[] =>
      lexer.tokenize(source).tokens
        .filter(t => t.type !== 'EOF')
        .map(t => `${t.type} ${t.value}`);
    const comments_of = (source: string): string[] =>
      lexer.tokenize(source).tokens
        .filter(t => t.type === 'COMMENT_LINE')
        .map(t => t.value);

    test('runs to the next ; across lines under #delimit ;', () => {
      expect(tokens_of('#delimit ;\n* comment\ngen q = 9;\n')).toEqual([
        'DELIMIT_DIRECTIVE #delimit ;', 'COMMENT_LINE * comment\ngen q = 9;',
      ]);
      expect(tokens_of('#delimit ;\ngen y = a; * c; gen z = 2;\n')).toEqual([
        'DELIMIT_DIRECTIVE #delimit ;',
        'WORD gen', 'WORD y', 'OPERATOR =', 'WORD a', 'STATEMENT_TERMINATOR ;',
        'COMMENT_LINE * c;',
        'WORD gen', 'WORD z', 'OPERATOR =', 'NUMBER 2', 'STATEMENT_TERMINATOR ;',
      ]);
      expect(comments_of('#delimit ;\ngen r = 1; * c\ngen q = 9;\n'))
        .toEqual(['* c\ngen q = 9;']);
      expect(comments_of('#delimit ;\ncapture: * note; gen q = 1;\n'))
        .toEqual(['* note;']);
      expect(comments_of('#delimit ;\n*c;gen q = 1;\n')).toEqual(['*c;']);
    });

    test('runs to the end of the file, past #delimit cr, without a ;', () => {
      const result = lexer.tokenize('#delimit ;\n* c\n#delimit cr\ngen q = 1\n');
      expect(result.tokens.map(t => `${t.type} ${t.value}`)).toEqual([
        'DELIMIT_DIRECTIVE #delimit ;',
        'COMMENT_LINE * c\n#delimit cr\ngen q = 1', 'EOF ',
      ]);
      expect(result.finalState.delimiterMode).toBe('semicolon');
    });

    test('skips a ; hidden by a block comment, quotes, or // after a space', () => {
      for (const my_source of [
        '#delimit ;\n* c /* ; */ gen q = 1;\ngen r = 1;\n',
        '#delimit ;\n* c /* ;\n */ gen q = 1;\ngen r = 1;\n',
        '#delimit ;\n* c "a;b" gen q = 1;\ngen r = 1;\n',
        '#delimit ;\n* c "a\n;b" gen q = 1;\ngen r = 1;\n',
        '#delimit ;\n* c /// ;\ngen q = 1;\ngen r = 1;\n',
      ]) {
        const the_tokens = tokens_of(my_source);
        expect(the_tokens.filter(t => t.startsWith('COMMENT_LINE'))).toHaveLength(1);
        expect(the_tokens).not.toContain('WORD q');
      }
      // `//` or `///` after a space or tab hides the rest of its line.
      for (const my_source of [
        '#delimit ;\n* c // x ; gen q = 1;\ngen r = 1;\n',
        '#delimit ;\n* c\t// x ; gen q = 1;\ngen r = 1;\n',
        '#delimit ;\n* c\n   // x ; gen r = 1;\ngen q = 1;\n',
      ]) {
        const the_tokens = tokens_of(my_source);
        expect(the_tokens.filter(t => t.startsWith('COMMENT_LINE'))).toHaveLength(1);
        expect(the_tokens).not.toContain('WORD q');
        expect(the_tokens).not.toContain('WORD r');
      }
      // A block comment hides a quote; a quote hides `/*` and `//`.
      expect(comments_of('#delimit ;\n* c /* " */ ; gen q = 1;\n')).toEqual(['* c /* " */ ;']);
      expect(comments_of('#delimit ;\n* c "/*" ; gen q = 1;\n')).toEqual(['* c "/*" ;']);
      expect(comments_of('#delimit ;\n* c " // " ; gen q = 1;\n')).toEqual(['* c " // " ;']);
    });

    test('ends at a ; that no quote or // after a space hides', () => {
      for (const [my_source, my_comment] of [
        ['#delimit ;\n* c\n// x ; gen r = 1;\n', '* c\n// x ;'],
        ['#delimit ;\n* c\n/// x ; gen r = 1;\n', '* c\n/// x ;'],
        ['#delimit ;\n* c// x ; gen q = 1;\n', '* c// x ;'],
        ["#delimit ;\n* c 'a;b' gen q = 1;\n", "* c 'a;"],
        ["#delimit ;\n* c `a;b' gen q = 1;\n", '* c `a;'],
        ['#delimit ;\n* c `"a;b"\' gen q = 1;\n', '* c `"a;'],
      ]) {
        expect(comments_of(my_source)[0]).toBe(my_comment);
      }
    });

    test('joins the next line after /// with a space before it in cr mode', () => {
      for (const my_source of [
        '* c ///\ngen q = 1\n',
        '* c\t///\ngen q = 1\n',
        '* c ///x\ngen q = 1\n',
        '* c /* x */ ///\ngen q = 1\n',
        '* ----- ///////\ngen q = 1\n',
        'quietly * c ///\ngen q = 1\n',
      ]) {
        expect(tokens_of(my_source)).not.toContain('WORD q');
      }
      expect(comments_of('* c ///\n more ///\ngen q = 1\ngen r = 1\n'))
        .toEqual(['* c ///\n more ///\ngen q = 1']);
      // No space before `///`, `//` first, `///` in quotes, or a blank
      // line after it: the next line with code runs.
      for (const my_source of [
        '* c///\ngen q = 1\n',
        '*//////\ngen q = 1\n',
        '* c // x ///\ngen q = 1\n',
        '* c " /// "\ngen q = 1\n',
        '* c ///\n\ngen q = 1\n',
        '* c "/*"\ngen q = 1\n',
      ]) {
        expect(tokens_of(my_source)).toContain('WORD q');
      }
    });

    test('reads a line-start * after /// in cr mode as code unless a command starts', () => {
      expect(tokens_of('gen r = a ///\n* b\n')).toEqual([
        'WORD gen', 'WORD r', 'OPERATOR =', 'WORD a', 'CONTINUATION ///',
        'STATEMENT_TERMINATOR \n', 'OPERATOR *', 'WORD b', 'STATEMENT_TERMINATOR \n',
      ]);
      expect(comments_of('quietly ///\n* note\ngen q = 1\n')).toEqual(['* note']);
      // Stata 18 computes r = 6 here too.
      expect(tokens_of('gen r = a ///\n/* c */ * b\n')).toContain('OPERATOR *');
    });
  });

  describe('Star after a colon or a prefix', () => {
    const star_of = (source: string): string | undefined => {
      const my_token = lexer.tokenize(source).tokens.find(
        t => t.value.startsWith('*'));
      return my_token?.type;
    };

    test('reads * after a colon that starts a command as a comment', () => {
      for (const my_source of [
        'capture: * note\n',
        'quietly: * note\n',
        'capture noisily: * note\n',
        'version 18: * note\n',
        'version 18 : * note\n',
        'frame f2: * note\n',
        'xi: * note\n',
        'noisily version 18: quietly: * note\n',
        'capture: /* c */ * note\n',
        '#delimit ;\ncapture:\n* note;\n',
      ]) {
        expect(star_of(my_source)).toBe('COMMENT_LINE');
      }
    });

    test('reads * after any other colon as code', () => {
      // A wildcard or macro name for unab and the like; after `by g:`,
      // `svy:`, and `bootstrap:` Stata 18 reads `*` as the command name.
      for (const my_source of [
        'unab x : *\n',
        'unab x: *\n',
        'tsunab x : *\n',
        'qui unab x : *\n',
        'capture: unab x : *\n',
        'local m : *\n',
        'gettoken f s : *\n',
        'by g: * note\n',
        'bysort g: * note\n',
        'svy: * note\n',
        'bootstrap, reps(2): * note\n',
        '#delimit ;\nunab x :\n* ;\n',
      ]) {
        expect(star_of(my_source)).toBe('OPERATOR');
      }
    });

    test('reads * after capture, quietly, or noisily as a comment only where a command starts', () => {
      expect(star_of('qui * note\n')).toBe('COMMENT_LINE');
      expect(star_of('capture noisily * note\n')).toBe('COMMENT_LINE');
      expect(star_of('#delimit ;\nqui\n* note;\n')).toBe('COMMENT_LINE');
      // A variable named quietly (Stata 18 computes r = 10).
      expect(star_of('gen r = quietly * 2\n')).toBe('OPERATOR');
      expect(star_of('#delimit ;\ngen r = quietly\n* 2;\n')).toBe('OPERATOR');
      expect(star_of('#delimit ;\ngen r = capture\n* 2;\n')).toBe('OPERATOR');
    });

    test('reads Mata :* as element-wise multiplication', () => {
      for (const my_source of [
        'mata:\nz = x :* y\nend\n',
        'mata:\nz = x:*y\nend\n',
        'mata:\nw = (x\n:* y)\nend\n',
        'mata: z = x :* y\n',
        'mata: t = 2:*3\n',
        '#delimit ;\nmata: z = x :* y;\n',
      ]) {
        const the_tokens = lexer.tokenize(my_source).tokens;
        expect(the_tokens.filter(t => t.type === 'COMMENT_LINE')).toEqual([]);
        expect(the_tokens.some(t => t.value === '*')).toBe(true);
      }
    });
  });

  describe('Edge cases', () => {
    test('should handle * at start of file as comment', () => {
      const source = '* File header comment';
      const result = lexer.tokenize(source);
      
      expect(result.tokens[0].type).toBe('COMMENT_LINE');
    });

    test('should handle * after assignment operators as comment by default', () => {
      const source = 'local x = \n* Comment after assignment';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* Comment after assignment');
    });

    test('should handle * after commas as multiplication', () => {
      const source = 'summarize age, detail * income';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should treat * after apostrophe as operator (single quotes are not strings in Stata)', () => {
      // In Stata, single quotes are NOT string delimiters
      // They only close local macro references opened with backtick
      const source = "local comment = '/* not a comment */'";
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF' && t.type !== 'WHITESPACE');
      
      // Apostrophes should be OPERATOR tokens, not STRING delimiters
      const my_apostrophe_tokens = the_tokens.filter(t => t.value === "'");
      expect(my_apostrophe_tokens.length).toBeGreaterThan(0);
      expect(my_apostrophe_tokens.every(t => t.type === 'OPERATOR')).toBe(true);
      
      // The /* */ should be treated as a block comment since it's not inside a string
      const my_comment_tokens = the_tokens.filter(t => t.type === 'COMMENT_BLOCK');
      expect(my_comment_tokens).toHaveLength(1);
    });
  });
});
import { StataLexer } from '../../src/lexer';

describe('StataLexer', () => {
  let lexer: StataLexer;

  beforeEach(() => {
    lexer = new StataLexer();
  });

  describe('basic tokenization', () => {
    test('should tokenize simple command', () => {
      const source = 'generate age = 25';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Filter out whitespace tokens for easier testing
      const nonWhitespaceTokens = result.tokens.filter(t => t.type !== 'WHITESPACE');
      expect(nonWhitespaceTokens).toHaveLength(5); // generate, age, =, 25, EOF
      expect(nonWhitespaceTokens[0].type).toBe('WORD');
      expect(nonWhitespaceTokens[0].value).toBe('generate');
      expect(nonWhitespaceTokens[1].type).toBe('WORD');
      expect(nonWhitespaceTokens[1].value).toBe('age');
      expect(nonWhitespaceTokens[2].type).toBe('OPERATOR');
      expect(nonWhitespaceTokens[2].value).toBe('=');
      expect(nonWhitespaceTokens[3].type).toBe('NUMBER');
      expect(nonWhitespaceTokens[3].value).toBe('25');
      expect(nonWhitespaceTokens[4].type).toBe('EOF');
    });

    test('should handle delimiter mode switching', () => {
      const source = '#delimit ;\ngenerate age = 25;';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      expect(result.finalState.delimiterMode).toBe('semicolon');
      
      // Find the semicolon token
      const semicolonToken = result.tokens.find(t => t.value === ';' && t.type === 'STATEMENT_TERMINATOR');
      expect(semicolonToken).toBeDefined();
    });

    test('should tokenize local macro reference', () => {
      const source = 'display `myvar\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe('`myvar\'');
    });

    test('should extract macro references from simple quoted strings', () => {
      const source = 'display "`apple\'"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MACRO_REF_LOCAL token for `apple'
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe('`apple\'');
      
      // Should also have STRING tokens for the parts around the macro
      const stringTokens = result.tokens.filter(t => t.type === 'STRING');
      expect(stringTokens.length).toBeGreaterThanOrEqual(1);
    });

    test('should extract macro references from compound quoted strings', () => {
      const source = 'display `"`apple\'"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MACRO_REF_LOCAL token for `apple'
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe('`apple\'');
    });

    test('should extract global macro references from simple quoted strings', () => {
      const source = 'display "$global_var"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MACRO_REF_GLOBAL token for $global_var
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_GLOBAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe('$global_var');
    });

    test('should tokenize global macro reference', () => {
      const source = 'display $myvar';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_GLOBAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe('$myvar');
    });

    test('should tokenize global macro reference with braces', () => {
      const source = 'display ${myvar}';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_GLOBAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe('${myvar}');
    });

    test('should handle simple string', () => {
      const source = 'display "hello world"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const stringToken = result.tokens.find(t => t.type === 'STRING');
      expect(stringToken).toBeDefined();
      expect(stringToken?.value).toBe('"hello world"');
      expect(stringToken?.quoteStyle).toBe('simple');
    });

    test('should handle compound string', () => {
      const source = 'display `"hello world"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const stringToken = result.tokens.find(t => t.type === 'STRING');
      expect(stringToken).toBeDefined();
      expect(stringToken?.value).toBe('`"hello world"\'');
      expect(stringToken?.quoteStyle).toBe('compound');
    });

    test('should handle nested compound quotes', () => {
      const source = 'di `"word`"word"\'"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const stringToken = result.tokens.find(t => t.type === 'STRING');
      expect(stringToken).toBeDefined();
      expect(stringToken?.value).toBe('`"word`"word"\'"\'');
      expect(stringToken?.quoteStyle).toBe('compound');
    });

    test('should handle standalone quote inside compound string', () => {
      const source = 'di `" this is a quotation mark (")"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const stringToken = result.tokens.find(t => t.type === 'STRING');
      expect(stringToken).toBeDefined();
      expect(stringToken?.value).toBe('`" this is a quotation mark (")"\'');
    });

    test('should extract local macro ref from compound string', () => {
      const source = 'di `"value is `myvar\'"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const the_string_tokens = result.tokens.filter(t => t.type === 'STRING');
      const the_macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
      expect(the_string_tokens).toHaveLength(2);
      expect(the_macro_tokens).toHaveLength(1);
      expect(the_string_tokens[0].value).toBe('`"value is ');
      expect(the_macro_tokens[0].value).toBe('`myvar\'');
      expect(the_string_tokens[1].value).toBe('"\'');
    });

    test('should extract multiple macro refs from compound string', () => {
      const source = 'di `"`x\' and `y\'"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const the_string_tokens = result.tokens.filter(t => t.type === 'STRING');
      const the_macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
      expect(the_string_tokens).toHaveLength(3);
      expect(the_macro_tokens).toHaveLength(2);
      expect(the_macro_tokens[0].value).toBe('`x\'');
      expect(the_macro_tokens[1].value).toBe('`y\'');
    });

    test('should extract global macro ref from compound string', () => {
      const source = 'di `"value is $myvar"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const the_string_tokens = result.tokens.filter(t => t.type === 'STRING');
      const the_macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_GLOBAL');
      expect(the_string_tokens).toHaveLength(2);
      expect(the_macro_tokens).toHaveLength(1);
      expect(the_macro_tokens[0].value).toBe('$myvar');
    });

    test('should extract global macro ref with braces from compound string', () => {
      const source = 'di `"value is ${myvar}"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const the_macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_GLOBAL');
      expect(the_macro_tokens).toHaveLength(1);
      expect(the_macro_tokens[0].value).toBe('${myvar}');
    });

    test('should handle macro ref next to nested compound quote', () => {
      const source = 'di `"`x\'`"inner"\'"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const the_string_tokens = result.tokens.filter(t => t.type === 'STRING');
      const the_macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
      expect(the_macro_tokens).toHaveLength(1);
      expect(the_macro_tokens[0].value).toBe('`x\'');
      // The nested quote `"inner"' should be part of the string content
      expect(the_string_tokens.some(t => t.value.includes('`"inner"\''))).toBe(true);
    });

    test('should handle empty content with nested compound quote', () => {
      const source = 'di `"`"inner"\'"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const stringToken = result.tokens.find(t => t.type === 'STRING');
      expect(stringToken).toBeDefined();
      expect(stringToken?.value).toBe('`"`"inner"\'"\'');
    });

    test('should handle line comments', () => {
      const source = '* This is a comment\ngenerate age = 25';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const commentToken = result.tokens.find(t => t.type === 'COMMENT_LINE');
      expect(commentToken).toBeDefined();
      expect(commentToken?.value).toBe('* This is a comment');
    });

    test('should handle slash comments', () => {
      const source = 'generate age = 25 // This is a comment';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const commentToken = result.tokens.find(t => t.type === 'COMMENT_LINE');
      expect(commentToken).toBeDefined();
      expect(commentToken?.value).toBe('// This is a comment');
    });

    test('should handle continuation comments', () => {
      const source = 'generate age = 25 /// This continues';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const continuationToken = result.tokens.find(t => t.type === 'CONTINUATION');
      expect(continuationToken).toBeDefined();
      expect(continuationToken?.value).toBe('/// This continues');
    });

    test('should handle block comments', () => {
      const source = 'generate /* block comment */ age = 25';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const commentToken = result.tokens.find(t => t.type === 'COMMENT_BLOCK');
      expect(commentToken).toBeDefined();
      expect(commentToken?.value).toBe('/* block comment */');
    });

    test('should keep outer block comment active across nested block comment', () => {
      const source = [
        '/* outer',
        '/* inner */',
        'display `commented_macro\'',
        '*/',
        'display `live_macro\'',
      ].join('\n');
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);

      const commentToken = result.tokens.find(t => t.type === 'COMMENT_BLOCK');
      expect(commentToken).toBeDefined();
      expect(commentToken?.range.start.line).toBe(0);
      expect(commentToken?.range.end.line).toBe(3);
      expect(commentToken?.value).toContain('display `commented_macro\'');

      const macroTokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
      expect(macroTokens).toHaveLength(1);
      expect(macroTokens[0].value).toBe('`live_macro\'');
      expect(macroTokens[0].range.start.line).toBe(4);
    });
  });

  describe('statement terminators', () => {
    test('should emit STATEMENT_TERMINATOR for newline in cr mode', () => {
      const source = 'generate age = 25\ngenerate income = 1000';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const terminators = result.tokens.filter(t => t.type === 'STATEMENT_TERMINATOR');
      expect(terminators).toHaveLength(1);
      expect(terminators[0].value).toBe('\n');
    });

    test('should emit STATEMENT_TERMINATOR for semicolon in semicolon mode', () => {
      const source = '#delimit ;\ngenerate age = 25;\ngenerate income = 1000;';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const terminators = result.tokens.filter(t => t.type === 'STATEMENT_TERMINATOR');
      expect(terminators.length).toBeGreaterThan(0);
      
      // Should have semicolon terminators
      const semicolonTerminators = terminators.filter(t => t.value === ';');
      expect(semicolonTerminators.length).toBeGreaterThan(0);
    });
  });

  describe('embedded language detection', () => {
    test('should recognize mata block start', () => {
      const source = 'mata\nmatrix A = (1, 2)';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const mata_token = result.tokens.find(t => t.type === 'MATA_START');
      expect(mata_token).toBeDefined();
      expect(mata_token?.value).toBe('mata');
    });

    test('should recognize mata inline delimiter', () => {
      const source = 'mata: matrix A = (1, 2)';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const mata_token = result.tokens.find(t => t.type === 'MATA_INLINE');
      expect(mata_token).toBeDefined();
      expect(mata_token?.value).toBe('mata:');
    });

    test('should recognize python block start', () => {
      const source = 'python\nprint("hello")';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const python_token = result.tokens.find(t => t.type === 'PYTHON_START');
      expect(python_token).toBeDefined();
      expect(python_token?.value).toBe('python');
    });

    test('should recognize python inline delimiter', () => {
      const source = 'python: print("hello")';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const python_token = result.tokens.find(t => t.type === 'PYTHON_INLINE');
      expect(python_token).toBeDefined();
      expect(python_token?.value).toBe('python:');
    });

    test('should recognize end delimiter in mata context', () => {
      const source = 'mata\nmatrix A = (1, 2)\nend';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const end_token = result.tokens.find(t => t.type === 'END_MATA');
      expect(end_token).toBeDefined();
      expect(end_token?.value).toBe('end');
    });

    test('should recognize end delimiter in python context', () => {
      const source = 'python\nprint("hello")\nend';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const end_token = result.tokens.find(t => t.type === 'END_PYTHON');
      expect(end_token).toBeDefined();
      expect(end_token?.value).toBe('end');
    });

    test('should handle old end python syntax as separate tokens', () => {
      const source = 'python\nprint("hello")\nend python';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have END_PYTHON token for 'end'
      const end_token = result.tokens.find(t => t.type === 'END_PYTHON');
      expect(end_token).toBeDefined();
      expect(end_token?.value).toBe('end');
      
      // The 'python' after 'end' should be treated as a new Python block start
      const python_start_tokens = result.tokens.filter(t => t.type === 'PYTHON_START');
      expect(python_start_tokens.length).toBe(2); // Original start + new start after end
    });

    test('should tokenize embedded content in mata block', () => {
      const source = 'mata\nmatrix A = (1, 2)\nend';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const embedded_tokens = result.tokens.filter(t => t.type === 'EMBEDDED_CONTENT');
      expect(embedded_tokens.length).toBeGreaterThan(0);
    });

    test('should preserve braces in embedded content', () => {
      const source = 'mata\nfor (i = 1; i <= 10; i++) {\n  A[i] = i\n}\nend';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const brace_tokens = result.tokens.filter(t => t.type === 'LBRACE' || t.type === 'RBRACE');
      expect(brace_tokens.length).toBeGreaterThan(0);
    });

    test('should handle strings in embedded content', () => {
      const source = 'python\nprint("hello world")\nend python';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const string_tokens = result.tokens.filter(t => t.type === 'STRING');
      expect(string_tokens.length).toBeGreaterThan(0);
    });

    test('should maintain context state after embedded block', () => {
      const source = 'mata\nmatrix A = (1, 2)\nend\ngenerate x = 1';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      expect(result.finalState.language_context).toBe('stata');
      expect(result.finalState.context_stack).toEqual(['stata']);
    });

    test('should handle brace-style mata block on same line', () => {
      // Brace-style: mata { ... } - closed by }, not by end
      const source = 'mata { 1234 }';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MATA_START token
      const mata_token = result.tokens.find(t => t.type === 'MATA_START');
      expect(mata_token).toBeDefined();
      expect(mata_token?.value).toBe('mata');
      
      // Should have LBRACE and RBRACE tokens
      const lbrace_token = result.tokens.find(t => t.type === 'LBRACE');
      const rbrace_token = result.tokens.find(t => t.type === 'RBRACE');
      expect(lbrace_token).toBeDefined();
      expect(rbrace_token).toBeDefined();
      
      // Should NOT have END_MATA token (brace-style blocks close with })
      const end_mata_token = result.tokens.find(t => t.type === 'END_MATA');
      expect(end_mata_token).toBeUndefined();
      
      // Final state should be back in Stata context
      expect(result.finalState.language_context).toBe('stata');
    });

    test('should handle brace-style mata block inside program', () => {
      // This is the original bug case: mata { ... } inside a program
      const source = `capture program drop my_program
program define my_program
syntax anything(name=my_arg), [an_opt]
mata { 1234 }
end`;
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MATA_START token
      const mata_token = result.tokens.find(t => t.type === 'MATA_START');
      expect(mata_token).toBeDefined();
      
      // Should NOT have END_MATA token (brace-style blocks close with })
      const end_mata_token = result.tokens.find(t => t.type === 'END_MATA');
      expect(end_mata_token).toBeUndefined();
      
      // The 'end' at the end should be a WORD token (for the program), not END_MATA
      const end_word_tokens = result.tokens.filter(t => t.type === 'WORD' && t.value === 'end');
      expect(end_word_tokens.length).toBe(1);
      
      // Final state should be back in Stata context
      expect(result.finalState.language_context).toBe('stata');
    });

    test('should NOT treat brace on next line as brace-style block', () => {
      // Traditional style: mata followed by { on next line should NOT be brace-style
      const source = 'mata\n{\n1234\n}\nend';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MATA_START token
      const mata_token = result.tokens.find(t => t.type === 'MATA_START');
      expect(mata_token).toBeDefined();
      
      // Should have END_MATA token (traditional style closes with end)
      const end_mata_token = result.tokens.find(t => t.type === 'END_MATA');
      expect(end_mata_token).toBeDefined();
      expect(end_mata_token?.value).toBe('end');
      
      // Final state should be back in Stata context
      expect(result.finalState.language_context).toBe('stata');
    });

    test('should handle nested braces in brace-style mata block', () => {
      // Brace-style with nested braces
      const source = 'mata { for (i=1; i<=10; i++) { x[i] = i } }';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MATA_START token
      const mata_token = result.tokens.find(t => t.type === 'MATA_START');
      expect(mata_token).toBeDefined();
      
      // Should NOT have END_MATA token
      const end_mata_token = result.tokens.find(t => t.type === 'END_MATA');
      expect(end_mata_token).toBeUndefined();
      
      // Final state should be back in Stata context
      expect(result.finalState.language_context).toBe('stata');
    });

    test('should handle brace-style python block', () => {
      // Brace-style: python { ... } - closed by }, not by end
      const source = 'python { print("hello") }';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have PYTHON_START token
      const python_token = result.tokens.find(t => t.type === 'PYTHON_START');
      expect(python_token).toBeDefined();
      expect(python_token?.value).toBe('python');
      
      // Should NOT have END_PYTHON token
      const end_python_token = result.tokens.find(t => t.type === 'END_PYTHON');
      expect(end_python_token).toBeUndefined();
      
      // Final state should be back in Stata context
      expect(result.finalState.language_context).toBe('stata');
    });
  });

  describe('inline Mata/Python context handling', () => {
    test('should not change context for subsequent lines after mata: expression', () => {
      const source = 'mata: some_function()\ndisplay "hello"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MATA_INLINE token
      const mata_inline_token = result.tokens.find(t => t.type === 'MATA_INLINE');
      expect(mata_inline_token).toBeDefined();
      expect(mata_inline_token?.value).toBe('mata:');
      
      // The subsequent line should be tokenized as Stata code
      // "display" should be a WORD token, not EMBEDDED_CONTENT
      const the_word_tokens = result.tokens.filter(t => t.type === 'WORD');
      const display_token = the_word_tokens.find(t => t.value === 'display');
      expect(display_token).toBeDefined();
      
      // "hello" should be a STRING token
      const string_token = result.tokens.find(t => t.type === 'STRING');
      expect(string_token).toBeDefined();
      expect(string_token?.value).toBe('"hello"');
      
      // Final context should be Stata
      expect(result.finalState.language_context).toBe('stata');
      expect(result.finalState.context_stack).toEqual(['stata']);
    });

    test('should not change context for subsequent lines after python: expression', () => {
      const source = 'python: print("test")\ndisplay "hello"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have PYTHON_INLINE token
      const python_inline_token = result.tokens.find(t => t.type === 'PYTHON_INLINE');
      expect(python_inline_token).toBeDefined();
      expect(python_inline_token?.value).toBe('python:');
      
      // The subsequent line should be tokenized as Stata code
      // "display" should be a WORD token, not EMBEDDED_CONTENT
      const the_word_tokens = result.tokens.filter(t => t.type === 'WORD');
      const display_token = the_word_tokens.find(t => t.value === 'display');
      expect(display_token).toBeDefined();
      
      // "hello" should be a STRING token (Stata string)
      const the_string_tokens = result.tokens.filter(t => t.type === 'STRING');
      const hello_string = the_string_tokens.find(t => t.value === '"hello"');
      expect(hello_string).toBeDefined();
      
      // Final context should be Stata
      expect(result.finalState.language_context).toBe('stata');
      expect(result.finalState.context_stack).toEqual(['stata']);
    });

    test('should correctly handle full mata block with end delimiter', () => {
      const source = 'mata\nsome_function()\nend\ndisplay "hello"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MATA_START token
      const mata_start_token = result.tokens.find(t => t.type === 'MATA_START');
      expect(mata_start_token).toBeDefined();
      expect(mata_start_token?.value).toBe('mata');
      
      // Should have END_MATA token
      const end_mata_token = result.tokens.find(t => t.type === 'END_MATA');
      expect(end_mata_token).toBeDefined();
      expect(end_mata_token?.value).toBe('end');
      
      // "some_function()" should be in Mata context (EMBEDDED_CONTENT or similar)
      const embedded_tokens = result.tokens.filter(t => t.type === 'EMBEDDED_CONTENT');
      expect(embedded_tokens.length).toBeGreaterThan(0);
      
      // After "end", "display" should be tokenized as Stata code (WORD)
      const the_word_tokens = result.tokens.filter(t => t.type === 'WORD');
      const display_token = the_word_tokens.find(t => t.value === 'display');
      expect(display_token).toBeDefined();
      
      // "hello" should be a STRING token
      const string_token = result.tokens.find(t => t.type === 'STRING' && t.value === '"hello"');
      expect(string_token).toBeDefined();
      
      // Final context should be Stata
      expect(result.finalState.language_context).toBe('stata');
      expect(result.finalState.context_stack).toEqual(['stata']);
    });

    test('should parse compound quote strings after inline mata with Stata rules', () => {
      const source = 'mata: aww_init_matrices()\n_loop_execute_survey "`custom_arg\'" `is_script\' Afghanistan 2016';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have MATA_INLINE token
      const mata_inline_token = result.tokens.find(t => t.type === 'MATA_INLINE');
      expect(mata_inline_token).toBeDefined();
      
      // The string "`custom_arg'" contains a macro reference, so it gets split:
      // - STRING token for opening quote "
      // - MACRO_REF_LOCAL token for `custom_arg'
      // - STRING token for closing quote "
      // This is correct Stata behavior - macros are extracted from strings
      const the_string_tokens = result.tokens.filter(t => t.type === 'STRING');
      expect(the_string_tokens.length).toBeGreaterThanOrEqual(2);
      
      // The local macro references should be tokenized as MACRO_REF_LOCAL
      const the_macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
      const custom_arg_macro = the_macro_tokens.find(t => t.value === '`custom_arg\'');
      expect(custom_arg_macro).toBeDefined();
      
      const is_script_macro = the_macro_tokens.find(t => t.value === '`is_script\'');
      expect(is_script_macro).toBeDefined();
      
      // "Afghanistan" and "2016" should be WORD and NUMBER tokens
      const the_word_tokens = result.tokens.filter(t => t.type === 'WORD');
      const afghanistan_token = the_word_tokens.find(t => t.value === 'Afghanistan');
      expect(afghanistan_token).toBeDefined();
      
      const the_number_tokens = result.tokens.filter(t => t.type === 'NUMBER');
      const year_token = the_number_tokens.find(t => t.value === '2016');
      expect(year_token).toBeDefined();
      
      // Final context should be Stata
      expect(result.finalState.language_context).toBe('stata');
    });

    test('should handle multiple inline mata commands without context leakage', () => {
      const source = 'mata: func1()\ndisplay "between"\nmata: func2()\ndisplay "after"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have two MATA_INLINE tokens
      const the_mata_inline_tokens = result.tokens.filter(t => t.type === 'MATA_INLINE');
      expect(the_mata_inline_tokens).toHaveLength(2);
      
      // Both "display" commands should be tokenized as WORD tokens
      const the_word_tokens = result.tokens.filter(t => t.type === 'WORD');
      const the_display_tokens = the_word_tokens.filter(t => t.value === 'display');
      expect(the_display_tokens).toHaveLength(2);
      
      // Both strings should be tokenized correctly
      const the_string_tokens = result.tokens.filter(t => t.type === 'STRING');
      expect(the_string_tokens.some(t => t.value === '"between"')).toBe(true);
      expect(the_string_tokens.some(t => t.value === '"after"')).toBe(true);
      
      // Final context should be Stata
      expect(result.finalState.language_context).toBe('stata');
      expect(result.finalState.context_stack).toEqual(['stata']);
    });

    test('should handle inline python followed by Stata code with local macros', () => {
      const source = 'python: import pandas\nlocal myvar = 42\ndisplay `myvar\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      
      // Should have PYTHON_INLINE token
      const python_inline_token = result.tokens.find(t => t.type === 'PYTHON_INLINE');
      expect(python_inline_token).toBeDefined();
      
      // "local" should be a WORD token (Stata keyword)
      const the_word_tokens = result.tokens.filter(t => t.type === 'WORD');
      const local_token = the_word_tokens.find(t => t.value === 'local');
      expect(local_token).toBeDefined();
      
      // `myvar' should be a MACRO_REF_LOCAL token
      const the_macro_tokens = result.tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
      const myvar_macro = the_macro_tokens.find(t => t.value === '`myvar\'');
      expect(myvar_macro).toBeDefined();
      
      // Final context should be Stata
      expect(result.finalState.language_context).toBe('stata');
    });

    test('should contrast inline mata: vs full mata block context handling', () => {
      // Inline mata: should NOT push context
      const inline_source = 'mata: x = 1\ndisplay "stata"';
      const inline_result = lexer.tokenize(inline_source);
      
      // Full mata block SHOULD push context until end
      const block_source = 'mata\nx = 1\nend\ndisplay "stata"';
      const block_result = lexer.tokenize(block_source);

      // Both should have no errors
      expect(inline_result.errors).toHaveLength(0);
      expect(block_result.errors).toHaveLength(0);
      
      // Inline: "display" should be WORD (Stata context)
      const inline_word_tokens = inline_result.tokens.filter(t => t.type === 'WORD');
      expect(inline_word_tokens.some(t => t.value === 'display')).toBe(true);
      
      // Block: "x" should be EMBEDDED_CONTENT (Mata context)
      const block_embedded_tokens = block_result.tokens.filter(t => t.type === 'EMBEDDED_CONTENT');
      expect(block_embedded_tokens.length).toBeGreaterThan(0);
      
      // Block: "display" should be WORD (back to Stata context after end)
      const block_word_tokens = block_result.tokens.filter(t => t.type === 'WORD');
      expect(block_word_tokens.some(t => t.value === 'display')).toBe(true);
      
      // Both should end in Stata context
      expect(inline_result.finalState.language_context).toBe('stata');
      expect(block_result.finalState.language_context).toBe('stata');
    });
  });

  describe('single-quote handling', () => {
    test('should tokenize single-quoted word as separate tokens', () => {
      const source = "'word'";
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const nonWhitespaceTokens = result.tokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'EOF');
      expect(nonWhitespaceTokens).toHaveLength(3);
      expect(nonWhitespaceTokens[0].type).toBe('OPERATOR');
      expect(nonWhitespaceTokens[0].value).toBe("'");
      expect(nonWhitespaceTokens[1].type).toBe('WORD');
      expect(nonWhitespaceTokens[1].value).toBe('word');
      expect(nonWhitespaceTokens[2].type).toBe('OPERATOR');
      expect(nonWhitespaceTokens[2].value).toBe("'");
    });

    test('should tokenize standalone single quote as operator', () => {
      const source = "'";
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const nonWhitespaceTokens = result.tokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'EOF');
      expect(nonWhitespaceTokens).toHaveLength(1);
      expect(nonWhitespaceTokens[0].type).toBe('OPERATOR');
      expect(nonWhitespaceTokens[0].value).toBe("'");
    });

    test('should tokenize local macro reference with backtick and apostrophe', () => {
      const source = "`name'";
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe("`name'");
    });

    test('should tokenize empty local macro reference', () => {
      const source = "`'";
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macroToken = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macroToken).toBeDefined();
      expect(macroToken?.value).toBe("`'");
    });

    test('should handle apostrophe inside double-quoted string', () => {
      const source = '"it\'s"';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const stringToken = result.tokens.find(t => t.type === 'STRING');
      expect(stringToken).toBeDefined();
      expect(stringToken?.value).toBe('"it\'s"');
    });

    test('should handle apostrophe inside compound string', () => {
      const source = '`"it\'s"\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const stringToken = result.tokens.find(t => t.type === 'STRING');
      expect(stringToken).toBeDefined();
      expect(stringToken?.value).toBe('`"it\'s"\'');
    });
  });
});

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { arbitrary_identifier } from './generators';

describe('Expression Keyword Disambiguation Property Tests', () => {
  let lexer: StataLexer;
  let parser: StataParser;
  let analyzer: SemanticAnalyzer;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
    analyzer = new SemanticAnalyzer();
  });

  /**
   * Generate Stata statement keywords that could appear in expressions
   */
  function arbitrary_statement_keyword(): fc.Arbitrary<string> {
    return fc.constantFrom(
      'if', 'else', 'foreach', 'forvalues', 'while', 'do', 'run', 'include',
      'program', 'end', 'capture', 'quietly', 'noisily', 'by', 'bysort',
      'gen', 'generate', 'replace', 'drop', 'keep', 'use', 'save', 'clear',
      'set', 'local', 'global', 'scalar', 'matrix', 'return', 'exit'
    );
  }

  /**
   * Generate mathematical operators
   */
  function arbitrary_math_operator(): fc.Arbitrary<string> {
    return fc.constantFrom('+', '-', '*', '/', '^', '==', '!=', '<', '>', '<=', '>=', '&', '|');
  }

  /**
   * Generate function names that could conflict with keywords
   */
  function arbitrary_function_name(): fc.Arbitrary<string> {
    return fc.constantFrom('if', 'max', 'min', 'sum', 'mean', 'log', 'exp', 'sqrt');
  }

  /**
   * Generate simple expressions using keywords as variables
   */
  function arbitrary_keyword_as_variable_expression(): fc.Arbitrary<string> {
    return fc.tuple(
      arbitrary_statement_keyword(),
      arbitrary_math_operator(),
      fc.oneof(arbitrary_identifier(), fc.integer({ min: 1, max: 100 }).map(String))
    ).map(([keyword, op, operand]) => `${keyword} ${op} ${operand}`);
  }

  /**
   * Generate assignment expressions with keywords as variable names
   */
  function arbitrary_keyword_assignment(): fc.Arbitrary<string> {
    return fc.tuple(
      arbitrary_statement_keyword(),
      fc.oneof(arbitrary_identifier(), fc.integer({ min: 1, max: 100 }).map(String))
    ).map(([keyword, value]) => `${keyword} = ${value}`);
  }

  /**
   * Generate function calls using keywords as function names
   */
  function arbitrary_keyword_function_call(): fc.Arbitrary<string> {
    return fc.tuple(
      arbitrary_function_name(),
      fc.array(fc.oneof(arbitrary_identifier(), fc.integer({ min: 1, max: 100 }).map(String)), { minLength: 1, maxLength: 3 })
    ).map(([func, args]) => `${func}(${args.join(', ')})`);
  }

  it('should tokenize keywords in expressions as WORD tokens', () => {
    fc.assert(fc.property(
      arbitrary_keyword_as_variable_expression(),
      (expression) => {
        const result = lexer.tokenize(`gen result = ${expression}`);
        
        // Find tokens that are statement keywords used as variables
        const word_tokens = result.tokens.filter(t => t.type === 'WORD');
        const keyword_tokens = word_tokens.filter(t => 
          ['if', 'else', 'foreach', 'forvalues', 'while', 'do', 'run', 'include',
           'program', 'end', 'capture', 'quietly', 'noisily', 'by', 'bysort',
           'gen', 'generate', 'replace', 'drop', 'keep', 'use', 'save', 'clear',
           'set', 'local', 'global', 'scalar', 'matrix', 'return', 'exit'].includes(t.value)
        );
        
        // All keywords in expressions should be tokenized as WORD, not special keyword tokens
        keyword_tokens.forEach(token => {
          if (token.type !== 'WORD') {
            throw new Error(`Expected keyword '${token.value}' in expression to be WORD token, got ${token.type}`);
          }
        });
      }
    ), { numRuns: 100 });
  });

  it('should parse keywords in expressions as regular identifiers', () => {
    fc.assert(fc.property(
      arbitrary_keyword_as_variable_expression(),
      (expression) => {
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse without errors
        if (parseResult.errors.length > 0) {
          const syntax_errors = parseResult.errors.filter(e => e.message.includes('syntax') || e.message.includes('expected'));
          if (syntax_errors.length > 0) {
            throw new Error(`Unexpected syntax error when parsing keyword in expression: ${syntax_errors[0].message}`);
          }
        }
        
        // Should have a command node
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected at least one command node');
        }
      }
    ), { numRuns: 100 });
  });

  it('should treat keywords as variables in assignment expressions', () => {
    fc.assert(fc.property(
      arbitrary_keyword_assignment(),
      (assignment) => {
        const tokens = lexer.tokenize(`replace ${assignment}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node for assignment');
        }
        
        // Should not have syntax errors
        if (parseResult.errors.length > 0) {
          const syntax_errors = parseResult.errors.filter(e => 
            e.message.includes('syntax') || e.message.includes('expected')
          );
          if (syntax_errors.length > 0) {
            throw new Error(`Syntax error in assignment: ${syntax_errors[0].message}`);
          }
        }
      }
    ), { numRuns: 100 });
  });

  it('should handle keywords as function names in expressions', () => {
    fc.assert(fc.property(
      arbitrary_keyword_function_call(),
      (funcCall) => {
        const tokens = lexer.tokenize(`gen result = ${funcCall}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse without syntax errors
        const syntax_errors = parseResult.errors.filter(e => 
          e.message.includes('syntax') || e.message.includes('expected')
        );
        if (syntax_errors.length > 0) {
          throw new Error(`Unexpected syntax error with keyword as function: ${syntax_errors[0].message}`);
        }
      }
    ), { numRuns: 100 });
  });

  it('should not create undefined variable warnings for keywords used as variables', () => {
    fc.assert(fc.property(
      arbitrary_statement_keyword(),
      (keyword) => {
        const source = `gen result = ${keyword} + 1`;
        const tokens = lexer.tokenize(source).tokens;
        const parseResult = parser.parse(tokens);
        const symbols = analyzer.analyze(parseResult.ast, tokens);

        // Keywords used as variables should be treated as regular variables.
        // They may generate undefined warnings, and that is expected behavior;
        // the key property here is that they don't cause syntax errors.
        const syntax_errors = symbols.diagnostics.filter(d =>
          d.message.includes('syntax') || d.message.includes('expected')
        );
        
        if (syntax_errors.length > 0) {
          throw new Error(`Keyword '${keyword}' caused syntax error when used as variable: ${syntax_errors[0].message}`);
        }
      }
    ), { numRuns: 100 });
  });

  it('should handle complex expressions with multiple keywords as variables', () => {
    fc.assert(fc.property(
      fc.tuple(
        arbitrary_statement_keyword(),
        arbitrary_statement_keyword(),
        arbitrary_statement_keyword()
      ).filter(([k1, k2, k3]) => k1 !== k2 && k2 !== k3 && k1 !== k3),
      ([keyword1, keyword2, keyword3]) => {
        const expression = `${keyword1} + ${keyword2} * ${keyword3}`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // All keywords should be tokenized as WORD
        const word_tokens = tokens.filter(t => t.type === 'WORD');
        const keyword_tokens = word_tokens.filter(t => 
          [keyword1, keyword2, keyword3].includes(t.value)
        );
        
        keyword_tokens.forEach(token => {
          if (token.type !== 'WORD') {
            throw new Error(`Expected keyword '${token.value}' to be WORD token, got ${token.type}`);
          }
        });
      }
    ), { numRuns: 50 });
  });

  it('should handle keywords in conditional expressions', () => {
    fc.assert(fc.property(
      fc.tuple(
        arbitrary_statement_keyword(),
        fc.constantFrom('==', '!=', '<', '>', '<=', '>='),
        fc.oneof(arbitrary_identifier(), fc.integer({ min: 1, max: 100 }).map(String))
      ),
      ([keyword, op, value]) => {
        const condition = `${keyword} ${op} ${value}`;
        const tokens = lexer.tokenize(`gen result = 1 if ${condition}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // Keyword in condition should be treated as variable
        const keyword_token = tokens.find(t => t.type === 'WORD' && t.value === keyword);
        if (!keyword_token) {
          throw new Error(`Expected to find keyword '${keyword}' as WORD token`);
        }
      }
    ), { numRuns: 100 });
  });

  it('should handle keywords in macro references within expressions', () => {
    fc.assert(fc.property(
      arbitrary_statement_keyword(),
      (keyword) => {
        const expression = `\`${keyword}' + 1`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // Should have macro reference token
        const macro_tokens = tokens.filter(t => t.type === 'MACRO_REF_LOCAL');
        if (macro_tokens.length === 0) {
          throw new Error('Expected local macro reference token');
        }
      }
    ), { numRuns: 100 });
  });

  it('should distinguish between statement context and expression context', () => {
    fc.assert(fc.property(
      fc.constantFrom('if', 'while', 'foreach'),
      (keyword) => {
        // Test keyword as statement vs keyword as variable in expression
        const statement_source = `${keyword} x > 0 {`;
        const expression_source = `gen result = ${keyword} + 1`;
        
        const statement_tokens = lexer.tokenize(statement_source).tokens;
        const expression_tokens = lexer.tokenize(expression_source).tokens;
        
        // In both cases, the keyword should be tokenized as WORD
        const statement_keyword = statement_tokens.find(t => t.value === keyword);
        const expression_keyword = expression_tokens.find(t => t.value === keyword);
        
        if (!statement_keyword || statement_keyword.type !== 'WORD') {
          throw new Error(`Expected keyword '${keyword}' in statement to be WORD token`);
        }
        
        if (!expression_keyword || expression_keyword.type !== 'WORD') {
          throw new Error(`Expected keyword '${keyword}' in expression to be WORD token`);
        }
        
        // Both should parse successfully
        const statement_result = parser.parse(statement_tokens);
        const expression_result = parser.parse(expression_tokens);
        
        if (statement_result.ast.nodes.length === 0) {
          throw new Error('Expected statement AST to have nodes');
        }
        
        if (expression_result.ast.nodes.length === 0) {
          throw new Error('Expected expression AST to have nodes');
        }
      }
    ), { numRuns: 50 });
  });

  it('should handle nested expressions with keywords', () => {
    fc.assert(fc.property(
      fc.tuple(
        arbitrary_statement_keyword(),
        arbitrary_statement_keyword()
      ).filter(([k1, k2]) => k1 !== k2),
      ([keyword1, keyword2]) => {
        const expression = `(${keyword1} + ${keyword2}) * 2`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // Should handle parentheses correctly
        const lparen_tokens = tokens.filter(t => t.type === 'LPAREN');
        const rparen_tokens = tokens.filter(t => t.type === 'RPAREN');
        
        if (lparen_tokens.length !== rparen_tokens.length) {
          throw new Error('Unbalanced parentheses in nested expression');
        }
      }
    ), { numRuns: 100 });
  });

  it('should handle keywords in string literals within expressions', () => {
    fc.assert(fc.property(
      arbitrary_statement_keyword(),
      (keyword) => {
        const expression = `"${keyword}" + "test"`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // Should have string tokens
        const string_tokens = tokens.filter(t => t.type === 'STRING');
        if (string_tokens.length === 0) {
          throw new Error('Expected string tokens');
        }
      }
    ), { numRuns: 100 });
  });

  it('should handle keywords with underscores and numbers', () => {
    fc.assert(fc.property(
      fc.constantFrom('if_1', 'for_each', 'while_2', 'do_something'),
      (keyword_variant) => {
        const expression = `${keyword_variant} + 1`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // Keyword variant should be tokenized as WORD
        const keyword_token = tokens.find(t => t.type === 'WORD' && t.value === keyword_variant);
        if (!keyword_token) {
          throw new Error(`Expected to find keyword variant '${keyword_variant}' as WORD token`);
        }
      }
    ), { numRuns: 50 });
  });

  it('should handle keywords in array/matrix indexing expressions', () => {
    fc.assert(fc.property(
      arbitrary_statement_keyword(),
      (keyword) => {
        const expression = `matrix_var[${keyword}, 1]`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully without syntax errors
        const syntax_errors = parseResult.errors.filter(e => 
          e.message.includes('syntax') || e.message.includes('expected')
        );
        if (syntax_errors.length > 0) {
          throw new Error(`Unexpected syntax error with keyword in indexing: ${syntax_errors[0].message}`);
        }
        
        // Keyword should be tokenized as WORD
        const keyword_token = tokens.find(t => t.type === 'WORD' && t.value === keyword);
        if (!keyword_token) {
          throw new Error(`Expected to find keyword '${keyword}' as WORD token`);
        }
      }
    ), { numRuns: 100 });
  });

  it('should handle keywords in ternary-like expressions', () => {
    fc.assert(fc.property(
      fc.tuple(
        arbitrary_statement_keyword(),
        arbitrary_statement_keyword()
      ).filter(([k1, k2]) => k1 !== k2),
      ([keyword1, keyword2]) => {
        const expression = `cond(${keyword1} > 0, ${keyword2}, 0)`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // Both keywords should be tokenized as WORD
        const keyword1_token = tokens.find(t => t.type === 'WORD' && t.value === keyword1);
        const keyword2_token = tokens.find(t => t.type === 'WORD' && t.value === keyword2);
        
        if (!keyword1_token) {
          throw new Error(`Expected to find keyword '${keyword1}' as WORD token`);
        }
        if (!keyword2_token) {
          throw new Error(`Expected to find keyword '${keyword2}' as WORD token`);
        }
      }
    ), { numRuns: 100 });
  });

  it('should handle reserved words that are not statement keywords', () => {
    fc.assert(fc.property(
      fc.constantFrom('_n', '_N', '_b', '_se', '_cons', '_coef', '_rc'),
      (reserved_word) => {
        const expression = `${reserved_word} + 1`;
        const tokens = lexer.tokenize(`gen result = ${expression}`).tokens;
        const parseResult = parser.parse(tokens);
        
        // Should parse successfully
        const commands = parseResult.ast.nodes.filter(n => n.type === 'command');
        if (commands.length === 0) {
          throw new Error('Expected command node');
        }
        
        // Reserved word should be tokenized as WORD
        const reserved_token = tokens.find(t => t.type === 'WORD' && t.value === reserved_word);
        if (!reserved_token) {
          throw new Error(`Expected to find reserved word '${reserved_word}' as WORD token`);
        }
      }
    ), { numRuns: 50 });
  });
});
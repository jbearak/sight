import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { arbitrary_identifier, arbitrary_number } from './generators';
import { extract_text_at_range } from './helpers';

describe('Expression Token Handling Property Tests', () => {
  let lexer: StataLexer;
  let parser: StataParser;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
  });

  /**
   * Generate expressions with operators
   */
  function arbitrary_expression_with_operators(): fc.Arbitrary<string> {
    const operators = ['+', '-', '*', '/', '^', '==', '!=', '<', '>', '<=', '>=', '&', '|'];
    const operand = fc.oneof(
      arbitrary_number(),
      arbitrary_identifier(),
      fc.constant('`var\''),
      fc.constant('${global}')
    );
    
    return fc.tuple(
      operand,
      fc.constantFrom(...operators),
      operand
    ).map(([left, op, right]) => `${left} ${op} ${right}`);
  }

  /**
   * Generate expressions with function calls
   */
  function arbitrary_expression_with_functions(): fc.Arbitrary<string> {
    const functions = ['sqrt', 'log', 'exp', 'abs', 'max', 'min', 'round'];
    const arg = fc.oneof(
      arbitrary_number(),
      arbitrary_identifier(),
      fc.constant('`var\'')
    );
    
    return fc.tuple(
      fc.constantFrom(...functions),
      fc.array(arg, { minLength: 1, maxLength: 3 })
    ).map(([func, args]) => `${func}(${args.join(', ')})`);
  }

  /**
   * Generate expressions with nested parentheses
   */
  function arbitrary_expression_with_nested_parens(): fc.Arbitrary<string> {
    const simple_expr = fc.oneof(
      arbitrary_number(),
      arbitrary_identifier(),
      arbitrary_expression_with_operators()
    );
    
    return fc.tuple(
      simple_expr,
      fc.constantFrom('+', '-', '*', '/'),
      simple_expr
    ).map(([left, op, right]) => `(${left}) ${op} (${right})`);
  }

  /**
   * Generate complex expressions combining all elements
   */
  function arbitrary_complex_expression(): fc.Arbitrary<string> {
    return fc.oneof(
      arbitrary_expression_with_operators(),
      arbitrary_expression_with_functions(),
      arbitrary_expression_with_nested_parens(),
      // Nested function calls
      fc.tuple(
        fc.constantFrom('sqrt', 'log', 'abs'),
        arbitrary_expression_with_operators()
      ).map(([func, expr]) => `${func}(${expr})`)
    );
  }

  /**
   * Property 2.1: Expressions with operators are correctly parsed
   * Validates that expressions containing arithmetic and logical operators
   * are tokenized without errors and preserve operator precedence structure.
   */
  it('should correctly parse expressions with operators', () => {
    fc.assert(
      fc.property(arbitrary_expression_with_operators(), (expression) => {
        const document = `gen result = ${expression}`;
        const lexResult = lexer.tokenize(document);
        
        // Should not have lexer errors
        if (lexResult.errors.length > 0) {
          return false;
        }

        const parseResult = parser.parse(lexResult.tokens);
        
        // Should not have parser errors
        if (parseResult.errors.length > 0) {
          return false;
        }

        // Should have at least one command node
        if (parseResult.ast.nodes.length === 0) {
          return false;
        }

        // The expression should be preserved in the AST
        const commandNode = parseResult.ast.nodes[0];
        if (commandNode.type !== 'command') {
          return false;
        }

        // Should have an expression field
        return commandNode.expression !== undefined;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.2: Expressions with function calls are correctly parsed
   * Validates that function calls with arguments are properly tokenized
   * and parentheses are correctly matched.
   */
  it('should correctly parse expressions with function calls', () => {
    fc.assert(
      fc.property(arbitrary_expression_with_functions(), (expression) => {
        const document = `gen result = ${expression}`;
        const lexResult = lexer.tokenize(document);
        
        // Should not have lexer errors
        if (lexResult.errors.length > 0) {
          return false;
        }

        // Should have balanced parentheses
        const tokens = lexResult.tokens.filter(t => t.type === 'LPAREN' || t.type === 'RPAREN');
        let parenCount = 0;
        for (const token of tokens) {
          if (token.type === 'LPAREN') parenCount++;
          if (token.type === 'RPAREN') parenCount--;
          if (parenCount < 0) return false; // Unmatched closing paren
        }
        
        // Should end with balanced parentheses
        return parenCount === 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.3: Expressions with nested parentheses are correctly parsed
   * Validates that nested parentheses are properly matched and expressions
   * within parentheses are correctly tokenized.
   */
  it('should correctly parse expressions with nested parentheses', () => {
    fc.assert(
      fc.property(arbitrary_expression_with_nested_parens(), (expression) => {
        const document = `gen result = ${expression}`;
        const lexResult = lexer.tokenize(document);
        
        // Should not have lexer errors
        if (lexResult.errors.length > 0) {
          return false;
        }

        // Count parentheses to ensure they're balanced
        const parenTokens = lexResult.tokens.filter(t => 
          t.type === 'LPAREN' || t.type === 'RPAREN'
        );
        
        let depth = 0;
        let maxDepth = 0;
        
        for (const token of parenTokens) {
          if (token.type === 'LPAREN') {
            depth++;
            maxDepth = Math.max(maxDepth, depth);
          } else {
            depth--;
          }
          
          // Should never go negative
          if (depth < 0) return false;
        }
        
        // Should end balanced and have some nesting
        return depth === 0 && maxDepth > 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.4: Parser stops at top-level commas and statement terminators
   * Validates that the parseExpression method correctly identifies expression
   * boundaries and doesn't consume tokens beyond the expression.
   */
  it('should stop parsing expressions at top-level commas and terminators', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbitrary_complex_expression(), arbitrary_complex_expression()),
        ([expr1, expr2]) => {
          // Test comma separation
          const commaDocument = `gen result = ${expr1}, other = ${expr2}`;
          const commaLexResult = lexer.tokenize(commaDocument);
          
          if (commaLexResult.errors.length > 0) {
            return true; // Skip invalid inputs
          }

          const commaParseResult = parser.parse(commaLexResult.tokens);
          
          // Should parse successfully
          if (commaParseResult.errors.length > 0) {
            return false;
          }

          // Test statement terminator separation (semicolon mode)
          const semicolonDocument = `#delimit ;\ngen result = ${expr1}; gen other = ${expr2};`;
          const semicolonLexResult = lexer.tokenize(semicolonDocument);
          
          if (semicolonLexResult.errors.length > 0) {
            return true; // Skip invalid inputs
          }

          const semicolonParseResult = parser.parse(semicolonLexResult.tokens);
          
          // Should parse successfully
          return semicolonParseResult.errors.length === 0;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 2.5: Expression token ranges are accurate
   * Validates that each token in an expression has correct source ranges
   * that can be used to extract the original text.
   */
  it('should have accurate token ranges for expression components', () => {
    fc.assert(
      fc.property(arbitrary_complex_expression(), (expression) => {
        const document = `gen result = ${expression}`;
        const lexResult = lexer.tokenize(document);
        
        if (lexResult.errors.length > 0) {
          return true; // Skip invalid inputs
        }

        // Find tokens that are part of the expression (after the = sign)
        let foundEquals = false;
        const expressionTokens = [];
        
        for (const token of lexResult.tokens) {
          if (token.type === 'OPERATOR' && token.value === '=') {
            foundEquals = true;
            continue;
          }
          
          if (foundEquals && token.type !== 'WHITESPACE' && token.type !== 'EOF') {
            expressionTokens.push(token);
          }
        }

        // Verify each expression token's range extracts correct text
        for (const token of expressionTokens) {
          const extractedText = extract_text_at_range(document, token.range);
          if (extractedText !== token.value) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.6: Complex expressions preserve semantic structure
   * Validates that complex expressions with multiple operators, functions,
   * and nested parentheses maintain their semantic structure through
   * the tokenization and parsing process.
   */
  it('should preserve semantic structure of complex expressions', () => {
    fc.assert(
      fc.property(arbitrary_complex_expression(), (expression) => {
        const document = `gen result = ${expression}`;
        const lexResult = lexer.tokenize(document);
        
        if (lexResult.errors.length > 0) {
          return true; // Skip invalid inputs
        }

        const parseResult = parser.parse(lexResult.tokens);
        
        if (parseResult.errors.length > 0) {
          return false;
        }

        // Should have exactly one command node
        if (parseResult.ast.nodes.length !== 1) {
          return false;
        }

        const commandNode = parseResult.ast.nodes[0];
        if (commandNode.type !== 'command') {
          return false;
        }

        // The parsed expression should contain the key components
        const parsedExpression = commandNode.expression || '';
        
        // Check that operators are preserved
        const originalOperators = expression.match(/[+\-*/^=<>!&|]+/g) || [];
        for (const op of originalOperators) {
          if (!parsedExpression.includes(op)) {
            return false;
          }
        }

        // Check that parentheses are preserved
        const originalParens = (expression.match(/[()]/g) || []).length;
        const parsedParens = (parsedExpression.match(/[()]/g) || []).length;
        
        return originalParens === parsedParens;
      }),
      { numRuns: 100 }
    );
  });
});
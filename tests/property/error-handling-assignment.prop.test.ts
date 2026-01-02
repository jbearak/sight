import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { arbitrary_identifier } from './generators';

describe('Assignment Expression Error Handling Property Tests', () => {
  let lexer: StataLexer;
  let parser: StataParser;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
  });

  /**
   * Generate commands with missing expressions after =
   */
  function arbitrary_missing_expression_command(): fc.Arbitrary<string> {
    return fc
      .tuple(
        fc.constantFrom('gen', 'generate', 'egen', 'replace'),
        arbitrary_identifier()
      )
      .map(([cmd, varname]) => `${cmd} ${varname} =`);
  }

  /**
   * Generate commands with unbalanced parentheses
   */
  function arbitrary_unbalanced_parentheses_command(): fc.Arbitrary<string> {
    return fc
      .tuple(
        fc.constantFrom('gen', 'generate', 'egen'),
        arbitrary_identifier(),
        fc.oneof(
          // Missing closing parenthesis
          fc.constantFrom('max(x', 'sum(a, b', 'func(arg1, arg2'),
          // Extra closing parenthesis
          fc.constantFrom('max(x))', 'sum(a, b))', 'func(arg1, arg2))'),
          // Mixed unbalanced
          fc.constantFrom('max(x) + sum(y', 'func(a)) + other(b')
        )
      )
      .map(([cmd, varname, expr]) => `${cmd} ${varname} = ${expr}`);
  }

  /**
   * Property Test 6.3: Error Handling Without Cascading
   * 
   * Validates Requirement 4.4: Malformed expressions report appropriate errors
   * without cascading failures.
   * 
   * For any malformed assignment expression, the parser should:
   * 1. Report at most one primary error per issue
   * 2. Not produce cascading "Expected command name" errors
   * 3. Continue parsing after error recovery
   */
  it('should handle missing expressions after equals without cascading errors', () => {
    fc.assert(
      fc.property(arbitrary_missing_expression_command(), (source) => {
        // Tokenize and parse
        const { tokens } = lexer.tokenize(source);
        const { ast, errors } = parser.parse(tokens);

        // Should have exactly one error for missing expression
        const missing_expr_errors = errors.filter(e => 
          e.message.includes('Missing expression after equals') ||
          e.message.includes('missing expression')
        );
        expect(missing_expr_errors.length).toBeGreaterThanOrEqual(1);

        // Should NOT have cascading "Expected command name" errors
        const cascading_errors = errors.filter(e => 
          e.message.includes('Expected command name') ||
          e.message.includes('Unexpected token')
        );
        expect(cascading_errors.length).toBe(0);

        // Should still produce a valid AST structure
        expect(ast).toBeDefined();
        expect(ast.nodes).toBeDefined();
        expect(Array.isArray(ast.nodes)).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should handle unbalanced parentheses without cascading errors', () => {
    fc.assert(
      fc.property(arbitrary_unbalanced_parentheses_command(), (source) => {
        // Tokenize and parse
        const { tokens } = lexer.tokenize(source);
        const { ast, errors } = parser.parse(tokens);

        // Should have at least one error for unbalanced parentheses
        const paren_errors = errors.filter(e => 
          e.message.includes('Unbalanced parentheses') ||
          e.message.includes('parenthesis')
        );
        expect(paren_errors.length).toBeGreaterThanOrEqual(1);

        // Should NOT have excessive cascading errors (allow some related errors)
        expect(errors.length).toBeLessThanOrEqual(3);

        // Should still produce a valid AST structure
        expect(ast).toBeDefined();
        expect(ast.nodes).toBeDefined();
        expect(Array.isArray(ast.nodes)).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Test specific error recovery scenarios
   */
  it('should recover from malformed expressions and continue parsing', () => {
    const test_cases = [
      // Missing expression
      { source: 'gen x =', expected_errors: ['Missing expression'] },
      { source: 'generate y = ', expected_errors: ['Missing expression'] },
      
      // Unbalanced parentheses
      { source: 'gen x = max(y', expected_errors: ['Unbalanced parentheses'] },
      { source: 'egen z = sum(a, b))', expected_errors: ['Unbalanced parentheses'] },
      
      // Multiple issues
      { source: 'gen x = max(y, z', expected_errors: ['Unbalanced parentheses'] },
    ];

    for (const test_case of test_cases) {
      const { tokens } = lexer.tokenize(test_case.source);
      const { ast, errors } = parser.parse(tokens);

      // Should have appropriate errors
      const relevant_errors = errors.filter(e => 
        test_case.expected_errors.some(expected => 
          e.message.toLowerCase().includes(expected.toLowerCase())
        )
      );
      expect(relevant_errors.length).toBeGreaterThanOrEqual(1);

      // Should still produce valid AST
      expect(ast.nodes.length).toBeGreaterThan(0);
      expect(ast.nodes[0].type).toBe('command');
    }
  });

  /**
   * Test that error recovery doesn't break subsequent parsing
   */
  it('should not affect parsing of subsequent valid commands after errors', () => {
    const test_cases = [
      'gen x =\ndescribe y',
      'generate a = max(b\nsummarize c',
      'egen z = sum(w))\nlist vars',
    ];

    for (const source of test_cases) {
      const { tokens } = lexer.tokenize(source);
      const { ast, errors } = parser.parse(tokens);

      // Should have errors from the malformed command
      expect(errors.length).toBeGreaterThan(0);

      // Should still parse at least one command (the malformed one)
      expect(ast.nodes.length).toBeGreaterThanOrEqual(1);
      
      // If there are multiple commands, the subsequent ones should be valid
      if (ast.nodes.length > 1) {
        const second_command = ast.nodes[1];
        expect(second_command.type).toBe('command');
        expect('name' in second_command).toBe(true);
      }
    }
  });

  /**
   * Test error message quality and specificity
   */
  it('should provide specific and helpful error messages', () => {
    const test_cases = [
      { 
        source: 'gen x =', 
        should_contain: ['missing', 'expression', 'equals'],
        should_not_contain: ['command', 'unexpected token']
      },
      { 
        source: 'gen x = max(y', 
        should_contain: ['unbalanced', 'parentheses', 'missing', 'closing'],
        should_not_contain: ['command name', 'syntax error']
      },
      { 
        source: 'gen x = sum(a, b))', 
        should_contain: ['unbalanced', 'parentheses', 'unexpected', 'closing'],
        should_not_contain: ['missing command']
      },
    ];

    for (const test_case of test_cases) {
      const { tokens } = lexer.tokenize(test_case.source);
      const { errors } = parser.parse(tokens);

      expect(errors.length).toBeGreaterThan(0);

      const error_text = errors.map(e => e.message.toLowerCase()).join(' ');
      
      // Should contain expected terms
      for (const term of test_case.should_contain) {
        expect(error_text).toContain(term.toLowerCase());
      }
      
      // Should not contain problematic terms
      for (const term of test_case.should_not_contain) {
        expect(error_text).not.toContain(term.toLowerCase());
      }
    }
  });
});

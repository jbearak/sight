/**
 * Property tests for else block symbol registration
 * 
 * Feature: else-block-symbol-registration
 * Property 1: Else block macro registration
 * Validates: Requirements 1.1, 1.2
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';

describe('Else Block Symbol Registration Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;
  let my_analyzer: SemanticAnalyzer;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
    my_analyzer = new SemanticAnalyzer();
  });

  const arbitrary_macro_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/);

  const arbitrary_macro_value = () =>
    fc.oneof(
      fc.integer({ min: 0, max: 1000 }).map(n => n.toString()),
      fc.stringMatching(/^[a-zA-Z0-9_]{1,10}$/)
    );

  /**
   * Property 1: Else block macro registration
   * For any Stata source containing a local or global macro definition inside an else block,
   * analyzing the source SHALL result in that macro being present in the symbol table.
   * 
   * Feature: else-block-symbol-registration, Property 1: Else block macro registration
   * Validates: Requirements 1.1, 1.2
   */
  it('should register local macros defined in else blocks', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        arbitrary_macro_value(),
        (my_name, my_value) => {
          const my_source = `if 0 {
    display "then branch"
}
else {
    local ${my_name} = ${my_value}
}`;

          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          const my_analysis = my_analyzer.analyze(my_parse_result.ast, 'test://test.do');

          expect(my_analysis.symbols.localMacros.has(my_name)).toBe(true);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1 (continued): Global macro registration in else blocks
   * 
   * Feature: else-block-symbol-registration, Property 1: Else block macro registration
   * Validates: Requirements 1.1, 1.2
   */
  it('should register global macros defined in else blocks', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        arbitrary_macro_value(),
        (my_name, my_value) => {
          const my_source = `if 0 {
    display "then branch"
}
else {
    global ${my_name} = ${my_value}
}`;

          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          const my_analysis = my_analyzer.analyze(my_parse_result.ast, 'test://test.do');

          expect(my_analysis.symbols.globalMacros.has(my_name)).toBe(true);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Parity between if and else branches
   * For any Stata source with macro definitions in both if and else branches,
   * analyzing the source SHALL register macros from both branches.
   * 
   * Feature: else-block-symbol-registration, Property 5: Parity between if and else branches
   * Validates: Requirements 2.1, 2.2
   */
  it('should register macros from both if and else branches', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        arbitrary_macro_name(),
        arbitrary_macro_value(),
        arbitrary_macro_value(),
        (my_if_name, my_else_name, my_if_value, my_else_value) => {
          // Ensure names are different
          if (my_if_name === my_else_name) {
            return true; // Skip this case
          }

          const my_source = `if 1 {
    local ${my_if_name} = ${my_if_value}
}
else {
    local ${my_else_name} = ${my_else_value}
}`;

          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          const my_analysis = my_analyzer.analyze(my_parse_result.ast, 'test://test.do');

          expect(my_analysis.symbols.localMacros.has(my_if_name)).toBe(true);
          expect(my_analysis.symbols.localMacros.has(my_else_name)).toBe(true);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Extended macro function registration in else blocks
   * For any Stata source with an extended macro function definition inside an else block,
   * analyzing the source SHALL register the macro with extendedFunction populated.
   * 
   * Feature: else-block-symbol-registration, Property 4: Extended macro function registration
   * Validates: Requirements 1.5
   */
  it('should register extended macro functions defined in else blocks', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        fc.oneof(fc.constant('type'), fc.constant('format'), fc.constant('label')),
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/),
        (my_name, my_func, my_var) => {
          const my_source = `if 0 {
    display "then branch"
}
else {
    local ${my_name}: ${my_func} ${my_var}
}`;

          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          const my_analysis = my_analyzer.analyze(my_parse_result.ast, 'test://test.do');

          expect(my_analysis.symbols.localMacros.has(my_name)).toBe(true);
          const my_macro = my_analysis.symbols.localMacros.get(my_name);
          expect(my_macro?.extendedFunction).toBeDefined();
          expect(my_macro?.extendedFunction?.name).toBe(my_func);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

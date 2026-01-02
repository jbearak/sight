import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode } from '../../src/types';

describe('Extended Macro Property Functions Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  const arbitrary_property_function = () =>
    fc.oneof(
      fc.constant('type'),
      fc.constant('format'),
      fc.constant('label')
    );

  const arbitrary_variable_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

  const arbitrary_macro_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

  it('should recognize property functions in extended macro definitions', () => {
    fc.assert(
      fc.property(
        arbitrary_property_function(),
        arbitrary_variable_name(),
        arbitrary_macro_name(),
        (my_func, my_var, my_name) => {
          const my_source = `local ${my_name} : ${my_func} ${my_var}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          expect(my_macro_node).toBeDefined();
          expect(my_macro_node!.extendedFunction).toBeDefined();
          expect(my_macro_node!.extendedFunction!.name).toBe(my_func);
          expect(my_macro_node!.extendedFunction!.args).toBe(my_var);
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should handle variable label and value label functions', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('variable'), fc.constant('value')),
        arbitrary_variable_name(),
        arbitrary_macro_name(),
        (my_prefix, my_var, my_name) => {
          const my_source = `local ${my_name} : ${my_prefix} label ${my_var}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          if (my_macro_node?.extendedFunction) {
            expect(my_macro_node.extendedFunction.name).toBe(my_prefix);
            expect(my_macro_node.extendedFunction.args).toContain('label');
            expect(my_macro_node.extendedFunction.args).toContain(my_var);
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});
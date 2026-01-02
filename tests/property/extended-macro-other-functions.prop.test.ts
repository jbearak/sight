import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode } from '../../src/types';

describe('Extended Macro Other Functions Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  const arbitrary_other_function = () =>
    fc.oneof(
      fc.constant('data'),
      fc.constant('display'),
      fc.constant('permname'),
      fc.constant('tempvar'),
      fc.constant('tempfile')
    );

  const arbitrary_macro_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

  it('should recognize other extended macro functions', () => {
    fc.assert(
      fc.property(
        arbitrary_other_function(),
        arbitrary_macro_name(),
        (my_func, my_name) => {
          const my_args = my_func === 'display' ? '%9.2f 3.14159' :
                         my_func === 'permname' ? 'stub' :
                         my_func === 'data' ? 'label' : '';
          
          const my_source = `local ${my_name} : ${my_func}${my_args ? ' ' + my_args : ''}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          expect(my_macro_node).toBeDefined();
          expect(my_macro_node!.extendedFunction).toBeDefined();
          expect(my_macro_node!.extendedFunction!.name).toBe(my_func);
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should handle tempvar and tempfile functions without arguments', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('tempvar'), fc.constant('tempfile')),
        arbitrary_macro_name(),
        (my_func, my_name) => {
          const my_source = `local ${my_name} : ${my_func}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          if (my_macro_node?.extendedFunction) {
            expect(my_macro_node.extendedFunction.name).toBe(my_func);
            expect(my_macro_node.extendedFunction.args).toBe('');
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle display function with format arguments', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        fc.float({ min: 0, max: 1000 }),
        (my_name, my_number) => {
          const my_source = `local ${my_name} : display %9.2f ${my_number}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          if (my_macro_node?.extendedFunction) {
            expect(my_macro_node.extendedFunction.name).toBe('display');
            // Check that the essential format tokens are present
            const args = my_macro_node.extendedFunction.args;
            expect(args).toContain('%');
            expect(args).toContain('9.2');
            expect(args).toContain('f');
          }
          
          return true;
        }
      ),
      { numRuns: 15 }
    );
  });
});
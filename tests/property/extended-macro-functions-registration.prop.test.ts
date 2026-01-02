import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode } from '../../src/types';

describe('Extended Macro Functions Registration Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  const arbitrary_all_extended_functions = () =>
    fc.oneof(
      // List functions
      fc.constant('list'),
      // Word functions
      fc.constant('word'),
      fc.constant('words'),
      // String functions
      fc.constant('subinstr'),
      fc.constant('length'),
      fc.constant('piece'),
      fc.constant('substr'),
      fc.constant('upper'),
      fc.constant('lower'),
      // Property functions
      fc.constant('type'),
      fc.constant('format'),
      fc.constant('label'),
      fc.constant('variable'),
      fc.constant('value'),
      // Other functions
      fc.constant('data'),
      fc.constant('display'),
      fc.constant('permname'),
      fc.constant('tempvar'),
      fc.constant('tempfile')
    );

  const arbitrary_macro_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

  const arbitrary_simple_args = () =>
    fc.stringMatching(/^[a-zA-Z0-9_ \t\-"'`]*$/);

  it('should properly register all extended macro functions', () => {
    fc.assert(
      fc.property(
        arbitrary_all_extended_functions(),
        arbitrary_simple_args(),
        arbitrary_macro_name(),
        (my_func, my_args, my_name) => {
          const my_source = `local ${my_name} : ${my_func} ${my_args}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_nodes = my_parse_result.ast.nodes.filter(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          expect(my_macro_nodes.length).toBe(1);
          
          const my_macro_node = my_macro_nodes[0];
          expect(my_macro_node.extendedFunction).toBeDefined();
          expect(my_macro_node.extendedFunction!.name).toBe(my_func);
          expect(typeof my_macro_node.extendedFunction!.args).toBe('string');
          
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should distinguish extended functions from regular macro definitions', () => {
    fc.assert(
      fc.property(
        arbitrary_all_extended_functions(),
        arbitrary_macro_name(),
        arbitrary_macro_name(),
        (my_func, my_name1, my_name2) => {
          // If the names collide, we can't reliably distinguish the two nodes.
          if (my_name1 === my_name2) {
            return true;
          }

          const my_extended_source = `local ${my_name1} : ${my_func} args`;
          const my_regular_source = `local ${my_name2} "regular value"`;
          const my_combined_source = `${my_extended_source}\n${my_regular_source}`;
          
          const my_lex_result = my_lexer.tokenize(my_combined_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_nodes = my_parse_result.ast.nodes.filter(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          expect(my_macro_nodes.length).toBe(2);
          
          // First should be extended function
          const my_extended_node = my_macro_nodes.find(n => n.name === my_name1);
          expect(my_extended_node?.extendedFunction).toBeDefined();
          expect(my_extended_node?.extendedFunction!.name).toBe(my_func);
          
          // Second should be regular macro
          const my_regular_node = my_macro_nodes.find(n => n.name === my_name2);
          expect(my_regular_node?.extendedFunction).toBeUndefined();
          expect(my_regular_node?.value).toContain('regular value');
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
});
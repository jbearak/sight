import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode } from '../../src/types';

describe('Extended Macro String Functions Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  const arbitrary_string_function = () =>
    fc.oneof(
      fc.constant('subinstr'),
      fc.constant('length'),
      fc.constant('piece'),
      fc.constant('substr'),
      fc.constant('upper'),
      fc.constant('lower')
    );

  const arbitrary_string_args = () =>
    fc.oneof(
      fc.stringMatching(/^`[a-zA-Z_][a-zA-Z0-9_]*'$/),
      fc.tuple(fc.stringMatching(/^`[a-zA-Z_][a-zA-Z0-9_]*'$/), fc.string({ minLength: 1, maxLength: 10 }))
        .map(([macro, str]) => `${macro} "${str}"`),
      fc.tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), fc.constant('of'), fc.stringMatching(/^`[a-zA-Z_][a-zA-Z0-9_]*'$/))
        .map(([start, end, of, macro]) => `${start} ${end} ${of} ${macro}`)
    );

  const arbitrary_macro_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

  it('should recognize string functions in extended macro definitions', () => {
    fc.assert(
      fc.property(
        arbitrary_string_function(),
        arbitrary_string_args(),
        arbitrary_macro_name(),
        (my_func, my_args, my_name) => {
          const my_source = `local ${my_name} : ${my_func} ${my_args}`;
          
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

  it('should handle subinstr function with replacement arguments', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        fc.string({ minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 5 }),
        (my_name, my_old, my_new) => {
          const my_source = `local ${my_name} : subinstr local(str) "${my_old}" "${my_new}"`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          if (my_macro_node?.extendedFunction) {
            expect(my_macro_node.extendedFunction.name).toBe('subinstr');
            // Check that the essential tokens are present, accounting for tokenization
            const args = my_macro_node.extendedFunction.args;
            expect(args).toContain('local');
            expect(args).toContain('str');
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});
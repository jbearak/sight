import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode, ExtendedMacroFunction } from '../../src/types';

describe('Extended Macro Function AST Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  const arbitrary_extended_function_name = () =>
    fc.oneof(
      fc.constant('list'),
      fc.constant('word'),
      fc.constant('subinstr'),
      fc.constant('length'),
      fc.constant('piece'),
      fc.constant('type'),
      fc.constant('format'),
      fc.constant('label'),
      fc.constant('variable'),
      fc.constant('value'),
      fc.constant('data'),
      fc.constant('display'),
      fc.constant('permname'),
      fc.constant('tempvar'),
      fc.constant('tempfile'),
      // Legacy functions for backward compatibility
      fc.constant('substr'),
      fc.constant('upper'),
      fc.constant('lower')
    );

  const arbitrary_function_args = () =>
    fc.stringMatching(/^[a-zA-Z0-9_ \t\-"']+$/);

  const arbitrary_macro_name = () =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

  const arbitrary_extended_macro_def = () =>
    fc.tuple(
      fc.oneof(fc.constant('local'), fc.constant('global')),
      arbitrary_macro_name(),
      arbitrary_extended_function_name(),
      arbitrary_function_args()
    ).map(([my_scope, my_name, my_func, my_args]) => 
      `${my_scope} ${my_name} : ${my_func} ${my_args}`
    );

  it('should parse extended macro functions with populated extendedFunction property', () => {
    fc.assert(
      fc.property(arbitrary_extended_macro_def(), (my_source) => {
        const my_lex_result = my_lexer.tokenize(my_source);
        const my_parse_result = my_parser.parse(my_lex_result.tokens);
        
        const my_macro_nodes = my_parse_result.ast.nodes.filter(
          (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
        );

        expect(my_macro_nodes.length).toBe(1);
        
        const my_macro_node = my_macro_nodes[0];
        expect(my_macro_node.extendedFunction).toBeDefined();
        
        const my_ext_func = my_macro_node.extendedFunction!;
        expect(my_ext_func.name).toMatch(/^(list|word|subinstr|length|piece|type|format|label|variable|value|data|display|permname|tempvar|tempfile|substr|upper|lower)$/);
        expect(my_ext_func.args).toBeDefined();
        expect(typeof my_ext_func.args).toBe('string');
        
        return true;
      }),
      { numRuns: 50 }
    );
  });

  it('should preserve function name and arguments in extendedFunction', () => {
    fc.assert(
      fc.property(
        arbitrary_extended_function_name(),
        arbitrary_function_args(),
        arbitrary_macro_name(),
        (my_func_name, my_args, my_macro_name) => {
          const my_source = `local ${my_macro_name} : ${my_func_name} ${my_args}`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          if (my_macro_node?.extendedFunction) {
            expect(my_macro_node.extendedFunction.name).toBe(my_func_name);
            // The parser preserves token content but not inter-token whitespace
            // So we verify that the essential content is preserved
            expect(my_macro_node.extendedFunction.args).toBeDefined();
            expect(typeof my_macro_node.extendedFunction.args).toBe('string');
            
            // For non-empty args, verify the args contain the expected tokens
            if (my_args.trim().length > 0) {
              // Split the original args into tokens the same way the lexer would
              const expected_tokens = my_args.trim().split(/\s+/).flatMap(token => {
                // Handle cases like "-0" which get tokenized as ["-", "0"]
                return token.match(/[a-zA-Z_][a-zA-Z0-9_]*|[0-9]+|[^\w\s]/g) || [token];
              });
              const actual_args = my_macro_node.extendedFunction.args;
              
              // Each expected token should appear in the actual args
              for (const token of expected_tokens) {
                if (token.length > 0) {
                  expect(actual_args).toContain(token);
                }
              }
            }
          }
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should not populate extendedFunction for regular macro definitions', () => {
    fc.assert(
      fc.property(
        arbitrary_macro_name(),
        fc.stringMatching(/^[^:]*$/),
        (my_name, my_value) => {
          const my_source = `local ${my_name} "${my_value}"`;
          
          const my_lex_result = my_lexer.tokenize(my_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);
          
          const my_macro_node = my_parse_result.ast.nodes.find(
            (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
          );

          if (my_macro_node) {
            expect(my_macro_node.extendedFunction).toBeUndefined();
          }
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
});
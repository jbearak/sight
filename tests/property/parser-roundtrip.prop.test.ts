import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { PrettyPrinter } from '../../src/pretty-printer';
import { arbitrary_stata_document } from './generators';
import { ast_equivalent } from './helpers';

describe('Parser Round-Trip Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;
  let my_printer: PrettyPrinter;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
    my_printer = new PrettyPrinter();
  });

  /**
   * Property 1: Parser Round-Trip Consistency
   * For any valid Stata source code, parsing it, printing the AST, and parsing
   * again should produce an equivalent AST (ignoring source ranges).
   * Feature: comprehensive-property-tests, Property 1: Parser Round-Trip Consistency
   * Validates: Requirement 1
   */
  it('should maintain AST equivalence through parse-print-parse round-trip', () => {
    fc.assert(
      fc.property(arbitrary_stata_document(), (my_original_source) => {
        // Parse the original source
        const my_lex_result_1 = my_lexer.tokenize(my_original_source);
        const my_parse_result_1 = my_parser.parse(my_lex_result_1.tokens);
        const my_original_ast = my_parse_result_1.ast;

        // Print the AST to source code
        const my_printed_source = my_printer.print(my_original_ast);

        // Tokenize the printed source
        const my_lex_result_2 = my_lexer.tokenize(my_printed_source);

        // Parse the tokens back to AST
        const my_parse_result_2 = my_parser.parse(my_lex_result_2.tokens);
        const my_reparsed_ast = my_parse_result_2.ast;

        // Verify AST equivalence (ignoring ranges)
        return ast_equivalent(my_original_ast, my_reparsed_ast);
      }),
      { numRuns: 100 }
    );
  });
});

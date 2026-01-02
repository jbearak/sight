import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { arbitrary_identifier, arbitrary_number, arbitrary_non_reserved_identifier } from './generators';

describe('Single Command Assignment Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Generate valid assignment commands with the pattern: command varname = expression
   */
  function arbitrary_assignment_command(): fc.Arbitrary<string> {
    const my_assignment_commands = ['generate', 'replace', 'egen'];
    
    return fc
      .tuple(
        fc.constantFrom(...my_assignment_commands),
        arbitrary_non_reserved_identifier(),
        fc.oneof(
          arbitrary_number(),
          arbitrary_non_reserved_identifier(),
          fc.tuple(arbitrary_non_reserved_identifier(), fc.constantFrom('+', '-', '*', '/'), arbitrary_number())
            .map(([var_name, op, num]) => `${var_name} ${op} ${num}`)
        )
      )
      .map(([cmd, varname, expr]) => `${cmd} ${varname} = ${expr}`);
  }

  /**
   * Property Test: Single Command Node with Assignment Syntax
   * 
   * Validates Requirements:
   * - 1.1: Parser produces exactly one CommandNode for valid assignment syntax
   * - 1.4: No parse errors for valid assignment commands  
   * - 1.5: CommandNode contains correct assignment components (varname, expression)
   * 
   * For any valid command with assignment syntax `command varname = expression`,
   * the parser should produce exactly one CommandNode with no parse errors.
   */
  it('should produce exactly one CommandNode with no errors for assignment syntax', () => {
    fc.assert(
      fc.property(arbitrary_assignment_command(), (my_source) => {
        // Tokenize and parse the assignment command
        const my_lex_result = my_lexer.tokenize(my_source);
        const my_parse_result = my_parser.parse(my_lex_result.tokens);

        // Requirement 1.4: No parse errors
        expect(my_parse_result.errors).toHaveLength(0);

        // Requirement 1.1: Exactly one CommandNode
        expect(my_parse_result.ast.nodes).toHaveLength(1);
        const my_node = my_parse_result.ast.nodes[0];
        expect(my_node.type).toBe('command');

        // Requirement 1.5: CommandNode contains assignment components
        if (my_node.type === 'command') {
          // Should have a varlist (the variable being assigned to)
          expect(my_node.varlist).toBeDefined();
          expect(my_node.varlist).toHaveLength(1);
          
          // Should have an expression (the value being assigned)
          expect(my_node.expression).toBeDefined();
          expect(my_node.expression).not.toBe('');
          
          // Command name should be one of the assignment commands
          expect(['generate', 'replace', 'egen']).toContain(my_node.name);
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
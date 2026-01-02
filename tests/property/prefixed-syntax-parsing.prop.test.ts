import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SyntaxNode, ProgramNode } from '../../src/types';

/**
 * Property Tests for Prefixed Syntax Command Parsing
 * 
 * Feature: syntax-command-bugs, Property 1: Prefixed syntax command parsing
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 * 
 * These tests verify that syntax commands preceded by prefix commands
 * (quietly, capture, noisily, etc.) are correctly parsed as SyntaxNodes,
 * not as regular CommandNodes.
 */
describe('Prefixed Syntax Command Parsing Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Property 1: Prefixed syntax command parsing
   * For any program containing a syntax command preceded by any valid prefix command
   * (quietly, capture, noisily, etc.), the parser should:
   * - Produce a SyntaxNode (not CommandNode) for the syntax statement
   * - Not produce any ControlFlowNode for [if] or [in] argument specifiers
   * - Not emit "Missing end for program definition" errors
   * - Correctly extract the program signature with all arguments and options
   * 
   * Feature: syntax-command-bugs, Property 1: Prefixed syntax command parsing
   * Validates: Requirements 1.1, 1.2, 1.3, 1.4
   */
  it('should parse syntax command after prefix as SyntaxNode', () => {
    const my_prefix_generator = fc.constantFrom(
      'qui',
      'quietly',
      'cap',
      'capture',
      'noi',
      'noisily'
    );

    const my_arg_type_generator = fc.constantFrom(
      'varlist',
      'varname',
      'newvarname',
      'anything',
      'if',
      'in'
    );

    fc.assert(
      fc.property(
        fc.tuple(
          my_prefix_generator,
          fc.array(my_arg_type_generator, { minLength: 1, maxLength: 4 })
        ),
        ([my_prefix, my_arg_types]) => {
          // Build program with prefixed syntax command
          const my_args_str = my_arg_types.join(' ');
          const my_syntax_line = `${my_prefix} syntax ${my_args_str}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          ) as ProgramNode | undefined;

          // Requirement 1.3: Should NOT emit "Missing end for program definition" errors
          const my_missing_end_errors = my_parse_result.errors.filter(
            (my_err) => my_err.message.includes('Missing end')
          );
          expect(my_missing_end_errors.length).toBe(0);

          // Program should be found
          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            // Requirement 1.1: Should parse as SyntaxNode, not CommandNode
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            expect(my_syntax_node?.type).toBe('syntax');

            // Requirement 1.2: [if] and [in] should be parsed as syntax arguments,
            // not as control flow statements
            const my_control_flow_nodes = my_program.body.filter(
              (my_node) => my_node.type === 'if' || my_node.type === 'control_flow'
            );
            expect(my_control_flow_nodes.length).toBe(0);

            // Requirement 1.4: Should correctly extract program signature
            if (my_syntax_node) {
              expect(my_syntax_node.signature).toBeDefined();
              expect(my_syntax_node.signature.arguments.length).toBe(my_arg_types.length);

              // Verify argument types match
              const my_extracted_types = my_syntax_node.signature.arguments.map(
                (my_arg) => my_arg.type
              );
              expect(my_extracted_types).toEqual(my_arg_types);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1b: Prefixed syntax with options
   * For any program containing a prefixed syntax command with options,
   * the parser should correctly extract all options.
   * 
   * Feature: syntax-command-bugs, Property 1: Prefixed syntax command parsing
   * Validates: Requirements 1.1, 1.4
   */
  it('should parse prefixed syntax command with options', () => {
    const my_prefix_generator = fc.constantFrom('qui', 'cap', 'noi');

    const my_option_generator = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/);

    fc.assert(
      fc.property(
        fc.tuple(
          my_prefix_generator,
          fc.array(my_option_generator, { minLength: 1, maxLength: 3 })
        ),
        ([my_prefix, my_option_names]) => {
          // Build program with prefixed syntax command with options
          const my_opts_str = my_option_names.join(' ');
          const my_syntax_line = `${my_prefix} syntax anything , ${my_opts_str}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          ) as ProgramNode | undefined;

          expect(my_program).toBeDefined();

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();

            if (my_syntax_node) {
              // Should have parsed all options
              expect(my_syntax_node.signature.options.length).toBe(my_option_names.length);

              // Verify option names match (case-insensitive comparison)
              const my_extracted_names = my_syntax_node.signature.options.map(
                (my_opt) => my_opt.name.toLowerCase()
              );
              const my_expected_names = my_option_names.map((my_name) => my_name.toLowerCase());
              expect(my_extracted_names).toEqual(my_expected_names);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1c: Prefixed syntax with [if] [in] arguments
   * For any program containing a prefixed syntax command with [if] and [in],
   * these should be parsed as optional syntax arguments, not control flow.
   * 
   * Feature: syntax-command-bugs, Property 1: Prefixed syntax command parsing
   * Validates: Requirements 1.2
   */
  it('should parse [if] and [in] as syntax arguments, not control flow', () => {
    const my_prefix_generator = fc.constantFrom('qui', 'quietly', 'cap', 'capture');

    fc.assert(
      fc.property(
        my_prefix_generator,
        (my_prefix) => {
          // Build program with prefixed syntax command containing [if] [in]
          const my_syntax_line = `${my_prefix} syntax anything [if] [in]`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          ) as ProgramNode | undefined;

          expect(my_program).toBeDefined();

          if (my_program?.type === 'program') {
            // Should NOT have any if/control_flow nodes in the body
            const my_control_flow_nodes = my_program.body.filter(
              (my_node) => my_node.type === 'if' || my_node.type === 'control_flow'
            );
            expect(my_control_flow_nodes.length).toBe(0);

            // Should have a syntax node
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();

            if (my_syntax_node) {
              // Should have if and in as arguments
              const my_arg_types = my_syntax_node.signature.arguments.map(
                (my_arg) => my_arg.type
              );
              expect(my_arg_types).toContain('if');
              expect(my_arg_types).toContain('in');

              // if and in should be marked as optional
              const my_if_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === 'if'
              );
              const my_in_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === 'in'
              );
              expect(my_if_arg?.isOptional).toBe(true);
              expect(my_in_arg?.isOptional).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1d: Prefix property attached to SyntaxNode
   * For any prefixed syntax command, the prefix should be attached to the SyntaxNode.
   * 
   * Feature: syntax-command-bugs, Property 1: Prefixed syntax command parsing
   * Validates: Requirements 1.1
   */
  it('should attach prefix to SyntaxNode', () => {
    const my_prefix_generator = fc.constantFrom('qui', 'quietly', 'cap', 'capture', 'noi', 'noisily');

    fc.assert(
      fc.property(
        my_prefix_generator,
        (my_prefix) => {
          // Build program with prefixed syntax command
          const my_syntax_line = `${my_prefix} syntax varlist`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          ) as ProgramNode | undefined;

          expect(my_program).toBeDefined();

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();

            if (my_syntax_node) {
              // Should have prefix attached
              expect(my_syntax_node.prefix).toBeDefined();
              expect(my_syntax_node.prefix?.length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

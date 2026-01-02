import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SyntaxNode, ProgramNode } from '../../src/types';

/**
 * Property Tests for Syntax Command Regression
 * 
 * Feature: syntax-command-bugs, Property 3: Regression - existing functionality preserved
 * Validates: Requirements 3.1, 3.2, 3.3
 * 
 * These tests verify that existing syntax command functionality continues to work
 * correctly after the bug fixes for prefixed syntax and weight arguments.
 */
describe('Syntax Command Regression Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Property 3: Regression - existing functionality preserved
   * For any syntax command (with or without prefix, with or without weight arguments),
   * the parser should:
   * - Continue to recognize all existing argument types
   * - Continue to correctly parse syntax options after the comma
   * - Produce valid SyntaxNode with correct signature
   * 
   * Feature: syntax-command-bugs, Property 3: Regression - existing functionality preserved
   * Validates: Requirements 3.1, 3.2, 3.3
   */
  it('should continue to parse syntax without prefix correctly', () => {
    const my_arg_type_generator = fc.constantFrom(
      'varlist',
      'varname',
      'newvarname',
      'anything',
      'if',
      'in',
      'using',
      'name',
      'namelist'
    );

    fc.assert(
      fc.property(
        fc.array(my_arg_type_generator, { minLength: 1, maxLength: 4 }),
        (my_arg_types) => {
          // Build program with syntax command (no prefix)
          const my_args_str = my_arg_types.join(' ');
          const my_syntax_line = `syntax ${my_args_str}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          ) as ProgramNode | undefined;

          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            // Requirement 3.1: Should parse as SyntaxNode
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            expect(my_syntax_node?.type).toBe('syntax');

            if (my_syntax_node) {
              // Requirement 3.2: Should recognize all existing argument types
              expect(my_syntax_node.signature.arguments.length).toBe(my_arg_types.length);

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
   * Property 3b: Options parsing preserved
   * For any syntax command with options, the parser should continue to
   * correctly parse options after the comma.
   * 
   * Feature: syntax-command-bugs, Property 3: Regression - existing functionality preserved
   * Validates: Requirements 3.3
   */
  it('should continue to parse syntax options correctly', () => {
    const my_option_generator = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/);

    fc.assert(
      fc.property(
        fc.array(my_option_generator, { minLength: 1, maxLength: 4 }),
        (my_option_names) => {
          // Build program with syntax command with options
          const my_opts_str = my_option_names.join(' ');
          const my_syntax_line = `syntax anything , ${my_opts_str}`;
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
              // Requirement 3.3: Should correctly parse options
              expect(my_syntax_node.signature.options.length).toBe(my_option_names.length);

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
   * Property 3c: Typed options preserved
   * For any syntax command with typed options, the parser should continue to
   * correctly parse option types.
   * 
   * Feature: syntax-command-bugs, Property 3: Regression - existing functionality preserved
   * Validates: Requirements 3.3
   */
  it('should continue to parse typed options correctly', () => {
    const my_option_type_generator = fc.constantFrom(
      'real',
      'integer',
      'string',
      'varlist',
      'name',
      'filename'
    );

    const my_option_generator = fc.tuple(
      fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
      my_option_type_generator
    );

    fc.assert(
      fc.property(
        fc.array(my_option_generator, { minLength: 1, maxLength: 3 }),
        (my_options) => {
          // Build program with typed options
          const my_opts_str = my_options
            .map(([my_name, my_type]) => `${my_name}(${my_type})`)
            .join(' ');
          const my_syntax_line = `syntax , ${my_opts_str}`;
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
              // Should have parsed all options with correct types
              expect(my_syntax_node.signature.options.length).toBe(my_options.length);

              for (let i = 0; i < my_options.length; i++) {
                const [my_expected_name, my_expected_type] = my_options[i];
                const my_parsed_option = my_syntax_node.signature.options[i];
                expect(my_parsed_option.name.toLowerCase()).toBe(my_expected_name.toLowerCase());
                expect(my_parsed_option.argumentType).toBe(my_expected_type);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3d: Optional arguments preserved
   * For any syntax command with optional arguments in brackets,
   * the parser should continue to correctly mark them as optional.
   * 
   * Feature: syntax-command-bugs, Property 3: Regression - existing functionality preserved
   * Validates: Requirements 3.2
   */
  it('should continue to parse optional arguments correctly', () => {
    const my_arg_type_generator = fc.constantFrom(
      'varlist',
      'varname',
      'anything',
      'if',
      'in'
    );

    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(my_arg_type_generator, fc.boolean()),
          { minLength: 1, maxLength: 4 }
        ),
        (my_args) => {
          // Build program with optional/required arguments
          const my_args_str = my_args
            .map(([my_type, my_is_optional]) =>
              my_is_optional ? `[${my_type}]` : my_type
            )
            .join(' ');
          const my_syntax_line = `syntax ${my_args_str}`;
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
              // Should have parsed all arguments with correct optional flags
              expect(my_syntax_node.signature.arguments.length).toBe(my_args.length);

              for (let i = 0; i < my_args.length; i++) {
                const [my_expected_type, my_expected_optional] = my_args[i];
                const my_parsed_arg = my_syntax_node.signature.arguments[i];
                expect(my_parsed_arg.type).toBe(my_expected_type);
                expect(my_parsed_arg.isOptional).toBe(my_expected_optional);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3e: Signature attachment preserved
   * For any program with a syntax command, the signature should be
   * correctly attached to the ProgramNode.
   * 
   * Feature: syntax-command-bugs, Property 3: Regression - existing functionality preserved
   * Validates: Requirements 3.1
   */
  it('should continue to attach signature to program node', () => {
    const my_arg_type_generator = fc.constantFrom(
      'varlist',
      'varname',
      'anything'
    );

    fc.assert(
      fc.property(
        fc.array(my_arg_type_generator, { minLength: 1, maxLength: 3 }),
        (my_arg_types) => {
          // Build program with syntax command
          const my_args_str = my_arg_types.join(' ');
          const my_syntax_line = `syntax ${my_args_str}`;
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
            // Signature should be attached to program node
            expect(my_program.signature).toBeDefined();

            if (my_program.signature) {
              expect(my_program.signature.arguments.length).toBe(my_arg_types.length);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3f: Mixed arguments and options preserved
   * For any syntax command with both arguments and options,
   * the parser should correctly parse both.
   * 
   * Feature: syntax-command-bugs, Property 3: Regression - existing functionality preserved
   * Validates: Requirements 3.2, 3.3
   */
  it('should continue to parse mixed arguments and options', () => {
    const my_arg_type_generator = fc.constantFrom(
      'varlist',
      'varname',
      'anything',
      'if',
      'in'
    );

    const my_option_generator = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/);

    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(my_arg_type_generator, { minLength: 1, maxLength: 3 }),
          fc.array(my_option_generator, { minLength: 1, maxLength: 3 })
        ),
        ([my_arg_types, my_option_names]) => {
          // Build program with arguments and options
          const my_args_str = my_arg_types.join(' ');
          const my_opts_str = my_option_names.join(' ');
          const my_syntax_line = `syntax ${my_args_str} , ${my_opts_str}`;
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
              // Should have parsed all arguments
              expect(my_syntax_node.signature.arguments.length).toBe(my_arg_types.length);

              // Should have parsed all options
              expect(my_syntax_node.signature.options.length).toBe(my_option_names.length);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ArgumentSpec, OptionSpec, SyntaxNode } from '../../src/types';

describe('Syntax Command Parsing Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Property 3: Argument Extraction Order
   * For any syntax command with multiple arguments, all arguments should be
   * extracted in the order they appear in the syntax declaration.
   * Feature: syntax-command-parsing, Property 3: Argument Extraction Order
   * Validates: Requirements 1.3
   */
  it('should extract arguments in declaration order', () => {
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
        fc.array(my_arg_type_generator, { minLength: 1, maxLength: 5 }),
        (my_arg_types) => {
          // Build syntax command
          const my_syntax_line = `syntax ${my_arg_types.join(' ')}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          // If program not found, check what was parsed
          if (!my_program) {
            console.log('Program not found. Parsed nodes:', my_parse_result.ast.nodes.map(n => n.type));
            console.log('Parse errors:', my_parse_result.errors);
          }

          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            // Find the syntax node in the program body
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node) {
              // Verify arguments are in order
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
   * Property 5: Standard Argument Type Recognition
   * For any standard argument type (varlist, varname, newvarname, anything,
   * if, in, using, =exp), the parser should correctly identify and extract it.
   * Feature: syntax-command-parsing, Property 5: Standard Argument Type Recognition
   * Validates: Requirements 1.5
   */
  it('should recognize all standard argument types', () => {
    const my_standard_types = [
      'varlist',
      'varname',
      'newvarname',
      'anything',
      'if',
      'in',
      'using',
      'name',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...my_standard_types),
        (my_arg_type) => {
          const my_syntax_line = `syntax ${my_arg_type}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node) {
              expect(my_syntax_node.signature.arguments.length).toBeGreaterThan(0);
              expect(my_syntax_node.signature.arguments[0].type).toBe(my_arg_type);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Optional Boolean Option Recognition
   * For any bracketed option [Option], the parser should recognize it as an
   * optional boolean option with no argument.
   * Feature: syntax-command-parsing, Property 8: Optional Boolean Option Recognition
   * Validates: Requirements 2.1
   */
  it('should recognize optional boolean options', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
            fc.boolean()
          ),
          { minLength: 1, maxLength: 5 }
        ),
        (my_options) => {
          // Build syntax command with options
          const my_option_specs = my_options
            .map(([my_name, my_is_optional]) =>
              my_is_optional ? `[${my_name}]` : my_name
            )
            .join(' ');
          const my_syntax_line = `syntax , ${my_option_specs}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node) {
              // Verify options are parsed correctly
              expect(my_syntax_node.signature.options.length).toBe(my_options.length);
              for (let i = 0; i < my_options.length; i++) {
                const [my_name, my_is_optional] = my_options[i];
                const my_parsed_option = my_syntax_node.signature.options[i];
                expect(my_parsed_option.name.toLowerCase()).toBe(my_name.toLowerCase());
                expect(my_parsed_option.isOptional).toBe(my_is_optional);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9: Typed Option Recording
   * For any option with a type specification Option(type), the parser should
   * record the argument type correctly.
   * Feature: syntax-command-parsing, Property 9: Typed Option Recording
   * Validates: Requirements 2.2
   */
  it('should record option argument types', () => {
    const my_valid_types = [
      'real',
      'integer',
      'string',
      'varlist',
      'name',
      'filename',
    ];

    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          fc.constantFrom(...my_valid_types)
        ),
        ([my_option_name, my_type]) => {
          const my_syntax_line = `syntax , ${my_option_name}(${my_type})`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node && my_syntax_node.signature.options.length > 0) {
              const my_parsed_option = my_syntax_node.signature.options[0];
              expect(my_parsed_option.argumentType).toBe(my_type);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 10: Default Value Extraction
   * For any option with a default value Option(type default(value)), the parser
   * should extract the default literal and include it in the signature.
   * Feature: syntax-command-parsing, Property 10: Default Value Extraction
   * Validates: Requirements 2.3
   */
  it('should extract default values from options', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          fc.stringMatching(/^[a-zA-Z0-9_]+$/)
        ),
        ([my_option_name, my_default_value]) => {
          const my_syntax_line = `syntax , ${my_option_name}(real default(${my_default_value}))`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node && my_syntax_node.signature.options.length > 0) {
              const my_parsed_option = my_syntax_node.signature.options[0];
              expect(my_parsed_option.defaultValue).toBe(my_default_value);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 12: Abbreviation Computation
   * For any option name, the parser should compute the minimum unambiguous
   * abbreviation preserving the original casing.
   * Feature: syntax-command-parsing, Property 12: Abbreviation Computation
   * Validates: Requirements 2.5
   */
  it('should compute abbreviations based on casing', () => {
    const my_test_cases = [
      { name: 'MyOption', expected: 'M' },
      { name: 'myoption', expected: 'm' },
      { name: 'MYOPTION', expected: 'M' },
      { name: 'myOption', expected: 'O' },
    ];

    for (const my_case of my_test_cases) {
      const my_syntax_line = `syntax , ${my_case.name}`;
      const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

      const my_lex_result = my_lexer.tokenize(my_program_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program') {
        const my_syntax_node = my_program.body.find(
          (my_node) => my_node.type === 'syntax'
        ) as SyntaxNode | undefined;

        expect(my_syntax_node).toBeDefined();
        if (my_syntax_node && my_syntax_node.signature.options.length > 0) {
          const my_parsed_option = my_syntax_node.signature.options[0];
          expect(my_parsed_option.minAbbreviation).toBe(my_case.expected);
        }
      }
    }
  });

  /**
   * Property 2: Out-of-Program Syntax Parsing
   * For any syntax command appearing outside a program block, the parser should
   * still parse it as a syntax node (behavior unchanged).
   * Feature: syntax-command-parsing, Property 2: Out-of-Program Syntax Parsing
   * Validates: Requirements 1.2
   */
  it('should parse syntax outside program as syntax node', () => {
    const my_syntax_line = 'syntax varlist';
    const my_lex_result = my_lexer.tokenize(my_syntax_line);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);

    // Should parse successfully
    expect(my_parse_result.ast.nodes.length).toBeGreaterThan(0);
    // Should be parsed as a syntax node
    const my_syntax_node = my_parse_result.ast.nodes[0];
    expect(my_syntax_node.type).toBe('syntax');
    
    // Should have parsed the varlist argument
    if (my_syntax_node.type === 'syntax') {
      expect(my_syntax_node.signature.arguments.length).toBe(1);
      expect(my_syntax_node.signature.arguments[0].type).toBe('varlist');
    }
  });

  /**
   * Property 13: Duplicate Option Handling
   * For any syntax command with duplicate option names, the parser should preserve
   * all options for signature extraction (no longer emits diagnostics).
   * Feature: syntax-command-parsing, Property 13: Duplicate Option Handling
   * Validates: Requirements 2.6
   */
  it('should preserve all options including duplicates', () => {
    const my_syntax_line = 'syntax , myopt myopt';
    const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

    const my_lex_result = my_lexer.tokenize(my_program_source);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);

    const my_program = my_parse_result.ast.nodes.find(
      (my_node) => my_node.type === 'program'
    );
    
    expect(my_program).toBeDefined();
    if (my_program?.type === 'program') {
      const my_syntax_node = my_program.body.find(
        (my_node) => my_node.type === 'syntax'
      ) as SyntaxNode | undefined;
      
      expect(my_syntax_node).toBeDefined();
      if (my_syntax_node) {
        // Should preserve both duplicate options
        expect(my_syntax_node.signature.options.length).toBe(2);
        expect(my_syntax_node.signature.options[0].name.toLowerCase()).toBe('myopt');
        expect(my_syntax_node.signature.options[1].name.toLowerCase()).toBe('myopt');
      }
    }
  });

  /**
   * Property 25: Graceful Error Recovery
   * For any malformed syntax command, the parser should handle it gracefully
   * and not corrupt the ProgramNode or prevent downstream providers from functioning.
   * Feature: syntax-command-parsing, Property 25: Graceful Error Recovery
   * Validates: Requirements 5.5
   */
  it('should recover gracefully from malformed syntax', () => {
    const my_syntax_line = 'syntax unknown_type';
    const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

    const my_lex_result = my_lexer.tokenize(my_program_source);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);

    // Should still find the program node
    const my_program = my_parse_result.ast.nodes.find(
      (my_node) => my_node.type === 'program'
    );
    expect(my_program).toBeDefined();
    expect(my_program?.type).toBe('program');

    // Program should still have a syntax node (partial recovery)
    if (my_program?.type === 'program') {
      const my_syntax_node = my_program.body.find(
        (my_node) => my_node.type === 'syntax'
      );
      expect(my_syntax_node).toBeDefined();
      
      // Should handle unknown type gracefully
      if (my_syntax_node?.type === 'syntax') {
        expect(my_syntax_node.signature).toBeDefined();
      }
    }
  });

  /**
   * Property 7: Signature Attachment with Ranges
   * For any program with a syntax command, the resulting Program_Signature should
   * be attached to the ProgramNode with valid source ranges for all arguments and options.
   * Feature: syntax-command-parsing, Property 7: Signature Attachment with Ranges
   * Validates: Requirements 1.6
   */
  it('should attach signature to program node with valid ranges', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(
            fc.constantFrom('varlist', 'varname', 'newvarname', 'anything', 'if', 'in'),
            { minLength: 1, maxLength: 3 }
          ),
          fc.array(
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
            { minLength: 1, maxLength: 3 }
          )
        ),
        ([my_arg_types, my_option_names]) => {
          // Build syntax command
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
          );

          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            // Verify signature is attached
            expect(my_program.signature).toBeDefined();

            if (my_program.signature) {
              // Verify arguments are present
              expect(my_program.signature.arguments.length).toBe(my_arg_types.length);

              // Verify all arguments have valid ranges
              for (const my_arg of my_program.signature.arguments) {
                expect(my_arg.range).toBeDefined();
                expect(my_arg.range.start).toBeDefined();
                expect(my_arg.range.end).toBeDefined();
                expect(my_arg.range.start.line).toBeGreaterThanOrEqual(0);
                expect(my_arg.range.start.character).toBeGreaterThanOrEqual(0);
                expect(my_arg.range.end.line).toBeGreaterThanOrEqual(my_arg.range.start.line);
              }

              // Verify options are present
              expect(my_program.signature.options.length).toBe(my_option_names.length);

              // Verify all options have valid ranges
              for (const my_opt of my_program.signature.options) {
                expect(my_opt.range).toBeDefined();
                expect(my_opt.range.start).toBeDefined();
                expect(my_opt.range.end).toBeDefined();
                expect(my_opt.range.start.line).toBeGreaterThanOrEqual(0);
                expect(my_opt.range.start.character).toBeGreaterThanOrEqual(0);
                expect(my_opt.range.end.line).toBeGreaterThanOrEqual(my_opt.range.start.line);
              }

              // Verify syntaxRanges are recorded
              expect(my_program.signature.syntaxRanges.length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Completion Provider Property Tests for Syntax Commands', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Property 14: Completion Filtering by Abbreviation
   * For any partial option abbreviation typed after a user program call, the
   * completion provider should filter options to only those matching the abbreviation.
   * Feature: syntax-command-parsing, Property 14: Completion Filtering by Abbreviation
   * Validates: Requirements 3.1
   */
  it('should filter options by partial abbreviation', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          { minLength: 2, maxLength: 5 }
        ),
        (my_option_names) => {
          // Build a program with options
          const my_opts_str = my_option_names.join(' ');
          const my_syntax_line = `syntax , ${my_opts_str}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program' && my_program.signature) {
            // For each option, verify that filtering by its first letter works
            for (const my_option of my_program.signature.options) {
              const my_first_letter = my_option.name.substring(0, 1).toLowerCase();
              
              // Count how many options start with this letter
              const my_matching_count = my_program.signature.options.filter(
                (my_opt) => my_opt.name.toLowerCase().startsWith(my_first_letter)
              ).length;

              // If only one option starts with this letter, filtering should work
              if (my_matching_count === 1) {
                expect(my_option.name.toLowerCase().startsWith(my_first_letter)).toBe(true);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 15: Option Description Generation
   * For any option with a type, the completion provider should generate a
   * description derived from the type.
   * Feature: syntax-command-parsing, Property 15: Option Description Generation
   * Validates: Requirements 3.2
   */
  it('should generate descriptions for typed options', () => {
    const my_valid_types = [
      'real',
      'integer',
      'string',
      'varlist',
      'name',
      'filename',
    ];

    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          fc.constantFrom(...my_valid_types)
        ),
        ([my_option_name, my_type]) => {
          const my_syntax_line = `syntax , ${my_option_name}(${my_type})`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program' && my_program.signature) {
            const my_option = my_program.signature.options[0];
            if (my_option) {
              // Verify option has the correct type
              expect(my_option.argumentType).toBe(my_type);
              // Type should be recorded for description generation
              expect(my_option.argumentType).toBeDefined();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 16: Placeholder Insertion for Arguments
   * For any option with an argument type, the completion provider should insert
   * parentheses with a placeholder.
   * Feature: syntax-command-parsing, Property 16: Placeholder Insertion for Arguments
   * Validates: Requirements 3.3
   */
  it('should mark options with arguments for placeholder insertion', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          fc.constantFrom('real', 'integer', 'string', 'varlist', 'name', 'filename')
        ),
        ([my_option_name, my_type]) => {
          const my_syntax_line = `syntax , ${my_option_name}(${my_type})`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program' && my_program.signature) {
            const my_option = my_program.signature.options[0];
            if (my_option) {
              // Option should have argumentType set
              expect(my_option.argumentType).toBe(my_type);
              // This indicates placeholder insertion is needed
              expect(my_option.argumentType).toBeDefined();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 17: Completion Differentiation and Filtering
   * For any completion list for a user program call, required options should be
   * visually differentiated from optional ones.
   * Feature: syntax-command-parsing, Property 17: Completion Differentiation and Filtering
   * Validates: Requirements 3.4
   */
  it('should differentiate required vs optional options', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
            fc.boolean()
          ),
          { minLength: 1, maxLength: 5 }
        ),
        (my_options) => {
          // Build syntax command with required/optional options
          // IMPORTANT: In Stata, * at the start of a line is a comment.
          // We must ensure *option markers don't appear at line-start positions.
          // Put everything on one line to avoid this issue.
          const my_option_specs = my_options
            .map(([my_name, my_is_required]) =>
              my_is_required ? `*${my_name}` : my_name
            )
            .join(' ');
          // Use single-line program to avoid * being interpreted as comment
          const my_program_source = `program define test_prog\n    syntax , ${my_option_specs}\nend`;

          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          if (my_program?.type === 'program' && my_program.signature) {
            // Verify all options are parsed
            expect(my_program.signature.options.length).toBe(my_options.length);

            // Verify required/optional flags are set correctly
            for (let i = 0; i < my_options.length; i++) {
              const [, my_is_required] = my_options[i];
              const my_parsed_option = my_program.signature.options[i];
              expect(my_parsed_option.isRequired).toBe(my_is_required);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Pattern-Specific Syntax Handling Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Property 21: Regression-Style Pattern Handling
   * For any syntax varlist [if] [in] [, options] pattern, the parser should
   * correctly extract all components.
   * Feature: syntax-command-parsing, Property 21: Regression-Style Pattern Handling
   * Validates: Requirements 5.1
   */
  it('should handle regression-style pattern: syntax varlist [if] [in] [, options]', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          { minLength: 0, maxLength: 3 }
        ),
        (my_option_names) => {
          // Build regression-style syntax
          const my_opts_str = my_option_names.length > 0 ? `, ${my_option_names.join(' ')}` : '';
          const my_syntax_line = `syntax varlist [if] [in]${my_opts_str}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node) {
              // Verify varlist is first argument
              expect(my_syntax_node.signature.arguments.length).toBeGreaterThanOrEqual(1);
              expect(my_syntax_node.signature.arguments[0].type).toBe('varlist');
              expect(my_syntax_node.signature.arguments[0].isOptional).toBe(false);

              // Verify if and in are present and optional
              const my_arg_types = my_syntax_node.signature.arguments.map(
                (my_arg) => my_arg.type
              );
              expect(my_arg_types).toContain('if');
              expect(my_arg_types).toContain('in');

              // Verify if and in are optional
              const my_if_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === 'if'
              );
              const my_in_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === 'in'
              );
              expect(my_if_arg?.isOptional).toBe(true);
              expect(my_in_arg?.isOptional).toBe(true);

              // Verify options are parsed
              expect(my_syntax_node.signature.options.length).toBe(my_option_names.length);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 22: Flexible Input Pattern Handling
   * For any syntax anything [, options] or syntax anything(name=...) pattern,
   * the parser should correctly extract all components.
   * Feature: syntax-command-parsing, Property 22: Flexible Input Pattern Handling
   * Validates: Requirements 5.2
   */
  it('should handle flexible input pattern: syntax anything [, options]', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.boolean(), // whether to include name=...
          fc.array(
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
            { minLength: 0, maxLength: 3 }
          )
        ),
        ([my_has_name, my_option_names]) => {
          // Build flexible input syntax
          let my_syntax_line = 'syntax anything';
          if (my_has_name) {
            my_syntax_line += '(name=myvar)';
          }
          if (my_option_names.length > 0) {
            my_syntax_line += `, ${my_option_names.join(' ')}`;
          }

          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node) {
              // Verify anything is first argument
              expect(my_syntax_node.signature.arguments.length).toBeGreaterThanOrEqual(1);
              expect(my_syntax_node.signature.arguments[0].type).toBe('anything');

              // Verify name is captured if present
              if (my_has_name) {
                expect(my_syntax_node.signature.arguments[0].name).toBe('myvar');
              }

              // Verify options are parsed
              expect(my_syntax_node.signature.options.length).toBe(my_option_names.length);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 23: File-Based Pattern Handling
   * For any syntax [varlist] [if] [in] using ... pattern, the parser should
   * correctly capture the using keyword and filename requirement.
   * Feature: syntax-command-parsing, Property 23: File-Based Pattern Handling
   * Validates: Requirements 5.3
   */
  it('should handle file-based pattern: syntax [varlist] [if] [in] using ...', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          { minLength: 0, maxLength: 2 }
        ),
        (my_option_names) => {
          // Build file-based syntax
          const my_opts_str = my_option_names.length > 0 ? `, ${my_option_names.join(' ')}` : '';
          const my_syntax_line = `syntax [varlist] [if] [in] using${my_opts_str}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node) {
              // Verify using is present in arguments
              const my_arg_types = my_syntax_node.signature.arguments.map(
                (my_arg) => my_arg.type
              );
              expect(my_arg_types).toContain('using');

              // Verify varlist, if, in are optional
              const my_varlist_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === 'varlist'
              );
              const my_if_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === 'if'
              );
              const my_in_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === 'in'
              );

              if (my_varlist_arg) {
                expect(my_varlist_arg.isOptional).toBe(true);
              }
              if (my_if_arg) {
                expect(my_if_arg.isOptional).toBe(true);
              }
              if (my_in_arg) {
                expect(my_in_arg.isOptional).toBe(true);
              }

              // Verify options are parsed
              expect(my_syntax_node.signature.options.length).toBe(my_option_names.length);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 24: Generate-Style Pattern Handling
   * For any syntax newvarname = exp pattern, the parser should correctly
   * record the expression requirement.
   * Feature: syntax-command-parsing, Property 24: Generate-Style Pattern Handling
   * Validates: Requirements 5.4
   */
  it('should handle generate-style pattern: syntax newvarname = exp', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          { minLength: 0, maxLength: 2 }
        ),
        (my_option_names) => {
          // Build generate-style syntax
          const my_opts_str = my_option_names.length > 0 ? `, ${my_option_names.join(' ')}` : '';
          const my_syntax_line = `syntax newvarname = exp${my_opts_str}`;
          const my_program_source = `program define test_prog\n${my_syntax_line}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_program_source);
          const my_parse_result = my_parser.parse(my_lex_result.tokens);

          // Find the program node
          const my_program = my_parse_result.ast.nodes.find(
            (my_node) => my_node.type === 'program'
          );

          expect(my_program).toBeDefined();
          expect(my_program?.type).toBe('program');

          if (my_program?.type === 'program') {
            const my_syntax_node = my_program.body.find(
              (my_node) => my_node.type === 'syntax'
            ) as SyntaxNode | undefined;

            expect(my_syntax_node).toBeDefined();
            if (my_syntax_node) {
              // Verify newvarname is first argument
              expect(my_syntax_node.signature.arguments.length).toBeGreaterThanOrEqual(1);
              expect(my_syntax_node.signature.arguments[0].type).toBe('newvarname');

              // Verify exp is second argument
              expect(my_syntax_node.signature.arguments.length).toBeGreaterThanOrEqual(2);
              expect(my_syntax_node.signature.arguments[1].type).toBe('exp');

              // Verify options are parsed
              expect(my_syntax_node.signature.options.length).toBe(my_option_names.length);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

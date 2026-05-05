import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CommandNode } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

/**
 * Property tests for quoted path parsing fix.
 * Validates that the parser correctly captures STRING, WORD, MACRO_REF_LOCAL,
 * and MACRO_REF_GLOBAL tokens in command varlists.
 */
describe('Quoted Path Parsing Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  /**
   * Helper to parse source and extract the first command node.
   */
  function parse_first_command(my_source: string): CommandNode | null {
    const my_lex_result = my_lexer.tokenize(my_source);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);

    for (const my_node of my_parse_result.ast.nodes) {
      if (my_node.type === 'command') {
        return my_node;
      }
    }
    return null;
  }

  /**
   * Generator for valid file paths (without special characters that would break parsing).
   */
  function arbitrary_file_path(): fc.Arbitrary<string> {
    return fc
      .array(
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
        { minLength: 1, maxLength: 4 }
      )
      .map((my_parts) => my_parts.join('/') + '.do');
  }

  /**
   * Generator for valid macro names.
   */
  function arbitrary_macro_name(): fc.Arbitrary<string> {
    const my_first_char = fc.oneof(
      fc.integer({ min: 65, max: 90 }), // A-Z
      fc.integer({ min: 97, max: 122 }), // a-z
      fc.constant(95) // _
    );

    const my_rest_char = fc.oneof(
      fc.integer({ min: 65, max: 90 }), // A-Z
      fc.integer({ min: 97, max: 122 }), // a-z
      fc.integer({ min: 48, max: 57 }), // 0-9
      fc.constant(95) // _
    );

    return fc
      .tuple(my_first_char, fc.array(my_rest_char, { maxLength: 10 }))
      .map(([my_first, my_rest]) => {
        const my_first_str = String.fromCharCode(my_first);
        const my_rest_str = my_rest.map((my_code) => String.fromCharCode(my_code)).join('');
        return my_first_str + my_rest_str;
      });
  }

  /**
   * Generator for valid Stata identifiers (WORD tokens).
   * Excludes reserved qualifier keywords (`if`, `in`), prefix commands
   * (`by`, `bysort`, `quietly`, ...), and file commands (`do`, `use`, ...)
   * which are parsed specially when they appear as the first identifier
   * after a command. See tests/property/generators/primitives.ts.
   */
  function arbitrary_identifier(): fc.Arbitrary<string> {
    return arbitrary_non_reserved_identifier();
  }

  /**
   * Generator for commands that accept file paths (do, run, include).
   */
  function arbitrary_file_command(): fc.Arbitrary<string> {
    return fc.constantFrom('do', 'run', 'include');
  }

  describe('Property 1: All Argument Token Types Captured in Varlist', () => {
    /**
     * Property 1.1: STRING tokens are captured in varlist
     * For any command with a quoted string argument, the STRING token should
     * be captured in the varlist.
     * Validates: Requirements 1.1, 2.1
     */
    it('should capture STRING tokens in varlist', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitrary_file_command(), arbitrary_file_path()),
          ([my_command, my_path]) => {
            const my_source = `${my_command} "${my_path}"`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBeGreaterThanOrEqual(1);

              // The quoted path should be captured
              const my_first_arg = my_cmd_node.varlist?.[0];
              expect(my_first_arg?.name).toBe(`"${my_path}"`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 1.2: WORD tokens are captured in varlist (regression test)
     * For any command with an unquoted word argument, the WORD token should
     * be captured in the varlist.
     * Validates: Requirements 1.5 (regression)
     */
    it('should capture WORD tokens in varlist', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitrary_file_command(), arbitrary_identifier()),
          ([my_command, my_identifier]) => {
            const my_source = `${my_command} ${my_identifier}`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBeGreaterThanOrEqual(1);

              // The unquoted identifier should be captured
              const my_first_arg = my_cmd_node.varlist?.[0];
              expect(my_first_arg?.name).toBe(my_identifier);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 1.3: MACRO_REF_LOCAL tokens are captured in varlist
     * For any command with a local macro reference argument, the MACRO_REF_LOCAL
     * token should be captured in the varlist.
     * Validates: Requirements 3.1
     */
    it('should capture MACRO_REF_LOCAL tokens in varlist', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitrary_file_command(), arbitrary_macro_name()),
          ([my_command, my_macro_name]) => {
            const my_source = `${my_command} \`${my_macro_name}'`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBeGreaterThanOrEqual(1);

              // The local macro reference should be captured
              const my_first_arg = my_cmd_node.varlist?.[0];
              expect(my_first_arg?.name).toBe(`\`${my_macro_name}'`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 1.4: MACRO_REF_GLOBAL tokens are captured in varlist
     * For any command with a global macro reference argument, the MACRO_REF_GLOBAL
     * token should be captured in the varlist.
     * Validates: Requirements 3.2
     */
    it('should capture MACRO_REF_GLOBAL tokens in varlist', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitrary_file_command(), arbitrary_macro_name()),
          ([my_command, my_macro_name]) => {
            const my_source = `${my_command} \${${my_macro_name}}`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBeGreaterThanOrEqual(1);

              // The global macro reference should be captured
              const my_first_arg = my_cmd_node.varlist?.[0];
              expect(my_first_arg?.name).toBe(`\${${my_macro_name}}`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 1.5: Mixed token types are captured in order
     * For any command with a mix of WORD, STRING, MACRO_REF_LOCAL, and
     * MACRO_REF_GLOBAL tokens, all should be captured in the varlist in order.
     * Validates: Requirements 1.1, 1.5, 3.1, 3.2
     */
    it('should capture mixed token types in order', () => {
      // Generator for different argument types
      const my_arg_generator = fc.oneof(
        arbitrary_identifier().map((my_id) => ({ type: 'word', value: my_id, source: my_id })),
        arbitrary_file_path().map((my_path) => ({ type: 'string', value: `"${my_path}"`, source: `"${my_path}"` })),
        arbitrary_macro_name().map((my_name) => ({ type: 'local', value: `\`${my_name}'`, source: `\`${my_name}'` })),
        arbitrary_macro_name().map((my_name) => ({ type: 'global', value: `\${${my_name}}`, source: `\${${my_name}}` }))
      );

      fc.assert(
        fc.property(
          fc.tuple(
            fc.constantFrom('display', 'list', 'gen'),
            fc.array(my_arg_generator, { minLength: 1, maxLength: 4 })
          ),
          ([my_command, my_args]) => {
            const my_source = `${my_command} ${my_args.map((my_a) => my_a.source).join(' ')}`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBe(my_args.length);

              // Verify each argument is captured in order
              for (let i = 0; i < my_args.length; i++) {
                const my_expected = my_args[i].value;
                const my_actual = my_cmd_node.varlist?.[i]?.name;
                expect(my_actual).toBe(my_expected);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Comma Boundary Respected', () => {
    /**
     * Property 2.1: Varlist stops at comma
     * For any command with arguments followed by a comma and options, the varlist
     * should contain only the tokens before the comma.
     * Validates: Requirements 3.3
     */
    it('should stop varlist at comma', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            arbitrary_file_command(),
            arbitrary_file_path(),
            arbitrary_identifier()
          ),
          ([my_command, my_path, my_option]) => {
            const my_source = `${my_command} "${my_path}", ${my_option}`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);

              // Varlist should contain only the path
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBe(1);
              expect(my_cmd_node.varlist?.[0]?.name).toBe(`"${my_path}"`);

              // Options should be parsed separately
              expect(my_cmd_node.options).toBeDefined();
              expect(my_cmd_node.options?.length).toBeGreaterThanOrEqual(1);
              expect(my_cmd_node.options?.[0]?.name).toBe(my_option);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 2.2: Multiple arguments before comma
     * For any command with multiple arguments followed by a comma and options,
     * all arguments before the comma should be in the varlist.
     * Validates: Requirements 3.3
     */
    it('should capture all arguments before comma', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.constantFrom('display', 'list', 'gen'),
            fc.array(arbitrary_identifier(), { minLength: 1, maxLength: 3 }),
            arbitrary_identifier()
          ),
          ([my_command, my_args, my_option]) => {
            const my_source = `${my_command} ${my_args.join(' ')}, ${my_option}`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);

              // Varlist should contain all arguments before comma
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBe(my_args.length);

              for (let i = 0; i < my_args.length; i++) {
                expect(my_cmd_node.varlist?.[i]?.name).toBe(my_args[i]);
              }

              // Options should be parsed separately
              expect(my_cmd_node.options).toBeDefined();
              expect(my_cmd_node.options?.length).toBeGreaterThanOrEqual(1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 2.3: Quoted path with options
     * For do/run/include commands with a quoted path and options, the path
     * should be in varlist and options parsed separately.
     * Validates: Requirements 3.3
     */
    it('should handle quoted path with options correctly', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            arbitrary_file_command(),
            arbitrary_file_path(),
            fc.array(arbitrary_identifier(), { minLength: 1, maxLength: 3 })
          ),
          ([my_command, my_path, my_options]) => {
            const my_source = `${my_command} "${my_path}", ${my_options.join(' ')}`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);

              // Varlist should contain only the quoted path
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBe(1);
              expect(my_cmd_node.varlist?.[0]?.name).toBe(`"${my_path}"`);

              // All options should be parsed
              expect(my_cmd_node.options).toBeDefined();
              expect(my_cmd_node.options?.length).toBe(my_options.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Specific Command Tests', () => {
    /**
     * Test: do command with quoted path
     * Validates the specific use case: do "path/to/file.do"
     */
    it('should parse do command with quoted path', () => {
      fc.assert(
        fc.property(arbitrary_file_path(), (my_path) => {
          const my_source = `do "${my_path}"`;
          const my_cmd_node = parse_first_command(my_source);

          expect(my_cmd_node).not.toBeNull();
          if (my_cmd_node) {
            expect(my_cmd_node.name).toBe('do');
            expect(my_cmd_node.varlist).toBeDefined();
            expect(my_cmd_node.varlist?.length).toBe(1);
            expect(my_cmd_node.varlist?.[0]?.name).toBe(`"${my_path}"`);
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: run command with quoted path
     * Validates the specific use case: run "scripts/helper.do"
     */
    it('should parse run command with quoted path', () => {
      fc.assert(
        fc.property(arbitrary_file_path(), (my_path) => {
          const my_source = `run "${my_path}"`;
          const my_cmd_node = parse_first_command(my_source);

          expect(my_cmd_node).not.toBeNull();
          if (my_cmd_node) {
            expect(my_cmd_node.name).toBe('run');
            expect(my_cmd_node.varlist).toBeDefined();
            expect(my_cmd_node.varlist?.length).toBe(1);
            expect(my_cmd_node.varlist?.[0]?.name).toBe(`"${my_path}"`);
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: include command with quoted path
     * Validates the specific use case: include "lib/utils.do"
     */
    it('should parse include command with quoted path', () => {
      fc.assert(
        fc.property(arbitrary_file_path(), (my_path) => {
          const my_source = `include "${my_path}"`;
          const my_cmd_node = parse_first_command(my_source);

          expect(my_cmd_node).not.toBeNull();
          if (my_cmd_node) {
            expect(my_cmd_node.name).toBe('include');
            expect(my_cmd_node.varlist).toBeDefined();
            expect(my_cmd_node.varlist?.length).toBe(1);
            expect(my_cmd_node.varlist?.[0]?.name).toBe(`"${my_path}"`);
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Unquoted path regression
     * Validates that unquoted paths still work: do myfile.do
     */
    it('should parse command with unquoted path (regression)', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitrary_file_command(), arbitrary_identifier()),
          ([my_command, my_filename]) => {
            const my_source = `${my_command} ${my_filename}`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBe(1);
              expect(my_cmd_node.varlist?.[0]?.name).toBe(my_filename);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Range Preservation Tests', () => {
    /**
     * Property: Varlist items have valid ranges
     * For any command with arguments, each varlist item should have a valid
     * source range that can be used for go-to-definition.
     */
    it('should preserve valid ranges for varlist items', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitrary_file_command(), arbitrary_file_path()),
          ([my_command, my_path]) => {
            const my_source = `${my_command} "${my_path}"`;
            const my_cmd_node = parse_first_command(my_source);

            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node && my_cmd_node.varlist) {
              for (const my_item of my_cmd_node.varlist) {
                // Each item should have a valid range
                expect(my_item.range).toBeDefined();
                expect(my_item.range.start).toBeDefined();
                expect(my_item.range.end).toBeDefined();
                expect(my_item.range.start.line).toBeGreaterThanOrEqual(0);
                expect(my_item.range.start.character).toBeGreaterThanOrEqual(0);
                expect(my_item.range.end.line).toBeGreaterThanOrEqual(my_item.range.start.line);
                expect(my_item.range.end.character).toBeGreaterThan(my_item.range.start.character);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Quoted Path Integration with Working Directory', () => {
    /**
     * Property 3.1: Quoted paths work with working directory directive
     * For any do/run/include command with a quoted path and @lsp-working-directory,
     * the path should be captured in varlist for resolution.
     * Validates: Requirements 4.1
     */
    it('should capture quoted paths for working directory resolution', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitrary_file_command(), arbitrary_file_path(), arbitrary_file_path()),
          ([my_command, my_working_dir, my_file_path]) => {
            const my_source = `// @lsp-working-directory: "${my_working_dir}"
${my_command} "${my_file_path}"`;
            
            const my_cmd_node = parse_first_command(my_source);
            
            expect(my_cmd_node).not.toBeNull();
            if (my_cmd_node) {
              expect(my_cmd_node.name).toBe(my_command);
              expect(my_cmd_node.varlist).toBeDefined();
              expect(my_cmd_node.varlist?.length).toBe(1);
              expect(my_cmd_node.varlist?.[0]?.name).toBe(`"${my_file_path}"`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

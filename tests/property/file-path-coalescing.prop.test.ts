import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CommandNode } from '../../src/types';
import { FILE_COMMANDS } from '../../src/utils/file-path-utils';
import { RESERVED_QUALIFIER_KEYWORDS, arbitrary_non_reserved_identifier } from './generators';

/**
 * Property tests for file path coalescing in parser.
 * Validates that unquoted file paths are correctly parsed as single varlist entries.
 */
describe('File Path Coalescing Property Tests', () => {
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
   * Generator for file commands.
   */
  function arbitrary_file_command(): fc.Arbitrary<string> {
    return fc.constantFrom(...Array.from(FILE_COMMANDS));
  }

  /**
   * Property 1: Unquoted Path Coalescing
   * For any file command with an unquoted path containing `/` separators,
   * the entire path should be captured as a single varlist entry.
   */
  it('should coalesce unquoted file paths into single varlist entries', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        arbitrary_file_path(),
        (my_command, my_path) => {
          const my_source = `${my_command} ${my_path}`;
          const my_command_node = parse_first_command(my_source);

          expect(my_command_node).not.toBeNull();
          expect(my_command_node!.name).toBe(my_command);
          expect(my_command_node!.varlist).toBeDefined();
          expect(my_command_node!.varlist!.length).toBe(1);
          expect(my_command_node!.varlist![0].name).toBe(my_path);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Path with Options Separation
   * For any file command with a path followed by a comma and options,
   * the path should be in varlist and options should be parsed separately.
   */
  it('should separate file paths from options correctly', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        arbitrary_file_path(),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/), // Valid option name
        (my_command, my_path, my_option) => {
          const my_source = `${my_command} ${my_path}, ${my_option}`;
          const my_command_node = parse_first_command(my_source);

          expect(my_command_node).not.toBeNull();
          expect(my_command_node!.name).toBe(my_command);
          expect(my_command_node!.varlist).toBeDefined();
          expect(my_command_node!.varlist!.length).toBe(1);
          expect(my_command_node!.varlist![0].name).toBe(my_path);
          expect(my_command_node!.options).toBeDefined();
          expect(my_command_node!.options!.length).toBe(1);
          expect(my_command_node!.options![0].name).toBe(my_option);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Division Operator Preservation
   * For any arithmetic expression containing `/` (like `gen x = a/b`),
   * the `/` should be treated as division, not a path separator.
   */
  it('should preserve division operator in arithmetic expressions', () => {
    fc.assert(
      fc.property(
        arbitrary_non_reserved_identifier(),
        arbitrary_non_reserved_identifier(),
        arbitrary_non_reserved_identifier(),
        (my_var, my_a, my_b) => {
          const my_source = `gen ${my_var} = ${my_a}/${my_b}`;
          const my_command_node = parse_first_command(my_source);

          expect(my_command_node).not.toBeNull();
          expect(my_command_node!.name).toBe('gen');
          expect(my_command_node!.varlist).toBeDefined();
          // Should have the variable name only, not the full expression
          expect(my_command_node!.varlist!.length).toBe(1);
          expect(my_command_node!.varlist![0].name).toBe(my_var);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Macro Path Coalescing
   * For any file command with a macro reference followed by path components,
   * all components should be coalesced into a single varlist entry.
   */
  it('should coalesce macro references with path components', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
        (my_command, my_macro, my_filename) => {
          const my_source = `${my_command} \`${my_macro}'/${my_filename}.do`;
          const my_command_node = parse_first_command(my_source);

          expect(my_command_node).not.toBeNull();
          expect(my_command_node!.name).toBe(my_command);
          expect(my_command_node!.varlist).toBeDefined();
          expect(my_command_node!.varlist!.length).toBe(1);
          expect(my_command_node!.varlist![0].name).toBe(`\`${my_macro}'/${my_filename}.do`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Quoted Path Preservation
   * Quoted paths should continue to work as before (no regression).
   */
  it('should preserve quoted path behavior', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        arbitrary_file_path(),
        (my_command, my_path) => {
          const my_source = `${my_command} "${my_path}"`;
          const my_command_node = parse_first_command(my_source);

          expect(my_command_node).not.toBeNull();
          expect(my_command_node!.name).toBe(my_command);
          expect(my_command_node!.varlist).toBeDefined();
          expect(my_command_node!.varlist!.length).toBe(1);
          expect(my_command_node!.varlist![0].name).toBe(`"${my_path}"`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Non-File Command Behavior
   * Non-file commands should not use path coalescing.
   * 
   * Note: Uses arbitrary_non_reserved_identifier for my_a because reserved
   * qualifier keywords ('if', 'in') in varlist position are parsed as qualifiers,
   * not variable names (e.g., `gen in/a` parses 'in' as in-qualifier).
   */
  it('should not coalesce paths for non-file commands', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('gen', 'replace', 'drop', 'keep'),
        arbitrary_non_reserved_identifier(),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
        (my_command, my_a, my_b) => {
          const my_source = `${my_command} ${my_a}/${my_b}`;
          const my_command_node = parse_first_command(my_source);

          expect(my_command_node).not.toBeNull();
          expect(my_command_node!.name).toBe(my_command);
          expect(my_command_node!.varlist).toBeDefined();
          
          // Should have the first variable only, not coalesced with /
          expect(my_command_node!.varlist!.length).toBe(1);
          expect(my_command_node!.varlist![0].name).toBe(my_a);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Regression: Ensure reserved qualifier keywords are excluded from generators.
   * This prevents false failures when 'if'/'in' appear in varlist position
   * and get parsed as qualifiers instead of variable names.
   */
  it('should exclude reserved qualifier keywords from non-reserved identifier generator', () => {
    fc.assert(
      fc.property(
        arbitrary_non_reserved_identifier(),
        (my_id) => {
          expect(RESERVED_QUALIFIER_KEYWORDS).not.toContain(my_id);
        }
      ),
      { numRuns: 200 }
    );
  });
});

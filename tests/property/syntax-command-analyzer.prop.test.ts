import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { SyntaxNode } from '../../src/types';

describe('Syntax Command Analyzer Property Tests', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;
  let my_analyzer: SemanticAnalyzer;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
    my_analyzer = new SemanticAnalyzer();
  });

  function analyze_program(my_source: string) {
    const my_lex_result = my_lexer.tokenize(my_source);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);
    const my_analysis_result = my_analyzer.analyze(
      my_parse_result.ast,
      'test://file.do',
      undefined,
      { undefined_macro_enabled: true },
      my_lex_result.tokens
    );
    return my_analysis_result;
  }

  /**
   * Property 29: Implicit Local Registration
   * For any syntax command, the analyzer should register all argument and option
   * names as implicit local macros in the program scope.
   * Feature: syntax-command-parsing, Property 29: Implicit Local Registration
   * Validates: Requirements 6.4
   */
  it('should register all arguments as implicit locals', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            'varlist',
            'varname',
            'newvarname',
            'anything',
            'if',
            'in'
          ),
          { minLength: 1, maxLength: 5 }
        ),
        (my_arg_types) => {
          // Build program with syntax command
          const my_args_str = my_arg_types.join(' ');
          const my_source = `program define test_prog\nsyntax ${my_args_str}\nend`;

          // Analyze
          const my_result = analyze_program(my_source);

          // Verify each argument type is registered as a local macro
          for (const my_arg_type of my_arg_types) {
            expect(my_result.symbols.localMacros.has(my_arg_type)).toBe(true);
            const my_macro = my_result.symbols.localMacros.get(my_arg_type);
            expect(my_macro?.scope).toBe('local');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 29b: Implicit Local Registration for Options
   * For any syntax command with options, the analyzer should register all option
   * names as implicit local macros in the program scope.
   * Feature: syntax-command-parsing, Property 29b: Implicit Local Registration for Options
   * Validates: Requirements 6.4
   */
  it('should register all options as implicit locals', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/),
          { minLength: 1, maxLength: 5 }
        ),
        (my_option_names) => {
          // Build program with syntax command
          const my_opts_str = my_option_names.join(' ');
          const my_source = `program define test_prog\nsyntax , ${my_opts_str}\nend`;

          // Analyze
          const my_result = analyze_program(my_source);

          // Verify each option is registered as a local macro. Stata uses
          // uppercase letters in option names only to declare a minimum
          // abbreviation; the implicit local it creates at runtime is the
          // lowercase form of the name. Multiple options that differ only
          // in case (e.g. `Foo` and `foo`) collapse onto one runtime local,
          // so we deduplicate by the lowercase form before asserting.
          const the_runtime_names = new Set(
            my_option_names.map((my_name) => my_name.toLowerCase())
          );
          for (const my_runtime_name of the_runtime_names) {
            expect(my_result.symbols.localMacros.has(my_runtime_name)).toBe(true);
            const my_macro = my_result.symbols.localMacros.get(my_runtime_name);
            expect(my_macro?.scope).toBe('local');
          }
          // Also confirm we did not silently drop options: every distinct
          // lowercase name should map to exactly one entry in localMacros.
          let the_matching_local_count = 0;
          for (const my_runtime_name of the_runtime_names) {
            if (my_result.symbols.localMacros.has(my_runtime_name)) {
              the_matching_local_count++;
            }
          }
          expect(the_matching_local_count).toBe(the_runtime_names.size);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 30: Implicit Local Suppression of Undefined Macro Diagnostics
   * For any implicit local macro created by syntax, the analyzer should not report
   * "Undefined Macro" diagnostics for references to that macro within the program.
   * Feature: syntax-command-parsing, Property 30: Implicit Local Suppression of Undefined Macro Diagnostics
   * Validates: Requirements 6.5
   */
  it('should suppress undefined macro diagnostics for implicit locals', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('varlist', 'varname', 'if', 'in'),
        (my_arg_type) => {
          // Build program that references the implicit local
          const my_source = `program define test_prog\nsyntax ${my_arg_type}\ndisplay \`${my_arg_type}'\nend`;

          // Analyze with undefined macro checking enabled
          const my_result = analyze_program(my_source);

          // Should NOT have undefined macro diagnostic for this reference
          const my_has_undefined_diagnostic = my_result.diagnostics.some(
            (my_diag) =>
              my_diag.message.includes(`Undefined local macro: \`${my_arg_type}'`)
          );
          expect(my_has_undefined_diagnostic).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 30b: Implicit Local Suppression for Options
   * For any option created by syntax, the analyzer should not report "Undefined Macro"
   * diagnostics for references to that option within the program.
   * Feature: syntax-command-parsing, Property 30b: Implicit Local Suppression for Options
   * Validates: Requirements 6.5
   */
  it('should suppress undefined macro diagnostics for option names', () => {
    const my_test_options = ['myopt', 'replace', 'detail', 'verbose'];

    for (const my_option_name of my_test_options) {
      // Build program that references the option as a macro
      const my_source = `program define test_prog\nsyntax , ${my_option_name}\nif \`${my_option_name}' != "" {\n  display "option set"\n}\nend`;

      // Analyze with undefined macro checking enabled
      const my_result = analyze_program(my_source);

      // Should NOT have undefined macro diagnostic for this reference
      const my_has_undefined_diagnostic = my_result.diagnostics.some(
        (my_diag) =>
          my_diag.message.includes(`Undefined local macro: \`${my_option_name}'`)
      );
      expect(my_has_undefined_diagnostic).toBe(false);
    }
  });

  /**
   * Property 31: Implicit Local Scope Restriction
   * For any implicit local macro created by syntax, its visibility should be
   * restricted to the body of the defining program.
   * Feature: syntax-command-parsing, Property 31: Implicit Local Scope Restriction
   * Validates: Requirements 7.1
   */
  it('should register implicit locals in program scope', () => {
    const my_source = `
program define test_prog
  syntax varlist
end
`;

    // Analyze
    const my_result = analyze_program(my_source);

    // The varlist macro should be registered as a local
    expect(my_result.symbols.localMacros.has('varlist')).toBe(true);
    const my_macro = my_result.symbols.localMacros.get('varlist');
    expect(my_macro?.scope).toBe('local');
    expect(my_macro?.containingScope).toBe('program');
  });

  /**
   * Property 32: Implicit Local Non-Leakage
   * For any implicit local macro created by syntax, it should not leak into
   * global scope or parent calling scopes.
   * Feature: syntax-command-parsing, Property 32: Implicit Local Non-Leakage
   * Validates: Requirements 7.2
   */
  it('should not register implicit locals as global macros', () => {
    const my_source = `
program define test_prog
  syntax varlist
end
`;

    // Analyze
    const my_result = analyze_program(my_source);

    // The varlist macro should NOT be in globalMacros
    expect(my_result.symbols.globalMacros.has('varlist')).toBe(false);

    // It should be in localMacros
    expect(my_result.symbols.localMacros.has('varlist')).toBe(true);
  });

  /**
   * Property 33: Implicit Local Independence
   * For any implicit local macro created by syntax, it should exist independently
   * of global macros with the same name (no masking or shadowing).
   * Feature: syntax-command-parsing, Property 33: Implicit Local Independence
   * Validates: Requirements 7.3
   */
  it('should not shadow global macros with same name', () => {
    const my_source = `
global varlist "global_value"

program define test_prog
  syntax varlist
end
`;

    // Analyze
    const my_result = analyze_program(my_source);

    // Both global and local varlist should exist
    expect(my_result.symbols.globalMacros.has('varlist')).toBe(true);
    expect(my_result.symbols.localMacros.has('varlist')).toBe(true);

    // The local should be distinct from the global
    const my_local_macro = my_result.symbols.localMacros.get('varlist');
    const my_global_macro = my_result.symbols.globalMacros.get('varlist');
    expect(my_local_macro).not.toBe(my_global_macro);
  });

  /**
   * Property 34: Multiple Syntax Commands Handling
   * For any program with multiple syntax commands, all implicit locals from all
   * syntax commands should be available in the code following them.
   * Feature: syntax-command-parsing, Property 34: Multiple Syntax Commands Handling
   * Validates: Requirements 7.4
   */
  it('should register implicit locals from all syntax commands', () => {
    const my_source = `
program define test_prog
  syntax varlist
  syntax , myopt
end
`;

    // Analyze
    const my_result = analyze_program(my_source);

    // Both varlist and myopt should be registered
    expect(my_result.symbols.localMacros.has('varlist')).toBe(true);
    expect(my_result.symbols.localMacros.has('myopt')).toBe(true);
  });

  /**
   * Property 35: Command Validation Against Multiple Syntaxes
   * For any program call to a user program with multiple syntax commands, the
   * analyzer should validate the call against each syntax in order and emit a
   * diagnostic only if the call is invalid under all syntaxes.
   * Feature: syntax-command-parsing, Property 35: Command Validation Against Multiple Syntaxes
   * Validates: Requirements 3, 6.6, 7.4
   */
  it('should handle multiple syntax commands in program', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom('varlist', 'varname', 'anything'),
          { minLength: 1, maxLength: 3 }
        ),
        (my_arg_types) => {
          // Build program with multiple syntax commands
          const my_syntax_lines = my_arg_types
            .map((my_type) => `syntax ${my_type}`)
            .join('\n');
          const my_source = `program define test_prog\n${my_syntax_lines}\nend`;

          // Analyze
          const my_result = analyze_program(my_source);

          // All arguments should be registered
          for (const my_arg_type of my_arg_types) {
            expect(my_result.symbols.localMacros.has(my_arg_type)).toBe(true);
          }

          // Program should have signature attached
          const my_program = my_result.symbols.programs.get('test_prog');
          expect(my_program?.signature).toBeDefined();

          if (my_program?.signature) {
            // Signature should contain all arguments
            expect(my_program.signature.arguments.length).toBeGreaterThanOrEqual(
              my_arg_types.length
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


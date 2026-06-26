import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { SyntaxNode, ProgramNode, StataDiagnosticCode } from '../../src/types';

/**
 * Property Tests for Weight Argument Implicit Locals
 * 
 * Feature: syntax-command-bugs, Property 2: Weight argument implicit locals
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 * 
 * These tests verify that weight argument types in syntax commands
 * correctly register both 'weight' and 'exp' as implicit local macros.
 */
describe('Weight Argument Implicit Locals Property Tests', () => {
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
    return { my_analysis_result, my_parse_result };
  }

  /**
   * Property 2: Weight argument implicit locals
   * For any syntax command containing a weight argument type (weight, fweight, fw,
   * aweight, aw, pweight, pw, iweight, iw), the analyzer should:
   * - Register 'weight' as an implicit local macro
   * - Register 'exp' as an implicit local macro
   * - Not emit "Undefined local macro" diagnostics for references to `weight` or `exp`
   * 
   * Feature: syntax-command-bugs, Property 2: Weight argument implicit locals
   * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
   */
  it('should register weight and exp as implicit locals for all weight types', () => {
    const my_weight_type_generator = fc.constantFrom(
      'weight',
      'fweight', 'fw',
      'aweight', 'aw',
      'pweight', 'pw',
      'iweight', 'iw'
    );

    fc.assert(
      fc.property(
        my_weight_type_generator,
        (my_weight_type) => {
          // Build program with weight argument
          const my_source = `program define test_prog\nsyntax [${my_weight_type}]\nend`;

          // Analyze
          const { my_analysis_result } = analyze_program(my_source);

          // Requirement 2.2, 2.6: Should register 'weight' as implicit local
          expect(my_analysis_result.symbols.localMacros.has('weight')).toBe(true);
          const my_weight_macro = my_analysis_result.symbols.localMacros.get('weight');
          expect(my_weight_macro?.scope).toBe('local');

          // Requirement 2.2, 2.6: Should also register 'exp' as implicit local
          expect(my_analysis_result.symbols.localMacros.has('exp')).toBe(true);
          const my_exp_macro = my_analysis_result.symbols.localMacros.get('exp');
          expect(my_exp_macro?.scope).toBe('local');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2b: Parser recognizes weight argument types
   * For any weight type variant, the parser should recognize it as a valid argument type.
   * 
   * Feature: syntax-command-bugs, Property 2: Weight argument implicit locals
   * Validates: Requirements 2.1, 2.5, 2.7
   */
  it('should parse all weight type variants as valid argument types', () => {
    const my_weight_type_generator = fc.constantFrom(
      'weight',
      'fweight', 'fw',
      'aweight', 'aw',
      'pweight', 'pw',
      'iweight', 'iw'
    );

    fc.assert(
      fc.property(
        my_weight_type_generator,
        (my_weight_type) => {
          // Build program with weight argument
          const my_source = `program define test_prog\nsyntax [${my_weight_type}]\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_source);
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
              // Should have parsed the weight argument
              expect(my_syntax_node.signature.arguments.length).toBeGreaterThan(0);
              
              // Find the weight argument
              const my_weight_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === my_weight_type
              );
              expect(my_weight_arg).toBeDefined();
              expect(my_weight_arg?.type).toBe(my_weight_type);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2c: No undefined macro diagnostics for weight and exp
   * For any program using weight and exp macros after a syntax command with weight,
   * the analyzer should NOT emit undefined macro diagnostics.
   * 
   * Feature: syntax-command-bugs, Property 2: Weight argument implicit locals
   * Validates: Requirements 2.3, 2.4
   */
  it('should suppress undefined macro diagnostics for weight and exp', () => {
    const my_weight_type_generator = fc.constantFrom(
      'weight',
      'fweight', 'fw',
      'aweight', 'aw',
      'pweight', 'pw',
      'iweight', 'iw'
    );

    fc.assert(
      fc.property(
        my_weight_type_generator,
        (my_weight_type) => {
          // Build program that references weight and exp macros
          const my_source = `program define test_prog
syntax [${my_weight_type}]
display "\`weight'"
display "\`exp'"
end`;

          // Analyze with undefined macro checking enabled
          const { my_analysis_result } = analyze_program(my_source);

          // Requirement 2.3: Should NOT have undefined macro diagnostic for weight
          const my_has_weight_diagnostic = my_analysis_result.diagnostics.some(
            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO && my_diag.message.includes("`weight'")
          );
          expect(my_has_weight_diagnostic).toBe(false);

          // Requirement 2.4: Should NOT have undefined macro diagnostic for exp
          const my_has_exp_diagnostic = my_analysis_result.diagnostics.some(
            (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO && my_diag.message.includes("`exp'")
          );
          expect(my_has_exp_diagnostic).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2d: Weight arguments in both required and optional positions
   * For any weight argument in either required or optional position,
   * the parser should recognize it correctly.
   * 
   * Feature: syntax-command-bugs, Property 2: Weight argument implicit locals
   * Validates: Requirements 2.7
   */
  it('should recognize weight arguments in both required and optional positions', () => {
    const my_weight_type_generator = fc.constantFrom(
      'weight',
      'fweight', 'fw',
      'aweight', 'aw',
      'pweight', 'pw',
      'iweight', 'iw'
    );

    const my_is_optional_generator = fc.boolean();

    fc.assert(
      fc.property(
        fc.tuple(my_weight_type_generator, my_is_optional_generator),
        ([my_weight_type, my_is_optional]) => {
          // Build program with weight argument (optional or required)
          const my_weight_spec = my_is_optional ? `[${my_weight_type}]` : my_weight_type;
          const my_source = `program define test_prog\nsyntax ${my_weight_spec}\nend`;

          // Parse
          const my_lex_result = my_lexer.tokenize(my_source);
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
              // Should have parsed the weight argument
              const my_weight_arg = my_syntax_node.signature.arguments.find(
                (my_arg) => my_arg.type === my_weight_type
              );
              expect(my_weight_arg).toBeDefined();
              expect(my_weight_arg?.isOptional).toBe(my_is_optional);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2e: Weight with other arguments
   * For any syntax command with weight and other arguments,
   * all arguments should be correctly parsed and implicit locals registered.
   * 
   * Feature: syntax-command-bugs, Property 2: Weight argument implicit locals
   * Validates: Requirements 2.1, 2.2, 2.5, 2.6
   */
  it('should handle weight with other arguments', () => {
    const my_weight_type_generator = fc.constantFrom(
      'weight', 'fw', 'aw', 'pw', 'iw'
    );

    fc.assert(
      fc.property(
        my_weight_type_generator,
        (my_weight_type) => {
          // Build program with varlist, if, in, and weight
          const my_source = `program define test_prog
syntax varlist [if] [in] [${my_weight_type}]
end`;

          // Analyze
          const { my_analysis_result, my_parse_result } = analyze_program(my_source);

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
              // Should have all arguments
              const my_arg_types = my_syntax_node.signature.arguments.map(
                (my_arg) => my_arg.type
              );
              expect(my_arg_types).toContain('varlist');
              expect(my_arg_types).toContain('if');
              expect(my_arg_types).toContain('in');
              expect(my_arg_types).toContain(my_weight_type);
            }
          }

          // Should register all implicit locals including weight and exp
          expect(my_analysis_result.symbols.localMacros.has('varlist')).toBe(true);
          expect(my_analysis_result.symbols.localMacros.has('if')).toBe(true);
          expect(my_analysis_result.symbols.localMacros.has('in')).toBe(true);
          expect(my_analysis_result.symbols.localMacros.has('weight')).toBe(true);
          expect(my_analysis_result.symbols.localMacros.has('exp')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

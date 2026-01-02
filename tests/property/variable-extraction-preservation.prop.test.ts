import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { arbitrary_identifier } from './generators';

describe('Variable Extraction Preservation Property Tests', () => {
  let lexer: StataLexer;
  let parser: StataParser;
  let analyzer: SemanticAnalyzer;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
    analyzer = new SemanticAnalyzer();
  });

  /**
   * Generate valid gen command with variable assignment
   */
  function arbitrary_gen_command(): fc.Arbitrary<{ source: string; varname: string }> {
    return fc
      .tuple(
        fc.constantFrom('gen', 'generate'),
        arbitrary_identifier(),
        fc.oneof(
          fc.integer({ min: 1, max: 100 }).map(n => n.toString()),
          fc.string({ minLength: 1, maxLength: 10 }).map(s => `"${s}"`),
          arbitrary_identifier()
        )
      )
      .map(([cmd, varname, expr]) => ({
        source: `${cmd} ${varname} = ${expr}`,
        varname
      }));
  }

  /**
   * Generate valid egen command with variable assignment
   */
  function arbitrary_egen_command(): fc.Arbitrary<{ source: string; varname: string }> {
    return fc
      .tuple(
        arbitrary_identifier(),
        fc.constantFrom('sum', 'mean', 'max', 'min', 'count'),
        arbitrary_identifier()
      )
      .map(([varname, func, arg]) => ({
        source: `egen ${varname} = ${func}(${arg})`,
        varname
      }));
  }

  /**
   * Property Test 5.1: extract_gen_variable compatibility with new AST structure
   * 
   * Validates Requirements 3.1: Variable extraction continues to work correctly
   * 
   * For any valid gen/generate command, the analyzer should:
   * 1. Successfully parse the command into a CommandNode
   * 2. Extract the variable name into the symbol table
   * 3. Mark the variable source as 'gen'
   */
  it('should extract variables from gen commands with new AST structure', () => {
    fc.assert(
      fc.property(arbitrary_gen_command(), ({ source, varname }) => {
        // Tokenize, parse, and analyze
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

        // Verify the variable was extracted
        expect(result.symbols.variables.has(varname)).toBe(true);
        
        const variable = result.symbols.variables.get(varname);
        expect(variable).toBeDefined();
        expect(variable!.name).toBe(varname);
        expect(variable!.source).toBe('gen');
        expect(variable!.sourceUri).toBe('test://file.do');
      })
    );
  });

  /**
   * Property Test 5.2: extract_egen_variable compatibility with new AST structure
   * 
   * Validates Requirements 3.2: Variable extraction continues to work correctly
   * 
   * For any valid egen command, the analyzer should:
   * 1. Successfully parse the command into a CommandNode
   * 2. Extract the variable name into the symbol table
   * 3. Mark the variable source as 'egen'
   */
  it('should extract variables from egen commands with new AST structure', () => {
    fc.assert(
      fc.property(arbitrary_egen_command(), ({ source, varname }) => {
        // Tokenize, parse, and analyze
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

        // Verify the variable was extracted
        expect(result.symbols.variables.has(varname)).toBe(true);
        
        const variable = result.symbols.variables.get(varname);
        expect(variable).toBeDefined();
        expect(variable!.name).toBe(varname);
        expect(variable!.source).toBe('egen');
        expect(variable!.sourceUri).toBe('test://file.do');
      })
    );
  });

  /**
   * Property Test 5.3: Variable extraction preservation across AST changes
   * 
   * Validates that variable extraction functions work correctly with:
   * 1. Different command abbreviations (gen vs generate)
   * 2. Various expression types (numbers, strings, identifiers)
   * 3. Complex variable names (valid Stata identifiers)
   * 
   * This test ensures the CommandNode.varlist structure is correctly
   * accessed by extract_gen_variable and extract_egen_variable functions.
   */
  it('should preserve variable extraction across different command forms', () => {
    const test_cases = [
      // gen command variations
      { source: 'gen x = 1', expected_var: 'x', expected_source: 'gen' },
      { source: 'generate y = 2', expected_var: 'y', expected_source: 'gen' },
      { source: 'gen var_name = "hello"', expected_var: 'var_name', expected_source: 'gen' },
      { source: 'generate _temp = other_var', expected_var: '_temp', expected_source: 'gen' },
      
      // egen command variations
      { source: 'egen total = sum(x)', expected_var: 'total', expected_source: 'egen' },
      { source: 'egen avg_val = mean(values)', expected_var: 'avg_val', expected_source: 'egen' },
      { source: 'egen max_score = max(scores)', expected_var: 'max_score', expected_source: 'egen' },
    ];

    for (const test_case of test_cases) {
      // Tokenize, parse, and analyze
      const { tokens } = lexer.tokenize(test_case.source);
      const { ast } = parser.parse(tokens);
      const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

      // Verify the variable was extracted correctly
      expect(result.symbols.variables.has(test_case.expected_var)).toBe(true);
      
      const variable = result.symbols.variables.get(test_case.expected_var);
      expect(variable).toBeDefined();
      expect(variable!.name).toBe(test_case.expected_var);
      expect(variable!.source).toBe(test_case.expected_source);
    }
  });

  /**
   * Property Test 5.4: CommandNode structure validation
   * 
   * Validates that the CommandNode structure contains the expected
   * varlist property that the extraction functions depend on.
   */
  it('should have correct CommandNode structure for variable extraction', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbitrary_gen_command(), arbitrary_egen_command()),
        ({ source }) => {
          // Tokenize and parse
          const { tokens } = lexer.tokenize(source);
          const { ast } = parser.parse(tokens);

          // Find the command node
          expect(ast.nodes.length).toBeGreaterThan(0);
          const command_node = ast.nodes[0];
          expect(command_node.type).toBe('command');

          // Verify CommandNode has varlist property
          expect('varlist' in command_node).toBe(true);
          expect(command_node.varlist).toBeDefined();
          expect(Array.isArray(command_node.varlist)).toBe(true);
          expect(command_node.varlist!.length).toBeGreaterThan(0);

          // Verify first varlist item has name property
          const first_var = command_node.varlist![0];
          expect('name' in first_var).toBe(true);
          expect(typeof first_var.name).toBe('string');
          expect(first_var.name.length).toBeGreaterThan(0);
        }
      )
    );
  });
});
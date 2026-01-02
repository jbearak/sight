import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { arbitrary_non_reserved_identifier } from './generators';

/**
 * Property-based tests for Confirm Variable Registration
 * Feature: confirm-variable-registration
 * 
 * Tests the analyzer's ability to register variable names from confirm variable commands.
 */
describe('Confirm Variable Registration Property Tests', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;

    beforeEach(() => {
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
    });

    /**
     * Generator for simple confirm variable commands.
     * Produces: { source: string, varname: string, subcommand: string }
     */
    function arbitrary_simple_confirm_variable(): fc.Arbitrary<{
        source: string;
        varname: string;
        subcommand: string;
    }> {
        return fc
            .tuple(
                fc.constantFrom('variable', 'var'),
                arbitrary_non_reserved_identifier()
            )
            .map(([subcommand, varname]) => ({
                source: `confirm ${subcommand} ${varname}`,
                varname,
                subcommand,
            }));
    }

    /**
     * Property 1: Confirm Variable Registration
     * 
     * *For any* valid identifier and command form ('confirm variable' or 'confirm var'),
     * when the analyzer processes the command, the symbol table SHALL contain
     * a VariableSymbol for the variable name with source='confirm' and location
     * matching the variable name token position.
     * 
     * Feature: confirm-variable-registration, Property 1: Confirm Variable Registration
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
     */
    it('should register variable from confirm variable command', () => {
        fc.assert(
            fc.property(arbitrary_simple_confirm_variable(), ({ source, varname }) => {
                // Tokenize, parse, and analyze
                const { tokens } = lexer.tokenize(source);
                const { ast } = parser.parse(tokens);
                const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                // Verify the variable was registered
                expect(result.symbols.variables.has(varname)).toBe(true);

                const variable = result.symbols.variables.get(varname);
                expect(variable).toBeDefined();
                expect(variable!.name).toBe(varname);
                expect(variable!.source).toBe('confirm');
                expect(variable!.sourceUri).toBe('test://file.do');

                // Verify location range is set (should point to varname token)
                expect(variable!.location).toBeDefined();
                expect(variable!.location.range).toBeDefined();

                // Requirement 1.4: location.range SHALL equal the parsed range of the varname token
                const confirm_node = ast.nodes[0];
                expect(confirm_node.type).toBe('command');
                if (confirm_node.type === 'command') {
                    expect(confirm_node.varlist).toBeDefined();
                    expect(confirm_node.varlist!.length).toBeGreaterThanOrEqual(2);
                    const varname_range = confirm_node.varlist![1].range;
                    expect(variable!.location.range).toEqual(varname_range);
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Both 'confirm variable' and 'confirm var' forms should work identically
     * 
     * Feature: confirm-variable-registration, Property 1: Confirm Variable Registration
     * **Validates: Requirements 1.1, 1.2**
     */
    it('should register variables from both confirm variable and confirm var forms', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                (varname) => {
                    // Test 'confirm variable' form
                    const source_variable = `confirm variable ${varname}`;
                    const { tokens: tokens_variable } = lexer.tokenize(source_variable);
                    const { ast: ast_variable } = parser.parse(tokens_variable);
                    const result_variable = analyzer.analyze(ast_variable, 'test://file.do', undefined, {}, tokens_variable);

                    expect(result_variable.symbols.variables.has(varname)).toBe(true);
                    expect(result_variable.symbols.variables.get(varname)!.source).toBe('confirm');

                    // Test 'confirm var' form
                    const source_var = `confirm var ${varname}`;
                    const { tokens: tokens_var } = lexer.tokenize(source_var);
                    const { ast: ast_var } = parser.parse(tokens_var);
                    const result_var = analyzer.analyze(ast_var, 'test://file.do', undefined, {}, tokens_var);

                    expect(result_var.symbols.variables.has(varname)).toBe(true);
                    expect(result_var.symbols.variables.get(varname)!.source).toBe('confirm');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Edge case: Incomplete confirm command (fewer than 2 varlist items)
     * Should gracefully handle without registering any variables.
     * 
     * Feature: confirm-variable-registration, Property 1: Confirm Variable Registration
     * **Validates: Requirements 1.5**
     */
    it('should not register variables from incomplete confirm commands', () => {
        const incomplete_commands = [
            'confirm',
            'confirm variable',
            'confirm var',
        ];

        for (const source of incomplete_commands) {
            const { tokens } = lexer.tokenize(source);
            const { ast } = parser.parse(tokens);
            const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

            // Verify no confirm-sourced variables were registered
            for (const [_name, variable] of result.symbols.variables) {
                expect(variable.source).not.toBe('confirm');
            }
        }
    });

    /**
     * Edge case: Non-variable confirm subcommands should not register variables.
     * Commands like 'confirm file', 'confirm number', etc. should be ignored.
     * 
     * Feature: confirm-variable-registration, Property 1: Confirm Variable Registration
     * **Validates: Requirements 1.1**
     */
    it('should not register variables from non-variable confirm subcommands', () => {
        const non_variable_commands = [
            'confirm file myfile.dta',
            'confirm number 123',
            'confirm integer 42',
            'confirm names myname',
            'confirm existence myvar',
            'confirm new myvar',
        ];

        for (const source of non_variable_commands) {
            const { tokens } = lexer.tokenize(source);
            const { ast } = parser.parse(tokens);
            const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

            // Verify no confirm-sourced variables were registered
            for (const [_name, variable] of result.symbols.variables) {
                expect(variable.source).not.toBe('confirm');
            }
        }
    });

    /**
     * Generator for prefixed confirm variable commands.
     * Produces: { source: string, varname: string, prefix: string }
     */
    function arbitrary_prefixed_confirm_variable(): fc.Arbitrary<{
        source: string;
        varname: string;
        prefix: string;
    }> {
        const single_prefix = fc.constantFrom('capture', 'cap', 'quietly', 'qui', 'noisily', 'noi');
        const colon_prefix = fc.constantFrom('capture:', 'cap:', 'quietly:', 'qui:', 'noisily:', 'noi:');
        const prefix_gen = fc.oneof(single_prefix, colon_prefix);

        return fc
            .tuple(
                prefix_gen,
                fc.constantFrom('variable', 'var'),
                arbitrary_non_reserved_identifier()
            )
            .map(([prefix, subcommand, varname]) => ({
                source: `${prefix} confirm ${subcommand} ${varname}`,
                varname,
                prefix,
            }));
    }

    /**
     * Property 2: Prefixed Confirm Variable Registration
     * 
     * *For any* prefix command combination (capture, capture:, quietly, noisily, or
     * combinations thereof) followed by 'confirm variable varname', the analyzer
     * SHALL register the variable in the symbol table with source='confirm'.
     * 
     * Feature: confirm-variable-registration, Property 2: Prefixed Confirm Variable Registration
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     */
    it('should register variable from prefixed confirm variable command', () => {
        fc.assert(
            fc.property(arbitrary_prefixed_confirm_variable(), ({ source, varname }) => {
                // Tokenize, parse, and analyze
                const { tokens } = lexer.tokenize(source);
                const { ast } = parser.parse(tokens);
                const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                // Verify the variable was registered
                expect(result.symbols.variables.has(varname)).toBe(true);

                const variable = result.symbols.variables.get(varname);
                expect(variable).toBeDefined();
                expect(variable!.name).toBe(varname);
                expect(variable!.source).toBe('confirm');
                expect(variable!.sourceUri).toBe('test://file.do');
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2 (continued): Multiple prefix commands should work
     * 
     * Feature: confirm-variable-registration, Property 2: Prefixed Confirm Variable Registration
     * **Validates: Requirements 2.4**
     */
    it('should register variable from multi-prefixed confirm variable command', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                (varname) => {
                    const multi_prefix_commands = [
                        `capture noisily confirm variable ${varname}`,
                        `quietly capture confirm var ${varname}`,
                        `noisily quietly confirm variable ${varname}`,
                        `cap noi confirm var ${varname}`,
                    ];

                    for (const source of multi_prefix_commands) {
                        const { tokens } = lexer.tokenize(source);
                        const { ast } = parser.parse(tokens);
                        const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                        expect(result.symbols.variables.has(varname)).toBe(true);
                        expect(result.symbols.variables.get(varname)!.source).toBe('confirm');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Generator for confirm variable commands with options.
     * Produces: { source: string, varname: string, option: string }
     */
    function arbitrary_confirm_variable_with_options(): fc.Arbitrary<{
        source: string;
        varname: string;
        option: string;
    }> {
        return fc
            .tuple(
                fc.constantFrom('variable', 'var'),
                arbitrary_non_reserved_identifier(),
                fc.constantFrom('exact', 'e')
            )
            .map(([subcommand, varname, option]) => ({
                source: `confirm ${subcommand} ${varname}, ${option}`,
                varname,
                option,
            }));
    }

    /**
     * Property 3: Confirm Variable with Options
     * 
     * *For any* 'confirm variable varname' command with options (e.g., 'exact'),
     * the analyzer SHALL register the variable in the symbol table with source='confirm'.
     * 
     * Feature: confirm-variable-registration, Property 3: Confirm Variable with Options
     * **Validates: Requirements 3.1, 3.2**
     */
    it('should register variable from confirm variable command with options', () => {
        fc.assert(
            fc.property(arbitrary_confirm_variable_with_options(), ({ source, varname }) => {
                // Tokenize, parse, and analyze
                const { tokens } = lexer.tokenize(source);
                const { ast } = parser.parse(tokens);
                const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                // Verify the variable was registered
                expect(result.symbols.variables.has(varname)).toBe(true);

                const variable = result.symbols.variables.get(varname);
                expect(variable).toBeDefined();
                expect(variable!.name).toBe(varname);
                expect(variable!.source).toBe('confirm');
                expect(variable!.sourceUri).toBe('test://file.do');
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3 (continued): Prefixed confirm variable with options should work
     * 
     * Feature: confirm-variable-registration, Property 3: Confirm Variable with Options
     * **Validates: Requirements 3.1, 3.2**
     */
    it('should register variable from prefixed confirm variable command with options', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                (varname) => {
                    const prefixed_with_options = [
                        `capture confirm variable ${varname}, exact`,
                        `quietly confirm var ${varname}, e`,
                        `cap: confirm variable ${varname}, exact`,
                        `noisily confirm var ${varname}, exact`,
                    ];

                    for (const source of prefixed_with_options) {
                        const { tokens } = lexer.tokenize(source);
                        const { ast } = parser.parse(tokens);
                        const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                        expect(result.symbols.variables.has(varname)).toBe(true);
                        expect(result.symbols.variables.get(varname)!.source).toBe('confirm');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

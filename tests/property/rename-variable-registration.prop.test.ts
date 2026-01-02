import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { arbitrary_identifier, arbitrary_non_reserved_identifier } from './generators';

/**
 * Property-based tests for Rename Variable Registration
 * Feature: rename-variable-registration
 * 
 * Tests the analyzer's ability to register new variable names from rename commands.
 */
describe('Rename Variable Registration Property Tests', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;

    beforeEach(() => {
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
    });

    /**
     * Generator for simple rename commands.
     * Produces: { source: string, oldvar: string, newvar: string, cmd: string }
     */
    function arbitrary_simple_rename(): fc.Arbitrary<{
        source: string;
        oldvar: string;
        newvar: string;
        cmd: string;
    }> {
        return fc
            .tuple(
                fc.constantFrom('rename', 'ren'),
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier()
            )
            .filter(([_cmd, oldvar, newvar]) => oldvar !== newvar)
            .map(([cmd, oldvar, newvar]) => ({
                source: `${cmd} ${oldvar} ${newvar}`,
                oldvar,
                newvar,
                cmd,
            }));
    }

    /**
     * Property 1: Simple Rename Variable Registration
     * 
     * *For any* valid identifier pair (oldvar, newvar) and command form ('rename' or 'ren'),
     * when the analyzer processes `{cmd} {oldvar} {newvar}`, the symbol table SHALL contain
     * a VariableSymbol for newvar with source='rename' and location matching the newvar token position.
     * 
     * Feature: rename-variable-registration, Property 1: Simple Rename Variable Registration
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
     */
    it('should register new variable from simple rename command', () => {
        fc.assert(
            fc.property(arbitrary_simple_rename(), ({ source, newvar }) => {
                // Tokenize, parse, and analyze
                const { tokens } = lexer.tokenize(source);
                const { ast } = parser.parse(tokens);
                const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                // Verify the new variable was registered
                expect(result.symbols.variables.has(newvar)).toBe(true);

                const variable = result.symbols.variables.get(newvar);
                expect(variable).toBeDefined();
                expect(variable!.name).toBe(newvar);
                expect(variable!.source).toBe('rename');
                expect(variable!.sourceUri).toBe('test://file.do');

                // Verify location range is set (should point to newvar token)
                expect(variable!.location).toBeDefined();
                expect(variable!.location.range).toBeDefined();

                // Requirement 1.4: location.range SHALL equal the parsed range of the newvar token
                const rename_node = ast.nodes[0];
                expect(rename_node.type).toBe('command');
                if (rename_node.type === 'command') {
                    expect(rename_node.varlist).toBeDefined();
                    expect(rename_node.varlist!.length).toBeGreaterThanOrEqual(2);
                    const newvar_range = rename_node.varlist![1].range;
                    expect(variable!.location.range).toEqual(newvar_range);
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Both 'rename' and 'ren' forms should work identically
     * 
     * Feature: rename-variable-registration, Property 1: Simple Rename Variable Registration
     * **Validates: Requirements 1.1, 1.2**
     */
    it('should register variables from both rename and ren command forms', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                (oldvar, newvar) => {
                    // Skip if oldvar and newvar are the same
                    if (oldvar === newvar) return;

                    // Test 'rename' form
                    const source_rename = `rename ${oldvar} ${newvar}`;
                    const { tokens: tokens_rename } = lexer.tokenize(source_rename);
                    const { ast: ast_rename } = parser.parse(tokens_rename);
                    const result_rename = analyzer.analyze(ast_rename, 'test://file.do', undefined, {}, tokens_rename);

                    expect(result_rename.symbols.variables.has(newvar)).toBe(true);
                    expect(result_rename.symbols.variables.get(newvar)!.source).toBe('rename');

                    // Test 'ren' form
                    const source_ren = `ren ${oldvar} ${newvar}`;
                    const { tokens: tokens_ren } = lexer.tokenize(source_ren);
                    const { ast: ast_ren } = parser.parse(tokens_ren);
                    const result_ren = analyzer.analyze(ast_ren, 'test://file.do', undefined, {}, tokens_ren);

                    expect(result_ren.symbols.variables.has(newvar)).toBe(true);
                    expect(result_ren.symbols.variables.get(newvar)!.source).toBe('rename');
                }
            ),
            { numRuns: 100 }
        );
    });


    /**
     * Generator for grouped rename commands.
     * Produces: { source: string, old_vars: string[], new_vars: string[] }
     */
    function arbitrary_grouped_rename(): fc.Arbitrary<{
        source: string;
        old_vars: string[];
        new_vars: string[];
    }> {
        return fc
            .tuple(
                fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 5 }),
                fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 5 })
            )
            .filter(([old_vars, new_vars]) => {
                // Ensure same length and no duplicates within each list
                if (old_vars.length !== new_vars.length) return false;
                const old_set = new Set(old_vars);
                const new_set = new Set(new_vars);
                return old_set.size === old_vars.length && new_set.size === new_vars.length;
            })
            .map(([old_vars, new_vars]) => ({
                source: `rename (${old_vars.join(' ')}) (${new_vars.join(' ')})`,
                old_vars,
                new_vars,
            }));
    }

    /**
     * Property 2: Grouped Rename Variable Registration
     * 
     * *For any* pair of identifier lists of equal length, when the analyzer processes
     * `rename ({old_list}) ({new_list})`, the symbol table SHALL contain VariableSymbols
     * for all names in new_list with source='rename'.
     * 
     * Feature: rename-variable-registration, Property 2: Grouped Rename Variable Registration
     * **Validates: Requirements 2.1**
     */
    it('should register all new variables from grouped rename command', () => {
        fc.assert(
            fc.property(arbitrary_grouped_rename(), ({ source, new_vars }) => {
                // Tokenize, parse, and analyze
                const { tokens } = lexer.tokenize(source);
                const { ast } = parser.parse(tokens);
                const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                // Verify all new variables were registered
                for (const my_newvar of new_vars) {
                    expect(result.symbols.variables.has(my_newvar)).toBe(true);

                    const variable = result.symbols.variables.get(my_newvar);
                    expect(variable).toBeDefined();
                    expect(variable!.name).toBe(my_newvar);
                    expect(variable!.source).toBe('rename');
                    expect(variable!.sourceUri).toBe('test://file.do');
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Generator for wildcard rename commands.
     * Note: Due to parser limitations, wildcards (* or ?) are tokenized separately
     * from identifiers. This means the analyzer's wildcard detection only works
     * when wildcards appear within grouped syntax parentheses.
     */
    function arbitrary_grouped_wildcard_rename(): fc.Arbitrary<{
        source: string;
    }> {
        const wildcard_pattern = fc.oneof(
            fc.constant('*'),
            fc.constant('?'),
            fc.tuple(arbitrary_identifier(), fc.constantFrom('*', '?'))
                .map(([base, wild]) => `${base}${wild}`),
            fc.tuple(fc.constantFrom('*', '?'), arbitrary_identifier())
                .map(([wild, base]) => `${wild}${base}`)
        );

        return fc
            .tuple(
                fc.array(arbitrary_non_reserved_identifier(), { minLength: 1, maxLength: 3 }),
                fc.array(wildcard_pattern, { minLength: 1, maxLength: 3 })
            )
            .filter(([old_vars, new_patterns]) => old_vars.length === new_patterns.length)
            .map(([old_vars, new_patterns]) => ({
                source: `rename (${old_vars.join(' ')}) (${new_patterns.join(' ')})`,
            }));
    }

    /**
     * Property 3: Wildcard Rename Non-Registration
     * 
     * *For any* rename command containing wildcard characters (* or ?) in either
     * group of grouped syntax, the analyzer SHALL NOT register ANY variables
     * with source='rename'. Pattern-based renames cannot be statically resolved.
     * 
     * Note: Due to parser limitations, wildcards in simple rename syntax are
     * tokenized separately and don't appear in varlist names. This test focuses
     * on grouped syntax where wildcards are preserved in the parenthesized groups.
     * 
     * Feature: rename-variable-registration, Property 3: Wildcard Rename Non-Registration
     * **Validates: Requirements 2.2, 2.3**
     */
    it('should not register variables from grouped rename with wildcards', () => {
        fc.assert(
            fc.property(arbitrary_grouped_wildcard_rename(), ({ source }) => {
                // Tokenize, parse, and analyze
                const { tokens } = lexer.tokenize(source);
                const { ast } = parser.parse(tokens);
                const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

                // Verify NO variables with source='rename' were registered
                for (const [_name, variable] of result.symbols.variables) {
                    expect(variable.source).not.toBe('rename');
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3 (continued): Specific wildcard patterns in grouped syntax
     * 
     * Feature: rename-variable-registration, Property 3: Wildcard Rename Non-Registration
     * **Validates: Requirements 2.2, 2.3**
     */
    it('should not register wildcard patterns in grouped rename', () => {
        const wildcard_cases = [
            'rename (old1 old2) (* new2)',
            'rename (old1 old2) (new1 *)',
            'rename (old1) (new*)',
            'rename (old1) (*new)',
            'rename (old1) (?)',
            'rename (old1 old2) (new? other)',
        ];

        for (const source of wildcard_cases) {
            const { tokens } = lexer.tokenize(source);
            const { ast } = parser.parse(tokens);
            const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

            // Verify NO variables with source='rename' were registered
            for (const [_name, variable] of result.symbols.variables) {
                expect(variable.source).not.toBe('rename');
            }
        }
    });

    /**
     * Requirement 2.2 / 2.3: Wildcard and stub pattern renames in the simple form
     * MUST NOT register any variables.
     *
     * This includes:
     * - rename * , lower
     * - rename old* new*
     * - rename old? new?
     */
    it('should not register variables from simple wildcard/stub rename forms', () => {
        const sources = [
            'rename * , lower',
            'rename old* new*',
            'rename old* new',
            'rename old new*',
            'rename old? new?',
            'rename old? new',
            'rename old new?',
        ];

        for (const source of sources) {
            const { tokens } = lexer.tokenize(source);
            const { ast } = parser.parse(tokens);
            const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

            for (const [_name, variable] of result.symbols.variables) {
                expect(variable.source).not.toBe('rename');
            }
        }
    });

    /**
     * Edge case: Incomplete rename command (fewer than 2 varlist items)
     * Should gracefully handle without registering any variables.
     * 
     * Feature: rename-variable-registration, Property 1: Simple Rename Variable Registration
     * **Validates: Requirements 1.5**
     */
    it('should not register variables from incomplete rename commands', () => {
        const incomplete_commands = [
            'rename',
            'rename oldvar',
            'ren',
            'ren oldvar',
        ];

        for (const source of incomplete_commands) {
            const { tokens } = lexer.tokenize(source);
            const { ast } = parser.parse(tokens);
            const result = analyzer.analyze(ast, 'test://file.do', undefined, {}, tokens);

            // Verify no rename-sourced variables were registered
            for (const [_name, variable] of result.symbols.variables) {
                expect(variable.source).not.toBe('rename');
            }
        }
    });
});

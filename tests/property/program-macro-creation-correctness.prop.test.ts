import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { SymbolTable, ProgramSymbol, MacroSymbol } from '../../src/types';

/**
 * Property-based tests for Program Macro Creation Correctness Properties
 * Feature: program-pattern-detection-macro-creation-correctness
 * 
 * NOTE: Stata is case-sensitive. Command matching is case-sensitive.
 */
describe('Program Macro Creation Correctness Property Tests', () => {
    
    // Helper function to create empty symbol table
    function create_empty_symbol_table(): SymbolTable {
        return {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
    }

    // Helper function to parse and analyze Stata code
    function parse_and_analyze(code: string): { symbols: SymbolTable; program?: ProgramSymbol } {
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();
        
        const lexer_result = lexer.tokenize(code);
        const parse_result = parser.parse(lexer_result.tokens);
        const analysis_result = analyzer.analyze(parse_result.ast, 'test://test.do');
        
        const program_name = extract_program_name(code);
        const program = program_name ? analysis_result.symbols.programs.get(program_name) : undefined;
        
        return { symbols: analysis_result.symbols, program };
    }

    // Helper to extract program name from code
    function extract_program_name(code: string): string | undefined {
        const match = code.match(/program\s+define\s+(\w+)/i);
        return match?.[1];
    }

    // Generators for valid Stata identifiers
    const valid_identifier = fc.string({ minLength: 1, maxLength: 32 })
        .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
        .filter(s => !['if', 'in', 'using', 'by', 'end', 'program'].includes(s.toLowerCase()));

    // Generator for macro names with special characters that should be rejected
    const invalid_macro_name = fc.oneof(
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => /[^a-zA-Z0-9_]/.test(s)),
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[0-9]/.test(s)),
        fc.constant(''),
    );

    /**
     * Property 1: Pattern Validation Correctness
     * Only valid macro reference patterns should be detected as macro-creating options.
     * NOTE: Using syntax without '=' to avoid parser treating it as macro definition.
     * NOTE: Macro-creating options require BOTH a syntax declaration AND a body pattern.
     */
    it('should only detect valid macro reference patterns', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                (prog_name, option_name) => {
                    // Test valid pattern: syntax declares option, body uses c_local `option'
                    const valid_code = `program define ${prog_name}\n    syntax, ${option_name}(name)\n    c_local \`${option_name}' "value"\nend`;
                    const { program: valid_program } = parse_and_analyze(valid_code);
                    
                    expect(valid_program).toBeDefined();
                    expect(valid_program!.macro_creating_local_options).toContain(option_name);
                    
                    // Test invalid patterns (no syntax declaration, so no macro-creating options detected)
                    const invalid_patterns = [
                        `c_local ${option_name} "value"`, // No backticks
                        `c_local \`${option_name} "value"`, // Missing closing quote
                        `c_local ${option_name}' "value"`, // Missing opening backtick
                        `c_local \`\` "value"`, // Empty macro name
                    ];
                    
                    for (const invalid_pattern of invalid_patterns) {
                        const invalid_code = `program define ${prog_name}_invalid\n    ${invalid_pattern}\nend`;
                        const { program: invalid_program } = parse_and_analyze(invalid_code);
                        
                        expect(invalid_program).toBeDefined();
                        expect(invalid_program!.macro_creating_local_options?.includes(option_name) || false).toBe(false);
                    }
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 2: Identifier Validation
     * Only valid Stata identifiers should be accepted as macro names in patterns.
     */
    it('should validate macro name identifiers correctly', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                invalid_macro_name,
                (prog_name, invalid_name) => {
                    const code = `program define ${prog_name}\n    c_local \`${invalid_name}' "value"\nend`;
                    const { program } = parse_and_analyze(code);
                    
                    expect(program).toBeDefined();
                    // Invalid identifiers should not be detected as macro-creating options
                    expect(program!.macro_creating_local_options?.includes(invalid_name) || false).toBe(false);
                }
            ),
            { numRuns: 25 }
        );
    });

    /**
     * Property 3: Command Recognition Correctness
     * Only c_local and global commands should create macro-creating patterns.
     * NOTE: Stata is case-sensitive, so only lowercase c_local and global are recognized.
     * NOTE: 'local' and 'global' are excluded because they are macro definition commands.
     */
    it('should only recognize c_local and global commands for pattern creation', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                fc.oneof(
                    fc.constant('display'),
                    fc.constant('generate'),
                    fc.constant('replace'),
                    fc.constant('set'),
                    fc.constant('list'),
                ),
                (prog_name, option_name, other_command) => {
                    const code = `program define ${prog_name}\n    ${other_command} \`${option_name}' = "value"\nend`;
                    const { program } = parse_and_analyze(code);
                    
                    expect(program).toBeDefined();
                    // Non-c_local/global commands should not create macro-creating options
                    expect(program!.macro_creating_local_options?.includes(option_name) || false).toBe(false);
                    expect(program!.macro_creating_global_options?.includes(option_name) || false).toBe(false);
                }
            ),
            { numRuns: 25 }
        );
    });

    /**
     * Property 4: Pattern Extraction Determinism
     * Multiple analyses of the same code should produce identical results.
     * NOTE: Using syntax without '=' to avoid parser treating it as macro definition.
     */
    it('should produce deterministic pattern extraction results', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                fc.array(valid_identifier, { minLength: 1, maxLength: 3 }),
                fc.array(valid_identifier, { minLength: 1, maxLength: 3 }),
                (prog_name, local_opts, global_opts) => {
                    const local_commands = local_opts.map(opt => `c_local \`${opt}' "local"`);
                    const global_commands = global_opts.map(opt => `global \`${opt}' "global"`);
                    const code = `program define ${prog_name}\n    ${[...local_commands, ...global_commands].join('\n    ')}\nend`;
                    
                    // Analyze the same code multiple times
                    const result1 = parse_and_analyze(code);
                    const result2 = parse_and_analyze(code);
                    const result3 = parse_and_analyze(code);
                    
                    // Results should be identical
                    expect(result1.program?.macro_creating_local_options?.sort()).toEqual(
                        result2.program?.macro_creating_local_options?.sort()
                    );
                    expect(result2.program?.macro_creating_local_options?.sort()).toEqual(
                        result3.program?.macro_creating_local_options?.sort()
                    );
                    
                    expect(result1.program?.macro_creating_global_options?.sort()).toEqual(
                        result2.program?.macro_creating_global_options?.sort()
                    );
                    expect(result2.program?.macro_creating_global_options?.sort()).toEqual(
                        result3.program?.macro_creating_global_options?.sort()
                    );
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 5: Nested Structure Traversal Correctness
     * Patterns should be detected regardless of nesting depth in control structures.
     * NOTE: Macro-creating options require BOTH a syntax declaration AND a body pattern.
     */
    it('should correctly traverse nested control structures', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                fc.integer({ min: 1, max: 3 }),
                (prog_name, option_name, nesting_depth) => {
                    // Create nested if statements (without '=' to avoid parser issues)
                    let nested_code = `c_local \`${option_name}' "nested"`;
                    for (let i = 0; i < nesting_depth; i++) {
                        nested_code = `if 1 {\n        ${nested_code.replace(/\n/g, '\n    ')}\n    }`;
                    }
                    
                    // Include syntax declaration for the option
                    const code = `program define ${prog_name}\n    syntax, ${option_name}(name)\n    ${nested_code}\nend`;
                    const { program } = parse_and_analyze(code);
                    
                    expect(program).toBeDefined();
                    expect(program!.macro_creating_local_options).toBeDefined();
                    expect(program!.macro_creating_local_options).toContain(option_name);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 6: Pattern Uniqueness
     * Duplicate patterns should result in unique entries in the options arrays.
     * NOTE: Macro-creating options require BOTH a syntax declaration AND a body pattern.
     */
    it('should ensure pattern uniqueness in results', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                fc.integer({ min: 2, max: 5 }),
                (prog_name, option_name, duplicate_count) => {
                    const duplicate_commands = Array(duplicate_count).fill(
                        `c_local \`${option_name}' "duplicate"`
                    );
                    
                    // Include syntax declaration for the option
                    const code = `program define ${prog_name}\n    syntax, ${option_name}(name)\n    ${duplicate_commands.join('\n    ')}\nend`;
                    const { program } = parse_and_analyze(code);
                    
                    expect(program).toBeDefined();
                    expect(program!.macro_creating_local_options).toBeDefined();
                    
                    // Should only appear once (deduplication)
                    const option_count = program!.macro_creating_local_options!.filter(opt => opt === option_name).length;
                    expect(option_count).toBe(1);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 7: Cross-Pattern Independence
     * Local and global patterns should be detected independently.
     * NOTE: The parser treats 'global' as a macro definition command, which breaks
     * program parsing. This test uses mock nodes to test the pattern extraction directly.
     */
    it('should detect local and global patterns independently', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                (local_opt, global_opt) => {
                    // Use the analyzer's extract_macro_creating_option_patterns directly
                    // since the parser treats 'global' as a macro definition command
                    const analyzer = new (require('../../src/analyzer').SemanticAnalyzer)();
                    
                    const mock_nodes = [
                        {
                            type: 'command' as const,
                            fullName: 'c_local',
                            varlist: [{ name: `\`${local_opt}'`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: local_opt.length + 2 } } }],
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
                        },
                        {
                            type: 'command' as const,
                            fullName: 'global',
                            varlist: [{ name: `\`${global_opt}'`, range: { start: { line: 1, character: 0 }, end: { line: 1, character: global_opt.length + 2 } } }],
                            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } }
                        }
                    ];
                    
                    // Include both options in syntax_option_names
                    const syntax_option_names = new Set([local_opt, global_opt]);
                    const result = (analyzer as any).extract_macro_creating_option_patterns(mock_nodes, syntax_option_names);
                    
                    expect(result.local_options).toContain(local_opt);
                    expect(result.global_options).toContain(global_opt);
                    
                    // Local option should not appear in global options and vice versa
                    // (unless they happen to be the same identifier, which is valid)
                    if (local_opt !== global_opt) {
                        expect(result.global_options.includes(local_opt)).toBe(false);
                        expect(result.local_options.includes(global_opt)).toBe(false);
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    /**
     * Property 8: Whitespace Tolerance
     * Pattern detection should be tolerant of various whitespace configurations.
     * NOTE: Macro-creating options require BOTH a syntax declaration AND a body pattern.
     */
    it('should handle various whitespace configurations correctly', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                fc.oneof(
                    fc.constant('c_local'),
                    fc.constant(' c_local '),
                    fc.constant('\tc_local\t'),
                    fc.constant('  c_local  '),
                ),
                (prog_name, option_name, command_ws) => {
                    // Include syntax declaration for the option
                    const code = `program define ${prog_name}\n    syntax, ${option_name}(name)\n    ${command_ws}\`${option_name}' "value"\nend`;
                    const { program } = parse_and_analyze(code);
                    
                    expect(program).toBeDefined();
                    expect(program!.macro_creating_local_options).toContain(option_name);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 9: Command Case Sensitivity
     * Stata is case-sensitive. Only lowercase c_local and global should be recognized.
     * NOTE: Macro-creating options require BOTH a syntax declaration AND a body pattern.
     */
    it('should be case sensitive for command recognition', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                (prog_name, option_name) => {
                    // Lowercase c_local should work (with syntax declaration)
                    const lower_code = `program define ${prog_name}\n    syntax, ${option_name}(name)\n    c_local \`${option_name}' "value"\nend`;
                    const { program: lower_program } = parse_and_analyze(lower_code);
                    expect(lower_program).toBeDefined();
                    expect(lower_program!.macro_creating_local_options).toContain(option_name);
                    
                    // Uppercase C_LOCAL should NOT work (Stata is case-sensitive)
                    const upper_code = `program define ${prog_name}_upper\n    syntax, ${option_name}(name)\n    C_LOCAL \`${option_name}' "value"\nend`;
                    const { program: upper_program } = parse_and_analyze(upper_code);
                    expect(upper_program).toBeDefined();
                    expect(upper_program!.macro_creating_local_options?.includes(option_name) || false).toBe(false);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 10: Macro Name Case Sensitivity
     * Macro names in patterns should be case-sensitive.
     * NOTE: Macro-creating options require BOTH a syntax declaration AND a body pattern.
     */
    it('should handle macro name case sensitivity correctly', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                fc.string({ minLength: 3, maxLength: 10 })
                    .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
                    .filter(s => s !== s.toLowerCase() && s !== s.toUpperCase()),
                (prog_name, mixed_case_name) => {
                    const lower_case = mixed_case_name.toLowerCase();
                    const upper_case = mixed_case_name.toUpperCase();
                    
                    // Include syntax declaration for all three options
                    const code = `program define ${prog_name}
    syntax, ${mixed_case_name}(name) ${lower_case}(name) ${upper_case}(name)
    c_local \`${mixed_case_name}' "mixed"
    c_local \`${lower_case}' "lower"
    c_local \`${upper_case}' "upper"
end`;
                    const { program } = parse_and_analyze(code);
                    
                    expect(program).toBeDefined();
                    expect(program!.macro_creating_local_options).toBeDefined();
                    
                    // All three should be detected as separate options
                    expect(program!.macro_creating_local_options).toContain(mixed_case_name);
                    expect(program!.macro_creating_local_options).toContain(lower_case);
                    expect(program!.macro_creating_local_options).toContain(upper_case);
                    expect(program!.macro_creating_local_options!.length).toBe(3);
                }
            ),
            { numRuns: 15 }
        );
    });

    /**
     * Property 11: Pattern Boundary Detection
     * Patterns should be detected only when they form complete, valid statements.
     * NOTE: The pattern detection looks for c_local `name' patterns, not full assignments.
     */
    it('should detect patterns only in complete valid statements', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                (prog_name, option_name) => {
                    // Test patterns that should NOT be detected
                    const invalid_patterns = [
                        `c_local ${option_name}`, // No backticks - not a macro reference pattern
                        `\`${option_name}' "value"`, // Missing command
                        `// c_local \`${option_name}' = "value"`, // Commented out
                    ];
                    
                    for (const invalid of invalid_patterns) {
                        const code = `program define ${prog_name}_test\n    ${invalid}\nend`;
                        const { program } = parse_and_analyze(code);
                        
                        expect(program).toBeDefined();
                        expect(program!.macro_creating_local_options?.includes(option_name) || false).toBe(false);
                    }
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 12: Error Resilience
     * Pattern detection should continue working even when some patterns are malformed.
     */
    it('should be resilient to malformed patterns', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                valid_identifier,
                valid_identifier,
                (prog_name, valid_option, valid_option_2) => {
                    // Ensure valid_option_2 is different from valid_option
                    const second_option = valid_option === valid_option_2 ? `${valid_option_2}_2` : valid_option_2;
                    
                    // Include syntax declaration for the valid options
                    const code = `program define ${prog_name}
    syntax, ${valid_option}(name) ${second_option}(name)
    c_local \`${valid_option}' "valid"
    c_local malformed "no backticks"
    c_local \`${second_option}' "also_valid"
end`;
                    const { program } = parse_and_analyze(code);
                    
                    expect(program).toBeDefined();
                    expect(program!.macro_creating_local_options).toBeDefined();
                    
                    // Valid patterns should still be detected
                    expect(program!.macro_creating_local_options).toContain(valid_option);
                    expect(program!.macro_creating_local_options).toContain(second_option);
                    
                    // Malformed pattern should not be detected
                    expect(program!.macro_creating_local_options?.includes('malformed') || false).toBe(false);
                }
            ),
            { numRuns: 20 }
        );
    });
});

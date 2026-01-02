import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { SymbolTable, ProgramSymbol, MacroSymbol } from '../../src/types';

/**
 * Property-based tests for Program Pattern Detection and User-Defined Program Macro Creation
 * Feature: program-pattern-detection-macro-creation
 */
describe('Program Pattern Detection and Macro Creation Property Tests', () => {
    
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

    // Helper function to test macro-creating option patterns directly
    function test_macro_creating_patterns(
        prog_name: string, 
        local_options: string[], 
        global_options: string[]
    ): { local_options: string[], global_options: string[] } {
        const analyzer = new SemanticAnalyzer();
        
        // Create mock AST nodes for c_local and global commands with backtick patterns
        const mock_nodes = [
            ...local_options.map(opt => ({
                type: 'command' as const,
                fullName: 'c_local',
                varlist: [
                    { name: `\`${opt}'`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: opt.length + 2 } } }
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
            })),
            ...global_options.map(opt => ({
                type: 'command' as const,
                fullName: 'global',
                varlist: [
                    { name: `\`${opt}'`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: opt.length + 2 } } }
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
            }))
        ];
        
        // Create syntax_option_names set containing all the option names
        // (simulating that these options are declared in a syntax command)
        const syntax_option_names = new Set([...local_options, ...global_options]);
        
        // Test the extraction method directly
        return (analyzer as any).extract_macro_creating_option_patterns(mock_nodes, syntax_option_names);
    }

    // Helper function to parse and analyze simple Stata programs (without macro patterns)
    function parse_and_analyze_simple(code: string): { symbols: SymbolTable; program?: ProgramSymbol } {
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

    // Generator for program names
    const program_name = valid_identifier;

    // Generator for macro names
    const macro_name = valid_identifier;

    // Generator for c_local patterns
    const c_local_pattern = fc.record({
        macro_name: macro_name,
        option_name: valid_identifier,
    }).map(({ macro_name, option_name }) => 
        `c_local \`${option_name}' = "${macro_name}"`
    );

    // Generator for global patterns  
    const global_pattern = fc.record({
        macro_name: macro_name,
        option_name: valid_identifier,
    }).map(({ macro_name, option_name }) => 
        `global \`${option_name}' = "${macro_name}"`
    );

    // Generator for program bodies with macro-creating patterns
    const program_body_with_patterns = fc.record({
        c_locals: fc.array(c_local_pattern, { minLength: 0, maxLength: 3 }),
        globals: fc.array(global_pattern, { minLength: 0, maxLength: 3 }),
        other_commands: fc.array(fc.constant('display "hello"'), { minLength: 0, maxLength: 2 }),
    }).map(({ c_locals, globals, other_commands }) => {
        const all_commands = [...c_locals, ...globals, ...other_commands];
        return all_commands.join('\n    ');
    });

    // Generator for complete programs
    const program_with_patterns = fc.record({
        name: program_name,
        body: program_body_with_patterns,
    }).map(({ name, body }) => 
        `program define ${name}\n    ${body}\nend`
    );

    /**
     * Property 1: Program Detection
     * Any valid program definition should be detected and registered in the symbol table.
     */
    it('should detect and register program definitions', () => {
        fc.assert(
            fc.property(
                program_name,
                (prog_name) => {
                    const code = `program define ${prog_name}\n    display "hello"\nend`;
                    const { symbols, program } = parse_and_analyze_simple(code);
                    
                    expect(symbols.programs.has(prog_name)).toBe(true);
                    expect(program).toBeDefined();
                    expect(program!.name).toBe(prog_name);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2: C_Local Pattern Detection
     * Programs containing c_local `option' patterns should have those options 
     * registered as macro_creating_local_options.
     */
    it('should detect c_local macro-creating patterns', () => {
        fc.assert(
            fc.property(
                fc.array(valid_identifier, { minLength: 1, maxLength: 3 }),
                (option_names) => {
                    const result = test_macro_creating_patterns('test_prog', option_names, []);

                    // Deduplication means unique options only
                    const unique_options = [...new Set(option_names)];
                    expect(result.local_options.length).toBe(unique_options.length);

                    for (const option_name of unique_options) {
                        expect(result.local_options).toContain(option_name);
                    }
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 3: Global Pattern Detection
     * Programs containing global `option' patterns should have those options
     * registered as macro_creating_global_options.
     */
    it('should detect global macro-creating patterns', () => {
        fc.assert(
            fc.property(
                fc.array(valid_identifier, { minLength: 1, maxLength: 3 }),
                (option_names) => {
                    const result = test_macro_creating_patterns('test_prog', [], option_names);
                    
                    // Deduplication means unique options only
                    const unique_options = [...new Set(option_names)];
                    expect(result.global_options.length).toBe(unique_options.length);
                    
                    for (const option_name of unique_options) {
                        expect(result.global_options).toContain(option_name);
                    }
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 4: Mixed Pattern Detection
     * Programs with both c_local and global patterns should detect both types correctly.
     */
    it('should detect mixed macro-creating patterns', () => {
        fc.assert(
            fc.property(
                fc.array(valid_identifier, { minLength: 1, maxLength: 2 }),
                fc.array(valid_identifier, { minLength: 1, maxLength: 2 }),
                (local_options, global_options) => {
                    const result = test_macro_creating_patterns('test_prog', local_options, global_options);

                    const unique_local_options = [...new Set(local_options)];
                    const unique_global_options = [...new Set(global_options)];

                    expect(result.local_options.length).toBe(unique_local_options.length);
                    expect(result.global_options.length).toBe(unique_global_options.length);

                    for (const opt of unique_local_options) {
                        expect(result.local_options).toContain(opt);
                    }

                    for (const opt of unique_global_options) {
                        expect(result.global_options).toContain(opt);
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    /**
     * Property 5: Nested Control Flow Pattern Detection
     * Macro-creating patterns inside control flow structures should be detected.
     */
    it('should detect patterns in nested control flow', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                (option_name) => {
                    const analyzer = new SemanticAnalyzer();
                    
                    // Create mock nested structure: if { c_local `option' = "value" }
                    const mock_c_local_node = {
                        type: 'command' as const,
                        fullName: 'c_local',
                        varlist: [
                            { name: `\`${option_name}'`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: option_name.length + 2 } } }
                        ],
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
                    };
                    
                    const mock_if_node = {
                        type: 'if' as const,
                        condition: '1',
                        body: [mock_c_local_node],
                        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } }
                    };
                    
                    // Include option_name in syntax_option_names to simulate it being declared in syntax
                    const syntax_option_names = new Set([option_name]);
                    const result = (analyzer as any).extract_macro_creating_option_patterns([mock_if_node], syntax_option_names);
                    
                    expect(result.local_options).toContain(option_name);
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 6: Invalid Pattern Rejection
     * Patterns that don't match the expected format should not be detected.
     */
    it('should reject invalid macro-creating patterns', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                (option_name) => {
                    const analyzer = new SemanticAnalyzer();
                    
                    // Test invalid patterns
                    const invalid_patterns = [
                        option_name, // No backticks
                        `\`${option_name}`, // Missing closing quote
                        `${option_name}'`, // Missing opening backtick
                        `\`\``, // Empty macro name
                        `\`123invalid'`, // Invalid identifier (starts with number)
                    ];
                    
                    // Include option_name in syntax_option_names (but patterns are still invalid)
                    const syntax_option_names = new Set([option_name]);
                    
                    for (const invalid_pattern of invalid_patterns) {
                        const mock_node = {
                            type: 'command' as const,
                            fullName: 'c_local',
                            varlist: [
                                { name: invalid_pattern, range: { start: { line: 0, character: 0 }, end: { line: 0, character: invalid_pattern.length } } }
                            ],
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
                        };
                        
                        const result = (analyzer as any).extract_macro_creating_option_patterns([mock_node], syntax_option_names);
                        
                        // Should not detect any valid options for invalid patterns
                        expect(result.local_options.length).toBe(0);
                    }
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 7: Duplicate Pattern Handling
     * Duplicate patterns should be deduplicated (only one entry per unique option name).
     */
    it('should handle duplicate patterns correctly', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                fc.integer({ min: 2, max: 4 }),
                (option_name, repeat_count) => {
                    const analyzer = new SemanticAnalyzer();
                    
                    // Create multiple identical mock nodes
                    const duplicate_nodes = Array(repeat_count).fill(null).map(() => ({
                        type: 'command' as const,
                        fullName: 'c_local',
                        varlist: [
                            { name: `\`${option_name}'`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: option_name.length + 2 } } }
                        ],
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
                    }));
                    
                    // Include option_name in syntax_option_names
                    const syntax_option_names = new Set([option_name]);
                    const result = (analyzer as any).extract_macro_creating_option_patterns(duplicate_nodes, syntax_option_names);
                    
                    // Implementation deduplicates, so should have exactly 1 entry
                    expect(result.local_options.length).toBe(1);
                    expect(result.local_options[0]).toBe(option_name);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 8: Case Sensitivity
     * Pattern detection should be case-sensitive for macro names but case-insensitive for commands.
     */
    it('should handle case sensitivity correctly', () => {
        fc.assert(
            fc.property(
                valid_identifier,
                fc.oneof(fc.constant('c_local'), fc.constant('C_LOCAL'), fc.constant('C_Local')),
                (option_name, command_case) => {
                    const analyzer = new SemanticAnalyzer();
                    
                    const mock_node = {
                        type: 'command' as const,
                        fullName: command_case.toLowerCase(), // Parser normalizes to lowercase
                        varlist: [
                            { name: `\`${option_name}'`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: option_name.length + 2 } } }
                        ],
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
                    };
                    
                    // Include option_name in syntax_option_names
                    const syntax_option_names = new Set([option_name]);
                    const result = (analyzer as any).extract_macro_creating_option_patterns([mock_node], syntax_option_names);
                    
                    expect(result.local_options).toContain(option_name);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 9: Empty Program Handling
     * Empty programs should not have any macro-creating options.
     */
    it('should handle empty programs correctly', () => {
        fc.assert(
            fc.property(
                program_name,
                (prog_name) => {
                    const code = `program define ${prog_name}\nend`;
                    const { program } = parse_and_analyze_simple(code);
                    
                    expect(program).toBeDefined();
                    expect(program!.macro_creating_local_options?.length || 0).toBe(0);
                    expect(program!.macro_creating_global_options?.length || 0).toBe(0);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 10: Program Name Preservation
     * The detected program should preserve the exact case of the program name.
     */
    it('should preserve program name case', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 })
                    .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
                    .filter(s => s !== s.toLowerCase() && s !== s.toUpperCase()), // Mixed case
                (prog_name) => {
                    const code = `program define ${prog_name}\n    display "test"\nend`;
                    const { program } = parse_and_analyze_simple(code);
                    
                    expect(program).toBeDefined();
                    expect(program!.name).toBe(prog_name); // Exact case match
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 11: Multiple Programs
     * Multiple program definitions should all be detected correctly.
     * NOTE: Macro-creating options require BOTH a syntax declaration AND a body pattern.
     */
    it('should detect multiple programs correctly', () => {
        fc.assert(
            fc.property(
                fc.array(program_name, { minLength: 2, maxLength: 3 }),
                (prog_names) => {
                    // Ensure unique program names
                    const unique_names = [...new Set(prog_names)];
                    if (unique_names.length < 2) return; // Skip if not enough unique names
                    
                    // Include syntax declaration for each program's option
                    const programs = unique_names.map((name, i) => 
                        `program define ${name}\n    syntax, opt${i}(name)\n    c_local \`opt${i}' = "value${i}"\nend`
                    ).join('\n\n');
                    
                    const lexer = new StataLexer();
                    const parser = new StataParser();
                    const analyzer = new SemanticAnalyzer();
                    
                    const lexer_result = lexer.tokenize(programs);
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analysis_result = analyzer.analyze(parse_result.ast, 'test://test.do');
                    
                    expect(analysis_result.symbols.programs.size).toBe(unique_names.length);
                    
                    for (const name of unique_names) {
                        expect(analysis_result.symbols.programs.has(name)).toBe(true);
                        const program = analysis_result.symbols.programs.get(name);
                        expect(program!.macro_creating_local_options?.length).toBe(1);
                    }
                }
            ),
            { numRuns: 15 }
        );
    });

    /**
     * Property 12: Pattern Extraction Completeness
     * All valid patterns should be extracted, regardless of their position.
     * Duplicates are deduplicated.
     */
    it('should extract all valid patterns comprehensively', () => {
        fc.assert(
            fc.property(
                fc.array(valid_identifier, { minLength: 1, maxLength: 5 }),
                fc.array(valid_identifier, { minLength: 1, maxLength: 5 }),
                (local_opts, global_opts) => {
                    const result = test_macro_creating_patterns('test_prog', local_opts, global_opts);
                    
                    // Deduplication means unique options only
                    const unique_local = [...new Set(local_opts)];
                    const unique_global = [...new Set(global_opts)];
                    
                    // Check all local options are detected
                    expect(result.local_options.length).toBe(unique_local.length);
                    for (const opt of unique_local) {
                        expect(result.local_options).toContain(opt);
                    }
                    
                    // Check all global options are detected
                    expect(result.global_options.length).toBe(unique_global.length);
                    for (const opt of unique_global) {
                        expect(result.global_options).toContain(opt);
                    }
                }
            ),
            { numRuns: 20 }
        );
    });
});
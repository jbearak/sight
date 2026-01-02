/**
 * Property tests for Non-Forward Reference Suppression
 *
 * Feature: cross-file-forward-reference-fix, Property 2
 * Validates: Requirements 1.2
 *
 * Property 2: Non-forward references to same-file symbols do not produce warnings
 * When macros are referenced after their definition line in files with cross-file
 * directives, no undefined macro warnings are produced.
 */

import { describe, test } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('Non-Forward Reference Suppression Property Tests', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();

    // Generator for valid Stata macro names
    const macro_name_gen = fc.string({ minLength: 2, maxLength: 10 })
        .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
        .filter(s => !['if', 'in', 'using', 'local', 'global', 'end', 'program'].includes(s.toLowerCase()));

    // Generator for cross-file directive types
    const directive_gen = fc.constantFrom('@lsp-done-by:', '@lsp-included-by:');

    // Generator for parent file paths
    const parent_path_gen = fc.string({ minLength: 3, maxLength: 15 })
        .filter(s => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s))
        .map(s => `"${s}.do"`);

    /**
     * Property 2: Non-forward references to same-file symbols do not produce warnings
     *
     * When macros are referenced after their definition line in files with cross-file
     * directives, no undefined macro warnings are produced.
     *
     * Validates: Requirements 1.2
     */
    test('Property 2: Non-forward references with cross-file directives produce no warnings', () => {
        fc.assert(
            fc.property(
                fc.record({
                    directive: directive_gen,
                    parent_path: parent_path_gen,
                    macro_name: macro_name_gen,
                }),
                ({ directive, parent_path, macro_name }) => {
                    // Create file with cross-file directive and proper macro order
                    const content = `// ${directive} ${parent_path}
local ${macro_name} value
local result \`${macro_name}'`;

                    const lexer_result = lexer.tokenize(content);
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analyzer = new SemanticAnalyzer();
                    const analysis_result = analyzer.analyze(
                        parse_result.ast,
                        'file:///test.do',
                        undefined,
                        { undefined_macro_enabled: true },
                        lexer_result.tokens
                    );

                    // Should NOT have undefined macro warnings for properly ordered references
                    const undefined_warnings = analysis_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    return undefined_warnings.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 2: Multiple non-forward references produce no warnings', () => {
        fc.assert(
            fc.property(
                fc.record({
                    directive: directive_gen,
                    parent_path: parent_path_gen,
                    macro_name: macro_name_gen,
                    num_references: fc.integer({ min: 2, max: 4 }),
                }),
                ({ directive, parent_path, macro_name, num_references }) => {
                    // Create multiple references after definition
                    const the_references = Array(num_references)
                        .fill(`local ref_${macro_name} \`${macro_name}'`)
                        .join('\n');
                    
                    const content = `// ${directive} ${parent_path}
local ${macro_name} value
${the_references}`;

                    const lexer_result = lexer.tokenize(content);
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analyzer = new SemanticAnalyzer();
                    const analysis_result = analyzer.analyze(
                        parse_result.ast,
                        'file:///test.do',
                        undefined,
                        { undefined_macro_enabled: true },
                        lexer_result.tokens
                    );

                    // Should NOT have undefined macro warnings for any properly ordered references
                    const undefined_warnings = analysis_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    return undefined_warnings.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 2: Non-forward references in program blocks produce no warnings', () => {
        fc.assert(
            fc.property(
                fc.record({
                    directive: directive_gen,
                    parent_path: parent_path_gen,
                    macro_name: macro_name_gen,
                    program_name: fc.string({ minLength: 3, maxLength: 8 })
                        .filter(s => /^[a-z][a-z0-9]*$/.test(s)),
                }),
                ({ directive, parent_path, macro_name, program_name }) => {
                    const content = `// ${directive} ${parent_path}
program define ${program_name}
    local ${macro_name} value
    local result \`${macro_name}'
end`;

                    const lexer_result = lexer.tokenize(content);
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analyzer = new SemanticAnalyzer();
                    const analysis_result = analyzer.analyze(
                        parse_result.ast,
                        'file:///test.do',
                        undefined,
                        { undefined_macro_enabled: true },
                        lexer_result.tokens
                    );

                    // Should NOT have undefined macro warnings for properly ordered references in programs
                    const undefined_warnings = analysis_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    return undefined_warnings.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 2: Global macros with non-forward references produce no warnings', () => {
        fc.assert(
            fc.property(
                fc.record({
                    directive: directive_gen,
                    parent_path: parent_path_gen,
                    macro_name: macro_name_gen,
                }),
                ({ directive, parent_path, macro_name }) => {
                    const content = `// ${directive} ${parent_path}
global ${macro_name} value
local result $${macro_name}`;

                    const lexer_result = lexer.tokenize(content);
                    const parse_result = parser.parse(lexer_result.tokens);
                    const analyzer = new SemanticAnalyzer();
                    const analysis_result = analyzer.analyze(
                        parse_result.ast,
                        'file:///test.do',
                        undefined,
                        { undefined_macro_enabled: true },
                        lexer_result.tokens
                    );

                    // Should NOT have undefined macro warnings for properly ordered global references
                    const undefined_warnings = analysis_result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(macro_name)
                    );
                    
                    return undefined_warnings.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});
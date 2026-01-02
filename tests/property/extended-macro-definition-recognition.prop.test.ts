/**
 * Extended Macro Definition Recognition Property Tests
 *
 * Tests that extended macro definitions are properly registered in symbol tables
 * and don't produce undefined macro warnings when referenced.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

describe('Extended Macro Definition Recognition Property Tests', () => {
    let my_analyzer: SemanticAnalyzer;
    let my_lexer: StataLexer;
    let my_parser: StataParser;

    beforeEach(() => {
        my_analyzer = new SemanticAnalyzer();
        my_lexer = new StataLexer();
        my_parser = new StataParser();
    });

    function analyze_document(my_source: string) {
        const my_lex_result = my_lexer.tokenize(my_source);
        const my_parse_result = my_parser.parse(my_lex_result.tokens);
        return my_analyzer.analyze(
            my_parse_result.ast,
            'file:///test.do',
            undefined,
            { undefined_macro_enabled: true },
            my_lex_result.tokens
        );
    }

    const arbitrary_macro_name = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{2,15}$/);
    
    const arbitrary_extended_function = fc.oneof(
        // Exclude 'list' since it expects macro arguments that should be defined
        fc.constant('word'),
        fc.constant('subinstr'),
        fc.constant('length'),
        fc.constant('substr'),
        fc.constant('upper'),
        fc.constant('lower')
    );

    const arbitrary_function_args = fc.stringMatching(/^[a-zA-Z0-9_\s\-"']{1,20}$/);

    it('should register extended macro definitions in symbol table', () => {
        fc.assert(
            fc.property(
                arbitrary_macro_name,
                arbitrary_extended_function,
                arbitrary_function_args,
                (my_name, my_func, my_args) => {
                    const my_source = `local ${my_name} : ${my_func} ${my_args}`;
                    const my_result = analyze_document(my_source);
                    
                    expect(my_result.symbols.localMacros.has(my_name)).toBe(true);
                    
                    const my_symbol = my_result.symbols.localMacros.get(my_name);
                    expect(my_symbol?.name).toBe(my_name);
                    expect(my_symbol?.scope).toBe('local');
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should not produce undefined macro warnings for extended macro references', () => {
        fc.assert(
            fc.property(
                arbitrary_macro_name,
                arbitrary_extended_function,
                arbitrary_function_args,
                (my_name, my_func, my_args) => {
                    const my_source = `local ${my_name} : ${my_func} ${my_args}\ndisplay "\`${my_name}'"`;
                    const my_result = analyze_document(my_source);
                    
                    const my_undefined_warnings = my_result.diagnostics.filter(
                        my_diag => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    expect(my_undefined_warnings.length).toBe(0);
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should register global extended macro definitions', () => {
        fc.assert(
            fc.property(
                arbitrary_macro_name,
                arbitrary_extended_function,
                arbitrary_function_args,
                (my_name, my_func, my_args) => {
                    const my_source = `global ${my_name} : ${my_func} ${my_args}`;
                    const my_result = analyze_document(my_source);
                    
                    expect(my_result.symbols.globalMacros.has(my_name)).toBe(true);
                    
                    const my_symbol = my_result.symbols.globalMacros.get(my_name);
                    expect(my_symbol?.scope).toBe('global');
                    
                    return true;
                }
            ),
            { numRuns: 30 }
        );
    });

    it('should handle multiple extended macro definitions without conflicts', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_macro_name, { minLength: 2, maxLength: 5 }),
                (the_names) => {
                    const the_unique_names = [...new Set(the_names)];
                    if (the_unique_names.length < 2) return true;
                    
                    // Define the required list macros first
                    const my_list_definitions = the_unique_names.map(
                        my_name => `local ${my_name}_list "item1 item2 item3"`
                    ).join('\n');
                    
                    const my_definitions = the_unique_names.map(
                        my_name => `local ${my_name} : list sizeof ${my_name}_list`
                    ).join('\n');
                    
                    const my_references = the_unique_names.map(
                        my_name => `display "\`${my_name}'"`
                    ).join('\n');
                    
                    const my_source = `${my_list_definitions}\n${my_definitions}\n${my_references}`;
                    const my_result = analyze_document(my_source);
                    
                    for (const my_name of the_unique_names) {
                        expect(my_result.symbols.localMacros.has(my_name)).toBe(true);
                    }
                    
                    const my_undefined_warnings = my_result.diagnostics.filter(
                        my_diag => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
                    );
                    
                    expect(my_undefined_warnings.length).toBe(0);
                    
                    return true;
                }
            ),
            { numRuns: 30 }
        );
    });
});
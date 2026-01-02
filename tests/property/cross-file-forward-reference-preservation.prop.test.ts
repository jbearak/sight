/**
 * Cross-File Forward Reference Preservation Property Tests
 * 
 * Feature: cross-file-forward-reference-fix, Property 1
 * Validates: Requirements 1.1
 * 
 * Tests that forward references to same-file symbols produce warnings
 * even when cross-file directives are present.
 * 
 * Note: The workspace_symbols parameter does NOT suppress undefined macro warnings.
 * Only cross-file directives (@lsp-done-by, @lsp-included-by, etc.) suppress warnings.
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

function analyze_code(code: string, workspace_symbols?: SymbolTable) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(code);
    const parse_result = parser.parse(lexer_result.tokens);
    return analyzer.analyze(
        parse_result.ast, 
        'file:///child.do', 
        workspace_symbols, 
        { undefined_macro_enabled: true }, 
        lexer_result.tokens
    );
}

// Simple generators
const macro_name_gen = fc.constantFrom('apple', 'banana', 'cherry', 'data', 'result');
const file_path_gen = fc.constantFrom('parent.do', 'setup.do', 'config.do');

describe('Cross-File Forward Reference Preservation Properties', () => {
    /**
     * Property 1: Forward references to same-file symbols produce warnings
     * The analyzer should detect forward references regardless of cross-file directives.
     * 
     * Note: workspace_symbols do NOT suppress warnings. Only cross-file directives
     * (@lsp-done-by, @lsp-included-by, etc.) provide scope resolution.
     */
    it('Property 1: Forward references preserved with done-by directive', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                macro_name_gen,
                file_path_gen,
                (forward_ref_macro, parent_macro, parent_file) => {
                    if (forward_ref_macro === parent_macro) return true;
                    
                    // workspace_symbols do NOT suppress warnings
                    const workspace_symbols: SymbolTable = {
                        programs: new Map(),
                        localMacros: new Map(),
                        globalMacros: new Map([
                            [parent_macro, {
                                name: parent_macro,
                                scope: 'global',
                                location: { 
                                    uri: `file:///${parent_file}`, 
                                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } 
                                },
                                sourceUri: `file:///${parent_file}`,
                            }]
                        ]),
                        variables: new Map(),
                        scalars: new Map(),
                        matrices: new Map(),
                    };

                    const code = `// @lsp-done-by: "${parent_file}"
local test: list ${forward_ref_macro} - dummy
local ${forward_ref_macro} value
local parent_access \${${parent_macro}}`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    // Forward reference to same-file symbol should produce warning
                    const forward_ref_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(forward_ref_macro)
                    );
                    
                    // Parent file symbol WILL warn (workspace symbols do NOT suppress)
                    const parent_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(`$${parent_macro}`)
                    );
                    
                    // Both forward reference and parent symbol should warn
                    return forward_ref_warnings.length === 1 && parent_warnings.length === 1;
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 2: Forward references preserved with included-by directive
     */
    it('Property 2: Forward references preserved with included-by directive', () => {
        fc.assert(
            fc.property(
                macro_name_gen,
                macro_name_gen,
                file_path_gen,
                (forward_ref_macro, parent_local, parent_file) => {
                    if (forward_ref_macro === parent_local) return true;
                    
                    // workspace_symbols do NOT suppress warnings
                    const workspace_symbols: SymbolTable = {
                        programs: new Map(),
                        localMacros: new Map([
                            [parent_local, {
                                name: parent_local,
                                scope: 'local',
                                location: { 
                                    uri: `file:///${parent_file}`, 
                                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } 
                                },
                                sourceUri: `file:///${parent_file}`,
                            }]
                        ]),
                        globalMacros: new Map(),
                        variables: new Map(),
                        scalars: new Map(),
                        matrices: new Map(),
                    };

                    const code = `// @lsp-included-by: "${parent_file}"
local test: list ${forward_ref_macro} - dummy
local ${forward_ref_macro} value
local parent_access \`${parent_local}'`;

                    const result = analyze_code(code, workspace_symbols);
                    
                    const forward_ref_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(forward_ref_macro)
                    );
                    
                    // workspace_symbols do NOT suppress warnings - parent_local will also warn
                    const parent_warnings = result.diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                             d.message.includes(parent_local)
                    );
                    
                    // Both should warn
                    return forward_ref_warnings.length === 1 && parent_warnings.length === 1;
                }
            ),
            { numRuns: 10 }
        );
    });
});

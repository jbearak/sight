import { describe, it, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataDiagnosticCode } from '../../src/types';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';

/**
 * End-to-end integration test for the complete LSP pipeline.
 * 
 * Tests the complete flow: lexer → parser → analyzer → diagnostics
 * for various Stata constructs to ensure no false positives.
 * 
 * **Feature: end-to-end-pipeline**
 * **Validates: Complete pipeline integration**
 */

const DEFAULT_CONFIG = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning' as const,
            undefinedVariable: 'information' as const,
            styleWarnings: 'hint' as const,
        },
    },
    completion: {},
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces' as const,
    },
    adoPaths: [],
    indexWorkspace: true,
};

describe('End-to-End Pipeline Integration Test', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;
    let document_store: DocumentStore;
    let diagnostics_provider: DiagnosticsProvider;

    beforeEach(() => {
        initialize_builtin_commands();
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
        document_store = new DocumentStore();
        diagnostics_provider = new DiagnosticsProvider({
            sendDiagnostics: () => {},
        } as any);
    });

    describe('unab command recognition', () => {
        it('should recognize macros defined by unab command', async () => {
            const my_content = `
unab all_vars: _all
unab raw_vars: var1 var2 var3
display "\`all_vars'"
display "\`raw_vars'"
`;
            const my_document_uri = 'file:///test_unab.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have no undefined macro errors for unab-defined macros
            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('all_vars') || my_diag.message.includes('raw_vars'))
            );

            expect(the_undefined_errors.length).toBe(0);
        });

        it('should handle unab with complex variable patterns', async () => {
            const my_content = `
unab numeric_vars: var1-var10
unab string_vars: str*
local combined_vars \`numeric_vars' \`string_vars'
display "\`combined_vars'"
`;
            const my_document_uri = 'file:///test_unab_patterns.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('numeric_vars') || 
                     my_diag.message.includes('string_vars') ||
                     my_diag.message.includes('combined_vars'))
            );

            expect(the_undefined_errors.length).toBe(0);
        });
    });

    describe('complete survey.do pattern', () => {
        it('should handle the complete survey.do variable management pattern', async () => {
            const my_content = `
* Simulate the complete survey.do pattern
program define process_data
    args country_name survey_year
    
    * Get all variables (unab command)
    unab all_vars_wm: _all
    unab raw_vars: v001 v002 v003 caseid
    
    * Calculate constructed variables using list operation
    local constructed_vars_wm: list all_vars_wm - raw_vars
    
    * Define variables to retain using intersection
    local raw_vars_to_retain v001 v002 v003 caseid age education
    local raw_vars_to_retain: list all_vars_wm & raw_vars_to_retain
    
    * Use all the macros
    keep \`constructed_vars_wm' \`raw_vars_to_retain'
    
    display "Processed: \`country_name' \`survey_year'"
end
`;
            const my_document_uri = 'file:///test_complete_pattern.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Log all diagnostics for debugging
            if (the_diagnostics.length > 0) {
                console.log('Complete pattern diagnostics:');
                for (const my_diag of the_diagnostics) {
                    console.log(
                        `  Line ${my_diag.range.start.line + 1}: [${my_diag.code}] ${my_diag.message}`
                    );
                }
            }

            // Filter out positional argument warnings (expected for `1' and `2')
            const the_false_positives = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    !my_diag.message.includes("'1'") &&
                    !my_diag.message.includes("'2'") &&
                    (my_diag.message.includes('all_vars_wm') ||
                     my_diag.message.includes('raw_vars') ||
                     my_diag.message.includes('constructed_vars_wm') ||
                     my_diag.message.includes('raw_vars_to_retain'))
            );

            expect(the_false_positives.length).toBe(0);
        });
    });

    describe('frame block macro scoping', () => {
        it('should handle macros defined and used within frame blocks', async () => {
            const my_content = `
frame create test_frame
frame test_frame {
    local frame_var hello
    unab frame_all_vars: _all
    local frame_result: list frame_all_vars - frame_var
    display "\`frame_result'"
}
`;
            const my_document_uri = 'file:///test_frame_macros.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('frame_var') ||
                     my_diag.message.includes('frame_all_vars') ||
                     my_diag.message.includes('frame_result'))
            );

            expect(the_undefined_errors.length).toBe(0);
        });
    });

    describe('program block macro scoping', () => {
        it('should handle macros within program blocks', async () => {
            const my_content = `
program define test_program
    args input_var
    
    unab all_program_vars: _all
    local program_local hello
    local combined: list all_program_vars | program_local
    
    display "\`combined'"
    display "\`input_var'"
end
`;
            const my_document_uri = 'file:///test_program_macros.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Filter out positional argument warnings (expected for args)
            const the_false_positives = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    !my_diag.message.includes("'1'") &&
                    (my_diag.message.includes('all_program_vars') ||
                     my_diag.message.includes('program_local') ||
                     my_diag.message.includes('combined') ||
                     my_diag.message.includes('input_var'))
            );

            expect(the_false_positives.length).toBe(0);
        });
    });

    describe('complex nested operations', () => {
        it('should handle deeply nested list operations and macro references', async () => {
            const my_content = `
* Multi-level variable processing
unab all_vars: _all
unab demographic_vars: age sex education
unab economic_vars: income wealth employment

* First level operations
local non_demographic: list all_vars - demographic_vars
local non_economic: list all_vars - economic_vars

* Second level operations  
local analysis_vars: list non_demographic & non_economic
local control_vars: list demographic_vars | economic_vars

* Third level operations
local final_model_vars: list analysis_vars - control_vars
local interaction_vars: list control_vars & analysis_vars

* Use all the computed macros
display "Analysis: \`analysis_vars'"
display "Controls: \`control_vars'"
display "Final: \`final_model_vars'"
display "Interactions: \`interaction_vars'"
`;
            const my_document_uri = 'file:///test_nested_operations.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have no undefined macro errors for any of the computed macros
            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
            );

            expect(the_undefined_errors.length).toBe(0);
        });
    });

    describe('error detection preservation', () => {
        it('should still detect genuinely undefined macros in complex scenarios', async () => {
            const my_content = `
unab all_vars: _all
unab raw_vars: var1 var2

* This should work fine
local constructed_vars: list all_vars - raw_vars

* This should trigger an error - undefined_macro is not defined
local bad_result: list all_vars - undefined_macro

display "\`constructed_vars'"
display "\`bad_result'"
`;
            const my_document_uri = 'file:///test_error_preservation.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should detect undefined_macro but not the others
            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
            );

            expect(the_undefined_errors.length).toBe(1);
            expect(the_undefined_errors[0].message).toContain('undefined_macro');
        });
    });

    describe('pipeline component validation', () => {
        it('should correctly tokenize complex macro operations', () => {
            const my_content = `local result: list all_vars - raw_vars`;
            
            const my_lex_result = lexer.tokenize(my_content);
            
            // Should have tokens for: local, result, :, list, all_vars, -, raw_vars
            expect(my_lex_result.tokens.length).toBeGreaterThan(6);
            expect(my_lex_result.errors.length).toBe(0);
        });

        it('should correctly parse unab commands into AST', () => {
            const my_content = `unab my_vars: var1 var2 var3`;
            
            const my_lex_result = lexer.tokenize(my_content);
            const my_parse_result = parser.parse(my_lex_result.tokens);
            
            expect(my_parse_result.ast.nodes.length).toBe(1);
            expect(my_parse_result.ast.nodes[0].type).toBe('command');
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should build symbol tables with all macro types', async () => {
            const my_content = `
local simple_macro hello
global global_macro world
unab unab_macro: _all
local list_macro: list unab_macro - simple_macro
`;
            const my_document_uri = 'file:///test_symbol_types.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const my_analysis_result = analyzer.analyze(my_document.ast);
            
            // Should have local macros
            expect(my_analysis_result.symbols.localMacros.size).toBeGreaterThan(0);
            
            // Should have global macros  
            expect(my_analysis_result.symbols.globalMacros.size).toBeGreaterThan(0);
        });
    });
});
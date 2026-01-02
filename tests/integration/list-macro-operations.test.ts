import { describe, it, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataDiagnosticCode } from '../../src/types';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';

/**
 * Integration test for list macro operations and end-to-end diagnostics flow.
 * 
 * Tests the complete pipeline: lexer → parser → analyzer → diagnostics
 * for extended macro functions, particularly `: list` operations.
 * 
 * **Feature: list-macro-operations**
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

const DEFAULT_CONFIG = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning' as const,
            undefinedVariable: 'information' as const,
            styleWarnings: 'hint' as const,
        },
        undefinedVariableEnabled: false,
    },
    completion: {},
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces' as const,
    },
    adoPaths: [],
    indexWorkspace: true,
};

describe('List Macro Operations Integration Test', () => {
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

    describe('basic list operations', () => {
        it('should recognize macros defined with `: list` subtraction', async () => {
            const my_content = `
local all_vars var1 var2 var3 var4
local raw_vars var1 var2
local constructed_vars: list all_vars - raw_vars
display "\`constructed_vars'"
`;
            const my_document_uri = 'file:///test_list_subtract.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have no undefined macro errors for constructed_vars
            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('constructed_vars')
            );

            expect(the_undefined_errors.length).toBe(0);
        });

        it('should recognize macros defined with `: list` intersection', async () => {
            const my_content = `
local list1 a b c d
local list2 b c e f
local common_vars: list list1 & list2
display "\`common_vars'"
`;
            const my_document_uri = 'file:///test_list_intersect.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('common_vars')
            );

            expect(the_undefined_errors.length).toBe(0);
        });

        it('should recognize macros defined with `: list` union', async () => {
            const my_content = `
local list1 a b c
local list2 d e f
local all_items: list list1 | list2
display "\`all_items'"
`;
            const my_document_uri = 'file:///test_list_union.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('all_items')
            );

            expect(the_undefined_errors.length).toBe(0);
        });

        it('should handle `: list posof` function', async () => {
            const my_content = `
local the_list a b c d
local target_item c
local item_position: list posof "c" in the_list
display "\`item_position'"
`;
            const my_document_uri = 'file:///test_list_posof.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('item_position')
            );

            expect(the_undefined_errors.length).toBe(0);
        });
    });

    describe('survey.do pattern reproduction', () => {
        it('should handle the exact pattern from survey.do', async () => {
            const my_content = `
* Simulate the survey.do pattern
unab all_vars: _all
unab raw_vars: var1 var2 var3

* This is the problematic line from survey.do
local constructed_vars: list all_vars - raw_vars

* Use the constructed_vars macro
keep \`constructed_vars' \`raw_vars'
`;
            const my_document_uri = 'file:///test_survey_pattern.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Log diagnostics for debugging
            if (the_diagnostics.length > 0) {
                console.log('Survey pattern diagnostics:');
                for (const my_diag of the_diagnostics) {
                    console.log(
                        `  Line ${my_diag.range.start.line + 1}: [${my_diag.code}] ${my_diag.message}`
                    );
                }
            }

            // Should have no undefined macro errors for constructed_vars
            const the_constructed_vars_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('constructed_vars')
            );

            expect(the_constructed_vars_errors.length).toBe(0);
        });

        it('should handle nested list operations', async () => {
            const my_content = `
local all_vars var1 var2 var3 var4 var5
local raw_vars var1 var2
local keep_vars var3 var4

* First operation
local constructed_vars: list all_vars - raw_vars

* Second operation using result of first
local final_vars: list constructed_vars & keep_vars

display "\`final_vars'"
`;
            const my_document_uri = 'file:///test_nested_list.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes('constructed_vars') ||
                     my_diag.message.includes('final_vars'))
            );

            expect(the_undefined_errors.length).toBe(0);
        });
    });

    describe('end-to-end pipeline validation', () => {
        it('should correctly parse extended macro function AST nodes', () => {
            const my_content = `local result: list a - b`;
            
            const my_lex_result = lexer.tokenize(my_content);
            expect(my_lex_result.tokens.length).toBeGreaterThan(0);

            const my_parse_result = parser.parse(my_lex_result.tokens);
            expect(my_parse_result.ast).toBeDefined();
            expect(my_parse_result.ast.nodes.length).toBe(1);

            const my_macro_node = my_parse_result.ast.nodes[0];
            expect(my_macro_node.type).toBe('macro_def');
            expect(my_macro_node.name).toBe('result');
        });

        it('should build correct symbol table for list operations', async () => {
            const my_content = `
local list1 a b c
local list2 d e f
local combined: list list1 | list2
`;
            const my_document_uri = 'file:///test_symbol_table.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            // Verify symbol table contains all three macros
            const my_analysis_result = analyzer.analyze(my_document.ast);
            
            expect(my_analysis_result.symbols.localMacros.has('list1')).toBe(true);
            expect(my_analysis_result.symbols.localMacros.has('list2')).toBe(true);
            expect(my_analysis_result.symbols.localMacros.has('combined')).toBe(true);
        });

        it('should handle complex real-world scenario', async () => {
            const my_content = `
* Simulate complex survey processing
program define process_survey
    args country_name survey_year
    
    * Get all variables
    unab all_vars_wm: _all
    unab raw_vars: v001 v002 v003 caseid
    
    * Calculate constructed variables
    local constructed_vars_wm: list all_vars_wm - raw_vars
    
    * Define variables to retain
    local raw_vars_to_retain v001 v002 v003 caseid age education
    local raw_vars_to_retain: list all_vars_wm & raw_vars_to_retain
    
    * Keep only what we need
    keep \`constructed_vars_wm' \`raw_vars_to_retain'
    
    display "Processed: \`country_name' \`survey_year'"
end
`;
            const my_document_uri = 'file:///test_complex_scenario.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Filter out positional argument warnings (these are expected)
            const the_false_positives = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    !my_diag.message.includes("'1'") &&
                    !my_diag.message.includes("'2'") &&
                    (my_diag.message.includes('constructed_vars_wm') ||
                     my_diag.message.includes('raw_vars_to_retain'))
            );

            expect(the_false_positives.length).toBe(0);
        });
    });

    describe('error detection validation', () => {
        it('should still detect genuine undefined macros', async () => {
            const my_content = `
local defined_var hello
local result: list defined_var - undefined_var
display "\`result'"
`;
            const my_document_uri = 'file:///test_genuine_errors.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should detect undefined_var in the list operation
            const the_undefined_errors = the_diagnostics.filter(
                (my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO
            );

            expect(the_undefined_errors.length).toBeGreaterThanOrEqual(1);
            
            const the_error_messages = the_undefined_errors.map(d => d.message);
            expect(the_error_messages.some(msg => msg.includes('undefined_var'))).toBe(true);
        });

        it('should not flag result macro as undefined', async () => {
            const my_content = `
local defined_var hello
local undefined_var world
local result: list defined_var - undefined_var
display "\`result'"
`;
            const my_document_uri = 'file:///test_result_defined.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should not flag 'result' as undefined
            const the_result_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('result')
            );

            expect(the_result_errors.length).toBe(0);
        });
    });
});
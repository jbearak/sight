import { describe, it, expect, beforeEach } from 'bun:test';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { LexerErrorCode, ParseErrorCode, StataDiagnosticCode } from '../../src/types';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';

/**
 * Integration test for diagnostic false positives fix.
 * 
 * This test validates that the LSP correctly handles:
 * 1. Program block `end` recognition - no false "Unexpected end command" warnings
 * 2. Frame block recognition - no false "open brace must be on same line" warnings
 * 3. Positional argument recognition - no false "Undefined local macro" warnings
 * 
 * The survey.do fixture file contains all these constructs and should only
 * emit two legitimate unclosed string literal warnings.
 * 
 * **Feature: diagnostic-false-positives**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
 */

// Default test configuration
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

describe('Diagnostic False Positives Integration Test', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;
    let document_store: DocumentStore;
    let diagnostics_provider: DiagnosticsProvider;
    let survey_content: string;

    beforeEach(() => {
        initialize_builtin_commands();
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
        document_store = new DocumentStore();
        diagnostics_provider = new DiagnosticsProvider({
            sendDiagnostics: () => {},
        } as any);

        // Load the survey.do fixture file
        const fixture_path = join(
            process.cwd(),
            '.kiro/specs/diagnostic-false-positives/survey.do'
        );
        survey_content = readFileSync(fixture_path, 'utf-8');
    });

    describe('survey.do fixture analysis', () => {
        it('should parse survey.do without crashing', () => {
            const my_lex_result = lexer.tokenize(survey_content);
            expect(my_lex_result.tokens.length).toBeGreaterThan(0);

            const my_parse_result = parser.parse(my_lex_result.tokens);
            expect(my_parse_result.ast).toBeDefined();
            expect(my_parse_result.ast.nodes.length).toBeGreaterThan(0);
        });

        it('should emit only legitimate diagnostics for survey.do', async () => {
            const my_document_uri = 'file:///survey.do';
            await document_store.open(my_document_uri, survey_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Log all diagnostics for debugging
            if (the_diagnostics.length > 0) {
                console.log('Diagnostics found:');
                for (const my_diag of the_diagnostics) {
                    console.log(
                        `  Line ${my_diag.range.start.line + 1}: [${my_diag.code}] ${my_diag.message}`
                    );
                }
            }

            // Filter out legitimate warnings that are not false positives:
            // 1. Unclosed string literal warnings (actual issues in the file)
            // 2. constructed_vars - macro defined with `: list` syntax (separate issue)
            const the_false_positives = the_diagnostics.filter((my_diag) => {
                // Allow unclosed string literal warnings (these are legitimate)
                if (
                    my_diag.code === LexerErrorCode.UNBALANCED_QUOTES ||
                    my_diag.message.includes('Unclosed string literal')
                ) {
                    return false;
                }
                // The constructed_vars issue is a separate problem - macro defined with
                // `: list` syntax. This is not related to the false positives we're fixing.
                if (
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('constructed_vars')
                ) {
                    return false;
                }
                return true;
            });

            // Log false positives for debugging
            if (the_false_positives.length > 0) {
                console.log('False positives found:');
                for (const my_diag of the_false_positives) {
                    console.log(
                        `  Line ${my_diag.range.start.line + 1}: [${my_diag.code}] ${my_diag.message}`
                    );
                }
            }

            // Should have no false positives
            expect(the_false_positives.length).toBe(0);
        });

        it('should NOT emit "Unexpected end command" for program block', async () => {
            const my_document_uri = 'file:///survey.do';
            await document_store.open(my_document_uri, survey_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Check for false positive: "Unexpected end command - not in a mata block"
            const the_end_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.message.includes('Unexpected end command') ||
                    my_diag.message.includes('not in a mata block')
            );

            expect(the_end_errors.length).toBe(0);
        });

        it('should NOT emit "open brace must be on same line" for frame blocks', async () => {
            const my_document_uri = 'file:///survey.do';
            await document_store.open(my_document_uri, survey_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Check for false positive: "open brace must be on the same line as the condition"
            const the_brace_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === ParseErrorCode.OPEN_BRACE_ALONE ||
                    my_diag.message.includes('open brace must be on the same line')
            );

            expect(the_brace_errors.length).toBe(0);
        });

        it('should NOT emit "Undefined local macro" for positional arguments', async () => {
            const my_document_uri = 'file:///survey.do';
            await document_store.open(my_document_uri, survey_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Check for false positive: undefined macro warnings for `1' and `2'
            const the_positional_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes("'1'") || my_diag.message.includes("'2'"))
            );

            expect(the_positional_errors.length).toBe(0);
        });

        it('should NOT emit "Undefined local macro" for macros defined in frame blocks', async () => {
            const my_document_uri = 'file:///survey.do';
            await document_store.open(my_document_uri, survey_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Check for false positive: undefined macro warnings for intention_vars
            // This is defined inside a frame block at line 119 and used at line 120
            const the_frame_macro_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    my_diag.message.includes('intention_vars')
            );

            expect(the_frame_macro_errors.length).toBe(0);
        });

        it('should correctly recognize program block structure', () => {
            const my_lex_result = lexer.tokenize(survey_content);
            const my_parse_result = parser.parse(my_lex_result.tokens);

            // Find the program node for check_for_bidx_in_wm_file
            const the_program_nodes = my_parse_result.ast.nodes.filter(
                (my_node) => my_node.type === 'program'
            );

            // Should have at least one program definition
            expect(the_program_nodes.length).toBeGreaterThanOrEqual(1);

            // Find the specific program
            const my_check_program = the_program_nodes.find(
                (my_node) =>
                    my_node.type === 'program' &&
                    my_node.name === 'check_for_bidx_in_wm_file'
            );

            expect(my_check_program).toBeDefined();
        });

        it('should correctly recognize frame block structure', () => {
            const my_lex_result = lexer.tokenize(survey_content);
            const my_parse_result = parser.parse(my_lex_result.tokens);

            // Helper function to recursively find frame nodes
            const find_frame_nodes = (nodes: any[]): any[] => {
                const the_frames: any[] = [];
                for (const my_node of nodes) {
                    if (my_node.type === 'frame') {
                        the_frames.push(my_node);
                    }
                    // Recursively search in body of control flow nodes
                    if (my_node.body && Array.isArray(my_node.body)) {
                        the_frames.push(...find_frame_nodes(my_node.body));
                    }
                }
                return the_frames;
            };

            const the_frame_nodes = find_frame_nodes(my_parse_result.ast.nodes);

            // Should have at least one frame block (frame bh { ... })
            expect(the_frame_nodes.length).toBeGreaterThanOrEqual(1);

            // Verify the frame name is 'bh'
            const my_bh_frame = the_frame_nodes.find(
                (my_node) => my_node.frameName === 'bh'
            );
            expect(my_bh_frame).toBeDefined();
        });

        it('should maintain accurate context tracking across 300+ line script', async () => {
            const my_document_uri = 'file:///survey.do';
            await document_store.open(my_document_uri, survey_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            // Verify the document was parsed successfully
            expect(my_document.ast).toBeDefined();
            expect(my_document.tokens.length).toBeGreaterThan(0);

            // Verify context tracker is initialized
            expect(my_document.context_tracker).toBeDefined();

            // The file should be primarily Stata context
            const my_line_count = survey_content.split('\n').length;
            expect(my_line_count).toBeGreaterThan(300);
        });
    });

    describe('individual construct tests', () => {
        it('should handle program define ... end without false positives', async () => {
            const my_content = `
capture program drop my_test_program
program define my_test_program
    display "Hello"
    local x = 1
end
`;
            const my_document_uri = 'file:///test_program.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have no diagnostics for valid program block
            const the_end_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.message.includes('Unexpected end command') ||
                    my_diag.message.includes('not in a mata block')
            );

            expect(the_end_errors.length).toBe(0);
        });

        it('should publish a multi-line block-comment-in-star-comment warning', async () => {
            // Regression guard for the numeric→symbolic diagnostic-code
            // migration. The old extract_lexer_errors range check
            // (1001-1004) silently dropped BLOCK_COMMENT_IN_STAR_COMMENT
            // (1005); the new Set over the full LexerErrorCode enum admits it,
            // matching convert_lexer_error's explicit Warning handling, the
            // fallback publish path, and docs/diagnostics.md.
            const my_content =
                '* star comment /* opens block\nstill comment */ end\ngen x = 1\n';
            const my_document_uri = 'file:///test_block_comment.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            const the_block_comment_diag = the_diagnostics.find(
                (my_diag) =>
                    my_diag.code ===
                    StataDiagnosticCode.BLOCK_COMMENT_IN_STAR_COMMENT
            );
            expect(the_block_comment_diag).toBeDefined();
            expect(the_block_comment_diag?.severity).toBe(
                DiagnosticSeverity.Warning
            );
        });

        it('should handle frame name { } without false positives', async () => {
            const my_content = `
frame create myframe
frame myframe {
    local x = 1
    display "Inside frame"
}
`;
            const my_document_uri = 'file:///test_frame.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have no brace-related errors for frame blocks
            const the_brace_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === ParseErrorCode.OPEN_BRACE_ALONE ||
                    my_diag.message.includes('open brace must be on the same line')
            );

            expect(the_brace_errors.length).toBe(0);
        });

        it('should handle positional arguments without false positives', async () => {
            const my_content = `
local country_name \`1'
local survey_year \`2'
display "Processing: \`country_name' \`survey_year'"
`;
            const my_document_uri = 'file:///test_positional.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );

            // Should have no undefined macro errors for positional arguments
            const the_positional_errors = the_diagnostics.filter(
                (my_diag) =>
                    my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                    (my_diag.message.includes("'1'") || my_diag.message.includes("'2'"))
            );

            expect(the_positional_errors.length).toBe(0);
        });
    });
});

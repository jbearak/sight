import { ContextTracker } from '../src/context-tracker';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';
import { SemanticAnalyzer } from '../src/analyzer';
import { DocumentState } from '../src/document-store';
import { undefined_symbol_data_fields } from '../src/utils/undefined-symbol-diagnostic';
import { DiagnosticSeverity } from 'vscode-languageserver';

/**
 * Helper to initialize a ContextTracker from source code.
 * Lexes the source and calls initialize_from_tokens().
 *
 * This replaces the removed initialize(string) method for tests.
 */
export function init_tracker_from_source(tracker: ContextTracker, source: string): void {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(source);
    tracker.initialize_from_tokens(lex_result.tokens, source);
}

/**
 * Build a DocumentState from real lexer/parser/analyzer output,
 * mirroring DocumentStore.build_diagnostics — including the structured
 * `data` payload (symbol_name/reference_kind/scope_isolation) the
 * diagnostics provider reads instead of parsing message prose.
 */
export function create_real_document_state(
    content: string,
    version: number = 1
): DocumentState {
    const my_lexer = new StataLexer();
    const my_parser = new StataParser();
    const my_analyzer = new SemanticAnalyzer();
    const my_context_tracker = new ContextTracker();

    const my_lex_result = my_lexer.tokenize(content);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);
    const my_analysis_result = my_analyzer.analyze(
        my_parse_result.ast,
        'file:///test.do',
        undefined,
        undefined,
        my_lex_result.tokens
    );

    my_context_tracker.initialize_from_tokens(my_lex_result.tokens, content);
    const my_context_ranges = my_context_tracker.get_all_context_ranges();

    const my_line_offsets: number[] = [0];
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '\n') {
            my_line_offsets.push(i + 1);
        }
    }

    const diagnostics = my_analysis_result.diagnostics.map(diag => ({
        range: diag.range,
        message: diag.message,
        severity: diag.severity === 'error' ? DiagnosticSeverity.Error
            : diag.severity === 'warning' ? DiagnosticSeverity.Warning
            : diag.severity === 'information' ? DiagnosticSeverity.Information
            : DiagnosticSeverity.Hint,
        code: diag.code,
        source: 'sight',
        ...undefined_symbol_data_fields(diag),
    }));

    return {
        uri: 'file:///test.do',
        version,
        content,
        tokens: my_lex_result.tokens,
        ast: my_parse_result.ast,
        symbols: my_analysis_result.symbols,
        scopes: my_analysis_result.scopes,
        diagnostics,
        context_ranges: my_context_ranges,
        context_tracker: my_context_tracker,
        line_offsets: my_line_offsets,
        forward_calls: my_analysis_result.forward_calls,
        token_line_index: new Map(),
        ignored_lines: my_analysis_result.ignored_lines,
    };
}

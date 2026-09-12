import { SemanticAnalyzer, type AnalysisResult } from '../analyzer';
import { DirectiveParser } from '../directive-parser';
import { StataLexer } from '../lexer';
import { StataParser } from '../parser';
import { type DirectiveParseResult, type Token } from '../types';

export interface SourceAnalysis {
    tokens: Token[];
    analysis: AnalysisResult;
    directives: DirectiveParseResult;
}

/**
 * Extract a closed file's symbols and source facts in one lexical pass.
 * Callers retain ownership of reads, working-directory resolution, caches,
 * and publication. Forward calls carry raw paths until callers project them
 * through the effective working directory and the file's cd commands.
 *
 * Each operation owns fresh processing instances and its AST. Semantic
 * analysis attaches program signatures to that AST, so sharing a parsed AST
 * across independently analyzed snapshots would share mutable state.
 */
export function analyze_source(content: string, uri: string): SourceAnalysis {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const directive_parser = new DirectiveParser();

    const lex_result = lexer.tokenize(content);
    const directive_result = directive_parser.parse(
        content,
        uri,
        lex_result.tokens,
    );
    const parse_result = parser.parse(lex_result.tokens);
    const analysis = analyzer.analyze(
        parse_result.ast,
        uri,
        undefined,
        undefined,
        lex_result.tokens,
    );

    return {
        tokens: lex_result.tokens,
        analysis,
        directives: directive_result,
    };
}

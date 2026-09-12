import * as path from 'path';
import { URI } from 'vscode-uri';
import { SemanticAnalyzer, type AnalysisResult } from '../analyzer';
import { DirectiveParser } from '../directive-parser';
import { StataLexer } from '../lexer';
import { StataParser } from '../parser';
import {
    type CdCommand,
    type DirectiveParseResult,
    type ForwardCall,
    type ForwardCallDirective,
    type Token,
} from '../types';
import {
    apply_cd_timeline,
    build_cd_timeline,
    type RichResolveFs,
} from '../utils/file-path-utils';

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

export interface ForwardCallPreparationOptions {
    uri: string;
    command_calls: ForwardCall[];
    directive_calls: ForwardCallDirective[];
    cd_commands: CdCommand[];
    working_directory?: string;
    workspace_roots: string[];
    fs?: RichResolveFs;
    /** Open-document parsing retains raw calls when projection fails. */
    recover_command_projection?: boolean;
}

/**
 * Apply source-position working directories to command calls and append
 * directive calls with the file-wide working directory. The result keeps
 * command calls before directive calls; consumers own any final sorting.
 * Input calls are unchanged. Directory diagnostics remain owned by the
 * forward resolver, which emits them once for the diagnosed file.
 *
 * Recovery covers command projection only. Open-document parsing uses it
 * to keep analyzer calls after a malformed URI or a path-resolution error,
 * while still including independently parsed directive calls. Closed-file
 * consumers retain their normal error handling by leaving recovery off.
 */
export function prepare_forward_calls(
    options: ForwardCallPreparationOptions,
): ForwardCall[] {
    let command_calls = options.command_calls;
    try {
        const caller_dir = path.dirname(URI.parse(options.uri).fsPath);
        const { timeline } = build_cd_timeline({
            starting_wd: options.working_directory,
            caller_dir,
            cd_commands: options.cd_commands,
            workspace_roots: options.workspace_roots,
            fs: options.fs,
        });
        command_calls = apply_cd_timeline(command_calls, timeline);
    } catch (error) {
        if (!options.recover_command_projection) {
            throw error;
        }
    }

    const directive_calls: ForwardCall[] = options.directive_calls.map(
        my_directive => ({
            type: my_directive.type,
            raw_path: my_directive.raw_path,
            call_site_line: my_directive.call_site_line,
            range: my_directive.range,
            source: 'directive',
            is_static: true,
            caller_uri: options.uri,
            working_directory: options.working_directory,
        }),
    );
    return [...command_calls, ...directive_calls];
}

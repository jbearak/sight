/**
 * Go-to-Definition Provider for Sight
 *
 * Provides navigation to macro definitions, program definitions, and included files.
 * Context-aware: maintains macro reference resolution across embedded language contexts
 * while avoiding resolution of embedded language symbols as Stata symbols.
 */

import {
    Definition,
    Location,
    Position,
    Range,
    CancellationToken,
} from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import {
    SymbolTable,
    StataNode,
    CommandNode,
    LanguageContext,
    ResolvedScope,
    MacroSymbol,
    Token,
} from '../types';

type MacroDefNodeLike = {
    type: 'macro_def';
    scope: 'local' | 'global';
    name: string;
    value: string;
    range: { start: Position; end: Position };
};
import { IContextTracker } from '../context-tracker/types';
import { ScopeResolver } from '../scope-resolver';
import { WorkspaceIndexer } from '../indexer';
import * as path from 'path';
import * as fs from 'fs';
// vscode-uri is a small standalone library for parsing file:// URIs.
// It does not require VS Code at runtime; it is safe for running the LSP standalone.
import { URI } from 'vscode-uri';
import { resolvePathWithDoFallback } from '../utils/file-path-utils';
import { get_line_text } from '../utils/line-utils';

/**
 * Definition Provider class.
 */
export class DefinitionProvider {
    /**
     * Get the definition location for a position in the document.
     *
     * @param document - The document state
     * @param position - The cursor position
     * @param workspace_symbols - Optional workspace-level symbols
     * @param context_tracker - Optional context tracker for embedded language awareness
     * @param scope_resolver - Optional scope resolver for cross-file awareness
     * @param workspace_indexer - Optional workspace indexer for cross-file search
     * @param cross_file_config - Optional cross-file config for scope resolution
     * @param cancellation_token - Optional cancellation token
     * @returns Definition location(s) or null
     */
    async get_definition(
        document: DocumentState,
        position: Position,
        workspace_symbols?: SymbolTable,
        context_tracker?: IContextTracker,
        scope_resolver?: ScopeResolver,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: { assume_call_site?: 'start' | 'end'; max_forward_depth?: number },
        cancellation_token?: CancellationToken
    ): Promise<Definition | null> {
        // Check if we're in an embedded language context
        if (context_tracker) {
            const my_context = context_tracker.get_context_at_position(position);
            
            // In embedded language context, only resolve macros, not programs
            if (my_context !== LanguageContext.STATA) {
                return await this.get_macro_definition_only(
                    document,
                    position,
                    workspace_symbols,
                    scope_resolver,
                    workspace_indexer,
                    cross_file_config,
                    cancellation_token
                );
            }
        }

        // Get the word at the cursor position
        const word_info = this.get_word_at_position(document, position);
        if (!word_info) {
            // Check if we're on a "do", "run", or "include" command line for file navigation
            return this.get_include_definition(document, position);
        }

        const { word } = word_info;

        // First check if this might be a file path in a command or directive
        const file_definition = this.get_include_definition(document, position);
        if (file_definition) {
            return file_definition;
        }

        // Try scope resolver first if available
        if (scope_resolver) {
            // Only pass config if assume_call_site is explicitly set to avoid
            // overriding the default with undefined
            const resolve_config = cross_file_config?.assume_call_site
                ? {
                    assume_call_site: cross_file_config.assume_call_site,
                    max_forward_depth: cross_file_config.max_forward_depth,
                }
                : { max_forward_depth: cross_file_config?.max_forward_depth };
            const resolved_scope = await scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );
            
            // Check local macros
            const local_macro = resolved_scope.symbols.localMacros.get(word);
            if (local_macro) {
                return {
                    uri: local_macro.location.uri,
                    range: local_macro.location.range,
                };
            }

            // Check global macros
            const global_macro = resolved_scope.symbols.globalMacros.get(word);
            if (global_macro) {
                return {
                    uri: global_macro.location.uri,
                    range: global_macro.location.range,
                };
            }

            // Check programs (case-sensitive)
            const program = resolved_scope.symbols.programs.get(word);
            if (program) {
                return {
                    uri: program.location.uri,
                    range: program.location.range,
                };
            }

            // Check scalars
            const scalar = resolved_scope.symbols.scalars.get(word);
            if (scalar) {
                return {
                    uri: scalar.location.uri,
                    range: scalar.location.range,
                };
            }

            // Check matrices
            const matrix = resolved_scope.symbols.matrices.get(word);
            if (matrix) {
                return {
                    uri: matrix.location.uri,
                    range: matrix.location.range,
                };
            }
        }

        const as_locations = (
            defs: Array<{ location: { uri: string; range: any } }>
        ): Definition => {
            if (defs.length === 1) {
                return { uri: defs[0].location.uri, range: defs[0].location.range };
            }
            return defs.map((def) => ({
                uri: def.location.uri,
                range: def.location.range,
            })) as Location[];
        };

        // Check document symbols first to ensure they have precedence over workspace symbols
        const reference_position = position;

        // 1. Check local macros (only when the reference looks like a local macro)
        const local_macro_def = this.find_nearest_macro_definition(
            document,
            word,
            'local',
            reference_position
        );
        if (local_macro_def) {
            return {
                uri: local_macro_def.location.uri,
                range: local_macro_def.location.range,
            };
        }

        // 2. Check global macros (only when the reference looks like a global macro)
        const global_macro_def = this.find_nearest_macro_definition(
            document,
            word,
            'global',
            reference_position
        );
        if (global_macro_def) {
            return {
                uri: global_macro_def.location.uri,
                range: global_macro_def.location.range,
            };
        }

        // 3. Check document symbols
        const local_macro = document.symbols.localMacros.get(word);
        if (local_macro) {
            return {
                uri: local_macro.location.uri,
                range: local_macro.location.range,
            };
        }

        const global_macro = document.symbols.globalMacros.get(word);
        if (global_macro) {
            return {
                uri: global_macro.location.uri,
                range: global_macro.location.range,
            };
        }

        const program = document.symbols.programs.get(word);
        if (program) {
            return {
                uri: program.location.uri,
                range: program.location.range,
            };
        }

        const scalar = (document.symbols as any).scalars?.get?.(word);
        if (scalar) {
            return {
                uri: scalar.location.uri,
                range: scalar.location.range,
            };
        }

        const matrix = (document.symbols as any).matrices?.get?.(word);
        if (matrix) {
            return {
                uri: matrix.location.uri,
                range: matrix.location.range,
            };
        }

        // If we have a workspace indexer, prefer returning ALL definitions when multiple exist.
        // This also avoids losing multiplicity due to merged workspace_symbols maps.
        if (workspace_indexer) {
            const local_defs = workspace_indexer.find_symbol_definitions(word, 'local');
            if (local_defs.length > 0) {
                return as_locations(local_defs as any);
            }

            const global_defs = workspace_indexer.find_symbol_definitions(word, 'global');
            if (global_defs.length > 0) {
                return as_locations(global_defs as any);
            }

            const program_defs = workspace_indexer.find_symbol_definitions(word, 'program');
            if (program_defs.length > 0) {
                return as_locations(program_defs as any);
            }

            const scalar_defs = workspace_indexer.find_symbol_definitions(word, 'scalar');
            if (scalar_defs.length > 0) {
                return as_locations(scalar_defs as any);
            }

            const matrix_defs = workspace_indexer.find_symbol_definitions(word, 'matrix');
            if (matrix_defs.length > 0) {
                return as_locations(matrix_defs as any);
            }

            const variable_defs = workspace_indexer.find_symbol_definitions(word, 'variable');
            if (variable_defs.length > 0) {
                return as_locations(variable_defs as any);
            }
        }

        // Fallback to workspace symbols if available
        if (workspace_symbols) {
            const global_macro_ws = workspace_symbols.globalMacros.get(word);
            if (global_macro_ws) {
                return {
                    uri: global_macro_ws.location.uri,
                    range: global_macro_ws.location.range,
                };
            }

            const program_ws = workspace_symbols.programs.get(word);
            if (program_ws) {
                return {
                    uri: program_ws.location.uri,
                    range: program_ws.location.range,
                };
            }

            const scalar_ws = workspace_symbols.scalars?.get(word);
            if (scalar_ws) {
                return {
                    uri: scalar_ws.location.uri,
                    range: scalar_ws.location.range,
                };
            }

            const matrix_ws = workspace_symbols.matrices?.get(word);
            if (matrix_ws) {
                return {
                    uri: matrix_ws.location.uri,
                    range: matrix_ws.location.range,
                };
            }
        }

        return null;
    }

    /**
     * Check if a position falls within a range.
     */
    private position_in_range(position: Position, range: Range): boolean {
        if (position.line < range.start.line || position.line > range.end.line) {
            return false;
        }
        if (position.line === range.start.line && position.character < range.start.character) {
            return false;
        }
        if (position.line === range.end.line && position.character >= range.end.character) {
            return false;
        }
        return true;
    }

    /**
     * Get the token at the given position from the document's token list.
     */
    private get_token_at_position(
        document: DocumentState,
        position: Position
    ): Token | null {
        if (!document.tokens) {
            return null;
        }
        
        for (const token of document.tokens) {
            if (this.position_in_range(position, token.range)) {
                return token;
            }
        }
        
        return null;
    }

    /**
     * Get macro definition only (used in embedded language contexts).
     * This resolves macro references but avoids resolving embedded language symbols.
     *
     * @param document - The document state
     * @param position - The cursor position
     * @param workspace_symbols - Optional workspace-level symbols
     * @param scope_resolver - Optional scope resolver for cross-file awareness
     * @param workspace_indexer - Optional workspace indexer for cross-file search
     * @param cross_file_config - Optional cross-file config for scope resolution
     * @param cancellation_token - Optional cancellation token
     * @returns Definition location for macros, or null
     */
    private async get_macro_definition_only(
        document: DocumentState,
        position: Position,
        workspace_symbols?: SymbolTable,
        scope_resolver?: ScopeResolver,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: { assume_call_site?: 'start' | 'end'; max_forward_depth?: number },
        cancellation_token?: CancellationToken
    ): Promise<Definition | null> {
        // Get the word at the cursor position
        const word_info = this.get_word_at_position(document, position);
        if (!word_info) {
            return null;
        }

        const { word } = word_info;

        // Try scope resolver first if available
        if (scope_resolver) {
            // Only pass config if assume_call_site is explicitly set to avoid
            // overriding the default with undefined
            const resolve_config = cross_file_config?.assume_call_site
                ? {
                    assume_call_site: cross_file_config.assume_call_site,
                    max_forward_depth: cross_file_config.max_forward_depth,
                }
                : { max_forward_depth: cross_file_config?.max_forward_depth };
            const resolved_scope = await scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );
            
            // Check local macros
            const local_macro = resolved_scope.symbols.localMacros.get(word);
            if (local_macro) {
                return {
                    uri: local_macro.location.uri,
                    range: local_macro.location.range,
                };
            }

            // Check global macros
            const global_macro = resolved_scope.symbols.globalMacros.get(word);
            if (global_macro) {
                return {
                    uri: global_macro.location.uri,
                    range: global_macro.location.range,
                };
            }
        }

        // Only check macros, not programs or other Stata symbols
        // 1. Check local macros
        const local_macro = document.symbols.localMacros.get(word);
        if (local_macro) {
            return {
                uri: local_macro.location.uri,
                range: local_macro.location.range,
            };
        }

        // 2. Check global macros
        const global_macro = document.symbols.globalMacros.get(word) || workspace_symbols?.globalMacros.get(word);
        if (global_macro) {
            return {
                uri: global_macro.location.uri,
                range: global_macro.location.range,
            };
        }

        // 3. Use workspace indexer for cross-file macro search
        if (workspace_indexer) {
            const local_definitions = workspace_indexer.find_symbol_definitions(word, 'local');
            const global_definitions = workspace_indexer.find_symbol_definitions(word, 'global');
            const all_definitions = [...local_definitions, ...global_definitions];
            
            if (all_definitions.length > 0) {
                if (all_definitions.length === 1) {
                    return {
                        uri: all_definitions[0].location.uri,
                        range: all_definitions[0].location.range,
                    };
                } else {
                    return all_definitions.map(def => ({
                        uri: def.location.uri,
                        range: def.location.range,
                    })) as Location[];
                }
            }
        }

        return null;
    }

    /**
     * Decide whether a reference at a position looks like a local/global macro.
     *
     * This avoids treating arbitrary identifiers as macros during fallback resolution.
     */
    private reference_looks_like_macro(
        document: DocumentState,
        position: Position,
        word_range_start_character: number,
        scope: 'local' | 'global'
    ): boolean {
        const line_text = get_line_text(document, position.line);

        // Look at characters immediately preceding the identifier.
        const prev1 = word_range_start_character > 0
            ? line_text[word_range_start_character - 1]
            : '';
        const prev2 = word_range_start_character > 1
            ? line_text[word_range_start_character - 2]
            : '';

        if (scope === 'local') {
            return prev1 === '`';
        }

        // global: $name or ${name}
        if (prev1 === '$') {
            return true;
        }
        if (prev1 === '{' && prev2 === '$') {
            return true;
        }

        return false;
    }

    /**
     * Find the nearest preceding macro definition for a name/scope using the AST.
     * When a macro is defined multiple times, this returns the definition that is
     * closest (latest) but still before (or at) the reference position.
     */
    private find_nearest_macro_definition(
        document: DocumentState,
        name: string,
        scope: 'local' | 'global',
        reference_position: Position
    ): MacroSymbol | null {
        if (!document.ast) {
            return null;
        }

        const word_info = this.get_word_at_position(document, reference_position);
        if (!word_info) {
            return null;
        }

        if (!this.reference_looks_like_macro(
            document,
            reference_position,
            word_info.range.start.character,
            scope
        )) {
            return null;
        }

        const is_before_or_equal = (a: Position, b: Position): boolean => {
            if (a.line !== b.line) {
                return a.line < b.line;
            }
            return a.character <= b.character;
        };

        let best_node: MacroDefNodeLike | null = null;

        // NOTE: Do this iteratively (not via a nested function) so TypeScript control-flow
        // analysis can see that best_node may be assigned.
        const the_stack: any[] = [...document.ast.nodes];
        while (the_stack.length > 0) {
            const node = the_stack.pop();
            if (!node || typeof node !== 'object') {
                continue;
            }

            if (node.type === 'macro_def') {
                const macro_def = node as unknown as MacroDefNodeLike;
                if (macro_def.scope === scope && macro_def.name === name) {
                    if (is_before_or_equal(macro_def.range.start, reference_position)) {
                        if (!best_node) {
                            best_node = macro_def;
                        } else {
                            const best_pos = best_node.range.start;
                            const cand_pos = macro_def.range.start;
                            if (is_before_or_equal(best_pos, cand_pos)) {
                                best_node = macro_def;
                            }
                        }
                    }
                }
            }

            // Push child nodes (depth-first)
            if (node.type === 'program' ||
                node.type === 'if' ||
                node.type === 'else' ||
                node.type === 'foreach' ||
                node.type === 'forvalues' ||
                node.type === 'while' ||
                node.type === 'frame') {
                const body = (node as any).body;
                if (Array.isArray(body)) {
                    for (let i = 0; i < body.length; i++) {
                        the_stack.push(body[i]);
                    }
                }
            }
        }

        const best_macro_def = best_node;
        if (!best_macro_def) {
            return null;
        }

        return {
            name: best_macro_def.name,
            scope: best_macro_def.scope,
            location: { uri: document.uri, range: best_macro_def.range },
            sourceUri: document.uri,
            value: best_macro_def.value,
        };
    }

    /**
     * Get the word at the given position.
     */
    private get_word_at_position(
        document: DocumentState,
        position: Position
    ): { word: string; range: { start: Position; end: Position } } | null {
        const line = get_line_text(document, position.line);
        // get_line_text returns '' for non-existent lines AND for empty lines.
        // To distinguish, check if line_offsets exist and position.line is valid,
        // or fall back to checking if the line start offset is beyond content length.
        if (document.line_offsets) {
            if (position.line >= document.line_offsets.length) return null;
        } else {
            // Fallback: if line is empty and position.line > 0, verify line exists
            // by checking if we can find enough newlines in the content
            if (line === '' && position.line > 0) {
                let newline_count = 0;
                for (let i = 0; i < document.content.length; i++) {
                    if (document.content[i] === '\n') {
                        newline_count++;
                    }
                }
                // Number of lines = newline_count + 1 (last line may not end with \n)
                if (position.line > newline_count) return null;
            }
        }
        const character = position.character;

        // Find the start of the word
        let start = character;
        while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) {
            start--;
        }

        // Find the end of the word
        let end = character;
        while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) {
            end++;
        }

        if (start === end) return null;

        const word = line.substring(start, end);
        return {
            word,
            range: {
                start: { line: position.line, character: start },
                end: { line: position.line, character: end },
            },
        };
    }

    /**
     * Handle navigation for "do", "run", "include" commands and @lsp-* directives.
     */
    private get_include_definition(document: DocumentState, position: Position): Definition | null {
        const line_text = get_line_text(document, position.line);

        // Check for do/run/include commands
        const include_match = line_text.match(/^\s*(do|run|include)\s+["']?([^"'\s]+)["']?/i);
        if (include_match) {
            const file_path = include_match[2];
            const resolved_path = this.resolve_file_path(document.uri, file_path);
            if (resolved_path) {
                return {
                    uri: URI.file(resolved_path).toString(),
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 },
                    },
                };
            }
        }

        // Check for @lsp-* directives
        const directive_match = line_text.match(/@lsp-(done-by|included-by|do|run|include):?\s+(?:"([^"]+)"|([^\s]+))/);
        if (directive_match) {
            const quoted_path = directive_match[2];
            const unquoted_path = directive_match[3];
            const file_path = quoted_path || unquoted_path;
            const resolved_path = this.resolve_file_path(document.uri, file_path);
            if (resolved_path) {
                return {
                    uri: URI.file(resolved_path).toString(),
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 },
                    },
                };
            }
        }

        return null;
    }

    /**
     * Check if the position is within an extended macro function context
     * where bare identifiers should be treated as macro references.
     * 
     * @param document - The document state
     * @param position - The cursor position
     * @returns true if in extended macro function context
     */
    private is_in_extended_macro_context(
        document: DocumentState,
        position: Position
    ): boolean {
        const line_text = get_line_text(document, position.line);
        const text_before_cursor = line_text.substring(0, position.character + 1);
        
        // Pattern: local/global macname : list_function ...
        const extended_macro_pattern = /^\s*(local|global)\s+\w+\s*:\s*(list)\s+/i;
        return extended_macro_pattern.test(text_before_cursor);
    }

    /**
     * Resolve file path with .do fallback, relative to current file.
     */
    private resolve_file_path(current_uri: string, file_path: string): string | null {
        const current_path = URI.parse(current_uri).fsPath;
        const current_dir = path.dirname(current_path);
        const resolved_path = path.resolve(current_dir, file_path);
        
        return resolvePathWithDoFallback(resolved_path, fs);
    }
}

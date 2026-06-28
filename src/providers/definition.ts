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
    LanguageContext,
    ResolvedScope,
    MacroSymbol,
    Token,
    ProgramSymbol,
    VariableSymbol,
    ScalarSymbol,
    MatrixSymbol,
    ScopeResolverConfig,
} from '../types';


/** Symbol with a location, as returned by WorkspaceIndexer.find_symbol_definitions */
type LocatableSymbol = ProgramSymbol | MacroSymbol | VariableSymbol | ScalarSymbol | MatrixSymbol;

type MacroDefNodeLike = {
    type: 'macro_def';
    scope: 'local' | 'global';
    name: string;
    value: string;
    range: { start: Position; end: Position };
};
import { IContextTracker } from '../context-tracker/types';
import { ScopeResolver, build_scope_resolver_config, get_visible_symbols_at } from '../scope-resolver';
import { WorkspaceIndexer } from '../indexer';
import * as path from 'path';
// vscode-uri is a small standalone library for parsing file:// URIs.
// It does not require VS Code at runtime; it is safe for running the LSP standalone.
import { URI } from 'vscode-uri';
import { resolve_path_rich } from '../utils/file-path-utils';
import { get_line_text } from '../utils/line-utils';
import { is_cursor_in_comment } from '../utils/comment-utils';
import {
    BACKWARD_DIRECTIVE_KEYWORDS,
    FORWARD_DIRECTIVE_KEYWORDS,
    DIRECTIVE_PREFIX_PATTERN,
} from '../utils/directives';

/**
 * Definition Provider class.
 */
export class DefinitionProvider {
    /** Workspace roots set by the server, used for cross-directory resolution. */
    private workspace_roots: string[] = [];

    /**
     * Update the workspace roots used by resolve_file_path.
     *
     * Must be called whenever the LSP workspace folders change so that
     * cross-directory `do`/`run`/`include` targets that live outside the
     * current document's directory are still case-only resolved correctly.
     */
    set_workspace_roots(roots: string[]): void {
        this.workspace_roots = roots;
    }

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
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken
    ): Promise<Definition | null> {
        // Check cancellation before starting (Req 5.2)
        if (cancellation_token?.isCancellationRequested) {
            return null;
        }

        // File-path / directive resolution runs first so cross-file directives
        // like `@lsp-done-by` and `do "..."` work from every context — including
        // inside embedded-language blocks and inside comments.
        const file_definition = this.get_include_definition(document, position);
        if (file_definition) {
            return file_definition;
        }

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
            return null;
        }

        const { word } = word_info;

        // Suppress symbol definitions inside comments (star, //, ///, and /* */).
        // File-path / directive navigation above is unaffected.
        if (is_cursor_in_comment(document, position)) {
            return null;
        }

        // Get token at position for disambiguation
        const the_token = this.get_token_at_position(document, position, cancellation_token);
        
        // Token-based disambiguation
        if (the_token) {
            if (the_token.type === 'MACRO_REF_LOCAL') {
                return await this.resolve_local_macro_only(
                    word,
                    document,
                    scope_resolver,
                    workspace_indexer,
                    cross_file_config,
                    cancellation_token,
                    position
                );
            }
            
            if (the_token.type === 'MACRO_REF_GLOBAL') {
                return await this.resolve_global_macro_only(
                    word,
                    document,
                    position,
                    workspace_symbols,
                    scope_resolver,
                    workspace_indexer,
                    cross_file_config,
                    cancellation_token
                );
            }
            
            if (the_token.type === 'WORD') {
                // Check if in extended macro context
                if (this.is_in_extended_macro_context(document, position)) {
                    return await this.resolve_local_macro_only(
                        word,
                        document,
                        scope_resolver,
                        workspace_indexer,
                        cross_file_config,
                        cancellation_token,
                        position
                    );
                }

                // Cursor on a macro's declaration name tokenizes as WORD. Try
                // that first — it only returns non-null when the position is
                // inside a macro declaration range, so same-named variables
                // (Stata allows cross-namespace collisions) don't win here.
                const macro_declaration = this.resolve_word_as_macro_declaration(word, position, document);
                if (macro_declaration) {
                    return macro_declaration;
                }

                // WORD token: search variables, programs, scalars, matrices (NOT macros)
                return await this.resolve_non_macro_symbols(
                    word,
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

        // Fallback to existing heuristics when token lookup fails
        return await this.resolve_with_heuristics(
            word,
            word_info,
            document,
            position,
            workspace_symbols,
            scope_resolver,
            workspace_indexer,
            cross_file_config,
            cancellation_token
        );
    }

    /**
     * Resolve local macro only (for MACRO_REF_LOCAL tokens and extended macro context).
     */
    private async resolve_local_macro_only(
        word: string,
        document: DocumentState,
        scope_resolver?: ScopeResolver,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken,
        position?: Position
    ): Promise<Definition | null> {
        // Try scope resolver first
        if (scope_resolver) {
            const resolve_config = build_scope_resolver_config(cross_file_config);
            const resolved_scope = await scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );

            const local_locs = this.collect_local_macro_scope_locations(
                resolved_scope,
                word,
                position,
                document.uri
            );
            if (local_locs.length > 0) {
                return this.locations_to_definition(local_locs);
            }
        }

        // Check document symbols
        const local_macro = document.symbols.localMacros.get(word);

        // Collect workspace-indexer cross-file definitions for the same
        // name regardless of whether the current file defines it too, so
        // that cross-file redeclarations are surfaced.
        const cross_file_locs = this.collect_workspace_definition_locations(
            document.uri,
            word,
            'local',
            workspace_indexer,
            { include_only: true }
        );

        if (local_macro) {
            const out: Location[] = this.macro_symbol_to_locations(local_macro);
            out.push(...cross_file_locs);
            return this.locations_to_definition(this.dedupe_locations(out));
        }

        if (cross_file_locs.length > 0) {
            return this.locations_to_definition(
                this.dedupe_locations(cross_file_locs)
            );
        }

        return null;
    }

    /**
     * Resolve global macro only (for MACRO_REF_GLOBAL tokens).
     */
    private async resolve_global_macro_only(
        word: string,
        document: DocumentState,
        position: Position,
        workspace_symbols?: SymbolTable,
        scope_resolver?: ScopeResolver,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken
    ): Promise<Definition | null> {
        // Try scope resolver first
        if (scope_resolver) {
            const resolve_config = build_scope_resolver_config(cross_file_config);
            const resolved_scope = await scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );

            const visible = get_visible_symbols_at(
                resolved_scope,
                position.line
            );
            const global_macro = visible.globalMacros.get(word);
            if (global_macro) {
                // Walk chain and forward call sites (do/run/include all
                // propagate globals) to collect cross-file redeclarations.
                const out: Location[] =
                    this.macro_symbol_to_locations(global_macro);
                for (const my_entry of resolved_scope.chain) {
                    const my_chain_macro =
                        my_entry.symbols.globalMacros.get(word);
                    if (my_chain_macro) {
                        out.push(
                            ...this.macro_symbol_to_locations(my_chain_macro)
                        );
                    }
                }
                for (const my_site of
                        resolved_scope.forward_call_symbols ?? []) {
                    // Globals propagate through all call types (do/run/include)
                    const my_forward_global =
                        my_site.symbols.globalMacros.get(word);
                    if (my_forward_global) {
                        out.push(
                            ...this.macro_symbol_to_locations(my_forward_global)
                        );
                    }
                }
                out.push(
                    ...this.collect_related_definition_locations(
                        document.uri,
                        word,
                        'global',
                        workspace_indexer
                    )
                );
                return this.locations_to_definition(
                    this.dedupe_locations(out)
                );
            }
        }

        // Check document symbols
        const global_macro = document.symbols.globalMacros.get(word);

        // Collect workspace-indexer cross-file definitions for the same name.
        const cross_file_locs = this.collect_workspace_definition_locations(
            document.uri,
            word,
            'global',
            workspace_indexer
        );

        if (global_macro) {
            const out: Location[] =
                this.macro_symbol_to_locations(global_macro);
            out.push(...cross_file_locs);
            return this.locations_to_definition(this.dedupe_locations(out));
        }

        if (cross_file_locs.length > 0) {
            return this.locations_to_definition(
                this.dedupe_locations(cross_file_locs)
            );
        }

        // Workspace-symbols fallback is only consulted when no
        // workspace_indexer was supplied. Rule 2 (issue #135) says
        // disjoint branches stay distinct, so when we DO have a
        // dep-graph-aware indexer and it returned no reachable hits,
        // we return null to let the undefined-global diagnostic stand
        // rather than shadowing it with an arbitrary merge winner.
        // Unit tests that pass workspace_symbols without an indexer
        // still resolve via this branch, matching their pre-#135
        // contract.
        if (!workspace_indexer && workspace_symbols) {
            const global_macro_ws = workspace_symbols.globalMacros.get(word);
            if (global_macro_ws) {
                return this.locations_to_definition(
                    this.macro_symbol_to_locations(global_macro_ws),
                );
            }
        }

        return null;
    }

    /**
     * Resolve non-macro symbols (for WORD tokens in regular context).
     * Searches variables, programs, scalars, matrices - NOT macros.
     * Priority: variables → programs → scalars → matrices
     */
    private async resolve_non_macro_symbols(
        word: string,
        document: DocumentState,
        position: Position,
        workspace_symbols?: SymbolTable,
        scope_resolver?: ScopeResolver,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken
    ): Promise<Definition | null> {
        // Try scope resolver first
        if (scope_resolver) {
            const resolve_config = build_scope_resolver_config(cross_file_config);
            const resolved_scope = await scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );
            const visible = get_visible_symbols_at(resolved_scope, position.line);

            // Priority: variable → program → scalar → matrix (matches pre-fix order).
            // Variables pool reachable redeclarations across the dep graph so
            // go-to-def surfaces every chain-visible `gen` (issue #135 Rule 1).
            // Without the chain walk the call would return only the merge
            // winner — e.g., a test-harness parent that directly defines the
            // variable would shadow the production chain's real definition.
            const variable = visible.variables.get(word);
            if (variable) {
                const out: Location[] = this.symbol_to_locations(variable);
                for (const my_entry of resolved_scope.chain) {
                    const my_chain_variable =
                        my_entry.symbols.variables.get(word);
                    if (my_chain_variable) {
                        out.push(
                            ...this.symbol_to_locations(my_chain_variable)
                        );
                    }
                }
                for (const my_site of
                        resolved_scope.forward_call_symbols ?? []) {
                    const my_forward_variable =
                        my_site.symbols.variables.get(word);
                    if (my_forward_variable) {
                        out.push(
                            ...this.symbol_to_locations(my_forward_variable)
                        );
                    }
                }
                out.push(
                    ...this.collect_related_definition_locations(
                        document.uri,
                        word,
                        'variable',
                        workspace_indexer
                    )
                );
                return this.locations_to_definition(
                    this.dedupe_locations(out)
                );
            }

            const program = visible.programs.get(word);
            if (program) {
                // Walk chain and forward call sites for cross-file
                // redeclarations (do/run/include all propagate programs).
                const out: Location[] = this.symbol_to_locations(program);
                for (const my_entry of resolved_scope.chain) {
                    const my_chain_prog =
                        my_entry.symbols.programs.get(word);
                    if (my_chain_prog) {
                        out.push(
                            ...this.symbol_to_locations(my_chain_prog)
                        );
                    }
                }
                for (const my_site of
                        resolved_scope.forward_call_symbols ?? []) {
                    const my_forward_prog =
                        my_site.symbols.programs.get(word);
                    if (my_forward_prog) {
                        out.push(
                            ...this.symbol_to_locations(my_forward_prog)
                        );
                    }
                }
                out.push(
                    ...this.collect_related_definition_locations(
                        document.uri,
                        word,
                        'program',
                        workspace_indexer
                    )
                );
                return this.locations_to_definition(
                    this.dedupe_locations(out)
                );
            }

            const scalar = visible.scalars.get(word);
            if (scalar) {
                const out: Location[] = this.symbol_to_locations(scalar);
                for (const my_entry of resolved_scope.chain) {
                    const my_chain_scalar =
                        my_entry.symbols.scalars.get(word);
                    if (my_chain_scalar) {
                        out.push(
                            ...this.symbol_to_locations(my_chain_scalar)
                        );
                    }
                }
                for (const my_site of
                        resolved_scope.forward_call_symbols ?? []) {
                    const my_forward_scalar =
                        my_site.symbols.scalars.get(word);
                    if (my_forward_scalar) {
                        out.push(
                            ...this.symbol_to_locations(my_forward_scalar)
                        );
                    }
                }
                out.push(
                    ...this.collect_related_definition_locations(
                        document.uri,
                        word,
                        'scalar',
                        workspace_indexer
                    )
                );
                return this.locations_to_definition(
                    this.dedupe_locations(out)
                );
            }

            const matrix = visible.matrices.get(word);
            if (matrix) {
                const out: Location[] = this.symbol_to_locations(matrix);
                for (const my_entry of resolved_scope.chain) {
                    const my_chain_matrix =
                        my_entry.symbols.matrices.get(word);
                    if (my_chain_matrix) {
                        out.push(
                            ...this.symbol_to_locations(my_chain_matrix)
                        );
                    }
                }
                for (const my_site of
                        resolved_scope.forward_call_symbols ?? []) {
                    const my_forward_matrix =
                        my_site.symbols.matrices.get(word);
                    if (my_forward_matrix) {
                        out.push(
                            ...this.symbol_to_locations(my_forward_matrix)
                        );
                    }
                }
                out.push(
                    ...this.collect_related_definition_locations(
                        document.uri,
                        word,
                        'matrix',
                        workspace_indexer
                    )
                );
                return this.locations_to_definition(
                    this.dedupe_locations(out)
                );
            }
        }

        // Check document symbols
        const variable = document.symbols.variables.get(word);
        if (variable) {
            return {
                uri: variable.location.uri,
                range: variable.location.range,
            };
        }

        const program = document.symbols.programs.get(word);
        const scalar = document.symbols.scalars?.get(word);
        const matrix = document.symbols.matrices?.get(word);

        // For programs/scalars/matrices, also collect cross-file workspace-
        // indexer definitions so that cross-file redeclarations are surfaced.
        // Variables are intentionally left workspace-wide via as_locations.
        if (program) {
            const out: Location[] = this.symbol_to_locations(program);
            out.push(...this.collect_workspace_definition_locations(
                document.uri,
                word,
                'program',
                workspace_indexer
            ));
            return this.locations_to_definition(this.dedupe_locations(out));
        }

        if (scalar) {
            const out: Location[] = this.symbol_to_locations(scalar);
            out.push(...this.collect_workspace_definition_locations(
                document.uri,
                word,
                'scalar',
                workspace_indexer
            ));
            return this.locations_to_definition(this.dedupe_locations(out));
        }

        if (matrix) {
            const out: Location[] = this.symbol_to_locations(matrix);
            out.push(...this.collect_workspace_definition_locations(
                document.uri,
                word,
                'matrix',
                workspace_indexer
            ));
            return this.locations_to_definition(this.dedupe_locations(out));
        }

        // Check workspace indexer (fallback when not in document symbols)
        if (workspace_indexer) {
            const variable_defs =
                workspace_indexer.find_symbol_definitions(word, 'variable');
            if (variable_defs.length > 0) {
                return this.as_locations(variable_defs);
            }

            const program_defs = this.collect_workspace_definition_locations(
                document.uri,
                word,
                'program',
                workspace_indexer,
                { include_current_uri: true }
            );
            if (program_defs.length > 0) {
                return this.locations_to_definition(
                    this.dedupe_locations(program_defs)
                );
            }

            const scalar_defs = this.collect_workspace_definition_locations(
                document.uri,
                word,
                'scalar',
                workspace_indexer,
                { include_current_uri: true }
            );
            if (scalar_defs.length > 0) {
                return this.locations_to_definition(
                    this.dedupe_locations(scalar_defs)
                );
            }

            const matrix_defs = this.collect_workspace_definition_locations(
                document.uri,
                word,
                'matrix',
                workspace_indexer,
                { include_current_uri: true }
            );
            if (matrix_defs.length > 0) {
                return this.locations_to_definition(
                    this.dedupe_locations(matrix_defs)
                );
            }
        }

        // Variables keep a workspace-wide fallback (issue #135 Rule 3:
        // dataset columns like `id`, `year` are legitimately shared
        // across unrelated analyses). Programs, scalars, and matrices
        // fall back to workspace_symbols ONLY when no workspace_indexer
        // was supplied — Rule 2 says disjoint branches stay distinct,
        // so when the indexer is available and returned no reachable
        // hits, returning an arbitrary merge winner would shadow the
        // undefined diagnostic without representing a same-identity
        // target. Unit tests that pass workspace_symbols without an
        // indexer still resolve via this branch, preserving their
        // pre-#135 contract.
        if (workspace_symbols) {
            const variable_ws = workspace_symbols.variables.get(word);
            if (variable_ws) {
                return {
                    uri: variable_ws.location.uri,
                    range: variable_ws.location.range,
                };
            }

            if (!workspace_indexer) {
                const program_ws = workspace_symbols.programs.get(word);
                if (program_ws) {
                    return this.locations_to_definition(
                        this.symbol_to_locations(program_ws),
                    );
                }

                const scalar_ws = workspace_symbols.scalars?.get(word);
                if (scalar_ws) {
                    return this.locations_to_definition(
                        this.symbol_to_locations(scalar_ws),
                    );
                }

                const matrix_ws = workspace_symbols.matrices?.get(word);
                if (matrix_ws) {
                    return this.locations_to_definition(
                        this.symbol_to_locations(matrix_ws),
                    );
                }
            }
        }

        return null;
    }

    /**
     * Fallback to existing heuristics when token lookup fails.
     */
    private async resolve_with_heuristics(
        word: string,
        word_info: { word: string; range: { start: Position; end: Position } },
        document: DocumentState,
        position: Position,
        workspace_symbols?: SymbolTable,
        scope_resolver?: ScopeResolver,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken
    ): Promise<Definition | null> {
        // Use existing helper to determine if reference looks like a macro
        const looks_like_local_macro = this.reference_looks_like_macro(
            document,
            position,
            word_info.range.start.character,
            'local'
        );
        const looks_like_global_macro = this.reference_looks_like_macro(
            document,
            position,
            word_info.range.start.character,
            'global'
        );
        
        // If reference looks like local macro, resolve local macro only
        if (looks_like_local_macro) {
            return await this.resolve_local_macro_only(
                word,
                document,
                scope_resolver,
                workspace_indexer,
                cross_file_config,
                cancellation_token,
                position
            );
        }
        
        // If reference looks like global macro, resolve global macro only
        if (looks_like_global_macro) {
            return await this.resolve_global_macro_only(
                word,
                document,
                position,
                workspace_symbols,
                scope_resolver,
                workspace_indexer,
                cross_file_config,
                cancellation_token
            );
        }
        
        // Cursor on a macro's declaration name tokenizes as WORD. Try that
        // first — it only returns non-null when the position is inside a
        // macro declaration range, so same-named variables (Stata allows
        // cross-namespace collisions) don't win here. Matches the WORD-token
        // path above.
        const macro_declaration = this.resolve_word_as_macro_declaration(word, position, document);
        if (macro_declaration) {
            return macro_declaration;
        }

        // Otherwise, treat as WORD: resolve variables/programs/scalars/matrices (NOT macros)
        return await this.resolve_non_macro_symbols(
            word,
            document,
            position,
            workspace_symbols,
            scope_resolver,
            workspace_indexer,
            cross_file_config,
            cancellation_token
        );
    }

    /**
     * Return the macro's own definition location when the cursor sits on a
     * macro's declaration name (a WORD token, not `$name`/`` `name' ``).
     * Returns null when the cursor is not within any macro declaration range.
     */
    private resolve_word_as_macro_declaration(
        word: string,
        position: Position,
        document: DocumentState
    ): Definition | null {
        const global_macro = document.symbols.globalMacros.get(word);
        if (
            global_macro
            && this.position_hits_symbol_definition(position, global_macro)
        ) {
            return this.locations_to_definition(
                this.macro_symbol_to_locations(global_macro)
            );
        }
        const local_macro = document.symbols.localMacros.get(word);
        if (
            local_macro
            && this.position_hits_symbol_definition(position, local_macro)
        ) {
            return this.locations_to_definition(
                this.macro_symbol_to_locations(local_macro)
            );
        }
        return null;
    }

    /**
     * Deduplicate a list of locations by URI + range coordinates.
     * Preserves order of first occurrence.
     */
    private dedupe_locations(the_locs: Location[]): Location[] {
        const seen_keys = new Set<string>();
        const out: Location[] = [];
        for (const my_loc of the_locs) {
            const my_key = `${my_loc.uri}:${my_loc.range.start.line}:${my_loc.range.start.character}:${my_loc.range.end.line}:${my_loc.range.end.character}`;
            if (seen_keys.has(my_key)) continue;
            seen_keys.add(my_key);
            out.push(my_loc);
        }
        return out;
    }

    /**
     * Convert symbol definitions to LSP Definition format.
     */
    private as_locations(defs: LocatableSymbol[]): Definition {
        if (defs.length === 1) {
            return { uri: defs[0].location.uri, range: defs[0].location.range };
        }
        return defs.map((def) => ({
            uri: def.location.uri,
            range: def.location.range,
        }));
    }

    private get_earliest_definition_line(locs: Location[]): number | undefined {
        if (locs.length === 0) {
            return undefined;
        }
        let earliest_line = locs[0].range.start.line;
        for (const my_loc of locs) {
            if (my_loc.range.start.line < earliest_line) {
                earliest_line = my_loc.range.start.line;
            }
        }
        return earliest_line;
    }

    private is_positional_macro_name(word: string): boolean {
        return /^\d+$/.test(word);
    }

    private position_hits_symbol_definition(
        position: Position,
        symbol: {
            location: { range: Range };
            additional_definitions?: Array<{
                location: { range: Range };
            }>;
        }
    ): boolean {
        if (this.position_in_range(position, symbol.location.range)) {
            return true;
        }
        for (const my_extra of symbol.additional_definitions ?? []) {
            if (this.position_in_range(position, my_extra.location.range)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Collect all definition locations for a non-macro symbol (program,
     * scalar, matrix), including any additional redeclarations stored in
     * `additional_definitions`.
     */
    private symbol_to_locations(symbol: {
        location: { uri: string; range: Range };
        additional_definitions?: Array<{
            location: { uri: string; range: Range };
        }>;
    }): Location[] {
        const out: Location[] = [
            { uri: symbol.location.uri, range: symbol.location.range },
        ];
        if (symbol.additional_definitions) {
            for (const my_extra of symbol.additional_definitions) {
                out.push({
                    uri: my_extra.location.uri,
                    range: my_extra.location.range,
                });
            }
        }
        return out;
    }

    /**
     * Collect all definition locations for a MacroSymbol, including any
     * additional redeclarations stored in `additional_definitions`.
     */
    private macro_symbol_to_locations(symbol: MacroSymbol): Location[] {
        const out: Location[] = [
            { uri: symbol.location.uri, range: symbol.location.range },
        ];
        if (symbol.additional_definitions) {
            for (const my_extra of symbol.additional_definitions) {
                out.push({
                    uri: my_extra.location.uri,
                    range: my_extra.location.range,
                });
            }
        }
        return out;
    }

    /**
     * Collect local-macro definitions visible through the resolved scope at
     * the cursor position. Unlike globals/programs, locals only propagate
     * through backward include chains and forward includes that have already
     * executed.
     */
    private collect_local_macro_scope_locations(
        resolved_scope: ResolvedScope,
        word: string,
        position?: Position,
        document_uri?: string
    ): Location[] {
        const out: Location[] = [];
        const should_include_candidate = (macro_symbol: MacroSymbol): boolean => {
            if (!position || this.is_positional_macro_name(word)) {
                return true;
            }
            const my_locations = this.macro_symbol_to_locations(macro_symbol);
            const same_file_locs = document_uri
                ? my_locations.filter(l => l.uri === document_uri)
                : my_locations;
            if (same_file_locs.length === 0) return true;
            const my_earliest_line =
                this.get_earliest_definition_line(same_file_locs);
            return my_earliest_line === undefined
                || my_earliest_line <= position.line;
        };
        const push_candidate = (macro_symbol: MacroSymbol | undefined): void => {
            if (!macro_symbol || !should_include_candidate(macro_symbol)) {
                return;
            }
            out.push(...this.macro_symbol_to_locations(macro_symbol));
        };

        push_candidate(resolved_scope.symbols.localMacros.get(word));
        for (const my_entry of resolved_scope.chain) {
            push_candidate(my_entry.symbols.localMacros.get(word));
        }

        for (const my_site of resolved_scope.forward_call_symbols ?? []) {
            if (position && position.line <= my_site.call_line) continue;
            if (my_site.effective_type !== 'include') continue;
            const my_forward_local =
                my_site.symbols.localMacros.get(word);
            if (my_forward_local) {
                out.push(
                    ...this.macro_symbol_to_locations(my_forward_local)
                );
            }
        }

        return this.dedupe_locations(out);
    }

    /**
     * Collect same-name definitions from the dep-graph-connected workspace
     * subset. This keeps go-to-definition aligned with the identity model
     * without pulling in disjoint branches.
     */
    private collect_related_definition_locations(
        document_uri: string,
        word: string,
        symbol_type:
            | 'program'
            | 'local'
            | 'global'
            | 'variable'
            | 'scalar'
            | 'matrix',
        workspace_indexer?: WorkspaceIndexer,
        include_only?: boolean
    ): Location[] {
        if (!workspace_indexer) return [];

        const related_uris = workspace_indexer.get_related_uris(
            document_uri,
            include_only ? { include_only: true } : undefined
        );
        const out: Location[] = [];
        for (const my_def of workspace_indexer.find_symbol_definitions(
            word,
            symbol_type
        )) {
            if (my_def.sourceUri === document_uri) continue;
            if (!related_uris.has(my_def.sourceUri)) continue;
            out.push(...this.symbol_to_locations(my_def));
        }
        return out;
    }

    /**
     * Collect workspace-indexed definitions while respecting the reachable
     * dep-graph subset when available. Used by fallback paths that do not
     * have a ScopeResolver but still have a WorkspaceIndexer.
     */
    private collect_workspace_definition_locations(
        document_uri: string,
        word: string,
        symbol_type:
            | 'program'
            | 'local'
            | 'global'
            | 'variable'
            | 'scalar'
            | 'matrix',
        workspace_indexer?: WorkspaceIndexer,
        options?: {
            include_only?: boolean;
            include_current_uri?: boolean;
        }
    ): Location[] {
        if (!workspace_indexer) return [];

        const related_uris = workspace_indexer.get_related_uris(
            document_uri,
            options?.include_only ? { include_only: true } : undefined
        );
        const out: Location[] = [];
        for (const my_def of workspace_indexer.find_symbol_definitions(
            word,
            symbol_type
        )) {
            if (
                my_def.sourceUri === document_uri &&
                !options?.include_current_uri
            ) {
                continue;
            }
            if (!related_uris.has(my_def.sourceUri)) continue;
            out.push(...this.symbol_to_locations(my_def));
        }
        return out;
    }

    /**
     * Convert a list of locations to a LSP Definition return value.
     * Returns null for empty, a single Location for one, or Location[] for
     * multiple (prompts VS Code's chooser UI).
     */
    private locations_to_definition(locs: Location[]): Definition | null {
        if (locs.length === 0) return null;
        if (locs.length === 1) return locs[0];
        return locs;
    }
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
        position: Position,
        cancellation_token?: CancellationToken
    ): Token | null {
        if (cancellation_token?.isCancellationRequested) {
            return null;
        }
        // Use line-bucketed index for O(1) line lookup when
        // available; fall back to linear scan otherwise
        if (document.token_line_index?.size > 0) {
            const bucket = document.token_line_index.get(
                position.line
            );
            if (!bucket) return null;
            for (const my_token of bucket) {
                if (this.position_in_range(
                    position, my_token.range
                )) {
                    return my_token;
                }
            }
            return null;
        }
        if (!document.tokens) return null;
        for (const my_token of document.tokens) {
            if (this.position_in_range(
                position, my_token.range
            )) {
                return my_token;
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
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken
    ): Promise<Definition | null> {
        // Suppress definition inside comments that appear in embedded-language
        // contexts. Directive navigation doesn't apply here, so it is safe to
        // check before word extraction.
        if (is_cursor_in_comment(document, position)) {
            return null;
        }

        // Get the word at the cursor position
        const word_info = this.get_word_at_position(document, position);
        if (!word_info) {
            return null;
        }

        const { word } = word_info;

        // Try scope resolver first if available
        if (scope_resolver) {
            const resolve_config = build_scope_resolver_config(cross_file_config);
            const resolved_scope = await scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );

            const local_locs = this.collect_local_macro_scope_locations(
                resolved_scope,
                word,
                position,
                document.uri
            );
            if (local_locs.length > 0) {
                return this.locations_to_definition(local_locs);
            }

            // Check global macros — do/run/include all propagate globals
            const global_macro = resolved_scope.symbols.globalMacros.get(word);
            if (global_macro) {
                const out: Location[] =
                    this.macro_symbol_to_locations(global_macro);
                for (const my_entry of resolved_scope.chain) {
                    const my_chain_macro =
                        my_entry.symbols.globalMacros.get(word);
                    if (my_chain_macro) {
                        out.push(
                            ...this.macro_symbol_to_locations(my_chain_macro)
                        );
                    }
                }
                for (const my_site of
                        resolved_scope.forward_call_symbols ?? []) {
                    const my_forward_global =
                        my_site.symbols.globalMacros.get(word);
                    if (my_forward_global) {
                        out.push(
                            ...this.macro_symbol_to_locations(my_forward_global)
                        );
                    }
                }
                out.push(
                    ...this.collect_related_definition_locations(
                        document.uri,
                        word,
                        'global',
                        workspace_indexer
                    )
                );
                return this.locations_to_definition(
                    this.dedupe_locations(out)
                );
            }
        }

        // Only check macros, not programs or other Stata symbols
        // 1. Check local macros
        const local_macro = document.symbols.localMacros.get(word);

        // Collect cross-file workspace-indexer definitions (both kinds)
        const cross_local_locs = this.collect_workspace_definition_locations(
            document.uri,
            word,
            'local',
            workspace_indexer,
            { include_only: true }
        );
        const cross_global_locs = this.collect_workspace_definition_locations(
            document.uri,
            word,
            'global',
            workspace_indexer
        );

        if (local_macro) {
            const out: Location[] =
                this.macro_symbol_to_locations(local_macro);
            out.push(...cross_local_locs);
            return this.locations_to_definition(this.dedupe_locations(out));
        }

        if (cross_local_locs.length > 0) {
            return this.locations_to_definition(
                this.dedupe_locations(cross_local_locs)
            );
        }

        // 2. Check global macros
        const global_macro =
            document.symbols.globalMacros.get(word) ||
            (
                (!workspace_indexer || cross_global_locs.length > 0)
                    ? workspace_symbols?.globalMacros.get(word)
                    : undefined
            );
        if (global_macro) {
            const out: Location[] =
                this.macro_symbol_to_locations(global_macro);
            out.push(...cross_global_locs);
            return this.locations_to_definition(this.dedupe_locations(out));
        }

        if (cross_global_locs.length > 0) {
            return this.locations_to_definition(
                this.dedupe_locations(cross_global_locs)
            );
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
        reference_position: Position,
        cancellation_token?: CancellationToken
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
        const the_stack: StataNode[] = [...document.ast.nodes];
        let iteration_count = 0;
        while (the_stack.length > 0) {
            const node = the_stack.pop();
            if (!node) {
                continue;
            }

            // Periodic cancellation check (Req 5.2, 5.4)
            if (++iteration_count % 500 === 0 && cancellation_token?.isCancellationRequested) {
                return null;
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
                for (let i = 0; i < node.body.length; i++) {
                    the_stack.push(node.body[i]);
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
     *
     * `do`/`run`/`include` only match when they are the first non-whitespace
     * token on the line, so command navigation does not trigger from inside
     * comments. The `@lsp-*` regex is intentionally unanchored, which lets
     * directives nested inside comments still resolve. We still only navigate
     * when the cursor actually sits on the quoted path — otherwise clicking an
     * unrelated word on a line like `// note: @lsp-do: "helper"` would also
     * jump to helper.do.
     */
    private get_include_definition(document: DocumentState, position: Position): Definition | null {
        const line_text = get_line_text(document, position.line);

        // Check for do/run/include commands
        const include_match = line_text.match(/^\s*(do|run|include)\s+(["']?)([^"'\s]+)\2/);
        if (include_match) {
            const file_path = include_match[3];
            const path_start = include_match.index! +
                include_match[0].length - file_path.length - (include_match[2] ? 1 : 0);
            const path_end = path_start + file_path.length;
            if (position.character >= path_start && position.character <= path_end) {
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
        }

        // Check for path-bearing directives. These are only directives inside
        // Stata comments; bare `sight:` text is ordinary invalid Stata code.
        const directive_match = line_text.match(
            new RegExp(
                `${DIRECTIVE_PREFIX_PATTERN}(${BACKWARD_DIRECTIVE_KEYWORDS}|${FORWARD_DIRECTIVE_KEYWORDS})` +
                String.raw`:?\s+(?:"([^"]+)"|([^\s]+))(?:\s+(?:line=\d+|match="[^"]+"))*\s*$`
            )
        );
        if (directive_match && is_cursor_in_comment(document, position)) {
            const quoted_path = directive_match[2];
            const unquoted_path = directive_match[3];
            const file_path = quoted_path || unquoted_path;
            const match_start = directive_match.index!;

            const keyword_start = directive_match[0].indexOf(directive_match[1]);
            const path_literal = quoted_path ? `"${file_path}"` : file_path;
            const path_literal_start = directive_match[0].indexOf(
                path_literal,
                keyword_start + directive_match[1].length
            );
            if (path_literal_start < 0) return null;
            const path_start = match_start + path_literal_start + (quoted_path ? 1 : 0);
            const path_end = path_start + file_path.length;
            if (position.character >= path_start &&
                position.character <= path_end) {
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
        
        // Pattern: local/global macname : extended_function ...
        // Supported functions: list, word, piece
        // Note: Stata is case-sensitive, so local/global and function keywords must be lowercase
        // Allow start of line or semicolon delimiter as anchor
        const extended_macro_pattern = /(?:^|;)\s*(local|global)\s+\w+\s*:\s*(list|word|piece)\s+/;
        return extended_macro_pattern.test(text_before_cursor);
    }

    /**
     * Resolve file path with .do fallback, relative to current file.
     *
     * Routes through `resolve_path_rich` so that a path whose casing differs
     * from the on-disk file only in ASCII case (`do helpers/clean` for on-disk
     * `helpers/Clean.do`) still navigates to the real-cased target. Ambiguous
     * or missing paths return null (no navigation).
     *
     * The workspace roots (from set_workspace_roots) are included so that
     * cross-directory targets resolve correctly with case-only handling.
     * current_dir is always appended as a fallback to preserve symlink-safe
     * behaviour on macOS where /tmp is a symlink to /private/tmp: even when
     * a workspace root contains the document's directory under a different
     * prefix, current_dir still bounds the file's own directory.
     * resolve_path_rich picks the longest matching root, so the real
     * workspace root takes precedence when it genuinely contains the target.
     */
    private resolve_file_path(current_uri: string, file_path: string): string | null {
        const current_path = URI.parse(current_uri).fsPath;
        const current_dir = path.dirname(current_path);
        const resolved_path = path.resolve(current_dir, file_path);

        // Build the root list: real workspace roots first, then current_dir
        // as a symlink-safe fallback. De-duplicate to avoid redundant scans.
        const the_roots_set = new Set<string>(this.workspace_roots);
        the_roots_set.add(current_dir);
        const the_roots = Array.from(the_roots_set);

        const my_outcome = resolve_path_rich(resolved_path, {
            workspace_roots: the_roots,
        });
        if (my_outcome.kind === 'exact' || my_outcome.kind === 'case_only') {
            return my_outcome.path;
        }
        return null;
    }
}

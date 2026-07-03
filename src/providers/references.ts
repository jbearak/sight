/**
 * References Provider for Sight
 *
 * Provides find-references functionality for macros, programs, variables, and other symbols.
 * Context-aware: maintains symbol reference resolution across embedded language contexts.
 */

import {
    Location,
    Position,
    Range,
    ReferenceContext,
    CancellationToken,
} from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { LanguageContext, MacroSymbol, Token, ContextRange } from '../types';
import { get_line_text } from '../utils/line-utils';
import { is_cross_file_hidden_local } from '../utils/dofile-locals';
import { resolve_scoped_or_flat } from '../utils/scoped-locals';
import {
    classify_effective_local,
    resolve_effective_local,
} from '../utils/dofile-locals';
import type { WorkspaceIndexer } from '../indexer';
import type { IContextTracker } from '../context-tracker/types';
import type { ScopeResolver } from '../scope-resolver';
import {
    build_scope_resolver_config,
    collect_visible_reference_uris,
    get_visible_forward_call_sites,
    type ReferenceScanRange,
} from '../scope-resolver';
import type { ScopeResolverConfig, ResolvedScope } from '../types';

export interface ReferenceSearchContext {
    symbol_name: string;
    symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
    include_declaration: boolean;
}

/**
 * Per the `ReferenceScanRange` contract in visible-symbols.ts, a URI with a
 * `scan_through_line` cutoff includes matches whose `range.start.line <=
 * scan_through_line`. Both declaration pooling (find_definitions) and token
 * scanning (collect_references) must apply the same comparison, so they share
 * this helper — keeping them aligned is the whole point of extracting it.
 */
export function line_within_scan_range(
    line: number,
    range: ReferenceScanRange,
): boolean {
    if (range.scan_through_line === undefined) return true;
    return line <= range.scan_through_line;
}

export interface TokenMatch {
    uri: string;
    range: Range;
}

export interface IdentifiedSymbol {
    name: string;
    type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
    range: Range;
}

export class ReferencesProvider {
    private readonly scope_resolver?: ScopeResolver;

    constructor(scope_resolver?: ScopeResolver) {
        this.scope_resolver = scope_resolver;
    }

    /**
     * Extract symbol name from local macro token value.
     * Strips backtick and quote from `name' format.
     */
    private extract_local_macro_name(token_value: string): string {
        if (token_value.startsWith('`') && token_value.endsWith("'")) {
            return token_value.slice(1, -1);
        }
        return token_value;
    }

    /**
     * Extract symbol name from global macro token value.
     * Strips $ and braces from $name or ${name} formats.
     */
    private extract_global_macro_name(token_value: string): string {
        if (token_value.startsWith('${') && token_value.endsWith('}')) {
            return token_value.slice(2, -1);
        }
        if (token_value.startsWith('$')) {
            return token_value.slice(1);
        }
        return token_value;
    }

    /**
     * Build a Set of line numbers that are within embedded language contexts.
     * O(m) preprocessing to enable O(1) lookup per token.
     */
    private build_embedded_context_lines(context_ranges?: ContextRange[]): Set<number> {
        const embedded_lines = new Set<number>();
        if (!context_ranges) return embedded_lines;

        for (const my_range of context_ranges) {
            if (my_range.context !== LanguageContext.STATA) {
                for (let line = my_range.range.start.line; line <= my_range.range.end.line; line++) {
                    embedded_lines.add(line);
                }
            }
        }
        return embedded_lines;
    }

    /**
     * Scan tokens in a file for references to a symbol.
     * 
     * @param tokens - Tokens from the file
     * @param uri - File URI
     * @param search_context - Symbol to search for
     * @param context_ranges - Embedded language context ranges (optional)
     * @returns Array of matching token locations
     */
    scan_tokens_for_references(
        tokens: Token[],
        uri: string,
        search_context: ReferenceSearchContext,
        context_ranges?: ContextRange[],
        cancellation_token?: CancellationToken
    ): TokenMatch[] {
        const matches: TokenMatch[] = [];
        const is_macro = search_context.symbol_type === 'local_macro' || 
                         search_context.symbol_type === 'global_macro';

        // Pre-build embedded context lookup for O(1) checks - avoids O(n*m)
        const embedded_lines = is_macro ? null : this.build_embedded_context_lines(context_ranges);

        for (let i = 0; i < tokens.length; i++) {
            // Periodic cancellation check (Req 5.3, 5.4)
            if (i % 500 === 0 && cancellation_token?.isCancellationRequested) {
                return matches;
            }

            const token = tokens[i];
            let token_name: string | null = null;

            // Extract name based on token type and search context
            switch (search_context.symbol_type) {
                case 'local_macro':
                    if (token.type === 'MACRO_REF_LOCAL') {
                        token_name = this.extract_local_macro_name(token.value);
                    }
                    break;
                case 'global_macro':
                    if (token.type === 'MACRO_REF_GLOBAL') {
                        token_name = this.extract_global_macro_name(token.value);
                    }
                    break;
                case 'program':
                case 'variable':
                case 'scalar':
                case 'matrix':
                    if (token.type === 'WORD') {
                        token_name = token.value;
                    }
                    break;
            }

            // Case-sensitive comparison
            if (token_name === search_context.symbol_name) {
                // For non-macro symbols, exclude matches in embedded contexts (O(1) lookup)
                if (embedded_lines && embedded_lines.has(token.range.start.line)) {
                    continue;
                }
                
                matches.push({
                    uri,
                    range: token.range
                });
            }
        }

        return matches;
    }

    /**
     * Find all definition locations for a symbol — current document first,
     * then the workspace index so cross-file definitions are included.
     */
    private find_definitions(
        document: DocumentState,
        symbol_name: string,
        symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix',
        workspace_indexer?: WorkspaceIndexer,
        resolved_scope?: ResolvedScope,
        cursor_line?: number,
        target_local_macro?: MacroSymbol,
        exclude_same_file_local?: boolean,
        inherited_target?: MacroSymbol,
    ): Location[] {
        const locations: Location[] = [];
        const seen = new Set<string>();
        const push = (loc: Location | null | undefined): void => {
            if (!loc) return;
            const key = `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}:${loc.range.end.line}:${loc.range.end.character}`;
            if (seen.has(key)) return;
            seen.add(key);
            locations.push(loc);
        };

        const symbols = document.symbols;
        switch (symbol_type) {
            case 'local_macro': {
                // Scope-aware (#270): the resolved target symbol (the
                // cursor-visible scope's own MacroSymbol) supersedes
                // the
                // flat slot, which may belong to a different scope. For
                // an out-of-scope reference the flat slot is forbidden
                // entirely — the identity is the call-line-gated
                // inherited winner (its primary + same-scope
                // additional_definitions) or nothing; the broad
                // workspace pool below stays off for this mode, or a
                // superseded include's same-name declaration would
                // surface next to the winner (round-6 gate).
                const local_macro = target_local_macro
                    ?? (exclude_same_file_local
                        ? inherited_target
                        : symbols.localMacros.get(symbol_name));
                if (local_macro) {
                    // Loop-expanded definitions anchor at the template statement
                    // (`local x_`i'`), whose text does not contain the concrete
                    // name — surfacing them as references would point at a line
                    // the user cannot reconcile with the searched name.
                    if (!local_macro.is_expanded) {
                        push({ uri: local_macro.location.uri, range: local_macro.location.range });
                    }
                    for (const my_extra of local_macro.additional_definitions ?? []) {
                        if (my_extra.is_expanded) continue;
                        push({ uri: my_extra.location.uri, range: my_extra.location.range });
                    }
                }
                break;
            }
            case 'global_macro': {
                const global_macro = symbols.globalMacros.get(symbol_name);
                if (global_macro) {
                    if (!global_macro.is_expanded) {
                        push({ uri: global_macro.location.uri, range: global_macro.location.range });
                    }
                    for (const my_extra of global_macro.additional_definitions ?? []) {
                        if (my_extra.is_expanded) continue;
                        push({ uri: my_extra.location.uri, range: my_extra.location.range });
                    }
                }
                break;
            }
            case 'program': {
                const program = symbols.programs.get(symbol_name);
                if (program) {
                    push({ uri: program.location.uri, range: program.location.range });
                    for (const my_extra of program.additional_definitions ?? []) {
                        push({ uri: my_extra.location.uri, range: my_extra.location.range });
                    }
                }
                break;
            }
            case 'variable': {
                const variable = symbols.variables.get(symbol_name);
                if (variable) push({ uri: variable.location.uri, range: variable.location.range });
                break;
            }
            case 'scalar': {
                const scalar = symbols.scalars.get(symbol_name);
                if (scalar) {
                    push({ uri: scalar.location.uri, range: scalar.location.range });
                    for (const my_extra of scalar.additional_definitions ?? []) {
                        push({ uri: my_extra.location.uri, range: my_extra.location.range });
                    }
                }
                break;
            }
            case 'matrix': {
                const matrix = symbols.matrices.get(symbol_name);
                if (matrix) {
                    push({ uri: matrix.location.uri, range: matrix.location.range });
                    for (const my_extra of matrix.additional_definitions ?? []) {
                        push({ uri: my_extra.location.uri, range: my_extra.location.range });
                    }
                }
                break;
            }
        }

        // A program-scoped local target never crosses file boundaries
        // (#271), so cross-file declaration pooling is skipped (#270).
        // Out-of-scope cursors skip it too: their declaration set is
        // exactly the inherited winner handled above (or nothing when
        // plain undefined) — the ungated same-name pool would surface
        // superseded includes' declarations (round-6 gate).
        const is_program_scoped_target = this.is_program_scoped_local_target(
            symbol_type, target_local_macro
        );
        const out_of_scope_local_target =
            symbol_type === 'local_macro' &&
            exclude_same_file_local === true;
        if (
            workspace_indexer &&
            !is_program_scoped_target &&
            !out_of_scope_local_target
        ) {
            const ws_type: 'program' | 'local' | 'global' | 'variable' | 'scalar' | 'matrix' =
                symbol_type === 'local_macro' ? 'local' :
                symbol_type === 'global_macro' ? 'global' :
                symbol_type;
            // Variables are dataset columns — we pool cross-module declarations
            // workspace-wide (see docs/find-references.md). All other kinds are
            // restricted to dep-graph-reachable candidates that are visible at
            // the cursor, with same-name conflicts resolved by effective scope
            // precedence. In production we therefore pool declarations only
            // from files contributing the active visible symbol instance at the
            // cursor; masked redeclarations in otherwise-visible files are
            // intentionally excluded. When `resolved_scope` or `cursor_line`
            // is missing (test-only setups without a scope resolver wired),
            // fall back to the pre-fix dep-graph-reachable set so the broader
            // declaration-pooling behavior is preserved — matching
            // collect_references's symmetric fallback below.
            let the_allowed_uris: Map<string, ReferenceScanRange> | null = null;
            if (symbol_type !== 'variable') {
                if (resolved_scope !== undefined && cursor_line !== undefined) {
                    the_allowed_uris = collect_visible_reference_uris(
                        resolved_scope,
                        cursor_line,
                        document.uri,
                        symbol_type,
                        symbol_name,
                    );
                    // Union with the transitive dep-graph-reachable set so
                    // sibling-caller declarations pool under Rule 1. Mirrors
                    // collect_references's floor. See issue #135.
                    const the_reachable_floor = symbol_type === 'local_macro'
                        ? workspace_indexer.get_related_uris(
                            document.uri,
                            { include_only: true }
                        )
                        : workspace_indexer.get_related_uris(document.uri);
                    for (const my_uri of the_reachable_floor) {
                        if (!the_allowed_uris.has(my_uri)) {
                            the_allowed_uris.set(my_uri, {});
                        }
                    }
                } else {
                    const the_fallback_uris = symbol_type === 'local_macro'
                        ? workspace_indexer.get_related_uris(
                            document.uri,
                            { include_only: true }
                        )
                        : workspace_indexer.get_related_uris(document.uri);
                    the_allowed_uris = new Map(
                        Array.from(the_fallback_uris).map((my_uri) => [my_uri, {}]),
                    );
                }
            }
            // Skip entries from the current document's URI: the on-disk
            // index can lag unsaved buffer edits, and document.symbols
            // already holds the authoritative fresh declaration.
            for (const my_def of workspace_indexer.find_symbol_definitions(symbol_name, ws_type)) {
                if (my_def.sourceUri === document.uri) continue;
                if (is_cross_file_hidden_local(ws_type, my_def)) continue;
                if (the_allowed_uris) {
                    const range = the_allowed_uris.get(my_def.sourceUri);
                    if (!range) continue;
                    if (!line_within_scan_range(my_def.location.range.start.line, range)) {
                        continue;
                    }
                }
                // Loop-expanded macro symbols anchor at the template statement,
                // whose text does not contain the concrete name (see the
                // current-document branch above) — never surface them.
                if (!('is_expanded' in my_def && my_def.is_expanded)) {
                    push({ uri: my_def.location.uri, range: my_def.location.range });
                }
                // Issue #135: pool same-name redeclarations tracked in
                // additional_definitions. Variables are excluded because
                // variable symbols don't carry this field.
                if (
                    'additional_definitions' in my_def
                    && my_def.additional_definitions
                ) {
                    for (const my_extra of my_def.additional_definitions) {
                        if ('is_expanded' in my_extra && my_extra.is_expanded) continue;
                        // Gate by the extra's own URI, not the primary's
                        // `sourceUri`. The analyzer currently guarantees they
                        // match (all entries are pushed with `this.uri`), but
                        // gating on the extra's URI keeps this branch correct
                        // if that invariant is ever relaxed — e.g., a future
                        // indexer path surfaces a cross-file redeclaration as
                        // an `additional_definitions` entry.
                        if (the_allowed_uris) {
                            const range = the_allowed_uris.get(my_extra.location.uri);
                            if (!range) continue;
                            if (!line_within_scan_range(my_extra.location.range.start.line, range)) {
                                continue;
                            }
                        }
                        push({ uri: my_extra.location.uri, range: my_extra.location.range });
                    }
                }
            }
        }

        return locations;
    }

    /**
     * Find all references to the symbol at the given position.
     *
     * @param document - The document state
     * @param position - The cursor position
     * @param context - LSP reference context (includeDeclaration)
     * @param workspace_indexer - Optional workspace indexer for cross-file search
     * @param context_tracker - Optional context tracker for embedded language awareness
     * @returns Promise<Location[]> - Array of reference locations
     */
    async get_references(
        document: DocumentState,
        position: Position,
        context: ReferenceContext,
        workspace_indexer?: WorkspaceIndexer,
        context_tracker?: IContextTracker,
        cancellation_token?: CancellationToken,
        cross_file_config?: Partial<ScopeResolverConfig>
    ): Promise<Location[]> {
        // Check cancellation before starting (Req 5.3)
        if (cancellation_token?.isCancellationRequested) {
            return [];
        }

        // Check if we're in an embedded language context
        if (context_tracker) {
            const my_context = context_tracker.get_context_at_position(position);

            // In embedded language context, only resolve macros
            if (my_context !== LanguageContext.STATA) {
                return await this.get_macro_references_only(
                    document,
                    position,
                    context,
                    workspace_indexer,
                    cancellation_token,
                    cross_file_config
                );
            }
        }

        // Identify the symbol at cursor position
        const identified_symbol = await this.identify_symbol_at_position(
            document,
            position,
            workspace_indexer,
            cancellation_token,
            cross_file_config
        );
        if (!identified_symbol) {
            return [];
        }

        // Resolve the scope once here (cached by ScopeResolver) so
        // find_definitions can apply the call-site filter to declarations
        // pooled from the workspace indexer. See issue #129.
        const resolve_config = build_scope_resolver_config(cross_file_config);
        const resolved_scope = this.scope_resolver
            ? await this.scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            )
            : undefined;

        // Scope-aware local-macro target resolution (#270).
        const target = this.resolve_local_reference_target(
            document, position, identified_symbol, resolved_scope
        );

        return this.collect_references(
            document,
            identified_symbol.name,
            identified_symbol.type,
            context.includeDeclaration,
            workspace_indexer,
            document.context_ranges,
            cancellation_token,
            resolved_scope,
            position.line,
            target.target_local_macro,
            target.exclude_same_file_local,
            target.inherited_target,
        );
    }

    /**
     * Scope-aware target resolution for local-macro find-references
     * (#270), applying the effective order (see
     * resolve_effective_local): a positionally RESOLVED same-file
     * symbol is the target; else the cross-file INHERITED do-file
     * local is the winner (`exclude_same_file_local` + 
     * `inherited_target`: the flat slot must not be pooled,
     * declarations come from the winner, and same-file occurrences
     * count only when their own effective resolution is the winner);
     * else a same-scope FORWARD identity target behaves like a
     * resolved one (round-9 gate); else, for an out-of-scope name
     * with no inherited winner, the reference is plain undefined
     * (`exclude_same_file_local` alone: current-file-only,
     * same-resolution-class occurrences). All fields undefined/false
     * = the scoped model has no opinion (empty scopes, cross-file
     * name, positional arg); existing name-based scanning proceeds
     * unchanged.
     */
    private resolve_local_reference_target(
        document: DocumentState,
        position: Position,
        identified_symbol: IdentifiedSymbol,
        resolved_scope: ResolvedScope | undefined
    ): {
        target_local_macro?: MacroSymbol;
        exclude_same_file_local: boolean;
        inherited_target?: MacroSymbol;
    } {
        if (identified_symbol.type !== 'local_macro') {
            return { exclude_same_file_local: false };
        }
        const effective = classify_effective_local(
            document.scopes,
            position,
            identified_symbol.name,
            resolved_scope,
            document.uri
        );
        switch (effective.kind) {
            case 'resolved':
            case 'forward':
                return {
                    target_local_macro: effective.symbol,
                    exclude_same_file_local: false,
                };
            case 'inherited':
                return {
                    exclude_same_file_local: true,
                    inherited_target: effective.symbol,
                };
            case 'out_of_scope':
                return { exclude_same_file_local: true };
            case 'none':
                return { exclude_same_file_local: false };
            default: {
                // Compiler-enforced exhaustiveness: a new
                // classification tier must be mapped here explicitly.
                const unhandled: never = effective.kind;
                throw new Error(`unhandled effective kind: ${unhandled}`);
            }
        }
    }

    /**
     * True when the resolved find-references target is a program-scoped
     * local. Such a target never crosses file boundaries (#271), so
     * both declaration pooling and the token scan stay current-file
     * only. Shared by find_definitions and collect_references so the
     * two gates cannot drift (#270).
     */
    private is_program_scoped_local_target(
        symbol_type: string,
        target_local_macro?: MacroSymbol
    ): boolean {
        return symbol_type === 'local_macro' &&
            target_local_macro?.containingScope === 'program';
    }

    /**
     * Apply includeDeclaration logic to locations.
     * Shared between get_references and get_macro_references_only.
     *
     * A scanned token match and a stored definition represent the same
     * declaration when their ranges overlap in the same file. Programs in
     * particular store their declaration range as the whole `program
     * define ... end` body, while the WORD-token scan produces a narrow range
     * covering just the name — so range equality alone under-dedupes.
     */
    private apply_include_declaration(
        locations: Location[],
        definitions: Location[],
        include_declaration: boolean,
        related_uris?: Set<string>
    ): Location[] {
        const is_declaration_match = (loc: Location, def: Location): boolean => {
            if (loc.uri !== def.uri) return false;
            // Program symbols store the whole `program ... end` body as the
            // declaration range, so a recursive call inside the body would
            // overlap and be mistaken for the declaration. Restrict the check
            // to the first line of a multi-line definition — that's where the
            // declaration name lives.
            if (def.range.start.line !== def.range.end.line) {
                if (loc.range.start.line !== def.range.start.line) return false;
            }
            return this.ranges_overlap(def.range, loc.range);
        };
        const represents_declaration = (loc: Location): boolean =>
            definitions.some(def => is_declaration_match(loc, def));

        if (include_declaration) {
            for (const my_def of definitions) {
                const already_present = locations.some(loc => is_declaration_match(loc, my_def));
                if (!already_present) {
                    locations.push(my_def);
                }
            }
        } else if (definitions.length > 0) {
            const filtered_locations = locations.filter(loc => !represents_declaration(loc));
            return this.sort_locations(filtered_locations, related_uris);
        }
        return this.sort_locations(locations, related_uris);
    }

    /**
     * Return true if two ranges share any text (not just touch at endpoints).
     */
    private ranges_overlap(a: Range, b: Range): boolean {
        const before = (p1: Position, p2: Position): boolean =>
            p1.line < p2.line || (p1.line === p2.line && p1.character <= p2.character);
        const strictly_before = (p1: Position, p2: Position): boolean =>
            p1.line < p2.line || (p1.line === p2.line && p1.character < p2.character);
        return before(a.start, b.start)
            ? strictly_before(b.start, a.end)
            : strictly_before(a.start, b.end);
    }

    /**
     * Sort locations by URI, then line, then character.
     *
     * When `related_uris` is provided (the variable case, which scans the
     * whole workspace), matches inside related files tier above matches in
     * unrelated files so editors show the high-relevance hits first.
     */
    private sort_locations(locations: Location[], related_uris?: Set<string>): Location[] {
        return locations.sort((a, b) => {
            if (related_uris) {
                const a_related = related_uris.has(a.uri) ? 0 : 1;
                const b_related = related_uris.has(b.uri) ? 0 : 1;
                if (a_related !== b_related) return a_related - b_related;
            }
            // First compare by URI
            if (a.uri < b.uri) return -1;
            if (a.uri > b.uri) return 1;
            // Then by line
            if (a.range.start.line < b.range.start.line) return -1;
            if (a.range.start.line > b.range.start.line) return 1;
            // Then by character
            if (a.range.start.character < b.range.start.character) return -1;
            if (a.range.start.character > b.range.start.character) return 1;
            return 0;
        });
    }

    /**
     * Get the word at the given position.
     */
    private get_word_at_position(
        document: DocumentState,
        position: Position
    ): { word: string; range: Range } | null {
        const line = get_line_text(document, position.line);
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
     * Identify the symbol at the cursor position and determine its type.
     */
    private async identify_symbol_at_position(
        document: DocumentState,
        position: Position,
        workspace_indexer?: WorkspaceIndexer,
        cancellation_token?: CancellationToken,
        cross_file_config?: Partial<ScopeResolverConfig>
    ): Promise<IdentifiedSymbol | null> {
        const word_info = this.get_word_at_position(document, position);
        if (!word_info) {
            return null;
        }

        const { word, range } = word_info;
        const line = get_line_text(document, position.line);

        // Check for macro references by looking at surrounding context
        const char_before_start = range.start.character > 0 ? line[range.start.character - 1] : '';
        const chars_before_start = range.start.character >= 2 ? line.substring(range.start.character - 2, range.start.character) : char_before_start;

        // Global macro: $name or ${name}
        if (char_before_start === '$' || chars_before_start === '${') {
            return {
                name: word,
                type: 'global_macro',
                range,
            };
        }

        // Local macro: `name'
        if (char_before_start === '`') {
            return {
                name: word,
                type: 'local_macro',
                range,
            };
        }

        // Use line-bucketed index for O(1) line lookup when
        // available; fall back to linear scan otherwise
        if (cancellation_token?.isCancellationRequested) {
            return null;
        }
        const the_tokens_to_check: Token[] | undefined =
            document.token_line_index?.size > 0
                ? document.token_line_index.get(position.line)
                : document.tokens;
        if (the_tokens_to_check) {
            for (const my_token of the_tokens_to_check) {
                if (this.position_in_range(position, my_token.range)) {
                    switch (my_token.type) {
                        case 'MACRO_REF_LOCAL':
                            return { name: word, type: 'local_macro', range };
                        case 'MACRO_REF_GLOBAL':
                            return { name: word, type: 'global_macro', range };
                        case 'WORD':
                            return await this.classify_word_symbol(word, range, document, workspace_indexer, cross_file_config, cancellation_token);
                    }
                }
            }
        }

        // Return null if we can't determine the type reliably
        return null;
    }

    /**
     * Classify a WORD token against the local symbol table, falling back
     * to the workspace index for cross-file symbols. The WORD case covers
     * both reference sites (e.g., `tab analysis_sample`) and definition
     * sites that tokenize as plain words (e.g., `global data_path`, where
     * `data_path` is a WORD, not a MACRO_REF_GLOBAL).
     */
    private async classify_word_symbol(
        word: string,
        range: Range,
        document: DocumentState,
        workspace_indexer?: WorkspaceIndexer,
        cross_file_config?: Partial<ScopeResolverConfig>,
        cancellation_token?: CancellationToken
    ): Promise<IdentifiedSymbol | null> {
        // Cursor sitting inside a macro's own declaration range must resolve
        // to the macro even when a non-macro symbol of the same name exists.
        // Stata allows cross-namespace name collisions (e.g., variable and
        // global macro both named `data_path`), so the declaration-range check
        // runs first and stays sync against document.symbols.
        const global_macro = document.symbols.globalMacros.get(word);
        if (
            global_macro
            && this.position_hits_symbol_definition(range.start, global_macro)
        ) {
            return { name: word, type: 'global_macro', range };
        }
        // Scope-aware (#270): resolve against the scope that textually
        // contains the cursor, so a losing-flat-slot program local
        // still matches its own declaration range.
        const local_macro = resolve_scoped_or_flat(
            document.scopes, range.start, word,
            document.symbols.localMacros
        );
        if (
            local_macro
            && this.position_hits_symbol_definition(range.start, local_macro)
        ) {
            return { name: word, type: 'local_macro', range };
        }
        const program = document.symbols.programs.get(word);
        if (
            program
            && this.position_hits_symbol_definition(range.start, program)
        ) {
            return { name: word, type: 'program', range };
        }

        // Scope-resolver path: the classifier asks ScopeResolver what symbols
        // are visible at the cursor. `resolved_scope.symbols` already merges
        // the current file with every parent reachable via backward directives
        // (done-by / included-by, auto or explicit). `forward_call_symbols`
        // lists forward calls (do/run/include) with the line they were
        // invoked on; a call is visible only when its call_line is strictly
        // less than the cursor line.
        if (this.scope_resolver) {
            const resolve_config = build_scope_resolver_config(cross_file_config);
            const resolved_scope = await this.scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );
            const cursor_line = range.start.line;

            // 1. Backward chain + current file (always in scope).
            //    Order matches the pre-fix in-document ordering: programs →
            //    variables → scalars → matrices. Variables here are
            //    current-file or parent declarations; workspace-wide
            //    variables fall through to step 3.
            if (resolved_scope.symbols.programs.has(word)) {
                return { name: word, type: 'program', range };
            }
            if (resolved_scope.symbols.variables.has(word)) {
                return { name: word, type: 'variable', range };
            }
            if (resolved_scope.symbols.scalars.has(word)) {
                return { name: word, type: 'scalar', range };
            }
            if (resolved_scope.symbols.matrices.has(word)) {
                return { name: word, type: 'matrix', range };
            }

            // 2. Forward calls before the cursor. Nested call sites already
            //    carry the parent's call_line (set by ForwardScopeResolver),
            //    so the filter is correct transitively. Preserve kind
            //    priority across all visible sites: program → scalar →
            //    matrix.
            let best_forward_type: 'program' | 'scalar' | 'matrix' | null = null;
            let best_forward_priority = -1;
            for (const my_site of get_visible_forward_call_sites(resolved_scope, cursor_line)) {
                let site_type: 'program' | 'scalar' | 'matrix' | null = null;
                let site_priority = -1;
                if (my_site.symbols.programs.has(word)) {
                    site_type = 'program';
                    site_priority = 3;
                } else if (my_site.symbols.scalars.has(word)) {
                    site_type = 'scalar';
                    site_priority = 2;
                } else if (my_site.symbols.matrices.has(word)) {
                    site_type = 'matrix';
                    site_priority = 1;
                }

                if (site_priority > best_forward_priority && site_type) {
                    best_forward_type = site_type;
                    best_forward_priority = site_priority;
                }
                if (best_forward_priority === 3) {
                    break;
                }
            }
            if (best_forward_type) {
                return { name: word, type: best_forward_type, range };
            }

            // 3. Variables remain workspace-wide: dataset columns are
            //    legitimately shared across unrelated modules, so no
            //    call-site filter here. See docs/find-references.md.
            if (workspace_indexer) {
                const has_cross_file_variable = workspace_indexer
                    .find_symbol_definitions(word, 'variable')
                    .some(my_def => my_def.sourceUri !== document.uri);
                if (has_cross_file_variable) {
                    return { name: word, type: 'variable', range };
                }
            }

            return null;
        }

        // Fallback path (test-only): production always wires scope_resolver,
        // but unit/integration tests that construct ReferencesProvider with
        // zero args land here. Preserve the pre-fix behavior so those tests
        // don't regress.
        if (document.symbols.programs.has(word)) {
            return { name: word, type: 'program', range };
        }
        if (document.symbols.variables.has(word)) {
            return { name: word, type: 'variable', range };
        }
        if (document.symbols.scalars.has(word)) {
            return { name: word, type: 'scalar', range };
        }
        if (document.symbols.matrices.has(word)) {
            return { name: word, type: 'matrix', range };
        }

        if (workspace_indexer) {
            const the_related = workspace_indexer.get_related_uris(document.uri);
            const has_cross_file_any = (
                ws_type: 'variable'
            ): boolean =>
                workspace_indexer
                    .find_symbol_definitions(word, ws_type)
                    .some(my_def => my_def.sourceUri !== document.uri);
            const has_cross_file_related = (
                ws_type: 'program' | 'scalar' | 'matrix'
            ): boolean =>
                workspace_indexer
                    .find_symbol_definitions(word, ws_type)
                    .some(my_def =>
                        my_def.sourceUri !== document.uri &&
                        the_related.has(my_def.sourceUri)
                    );
            if (has_cross_file_related('program')) {
                return { name: word, type: 'program', range };
            }
            if (has_cross_file_related('scalar')) {
                return { name: word, type: 'scalar', range };
            }
            if (has_cross_file_related('matrix')) {
                return { name: word, type: 'matrix', range };
            }
            // Variables remain workspace-wide on the fallback path too;
            // See docs/find-references.md.
            if (has_cross_file_any('variable')) {
                return { name: word, type: 'variable', range };
            }
        }

        return null;
    }

    /**
     * Handle macro references in embedded language contexts.
     * Macros work across all contexts (Stata, Mata, Python).
     */
    private async get_macro_references_only(
        document: DocumentState,
        position: Position,
        context: ReferenceContext,
        workspace_indexer?: WorkspaceIndexer,
        cancellation_token?: CancellationToken,
        cross_file_config?: Partial<ScopeResolverConfig>
    ): Promise<Location[]> {
        const identified_symbol = await this.identify_symbol_at_position(
            document,
            position,
            workspace_indexer,
            cancellation_token,
            cross_file_config
        );
        if (!identified_symbol || (identified_symbol.type !== 'local_macro' && identified_symbol.type !== 'global_macro')) {
            return [];
        }

        // Resolve the scope once so find_definitions can apply the
        // call-site filter to non-variable declarations pooled from the
        // workspace indexer. See issue #129.
        const resolve_config = build_scope_resolver_config(cross_file_config);
        const resolved_scope = this.scope_resolver
            ? await this.scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            )
            : undefined;

        // Scope-aware local-macro target resolution (#270).
        const target = this.resolve_local_reference_target(
            document, position, identified_symbol, resolved_scope
        );

        return this.collect_references(
            document,
            identified_symbol.name,
            identified_symbol.type,
            context.includeDeclaration,
            workspace_indexer,
            undefined, // No context_ranges filtering for macros (they work across all contexts)
            cancellation_token,
            resolved_scope,
            position.line,
            target.target_local_macro,
            target.exclude_same_file_local,
            target.inherited_target,
        );
    }

    /**
     * Shared helper to collect references across current document and workspace.
     */
    private async collect_references(
        document: DocumentState,
        symbol_name: string,
        symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix',
        include_declaration: boolean,
        workspace_indexer?: WorkspaceIndexer,
        context_ranges?: ContextRange[],
        cancellation_token?: CancellationToken,
        resolved_scope?: ResolvedScope,
        cursor_line?: number,
        target_local_macro?: MacroSymbol,
        exclude_same_file_local?: boolean,
        inherited_target?: MacroSymbol,
    ): Promise<Location[]> {
        const search_context: ReferenceSearchContext = {
            symbol_name,
            symbol_type,
            include_declaration
        };

        const locations: Location[] = [];
        const definitions = this.find_definitions(
            document,
            symbol_name,
            symbol_type,
            workspace_indexer,
            resolved_scope,
            cursor_line,
            target_local_macro,
            exclude_same_file_local,
            inherited_target,
        );

        // Search workspace-indexed files (Req 13.3).
        //
        // Variables are Stata dataset column names — name matches in files
        // that don't share a runtime relationship with the current one are
        // still useful (different analyses often touch the same columns), so
        // we scan the full workspace. Every other symbol kind (programs,
        // scalars, matrices, macros) is a code-level symbol where cross-module
        // name collisions are almost always coincidental, so we restrict the
        // scan to dep-graph-reachable files that are visible at the cursor,
        // then narrow further to the active visible symbol instance selected
        // by precedence. (Issue #129 aligns the scan path with the
        // declaration-pooling rules: a masked redeclaration in an
        // otherwise-visible file must not surface as a cross-reference.)
        //
        // Local macros are narrower still: Stata only propagates locals
        // through `include` chains, never through `do` or `run`. A local
        // with the same name in a `do`-called child is a different macro,
        // so the reachable set is restricted to include-only edges; here we
        // keep that narrower backward path via `get_related_uris`, which
        // understands `include_only`.
        // See docs/find-references.md for the rationale behind this three-tier model.
        const restrict_to_related = symbol_type !== 'variable';
        // A program-scoped local target never crosses file boundaries
        // (#271) — restrict the scan to the current file, skipping
        // the
        // cross-file token scan entirely (#270). Same for an
        // out-of-scope cursor with NO inherited target: the reference
        // is plain undefined, and a same-named local in an
        // include-related file's program body is a different macro
        // (round-3 gate).
        const is_program_scoped_target = this.is_program_scoped_local_target(
            symbol_type, target_local_macro
        );
        const undefined_out_of_scope_target =
            symbol_type === 'local_macro' &&
            exclude_same_file_local === true &&
            inherited_target === undefined;
        let the_related: Map<string, ReferenceScanRange>;
        if (
            is_program_scoped_target ||
            undefined_out_of_scope_target ||
            !workspace_indexer
        ) {
            the_related = new Map([[document.uri, {}]]);
        } else if (
            restrict_to_related &&
            resolved_scope !== undefined &&
            cursor_line !== undefined
        ) {
            // Scope-resolver path (production): start from the scope-aware
            // set (tracks scan_through_line cutoffs and forward-call
            // visibility) then union with the dep-graph-reachable set so
            // sibling-caller cases (two parents both doing a shared child)
            // are reached transitively. The scope-aware walk only knows
            // the query file's immediate chain + forward calls; it cannot
            // walk callee -> caller -> sibling-callee on its own. Rule 2
            // is preserved because get_related_uris only traverses the
            // connected component of the dep graph.
            the_related = collect_visible_reference_uris(
                resolved_scope,
                cursor_line,
                document.uri,
                symbol_type,
                symbol_name,
            );
            const the_reachable_floor = symbol_type === 'local_macro'
                ? workspace_indexer.get_related_uris(
                    document.uri,
                    { include_only: true }
                )
                : workspace_indexer.get_related_uris(document.uri);
            for (const my_uri of the_reachable_floor) {
                if (!the_related.has(my_uri)) {
                    the_related.set(my_uri, {});
                }
            }
        } else {
            // Fallback path (test-only setups without a scope_resolver, or
            // variable lookups that fall through before this point): keep
            // the pre-fix behavior so those setups don't regress.
            const the_fallback_set = symbol_type === 'local_macro'
                ? workspace_indexer.get_related_uris(
                    document.uri,
                    { include_only: true }
                )
                : workspace_indexer.get_related_uris(document.uri);
            the_related = new Map(
                Array.from(the_fallback_set).map((my_uri) => [my_uri, {}]),
            );
        }

        // Search current document
        if (document.tokens) {
            const matches = this.scan_tokens_for_references(
                document.tokens,
                document.uri,
                search_context,
                context_ranges,
                cancellation_token
            );
            const doc_range = the_related.get(document.uri);
            for (const my_match of matches) {
                if (doc_range && !line_within_scan_range(my_match.range.start.line, doc_range)) {
                    continue;
                }
                // Scope-filter (#270): a same-file name match may
                // lexically belong to a DIFFERENT same-named local
                // (shadowing, inheritance, or forward order) — keep
                // only occurrences whose own EFFECTIVE resolution
                // (resolved -> inherited -> forward, the same order
                // every provider uses; round-9 gate) is
                // identity-equal to the cursor's effective target
                // (undefined matching undefined for the
                // plain-undefined class; round-5 gate).
                if (
                    symbol_type === 'local_macro' &&
                    (target_local_macro !== undefined ||
                        exclude_same_file_local === true) &&
                    resolve_effective_local(
                        document.scopes,
                        my_match.range.start,
                        symbol_name,
                        resolved_scope,
                        document.uri
                    ) !== (target_local_macro ?? inherited_target)
                ) {
                    continue;
                }
                locations.push({ uri: my_match.uri, range: my_match.range });
            }
        }

        // Check cancellation before workspace scan (Req 5.3)
        if (cancellation_token?.isCancellationRequested) {
            return this.apply_include_declaration(
                locations,
                definitions,
                include_declaration,
                restrict_to_related ? undefined : new Set(the_related.keys())
            );
        }

        if (workspace_indexer) {
            const indexed_files = workspace_indexer.get_indexed_files();
            let file_count = 0;

            for (const [uri, file_data] of indexed_files.entries()) {
                // Periodic cancellation check during workspace scan (Req 13.3)
                if (cancellation_token?.isCancellationRequested) {
                    break;
                }

                if (uri === document.uri) continue;
                if (restrict_to_related && !the_related.has(uri)) continue;

                const matches = this.scan_tokens_for_references(
                    file_data.tokens,
                    uri,
                    search_context,
                    file_data.context_ranges,
                    cancellation_token
                );
                const range = the_related.get(uri);
                for (const my_match of matches) {
                    if (range && !line_within_scan_range(my_match.range.start.line, range)) {
                        continue;
                    }
                    locations.push({ uri: my_match.uri, range: my_match.range });
                }

                file_count++;
                // Yield every 10 files to avoid blocking the event loop,
                // then re-check cancellation after yielding (Req 13.3)
                if (file_count % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    if (cancellation_token?.isCancellationRequested) {
                        break;
                    }
                }
            }
        }

        return this.apply_include_declaration(
            locations,
            definitions,
            include_declaration,
            restrict_to_related ? undefined : new Set(the_related.keys())
        );
    }

    /**
     * Check if a position is within a range.
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
}

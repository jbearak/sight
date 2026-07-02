/**
 * Pure helpers for asking "what is in scope at a cursor line?" against a
 * ResolvedScope. Providers import these to avoid duplicating the
 * `call_site.call_line < cursor_line` filter across ≈8 sites.
 *
 * All three functions are pure, synchronous, and accept `undefined` for
 * convenience so test-only paths without a ScopeResolver don't need to
 * construct a scope object.
 */

import type {
    ResolvedScope,
    ForwardCallSite,
    SymbolTable,
    ProgramSymbol,
    MacroSymbol,
    ScalarSymbol,
    MatrixSymbol,
    VariableSymbol,
} from '../types';
import { create_empty_symbol_table, merge_symbol_tables } from '../analyzer';

type AnySymbol =
    | ProgramSymbol
    | MacroSymbol
    | ScalarSymbol
    | MatrixSymbol
    | VariableSymbol;

/**
 * True iff `symbol` has any definition (primary or additional) whose line falls
 * in the half-open window `(after_line, up_to_line]`. The window models "was
 * this name redefined strictly after the forward call ran, and at-or-before the
 * cursor we're resolving?" Primary lines come from the symbol's source
 * (navigation) location; additional lines come from `additional_definitions`
 * (macros only).
 */
function has_definition_in_window(
    symbol: AnySymbol,
    after_line: number,
    up_to_line: number,
): boolean {
    const primary_line = symbol.location.range.start.line;
    if (primary_line > after_line && primary_line <= up_to_line) {
        return true;
    }
    if ('additional_definitions' in symbol && symbol.additional_definitions) {
        for (const my_extra of symbol.additional_definitions) {
            if (my_extra.line > after_line && my_extra.line <= up_to_line) {
                return true;
            }
        }
    }
    return false;
}

/**
 * True when the current file has a same-name definition in `(call_line,
 * cursor_line]` — i.e., strictly after the forward call executed and at-or-
 * before the cursor. Per Stata's last-assignment-wins execution order, such a
 * definition shadows the forward-call symbol. Definitions before the call are
 * overwritten by the include; definitions after the cursor haven't run yet.
 */
function current_file_shadows_forward_site<T extends AnySymbol>(
    current_file_map: Map<string, T> | undefined,
    name: string,
    call_line: number,
    cursor_line: number,
): boolean {
    if (!current_file_map) return false;
    const my_existing = current_file_map.get(name);
    if (!my_existing) return false;
    return has_definition_in_window(my_existing, call_line, cursor_line);
}

/**
 * Drop entries from `site_symbols` that are shadowed by a current-file
 * definition in `(call_line, cursor_line]`. Exported so CompletionProvider can
 * apply the same filter when building its annotated forward-symbol overlay.
 */
export function filter_forward_site_symbols(
    site_symbols: SymbolTable,
    current_file_symbols: SymbolTable | undefined,
    call_line: number,
    cursor_line: number,
): SymbolTable {
    if (!current_file_symbols) return site_symbols;
    const filter_map = <T extends AnySymbol>(
        the_site_map: Map<string, T>,
        the_current_map: Map<string, T>,
    ): Map<string, T> => {
        const the_kept = new Map<string, T>();
        for (const [my_name, my_symbol] of the_site_map) {
            if (!current_file_shadows_forward_site(
                the_current_map,
                my_name,
                call_line,
                cursor_line,
            )) {
                the_kept.set(my_name, my_symbol);
            }
        }
        return the_kept;
    };
    return {
        programs: filter_map(site_symbols.programs, current_file_symbols.programs),
        localMacros: filter_map(site_symbols.localMacros, current_file_symbols.localMacros),
        globalMacros: filter_map(site_symbols.globalMacros, current_file_symbols.globalMacros),
        variables: filter_map(site_symbols.variables, current_file_symbols.variables),
        scalars: filter_map(site_symbols.scalars, current_file_symbols.scalars),
        matrices: filter_map(site_symbols.matrices, current_file_symbols.matrices),
    };
}

/**
 * SymbolTable of every symbol in scope at `cursor_line`. Starts from
 * `resolved_scope.symbols` (parent chain + current file) and overlays each
 * forward-call site whose `call_line < cursor_line` with merge_symbol_tables
 * last-wins semantics — except that a current-file definition in the window
 * `(call_line, cursor_line]` is preserved, so current-file redefinitions that
 * happen after the call but at-or-before the cursor shadow the forward-call
 * result (matches Stata's sequential execution semantics).
 *
 * Returns an empty SymbolTable when `scope` is undefined.
 */
export function get_visible_symbols_at(
    scope: ResolvedScope | undefined,
    cursor_line: number,
): SymbolTable {
    if (!scope) {
        return create_empty_symbol_table();
    }
    let result: SymbolTable = {
        programs: new Map(scope.symbols.programs),
        localMacros: new Map(scope.symbols.localMacros),
        globalMacros: new Map(scope.symbols.globalMacros),
        variables: new Map(scope.symbols.variables),
        scalars: new Map(scope.symbols.scalars),
        matrices: new Map(scope.symbols.matrices),
    };
    const current_file_symbols = scope.chain && scope.chain.length > 0
        ? scope.chain[0].symbols
        : undefined;
    for (const my_site of scope.forward_call_symbols ?? []) {
        if (my_site.call_line < cursor_line) {
            const filtered = filter_forward_site_symbols(
                my_site.symbols,
                current_file_symbols,
                my_site.call_line,
                cursor_line,
            );
            result = merge_symbol_tables(result, filtered);
        }
    }
    return result;
}

/**
 * Forward-call sites whose symbols are visible at `cursor_line`
 * (site.call_line < cursor_line). Preserves array order so
 * ranking-sensitive callers keep their current behavior.
 *
 * Returns `[]` when `scope` is undefined or has no forward_call_symbols.
 */
export function get_visible_forward_call_sites(
    scope: ResolvedScope | undefined,
    cursor_line: number,
): ForwardCallSite[] {
    if (!scope?.forward_call_symbols) {
        return [];
    }
    return scope.forward_call_symbols.filter(
        my_site => my_site.call_line < cursor_line,
    );
}

/**
 * Per-URI line cutoff for find-references.
 *
 * - `scan_through_line === undefined`: scan the entire file.
 * - `scan_through_line === <number>`:  include only token matches whose
 *   range.start.line <= scan_through_line (used when the URI redeclares the
 *   active symbol at that line and we want pre-redeclaration references only).
 */
export interface ReferenceScanRange {
    scan_through_line?: number;
}

type ReferenceScopedSymbolType =
    | 'local_macro'
    | 'global_macro'
    | 'program'
    | 'scalar'
    | 'matrix';

type ReferenceScopedSymbol =
    | ProgramSymbol
    | MacroSymbol
    | ScalarSymbol
    | MatrixSymbol;

function get_reference_symbol_from_table(
    symbols: SymbolTable,
    symbol_type: ReferenceScopedSymbolType,
    symbol_name: string,
): ReferenceScopedSymbol | undefined {
    switch (symbol_type) {
        case 'local_macro':
            return symbols.localMacros.get(symbol_name);
        case 'global_macro':
            return symbols.globalMacros.get(symbol_name);
        case 'program':
            return symbols.programs.get(symbol_name);
        case 'scalar':
            return symbols.scalars.get(symbol_name);
        case 'matrix':
            return symbols.matrices.get(symbol_name);
    }
}

function get_reference_symbol_identity(
    symbol: ReferenceScopedSymbol | undefined,
): string | undefined {
    return symbol?.sourceUri ?? symbol?.location.uri;
}

function symbol_table_matches_active_reference(
    symbols: SymbolTable,
    symbol_type: ReferenceScopedSymbolType,
    symbol_name: string,
    active_symbol_identity: string,
): boolean {
    return get_reference_symbol_identity(
        get_reference_symbol_from_table(symbols, symbol_type, symbol_name),
    ) === active_symbol_identity;
}

export function clone_symbol_table(symbols: SymbolTable): SymbolTable {
    return {
        programs: new Map(symbols.programs),
        localMacros: new Map(symbols.localMacros),
        globalMacros: new Map(symbols.globalMacros),
        variables: new Map(symbols.variables),
        scalars: new Map(symbols.scalars),
        matrices: new Map(symbols.matrices),
    };
}

function can_reference_chain_entry(
    symbol_type: ReferenceScopedSymbolType,
    directive_type: 'done-by' | 'included-by',
): boolean {
    if (symbol_type !== 'local_macro') {
        return true;
    }
    return directive_type === 'included-by';
}

function can_reference_forward_site(
    symbol_type: ReferenceScopedSymbolType,
    site: ForwardCallSite,
): boolean {
    if (symbol_type !== 'local_macro') {
        return true;
    }
    return site.effective_type === 'include';
}

function current_file_promotion_allowed(
    symbol_type: ReferenceScopedSymbolType,
    active_symbol_identity: string | undefined,
    current_uri: string,
    include_only_ancestry: boolean,
): boolean {
    if (active_symbol_identity !== current_uri) {
        return false;
    }
    if (symbol_type !== 'local_macro') {
        return true;
    }
    return include_only_ancestry;
}

/**
 * URIs in the query file's immediate scope chain + forward calls that should
 * participate in find-references for the queried `(type, name)`. Under Rule 1
 * (issue #135), same name + same kind within the reachable chain pool into
 * one identity — so both chain entries and forward-call sites are included
 * whenever they contribute a same-name-same-kind symbol, regardless of which
 * instance precedence would pick as the "winner". Callers union this result
 * with the transitive dep-graph-reachable set (see
 * `references.ts::collect_references` / `find_definitions`) to cover
 * sibling-caller cases that aren't in the query file's immediate chain.
 *
 * Returns a Map containing just `current_uri` when `scope` is undefined.
 */
export function collect_visible_reference_uris(
    scope: ResolvedScope | undefined,
    cursor_line: number,
    current_uri: string,
    symbol_type: ReferenceScopedSymbolType,
    symbol_name: string,
): Map<string, ReferenceScanRange> {
    const the_result = new Map<string, ReferenceScanRange>([[current_uri, {}]]);
    if (!scope) {
        return the_result;
    }

    const visible_symbols = get_visible_symbols_at(scope, cursor_line);
    const active_symbol_identity = get_reference_symbol_identity(
        get_reference_symbol_from_table(visible_symbols, symbol_type, symbol_name),
    );
    if (!active_symbol_identity) {
        return the_result;
    }

    // The cursor is only used to pick which definition the user clicked
    // "through" (when the same name has multiple visible instances). Once
    // that active instance is chosen, every file that could reference *that
    // definition* is a legitimate find-references hit — regardless of whether
    // its call site sits before or after the cursor in execution order. So
    // the forward-call loops below walk every forward call, not just those
    // before the cursor.

    interface SiteInclusion {
        include: boolean;
        scan_through_line?: number;
    }

    // Merge a new write into the result map.
    // - Full-scan (scan_through_line undefined) always wins over any cutoff.
    // - When both writes carry cutoffs, the smaller (tighter) one wins.
    const add_uri_to_result = (uri: string, range: ReferenceScanRange): void => {
        const existing = the_result.get(uri);
        if (!existing) {
            the_result.set(uri, range);
            return;
        }
        if (existing.scan_through_line === undefined) {
            return; // full scan already wins
        }
        if (range.scan_through_line === undefined) {
            the_result.set(uri, {}); // widen to full scan
            return;
        }
        if (range.scan_through_line < existing.scan_through_line) {
            the_result.set(uri, range); // tighter cutoff wins
        }
    };

    // Three-case rule (issue #135):
    // 1. Site defines the active symbol → include, full scan.
    // 2. Site redeclares the same name (same kind) → include, full scan.
    //    Rule 1: same name + same kind within the reachable chain is the
    //    same identity. Two in-chain redeclarations (e.g., a parent-file
    //    local and an included-file local) pool into one identity, so both
    //    pre- and post-redeclaration references belong to that identity.
    //    Disjoint-branch exclusion is already provided by dep-graph
    //    reachability filtering in references.ts, so the previous
    //    "different identity" cutoff has been retired.
    //
    // Note on `SiteInclusion.scan_through_line`: every branch below
    // currently returns `{ include }` with no cutoff, so all downstream
    // code that reads `scan_through_line` (this function's
    // `add_uri_to_result`, and references.ts's `find_definitions` /
    // `collect_references`) is dormant in practice. The field is kept
    // because Rule 1's pooling behaviour could legitimately be narrowed
    // in a future issue (e.g., per-call-site cutoffs for very large
    // dep graphs); restoring a partial cutoff would only require
    // `classify_site` to emit one. Do not remove the plumbing without
    // that future use in view.
    // 3. (symbol_visible_before_site OR site_is_after_current_file_call)
    //    and does not redeclare → include, full scan.
    // 4. Neither defines nor inherits → EXCLUDE.
    const classify_site = (
        site: ForwardCallSite,
        symbol_visible_before_site: boolean,
        site_defines_active_symbol: boolean,
        site_is_after_current_file_call: boolean,
    ): SiteInclusion => {
        const effective_visible = symbol_visible_before_site ||
            site_is_after_current_file_call;
        // Case 1: site defines the active symbol.
        if (site_defines_active_symbol) {
            return { include: true };
        }
        // Case 2: site redeclares the same (name, kind). In-chain
        // redeclarations pool as one identity (issue #135).
        const site_symbol = get_reference_symbol_from_table(
            site.symbols,
            symbol_type,
            symbol_name,
        );
        if (site_symbol) {
            return { include: true };
        }
        // Case 3: no redeclaration. Promote via effective_visible.
        if (effective_visible) {
            return { include: true };
        }
        // Case 4: neither defines nor inherits.
        return { include: false };
    };

    let include_only_ancestry: boolean = true;
    for (const my_entry of scope.chain) {
        const entry_has_include_only_ancestry: boolean =
            include_only_ancestry
            && my_entry.directive_type === 'included-by';
        let entry_visible_symbols = clone_symbol_table(my_entry.symbols);

        const the_entry_sites =
            my_entry.all_forward_call_sites
            ?? my_entry.forward_call_sites
            ?? [];
        for (const my_site of the_entry_sites) {
            const symbol_visible_before_site = symbol_table_matches_active_reference(
                entry_visible_symbols,
                symbol_type,
                symbol_name,
                active_symbol_identity,
            );
            const site_defines_active_symbol = symbol_table_matches_active_reference(
                my_site.symbols,
                symbol_type,
                symbol_name,
                active_symbol_identity,
            );
            // A sibling called after the current file (call_line > call_site_line)
            // can reference the current file's symbols because the current file has
            // already executed by then. The other two branches
            // (symbol_visible_before_site, site_defines_active_symbol) cannot cover
            // this case: ForwardScopeResolver's cycle detection excludes the
            // current file from the parent's forward-call resolution, so its
            // symbols never appear in entry_visible_symbols.
            // This is a variant of case 4 — passed into classify_site so
            // redeclaration handling (case 2) still applies correctly.
            const site_is_after_current_file_call =
                current_file_promotion_allowed(
                    symbol_type,
                    active_symbol_identity,
                    current_uri,
                    entry_has_include_only_ancestry,
                ) &&
                my_site.call_line > my_entry.call_site_line;
            if (can_reference_forward_site(symbol_type, my_site)) {
                const verdict = classify_site(
                    my_site,
                    symbol_visible_before_site,
                    site_defines_active_symbol,
                    site_is_after_current_file_call,
                );
                if (verdict.include) {
                    add_uri_to_result(my_site.callee_uri, {
                        scan_through_line: verdict.scan_through_line,
                    });
                }
            }
            entry_visible_symbols = merge_symbol_tables(
                entry_visible_symbols,
                my_site.symbols,
            );
        }

        // `entry_visible_symbols` now reflects the parent's full post-call
        // state. Under Rule 1 (issue #135), same name + same kind within the
        // reachable chain pool into one identity — so a chain entry with a
        // same-name-same-kind symbol is always a legitimate contributor,
        // regardless of which instance won precedence. This mirrors
        // classify_site Case 2 for the forward-call branch. The previous
        // precedence-based masking (entry's symbol identity must equal
        // active_symbol_identity) has been retired.
        const entry_has_same_kind_symbol =
            get_reference_symbol_from_table(
                entry_visible_symbols,
                symbol_type,
                symbol_name,
            ) !== undefined;
        const chain_entry_references_active =
            entry_has_same_kind_symbol ||
            current_file_promotion_allowed(
                symbol_type,
                active_symbol_identity,
                current_uri,
                entry_has_include_only_ancestry,
            );
        if (
            can_reference_chain_entry(symbol_type, my_entry.directive_type) &&
            chain_entry_references_active
        ) {
            add_uri_to_result(my_entry.uri, {});
        }
        include_only_ancestry = entry_has_include_only_ancestry;
    }

    let current_visible_symbols = clone_symbol_table(scope.symbols);
    for (const my_site of scope.forward_call_symbols ?? []) {
        const symbol_visible_before_site = symbol_table_matches_active_reference(
            current_visible_symbols,
            symbol_type,
            symbol_name,
            active_symbol_identity,
        );
        const site_defines_active_symbol = symbol_table_matches_active_reference(
            my_site.symbols,
            symbol_type,
            symbol_name,
            active_symbol_identity,
        );
        if (can_reference_forward_site(symbol_type, my_site)) {
            const verdict = classify_site(
                my_site,
                symbol_visible_before_site,
                site_defines_active_symbol,
                false,
            );
            if (verdict.include) {
                add_uri_to_result(my_site.callee_uri, {
                    scan_through_line: verdict.scan_through_line,
                });
            }
        }
        current_visible_symbols = merge_symbol_tables(
            current_visible_symbols,
            my_site.symbols,
        );
    }

    return the_result;
}

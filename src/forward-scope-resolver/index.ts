/**
 * Forward Scope Resolver for Cross-File Awareness
 *
 * Follows do/run/include commands and directives to build forward scope.
 */

import * as path from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';
import { CancellationToken } from 'vscode-languageserver/node';
import {
    SymbolTable,
    ForwardCall,
    ForwardCallType,
    EffectiveCallType,
    ForwardResolveContext,
    ForwardCallSite,
    ForwardResolvedScope,
    DuplicateCallDecision,
    DirectiveDiagnostic,
    MacroSymbol,
    StataDiagnosticCode,
} from '../types';
import { create_empty_symbol_table, merge_symbol_tables } from '../analyzer';
import { ScopeResolver } from '../scope-resolver';
import {
    resolve_path_rich,
    compute_forward_call_join,
    type RichResolveFs,
} from '../utils/file-path-utils';
import { get_workspace_root_for_path } from '../utils/workspace-roots';

export interface ForwardScopeConfig {
    max_forward_depth: number;
    diagnostics?: {
        max_depth?: 'error' | 'warning' | 'information' | 'off';
    };
}

const DEFAULT_CONFIG: ForwardScopeConfig = {
    max_forward_depth: 10,
};

export class ForwardScopeResolver {
    private scope_resolver: ScopeResolver;
    private default_config: ForwardScopeConfig;
    private workspace_roots: string[] = [];
    // Injected filesystem for resolve_path_rich (for tests only).
    // When undefined, resolve_path_rich uses the real Node fs.
    private resolve_fs?: RichResolveFs;

    constructor(scope_resolver: ScopeResolver, config: Partial<ForwardScopeConfig> = {}) {
        this.scope_resolver = scope_resolver;
        this.default_config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Set workspace roots (filesystem paths) for cache-first mode guarding.
     */
    set_workspace_roots(roots: string[]): void {
        this.workspace_roots = roots.map(r => path.resolve(r));
    }

    /**
     * Inject a filesystem implementation for `resolve_path_rich`.
     * For testing only — production code leaves this undefined so
     * `resolve_path_rich` uses the real Node `fs`.
     */
    set_resolve_fs(injected_fs: RichResolveFs): void {
        this.resolve_fs = injected_fs;
    }

    /**
     * Check if a filesystem path is within any workspace root.
     */
    private is_within_workspace_roots(fs_path: string): boolean {
        if (this.workspace_roots.length === 0) {
            return false;
        }
        const resolved = path.resolve(fs_path);
        return this.workspace_roots.some(root => resolved.startsWith(root + path.sep) || resolved === root);
    }

    /**
     * Re-resolve a forward call path using the working directory context
     * and the rich path resolver for case-insensitive fallback.
     *
     * Replaces the former ad-hoc `existsSync` + `.do` chain.  The
     * joined path is computed via `compute_forward_call_join` (same logic
     * as the dependency graph) and classified by `resolve_path_rich`.
     *
     * Returns `{ resolved_path, outcome_kind, ... }`:
     * - `exact`     → use `resolved_path`; no diagnostic needed.
     * - `case_only` → use `resolved_path` (real-cased); caller should
     *                 emit a `path_case_mismatch` diagnostic.
     * - `ambiguous` / `missing` → `resolved_path` is the as-joined
     *   path; `get_callee_scope` will return an error and the caller
     *   emits the existing "Cannot read file" diagnostic.
     */
    private resolve_call_path(
        raw_path: string,
        original_resolved_path: string,
        _caller_uri: string,
        working_directory?: string,
    ): {
        resolved_path: string;
        outcome_kind: 'exact' | 'case_only' | 'ambiguous' | 'missing';
        requested_path?: string;
        seed_dir?: string;
    } {
        // Compute the joined absolute path (WD-priority for relative paths)
        const my_joined = compute_forward_call_join(
            raw_path,
            original_resolved_path,
            working_directory,
        );

        const my_rich_opts = {
            try_do_fallback: true,
            workspace_roots: this.workspace_roots.length > 0
                ? this.workspace_roots
                : undefined,
            fs: this.resolve_fs,
        };

        // Classify the WD-priority join via resolve_path_rich
        const my_outcome = resolve_path_rich(my_joined, my_rich_opts);

        if (my_outcome.kind === 'exact') {
            return {
                resolved_path: my_outcome.path,
                outcome_kind: 'exact',
            };
        }

        if (my_outcome.kind === 'case_only') {
            // Find the containing workspace root to seed the host probe
            const my_seed = this.find_seed_dir(my_outcome.path);
            return {
                resolved_path: my_outcome.path,
                outcome_kind: 'case_only',
                requested_path: my_outcome.requested,
                seed_dir: my_seed,
            };
        }

        // WD-priority join was missing or ambiguous: return the outcome so
        // the caller can report accordingly.  No second fallback — the dep-
        // graph uses compute_forward_call_join exclusively; diverging here
        // would mean edges and diagnostics disagree on which URI is the callee.
        return {
            resolved_path: my_joined,
            outcome_kind: my_outcome.kind,
        };
    }

    /**
     * Find the workspace root that contains `fs_path` (the deepest one).
     * Returns it as the seed directory for the host case-sensitivity probe.
     * Falls back to the file's own directory if no workspace root matches.
     *
     * Delegates to the shared `get_workspace_root_for_path` helper so
     * there is one source of truth for the deepest-containing-root search.
     */
    private find_seed_dir(fs_path: string): string {
        return (
            get_workspace_root_for_path(this.workspace_roots, fs_path) ??
            path.dirname(fs_path)
        );
    }

    /**
     * Simple path resolver used by
     * `compute_effective_end_state_locals`.  Routes through
     * `compute_forward_call_join` + `resolve_path_rich` (with the
     * resolver's `workspace_roots`) so that case-only paths are resolved
     * to their real-cased on-disk path — consistent with `resolve_call_path`
     * and the dependency graph.  Does NOT emit diagnostics; the returned
     * path is used only to read the file for end-state computation.
     *
     * Returns the real-cased path for exact/case_only outcomes, the
     * as-joined path for ambiguous/missing (which will produce an error in
     * `get_callee_scope`, matching today's behavior).
     */
    private resolve_call_path_simple(
        raw_path: string,
        original_resolved_path: string,
        working_directory?: string,
    ): string {
        const my_joined = compute_forward_call_join(
            raw_path,
            original_resolved_path,
            working_directory,
        );

        const my_outcome = resolve_path_rich(my_joined, {
            try_do_fallback: true,
            workspace_roots: this.workspace_roots.length > 0
                ? this.workspace_roots
                : undefined,
            fs: this.resolve_fs,
        });

        if (
            my_outcome.kind === 'exact' ||
            my_outcome.kind === 'case_only'
        ) {
            return my_outcome.path;
        }

        // ambiguous or missing: fall through; get_callee_scope will error
        return my_joined;
    }

    /**
     * Resolve forward scope for a file.
     *
     * @param config               - Per-call config (max_forward_depth etc).
     *                               Merged with defaults.
     * @param diagnostic_owner_uri - URI of the file whose diagnostics are
     *                               being collected.  Only
     *                               `path_case_mismatch` diagnostics for
     *                               forward calls written directly in this
     *                               file (file_uri === diagnostic_owner_uri
     *                               at depth 0) are emitted.  Nested callee
     *                               resolution resolves leniently but
     *                               suppresses the diagnostic.  Pass
     *                               `undefined` to suppress all
     *                               path_case_mismatch emission (e.g., when
     *                               building an ancestor's inherited scope).
     */
    async resolve(
        file_uri: string,
        forward_calls: ForwardCall[],
        effective_call_type: EffectiveCallType = 'include',
        context?: ForwardResolveContext,
        recursion_stack?: Set<string>,
        token?: CancellationToken,
        config?: Partial<ForwardScopeConfig>,
        diagnostic_owner_uri?: string,
    ): Promise<ForwardResolvedScope> {
        const resolved_config = { ...this.default_config, ...config };
        // Check cancellation at entry
        if (token?.isCancellationRequested) {
            return { symbols: create_empty_symbol_table(), call_sites: [], diagnostics: [] };
        }

        // At the entry point (no incoming context) set diagnostic_owner_uri.
        // When a context is passed in (recursive call), the owner is already
        // set and must be preserved unchanged.
        const my_context: ForwardResolveContext = context ?? {
            visited: new Map(),
            effective_call_type,
            depth: 0,
            diagnostics: [],
            working_directory: undefined,
            call_chain: [],
            diagnostic_owner_uri,
        };
        
        // Track current recursion stack for cycle detection
        const my_stack = recursion_stack ?? new Set<string>();
        my_stack.add(file_uri);

        const the_call_sites: ForwardCallSite[] = [];
        let accumulated_symbols = create_empty_symbol_table();

        // Filter to only static calls and sort by call_site_line
        // This ensures earlier calls are processed first, which is important for
        // duplicate detection (the earliest call to a file should win)
        const static_calls = forward_calls
            .filter(call => call.is_static && call.path)
            .sort((a, b) => a.call_site_line - b.call_site_line);

        for (const my_call of static_calls) {
            // Check cancellation in loop
            if (token?.isCancellationRequested) {
                my_stack.delete(file_uri);
                return { symbols: accumulated_symbols, call_sites: the_call_sites, diagnostics: my_context.diagnostics };
            }

            // Build call chain prefix for diagnostic messages
            const call_chain = my_context.call_chain ?? [];
            const source_prefix = call_chain.length > 0
                ? `${call_chain.join(' -> ')}: `
                : '';

            // Check depth limit
            if (my_context.depth >= resolved_config.max_forward_depth) {
                // Always emit diagnostic when max depth is exceeded
                const diagnostic: DirectiveDiagnostic = {
                    message: `${source_prefix}Maximum forward resolution depth (${resolved_config.max_forward_depth}) exceeded`,
                    severity: 'information',
                    range: {
                        start: { line: my_call.call_site_line, character: 0 },
                        end: { line: my_call.call_site_line, character: 0 }
                    },
                    source: {
                        source_file: path.basename(my_call.path),
                        source_line: my_call.call_site_line,
                        original_range: my_call.range
                    }
                };
                my_context.diagnostics.push(diagnostic);
                // Skip this call to prevent excessive recursion
                continue;
            }

            // Compute effective call type for this call
            const my_effective_type = this.compute_effective_call_type(
                my_call.type,
                my_context.effective_call_type
            );

            // Re-resolve the path using the rich resolver (handles WD,
            // .do fallback, and case-only mismatches uniformly).
            const my_path_result = this.resolve_call_path(
                my_call.raw_path,
                my_call.path,
                file_uri,
                my_context.working_directory,
            );
            const resolved_path = my_path_result.resolved_path;
            const callee_uri = URI.file(resolved_path).toString();

            // Single-emission guard: emit path_case_mismatch only when
            // this file_uri is the diagnosed file (depth 0 in the
            // diagnostic_owner_uri's own resolve() pass).
            if (
                my_path_result.outcome_kind === 'case_only' &&
                my_context.diagnostic_owner_uri !== undefined &&
                file_uri === my_context.diagnostic_owner_uri &&
                my_context.depth === 0
            ) {
                const my_requested = my_path_result.requested_path ??
                    my_call.raw_path;
                const my_real = my_path_result.resolved_path;
                // Show relative paths in the message when possible
                const my_req_disp = path.relative(
                    path.dirname(URI.parse(file_uri).fsPath),
                    my_requested,
                ).replace(/\\/g, '/') || my_requested;
                const my_real_disp = path.relative(
                    path.dirname(URI.parse(file_uri).fsPath),
                    my_real,
                ).replace(/\\/g, '/') || my_real;
                my_context.diagnostics.push({
                    message:
                        `Path "${my_req_disp}" does not match the file ` +
                        `on disk "${my_real_disp}"; Stata will not find ` +
                        `it on case-sensitive filesystems (Linux). ` +
                        `Update the path to match.`,
                    range: my_call.range,
                    severity: 'warning',
                    kind: 'path_case_mismatch',
                    code: StataDiagnosticCode.PATH_CASE_MISMATCH,
                    case_mismatch_seed_dir: my_path_result.seed_dir,
                    source: {
                        source_file: path.basename(
                            URI.parse(file_uri).fsPath,
                        ),
                        source_line: my_call.call_site_line,
                        original_range: my_call.range,
                    },
                });
            }
            
            // For ambiguous outcome, emit "Cannot read file" and skip.
            // We must NOT call get_callee_scope for ambiguous paths: on a
            // case-insensitive host, existsSync would pick one of the two
            // ci matches and succeed, masking the ambiguity.
            if (my_path_result.outcome_kind === 'ambiguous') {
                const my_source_filename = path.basename(
                    URI.parse(file_uri).fsPath,
                );
                my_context.diagnostics.push({
                    message:
                        `${source_prefix}Cannot read file: ` +
                        `${my_call.raw_path}`,
                    range: my_call.range,
                    severity: 'warning',
                    // Structural kind for routing; substring fallback in
                    // the converter is preserved for backward compat.
                    kind: 'missing_file',
                    source: {
                        source_file: my_source_filename,
                        source_line: my_call.call_site_line,
                        original_range: my_call.range,
                    },
                });
                continue;
            }

            // For missing outcome, fall through to get_callee_scope so
            // the existing "tried:" message is preserved (backward compat).

            // Check for cycle in current recursion stack
            if (my_stack.has(callee_uri)) {
                // Skip this call to prevent infinite recursion, but don't emit diagnostic
                continue;
            }

            const decision = this.should_process_call(callee_uri, my_call.type, my_context.visited);

            if (decision.action === 'skip') {
                continue;
            }

            // Short-circuit a nested boundary_only re-visit before the
            // disk-backed callee scope fetch. The site would be bubbled
            // up and have its excluded_locals stripped by the flattening
            // loop anyway, so skipping avoids an unnecessary parse.
            if (decision.action === 'boundary_only' && my_context.depth > 0) {
                continue;
            }

            // Get callee symbols
            const callee_result = await this.get_callee_scope(resolved_path, callee_uri, my_context.working_directory);

            if (decision.action === 'boundary_only') {
                // Dedup'd do/run re-visit at the outermost resolve()
                // level: don't re-merge symbols or recurse, but push a
                // barrier-only site with excluded_locals so the
                // diagnostic rewrite can blame the second boundary's
                // callee under last-visible-site precedence.
                if (token?.isCancellationRequested) {
                    my_stack.delete(file_uri);
                    return { symbols: accumulated_symbols, call_sites: the_call_sites, diagnostics: my_context.diagnostics };
                }
                if ('error' in callee_result) {
                    continue;
                }
                // effective_type === 'do' always holds here (this branch
                // fires only when the previous visit was 'do' and the
                // current call is do/run). Compute the include-only
                // end-state so the rewrite can name the second visit's
                // blame file.
                const effective_end_state = await this.compute_effective_end_state_locals(
                    callee_uri,
                    resolved_path,
                    callee_result.working_directory ?? my_context.working_directory,
                    new Set(my_stack),
                    my_context.depth + 1,
                    resolved_config,
                    token,
                );
                const boundary_excluded = effective_end_state.size > 0 ? effective_end_state : undefined;
                the_call_sites.push({
                    callee_uri,
                    call_line: my_call.call_site_line,
                    symbols: create_empty_symbol_table(),
                    effective_type: my_effective_type,
                    excluded_locals: boundary_excluded,
                });
                continue;
            }
            
            // Check cancellation after await
            if (token?.isCancellationRequested) {
                my_stack.delete(file_uri);
                return { symbols: accumulated_symbols, call_sites: the_call_sites, diagnostics: my_context.diagnostics };
            }

            if ('error' in callee_result) {
                // Build diagnostic message with source file context
                const error_suffix = callee_result.error.includes('(tried:')
                    ? ' ' + callee_result.error.substring(callee_result.error.indexOf('(tried:'))
                    : '';
                
                // Extract source filename from URI for source attribution
                const source_filename = path.basename(URI.parse(file_uri).fsPath);
                
                my_context.diagnostics.push({
                    message: `${source_prefix}Cannot read file: ${my_call.raw_path}${error_suffix}`,
                    range: my_call.range,
                    severity: 'warning',
                    source: {
                        source_file: source_filename,
                        source_line: my_call.call_site_line,
                        original_range: my_call.range,
                    },
                });
                continue;
            }

            // Mark as visited (for duplicate optimization)
            my_context.visited.set(callee_uri, my_effective_type);

            // Apply inheritance rules
            let inherited_symbols: SymbolTable;
            if (decision.action === 'add_locals_only') {
                // Only add locals from include after do
                inherited_symbols = {
                    programs: new Map(),
                    localMacros: new Map(callee_result.symbols.localMacros),
                    globalMacros: new Map(),
                    variables: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                };
            } else {
                inherited_symbols = this.apply_forward_inheritance(
                    callee_result.symbols,
                    my_effective_type
                );
            }

            // Direct-child do/run sites at the outermost resolve() get
            // their include-only end-state computed so the blame rewrite
            // can name a file. Nested sites flow through the flattening
            // loop below, which strips excluded_locals unconditionally —
            // computing them at nested depths would be dead work.
            //
            // `my_effective_type === 'do'` is guaranteed when
            // `my_call.type !== 'include'` at depth 0 (outer
            // effective_call_type is 'include' and compute_effective_call_type
            // returns 'do' for non-include calls), so the condition is
            // redundant but kept for defensive clarity.
            let excluded_locals: Map<string, MacroSymbol> | undefined;
            if (my_call.type !== 'include' && my_effective_type === 'do' && my_context.depth === 0) {
                const effective_end_state = await this.compute_effective_end_state_locals(
                    callee_uri,
                    resolved_path,
                    callee_result.working_directory ?? my_context.working_directory,
                    new Set(my_stack),
                    my_context.depth + 1,
                    resolved_config,
                    token,
                );
                if (effective_end_state.size > 0) {
                    excluded_locals = effective_end_state;
                }
            }
            the_call_sites.push({
                callee_uri,
                call_line: my_call.call_site_line,
                symbols: inherited_symbols,
                effective_type: my_effective_type,
                excluded_locals,
            });

            // Accumulate symbols
            accumulated_symbols = merge_symbol_tables(accumulated_symbols, inherited_symbols);

            // Recursively resolve callee's forward calls
            if (callee_result.forward_calls.length > 0) {
                const nested_result = await this.resolve(
                    callee_uri,
                    callee_result.forward_calls,
                    my_effective_type,
                    {
                        visited: my_context.visited,
                        effective_call_type: my_effective_type,
                        depth: my_context.depth + 1,
                        diagnostics: my_context.diagnostics,
                        working_directory: callee_result.working_directory ?? my_context.working_directory,
                        call_chain: [...(my_context.call_chain ?? []), my_call.raw_path],
                        // Pass the original owner through unchanged so the
                        // single-emission guard remains correct: nested
                        // callee calls are at depth > 0 relative to the
                        // owner and therefore suppress their own
                        // path_case_mismatch emission.
                        diagnostic_owner_uri: my_context.diagnostic_owner_uri,
                    },
                    my_stack,
                    token,
                    resolved_config,
                );

                // Check cancellation after recursive call
                if (token?.isCancellationRequested) {
                    my_stack.delete(file_uri);
                    return { symbols: accumulated_symbols, call_sites: the_call_sites, diagnostics: my_context.diagnostics };
                }

                // Add nested call sites with adjusted call lines. Nested sites inherit
                // the parent call_line for visibility filtering, but their
                // `excluded_locals` are ALWAYS stripped: each nested site's blame
                // target represents a different one-line fix (promoting that deeper
                // do/run to include) than the one the outer reference's diagnostic is
                // about to suggest. Only the direct-child site's excluded_locals claim
                // applies to the user's visible "do X" they could edit.
                for (const nested_site of nested_result.call_sites) {
                    the_call_sites.push({
                        ...nested_site,
                        call_line: my_call.call_site_line,
                        excluded_locals: undefined,
                    });
                }

                accumulated_symbols = merge_symbol_tables(
                    accumulated_symbols,
                    nested_result.symbols
                );
            }
        }
        
        // Remove from recursion stack when done processing this file
        my_stack.delete(file_uri);

        return {
            symbols: accumulated_symbols,
            call_sites: the_call_sites,
            diagnostics: my_context.diagnostics,
        };
    }

    /**
     * Apply forward inheritance rules.
     */
    apply_forward_inheritance(
        callee_symbols: SymbolTable,
        effective_call_type: EffectiveCallType
    ): SymbolTable {
        if (effective_call_type === 'include') {
            return callee_symbols;
        }

        // do/run: exclude local macros
        return {
            programs: new Map(callee_symbols.programs),
            localMacros: new Map(),
            globalMacros: new Map(callee_symbols.globalMacros),
            variables: new Map(callee_symbols.variables),
            scalars: new Map(callee_symbols.scalars),
            matrices: new Map(callee_symbols.matrices),
        };
    }

    /**
     * Compute effective call type considering parent chain.
     */
    compute_effective_call_type(
        call_type: ForwardCallType,
        parent_effective_type: EffectiveCallType
    ): EffectiveCallType {
        // If parent was 'do', locals can't pass through
        if (parent_effective_type === 'do') {
            return 'do';
        }
        // run is treated as do
        return call_type === 'include' ? 'include' : 'do';
    }

    /**
     * Determine how to handle a call to a file.
     */
    should_process_call(
        callee_uri: string,
        call_type: ForwardCallType,
        visited: Map<string, EffectiveCallType>
    ): DuplicateCallDecision {
        const previous_type = visited.get(callee_uri);

        if (previous_type === undefined) {
            return { action: 'process' };
        }

        if (previous_type === 'include') {
            return { action: 'skip' };
        }

        // previous_type === 'do'
        if (call_type === 'include') {
            return { action: 'add_locals_only' };
        }

        // previous_type === 'do' && (call_type === 'do' || 'run').
        // Symbol accumulation is unchanged (do/run don't add caller locals),
        // but this is still a distinct blocking boundary whose promotion
        // would rebind names. Emit a boundary-only site so the diagnostic
        // rewrite sees its excluded_locals claim.
        return { action: 'boundary_only' };
    }

    /**
     * Filter forward calls to only include those that occur before a given line.
     * Returns calls sorted by call_site_line ascending.
     * @param forward_calls - Array of forward calls to filter
     * @param line - The line number (0-indexed) to filter by
     * @returns Filtered and sorted array of forward calls where call_site_line < line
     */
    filter_calls_before_line(
        forward_calls: ForwardCall[],
        line: number
    ): ForwardCall[] {
        return forward_calls
            .filter(call => call.call_site_line < line)
            .sort((a, b) => a.call_site_line - b.call_site_line);
    }

    /**
     * Get symbols visible at a specific line, considering call-site boundaries.
     * Symbols from forward calls are only visible after their call site.
     * @param base_symbols - Symbols from backward resolution and current file
     * @param call_sites - Forward call sites with their symbols
     * @param query_line - The line number to query (0-indexed)
     */
    get_symbols_at_line(
        base_symbols: SymbolTable,
        call_sites: ForwardCallSite[],
        query_line: number
    ): SymbolTable {
        // Start with base symbols
        let result = {
            programs: new Map(base_symbols.programs),
            localMacros: new Map(base_symbols.localMacros),
            globalMacros: new Map(base_symbols.globalMacros),
            variables: new Map(base_symbols.variables),
            scalars: new Map(base_symbols.scalars),
            matrices: new Map(base_symbols.matrices),
        };

        // Add symbols from call sites where call_line < query_line
        for (const call_site of call_sites) {
            if (call_site.call_line < query_line) {
                result = merge_symbol_tables(result, call_site.symbols);
            }
        }

        return result;
    }

    /**
     * Walk a callee's top-level local definitions and nested `include` calls
     * in source order to compute the effective end-of-file local-macro state
     * assuming the caller's `do`/`run` of this callee were promoted to
     * `include`. `do`/`run` calls FROM this callee are NOT descended — they
     * are still blocking boundaries after the single-boundary promotion, so
     * their bindings are not exposed by this one-line fix.
     *
     * - Own `local X` statements overwrite prior bindings.
     * - `include` events merge the nested callee's effective end state
     *   (recursively computed) into the walk.
     * - `do`/`run` events contribute nothing.
     *
     * Used to populate `ForwardCallSite.excluded_locals` for `do`-called
     * sites so OUT_OF_SCOPE_SYMBOL diagnostics point at the callee whose
     * local actually wins under a single-boundary promotion.
     */
    private async compute_effective_end_state_locals(
        callee_uri: string,
        callee_fs_path: string,
        working_directory: string | undefined,
        stack: Set<string>,
        depth: number,
        resolved_config: ForwardScopeConfig,
        token?: CancellationToken,
    ): Promise<Map<string, MacroSymbol>> {
        if (token?.isCancellationRequested) return new Map();
        if (stack.has(callee_uri)) return new Map();
        // Callers invoke with `my_context.depth + 1`, so at `depth == max` we
        // are still on a file the outer resolver is allowed to process. Only
        // bail when a further hop would exceed the configured maximum.
        if (depth > resolved_config.max_forward_depth) return new Map();

        const callee_result = await this.get_callee_scope(
            callee_fs_path,
            callee_uri,
            working_directory,
        );
        if ('error' in callee_result) return new Map();

        stack.add(callee_uri);
        try {
            type WalkEvent =
                | { line: number; character: number; kind: 'local'; name: string; symbol: MacroSymbol }
                | { line: number; character: number; kind: 'call'; call: ForwardCall };

            const the_events: WalkEvent[] = [];
            for (const [my_name, my_symbol] of callee_result.symbols.localMacros) {
                if (my_symbol.containingScope !== 'dofile') continue;
                // Emit one event per definition: the primary plus each entry
                // in `additional_definitions`. `SemanticAnalyzer` implements
                // first-def-wins, so every later `local X` in the same file
                // is stashed under the primary's `additional_definitions`.
                // Without this, a `local X` that follows an `include` (which
                // itself bound X to something else) would be invisible to the
                // effective-end-state walk and the wrong callee would be
                // blamed. `sourceUri` matches across every definition of the
                // same local in the same file, so attributing the symbol
                // payload back to the primary remains correct.
                //
                // Carry the character position too: under `#delimit ;`, a
                // local and an include can share a physical line, and
                // sorting on line alone would collapse their execution
                // order. Full (line, character) ordering is robust to
                // that shape as well as today's `#delimit cr` input.
                // Both coordinates come from the same source
                // (location.range.start) so the sort key is internally
                // consistent — analyzer emits definition_line equal to
                // location.range.start.line for primary definitions.
                const primary_line = my_symbol.location.range.start.line;
                const primary_char = my_symbol.location.range.start.character;
                the_events.push({
                    line: primary_line,
                    character: primary_char,
                    kind: 'local',
                    name: my_name,
                    symbol: my_symbol,
                });
                if (my_symbol.additional_definitions) {
                    for (const my_extra of my_symbol.additional_definitions) {
                        the_events.push({
                            line: my_extra.line,
                            character: my_extra.location.range.start.character,
                            kind: 'local',
                            name: my_name,
                            symbol: my_symbol,
                        });
                    }
                }
            }
            for (const my_call of callee_result.forward_calls) {
                if (!my_call.is_static || !my_call.path) continue;
                // Include-only descent. `do`/`run` callees run in a fresh scope
                // and leave no bindings behind for the caller's end-of-execution
                // state — promoting them to `include` is a separate fix from the
                // one this helper's blame rewrite suggests.
                if (my_call.type !== 'include') continue;
                the_events.push({
                    line: my_call.call_site_line,
                    character: my_call.range.start.character,
                    kind: 'call',
                    call: my_call,
                });
            }
            the_events.sort((a, b) => a.line - b.line || a.character - b.character);

            const the_effective = new Map<string, MacroSymbol>();
            const nested_working_dir = callee_result.working_directory ?? working_directory;
            for (const my_event of the_events) {
                if (token?.isCancellationRequested) break;
                if (my_event.kind === 'local') {
                    the_effective.set(my_event.name, my_event.symbol);
                } else {
                    // Use the simple resolver here: compute_effective_end_state_locals
                    // does not emit diagnostics, so the rich resolve_path_rich
                    // classification is unnecessary and its walk-from-root
                    // behavior can fail in sandbox environments.
                    const nested_resolved = this.resolve_call_path_simple(
                        my_event.call.raw_path,
                        my_event.call.path,
                        nested_working_dir,
                    );
                    const nested_uri = URI.file(nested_resolved).toString();
                    const nested_effective = await this.compute_effective_end_state_locals(
                        nested_uri,
                        nested_resolved,
                        nested_working_dir,
                        stack,
                        depth + 1,
                        resolved_config,
                        token,
                    );
                    for (const [my_name, my_symbol] of nested_effective) {
                        the_effective.set(my_name, my_symbol);
                    }
                }
            }
            return the_effective;
        } finally {
            stack.delete(callee_uri);
        }
    }

    /**
     * Get callee scope from disk, reusing ScopeResolver cache.
     * ScopeResolver now caches forward_calls along with symbols.
     * Uses cache-first mode only for files within workspace roots.
     * @param working_directory - Optional inherited working directory for path resolution
     */
    private async get_callee_scope(
        fs_path: string,
        uri: string,
        working_directory?: string
    ): Promise<{ symbols: SymbolTable; forward_calls: ForwardCall[]; working_directory?: string } | { error: string }> {
        let final_fs_path = fs_path;
        let final_uri = uri;
        const paths_tried: string[] = [fs_path];

        // Check if original path exists
        if (!fs.existsSync(fs_path)) {
            // Try .do fallback if original doesn't end with .do
            if (!fs_path.endsWith('.do')) {
                const do_path = fs_path + '.do';
                paths_tried.push(do_path);
                if (fs.existsSync(do_path)) {
                    final_fs_path = do_path;
                    final_uri = URI.file(do_path).toString();
                }
            }
        }

        // Only use cache-first mode for files within workspace roots
        const skip_disk_if_cached = this.is_within_workspace_roots(final_fs_path);
        const parsed_result = await this.scope_resolver.get_parsed_file(final_uri, final_fs_path, { skip_disk_if_cached, working_directory });
        if ('error' in parsed_result) {
            const paths_msg = paths_tried.length > 1 ? ` (tried: ${paths_tried.join(', ')})` : '';
            return { error: parsed_result.error + paths_msg };
        }

        return {
            symbols: parsed_result.symbols,
            forward_calls: parsed_result.forward_calls,
            working_directory: parsed_result.working_directory,
        };
    }

    /**
     * Dispose the forward scope resolver.
     * Called during server shutdown to release resources.
     * The ForwardScopeResolver delegates caching to ScopeResolver,
     * so there are no internal caches to clear here.
     */
    dispose(): void {
        // No internal caches to clear — caching is delegated to ScopeResolver
    }

}
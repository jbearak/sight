/**
 * File path utilities for Sight
 */

import * as node_fs from 'fs';
import * as node_path from 'path';
import {
    entry_is_directory_sync,
    entry_is_file_sync,
} from './symlink-aware-entry';

// Commands that accept file paths as their first argument
export const FILE_COMMANDS = new Set([
  'do', 'run', 'include',
  'use', 'save', 'append', 'merge',
  'import', 'export',
  'cd', 'adopath'
]);

// LSP directives that accept file paths
export const PATH_DIRECTIVES = new Set([
  '@lsp-done-by',
  '@lsp-run-by',
  '@lsp-included-by', 
  '@lsp-do',
  '@lsp-run',
  '@lsp-include',
  '@lsp-working-directory',
  '@lsp-working-dir',
  '@lsp-current-directory',
  '@lsp-current-dir',
  '@lsp-cd',
  '@lsp-wd'
]);

// Stata file extensions for completion filtering
export const STATA_FILE_EXTENSIONS = ['.do', '.ado', '.doh', '.mata'];

// Version-control metadata directories skipped during workspace scans.
// They contain no Stata source and recursing them is wasted work.
export const VCS_METADATA_DIRS = new Set(['.git', '.hg', '.svn']);

/**
 * Check if a command accepts file paths as its first argument
 */
export function isFileCommand(command: string): boolean {
  return FILE_COMMANDS.has(command);
}

/**
 * Check if a directive accepts file paths
 */
export function isPathDirective(directive: string): boolean {
  const normalized = directive.trim().toLowerCase()
    .replace(/^sight:\s*/, '@lsp-');
  return PATH_DIRECTIVES.has(normalized);
}

/**
 * Check if a file has a Stata extension
 */
export function hasStataExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return STATA_FILE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// ─── Rich path resolver ───────────────────────────────────────────────────────

/**
 * Outcome of a rich path resolution attempt.
 *
 * - `exact`     – the on-disk casing matches the requested path exactly.
 * - `case_only` – a unique case-insensitive match was found; `path` is the
 *                 real on-disk path, `requested` is the original input.
 * - `ambiguous` – two or more case-insensitive matches exist; caller should
 *                 warn and pick none.
 * - `missing`   – no match found at all.
 */
export type PathCaseOutcome =
    | { kind: 'exact';     path: string }
    | { kind: 'case_only'; path: string; requested: string }
    | { kind: 'ambiguous'; requested: string; matches: string[] }
    | { kind: 'missing';   requested: string };

/**
 * Filesystem interface injected for testing. Matches the Node `fs` module
 * subset used by `resolve_path_rich`.
 */
export interface RichResolveFs {
    readdirSync(
        p: string,
        opts: { withFileTypes: true },
    ): Array<{
        name: string;
        isFile(): boolean;
        isDirectory(): boolean;
        isSymbolicLink(): boolean;
    }>;
    existsSync(p: string): boolean;
    /** Stat a path, following symlinks. Throws on dangling symlinks. */
    statSync(p: string): { isFile(): boolean; isDirectory(): boolean };
}

export interface RichResolveOptions {
    /** Append `.do` when the final component has no extension (default true). */
    try_do_fallback?: boolean;
    /**
     * Directories that form the workspace boundary. The walk starts at the
     * deepest root that is a prefix of `resolved_fs_path`. Paths outside all
     * roots get plain existence semantics (no case handling).
     */
    workspace_roots?: string[];
    /**
     * Injected filesystem for tests. Defaults to Node `fs` with
     * `{ withFileTypes: true }`.
     */
    fs?: RichResolveFs;
}

/**
 * Build a production `RichResolveFs` backed by the real Node `fs` module.
 * Tests always inject `options.fs` and never hit this path.
 */
function make_default_fs(): RichResolveFs {
    return {
        readdirSync: (p: string, opts: { withFileTypes: true }) =>
            node_fs.readdirSync(p, opts) as Array<{
                name: string;
                isFile(): boolean;
                isDirectory(): boolean;
                isSymbolicLink(): boolean;
            }>,
        existsSync: (p: string) => node_fs.existsSync(p),
        statSync: (p: string) => node_fs.statSync(p),
    };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Fold an ASCII letter to lowercase. Non-ASCII characters are returned
 * unchanged. A–Z (65–90) fold to a–z (97–122); all others unchanged.
 */
function ascii_to_lower(c: string): string {
    const code = c.charCodeAt(0);
    // A–Z: 65–90 → a–z: 97–122
    if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
    return c;
}

/**
 * ASCII-only case-insensitive equality. Folds only A–Z / a–z; non-ASCII
 * compares byte-exactly.
 */
function ascii_ci_equal(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const my_a = a[i]!;
        const my_b = b[i]!;
        if (my_a === my_b) continue;
        // Check if they differ only in ASCII case
        if (ascii_to_lower(my_a) !== ascii_to_lower(my_b)) return false;
    }
    return true;
}

/**
 * True if the path has a file extension (any `.something` after the last
 * path separator).
 */
function has_extension(name: string): boolean {
    const dot_idx = name.lastIndexOf('.');
    return dot_idx > 0; // dot_idx === 0 means hidden file like ".gitignore"
}

// ─── Symlink-aware entry helpers ──────────────────────────────────────────────
//
// The symlink-aware classification logic lives in
// `./symlink-aware-entry` so it is shared with the indexer, `sight
// check` source discovery, and path completion (issue #219).
// `RichResolveFs.statSync` satisfies the shared `StatSyncFs` seam, so
// these thin aliases keep the resolver's existing call sites unchanged.

const entry_is_dir = entry_is_directory_sync;
const entry_is_file = entry_is_file_sync;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve `resolved_fs_path` with case-insensitive fallback.
 *
 * The caller has already joined the path against the correct base directory.
 * This function classifies the result as exact / case_only / ambiguous /
 * missing by walking from the containing workspace root and consulting
 * directory listings at every component (never trusting `existsSync` for
 * casing).
 *
 * Paths outside every `workspace_roots` entry (or when no roots are
 * supplied) fall back to plain existence semantics: `exact` if the file
 * exists (with `.do` fallback when `try_do_fallback` is true and the final
 * component has no extension), `missing` otherwise. Case-insensitive
 * resolution is workspace-bounded; callers should pass the analyzed file's
 * own root as a `workspace_roots` entry to enable case handling.
 */
export function resolve_path_rich(
    resolved_fs_path: string,
    options?: RichResolveOptions,
): PathCaseOutcome {
    // Tests inject `options.fs`; otherwise fall back to the Node `fs`
    // default. The default reads the real filesystem, so it only runs in
    // production / integration paths, never in the injected-fs unit tests.
    const the_fs: RichResolveFs = options?.fs ?? make_default_fs();
    const try_do_fallback = options?.try_do_fallback ?? true;
    const the_roots = options?.workspace_roots ?? [];

    // Normalise path separators (OS-agnostic; tests use '/' on all platforms)
    const sep = '/';
    const norm_path = resolved_fs_path.split('\\').join(sep);

    // ── Find the best (longest) containing workspace root ────────────────────
    let chosen_root: string | null = null;
    let chosen_root_len = -1;
    for (const my_root of the_roots) {
        const my_norm = my_root.split('\\').join(sep);
        // The path must start with the root followed by '/' (or equal it)
        const my_prefix = my_norm.endsWith(sep)
            ? my_norm
            : my_norm + sep;
        if (
            norm_path.startsWith(my_prefix) &&
            my_norm.length > chosen_root_len
        ) {
            chosen_root = my_norm;
            chosen_root_len = my_norm.length;
        }
    }

    // ── Outside all workspace roots (or no roots supplied) ───────────────────
    // Plain-existence semantics: no directory enumeration, no case handling.
    // Case-insensitive resolution is workspace-bounded; callers should pass
    // the analyzed file's own root as a workspace_roots entry when they want
    // case handling. Without roots we cannot know which volume to probe.
    if (chosen_root === null) {
        // Try exact path first.
        if (the_fs.existsSync(norm_path)) {
            return { kind: 'exact', path: norm_path };
        }
        // Apply .do fallback when the final component has no extension.
        if (try_do_fallback) {
            const my_final = norm_path.split(sep).at(-1) ?? '';
            if (!has_extension(my_final)) {
                const my_do_path = norm_path + '.do';
                if (the_fs.existsSync(my_do_path)) {
                    return { kind: 'exact', path: my_do_path };
                }
            }
        }
        return { kind: 'missing', requested: resolved_fs_path };
    }

    // ── Confirm the root itself exists ───────────────────────────────────────
    // (existsSync is allowed here — we are confirming the canonical root, not
    // classifying any component's casing)
    if (!the_fs.existsSync(chosen_root)) {
        return { kind: 'missing', requested: resolved_fs_path };
    }

    // Split the remainder below the root into components
    const root_prefix = chosen_root.endsWith(sep)
        ? chosen_root
        : chosen_root + sep;
    const remainder = norm_path.slice(root_prefix.length);
    if (remainder.length === 0) {
        // The path IS the workspace root; treat as exact if it exists
        return { kind: 'exact', path: chosen_root };
    }
    const the_components = remainder.split(sep);

    // ── Walk components ──────────────────────────────────────────────────────
    let current_dir = chosen_root;
    // Track whether any component needed ci-resolution (makes result case_only)
    let had_case_mismatch = false;

    // Join a directory path and a single component, avoiding double separators
    // when current_dir is the filesystem root (e.g. "/" → "/ws", not "//ws").
    const join_path = (dir: string, name: string): string =>
        dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;

    for (let comp_idx = 0; comp_idx < the_components.length; comp_idx++) {
        const my_component = the_components[comp_idx]!;
        const my_is_final = comp_idx === the_components.length - 1;
        let my_entries: Array<{
            name: string;
            isFile(): boolean;
            isDirectory(): boolean;
            isSymbolicLink(): boolean;
        }>;
        try {
            my_entries = the_fs.readdirSync(current_dir, {
                withFileTypes: true,
            });
        } catch {
            return { kind: 'missing', requested: resolved_fs_path };
        }

        if (!my_is_final) {
            // ── Non-final: must find a directory ─────────────────────────────
            // Exact-before-case priority; symlinks are followed via
            // entry_is_dir so a symlinked directory is treated as a directory.
            const my_exact = my_entries.find(
                e => e.name === my_component &&
                    entry_is_dir(e, join_path(current_dir, e.name), the_fs),
            );
            if (my_exact !== undefined) {
                current_dir = join_path(current_dir, my_exact.name);
                continue;
            }
            // Case-insensitive directory matches (symlinks followed)
            const the_ci_dirs = my_entries.filter(
                e => ascii_ci_equal(e.name, my_component) &&
                    entry_is_dir(e, join_path(current_dir, e.name), the_fs),
            );
            if (the_ci_dirs.length === 1) {
                had_case_mismatch = true;
                current_dir = join_path(current_dir, the_ci_dirs[0]!.name);
                continue;
            }
            if (the_ci_dirs.length > 1) {
                return {
                    kind: 'ambiguous',
                    requested: resolved_fs_path,
                    matches: the_ci_dirs.map(
                        e => join_path(current_dir, e.name),
                    ),
                };
            }
            // No directory match (count: 0)
            return { kind: 'missing', requested: resolved_fs_path };
        }

        // ── Final component ───────────────────────────────────────────────────
        // Candidate names: the component itself, plus (when no extension and
        // try_do_fallback) the component + '.do'.
        const the_candidates: string[] = [my_component];
        if (try_do_fallback && !has_extension(my_component)) {
            the_candidates.push(`${my_component}.do`);
        }

        // Step 1: exact file match (candidates in order); symlinks followed
        // via entry_is_file so a symlinked file is treated as a file.
        for (const my_cand of the_candidates) {
            const my_exact_file = my_entries.find(
                e => e.name === my_cand &&
                    entry_is_file(e, join_path(current_dir, e.name), the_fs),
            );
            if (my_exact_file !== undefined) {
                const my_full = join_path(current_dir, my_exact_file.name);
                if (had_case_mismatch) {
                    return {
                        kind: 'case_only',
                        path: my_full,
                        requested: resolved_fs_path,
                    };
                }
                return { kind: 'exact', path: my_full };
            }
        }

        // Step 2: case-insensitive file matches over the candidate set.
        // Collect all (distinct) file entries whose names ci-match any
        // candidate; symlinks are followed via entry_is_file.
        const the_ci_files: string[] = [];
        const seen_names = new Set<string>();
        for (const my_cand of the_candidates) {
            for (const my_entry of my_entries) {
                if (
                    ascii_ci_equal(my_entry.name, my_cand) &&
                    entry_is_file(
                        my_entry,
                        join_path(current_dir, my_entry.name),
                        the_fs,
                    ) &&
                    !seen_names.has(my_entry.name)
                ) {
                    seen_names.add(my_entry.name);
                    the_ci_files.push(
                        join_path(current_dir, my_entry.name),
                    );
                }
            }
        }

        if (the_ci_files.length === 1) {
            return {
                kind: 'case_only',
                path: the_ci_files[0]!,
                requested: resolved_fs_path,
            };
        }
        if (the_ci_files.length > 1) {
            return {
                kind: 'ambiguous',
                requested: resolved_fs_path,
                matches: the_ci_files,
            };
        }
        return { kind: 'missing', requested: resolved_fs_path };
    }

    // Should be unreachable (the_components is non-empty), but satisfy TS
    return { kind: 'missing', requested: resolved_fs_path };
}

// ─── Host filesystem case-sensitivity detection ──────────────────────────────

/**
 * Cache for host case-sensitivity results, keyed by seed path.
 * Used only when `fs` is not injected; injected-fs tests bypass the cache
 * for determinism.
 */
const case_sensitivity_cache = new Map<string, boolean>();

/**
 * Detect whether the host filesystem is case-sensitive by flipping the case
 * of the first ASCII letter in the seed path and checking if the flipped path
 * exists.
 *
 * Returns:
 * - true (case-sensitive) if flipped path does NOT exist, or if no ASCII
 *   letter can be flipped (assume case-sensitive as default)
 * - false (case-insensitive) if flipped path DOES exist
 *
 * Results are cached per seed path when `fs` is not injected.
 * When `fs` is injected (for testing), the cache is bypassed for determinism.
 */
export function host_is_case_sensitive(
    seed_existing_dir: string,
    fs?: { existsSync(p: string): boolean },
): boolean {
    // If fs is injected, bypass the cache for determinism in tests
    if (fs !== undefined) {
        return check_case_sensitivity(seed_existing_dir, fs);
    }

    // Check the cache
    const cached = case_sensitivity_cache.get(seed_existing_dir);
    if (cached !== undefined) {
        return cached;
    }

    // Compute and cache the result
    const result = check_case_sensitivity(seed_existing_dir, {
        existsSync: p => node_fs.existsSync(p),
    });
    case_sensitivity_cache.set(seed_existing_dir, result);
    return result;
}

/**
 * Flip the case of a single ASCII letter in `char` (A–Z ↔ a–z).
 * Returns the flipped character, or `null` if `char` is not an ASCII letter.
 */
function flip_ascii_case(char: string): string | null {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 32);
    return null;
}

/**
 * Core logic: flip the case of the first ASCII letter found in the leaf
 * (last path segment) of `seed_existing_dir` and check if the flipped path
 * exists. This ensures the probe is on the same filesystem volume as the
 * seed, rather than reflecting a parent directory on a different mount.
 *
 * If the leaf has no ASCII letter, walk up to the nearest ancestor segment
 * that does. If no ASCII letter exists anywhere, assume case-sensitive.
 */
function check_case_sensitivity(
    seed_existing_dir: string,
    fs: { existsSync(p: string): boolean },
): boolean {
    const sep = '/';
    // Normalise Windows separators before splitting
    const norm_seed = seed_existing_dir.replace(/\\/g, sep);
    // Split into segments; filter empty strings from leading '/'
    const the_segments = norm_seed.split(sep);

    // Walk segments from leaf to root looking for one that has an ASCII letter
    for (let seg_idx = the_segments.length - 1; seg_idx >= 0; seg_idx--) {
        const my_seg = the_segments[seg_idx]!;
        // Find the first ASCII letter within this segment
        for (let char_idx = 0; char_idx < my_seg.length; char_idx++) {
            const my_char = my_seg[char_idx]!;
            const my_flipped = flip_ascii_case(my_char);
            if (my_flipped === null) continue;

            // Build the flipped segment
            const my_flipped_seg =
                my_seg.slice(0, char_idx) +
                my_flipped +
                my_seg.slice(char_idx + 1);

            // Reconstruct the path with the flipped segment
            const the_flipped_parts = [
                ...the_segments.slice(0, seg_idx),
                my_flipped_seg,
                ...the_segments.slice(seg_idx + 1),
            ];
            const my_flipped_path = the_flipped_parts.join(sep);

            if (fs.existsSync(my_flipped_path)) {
                return false; // case-insensitive
            }
            return true; // case-sensitive
        }
    }

    // No ASCII letter anywhere in path; assume case-sensitive
    return true;
}

/**
 * Return the deepest workspace root that strictly contains `dir_path`
 * (i.e. `dir_path` starts with `root + path.sep`, after normalising
 * separators). Returns `null` when no root contains `dir_path`.
 * Unlike `get_workspace_root_for_path` there is NO fallback to
 * `workspace_roots[0]` — callers can rely on `null` meaning "truly
 * outside every workspace root".
 */
function find_strict_containing_root(
    workspace_roots: string[],
    dir_path: string,
): string | null {
    // Normalise separators so POSIX paths match on all platforms.
    const norm_dir = dir_path.replace(/\\/g, '/');
    let best_root: string | null = null;
    let best_length = -1;
    for (const my_root of workspace_roots) {
        const my_norm = my_root.replace(/\\/g, '/');
        const my_prefix = my_norm.endsWith('/') ? my_norm : my_norm + '/';
        if (
            (norm_dir === my_norm || norm_dir.startsWith(my_prefix)) &&
            my_norm.length > best_length
        ) {
            best_root = my_root;
            best_length = my_norm.length;
        }
    }
    return best_root;
}

/**
 * True when a forward call is a static call worth resolving into a
 * callee edge: not macro-interpolated AND carrying non-empty path text.
 * The `raw_path` guard keeps a degenerate empty path from keying a
 * spurious caller-dir edge. Shared by every forward-call consumer so the
 * gate stays identical across the dependency graph, scope-resolver,
 * forward-scope resolver, and the debug log.
 */
export function is_resolvable_static_call(
    call: { is_static: boolean; raw_path: string },
): boolean {
    return call.is_static && call.raw_path.length > 0;
}

/**
 * Project a `PathCaseOutcome` to the filesystem path a callee should be
 * keyed by: the real on-disk-cased path for `exact`/`case_only`,
 * otherwise the `requested` (WD-joined) path for `ambiguous`/`missing`.
 * Shared by the dependency graph and the scope-resolver reverse-dep
 * keying so both agree.
 */
export function outcome_fs_path(outcome: PathCaseOutcome): string {
    return outcome.kind === 'exact' || outcome.kind === 'case_only'
        ? outcome.path
        : outcome.requested;
}

// ─── WD-join / script-relative / workspace-root fallback helper ──────────────

/**
 * Resolve a forward call through an ordered three-tier candidate chain.
 *
 * Candidates are tried in order; skipping duplicates and skipping WD/
 * workspace candidates when `raw_path` is absolute:
 *
 *   1. **WD-join** — `normalize(join(working_directory, raw_path))` when
 *      `working_directory` is set AND `raw_path` is relative.
 *   2. **Script-relative** — `path.resolve(caller_dir, raw_path)`.
 *      (`path.resolve` handles absolute `raw_path` correctly.)
 *   3. **Workspace-root-relative** — `normalize(join(root, raw_path))` where
 *      `root` is the deepest `options.workspace_roots` entry that contains
 *      `caller_dir`, when `raw_path` is relative and such a root exists and
 *      the candidate is not already in the list.
 *
 * Resolution loop rules:
 *   - `exact` or `case_only` → return immediately.
 *   - `ambiguous` → return immediately (NEVER fall through; this preserves
 *     the round-A fix: an ambiguous WD-join stays ambiguous).
 *   - `missing` → continue to next candidate.
 *   - After all candidates: return the FIRST candidate's outcome so the
 *     diagnostic's `requested` reflects the primary (WD-joined) attempt.
 *
 * All three consumers — forward-scope-resolver, dependency-graph, and
 * scope-resolver's reverse-dep helper — call this function so they all
 * agree on which URI is the callee.
 *
 * @param raw_path          - Path exactly as written in source.
 * @param caller_dir        - dirname of the caller file's fsPath.
 * @param working_directory - Effective WD at the call site, or undefined.
 * @param options           - workspace_roots and optional fs override.
 */
export function resolve_forward_call_rich(
    raw_path: string,
    caller_dir: string,
    working_directory: string | undefined,
    options?: { workspace_roots?: string[]; fs?: RichResolveFs },
): PathCaseOutcome {
    const my_normalized_raw = raw_path.replace(/\\/g, '/');
    const my_is_abs =
        node_path.isAbsolute(my_normalized_raw) ||
        /^[a-zA-Z]:\//.test(my_normalized_raw);

    // ── Build ordered candidate list (deduped) ────────────────────────────
    const the_candidates: string[] = [];

    // Tier 1: WD-join (relative paths only)
    if (working_directory && !my_is_abs) {
        const my_wd_candidate = node_path.normalize(
            node_path.join(working_directory, my_normalized_raw),
        );
        the_candidates.push(my_wd_candidate);
    }

    // Tier 2: script-relative (path.resolve handles absolute raw_path)
    const my_script_relative = node_path.resolve(caller_dir, raw_path);
    if (!the_candidates.includes(my_script_relative)) {
        the_candidates.push(my_script_relative);
    }

    // Tier 3: workspace-root-relative (relative paths only, skip if no
    // workspace_roots or candidate already present).
    // STRICT containment: only add this candidate when caller_dir is
    // actually INSIDE a workspace root. Do NOT use
    // get_workspace_root_for_path here — it falls back to
    // workspace_roots[0] when nothing matches, which would add a
    // spurious candidate for callers outside the workspace.
    if (!my_is_abs && options?.workspace_roots?.length) {
        const my_strict_root = find_strict_containing_root(
            options.workspace_roots,
            caller_dir,
        );
        if (my_strict_root !== null) {
            const my_root_candidate = node_path.normalize(
                node_path.join(my_strict_root, my_normalized_raw),
            );
            if (!the_candidates.includes(my_root_candidate)) {
                the_candidates.push(my_root_candidate);
            }
        }
    }

    const my_rich_opts: RichResolveOptions = {
        try_do_fallback: true,
        workspace_roots: options?.workspace_roots,
        fs: options?.fs,
    };

    // ── Resolution loop ───────────────────────────────────────────────────
    let my_first_outcome: PathCaseOutcome | undefined;
    for (const my_candidate of the_candidates) {
        const my_outcome = resolve_path_rich(my_candidate, my_rich_opts);
        if (!my_first_outcome) {
            my_first_outcome = my_outcome;
        }
        if (my_outcome.kind === 'exact' || my_outcome.kind === 'case_only') {
            return my_outcome;
        }
        // Ambiguous: STOP — never fall through (round-A fix preserved).
        if (my_outcome.kind === 'ambiguous') {
            return my_outcome;
        }
        // missing: continue to next candidate.
    }

    // All candidates missing (or list was somehow empty): return the first
    // outcome so callers see the primary (WD-joined) `requested` path.
    if (my_first_outcome) {
        return my_first_outcome;
    }
    // Unreachable: the candidate list always has at least the script-relative
    // entry. Return a well-formed missing outcome to satisfy the type.
    return { kind: 'missing', requested: raw_path };
}

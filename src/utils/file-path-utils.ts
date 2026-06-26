/**
 * File path utilities for Sight
 */

import * as node_fs from 'fs';

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
  return PATH_DIRECTIVES.has(directive.toLowerCase());
}

/**
 * Check if a file has a Stata extension
 */
export function hasStataExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return STATA_FILE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Resolve file path with .do fallback
 * Returns the path that exists, trying original path first, then with .do extension
 */
export function resolvePathWithDoFallback(
  fs_path: string,
  fs: { existsSync: (path: string) => boolean },
): string | null {
  // Try original path first
  if (fs.existsSync(fs_path)) {
    return fs_path;
  }

  // Try .do fallback if original path doesn't end in .do
  if (!fs_path.endsWith('.do')) {
    const fallback_path = fs_path + '.do';
    if (fs.existsSync(fallback_path)) {
      return fallback_path;
    }
  }

  return null;
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
    ): Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
    existsSync(p: string): boolean;
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
            }>,
        existsSync: (p: string) => node_fs.existsSync(p),
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
 * Paths outside every `workspace_roots` entry fall back to plain existence
 * semantics: `exact` if the file exists today, `missing` otherwise. When
 * `workspace_roots` is empty/undefined the walk starts from the path's
 * filesystem root (POSIX `/`, or the Windows drive/UNC root), enabling
 * case-only resolution without explicit roots (useful for tests and
 * standalone usage).
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

    // ── Outside all workspace roots ───────────────────────────────────────────
    if (chosen_root === null) {
        if (the_roots.length > 0) {
            // Roots were supplied but path is outside all of them.
            // Return plain existence — no case-handling enumeration.
            if (the_fs.existsSync(norm_path)) {
                return { kind: 'exact', path: norm_path };
            }
            return { kind: 'missing', requested: resolved_fs_path };
        }
        // No roots supplied at all → treat the filesystem root as the
        // walk start (POSIX "/" or Windows drive root such as "C:/").
        // This enables case-only resolution in tests and standalone usage.
        const my_fs_root = norm_path.startsWith('/')
            ? '/'
            : norm_path.replace(/^([A-Za-z]:[\\/]).*$/, '$1');
        chosen_root = my_fs_root.replace(/[\\/]$/, '') || '/';
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
            // Exact-before-case priority
            const my_exact = my_entries.find(
                e => e.name === my_component && e.isDirectory(),
            );
            if (my_exact !== undefined) {
                current_dir = join_path(current_dir, my_exact.name);
                continue;
            }
            // Case-insensitive directory matches
            const the_ci_dirs = my_entries.filter(
                e => e.isDirectory() && ascii_ci_equal(e.name, my_component),
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

        // Step 1: exact file match (candidates in order)
        for (const my_cand of the_candidates) {
            const my_exact_file = my_entries.find(
                e => e.name === my_cand && e.isFile(),
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

        // Step 2: case-insensitive file matches over the candidate set
        // Collect all (distinct) file entries whose names ci-match any candidate
        const the_ci_files: string[] = [];
        const seen_names = new Set<string>();
        for (const my_cand of the_candidates) {
            for (const my_entry of my_entries) {
                if (
                    my_entry.isFile() &&
                    ascii_ci_equal(my_entry.name, my_cand) &&
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

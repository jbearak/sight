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
export function resolvePathWithDoFallback(fs_path: string, fs: { existsSync: (path: string) => boolean }): string | null {
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

// ─── Host filesystem case-sensitivity detection ──────────────────────────────

/**
 * Cache for host case-sensitivity results, keyed by seed path.
 * Used only when `fs` is not injected; injected-fs tests bypass the cache
 * for determinism.
 */
const case_sensitivity_cache = new Map<string, boolean>();

/**
 * Detect whether the host filesystem is case-sensitive.
 *
 * Strategy: flip the case of the first ASCII letter in `seed_existing_dir`
 * and check whether the flipped path exists.
 * - Returns `true`  (case-sensitive)  if the flipped path does NOT exist, or
 *   if no ASCII letter is present in the path (conservative default).
 * - Returns `false` (case-insensitive) if the flipped path DOES exist.
 *
 * Results are cached per seed path when `fs` is not injected.
 * When `fs` is injected (for testing), the cache is bypassed.
 *
 * @param seed_existing_dir - A real existing directory on the volume to probe.
 *   Typically the containing workspace root.
 * @param fs - Optional injected filesystem for tests.
 */
export function host_is_case_sensitive(
    seed_existing_dir: string,
    fs?: { existsSync(p: string): boolean },
): boolean {
    if (fs !== undefined) {
        return check_case_sensitivity(seed_existing_dir, fs);
    }

    const cached = case_sensitivity_cache.get(seed_existing_dir);
    if (cached !== undefined) {
        return cached;
    }

    const result = check_case_sensitivity(seed_existing_dir, {
        existsSync: (p: string) => node_fs.existsSync(p),
    });
    case_sensitivity_cache.set(seed_existing_dir, result);
    return result;
}

/**
 * Core logic for `host_is_case_sensitive`.
 * Flips the case of the first ASCII letter and checks whether the result
 * exists on the filesystem.
 */
function check_case_sensitivity(
    seed_existing_dir: string,
    fs: { existsSync(p: string): boolean },
): boolean {
    for (let i = 0; i < seed_existing_dir.length; i++) {
        const my_char = seed_existing_dir[i]!;
        const code = my_char.charCodeAt(0);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
            let flipped_char: string;
            if (code >= 65 && code <= 90) {
                flipped_char = String.fromCharCode(code + 32);
            } else {
                flipped_char = String.fromCharCode(code - 32);
            }
            const flipped_path =
                seed_existing_dir.slice(0, i) +
                flipped_char +
                seed_existing_dir.slice(i + 1);
            if (fs.existsSync(flipped_path)) {
                return false; // case-insensitive
            }
            return true; // case-sensitive
        }
    }
    // No ASCII letter found: assume case-sensitive (conservative)
    return true;
}

/**
 * Symlink-aware classification of `readdir` directory entries.
 *
 * A `readdir(..., { withFileTypes: true })` entry for a SYMLINK reports
 * `isDirectory()` and `isFile()` as BOTH false — `isSymbolicLink()` is
 * the only true predicate. Code that classifies entries with only
 * `isDirectory()` / `isFile()` therefore silently drops symlinked
 * directories and symlinked files. These helpers add the missing case:
 * when (and only when) an entry is a symlink, stat the path (following
 * the link) and classify by the target.
 *
 * Design (mirrors `resolve_path_rich` in `file-path-utils.ts`, #216):
 * - Fast path: the `Dirent` predicate — NO extra syscall for the common
 *   non-symlink entry.
 * - Symlink path: `stat(full_path)` follows the link; classify by the
 *   target's `isFile()` / `isDirectory()`.
 * - A dangling symlink makes `stat` throw; we catch and return `false`
 *   so a broken link is skipped, not crashed.
 *
 * Sync and async variants share identical logic and differ only in
 * `await`; callers pick the one matching their surrounding I/O style.
 */

/** Minimal fs seam: a stat that FOLLOWS symlinks (throws on a dangling
 * link). */
export interface StatSyncFs {
    statSync(p: string): { isFile(): boolean; isDirectory(): boolean };
}

/** Minimal fs seam: an async stat that FOLLOWS symlinks (rejects on a
 * dangling link). */
export interface StatAsyncFs {
    stat(p: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
}

/** The `Dirent` subset these helpers consult. */
interface DirentLike {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

/**
 * True when `entry` is a directory (direct, or a symlink to a
 * directory). Dangling symlink → false.
 */
export function entry_is_directory_sync(
    entry: DirentLike,
    full_path: string,
    fs: StatSyncFs,
): boolean {
    if (entry.isDirectory()) return true;
    if (!entry.isSymbolicLink()) return false;
    try {
        return fs.statSync(full_path).isDirectory();
    } catch {
        return false; // dangling symlink — treat as non-matching
    }
}

/**
 * True when `entry` is a file (direct, or a symlink whose target is a
 * file). Dangling symlink → false.
 */
export function entry_is_file_sync(
    entry: DirentLike,
    full_path: string,
    fs: StatSyncFs,
): boolean {
    if (entry.isFile()) return true;
    if (!entry.isSymbolicLink()) return false;
    try {
        return fs.statSync(full_path).isFile();
    } catch {
        return false; // dangling symlink — treat as non-matching
    }
}

/**
 * Async counterpart of {@link entry_is_file_sync}. Used by the
 * on-demand async `.sthlp` lookup walk (`find_sthlp_file_recursive`),
 * which descends only real subdirectories (`Dirent.isDirectory()`) but
 * must still match a symlinked help *file* (issue #219). There is
 * deliberately no async directory variant: the walk does not follow
 * symlinked directories, so it never async-classifies one.
 */
export async function entry_is_file_async(
    entry: DirentLike,
    full_path: string,
    fs: StatAsyncFs,
): Promise<boolean> {
    if (entry.isFile()) return true;
    if (!entry.isSymbolicLink()) return false;
    try {
        return (await fs.stat(full_path)).isFile();
    } catch {
        return false; // dangling symlink — treat as non-matching
    }
}

/** Single-syscall classification of an entry. */
export type EntryKind = 'directory' | 'file' | 'other';

/**
 * Classify an entry as `'directory'`, `'file'`, or `'other'` with at
 * most ONE stat call. Used by path completion, which lists one dir
 * level and wants to offer both symlinked directories and symlinked
 * files; testing the boolean helpers directory-then-file would stat a
 * symlinked entry twice, so it uses this instead.
 *
 * Fast path: the `Dirent` predicates (no syscall for non-symlinks).
 * Symlink path: a single `statSync` follows the link; a dangling link
 * throws and is classified `'other'` (skipped, not crashed).
 */
export function classify_entry_sync(
    entry: DirentLike,
    full_path: string,
    fs: StatSyncFs,
): EntryKind {
    if (entry.isDirectory()) return 'directory';
    if (entry.isFile()) return 'file';
    if (!entry.isSymbolicLink()) return 'other';
    try {
        const my_stat = fs.statSync(full_path);
        if (my_stat.isDirectory()) return 'directory';
        if (my_stat.isFile()) return 'file';
        return 'other';
    } catch {
        return 'other'; // dangling symlink — skip
    }
}

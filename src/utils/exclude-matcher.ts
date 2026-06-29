/**
 * Workspace-relative path exclusion for the `exclude` config setting
 * (issue #255). Patterns from `sight.toml` (top-level `exclude = [...]`) are
 * matched against the path of each candidate file/directory expressed relative
 * to its containing workspace root, using picomatch glob semantics.
 *
 * Two scanners consume this: the workspace indexer (`src/indexer/index.ts`) and
 * the `sight check` directory walk (`src/cli/source-files.ts`). Both skip files
 * whose relative path matches, and prune directories that can contain only
 * excluded descendants. Files outside every workspace root (e.g. ado paths)
 * never match — exclusion is strictly workspace-relative.
 */

import path from 'path';
import picomatch from 'picomatch';

export interface ExcludeMatcher {
    /** True when there are no patterns; lets callers cheaply skip the work. */
    readonly is_empty: boolean;
    /** True if `abs_path` (a file) is excluded relative to a containing root. */
    is_excluded_file(abs_path: string, workspace_roots: readonly string[]): boolean;
    /**
     * True if `abs_path` (a directory) can be pruned because every descendant
     * would be excluded. Conservative: returns false (no pruning) when negation
     * (re-include) patterns are present, since a re-included file could live
     * inside.
     */
    is_excluded_dir(abs_path: string, workspace_roots: readonly string[]): boolean;
}

const NEVER_MATCHER: ExcludeMatcher = {
    is_empty: true,
    is_excluded_file: () => false,
    is_excluded_dir: () => false,
};

const PICOMATCH_OPTIONS: picomatch.PicomatchOptions = { dot: true };

/**
 * Normalize a raw pattern to the POSIX form picomatch expects: trim, convert
 * backslashes to forward slashes, drop a leading `./`, and rewrite a trailing
 * `/` to `/**` (gitignore-style "directory and everything under it", e.g.
 * `output/` -> `output/**`). A leading `!` (negation) is preserved and the rest
 * of the pattern is normalized after it (so `!./output/` -> `!output/**`).
 * Returns `''` for blank patterns so callers can drop them.
 */
function normalize_pattern(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed === '') return '';
    const is_negated = trimmed.startsWith('!');
    let pattern = (is_negated ? trimmed.slice(1) : trimmed).replace(/\\/g, '/');
    while (pattern.startsWith('./')) {
        pattern = pattern.slice(2);
    }
    if (pattern.length > 1 && pattern.endsWith('/')) {
        pattern = `${pattern}**`;
    }
    // A bare `/` (or `./`, `.//` reduced to it) targets the filesystem root,
    // never a workspace-relative path, so it would match nothing — drop it
    // rather than feed picomatch a no-op pattern.
    if (pattern === '' || pattern === '/') return '';
    return is_negated ? `!${pattern}` : pattern;
}

/**
 * Derive a directory-prune pattern by stripping a trailing globstar tail
 * (a slash followed by a globstar, optionally then a slash and star). A
 * directory can be pruned only when every descendant at any depth is excluded,
 * which is exactly what a globstar means. A single-star
 * tail (`build/*`) matches only direct children, NOT nested files like
 * `build/nested/keep.do`, so it must never prune the directory — hence `/*` is
 * deliberately not stripped. Returns the input unchanged when there is no
 * globstar tail.
 */
function derive_dir_pattern(pattern: string): string {
    const stripped = pattern.replace(/\/(?:\*\*\/\*|\*\*)$/, '');
    return stripped === '' ? pattern : stripped;
}

/**
 * Compute `abs_path` relative to the deepest workspace root that contains it,
 * in POSIX form. Returns `null` when no root contains the path (e.g. ado paths
 * outside the workspace), so such paths are never excluded. The empty string
 * (path equals a root) is returned as-is and never matches a pattern.
 */
function relative_to_containing_root(
    abs_path: string,
    workspace_roots: readonly string[]
): string | null {
    const target = path.resolve(abs_path);
    let best: string | null = null;
    let best_root_length = -1;
    for (const my_root of workspace_roots) {
        const root = path.resolve(my_root);
        const my_relative = path.relative(root, target);
        // Treat the path as outside the root only when `..` is a real path
        // component (`..` exactly, or `../` style), matching
        // `workspace_relative` in cli/source-files.ts. A leading `..` that is
        // part of a filename (e.g. `..foo.do`) is still inside the workspace.
        const contained =
            my_relative === '' ||
            (my_relative !== '..' &&
                !my_relative.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(my_relative));
        if (contained && root.length > best_root_length) {
            best = my_relative;
            best_root_length = root.length;
        }
    }
    if (best === null) return null;
    return best.split(path.sep).join('/');
}

/**
 * Compile `patterns` into an {@link ExcludeMatcher}. The picomatch matchers are
 * built once here, not per path. An empty pattern list yields a cheap no-op
 * matcher.
 */
export function create_exclude_matcher(
    patterns: readonly string[]
): ExcludeMatcher {
    // Compile each pattern to its own matcher, preserving order. Evaluation
    // applies gitignore-style "last match wins" semantics (a positive excludes,
    // a leading `!` re-includes, and a later positive can exclude again), which
    // picomatch's own array handling does NOT provide (a lone `!p` matches
    // everything-except-p). Order matters, so the two signs cannot be split into
    // separate sets.
    const compiled: Array<{ is_negated: boolean; match: (s: string) => boolean }> =
        [];
    const positive_dir_patterns: string[] = [];
    let positive_count = 0;
    let has_negation = false;
    for (const my_pattern of patterns) {
        const normalized = normalize_pattern(my_pattern);
        if (normalized === '') continue;
        if (normalized.startsWith('!')) {
            const body = normalized.slice(1);
            if (body === '') continue;
            compiled.push({
                is_negated: true,
                match: picomatch(body, PICOMATCH_OPTIONS),
            });
            has_negation = true;
        } else {
            compiled.push({
                is_negated: false,
                match: picomatch(normalized, PICOMATCH_OPTIONS),
            });
            // A pattern may prune directories only if it guarantees the whole
            // subtree is excluded — i.e. it is globstar-terminated. A single-
            // star (`build/*`) or plain glob (`*.do`, `**/*.gen.do`) matches
            // only some descendants, so it must never prune: the raw pattern
            // would wrongly match (and skip) intermediate dirs like
            // `build/nested`, dropping non-excluded files beneath them. For a
            // globstar pattern, both the raw form (matches descendants) and its
            // stripped base (matches the dir itself) are safe to prune on.
            const dir_base = derive_dir_pattern(normalized);
            if (dir_base !== normalized || normalized === '**') {
                positive_dir_patterns.push(normalized);
                if (dir_base !== normalized) positive_dir_patterns.push(dir_base);
            }
            positive_count++;
        }
    }
    // A list with no positive patterns (empty, or only re-includes) excludes
    // nothing.
    if (positive_count === 0) return NEVER_MATCHER;

    // Directory-prune matcher: built only from globstar-terminated positives
    // (see above), deduplicated. Pruning is disabled (dir_match === null) when
    // re-include patterns exist (a re-included file could live inside an
    // otherwise-excluded directory) or when no globstar pattern can ever prune a
    // directory — so `is_excluded_dir` short-circuits instead of running an
    // always-false matcher.
    const dir_match =
        has_negation || positive_dir_patterns.length === 0
            ? null
            : picomatch(
                  Array.from(new Set(positive_dir_patterns)),
                  PICOMATCH_OPTIONS
              );

    return {
        is_empty: false,
        is_excluded_file(abs_path, workspace_roots) {
            const relative = relative_to_containing_root(abs_path, workspace_roots);
            if (relative === null || relative === '') return false;
            let excluded = false;
            for (const my_rule of compiled) {
                if (my_rule.match(relative)) {
                    excluded = !my_rule.is_negated;
                }
            }
            return excluded;
        },
        is_excluded_dir(abs_path, workspace_roots) {
            if (dir_match === null) return false;
            const relative = relative_to_containing_root(abs_path, workspace_roots);
            return relative !== null && relative !== '' && dir_match(relative);
        },
    };
}

/**
 * Resolvers for Stata's `.maint` alias files.
 *
 * Two file families share the exact same on-disk format — a key
 * column, whitespace, then a value column — and the same lookup
 * semantics (case-sensitive, earlier-directory-wins), so they share
 * the cache plumbing in `MaintAliasStore`:
 *
 *   * `*smcl_alias.maint` — undocumented `{findalias X}` SMCL
 *     substitutions. Consumed by `FindaliasResolver` and routed into
 *     the SMCL-to-HTML renderer.
 *   * `*help_alias.maint` — `help topic` redirects that rewrite the
 *     user-typed topic to a different `.sthlp` basename. Consumed by
 *     `HelpAliasResolver` and routed into `resolve_sthlp_file`.
 *
 * Each line has the shape:
 *
 *     <key><whitespace><value>
 *
 * For example:
 *
 *     ado/base/f/fsmcl_alias.maint: frexp      {manlink U 13 Functions and expressions}
 *     ado/base/o/ohelp_alias.maint: operators  operator
 *
 * Resolution rules for both resolvers:
 *   * Keys are matched case-sensitively, exactly as typed (Stata is
 *     case-sensitive).
 *   * Each resolver reads only its own file suffix; the two never
 *     cross-contaminate.
 *   * Results are cached per-file by mtime so repeated lookups are
 *     effectively free and changes on disk are picked up without a
 *     server restart.
 */
import * as fs from 'fs';
import * as path from 'path';

// Letters we probe for per-ado-directory `.maint` files. Stata's base
// ado tree only ever uses lowercase single-letter subdirectories
// (`a/`, `b/`, …, `z/`, plus the rarely-used `_/`). Restricting the
// probe to this fixed set keeps the scan O(1) per ado root instead of
// readdir'ing arbitrary layouts.
const LETTER_SUBDIRS: readonly string[] = [
    '_',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
    'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
    'u', 'v', 'w', 'x', 'y', 'z',
];

interface CachedMaint {
    mtime_ms: number;
    aliases: Map<string, string>;
}

/**
 * Shared base class for `.maint`-file alias resolvers. Handles search
 * directory normalization, per-file mtime caching, and merged-map
 * construction. Subclasses only supply the file suffix they target
 * (e.g. `smcl_alias.maint` vs `help_alias.maint`).
 */
export abstract class MaintAliasStore {
    private search_dirs: string[] = [];
    // Per-maint-file cache keyed by absolute path.
    private file_cache: Map<string, CachedMaint> = new Map();
    // Merged alias map. Rebuilt lazily whenever `search_dirs` changes
    // or any cached file's mtime no longer matches disk.
    private merged_cache: Map<string, string> | null = null;
    // The file paths that contributed to the current `merged_cache`,
    // so we can detect changes cheaply in `lookup`.
    private merged_file_paths: string[] = [];

    /**
     * Filename suffix (relative to the letter subdir) this store
     * reads. Subclasses return a constant like `smcl_alias.maint` or
     * `help_alias.maint`.
     */
    protected abstract get file_suffix(): string;

    /**
     * Update the list of directories to search for `.maint` files.
     * Paths should be absolute. Order is preserved: when two files
     * define the same alias, the earlier directory wins.
     */
    set_search_dirs(dirs: string[]): void {
        const the_normalized: string[] = [];
        const the_seen = new Set<string>();
        for (const my_dir of dirs) {
            if (!my_dir) continue;
            const my_resolved = path.resolve(my_dir);
            if (the_seen.has(my_resolved)) continue;
            the_seen.add(my_resolved);
            the_normalized.push(my_resolved);
        }
        // Only invalidate the merged cache if the set actually changed.
        if (!arrays_equal(the_normalized, this.search_dirs)) {
            this.search_dirs = the_normalized;
            this.merged_cache = null;
        }
    }

    /**
     * Read-only view of the currently-configured search directories.
     * Exposed primarily for tests.
     */
    get_search_dirs(): string[] {
        return [...this.search_dirs];
    }

    /**
     * Resolve an alias. Returns the raw value string from the `.maint`
     * file (the interpretation is up to the caller — raw SMCL for
     * `FindaliasResolver`, a help-topic basename for
     * `HelpAliasResolver`) or `null` when the alias is unknown.
     */
    lookup(alias: string): string | null {
        const my_key = alias.trim();
        if (my_key.length === 0) return null;
        const the_merged = this.get_merged_map();
        const my_value = the_merged.get(my_key);
        return my_value ?? null;
    }

    /**
     * Drop all caches. Intended for tests.
     */
    reset_cache(): void {
        this.file_cache.clear();
        this.merged_cache = null;
        this.merged_file_paths = [];
    }

    // ---------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------

    private get_merged_map(): Map<string, string> {
        if (this.merged_cache !== null && !this.any_cached_file_changed()) {
            return this.merged_cache;
        }
        const the_merged = new Map<string, string>();
        const the_contributing_files: string[] = [];
        for (const my_dir of this.search_dirs) {
            for (const my_letter of LETTER_SUBDIRS) {
                const my_file = path.join(
                    my_dir,
                    my_letter,
                    `${my_letter}${this.file_suffix}`
                );
                const the_aliases = this.load_file(my_file);
                if (!the_aliases) continue;
                the_contributing_files.push(my_file);
                for (const [my_alias, my_value] of the_aliases) {
                    // Earlier directory wins (ado_paths > workspace >
                    // install), matching resolve_sthlp_file ordering.
                    if (!the_merged.has(my_alias)) {
                        the_merged.set(my_alias, my_value);
                    }
                }
            }
        }
        this.merged_cache = the_merged;
        this.merged_file_paths = the_contributing_files;
        return the_merged;
    }

    private any_cached_file_changed(): boolean {
        for (const my_file of this.merged_file_paths) {
            const my_cached = this.file_cache.get(my_file);
            if (!my_cached) return true;
            let my_stat: fs.Stats | null = null;
            try {
                my_stat = fs.statSync(my_file);
            } catch {
                // File was removed since we last read it.
                this.file_cache.delete(my_file);
                return true;
            }
            if (my_stat.mtimeMs !== my_cached.mtime_ms) {
                return true;
            }
        }
        return false;
    }

    private load_file(file_path: string): Map<string, string> | null {
        let my_stat: fs.Stats;
        try {
            my_stat = fs.statSync(file_path);
        } catch {
            return null;
        }
        if (!my_stat.isFile()) return null;

        const my_cached = this.file_cache.get(file_path);
        if (my_cached && my_cached.mtime_ms === my_stat.mtimeMs) {
            return my_cached.aliases;
        }

        let my_content: string;
        try {
            my_content = fs.readFileSync(file_path, 'utf-8');
        } catch {
            return null;
        }

        const the_aliases = parse_maint_file(my_content);
        this.file_cache.set(file_path, {
            mtime_ms: my_stat.mtimeMs,
            aliases: the_aliases,
        });
        return the_aliases;
    }
}

/**
 * Resolver for `{findalias X}` SMCL substitutions, backed by
 * `*smcl_alias.maint` files.
 */
export class FindaliasResolver extends MaintAliasStore {
    protected get file_suffix(): string {
        return 'smcl_alias.maint';
    }
}

/**
 * Resolver for `help <topic>` redirects, backed by `*help_alias.maint`
 * files. Returns the redirected topic basename (e.g. `operator` for
 * `operators`), which the caller then feeds back into the normal
 * `.sthlp` file-path resolution flow.
 */
export class HelpAliasResolver extends MaintAliasStore {
    protected get file_suffix(): string {
        return 'help_alias.maint';
    }
}

/**
 * Parse the contents of a `*smcl_alias.maint` file into an alias map.
 *
 * Exported for tests. Blank lines and pure-comment lines are ignored.
 * The key is the first whitespace-delimited token; the value is the
 * remainder of the line, trimmed.
 */
export function parse_maint_file(content: string): Map<string, string> {
    const the_aliases = new Map<string, string>();
    const the_lines = content.split(/\r?\n/);
    for (const my_line of the_lines) {
        if (my_line.trim().length === 0) continue;
        const my_match = my_line.match(/^\s*(\S+)\s+(.+?)\s*$/);
        if (!my_match) continue;
        const my_key = my_match[1];
        const my_value = my_match[2];
        if (my_key.length === 0 || my_value.length === 0) continue;
        // First definition wins (matches merge precedence semantics
        // applied at the directory level).
        if (!the_aliases.has(my_key)) {
            the_aliases.set(my_key, my_value);
        }
    }
    return the_aliases;
}

function arrays_equal(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

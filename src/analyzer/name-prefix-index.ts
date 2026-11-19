/**
 * Abbreviation lookup over a map of names.
 *
 * Stata accepts an abbreviation of a variable name (`su pri` for
 * `price`), so "is this name defined?" becomes "does any known name
 * start with it?". Scanning the whole map for each reference costs
 * O(names) per reference, and O(n^2) for a file that creates and
 * then reads n variables. The index records every prefix of every
 * name with the earliest line from which a name with that prefix is
 * visible, so each lookup is one map access.
 *
 * An index is built on first use and kept in step by
 * `index_name_prefixes`, which the owner calls after each
 * `names.set`. Maps only grow (the analyzer never deletes a variable;
 * merged tables are new maps), so a map with more keys than its index
 * holds was changed without that call and is reindexed in full.
 * Matching is exact-case: Stata names are case-sensitive.
 */

interface PrefixIndex {
    /** The map's keys the index holds. */
    indexed: Set<string>;
    /** Each prefix of a name, mapped to the earliest line it is visible. */
    earliest_line: Map<string, number>;
}

const INDEXES = new WeakMap<ReadonlyMap<string, unknown>, PrefixIndex>();

function add_prefixes(
    earliest_line: Map<string, number>,
    name: string,
    line: number
): void {
    // Longest prefix first: once a prefix already has an earlier or
    // equal line, every shorter one does too.
    for (let i = name.length; i >= 0; i--) {
        const prefix = name.slice(0, i);
        const known = earliest_line.get(prefix);
        if (known !== undefined && known <= line) return;
        earliest_line.set(prefix, line);
    }
}

function index_of<T>(
    names: ReadonlyMap<string, T>,
    line_of: (value: T) => number
): PrefixIndex {
    const existing = INDEXES.get(names);
    if (existing !== undefined && existing.indexed.size === names.size) {
        return existing;
    }
    const earliest_line = new Map<string, number>();
    for (const [my_name, my_value] of names) {
        add_prefixes(earliest_line, my_name, line_of(my_value));
    }
    const index = { indexed: new Set(names.keys()), earliest_line };
    INDEXES.set(names, index);
    return index;
}

/**
 * Record `name` (already set in `names`) in the map's index, visible
 * from `line` on. A no-op until the map is first queried.
 */
export function index_name_prefixes(
    names: ReadonlyMap<string, unknown>,
    name: string,
    line = 0
): void {
    const index = INDEXES.get(names);
    if (index === undefined) return;
    add_prefixes(index.earliest_line, name, line);
    index.indexed.add(name);
}

/**
 * True if some name in `names` starts with `prefix` (or is it) and is
 * visible at `line`. `line_of` gives the line from which an entry is
 * visible; without it every entry is visible everywhere. Pass the same
 * `line_of` for every query of one map.
 */
export function has_name_with_prefix<T>(
    names: ReadonlyMap<string, T>,
    prefix: string,
    line = Number.POSITIVE_INFINITY,
    line_of: (value: T) => number = () => 0
): boolean {
    const earliest = index_of(names, line_of).earliest_line.get(prefix);
    return earliest !== undefined && earliest <= line;
}

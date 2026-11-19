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
 * An index belongs to one owner for one span of work, such as one
 * analysis. It is built from the map on first query and then kept in
 * step only by `add`, which the owner calls after each `names.set`.
 * A change made any other way (by another owner, or between
 * analyses) is not seen, so create a new index whenever the map may
 * have changed behind the owner's back. Matching is exact-case:
 * Stata names are case-sensitive.
 */

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

export class NamePrefixIndex<T> {
    /** Each prefix of a name, mapped to the earliest line it is visible. */
    private earliest_line: Map<string, number> | undefined;

    /**
     * @param names - The map the index answers for.
     * @param line_of - The line from which an entry is visible; by
     *     default every entry is visible everywhere.
     */
    constructor(
        private readonly names: ReadonlyMap<string, T>,
        private readonly line_of: (value: T) => number = () => 0
    ) {}

    /**
     * Record `name`, already set in the map, visible from `line` on.
     * A no-op until the index is first queried.
     */
    add(name: string, line = 0): void {
        if (this.earliest_line !== undefined) {
            add_prefixes(this.earliest_line, name, line);
        }
    }

    /**
     * True if some name starts with `prefix` (or is it) and is visible
     * at `line`.
     */
    has(prefix: string, line = Number.POSITIVE_INFINITY): boolean {
        if (this.earliest_line === undefined) {
            this.earliest_line = new Map();
            for (const [my_name, my_value] of this.names) {
                add_prefixes(this.earliest_line, my_name, this.line_of(my_value));
            }
        }
        const earliest = this.earliest_line.get(prefix);
        return earliest !== undefined && earliest <= line;
    }
}

/**
 * Settle the working directories that closed files inherit from the
 * callers that reach them, for `sight check` and `sight graph`.
 *
 * A file with no `sight: cd` of its own runs in the working directory
 * of the caller that runs it (docs/cross-file.md, Working Directory).
 * An open document finds that directory with ScopeResolver's backward
 * walk (`resolve_document_working_directory`): it tries the file's
 * callers in the dependency graph's parent order, follows each one's
 * chain upward before the next, and returns the first `sight: cd` it
 * meets. That walk only sees callers whose calls already reach the file,
 * and a caller's calls resolve against the directory it inherited in
 * turn, so a scan that registers every file with only its own or
 * explicitly inherited directory leaves the third level and below
 * without callers.
 *
 * This module gives each such file the directory that walk would give
 * it once the graph is complete, and registers the file's calls again
 * with it. It works from data already known, one hop at a time: each
 * round reads a file's parents' results from the round before and the
 * graph as the last round left it, for the files below a change only,
 * and stops when no result changes. A file that keeps changing (in a
 * cycle) is left unsettled after a bounded number of changes, so the
 * cost is bounded by the graph's edges times the depth limit.
 *
 * A file whose header names its parents (`sight: done-by`) walks
 * through those instead of the graph's callers, as the walk does.
 *
 * A file inherits through a call only when the caller makes that call
 * in the directory it starts in. Once a literal `cd` has moved the
 * caller elsewhere, the walk would still report the caller's starting
 * directory, which is wrong, so such a call passes nothing on: the file
 * it reaches, and every file whose walk would go through it, keeps the
 * registration it had without settling. The same holds whenever the
 * walk's answer is not known here (a caller outside the facts, or one
 * with explicit `sight: done-by` parents but no directory from them).
 * In those cases the result is what it was before settling existed.
 */

import type { ForwardCall } from '../types';
import type { AutoBackwardEdge } from '../dependency-graph';

/** What settling needs to know about one file. */
export interface WorkingDirectoryFacts {
    uri: string;
    /** The file's own `sight: cd`, resolved. */
    own_working_directory: string | undefined;
    /**
     * Own, or inherited through `sight: done-by` / `included-by`.
     * Forward directives (`sight: do`) always resolve against this,
     * never a directory inherited from a caller found by the graph.
     */
    directive_working_directory: string | undefined;
    /**
     * True when the file takes its parents from the dependency graph:
     * no backward directives, not standalone, `auto` mode, and no own
     * `sight: cd`.
     */
    inherits_from_callers: boolean;
    /**
     * True when the file has `sight: done-by` / `included-by` parents
     * the walk follows (and is not standalone).
     */
    has_backward_directives: boolean;
    /**
     * For a file with `has_backward_directives`: the files its
     * `done-by` / `included-by` directives name, in header order, as
     * the walk resolves them (`ScopeResolver.explicit_parent_uris`).
     * Settling then follows them as the walk does, through callers
     * the graph finds above them too, and sets `working_directory`.
     * `directive_working_directory` stays as given. Without this list
     * such a file keeps the directory it was given.
     */
    explicit_parents?: string[];
    /**
     * The directory the file's command calls start in. Producers set it
     * to `directive_working_directory` before settling; settling sets it.
     */
    working_directory: string | undefined;
    /**
     * Each callee's edge call from the file's latest registration, as
     * `DependencyGraph.update_caller` reports it.
     */
    first_calls: Map<string, ForwardCall>;
}

/** Fallback when the config leaves `max_backward_depth` unset. */
export const DEFAULT_MAX_BACKWARD_DEPTH = 10;

/**
 * What the backward walk would find for a file. `settled` and `blocked`
 * carry the directory the walk returns and the callers on its path
 * (nearest first; empty for a file with a directory of its own).
 * `settled` means every call on that path is made in its caller's
 * starting directory, so the file inherits the directory. `blocked`
 * means some call is not, or the walk's answer is unknown here
 * (`directory` undefined), so the file keeps its unsettled registration.
 * `none` means the walk finds no directory.
 */
type WalkResult =
    | { kind: 'settled'; directory: string; chain: string[] }
    | { kind: 'blocked'; directory: string | undefined; chain: string[] }
    | { kind: 'none' };

const NONE: WalkResult = { kind: 'none' };
const UNKNOWN: WalkResult = {
    kind: 'blocked', directory: undefined, chain: [],
};

function same_result(a: WalkResult, b: WalkResult): boolean {
    if (a.kind === 'none' || b.kind === 'none') {
        return a.kind === b.kind;
    }
    return a.kind === b.kind &&
        a.directory === b.directory &&
        a.chain.length === b.chain.length &&
        a.chain.every((my_uri, i) => my_uri === b.chain[i]);
}

/**
 * Files whose walk passes through a call this module does not pass a
 * directory through, mapped to the directory the walk gives them
 * (undefined when it is not known here). Such a file keeps its
 * unsettled registration, but an open document, or a `check` target,
 * still gets the walk's directory for its own calls; `sight graph`
 * shows that one so it agrees with them.
 */
export type BlockedWorkingDirectories = Map<string, string | undefined>;

/**
 * Give each file in `the_facts` that inherits from its callers the
 * directory the backward walk would find, and call `register` for each
 * file whose `working_directory` changed (its calls must be registered
 * again, updating its `first_calls`). The result is a function of the
 * facts and the graph alone; `the_facts` should be sorted by URI.
 */
export function settle_inherited_working_directories<
    T extends WorkingDirectoryFacts,
>(options: {
    the_facts: readonly T[];
    get_parents: (uri: string) => AutoBackwardEdge[];
    register: (facts: T) => void;
    max_backward_depth?: number;
}): BlockedWorkingDirectories {
    const { the_facts, get_parents, register } = options;
    const max_depth =
        options.max_backward_depth ?? DEFAULT_MAX_BACKWARD_DEPTH;

    // A directory is only ever inherited from a file that has one. When
    // none does, there is nothing to settle.
    const facts_by_uri = new Map<string, T>();
    let has_any_directory = false;
    for (const my_facts of the_facts) {
        facts_by_uri.set(my_facts.uri, my_facts);
        if (my_facts.directive_working_directory !== undefined) {
            has_any_directory = true;
        }
    }
    const the_blocked: BlockedWorkingDirectories = new Map();
    if (!has_any_directory) {
        return the_blocked;
    }

    // A file walks when its directory comes from other files: from the
    // callers the graph finds, or from the parents its header names.
    const walks_explicit = (facts: T): boolean =>
        facts.has_backward_directives &&
        facts.own_working_directory === undefined &&
        facts.explicit_parents !== undefined;
    const walks = (facts: T): boolean =>
        facts.inherits_from_callers || walks_explicit(facts);

    // Every other file has a fixed result: its own or given directory;
    // unknown when explicit parents not listed here give none (the walk
    // would go on through those parents' callers); none for a
    // standalone file, whose walk stops there.
    const fixed_result = (facts: T): WalkResult => {
        if (facts.directive_working_directory !== undefined) {
            return {
                kind: 'settled',
                directory: facts.directive_working_directory,
                chain: [],
            };
        }
        return facts.has_backward_directives ? UNKNOWN : NONE;
    };
    const the_results = new Map<string, WalkResult>();
    const the_walking: T[] = [];
    // What a walking file was registered with before settling.
    const the_unsettled = new Map<string, string | undefined>();
    // Explicit parent → the files that name it.
    const the_explicit_children = new Map<string, string[]>();
    for (const my_facts of the_facts) {
        if (!walks(my_facts)) {
            the_results.set(my_facts.uri, fixed_result(my_facts));
            continue;
        }
        the_walking.push(my_facts);
        the_results.set(my_facts.uri, NONE);
        the_unsettled.set(
            my_facts.uri, my_facts.directive_working_directory);
        if (walks_explicit(my_facts)) {
            for (const my_parent of my_facts.explicit_parents ?? []) {
                const the_children = the_explicit_children.get(my_parent);
                if (the_children) {
                    the_children.push(my_facts.uri);
                } else {
                    the_explicit_children.set(my_parent, [my_facts.uri]);
                }
            }
        }
    }

    // One step of the walk for `facts`, reading its parents' results
    // from the previous round.
    const walk_one_step = (facts: T): WalkResult => {
        const is_explicit = walks_explicit(facts);
        const the_parent_uris = is_explicit
            ? facts.explicit_parents ?? []
            : get_parents(facts.uri).map(my_edge => my_edge.caller_uri);
        for (const my_caller_uri of the_parent_uris) {
            if (my_caller_uri === facts.uri) {
                continue;
            }
            const my_caller = facts_by_uri.get(my_caller_uri);
            const my_caller_result = my_caller === undefined
                ? UNKNOWN
                : the_results.get(my_caller_uri) ?? UNKNOWN;
            if (my_caller_result.kind === 'none') {
                continue;
            }
            if (my_caller === undefined || my_caller_result.directory === undefined) {
                return UNKNOWN;
            }
            // The walk from this file never revisits it and gives up a
            // path longer than the depth limit, so through this caller it
            // would go on to the caller's other parents, which one step
            // cannot see. Its answer is then unknown here.
            if (
                my_caller_result.chain.includes(facts.uri) ||
                my_caller_result.chain.length + 1 > max_depth
            ) {
                return UNKNOWN;
            }
            const directory = my_caller_result.directory;
            const chain = [my_caller_uri, ...my_caller_result.chain];
            if (my_caller_result.kind === 'blocked') {
                return { kind: 'blocked', directory, chain };
            }
            // A parent the header names passes its directory on whatever
            // its calls do: the walk reads only its `sight: cd`.
            if (is_explicit) {
                return { kind: 'settled', directory, chain };
            }
            // A caller the graph found passes the directory on only when
            // the call that reaches this file is made in the directory
            // the caller starts in. A forward directive is looked up
            // from another directory (`working_directory` on the call),
            // but the file it names still runs where the caller does.
            const my_call = my_caller.first_calls.get(facts.uri);
            if (
                my_call === undefined ||
                my_caller.working_directory !== directory ||
                (my_call.source === 'command' &&
                    my_call.working_directory !== directory)
            ) {
                return { kind: 'blocked', directory, chain };
            }
            return { kind: 'settled', directory, chain };
        }
        return NONE;
    };

    // Rounds: each computes the results of the files whose inputs
    // changed in the round before, from that round's results and graph,
    // then registers again the files whose directory changed. A file's
    // inputs are its parents' results and registrations, so only the
    // files below a change are computed again and a long chain costs
    // time linear in its length.
    //
    // A file in a cycle can keep changing. One that changes more often
    // than any file outside a cycle would is given the unknown result
    // for good (it keeps its unsettled registration, and its directory
    // is left to the walk), which ends the changes below it too. Files
    // elsewhere are not affected.
    const max_changes = max_depth + 2;
    const the_change_counts = new Map<string, number>();
    const the_pinned = new Set<string>();
    let the_dirty = new Set<string>(the_walking.map(my_facts => my_facts.uri));
    while (the_dirty.size > 0) {
        const the_changed = new Map<string, WalkResult>();
        for (const my_facts of the_walking) {
            if (!the_dirty.has(my_facts.uri) || the_pinned.has(my_facts.uri)) {
                continue;
            }
            const my_result = walk_one_step(my_facts);
            if (!same_result(my_result, the_results.get(my_facts.uri) ?? NONE)) {
                the_changed.set(my_facts.uri, my_result);
            }
        }
        const the_next_dirty = new Set<string>();
        const mark_children = (facts: T): void => {
            for (const my_callee of facts.first_calls.keys()) {
                the_next_dirty.add(my_callee);
            }
            for (const my_child of the_explicit_children.get(facts.uri) ?? []) {
                the_next_dirty.add(my_child);
            }
        };
        for (const [my_uri, my_result] of the_changed) {
            const my_count = (the_change_counts.get(my_uri) ?? 0) + 1;
            the_change_counts.set(my_uri, my_count);
            if (my_count > max_changes) {
                the_pinned.add(my_uri);
                the_results.set(my_uri, UNKNOWN);
            } else {
                the_results.set(my_uri, my_result);
            }
        }
        for (const my_uri of the_changed.keys()) {
            const my_facts = facts_by_uri.get(my_uri);
            if (my_facts === undefined) {
                continue;
            }
            mark_children(my_facts);
            const my_result = the_results.get(my_uri) ?? NONE;
            const working_directory = my_result.kind === 'settled'
                ? my_result.directory
                : the_unsettled.get(my_uri);
            if (working_directory !== my_facts.working_directory) {
                my_facts.working_directory = working_directory;
                register(my_facts);
                // The files it now reaches have a new parent, or the
                // same parent with a new call.
                mark_children(my_facts);
            }
        }
        the_dirty = the_next_dirty;
    }
    for (const my_facts of the_walking) {
        const my_result = the_results.get(my_facts.uri) ?? NONE;
        if (my_result.kind === 'blocked') {
            the_blocked.set(my_facts.uri, my_result.directory);
        }
    }
    return the_blocked;
}

/**
 * A file's calls as `check` and `graph` register them: command calls
 * stamped with `command_calls` (already projected through the file's
 * `cd` timeline from `working_directory`), directive calls with the
 * directive directory. Mixed lists are sorted by line, as the index
 * always has; command-only files keep the analyzer's order.
 */
export function merge_forward_calls(
    command_calls: ForwardCall[],
    directive_calls: ForwardCall[],
): ForwardCall[] {
    const the_calls = [...command_calls, ...directive_calls];
    if (directive_calls.length > 0) {
        the_calls.sort((a, b) => a.call_site_line - b.call_site_line);
    }
    return the_calls;
}

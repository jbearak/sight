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
 * round reads every caller's result from the round before and the
 * graph as the last round left it, and stops when no result changes.
 * A round costs time linear in the graph's edges times the depth limit,
 * and the number of rounds is bounded by the depth limit, so a dense
 * cycle costs no more than a chain.
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

    // Files that do not inherit from callers have a fixed result: their
    // own or explicitly inherited directory; unknown when explicit
    // parents give none (the walk would go on through those parents'
    // callers); none for a standalone file, whose walk stops there.
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
    let the_results = new Map<string, WalkResult>();
    const the_inheriting: T[] = [];
    for (const my_facts of the_facts) {
        if (my_facts.inherits_from_callers) {
            the_inheriting.push(my_facts);
            the_results.set(my_facts.uri, NONE);
        } else {
            the_results.set(my_facts.uri, fixed_result(my_facts));
        }
    }

    // One step of the walk for `facts`, reading its callers' results
    // from the previous round.
    const walk_one_step = (facts: T): WalkResult => {
        for (const my_edge of get_parents(facts.uri)) {
            const my_caller_uri = my_edge.caller_uri;
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
            // The walk from this file never revisits it, and gives up a
            // path longer than the depth limit.
            if (
                my_caller_result.chain.includes(facts.uri) ||
                my_caller_result.chain.length + 1 > max_depth
            ) {
                continue;
            }
            const directory = my_caller_result.directory;
            const chain = [my_caller_uri, ...my_caller_result.chain];
            // Pass the directory on only when the call that reaches this
            // file is made in the directory the caller starts in.
            const my_call = my_caller.first_calls.get(facts.uri);
            if (
                my_caller_result.kind === 'blocked' ||
                my_call === undefined ||
                my_caller.working_directory !== directory ||
                my_call.working_directory !== directory
            ) {
                return { kind: 'blocked', directory, chain };
            }
            return { kind: 'settled', directory, chain };
        }
        return NONE;
    };

    // Each round settles at least one more level of callers; the bound
    // ends a cycle whose results keep changing.
    const max_rounds = max_depth + 2;
    for (let round = 0; round < max_rounds; round++) {
        const the_next = new Map(the_results);
        let changed = false;
        for (const my_facts of the_inheriting) {
            const my_result = walk_one_step(my_facts);
            if (!same_result(my_result, the_results.get(my_facts.uri) ?? NONE)) {
                the_next.set(my_facts.uri, my_result);
                changed = true;
            }
        }
        the_results = the_next;
        if (!changed) {
            break;
        }
        for (const my_facts of the_inheriting) {
            const my_result = the_results.get(my_facts.uri) ?? NONE;
            const working_directory = my_result.kind === 'settled'
                ? my_result.directory
                : my_facts.directive_working_directory;
            if (working_directory !== my_facts.working_directory) {
                my_facts.working_directory = working_directory;
                register(my_facts);
            }
        }
    }
    for (const my_facts of the_inheriting) {
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

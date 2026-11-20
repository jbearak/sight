/**
 * Settle the working directories that closed files inherit from the
 * callers that reach them, for `sight check` and `sight graph`.
 *
 * A file with no `sight: cd` of its own runs in the working directory
 * of the caller that runs it (docs/cross-file.md, Working Directory).
 * An open document finds that directory with ScopeResolver's backward
 * walk (`resolve_document_working_directory`). The walk only sees
 * callers whose calls already reach the file, and a caller's calls
 * resolve against the directory it inherited in turn, so a scan that
 * registers every file with only its own or explicitly inherited
 * directory leaves the third level and below without callers.
 *
 * This module asks that same walk, for every file, on the graph as it
 * stands, registers again the calls of each file whose directory
 * changed, and repeats until nothing changes. The answer is the walk's
 * by construction: no rule of the walk (parent order, depth limit,
 * named parents, parents outside the scan) is restated here.
 *
 * Two things are added to the walk's answer:
 *
 * - A file inherits through a call only when its caller makes that
 *   call in the directory the caller starts in. Once a literal `cd`
 *   has moved the caller elsewhere, the walk would still report the
 *   caller's starting directory, which is wrong. Such a file, and
 *   every file whose walk goes through it, keeps the registration it
 *   had without settling.
 * - The rounds must end. A cycle of callers whose calls resolve only
 *   while it is settled alternates for ever; when the registrations
 *   repeat an earlier round's, the files that changed in between are
 *   left without settling. A walk that would visit more parents than
 *   `MAX_WALK_STEPS` (a dense cycle) is left the same way.
 */

import * as node_fs from 'fs';
import * as path from 'path';
import type { CdCommand, ForwardCall } from '../types';
import type { WorkingDirectoryProbeResult } from '../scope-resolver';
import {
    build_cd_timeline,
    wd_for_position,
    type CdTimeline,
    type RichResolveFs,
} from '../utils/file-path-utils';
import {
    uri_to_fs_path,
    without_trailing_separators,
} from '../utils/fs-path';

/** What settling needs to know about one file. */
export interface WorkingDirectoryFacts {
    uri: string;
    /** The file's own `sight: cd`, resolved. */
    own_working_directory: string | undefined;
    /**
     * Own, or inherited through `sight: done-by` / `included-by` alone.
     * Forward directives (`sight: do`) always resolve against this,
     * never a directory inherited from a caller found by the graph.
     */
    directive_working_directory: string | undefined;
    /** The file has a `sight: standalone` marker: it inherits nothing. */
    is_standalone: boolean;
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
    /** The file's literal `cd` commands. */
    cd_commands: CdCommand[];
}

/**
 * The most parents one walk may visit before the file is left without
 * settling. A walk that finds a directory visits a few; one over a
 * dense cycle visits every path up to the depth limit.
 */
export const MAX_WALK_STEPS = 2000;

/** What settling found, for a producer that shows directories. */
export interface SettledWorkingDirectories {
    /**
     * The directory the walk gives each file that inherits one (also
     * a file left without settling because of a literal `cd`), and
     * undefined for one the walk gives none.
     */
    walk_directories: Map<string, string | undefined>;
    /**
     * Files left without settling whose walk was not finished here.
     * `resolve_document_working_directory` gives their directory.
     */
    unknown: Set<string>;
}

type Outcome =
    | { kind: 'settled'; directory: string }
    | { kind: 'blocked'; directory: string }
    | { kind: 'none' }
    | { kind: 'unknown' };

/**
 * Whether two directory paths name one directory: the same string once
 * separators at the end are dropped, or the same directory on disk
 * (another spelling of it, as on a case-insensitive volume).
 */
function make_same_directory(): (a: string, b: string) => boolean {
    const the_identities = new Map<string, string | undefined>();
    const identity = (directory: string): string | undefined => {
        if (the_identities.has(directory)) {
            return the_identities.get(directory);
        }
        let my_identity: string | undefined;
        try {
            const stat = node_fs.statSync(directory, { bigint: true });
            my_identity = `${stat.dev}:${stat.ino}`;
        } catch {
            my_identity = undefined;
        }
        the_identities.set(directory, my_identity);
        return my_identity;
    };
    return (a, b) => {
        const my_a = without_trailing_separators(path.normalize(a));
        const my_b = without_trailing_separators(path.normalize(b));
        if (my_a === my_b) {
            return true;
        }
        const identity_a = identity(my_a);
        return identity_a !== undefined && identity_a === identity(my_b);
    };
}

/**
 * Give each file in `the_facts` the directory the backward walk finds
 * for it once the graph is complete, and call `register` for each file
 * whose `working_directory` changed (its calls must be registered
 * again, updating its `first_calls`). `probe` runs the walk for one
 * file on the graph as it stands. The result is a function of the
 * facts and the graph alone; `the_facts` should be sorted by URI.
 */
export async function settle_inherited_working_directories<
    T extends WorkingDirectoryFacts,
>(options: {
    the_facts: readonly T[];
    /** Parents come from the graph ('auto' mode), not only headers. */
    auto_parents: boolean;
    probe: (facts: T) => Promise<WorkingDirectoryProbeResult>;
    register: (facts: T) => void;
    workspace_roots: string[];
    fs?: RichResolveFs;
}): Promise<SettledWorkingDirectories> {
    const { the_facts, auto_parents, probe, register } = options;
    const settled: SettledWorkingDirectories = {
        walk_directories: new Map(), unknown: new Set(),
    };

    const facts_by_uri = new Map<string, T>();
    for (const my_facts of the_facts) {
        facts_by_uri.set(my_facts.uri, my_facts);
    }
    // A file walks when its directory comes from other files: the
    // parents its header names, or the callers the graph finds.
    const the_walking = the_facts.filter(my_facts =>
        my_facts.own_working_directory === undefined &&
        !my_facts.is_standalone &&
        (my_facts.has_backward_directives || auto_parents));
    if (the_walking.length === 0) {
        return settled;
    }
    // What each walking file was registered with before settling.
    const the_unsettled = new Map<string, string | undefined>();
    for (const my_facts of the_walking) {
        the_unsettled.set(my_facts.uri, my_facts.directive_working_directory);
    }

    const same_directory = make_same_directory();

    // The directory each of a file's calls is made in follows its
    // literal `cd` commands from the directory it is registered with.
    const the_timelines = new Map<string, CdTimeline>();
    const call_directory = (
        caller: T, call: ForwardCall,
    ): string | undefined => {
        if (call.source === 'command') {
            return call.working_directory;
        }
        let my_timeline = the_timelines.get(caller.uri);
        if (my_timeline === undefined) {
            my_timeline = build_cd_timeline({
                starting_wd: caller.working_directory,
                caller_dir: path.dirname(uri_to_fs_path(caller.uri)),
                cd_commands: caller.cd_commands,
                workspace_roots: options.workspace_roots,
                fs: options.fs,
            }).timeline;
            the_timelines.set(caller.uri, my_timeline);
        }
        return wd_for_position(my_timeline, call.range.start);
    };

    // Whether `directory` reaches `facts` along `chain` (the walk's
    // path, nearest parent first) only through calls made in the
    // directory their caller starts in, by callers that are themselves
    // registered with it.
    const passes_through = (
        facts: T, directory: string, chain: string[],
    ): boolean => {
        // The file the hop leads to; undefined for one outside the
        // facts, which only a header can name as a parent.
        let my_child: T | undefined = facts;
        for (const my_parent_uri of chain) {
            const my_parent = facts_by_uri.get(my_parent_uri);
            const is_named_hop = !auto_parents || my_child === undefined ||
                my_child.has_backward_directives;
            if (my_parent === undefined) {
                // A parent outside the facts is read by the walk all the
                // same, but the graph has no calls of it to check.
                if (!is_named_hop) {
                    return false;
                }
                my_child = undefined;
                continue;
            }
            if (
                my_parent.working_directory === undefined ||
                !same_directory(my_parent.working_directory, directory)
            ) {
                return false;
            }
            // A parent the header names passes its directory on whatever
            // its calls do: the walk reads only its `sight: cd`.
            if (!is_named_hop && my_child !== undefined) {
                const my_call = my_parent.first_calls.get(my_child.uri);
                const my_call_directory = my_call === undefined
                    ? undefined
                    : call_directory(my_parent, my_call);
                if (
                    my_call_directory === undefined ||
                    !same_directory(my_call_directory, directory)
                ) {
                    return false;
                }
            }
            my_child = my_parent;
        }
        return true;
    };

    // Files some `sight: cd` can reach through the calls registered now:
    // only they can inherit a directory, so only they are walked. A file
    // that names its parents may name one outside the facts, so it and
    // the files below it count as reachable.
    const reachable_files = (): Set<string> => {
        const the_reached = new Set<string>();
        const the_queue: string[] = [];
        for (const my_facts of the_facts) {
            if (
                my_facts.own_working_directory !== undefined ||
                (my_facts.has_backward_directives && !my_facts.is_standalone)
            ) {
                the_reached.add(my_facts.uri);
                the_queue.push(my_facts.uri);
            }
        }
        for (let i = 0; i < the_queue.length; i++) {
            const my_facts = facts_by_uri.get(the_queue[i] ?? '');
            for (const my_callee of my_facts?.first_calls.keys() ?? []) {
                if (!the_reached.has(my_callee)) {
                    the_reached.add(my_callee);
                    the_queue.push(my_callee);
                }
            }
        }
        return the_reached;
    };

    const the_outcomes = new Map<string, Outcome>();
    // Files left without settling for good.
    const the_pinned = new Set<string>();
    // The round in which each file's registration last changed, and
    // the round that first produced each set of registrations.
    const the_last_changes = new Map<string, number>();
    let the_seen_rounds = new Map<string, number>();
    const registrations = (): string => the_walking
        .map(my_facts => my_facts.working_directory ?? '')
        .join('\u0000');
    the_seen_rounds.set(registrations(), 0);

    const set_directory = (
        facts: T, working_directory: string | undefined, round: number,
    ): void => {
        if (working_directory === facts.working_directory) {
            return;
        }
        facts.working_directory = working_directory;
        the_timelines.delete(facts.uri);
        the_last_changes.set(facts.uri, round);
        register(facts);
    };

    for (let round = 1; ; round++) {
        // Every walk of a round reads the graph the round before left.
        const the_reachable = reachable_files();
        const the_round = new Map<string, Outcome>();
        for (const my_facts of the_walking) {
            if (the_pinned.has(my_facts.uri)) {
                continue;
            }
            if (!the_reachable.has(my_facts.uri)) {
                the_round.set(my_facts.uri, { kind: 'none' });
                continue;
            }
            const my_probe = await probe(my_facts);
            if (my_probe.kind === 'exhausted') {
                the_pinned.add(my_facts.uri);
                the_round.set(my_facts.uri, { kind: 'unknown' });
            } else if (my_probe.kind === 'none') {
                the_round.set(my_facts.uri, { kind: 'none' });
            } else {
                the_round.set(my_facts.uri, {
                    kind: passes_through(
                        my_facts, my_probe.directory, my_probe.chain)
                        ? 'settled' : 'blocked',
                    directory: my_probe.directory,
                });
            }
        }
        let changed = false;
        for (const my_facts of the_walking) {
            const my_outcome = the_round.get(my_facts.uri);
            if (my_outcome === undefined) {
                continue;
            }
            the_outcomes.set(my_facts.uri, my_outcome);
            const before = the_last_changes.get(my_facts.uri);
            set_directory(
                my_facts,
                my_outcome.kind === 'settled' ? my_outcome.directory
                    : my_outcome.kind === 'none' ? undefined
                    : the_unsettled.get(my_facts.uri),
                round,
            );
            if (the_last_changes.get(my_facts.uri) !== before) {
                changed = true;
            }
        }
        if (!changed) {
            break;
        }
        // The same registrations as an earlier round: the rounds since
        // would repeat for ever. Leave the files that changed in them
        // without settling, and go on with the rest.
        const signature = registrations();
        const first_round = the_seen_rounds.get(signature);
        if (first_round === undefined) {
            the_seen_rounds.set(signature, round);
            continue;
        }
        for (const my_facts of the_walking) {
            if ((the_last_changes.get(my_facts.uri) ?? 0) > first_round) {
                the_pinned.add(my_facts.uri);
                the_outcomes.set(my_facts.uri, { kind: 'unknown' });
                set_directory(
                    my_facts, the_unsettled.get(my_facts.uri), round);
            }
        }
        the_seen_rounds = new Map([[registrations(), round]]);
    }

    for (const my_facts of the_walking) {
        const my_outcome = the_outcomes.get(my_facts.uri) ?? { kind: 'none' };
        if (my_outcome.kind === 'unknown') {
            settled.unknown.add(my_facts.uri);
        } else {
            settled.walk_directories.set(
                my_facts.uri,
                my_outcome.kind === 'none' ? undefined : my_outcome.directory,
            );
        }
    }
    return settled;
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

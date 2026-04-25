/**
 * Shared `.sthlp` topic resolver.
 *
 * Centralizes the multi-step resolution chain used by the LSP handler
 * (`sight/resolveSthlpFile`) and the offline link checker
 * (`scripts/check-help-links.ts`) so both consumers follow identical
 * fallback logic.
 *
 * Resolution order, in priority:
 *   1. Direct lookup (filesystem + `.maint` aliases via the indexer),
 *      including a hyphen-to-underscore variant of the topic so
 *      filenames that join hyphenated multi-words with underscores
 *      (`gsem family-and-link options` ->
 *      `gsem_family_and_link_options.sthlp`) win before any redirect
 *      points us at a parent help page
 *   2. Command-database `helpFile` redirect (e.g. `local` -> `macro`)
 *   3. Abbreviation expansion (e.g. `reg` -> `regress`,
 *      `loc` -> `local` -> `macro`), sorted by command priority then
 *      name length so the canonical short command wins
 *   4. Function-name fallback (`float()` -> `f_float`)
 *   5. System-variable fallback (`_N` -> `_variables`)
 *   6. Hash-prefix fallback (`#delimit` -> `delimit`)
 *   7. Case-insensitive fallback (`Java` -> `java`)
 *   8. Suffix probing (`dynamic` -> `dynamic_intro`, etc.)
 */

import { command_database } from '../command-database';
import type { WorkspaceIndexer } from '../indexer';

// Suffixes Stata's help system tries when the bare topic has no file
// of its own (e.g. `dynamic` -> `dynamic_intro`,
// `bayesian` -> `bayesian_estimation`).
const HELP_TOPIC_SUFFIXES: readonly string[] = [
    '_intro',
    '_commands',
    '_options',
    '_functions',
    '_estimation',
    '_styles',
    '_modes',
    '_postestimation',
];

/**
 * Resolve a Stata help topic to an absolute `.sthlp` file path.
 *
 * @param indexer - Workspace indexer used for filesystem lookups
 * @param topic - Raw topic as the user typed it
 * @returns Absolute path of the resolved file, or `null` if no
 *          fallback succeeds
 */
export async function resolve_help_topic(
    indexer: WorkspaceIndexer,
    topic: string
): Promise<string | null> {
    const my_topic = (topic ?? '').trim();
    if (my_topic.length === 0) return null;

    // 1. Direct lookup (handles maint-aliased topics too).
    const my_direct = await indexer.resolve_sthlp_file(my_topic);
    if (my_direct) return my_direct;

    // 1b. Hyphen-to-underscore variant of the direct lookup.
    //     Stata file names use underscores for both spaces and
    //     hyphens (`gsem_family_and_link_options.sthlp`), so a topic
    //     like `gsem family-and-link options` only matches once we
    //     normalize the hyphens. This must run before the helpFile
    //     redirect so a real hyphen-normalized hit (the user's
    //     intended target) wins over a parent-page fallback.
    if (my_topic.includes('-')) {
        const my_dehyphened = my_topic.replace(/-/g, '_');
        const my_dehyphened_path = await indexer.resolve_sthlp_file(
            my_dehyphened
        );
        if (my_dehyphened_path) return my_dehyphened_path;
    }

    // Split into head + tail so subcommand topics
    // (`frame create`, `macro dir`, ...) flow through every fallback.
    const my_first_space = my_topic.search(/\s/);
    const my_head = my_first_space === -1
        ? my_topic
        : my_topic.substring(0, my_first_space);
    const my_tail = my_first_space === -1
        ? ''
        : my_topic.substring(my_first_space);
    if (my_head.length === 0) return null;
    const my_head_lower = my_head.toLowerCase();

    // 2. helpFile redirect (e.g. `local` -> `macro`,
    //    `replace` -> `generate`).
    const my_head_lookup = command_database.lookup(my_head);
    if (
        my_head_lookup?.helpFile
        && my_head_lookup.helpFile.toLowerCase() !== my_head_lower
    ) {
        const my_redirected = await indexer.resolve_sthlp_file(
            my_head_lookup.helpFile + my_tail
        );
        if (my_redirected) return my_redirected;
        if (my_tail.length > 0) {
            const my_parent_only = await indexer.resolve_sthlp_file(
                my_head_lookup.helpFile
            );
            if (my_parent_only) return my_parent_only;
        }
    } else if (my_tail.length > 0 && my_head_lookup) {
        // Subcommands without a dedicated `<head>_<sub>.sthlp`
        // open the parent's help page. Use the canonical name so
        // abbreviated heads (`mac dir`, `fr drop`) still resolve.
        const my_parent_only = await indexer.resolve_sthlp_file(
            my_head_lookup.name
        );
        if (my_parent_only) return my_parent_only;
    }

    // 3. Abbreviation expansion (e.g. `reg` -> `regress`,
    //    `gen` -> `generate`). Tier 1 commands win on ties; shorter
    //    canonical names beat longer cousins.
    interface Candidate {
        name: string;
        priority: number;
        help_file?: string;
    }
    const the_tried = new Set<string>();
    const the_candidates: Candidate[] = [];
    const add_candidate = (
        name: string,
        priority: number | undefined,
        help_file?: string
    ): void => {
        const my_normalized = name.toLowerCase();
        if (my_normalized === my_head_lower) return;
        if (the_tried.has(my_normalized)) return;
        the_tried.add(my_normalized);
        the_candidates.push({
            name,
            priority: priority ?? 99,
            help_file,
        });
    };

    if (my_head_lookup) {
        add_candidate(
            my_head_lookup.name,
            my_head_lookup.priority,
            my_head_lookup.helpFile
        );
    }
    for (const my_match of command_database.expand_abbreviation(my_head)) {
        add_candidate(my_match.name, my_match.priority, my_match.helpFile);
    }
    for (const my_match of command_database.search(my_head)) {
        add_candidate(my_match.name, my_match.priority, my_match.helpFile);
    }

    the_candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.name.length - b.name.length;
    });

    for (const my_candidate of the_candidates) {
        const my_resolved = await indexer.resolve_sthlp_file(
            my_candidate.name + my_tail
        );
        if (my_resolved) return my_resolved;
        // Follow the candidate's own helpFile redirect
        // (e.g. `loc` -> `local` -> `macro`).
        if (
            my_candidate.help_file
            && my_candidate.help_file.toLowerCase()
                !== my_candidate.name.toLowerCase()
        ) {
            const my_redirected = await indexer.resolve_sthlp_file(
                my_candidate.help_file + my_tail
            );
            if (my_redirected) return my_redirected;
            if (my_tail.length > 0) {
                const my_parent_only = await indexer.resolve_sthlp_file(
                    my_candidate.help_file
                );
                if (my_parent_only) return my_parent_only;
            }
        }
    }

    // 4. Function-name fallback: `float()` -> `f_float.sthlp`,
    //    `strpos` -> `f_strpos.sthlp`.
    {
        const my_func_name = my_topic.endsWith('()')
            ? my_topic.slice(0, -2)
            : my_topic;
        if (my_func_name.length > 0) {
            const my_func_path = await indexer.resolve_sthlp_file(
                `f_${my_func_name}`
            );
            if (my_func_path) return my_func_path;
        }
    }

    // 5. System-variable fallback: `_N`, `_n`, `_pi`, `_rc`, `_cons`
    //    -> `_variables.sthlp`.
    if (my_topic.startsWith('_')) {
        const my_sysvar_path = await indexer.resolve_sthlp_file(
            '_variables'
        );
        if (my_sysvar_path) return my_sysvar_path;
    }

    // 6. Hash-prefix fallback: `#delimit` -> `delimit.sthlp`.
    if (my_topic.startsWith('#')) {
        const my_stripped = my_topic.substring(1);
        if (my_stripped.length > 0) {
            const my_hash_path = await indexer.resolve_sthlp_file(
                my_stripped
            );
            if (my_hash_path) return my_hash_path;
        }
    }

    // 7. Case-insensitive fallback: `Java` -> `java`,
    //    `Dynamic` -> `dynamic`.
    {
        const my_lower = my_topic.toLowerCase();
        if (my_lower !== my_topic) {
            const my_lower_path = await indexer.resolve_sthlp_file(my_lower);
            if (my_lower_path) return my_lower_path;
        }
    }

    // 8. Suffix probing.
    {
        const the_bases = [my_topic];
        const my_lower = my_topic.toLowerCase();
        if (my_lower !== my_topic) the_bases.push(my_lower);
        for (const my_base of the_bases) {
            for (const my_suffix of HELP_TOPIC_SUFFIXES) {
                const my_candidate = await indexer.resolve_sthlp_file(
                    my_base + my_suffix
                );
                if (my_candidate) return my_candidate;
            }
        }
    }

    return null;
}

/**
 * Settle the working directories that closed files inherit from the
 * callers that reach them.
 *
 * A file with no `sight: cd` of its own runs in the working directory
 * of the caller that runs it (docs/cross-file.md, Working Directory).
 * That caller's calls resolve against its own inherited directory, so
 * which files it reaches, and so which callers a file has, depends on
 * the directory the caller inherited in turn. A file can only be given
 * its callers once their calls land in the right place.
 *
 * Producers that register a file's calls before the whole graph is
 * known (the workspace indexer's scan, `sight graph`) register them
 * first with the file's own or explicitly inherited directory, which
 * does not depend on scan order. This module then re-resolves each
 * file's directory against the resulting dependency graph with the
 * same walk an open document uses, registers the calls again for every
 * file whose directory changed, and repeats until no directory changes.
 * Each round settles at least one more level of callers; the bound stops
 * a cycle whose directories keep changing from going on forever.
 *
 * `sight graph` and the indexer (which `sight check` and the language
 * server share) both settle through this one function, so they agree
 * on every edge.
 */

import type {
    DirectiveParseResult,
    ScopeResolverConfig,
} from '../types';
import type { ScopeResolver } from '../scope-resolver';

/** Header facts the inherited-directory walk reads for a file. */
export type WorkingDirectoryHeader = Pick<
    DirectiveParseResult,
    'directives' | 'standalone' | 'working_directory'
>;

/** What settling needs to know about one file. */
export interface WorkingDirectoryFacts {
    uri: string;
    header: WorkingDirectoryHeader;
    /** The file's own `sight: cd`, resolved; it always wins. */
    own_working_directory: string | undefined;
    /**
     * Own, or inherited through `sight: done-by` / `included-by`.
     * Forward directives (`sight: do`) resolve against this, never a
     * directory inherited from a caller found by its `do` command.
     */
    directive_working_directory: string | undefined;
    /** The directory command calls resolve against. Settling sets it. */
    working_directory: string | undefined;
}

/** Fallback when the config leaves `max_backward_depth` unset. */
const DEFAULT_MAX_BACKWARD_DEPTH = 10;

/**
 * Re-resolve each file's working directory against the dependency graph
 * until none changes, calling `register` for a file each time its
 * directory changes. `the_facts` should be in a stable order (the
 * callers sort by URI) so results do not depend on scan order.
 *
 * Returns the files whose directory changed, or undefined when
 * `is_current` reported the work stale part way through (files already
 * registered stay registered). Files with their own `sight: cd` are
 * never re-resolved. `always_walk` turns off the shortcut for when no
 * file has a directory, for a caller that knows of one these facts do
 * not show, such as an unsaved `sight: cd` in an open buffer.
 */
export async function settle_inherited_working_directories<
    T extends WorkingDirectoryFacts,
>(options: {
    the_facts: readonly T[];
    scope_resolver: ScopeResolver;
    config: Partial<ScopeResolverConfig>;
    register: (facts: T) => void;
    is_current?: () => boolean;
    always_walk?: boolean;
}): Promise<Set<T> | undefined> {
    const { the_facts, scope_resolver, config, register } = options;
    const is_current = options.is_current ?? (() => true);
    const the_changed_files = new Set<T>();

    // A directory is only ever inherited from some file's own
    // `sight: cd`. Every such file, and every file that inherits one
    // through explicit directives, already has a directory here, so
    // when none does there is nothing to inherit and no walk to run.
    const has_any_directory = the_facts.some(my_facts =>
        my_facts.working_directory !== undefined ||
        my_facts.directive_working_directory !== undefined);
    if (!has_any_directory && options.always_walk !== true) {
        return the_changed_files;
    }

    const max_rounds = (config.max_backward_depth ??
        DEFAULT_MAX_BACKWARD_DEPTH) + 2;
    for (let round = 0; round < max_rounds; round++) {
        const the_changed: T[] = [];
        for (const my_facts of the_facts) {
            if (my_facts.own_working_directory !== undefined) {
                continue;
            }
            const working_directory =
                await scope_resolver.resolve_document_working_directory(
                    my_facts.uri, my_facts.header, config);
            if (!is_current()) {
                return undefined;
            }
            if (working_directory !== my_facts.working_directory) {
                my_facts.working_directory = working_directory;
                the_changed.push(my_facts);
            }
        }
        if (the_changed.length === 0) {
            break;
        }
        for (const my_facts of the_changed) {
            register(my_facts);
            the_changed_files.add(my_facts);
        }
    }
    return the_changed_files;
}

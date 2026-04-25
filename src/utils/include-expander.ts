/**
 * INCLUDE directive expander for Stata SMCL help files.
 *
 * Resolves `INCLUDE help <name>` lines by reading the corresponding
 * `.ihlp` file and substituting its content inline. Supports recursive
 * includes with cycle detection and a configurable depth limit.
 *
 * This module contains only the expansion logic. File resolution is
 * delegated to a caller-provided resolver function, keeping this
 * testable without filesystem access.
 */

import { logger } from './logger';

const INCLUDE_RE = /^\s*INCLUDE\s+help\s+(\S+)/;
const DEFAULT_MAX_DEPTH = 10;

export interface ExpandIncludesOptions {
    /** Maximum recursion depth (default: 10). */
    max_depth?: number;
    /** Callback invoked once per unique missing include name. */
    on_missing?: (name: string) => void;
}

/**
 * Resolver function type: given an include name, returns the resolved
 * file path and content, or null if the file cannot be found.
 */
export type IncludeResolver = (
    name: string
) => Promise<{ path: string; content: string } | null>;

/**
 * Expand all `INCLUDE help <name>` directives in SMCL content.
 *
 * @param content - Raw SMCL source
 * @param resolver - Function that resolves include names to file content
 * @param options - Optional depth limit and missing-file callback
 * @returns SMCL content with INCLUDE directives replaced by file content
 */
export async function expand_includes(
    content: string,
    resolver: IncludeResolver,
    options?: ExpandIncludesOptions
): Promise<string> {
    const my_max_depth = options?.max_depth ?? DEFAULT_MAX_DEPTH;
    const my_visited = new Set<string>();
    const my_missing_logged = new Set<string>();

    return expand_recursive(
        content, resolver, my_visited, my_missing_logged,
        0, my_max_depth, options?.on_missing
    );
}

async function expand_recursive(
    content: string,
    resolver: IncludeResolver,
    visited: Set<string>,
    missing_logged: Set<string>,
    depth: number,
    max_depth: number,
    on_missing?: (name: string) => void
): Promise<string> {
    const the_lines = content.split('\n');
    const the_result: string[] = [];

    for (const my_line of the_lines) {
        const my_match = INCLUDE_RE.exec(my_line);
        if (!my_match) {
            the_result.push(my_line);
            continue;
        }

        const my_name = my_match[1];

        const my_resolved = await resolver(my_name);
        if (!my_resolved) {
            if (!missing_logged.has(my_name)) {
                missing_logged.add(my_name);
                logger.debug(
                    `INCLUDE: could not resolve "${my_name}.ihlp"`
                );
                on_missing?.(my_name);
            }
            the_result.push('');
            continue;
        }

        if (visited.has(my_resolved.path)) {
            // Cycle detected — skip silently
            the_result.push('');
            continue;
        }

        visited.add(my_resolved.path);
        const my_next_depth = depth + 1;
        if (my_next_depth > max_depth) {
            logger.warn(
                `INCLUDE depth limit (${max_depth}) exceeded for "${my_name}"`
            );
            // Include the file content but strip any nested INCLUDEs
            const my_stripped = my_resolved.content
                .split('\n')
                .map(l => INCLUDE_RE.test(l) ? '' : l)
                .join('\n');
            the_result.push(my_stripped);
            continue;
        }
        const my_expanded = await expand_recursive(
            my_resolved.content, resolver, visited, missing_logged,
            my_next_depth, max_depth, on_missing
        );
        the_result.push(my_expanded);
    }

    return the_result.join('\n');
}

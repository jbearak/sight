// Position → owning-scope resolution over the analyzer's ScopeInfo
// array (do-file scope first, then one entry per program body). THE
// single mechanism for "which scope owns this position" — shared by
// the analyzer's token/Mata passes and the diagnostics provider. Do
// not add a second way to answer this question.
//
// Limitation (pre-existing): the parser only builds `program` block
// nodes under `#delimit cr`, so under `#delimit ;` positions inside a
// program fall back to the do-file scope.

import { Range } from 'vscode-languageserver-textdocument';
import { ScopeInfo } from '../types';

export interface Position {
    line: number;
    character: number;
}

/** Line-then-character comparator shared with scoped-locals.ts. */
export function compare_positions(a: Position, b: Position): number {
    if (a.line !== b.line) {
        return a.line - b.line;
    }
    return a.character - b.character;
}

/** Is `position` within `range` (inclusive), comparing line then char? */
export function position_within_range(
    position: Position,
    range: Range
): boolean {
    return (
        compare_positions(position, range.start) >= 0 &&
        compare_positions(position, range.end) <= 0
    );
}

/**
 * First line of a program scope's BODY. The analyzer records
 * `body_start_line` when a `program define` header is ///-continued
 * across several physical lines; absent, the body starts on the line
 * after the header line.
 */
export function program_body_start_line(scope: ScopeInfo): number {
    return scope.body_start_line ?? scope.range.start.line + 1;
}

/**
 * Innermost program scope whose (character-precise, inclusive) range
 * contains `position`, else the do-file scope (`scopes[0]`).
 *
 * With `body_only`, a program scope matches only on its body lines:
 * the `program define` header (all physical lines of it, when
 * ///-continued) and the `end` line are excluded, because Stata
 * expands macros there at definition time in the enclosing frame
 * (issue #273). A nested program's header still resolves to its
 * enclosing program's body, not the do-file scope.
 */
export function find_enclosing_scope(
    scopes: ScopeInfo[],
    position: Position,
    options?: { body_only?: boolean }
): ScopeInfo {
    if (scopes.length === 0) {
        // Every producer pushes the do-file scope first, so an empty
        // array is a caller bug — fail loudly rather than return an
        // undefined that NPEs at a distance.
        throw new Error('find_enclosing_scope: scopes must be non-empty');
    }
    let innermost: ScopeInfo | undefined;
    for (const my_scope of scopes) {
        if (my_scope.type !== 'program') {
            continue;
        }
        if (!position_within_range(position, my_scope.range)) {
            continue;
        }
        if (
            options?.body_only === true &&
            (position.line < program_body_start_line(my_scope) ||
                position.line >= my_scope.range.end.line)
        ) {
            continue;
        }
        // Nested program scopes start later than their enclosing
        // scope, so the latest-starting match is the innermost.
        if (
            innermost === undefined ||
            compare_positions(my_scope.range.start, innermost.range.start) > 0
        ) {
            innermost = my_scope;
        }
    }
    return innermost ?? scopes[0];
}

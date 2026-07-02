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

interface Position {
    line: number;
    character: number;
}

function compare_positions(a: Position, b: Position): number {
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
 * Innermost program scope whose (character-precise, inclusive) range
 * contains `position`, else the do-file scope (`scopes[0]`).
 */
export function find_enclosing_scope(
    scopes: ScopeInfo[],
    position: Position
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

import { Position } from 'vscode-languageserver';
import { Token } from '../types';

/**
 * Binary-search utilities for the `document.tokens` array.
 *
 * The lexer emits tokens in document order, so `tokens[i].range.start`
 * is monotonically non-decreasing. That lets us locate a token for a
 * given cursor position in O(log N) instead of scanning the whole
 * array. Hover, completion, and related providers fire per keystroke
 * on large files, so these helpers keep the hot path insulated from
 * file size.
 */

/**
 * Return true iff `a` is strictly before `b` in document order.
 */
function position_before(a: Position, b: Position): boolean {
    return (
        a.line < b.line ||
        (a.line === b.line && a.character < b.character)
    );
}

/**
 * Return true iff `a` is at-or-before `b` in document order.
 */
function position_at_or_before(a: Position, b: Position): boolean {
    return (
        a.line < b.line ||
        (a.line === b.line && a.character <= b.character)
    );
}

/**
 * Binary search for the last token whose start position is at or before the
 * given position. Returns -1 when no token starts at or before the position
 * (i.e. the array is empty or the first token starts strictly after it).
 *
 * Tokens are assumed to be sorted by start position in document order.
 */
export function find_last_token_starting_at_or_before(
    tokens: Token[],
    position: Position
): number {
    let low = 0;
    let high = tokens.length - 1;
    let best = -1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const start = tokens[mid].range.start;
        if (position_at_or_before(start, position)) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return best;
}

/**
 * Binary search for the last token whose start position is strictly before
 * the given position. Returns -1 when no such token exists.
 *
 * This matches the "tokens preceding the cursor" semantics used by the
 * hover provider's top-level-comma detection, where a token starting
 * exactly at the cursor is considered "at the cursor", not "before".
 */
export function find_last_token_starting_before(
    tokens: Token[],
    position: Position
): number {
    let low = 0;
    let high = tokens.length - 1;
    let best = -1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const start = tokens[mid].range.start;
        if (position_before(start, position)) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return best;
}

/**
 * Binary search for the token whose range contains the given position.
 * Uses LSP `[start, end)` semantics: the start position is inclusive and
 * the end position is exclusive. Returns -1 when no token covers the
 * position (e.g. the cursor is in trailing whitespace).
 *
 * Tokens are assumed to be sorted by start position in document order
 * and non-overlapping.
 */
export function find_token_index_at_position(
    tokens: Token[],
    position: Position
): number {
    const candidate = find_last_token_starting_at_or_before(tokens, position);
    if (candidate === -1) {
        return -1;
    }
    const end = tokens[candidate].range.end;
    if (position_before(position, end)) {
        return candidate;
    }
    return -1;
}

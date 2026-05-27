/**
 * Pure helpers encoding the sort gestures used by the data browser
 * webview. Kept separate from React so they can be unit-tested.
 */

import type { SortKey } from '../types';

/**
 * Result of picking "Sort asc/desc" on a column header.
 *
 * - `append === false`: the column becomes the sole sort key (replace).
 * - `append === true` and the column is already a key: set that key's
 *   direction to the picked one (in place, keeping its priority).
 * - `append === true` and the column is new: append as the next key.
 */
export function apply_sort_pick(
    keys: readonly SortKey[],
    col_index: number,
    direction: 'asc' | 'desc',
    append: boolean
): SortKey[] {
    if (!append) {
        return [{ col_index, direction }];
    }
    const my_existing = keys.findIndex(
        my_key => my_key.col_index === col_index
    );
    if (my_existing >= 0) {
        return keys.map((my_key, i) =>
            i === my_existing
                ? { col_index, direction }
                : { ...my_key }
        );
    }
    return [...keys.map(my_key => ({ ...my_key })),
        { col_index, direction }];
}

export function active_direction(
    keys: readonly SortKey[],
    col_index: number
): 'asc' | 'desc' | 'none' {
    const my_key = keys.find(k => k.col_index === col_index);
    return my_key ? my_key.direction : 'none';
}

export function flip_key(
    keys: readonly SortKey[],
    index: number
): SortKey[] {
    return keys.map((my_key, i) =>
        i === index
            ? {
                col_index: my_key.col_index,
                direction:
                    my_key.direction === 'asc' ? 'desc' : 'asc',
            }
            : { ...my_key }
    );
}

export function remove_key(
    keys: readonly SortKey[],
    index: number
): SortKey[] {
    return keys
        .filter((_, i) => i !== index)
        .map(my_key => ({ ...my_key }));
}

export function move_to_first(
    keys: readonly SortKey[],
    index: number
): SortKey[] {
    if (index <= 0 || index >= keys.length) {
        return keys.map(my_key => ({ ...my_key }));
    }
    const my_next = keys.map(my_key => ({ ...my_key }));
    const [my_moved] = my_next.splice(index, 1);
    my_next.unshift(my_moved);
    return my_next;
}

/** Compact status-bar summary, e.g. "mpg ▲, price ▼". Truncates after
 *  four keys with a "+N more" suffix. Empty string when no keys. */
export function describe_sort_keys(
    keys: readonly SortKey[],
    names: readonly string[]
): string {
    if (keys.length === 0) return '';
    const MAX = 4;
    const the_visible = keys.slice(0, MAX).map(my_key => {
        const my_name =
            names[my_key.col_index] ?? `col ${my_key.col_index}`;
        return `${my_name} ${my_key.direction === 'asc' ? '▲' : '▼'}`;
    });
    const my_text = the_visible.join(', ');
    return keys.length > MAX
        ? `${my_text}, +${keys.length - MAX} more`
        : my_text;
}

/** Map each sorted column to its direction and 1-based priority. */
export function sort_priority_map(
    keys: readonly SortKey[]
): Map<number, { direction: 'asc' | 'desc'; priority: number }> {
    const my_map = new Map<
        number,
        { direction: 'asc' | 'desc'; priority: number }
    >();
    keys.forEach((my_key, i) => {
        if (!my_map.has(my_key.col_index)) {
            my_map.set(my_key.col_index, {
                direction: my_key.direction,
                priority: i + 1,
            });
        }
    });
    return my_map;
}

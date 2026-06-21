import type { BrowserGridColumn } from './grid-model.js';

export type VisibleColumnMap = number[];

export function build_visible_column_map(
    variables: readonly { name: string }[],
    hidden_columns: ReadonlySet<string>
): VisibleColumnMap {
    const the_map: VisibleColumnMap = [];

    for (let i = 0; i < variables.length; i++) {
        if (!hidden_columns.has(variables[i].name)) {
            the_map.push(i);
        }
    }

    return the_map;
}

export function build_visible_grid_columns(
    all_columns: BrowserGridColumn[],
    visible_col_map: VisibleColumnMap
): BrowserGridColumn[] {
    return visible_col_map.map(
        my_original_index => all_columns[my_original_index]
    );
}

export function toggle_column_hidden(
    hidden: ReadonlySet<string>,
    name: string
): Set<string> {
    const my_next = new Set(hidden);
    if (my_next.has(name)) {
        my_next.delete(name);
    } else {
        my_next.add(name);
    }
    return my_next;
}

export function hide_all_columns(
    variable_names: readonly string[]
): Set<string> {
    return new Set(variable_names);
}

export function show_all_columns(): Set<string> {
    return new Set();
}

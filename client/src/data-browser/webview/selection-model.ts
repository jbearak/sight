import {
    CompactSelection,
    type GridSelection,
} from './compact-selection';

export function create_empty_grid_selection(): GridSelection {
    return {
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
    };
}

export function create_single_column_selection(
    col_index: number
): GridSelection {
    return {
        columns: CompactSelection.fromSingleSelection(col_index),
        rows: CompactSelection.empty(),
    };
}

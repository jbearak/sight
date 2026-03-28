import { CompactSelection } from './compact-selection';
// Type-only import — erased at runtime, so it resolves
// in the client typecheck (where the library is installed)
// but does not fail in Bun tests (where it is not).
import type { GridSelection } from '@glideapps/glide-data-grid';

export function create_empty_grid_selection(): GridSelection {
    return {
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
    } as GridSelection;
}

export function create_single_column_selection(
    col_index: number
): GridSelection {
    return {
        columns: CompactSelection.fromSingleSelection(col_index),
        rows: CompactSelection.empty(),
    } as GridSelection;
}

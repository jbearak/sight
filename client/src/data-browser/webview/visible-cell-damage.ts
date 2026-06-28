interface VisibleCellDamageArgs {
    column_count: number;
    first_row: number;
    row_count: number;
    total_rows: number;
}

export function visible_cell_damage({
    column_count,
    first_row,
    row_count,
    total_rows,
}: VisibleCellDamageArgs): { cell: [number, number] }[] {
    if (column_count <= 0 || row_count <= 0 || total_rows <= 0) {
        return [];
    }

    const my_start = Math.max(0, first_row);
    const my_end = Math.min(my_start + row_count, total_rows);
    const the_damage: { cell: [number, number] }[] = [];
    for (let row = my_start; row < my_end; row++) {
        for (let col = 0; col < column_count; col++) {
            the_damage.push({ cell: [col, row] });
        }
    }
    return the_damage;
}

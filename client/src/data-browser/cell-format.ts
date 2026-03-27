import {
    apply_display_format,
    is_missing_value_object,
    type MissingValue,
} from '../../../src/dta-parser';
import type { CellValue } from './types';

export function build_cell_value(
    raw: number | string | MissingValue,
    variable: {
        type: string;
        format: string;
        value_label_name: string;
    },
    value_label_table?: Map<number, string>
): CellValue {
    if (is_missing_value_object(raw)) {
        return {
            raw: null,
            raw_display: raw.missing_type,
            formatted_display: raw.missing_type,
            missing_type: raw.missing_type,
        };
    }

    const my_raw_display = String(raw);
    const my_formatted = apply_display_format(
        raw,
        variable.format
    );

    let my_label_display: string | undefined;
    if (
        typeof raw === 'number'
        && variable.value_label_name
        && value_label_table
    ) {
        my_label_display = value_label_table.get(raw);
    }

    return {
        raw,
        raw_display: my_raw_display,
        formatted_display: my_formatted ?? my_raw_display,
        label_display: my_label_display,
    };
}

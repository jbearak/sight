import {
    apply_display_format,
    is_missing_value_object,
    missing_type_to_label_key,
    type MissingValue,
} from '@jbearak/dta-parser';
import type { CellValue } from './types.js';

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
        let my_label_display: string | undefined;
        if (
            variable.value_label_name
            && value_label_table
        ) {
            const my_label_key =
                missing_type_to_label_key(
                    raw.missing_type
                );
            my_label_display =
                value_label_table.get(my_label_key);
        }
        return {
            raw: null,
            raw_display: raw.missing_type,
            formatted_display: raw.missing_type,
            label_display: my_label_display,
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

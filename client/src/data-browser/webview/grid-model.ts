import type { SizedGridColumn } from '@glideapps/glide-data-grid';
import type {
    CellValue,
    MetadataMessage,
    VariableDescription,
} from '../types.js';

export const PAGE_SIZE = 200;
export const MIN_COLUMN_WIDTH_PX = 72;
export const MAX_COLUMN_WIDTH_PX = 280;
export const HEADER_HORIZONTAL_PADDING_PX = 16;
export const SUBTITLE_EXTRA_LINE_ALLOWANCE_PX = 10;

const TITLE_CHAR_WIDTH_PX = 7;
const SUBTITLE_CHAR_WIDTH_PX = 6;
const CONTENT_CHAR_WIDTH_PX = 7;
const NUMERIC_TYPE_PATTERN =
    /^(byte|int|long|float|double)$/;
const DATE_LIKE_PATTERN =
    /(%t|%d|%m|%q|%w|%tc|%td|%tm|%tq|%tw)/i;
const STRING_TYPE_PATTERN =
    /^(str\d+|strl)$/i;

export type BrowserGridColumn = SizedGridColumn & {
    variable_label?: string;
};

export function build_grid_columns(
    metadata: MetadataMessage | null,
    column_widths_by_name: Record<string, number>
): BrowserGridColumn[] {
    if (!metadata) {
        return [];
    }

    return metadata.variables.map((my_variable, my_index) => ({
        id: String(my_index),
        title: my_variable.name,
        width: clamp_column_width(
            column_widths_by_name[my_variable.name]
        ),
        variable_label: get_variable_header_subtitle(my_variable),
        hasMenu: false,
    }));
}

export function clamp_column_width(width: number | undefined): number {
    if (
        width === undefined
        || !Number.isFinite(width)
    ) {
        return 150;
    }

    return Math.max(
        MIN_COLUMN_WIDTH_PX,
        Math.min(MAX_COLUMN_WIDTH_PX, Math.round(width))
    );
}

export function compute_header_width_px(
    variable: VariableDescription
): number {
    const my_title_width = estimate_text_width_px(
        variable.name,
        TITLE_CHAR_WIDTH_PX
    );
    const my_subtitle_width = estimate_text_width_px(
        get_variable_header_subtitle(variable) ?? '',
        SUBTITLE_CHAR_WIDTH_PX
    );

    return clamp_column_width(
        Math.max(my_title_width, my_subtitle_width)
        + HEADER_HORIZONTAL_PADDING_PX
        + SUBTITLE_EXTRA_LINE_ALLOWANCE_PX
    );
}

export function compute_sampled_value_width_px(
    variable: VariableDescription,
    samples: readonly string[]
): number {
    let my_longest_width = 0;

    for (const my_sample of samples) {
        my_longest_width = Math.max(
            my_longest_width,
            estimate_text_width_px(
                my_sample,
                CONTENT_CHAR_WIDTH_PX
            )
        );
    }

    const my_adjusted_width = apply_type_width_adjustment(
        variable,
        my_longest_width
    );

    return clamp_column_width(
        my_adjusted_width
        + HEADER_HORIZONTAL_PADDING_PX
    );
}

export function compute_default_column_width(
    variable: VariableDescription,
    samples: readonly string[]
): number {
    return clamp_column_width(
        Math.max(
            compute_header_width_px(variable),
            compute_sampled_value_width_px(
                variable,
                samples
            )
        )
    );
}

export function merge_persisted_and_default_widths(
    metadata: MetadataMessage | null,
    persisted_widths: Record<string, number>,
    sampled_width_hints: Record<string, number>
): Record<string, number> {
    if (!metadata) {
        return {};
    }

    const my_merged_widths: Record<string, number> = {};

    for (const my_variable of metadata.variables) {
        const my_persisted_width = persisted_widths[
            my_variable.name
        ];
        if (my_persisted_width !== undefined) {
            my_merged_widths[my_variable.name] =
                clamp_column_width(my_persisted_width);
            continue;
        }

        const my_sampled_width = sampled_width_hints[
            my_variable.name
        ];
        if (my_sampled_width !== undefined) {
            my_merged_widths[my_variable.name] =
                clamp_column_width(my_sampled_width);
            continue;
        }

        my_merged_widths[my_variable.name] =
            compute_default_column_width(my_variable, []);
    }

    return my_merged_widths;
}

export function get_variable_header_subtitle(
    variable: VariableDescription
): string | undefined {
    const my_label = variable.label.trim();
    return my_label === '' ? undefined : my_label;
}

export function get_variable_header_tooltip(
    variable: VariableDescription
): string | undefined {
    return get_variable_header_subtitle(variable);
}

export function get_cell_display_value(
    cell: CellValue,
    show_labels: boolean,
    show_formats: boolean
): string {
    if (cell.missing_type) {
        if (show_labels && cell.label_display) {
            return cell.label_display;
        }
        return cell.missing_type;
    }
    if (show_labels && cell.label_display) {
        return cell.label_display;
    }
    if (show_formats) {
        return cell.formatted_display;
    }
    return cell.raw_display;
}

export function collect_sampled_value_width_hints(
    metadata: MetadataMessage | null,
    pages: Map<number, CellValue[][]>,
    show_labels: boolean,
    show_formats: boolean
): Record<string, number> {
    if (!metadata) {
        return {};
    }

    const my_samples_by_name = new Map<string, string[]>();
    for (const my_variable of metadata.variables) {
        my_samples_by_name.set(my_variable.name, []);
    }

    const the_sorted_page_starts = [...pages.keys()].sort(
        (a, b) => a - b
    );

    for (const my_page_start of the_sorted_page_starts) {
        const my_page = pages.get(my_page_start);
        if (!my_page) {
            continue;
        }

        for (const my_row of my_page) {
            for (
                let my_col_index = 0;
                my_col_index < metadata.variables.length;
                my_col_index++
            ) {
                const my_variable =
                    metadata.variables[my_col_index];
                const my_cell = my_row[my_col_index];
                if (!my_variable || !my_cell) {
                    continue;
                }

                const my_samples = my_samples_by_name.get(
                    my_variable.name
                );
                if (!my_samples || my_samples.length >= 24) {
                    continue;
                }

                my_samples.push(
                    get_cell_display_value(
                        my_cell,
                        show_labels,
                        show_formats
                    )
                );
            }
        }
    }

    const my_width_hints: Record<string, number> = {};
    for (const my_variable of metadata.variables) {
        const my_samples = my_samples_by_name.get(
            my_variable.name
        ) ?? [];
        my_width_hints[my_variable.name] =
            compute_default_column_width(
                my_variable,
                my_samples
            );
    }

    return my_width_hints;
}

export function describe_visible_rows(
    nobs: number,
    first_visible_row: number,
    visible_row_count: number
): string {
    if (nobs <= 0) {
        return 'Showing 0-0 of 0';
    }
    if (visible_row_count <= 0) {
        return `Showing 0-0 of ${nobs.toLocaleString()}`;
    }
    const my_start = Math.min(first_visible_row + 1, nobs);
    const my_end = Math.min(
        first_visible_row + visible_row_count,
        nobs
    );
    return `Showing ${my_start.toLocaleString()}-${my_end.toLocaleString()} of ${nobs.toLocaleString()}`;
}

export function describe_status_summary(
    metadata: MetadataMessage | null
): string {
    if (!metadata) {
        return '';
    }

    const the_parts: string[] = [];
    the_parts.push(metadata.name);

    if (metadata.dataset_label) {
        the_parts.push(metadata.dataset_label);
    }
    if (metadata.source) {
        the_parts.push(metadata.source);
    }

    if (metadata.subsetted) {
        const the_subset_parts: string[] = [];
        if (metadata.varlist && metadata.varlist.length > 0) {
            the_subset_parts.push(
                `vars: ${metadata.varlist.join(', ')}`
            );
        }
        if (metadata.if_condition) {
            the_subset_parts.push(
                `if ${metadata.if_condition}`
            );
        }
        if (metadata.in_condition) {
            the_subset_parts.push(
                `in ${metadata.in_condition}`
            );
        }
        the_parts.push(
            the_subset_parts.length > 0
                ? `Subsetted (${the_subset_parts.join('; ')})`
                : 'Subsetted'
        );
    } else {
        the_parts.push('Full dataset');
    }

    return the_parts.filter(Boolean).join(' | ');
}

export function get_needed_page_starts(
    start_row: number,
    end_row: number,
    page_size: number = PAGE_SIZE
): number[] {
    const the_starts: number[] = [];
    const my_first_page = Math.floor(
        Math.max(start_row, 0) / page_size
    ) * page_size;
    const my_last_page = Math.floor(
        Math.max(end_row - 1, 0) / page_size
    ) * page_size;

    for (
        let my_page_start = my_first_page;
        my_page_start <= my_last_page;
        my_page_start += page_size
    ) {
        the_starts.push(my_page_start);
    }
    return the_starts;
}

function estimate_text_width_px(
    text: string,
    width_per_char_px: number
): number {
    return text.length * width_per_char_px;
}

function apply_type_width_adjustment(
    variable: VariableDescription,
    content_width_px: number
): number {
    if (STRING_TYPE_PATTERN.test(variable.type)) {
        return Math.round(content_width_px * 1.02);
    }

    if (
        NUMERIC_TYPE_PATTERN.test(variable.type)
        || DATE_LIKE_PATTERN.test(variable.format)
    ) {
        return Math.round(content_width_px * 0.78);
    }

    return content_width_px;
}

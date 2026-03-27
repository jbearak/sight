import type { GridColumn } from '@glideapps/glide-data-grid';
import type {
    CellValue,
    MetadataMessage,
    VariableDescription,
} from '../types';

export const PAGE_SIZE = 200;

export type BrowserGridColumn = GridColumn & {
    variable_label?: string;
};

export function build_grid_columns(
    metadata: MetadataMessage | null
): BrowserGridColumn[] {
    if (!metadata) {
        return [];
    }

    return metadata.variables.map((my_variable, my_index) => ({
        id: String(my_index),
        title: my_variable.name,
        variable_label: get_variable_header_subtitle(my_variable),
        hasMenu: false,
    }));
}

export function get_variable_header_subtitle(
    variable: VariableDescription
): string | undefined {
    const my_label = variable.label.trim();
    return my_label === '' ? undefined : my_label;
}

export function get_cell_display_value(
    cell: CellValue,
    show_labels: boolean,
    show_formats: boolean
): string {
    if (cell.missing_type) {
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

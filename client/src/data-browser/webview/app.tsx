import React, {
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    DataEditor,
    type DrawHeaderCallback,
    GridCellKind,
    type GridMouseEventArgs,
    type Item,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import './styles.css';
import {
    build_grid_columns,
    clamp_column_width,
    collect_sampled_value_width_hints,
    type BrowserGridColumn,
    describe_status_summary,
    describe_visible_rows,
    get_cell_display_value,
    get_variable_header_tooltip,
    merge_persisted_and_default_widths,
} from './grid-model';
import { use_row_loader } from './use-row-loader';

const HEADER_HEIGHT_PX = 40;

type HeaderTooltipState = {
    text: string;
    left_px: number;
    top_px: number;
};

export function App() {
    const {
        metadata,
        ensure_rows,
        get_row,
        pages,
        vscode_api,
    } = use_row_loader();
    const [show_labels, set_show_labels] = useState(true);
    const [show_formats, set_show_formats] = useState(true);
    const [first_visible_row, set_first_visible_row] = useState(0);
    const [visible_row_count, set_visible_row_count] = useState(0);
    const [column_widths_by_name, set_column_widths_by_name] =
        useState<Record<string, number>>({});
    const [user_resized_columns, set_user_resized_columns] =
        useState<Set<string>>(new Set());
    const column_widths_ref = useRef<Record<string, number>>({});
    const [header_tooltip, set_header_tooltip] =
        useState<HeaderTooltipState | null>(null);

    useEffect(() => {
        column_widths_ref.current = column_widths_by_name;
    }, [column_widths_by_name]);

    const sampled_width_hints = useMemo(
        () => collect_sampled_value_width_hints(
            metadata,
            pages,
            show_labels,
            show_formats
        ),
        [metadata, pages, show_labels, show_formats]
    );

    useEffect(() => {
        if (!metadata) {
            set_column_widths_by_name({});
            set_user_resized_columns(new Set());
            return;
        }

        const my_stored_widths =
            metadata.stored_column_widths ?? {};
        set_column_widths_by_name(
            merge_persisted_and_default_widths(
                metadata,
                my_stored_widths,
                sampled_width_hints
            )
        );
        set_user_resized_columns(
            new Set(Object.keys(my_stored_widths))
        );
    }, [metadata?.dataset_key]);

    useEffect(() => {
        if (!metadata) {
            return;
        }

        set_column_widths_by_name(my_previous => {
            const my_next: Record<string, number> = {};

            for (const my_variable of metadata.variables) {
                const my_name = my_variable.name;
                if (user_resized_columns.has(my_name)) {
                    my_next[my_name] = clamp_column_width(
                        my_previous[my_name]
                        ?? metadata.stored_column_widths?.[
                            my_name
                        ]
                    );
                    continue;
                }

                my_next[my_name] = clamp_column_width(
                    sampled_width_hints[my_name]
                );
            }

            return my_next;
        });
    }, [
        metadata,
        sampled_width_hints,
        user_resized_columns,
    ]);

    const the_columns = useMemo(
        () => build_grid_columns(
            metadata,
            column_widths_by_name
        ),
        [metadata, column_widths_by_name]
    );

    const draw_header: DrawHeaderCallback = ({
        ctx,
        column,
        theme,
        rect,
        isSelected,
        hasSelectedCell,
    }, draw_content) => {
        const my_column = column as BrowserGridColumn;
        const my_variable_label = my_column.variable_label;

        if (!my_variable_label) {
            draw_content();
            return;
        }

        const my_text_color =
            isSelected || hasSelectedCell
                ? theme.textHeaderSelected
                : theme.textHeader;
        const my_left = rect.x + 12;
        const my_title_y = rect.y + 14;
        const my_subtitle_y = rect.y + rect.height - 9;

        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();

        ctx.fillStyle = my_text_color;
        ctx.font = `${theme.headerFontStyle} ${theme.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(my_column.title, my_left, my_title_y);

        ctx.fillStyle = my_text_color;
        ctx.globalAlpha = 0.68;
        ctx.font = `400 11px ${theme.fontFamily}`;
        ctx.fillText(my_variable_label, my_left, my_subtitle_y);

        ctx.restore();
    };

    const row_count_text = metadata
        ? describe_visible_rows(
            metadata.nobs,
            first_visible_row,
            visible_row_count
        )
        : 'Loading...';

    const status_text = describe_status_summary(metadata);

    const on_item_hovered = (args: GridMouseEventArgs) => {
        if (!metadata || args.kind !== 'header') {
            set_header_tooltip(null);
            return;
        }

        const my_variable = metadata.variables[args.location[0]];
        if (!my_variable) {
            set_header_tooltip(null);
            return;
        }

        const my_tooltip = get_variable_header_tooltip(my_variable);
        if (!my_tooltip) {
            set_header_tooltip(null);
            return;
        }

        set_header_tooltip({
            text: my_tooltip,
            left_px: args.bounds.x + Math.min(args.bounds.width / 2, 120),
            top_px: args.bounds.y + args.bounds.height + 6,
        });
    };

    const update_column_width = (
        col_index: number,
        new_size: number,
        persist: boolean
    ) => {
        if (!metadata) {
            return;
        }

        const my_variable = metadata.variables[col_index];
        if (!my_variable) {
            return;
        }

        const my_width = clamp_column_width(new_size);

        set_column_widths_by_name(my_previous => ({
            ...my_previous,
            [my_variable.name]: my_width,
        }));
        set_user_resized_columns(my_previous => {
            const my_next = new Set(my_previous);
            my_next.add(my_variable.name);
            return my_next;
        });

        if (!persist) {
            return;
        }

        vscode_api.postMessage({
            type: 'columnWidthsChanged',
            dataset_key: metadata.dataset_key,
            widths: {
                ...column_widths_ref.current,
                [my_variable.name]: my_width,
            },
        });
    };

    return (
        <div className="browser-root">
            <div className="toolbar">
                <span className="row-count">{row_count_text}</span>
                <button
                    className={show_labels ? 'toggle active' : 'toggle'}
                    onClick={() => set_show_labels(!show_labels)}
                    type="button"
                >
                    Labels
                </button>
                <button
                    className={show_formats ? 'toggle active' : 'toggle'}
                    onClick={() => set_show_formats(!show_formats)}
                    type="button"
                >
                    Formats
                </button>
            </div>
            <div className="grid-shell">
                <DataEditor
                    width="100%"
                    height="100%"
                    columns={the_columns}
                    rows={metadata?.nobs ?? 0}
                    headerHeight={HEADER_HEIGHT_PX}
                    rowMarkers="number"
                    getCellsForSelection={true}
                    smoothScrollX={true}
                    smoothScrollY={true}
                    drawHeader={draw_header}
                    onItemHovered={on_item_hovered}
                    onColumnResize={(_column, _new_size, col_index, new_size_with_grow) => {
                        update_column_width(
                            col_index,
                            new_size_with_grow,
                            false
                        );
                    }}
                    onColumnResizeEnd={(_column, _new_size, col_index, new_size_with_grow) => {
                        update_column_width(
                            col_index,
                            new_size_with_grow,
                            true
                        );
                    }}
                    onVisibleRegionChanged={(my_range: {
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                    }) => {
                        set_first_visible_row(my_range.y);
                        set_visible_row_count(my_range.height);
                        ensure_rows(
                            my_range.y,
                            my_range.y + my_range.height + 10
                        );
                    }}
                    getCellContent={([col, row]: Item) => {
                        const my_row = get_row(row);
                        const my_cell = my_row?.[col];
                        const my_display = my_cell
                            ? get_cell_display_value(
                                my_cell,
                                show_labels,
                                show_formats
                            )
                            : '';

                        return {
                            kind: GridCellKind.Text,
                            data: my_display,
                            displayData: my_display,
                            readonly: true,
                            allowOverlay: true,
                        };
                    }}
                />
                {header_tooltip && (
                    <div
                        className="header-tooltip"
                        style={{
                            left: `${header_tooltip.left_px}px`,
                            top: `${header_tooltip.top_px}px`,
                        }}
                    >
                        {header_tooltip.text}
                    </div>
                )}
            </div>
            <div className="status-bar">{status_text}</div>
        </div>
    );
}

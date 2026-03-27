import React, { useMemo, useState } from 'react';
import {
    DataEditor,
    GridCellKind,
    type GridColumn,
    type Item,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import './styles.css';
import {
    describe_status_summary,
    describe_visible_rows,
    get_cell_display_value,
} from './grid-model';
import { use_row_loader } from './use-row-loader';

export function App() {
    const { metadata, ensure_rows, get_row } = use_row_loader();
    const [show_labels, set_show_labels] = useState(true);
    const [show_formats, set_show_formats] = useState(true);
    const [first_visible_row, set_first_visible_row] = useState(0);
    const [visible_row_count, set_visible_row_count] = useState(0);

    const the_columns = useMemo<GridColumn[]>(() => {
        if (!metadata) {
            return [];
        }
        return metadata.variables.map((my_variable, my_index) => ({
            id: String(my_index),
            title: my_variable.name,
            hasMenu: false,
        }));
    }, [metadata]);

    const row_count_text = metadata
        ? describe_visible_rows(
            metadata.nobs,
            first_visible_row,
            visible_row_count
        )
        : 'Loading...';

    const status_text = describe_status_summary(metadata);

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
                    columns={the_columns}
                    rows={metadata?.nobs ?? 0}
                    rowMarkers="number"
                    getCellsForSelection={true}
                    smoothScrollX={true}
                    smoothScrollY={true}
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
            </div>
            <div className="status-bar">{status_text}</div>
        </div>
    );
}

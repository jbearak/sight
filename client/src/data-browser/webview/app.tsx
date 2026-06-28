import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
} from 'react';
import {
    DataEditor,
    type DrawHeaderCallback,
    GridCellKind,
    type GridSelection,
    type GridMouseEventArgs,
    type Item,
    type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import './styles.css';
import {
    build_grid_columns,
    clamp_column_width,
    collect_sampled_value_width_hints,
    type BrowserGridColumn,
    describe_restore_message,
    describe_subset,
    describe_toolbar_row_count,
    get_cell_display_value,
    get_variable_header_tooltip,
    merge_persisted_and_default_widths,
} from './grid-model.js';
import {
    build_visible_column_map,
    build_visible_grid_columns,
    hide_all_columns,
    show_all_columns,
    toggle_column_hidden,
} from './column-visibility-model.js';
import {
    create_empty_grid_selection,
    create_single_column_selection,
} from './selection-model.js';
import { use_row_loader } from './use-row-loader.js';
import { use_toolbar_wrap } from './use-toolbar-wrap.js';
import { ColumnContextMenu } from './column-context-menu.js';
import { ColumnVisibilityPopover } from './column-visibility-popover.js';
import { ToolbarSortStrip } from './sort-strip.js';
import { ToolbarFilterStrip } from './filter-strip.js';
import { FilterPopover } from './filter-popover.js';
import { col_kind } from './filter-column-kind.js';
import {
    active_direction,
    apply_sort_pick,
    sort_priority_map,
} from './sort-actions.js';
import type { FilterEntry, SortKey } from '../types.js';

const HEADER_HEIGHT_PX = 40;

function is_editable_target(el: EventTarget | null): boolean {
    const my_el = el as HTMLElement | null;
    if (!my_el) return false;
    const my_tag = my_el.tagName;
    return (
        my_tag === 'INPUT'
        || my_tag === 'TEXTAREA'
        || my_tag === 'SELECT'
        || my_el.isContentEditable === true
    );
}

function read_css_var(style: CSSStyleDeclaration, name: string): string {
    return style.getPropertyValue(name).trim();
}

function read_css_var_or(
    style: CSSStyleDeclaration,
    name: string,
    fallback: string
): string {
    return read_css_var(style, name) || fallback;
}

function build_grid_theme(
    style: CSSStyleDeclaration
): Partial<Theme> {
    const fg = read_css_var_or(
        style,
        '--vscode-foreground',
        '#cccccc'
    );
    const editor_fg = read_css_var_or(
        style,
        '--vscode-editor-foreground',
        fg
    );
    const editor_bg = read_css_var_or(
        style,
        '--vscode-editor-background',
        '#1e1e1e'
    );
    const header_bg = read_css_var_or(
        style,
        '--vscode-editorGroupHeader-tabsBackground',
        editor_bg
    );
    const border = read_css_var_or(
        style,
        '--vscode-panel-border',
        'rgba(128,128,128,0.35)'
    );
    const selection_bg = read_css_var_or(
        style,
        '--vscode-list-activeSelectionBackground',
        '#094771'
    );
    const selection_fg = read_css_var_or(
        style,
        '--vscode-list-activeSelectionForeground',
        '#ffffff'
    );
    const hover_bg = read_css_var_or(
        style,
        '--vscode-list-hoverBackground',
        'rgba(128,128,128,0.1)'
    );
    const focus_border = read_css_var_or(
        style,
        '--vscode-focusBorder',
        '#007fd4'
    );
    const font_family = read_css_var_or(
        style,
        '--vscode-editor-font-family',
        'monospace'
    );
    const link_color = read_css_var_or(
        style,
        '--vscode-textLink-foreground',
        focus_border
    );

    return {
        bgCell: editor_bg,
        bgCellMedium: editor_bg,
        bgHeader: header_bg,
        bgHeaderHasFocus: selection_bg,
        bgHeaderHovered: hover_bg,
        textDark: editor_fg,
        textMedium: fg,
        textLight: fg,
        textHeader: fg,
        textHeaderSelected: selection_fg,
        textBubble: editor_fg,
        bgBubble: header_bg,
        bgBubbleSelected: editor_bg,
        bgSearchResult: read_css_var_or(
            style,
            '--vscode-editor-findMatchHighlightBackground',
            '#ea5c0055'
        ),
        borderColor: border,
        horizontalBorderColor: border,
        headerBottomBorderColor: border,
        accentColor: focus_border,
        accentFg: selection_fg,
        accentLight: selection_bg,
        linkColor: link_color,
        fontFamily: font_family,
    };
}

type VscodeGridTheme = {
    grid: Partial<Theme>;
    missing_fg: Partial<Theme>;
    missing_bg: Partial<Theme>;
};

function build_missing_themes(
    style: CSSStyleDeclaration
): { fg: Partial<Theme>; bg: Partial<Theme> } {
    // Foreground: use a muted red that echoes Stata's display
    // of missing values.  Fall back to the theme's error
    // foreground, which is red-ish on virtually every theme.
    const text_color = read_css_var_or(
        style,
        '--vscode-editorError-foreground',
        '#f14c4c'
    );

    // Background: diff-editor "removed" tint — a subtle
    // "something is absent" cue.
    const bg_tint = read_css_var_or(
        style,
        '--vscode-diffEditor-removedTextBackground',
        'rgba(255, 0, 0, 0.06)'
    );

    return {
        fg: { textDark: text_color },
        bg: { bgCell: bg_tint },
    };
}

function use_vscode_theme(): VscodeGridTheme {
    const [revision, set_revision] = useState(0);

    useEffect(() => {
        const my_observer = new MutationObserver(() => {
            set_revision(r => r + 1);
        });
        my_observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
        my_observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['style', 'class',
                'data-vscode-theme-kind',
                'data-vscode-theme-name'],
        });
        return () => my_observer.disconnect();
    }, []);

    return useMemo(
        () => {
            const my_style =
                getComputedStyle(document.documentElement);
            const my_missing = build_missing_themes(my_style);
            return {
                grid: build_grid_theme(my_style),
                missing_fg: my_missing.fg,
                missing_bg: my_missing.bg,
            };
        },
        [revision]
    );
}

type HeaderTooltipState = {
    text: string;
    left_px: number;
    top_px: number;
};

type ContextMenuState = {
    variable_name: string;
    left_px: number;
    top_px: number;
};

type FilterEditorState = {
    col_index: number;
    // The existing entry being edited, or null when adding a new filter.
    entry: FilterEntry | null;
    left_px: number;
    top_px: number;
};

export function App(): ReactElement {
    const { grid: vscode_theme, missing_fg, missing_bg } =
        use_vscode_theme();
    const {
        metadata,
        ensure_rows,
        get_row,
        pages,
        vscode_api,
        sort,
        sort_pending,
        filter,
        filter_pending,
        nobs_effective,
        apply_sort,
        apply_filter,
        histograms,
        request_histogram,
        update_viewport,
        restore_pending,
        restore_cancelling,
        cancel_restore,
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
    const persist_resize_timeout_ref = useRef<number | null>(null);
    const [header_tooltip, set_header_tooltip] =
        useState<HeaderTooltipState | null>(null);
    const [grid_selection, set_grid_selection] =
        useState<GridSelection>(
            create_empty_grid_selection
        );
    const [hidden_columns, set_hidden_columns] =
        useState<Set<string>>(new Set());
    const [columns_popover_open, set_columns_popover_open] =
        useState(false);
    const [context_menu, set_context_menu] =
        useState<ContextMenuState | null>(null);
    const [filter_editor, set_filter_editor] =
        useState<FilterEditorState | null>(null);
    const grid_shell_ref = useRef<HTMLDivElement>(null);
    const toolbar_ref = useRef<HTMLDivElement>(null);
    const row_count_ref = useRef<HTMLSpanElement>(null);
    const toolbar_chips_ref = useRef<HTMLDivElement>(null);
    const toolbar_actions_ref = useRef<HTMLDivElement>(null);
    const last_mouse_ref = useRef<{
        x: number;
        y: number;
    }>({ x: 0, y: 0 });
    // Viewport-relative mouse coords (the filter popover renders
    // position: fixed, so it anchors in viewport space, not grid-shell
    // space like the context menu/tooltip).
    const viewport_mouse_ref = useRef<{ x: number; y: number }>({
        x: 0,
        y: 0,
    });

    useEffect(() => {
        const update_viewport_mouse = (e: MouseEvent) => {
            viewport_mouse_ref.current = { x: e.clientX, y: e.clientY };
        };
        document.addEventListener('mousemove', update_viewport_mouse, true);
        document.addEventListener(
            'contextmenu',
            update_viewport_mouse,
            true
        );
        return () => {
            document.removeEventListener(
                'mousemove',
                update_viewport_mouse,
                true
            );
            document.removeEventListener(
                'contextmenu',
                update_viewport_mouse,
                true
            );
        };
    }, []);

    useEffect(() => {
        const my_el = grid_shell_ref.current;
        if (!my_el) {
            return;
        }

        const update_mouse = (e: MouseEvent) => {
            const my_rect =
                my_el.getBoundingClientRect();
            last_mouse_ref.current = {
                x: e.clientX - my_rect.left,
                y: e.clientY - my_rect.top,
            };
        };

        my_el.addEventListener(
            'mousemove',
            update_mouse,
            true
        );
        my_el.addEventListener(
            'contextmenu',
            update_mouse,
            true
        );
        return () => {
            my_el.removeEventListener(
                'mousemove',
                update_mouse,
                true
            );
            my_el.removeEventListener(
                'contextmenu',
                update_mouse,
                true
            );
        };
    }, []);

    useEffect(() => {
        column_widths_ref.current = column_widths_by_name;
    }, [column_widths_by_name]);

    useEffect(() => {
        return () => {
            if (persist_resize_timeout_ref.current !== null) {
                if (metadata) {
                    persist_column_widths(
                        column_widths_ref.current
                    );
                }
                window.clearTimeout(
                    persist_resize_timeout_ref.current
                );
            }
        };
    }, [metadata, vscode_api]);

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
            set_grid_selection(
                create_empty_grid_selection()
            );
            set_hidden_columns(new Set());
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
        set_grid_selection(
            create_empty_grid_selection()
        );
        set_hidden_columns(
            new Set(
                metadata.stored_hidden_columns ?? []
            )
        );
    }, [metadata?.dataset_key]);

    useEffect(() => {
        if (!metadata) {
            return;
        }

        set_column_widths_by_name(my_previous => {
            const my_next: Record<string, number> = {};
            const my_stored_widths =
                metadata.stored_column_widths ?? {};

            for (const my_variable of metadata.variables) {
                const my_name = my_variable.name;
                if (
                    user_resized_columns.has(my_name)
                    || my_stored_widths[my_name] !== undefined
                ) {
                    my_next[my_name] = clamp_column_width(
                        my_previous[my_name]
                        ?? my_stored_widths[my_name]
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

    // Clear selection when hidden columns change
    useEffect(() => {
        set_grid_selection(
            create_empty_grid_selection()
        );
        set_context_menu(null);
    }, [hidden_columns]);

    // Co-derive visible column map and grid columns
    const { visible_col_map, the_columns } = useMemo(
        () => {
            const my_all_columns = build_grid_columns(
                metadata,
                column_widths_by_name
            );
            const my_map = build_visible_column_map(
                metadata?.variables ?? [],
                hidden_columns
            );
            return {
                visible_col_map: my_map,
                the_columns: build_visible_grid_columns(
                    my_all_columns,
                    my_map
                ),
            };
        },
        [metadata, column_widths_by_name, hidden_columns]
    );

    const column_names = useMemo(
        () => metadata?.variables.map(my_v => my_v.name) ?? [],
        [metadata]
    );

    const sort_info = useMemo(
        () => sort_priority_map(sort.keys),
        [sort.keys]
    );

    const do_apply_sort = (keys: SortKey[]) => {
        apply_sort(keys, show_labels);
    };

    const do_apply_filter = (entries: FilterEntry[]) => {
        apply_filter(entries, show_labels);
    };

    const toggle_filter_enabled = (id: string) => {
        do_apply_filter(
            filter.entries.map(my_entry =>
                my_entry.id === id
                    ? { ...my_entry, enabled: !my_entry.enabled }
                    : my_entry
            )
        );
    };

    const remove_filter_entry = (id: string) => {
        do_apply_filter(
            filter.entries.filter(my_entry => my_entry.id !== id)
        );
    };

    // Open the filter editor for a column, seeding from any existing entry
    // and pre-fetching the histogram for the numeric brush.
    const open_filter_editor = (col_index: number) => {
        if (!metadata) return;
        const my_var = metadata.variables[col_index];
        if (!my_var) return;
        const my_kind = col_kind(my_var);
        if (my_kind === 'numeric' || my_kind === 'labelledNumeric') {
            request_histogram(col_index);
        }
        const my_existing =
            filter.entries.find(
                my_entry => my_entry.col_index === col_index
            ) ?? null;
        set_filter_editor({
            col_index,
            entry: my_existing,
            left_px: viewport_mouse_ref.current.x,
            top_px: viewport_mouse_ref.current.y,
        });
    };

    // One filter per column: applying drops any existing entry for this
    // column (by id when editing, and by col_index for safety), then
    // appends the new one.
    const apply_filter_entry = (entry: FilterEntry) => {
        const the_rest = filter.entries.filter(
            my_entry =>
                my_entry.id !== entry.id
                && my_entry.col_index !== entry.col_index
        );
        do_apply_filter([...the_rest, entry]);
        set_filter_editor(null);
    };

    const clear_filter_on_column = (col_index: number) => {
        do_apply_filter(
            filter.entries.filter(
                my_entry => my_entry.col_index !== col_index
            )
        );
    };

    const has_filter_on_column = (col_index: number): boolean =>
        filter.entries.some(
            my_entry => my_entry.col_index === col_index
        );

    // The "focused" variable index for keyboard sort shortcuts: the
    // focused cell's column if any, else the selected column header,
    // mapped back through the visibility map.
    const focused_var_index = (() => {
        const my_visible =
            grid_selection.current?.cell[0]
            ?? grid_selection.columns.first();
        if (my_visible === undefined) return undefined;
        const my_var_index = visible_col_map[my_visible];
        return my_var_index === undefined ? undefined : my_var_index;
    })();

    const menu_var_index =
        context_menu && metadata
            ? metadata.variables.findIndex(
                my_v => my_v.name === context_menu.variable_name
            )
            : -1;

    // Toggling Labels re-sorts a labelled column WYSIWYG. (The host's
    // sortApplied sets labels_on_when_sorted to the new value, which
    // re-satisfies the guard below, so there is no re-sort loop.)
    useEffect(() => {
        if (sort.keys.length === 0) return;
        if (sort.labels_on_when_sorted === show_labels) return;
        const my_touches_labelled = sort.keys.some(my_key => {
            const my_var = metadata?.variables[my_key.col_index];
            return my_var?.has_value_labels === true;
        });
        if (!my_touches_labelled) return;
        apply_sort(sort.keys, show_labels);
    }, [show_labels, sort, metadata, apply_sort]);

    // Toggling Labels re-filters a labelled column so the stored
    // labels_on_when_filtered stays in sync. Labelled-numeric set matching
    // is code-based, so this is effectively a no-op for Stata data, but the
    // guard is kept faithful (and prevents a re-filter loop: the host's
    // filterApplied sets labels_on_when_filtered to the new value, which
    // re-satisfies the guard).
    useEffect(() => {
        if (filter.entries.length === 0) return;
        if (filter.labels_on_when_filtered === show_labels) return;
        const my_touches_labelled = filter.entries.some(my_entry => {
            const my_var = metadata?.variables[my_entry.col_index];
            return my_var?.has_value_labels === true;
        });
        if (!my_touches_labelled) return;
        apply_filter(filter.entries, show_labels);
    }, [show_labels, filter, metadata, apply_filter]);

    // Keyboard sort shortcuts: Shift+Alt+A/D sort the focused column
    // ascending/descending (replace); Shift+Alt+0 clears all sorts.
    useEffect(() => {
        const handle_keydown = (e: KeyboardEvent) => {
            if (!metadata) return;
            if (
                !e.shiftKey
                || !e.altKey
                || e.metaKey
                || e.ctrlKey
            ) {
                return;
            }
            if (is_editable_target(e.target)) return;

            if (e.code === 'KeyA' || e.code === 'KeyD') {
                if (focused_var_index === undefined) return;
                e.preventDefault();
                const my_direction =
                    e.code === 'KeyA' ? 'asc' : 'desc';
                do_apply_sort(
                    apply_sort_pick(
                        sort.keys,
                        focused_var_index,
                        my_direction,
                        false
                    )
                );
            } else if (e.code === 'Digit0') {
                if (sort.keys.length === 0) return;
                e.preventDefault();
                do_apply_sort([]);
            }
        };
        document.addEventListener('keydown', handle_keydown, true);
        return () => {
            document.removeEventListener(
                'keydown',
                handle_keydown,
                true
            );
        };
    }, [metadata, focused_var_index, sort, show_labels]);

    // Keyboard filter shortcuts: Shift+Alt+F opens the filter editor for
    // the focused column; Shift+Alt+X clears that column's filter;
    // Shift+Alt+9 clears all filters.
    useEffect(() => {
        const handle_keydown = (e: KeyboardEvent) => {
            if (!metadata) return;
            if (
                !e.shiftKey
                || !e.altKey
                || e.metaKey
                || e.ctrlKey
            ) {
                return;
            }
            if (is_editable_target(e.target)) return;

            if (e.code === 'KeyF') {
                if (focused_var_index === undefined) return;
                e.preventDefault();
                open_filter_editor(focused_var_index);
            } else if (e.code === 'KeyX') {
                if (focused_var_index === undefined) return;
                if (!has_filter_on_column(focused_var_index)) return;
                e.preventDefault();
                clear_filter_on_column(focused_var_index);
            } else if (e.code === 'Digit9') {
                if (filter.entries.length === 0) return;
                e.preventDefault();
                do_apply_filter([]);
            }
        };
        document.addEventListener('keydown', handle_keydown, true);
        return () => {
            document.removeEventListener(
                'keydown',
                handle_keydown,
                true
            );
        };
    }, [metadata, focused_var_index, filter, show_labels]);

    const draw_sort_glyph = (
        ctx: CanvasRenderingContext2D,
        rect: { x: number; y: number; width: number; height: number },
        theme: Theme,
        info: { direction: 'asc' | 'desc'; priority: number },
        show_priority: boolean,
        selected: boolean
    ) => {
        const my_color = selected
            ? theme.textHeaderSelected
            : theme.textHeader;
        const my_right = rect.x + rect.width - 8;
        const my_cy = rect.y + rect.height / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();
        ctx.fillStyle = my_color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.globalAlpha = info.priority === 1 ? 0.85 : 0.55;
        ctx.font = `9px ${theme.fontFamily}`;
        ctx.fillText(
            info.direction === 'asc' ? '▲' : '▼',
            my_right,
            my_cy
        );
        if (show_priority) {
            ctx.font = `bold 9px ${theme.fontFamily}`;
            ctx.fillText(String(info.priority), my_right - 10, my_cy);
        }
        ctx.restore();
    };

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
        const my_selected = isSelected || hasSelectedCell;
        const my_sort = sort_info.get(Number(my_column.id));

        if (!my_variable_label) {
            draw_content();
        } else {
            const my_text_color = my_selected
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
        }

        if (my_sort) {
            draw_sort_glyph(
                ctx,
                rect,
                theme,
                my_sort,
                sort.keys.length > 1,
                my_selected
            );
        }
    };

    // On open, explain (and let the user cancel) the wait while saved
    // sort/filter preferences are reapplied.
    const restore_message = restore_pending
        ? (restore_cancelling
            ? 'Loading…'
            : describe_restore_message(
                restore_pending.sort,
                restore_pending.filter
            ))
        : null;

    // While the restore banner is up it explains the wait, so suppress
    // the bare "Loading…" row-count that would otherwise stack above it.
    const row_count_text = describe_toolbar_row_count(
        metadata,
        nobs_effective,
        first_visible_row,
        visible_row_count,
        restore_message !== null
    );

    const subset_text = describe_subset(metadata);
    // Sort and filter are usually mutually exclusive, but both can be
    // in flight at once; show every pending operation rather than
    // letting one mask the other.
    const the_progress_parts: string[] = [];
    if (sort_pending) the_progress_parts.push('Sorting…');
    if (filter_pending) the_progress_parts.push('Filtering…');
    const sort_filter_progress_text = the_progress_parts.join(' · ');

    // Drop the sort/filter chips onto their own row when they would
    // otherwise crowd the action buttons off the toolbar. `hidden_columns.size`
    // is a dependency because it drives the Columns button's count badge,
    // which changes the action buttons' width.
    const toolbar_chips_wrapped = use_toolbar_wrap(
        {
            toolbar: toolbar_ref,
            lead: row_count_ref,
            chips: toolbar_chips_ref,
            actions: toolbar_actions_ref,
        },
        [sort.keys, filter.entries, row_count_text, hidden_columns.size]
    );

    const clamp_position = (
        left: number,
        top: number,
        el_width: number,
        el_height: number
    ): { left: number; top: number } => {
        const my_shell = grid_shell_ref.current;
        if (!my_shell) {
            return { left, top };
        }
        const my_pw = my_shell.clientWidth;
        const my_ph = my_shell.clientHeight;
        let my_left = left;
        let my_top = top;

        if (my_left + el_width > my_pw - 4) {
            my_left = my_pw - el_width - 4;
        }
        if (my_top + el_height > my_ph - 4) {
            my_top = my_ph - el_height - 4;
        }
        my_left = Math.max(4, my_left);
        my_top = Math.max(4, my_top);

        return { left: my_left, top: my_top };
    };

    const tooltip_ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const my_el = tooltip_ref.current;
        if (!my_el || !header_tooltip) {
            return;
        }
        const my_clamped = clamp_position(
            header_tooltip.left_px,
            header_tooltip.top_px,
            my_el.offsetWidth,
            my_el.offsetHeight
        );
        my_el.style.left = `${my_clamped.left}px`;
        my_el.style.top = `${my_clamped.top}px`;
    });

    const on_item_hovered = (args: GridMouseEventArgs) => {
        if (!metadata || args.kind !== 'header') {
            set_header_tooltip(null);
            return;
        }

        const my_var_index =
            visible_col_map[args.location[0]];
        const my_variable =
            metadata.variables[my_var_index];
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
            left_px: last_mouse_ref.current.x,
            top_px: last_mouse_ref.current.y + 16,
        });
    };

    const persist_column_widths = (
        next_widths: Record<string, number>
    ) => {
        if (!metadata) {
            return;
        }

        vscode_api.postMessage({
            type: 'columnWidthsChanged',
            dataset_key: metadata.dataset_key,
            widths: next_widths,
        });
    };

    const persist_hidden_columns = (
        next_hidden: Set<string>
    ) => {
        if (!metadata) {
            return;
        }

        vscode_api.postMessage({
            type: 'columnVisibilityChanged',
            dataset_key: metadata.dataset_key,
            hidden_columns: [...next_hidden],
        });
    };

    const schedule_persist_column_widths = (
        next_widths: Record<string, number>
    ) => {
        if (persist_resize_timeout_ref.current !== null) {
            window.clearTimeout(
                persist_resize_timeout_ref.current
            );
        }

        persist_resize_timeout_ref.current = window.setTimeout(
            () => {
                persist_resize_timeout_ref.current = null;
                persist_column_widths(next_widths);
            },
            150
        );
    };

    const update_column_width = (
        col_index: number,
        new_size: number,
        persist: boolean
    ) => {
        if (!metadata) {
            return;
        }

        const my_var_index =
            visible_col_map[col_index];
        const my_variable =
            metadata.variables[my_var_index];
        if (!my_variable) {
            return;
        }

        const my_width = clamp_column_width(new_size);
        const my_next_widths = {
            ...column_widths_ref.current,
            [my_variable.name]: my_width,
        };

        set_column_widths_by_name(my_next_widths);
        set_user_resized_columns(my_previous => {
            const my_next = new Set(my_previous);
            my_next.add(my_variable.name);
            return my_next;
        });

        if (persist) {
            if (persist_resize_timeout_ref.current !== null) {
                window.clearTimeout(
                    persist_resize_timeout_ref.current
                );
                persist_resize_timeout_ref.current = null;
            }
            persist_column_widths(my_next_widths);
            return;
        }

        schedule_persist_column_widths(my_next_widths);
    };

    const select_single_column = (
        col_index: number
    ) => {
        set_grid_selection(
            create_single_column_selection(col_index)
        );
    };

    const copy_column_to_clipboard = (
        var_index: number
    ) => {
        if (!metadata) {
            return;
        }

        vscode_api.postMessage({
            type: 'copyColumn',
            col_index: var_index,
            show_labels,
            show_formats,
        });
    };

    const update_hidden_columns = (
        next_hidden: Set<string>
    ) => {
        set_hidden_columns(next_hidden);
        persist_hidden_columns(next_hidden);
    };

    return (
        <div className="browser-root">
            <div
                className={
                    toolbar_chips_wrapped ? 'toolbar is-wrapped' : 'toolbar'
                }
                ref={toolbar_ref}
            >
                <span className="row-count" ref={row_count_ref}>
                    {row_count_text}
                </span>
                <div className="toolbar-chips" ref={toolbar_chips_ref}>
                    <ToolbarSortStrip
                        keys={sort.keys}
                        column_names={column_names}
                        on_change={do_apply_sort}
                        on_clear_all={() => do_apply_sort([])}
                    />
                    {metadata && (
                        <ToolbarFilterStrip
                            filter={filter}
                            columns={metadata.variables}
                            on_edit={my_entry =>
                                open_filter_editor(my_entry.col_index)
                            }
                            on_toggle_enabled={toggle_filter_enabled}
                            on_remove={remove_filter_entry}
                            on_clear_all={() => do_apply_filter([])}
                        />
                    )}
                </div>
                <div className="toolbar-actions" ref={toolbar_actions_ref}>
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
                    <div className="columns-popover-anchor">
                        <button
                            className={columns_popover_open ? 'toggle active' : 'toggle'}
                            onClick={() => set_columns_popover_open(v => !v)}
                            type="button"
                        >
                            Columns
                            {hidden_columns.size > 0 && (
                                <span className="hidden-count-badge">
                                    {hidden_columns.size}
                                </span>
                            )}
                        </button>
                        {columns_popover_open && metadata && (
                            <ColumnVisibilityPopover
                                variables={metadata.variables}
                                hidden_columns={hidden_columns}
                                on_toggle={name => {
                                    update_hidden_columns(
                                        toggle_column_hidden(
                                            hidden_columns,
                                            name
                                        )
                                    );
                                }}
                                on_show_all={() => {
                                    update_hidden_columns(
                                        show_all_columns()
                                    );
                                }}
                                on_hide_all={() => {
                                    update_hidden_columns(
                                        hide_all_columns(
                                            metadata.variables.map(
                                                v => v.name
                                            )
                                        )
                                    );
                                }}
                                on_close={() =>
                                    set_columns_popover_open(false)
                                }
                            />
                        )}
                    </div>
                </div>
            </div>
            {sort_filter_progress_text && (
                <div className="toolbar-progress" role="status">
                    {sort_filter_progress_text}
                </div>
            )}
            {restore_message && (
                <div className="toolbar-restore" role="status">
                    <span>{restore_message}</span>
                    {!restore_cancelling && (
                        <button
                            type="button"
                            className="restore-skip"
                            onClick={cancel_restore}
                        >
                            Skip and show data now
                        </button>
                    )}
                </div>
            )}
            {subset_text && (
                <div className="toolbar-subset-row">{subset_text}</div>
            )}
            <div className="grid-shell" ref={grid_shell_ref}>
                <DataEditor
                    theme={vscode_theme}

                    width="100%"
                    height="100%"
                    columns={the_columns}
                    rows={nobs_effective ?? metadata?.nobs ?? 0}
                    headerHeight={HEADER_HEIGHT_PX}
                    rowMarkers="number"
                    columnSelect="multi"
                    getCellsForSelection={true}
                    gridSelection={grid_selection}
                    smoothScrollX={true}
                    smoothScrollY={true}
                    drawHeader={draw_header}
                    onGridSelectionChange={set_grid_selection}
                    onHeaderClicked={(col_index, _event) => {
                        select_single_column(col_index);
                    }}
                    onCellContextMenu={(_cell, event) => {
                        event.preventDefault();
                    }}
                    onHeaderContextMenu={(col_index, event) => {
                        event.preventDefault();
                        select_single_column(col_index);
                        const my_var_index =
                            visible_col_map[col_index];
                        const my_variable =
                            metadata?.variables[my_var_index];
                        if (!my_variable) {
                            return;
                        }
                        set_context_menu({
                            variable_name: my_variable.name,
                            left_px:
                                last_mouse_ref
                                    .current.x,
                            top_px:
                                last_mouse_ref
                                    .current.y,
                        });
                    }}
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
                        update_viewport(
                            my_range.y,
                            my_range.y + my_range.height + 10
                        );
                        ensure_rows(
                            my_range.y,
                            my_range.y + my_range.height + 10
                        );
                    }}
                    getCellContent={([col, row]: Item) => {
                        const my_row = get_row(row);
                        const my_var_index =
                            visible_col_map[col];
                        const my_cell =
                            my_row?.[my_var_index];
                        const my_display = my_cell
                            ? get_cell_display_value(
                                my_cell,
                                show_labels,
                                show_formats
                            )
                            : '';

                        const my_missing_style =
                            metadata?.missing_value_style
                            ?? 'foreground';
                        const my_theme_override =
                            my_cell?.missing_type
                            && my_missing_style !== 'none'
                                ? my_missing_style === 'background'
                                    ? missing_bg
                                    : missing_fg
                                : undefined;

                        return {
                            kind: GridCellKind.Text,
                            data: my_display,
                            displayData: my_display,
                            readonly: true,
                            allowOverlay: true,
                            ...(my_theme_override && {
                                themeOverride: my_theme_override,
                            }),
                        };
                    }}
                />
                {filter_editor && metadata && (() => {
                    const my_col =
                        metadata.variables[filter_editor.col_index];
                    if (!my_col) return null;
                    return (
                        <FilterPopover
                            // Key by column so switching columns remounts
                            // and re-seeds the form (the seed runs only in
                            // useState initializers).
                            key={filter_editor.col_index}
                            column={my_col}
                            col_index={filter_editor.col_index}
                            histogram={histograms.get(
                                filter_editor.col_index
                            )}
                            initial={filter_editor.entry ?? undefined}
                            anchor={{
                                left_px: filter_editor.left_px,
                                top_px: filter_editor.top_px,
                            }}
                            on_apply={apply_filter_entry}
                            on_cancel={() => set_filter_editor(null)}
                        />
                    );
                })()}
                {header_tooltip && (
                    <div
                        ref={tooltip_ref}
                        className="header-tooltip"
                        style={{
                            left: `${header_tooltip.left_px}px`,
                            top: `${header_tooltip.top_px}px`,
                        }}
                    >
                        {header_tooltip.text}
                    </div>
                )}
                {context_menu && metadata && (
                    <ColumnContextMenu
                        left_px={context_menu.left_px}
                        top_px={context_menu.top_px}
                        on_copy={() => {
                            const my_var_index =
                                metadata.variables
                                    .findIndex(
                                        v => v.name
                                            === context_menu
                                                .variable_name
                                    );
                            if (my_var_index >= 0) {
                                copy_column_to_clipboard(
                                    my_var_index
                                );
                            }
                            set_context_menu(null);
                        }}
                        on_hide={() => {
                            update_hidden_columns(
                                toggle_column_hidden(
                                    hidden_columns,
                                    context_menu.variable_name
                                )
                            );
                            set_context_menu(null);
                        }}
                        on_close={() =>
                            set_context_menu(null)
                        }
                        sort={{
                            active_direction:
                                menu_var_index >= 0
                                    ? active_direction(
                                        sort.keys,
                                        menu_var_index
                                    )
                                    : 'none',
                            any_sorted: sort.keys.length > 0,
                            other_columns_sorted: sort.keys.some(
                                my_key =>
                                    my_key.col_index
                                    !== menu_var_index
                            ),
                            on_sort: (direction, append) => {
                                if (menu_var_index >= 0) {
                                    do_apply_sort(
                                        apply_sort_pick(
                                            sort.keys,
                                            menu_var_index,
                                            direction,
                                            append
                                        )
                                    );
                                }
                                set_context_menu(null);
                            },
                            on_add_to_sort: direction => {
                                if (menu_var_index >= 0) {
                                    do_apply_sort(
                                        apply_sort_pick(
                                            sort.keys,
                                            menu_var_index,
                                            direction,
                                            true
                                        )
                                    );
                                }
                                set_context_menu(null);
                            },
                            on_clear_column: () => {
                                do_apply_sort(
                                    sort.keys.filter(
                                        my_key =>
                                            my_key.col_index
                                            !== menu_var_index
                                    )
                                );
                                set_context_menu(null);
                            },
                            on_clear_all: () => {
                                do_apply_sort([]);
                                set_context_menu(null);
                            },
                        }}
                        filter={
                            menu_var_index >= 0
                                ? {
                                    has_filter_on_column:
                                        has_filter_on_column(
                                            menu_var_index
                                        ),
                                    any_filtered:
                                        filter.entries.length > 0,
                                    on_filter: () => {
                                        open_filter_editor(
                                            menu_var_index
                                        );
                                        set_context_menu(null);
                                    },
                                    on_clear_column: () => {
                                        clear_filter_on_column(
                                            menu_var_index
                                        );
                                        set_context_menu(null);
                                    },
                                    on_clear_all: () => {
                                        do_apply_filter([]);
                                        set_context_menu(null);
                                    },
                                }
                                : undefined
                        }
                    />
                )}
            </div>
        </div>
    );
}

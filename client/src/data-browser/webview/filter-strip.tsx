/**
 * Toolbar filter chip strip.
 *
 * One chip per filter entry. Each chip shows an enabled/disabled glyph and
 * a predicate summary; clicking the body opens the editor. A trailing
 * kebab opens a small popover with per-entry actions (Edit, Enable/Disable,
 * Remove). A trailing ✕ clears all filters. Renders nothing when there are
 * no entries.
 *
 * Ported from Raven's data-viewer filter-strip; uses Sight's
 * predicate-summary and `use_dismiss`, and matches the sort-strip's
 * fixed-position, viewport-clamped popover pattern.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { FilterEntry, FilterState, VariableDescription } from '../types';
import { summarize_predicate } from './predicate-summary';
import { use_dismiss } from './use-dismiss';

interface FilterStripProps {
    filter: FilterState;
    columns: VariableDescription[];
    on_edit: (entry: FilterEntry) => void;
    on_toggle_enabled: (id: string) => void;
    on_remove: (id: string) => void;
    on_clear_all: () => void;
}

export function ToolbarFilterStrip({
    filter,
    columns,
    on_edit,
    on_toggle_enabled,
    on_remove,
    on_clear_all,
}: FilterStripProps) {
    if (filter.entries.length === 0) {
        return null;
    }
    return (
        <div
            className="filter-strip"
            role="group"
            aria-label="Active filters"
        >
            <span className="filter-strip-label">Filter:</span>
            <div className="filter-strip-chips">
                {filter.entries.map(my_entry => (
                    <FilterChip
                        key={my_entry.id}
                        entry={my_entry}
                        column={columns[my_entry.col_index]}
                        on_edit={on_edit}
                        on_toggle_enabled={on_toggle_enabled}
                        on_remove={on_remove}
                    />
                ))}
            </div>
            <button
                type="button"
                className="filter-strip-clear"
                aria-label="Clear all filters"
                title="Clear all filters"
                onClick={on_clear_all}
            >
                ✕
            </button>
        </div>
    );
}

function FilterChip({
    entry,
    column,
    on_edit,
    on_toggle_enabled,
    on_remove,
}: {
    entry: FilterEntry;
    column: VariableDescription | undefined;
    on_edit: (entry: FilterEntry) => void;
    on_toggle_enabled: (id: string) => void;
    on_remove: (id: string) => void;
}) {
    // Coords captured at open time; the popover renders position: fixed so
    // it escapes the strip's overflow-x clip, then a layout effect clamps
    // it to the viewport — same pattern as SortChip.
    const [coords, set_coords] =
        useState<{ left: number; top: number } | null>(null);
    const popover_ref = useRef<HTMLDivElement>(null);
    const kebab_ref = useRef<HTMLButtonElement>(null);
    const close_popover = useCallback(() => set_coords(null), []);
    use_dismiss(popover_ref, close_popover);

    useLayoutEffect(() => {
        const my_el = popover_ref.current;
        if (!my_el || !coords) return;
        const MARGIN = 4;
        const my_rect = my_el.getBoundingClientRect();
        const my_max_left = Math.max(
            MARGIN,
            window.innerWidth - my_rect.width - MARGIN
        );
        const my_max_top = Math.max(
            MARGIN,
            window.innerHeight - my_rect.height - MARGIN
        );
        const my_left = Math.min(
            Math.max(MARGIN, coords.left),
            my_max_left
        );
        const my_top = Math.min(
            Math.max(MARGIN, coords.top),
            my_max_top
        );
        if (my_left !== coords.left || my_top !== coords.top) {
            set_coords({ left: my_left, top: my_top });
        }
    }, [coords]);

    const my_open = coords !== null;
    // Guard against a column dropped from the schema.
    const my_missing = column === undefined;
    const my_summary = my_missing
        ? '(removed column)'
        : summarize_predicate(entry.predicate, column);
    const my_toggle_glyph = entry.enabled ? '✓' : '✗';
    const my_aria_label =
        `Filter: ${my_summary}. `
        + `${entry.enabled ? 'Enabled' : 'Disabled'}. Open actions.`;

    const toggle = () => {
        if (my_open) {
            set_coords(null);
            return;
        }
        const my_rect = kebab_ref.current?.getBoundingClientRect();
        if (!my_rect) return;
        set_coords({ left: my_rect.left, top: my_rect.bottom + 4 });
    };

    const do_edit = () => {
        if (!my_missing) on_edit(entry);
    };
    const do_edit_from_menu = () => {
        if (!my_missing) on_edit(entry);
        set_coords(null);
    };
    const do_toggle = () => {
        on_toggle_enabled(entry.id);
        set_coords(null);
    };
    const do_remove = () => {
        on_remove(entry.id);
        set_coords(null);
    };

    return (
        <>
            <div
                className={
                    entry.enabled ? 'filter-chip' : 'filter-chip disabled'
                }
            >
                <span className="filter-chip-toggle">
                    {my_toggle_glyph}
                </span>
                <button
                    type="button"
                    className="filter-chip-body"
                    aria-label={my_aria_label}
                    onClick={do_edit}
                >
                    {my_summary}
                </button>
                <button
                    ref={kebab_ref}
                    type="button"
                    className={
                        my_open
                            ? 'filter-chip-kebab open'
                            : 'filter-chip-kebab'
                    }
                    aria-label="Filter actions"
                    aria-haspopup="menu"
                    aria-expanded={my_open}
                    onClick={toggle}
                >
                    ⋯
                </button>
            </div>
            {my_open && coords && (
                <div
                    ref={popover_ref}
                    className="filter-chip-popover"
                    role="menu"
                    style={{
                        left: `${coords.left}px`,
                        top: `${coords.top}px`,
                    }}
                >
                    {!my_missing && (
                        <button
                            type="button"
                            className="filter-chip-popover-item"
                            role="menuitem"
                            onClick={do_edit_from_menu}
                        >
                            Edit
                        </button>
                    )}
                    <button
                        type="button"
                        className="filter-chip-popover-item"
                        role="menuitem"
                        onClick={do_toggle}
                    >
                        {entry.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                        type="button"
                        className="filter-chip-popover-item"
                        role="menuitem"
                        onClick={do_remove}
                    >
                        Remove
                    </button>
                </div>
            )}
        </>
    );
}

/**
 * Toolbar sort chip strip.
 *
 * One chip per active sort key, in priority order. Each chip shows the
 * column name and its direction arrow and opens a small popover with
 * per-key actions (Flip, Remove, Move to first). A trailing ✕ clears
 * the whole sort. Renders nothing when no sort is active.
 *
 * Ported from Raven's data-viewer sort-strip; uses Sight's pure sort
 * helpers and `use_dismiss`.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { SortKey } from '../types';
import { flip_key, move_to_first, remove_key } from './sort-actions';
import { use_dismiss } from './use-dismiss';

interface SortStripProps {
    keys: SortKey[];
    column_names: string[];
    on_change: (keys: SortKey[]) => void;
    on_clear_all: () => void;
}

export function ToolbarSortStrip({
    keys,
    column_names,
    on_change,
    on_clear_all,
}: SortStripProps) {
    if (keys.length === 0) {
        return null;
    }
    return (
        <div
            className="sort-strip"
            role="group"
            aria-label="Active sort keys"
        >
            <span className="sort-strip-label">Sort:</span>
            <div className="sort-strip-chips">
                {keys.map((my_key, i) => (
                    <SortChip
                        key={`${my_key.col_index}-${i}`}
                        sort_key={my_key}
                        priority={i + 1}
                        column_name={
                            column_names[my_key.col_index]
                            ?? `col ${my_key.col_index}`
                        }
                        keys={keys}
                        index={i}
                        on_change={on_change}
                    />
                ))}
            </div>
            <button
                type="button"
                className="sort-strip-clear"
                aria-label="Clear all sorts"
                title="Clear all sorts"
                onClick={on_clear_all}
            >
                ✕
            </button>
        </div>
    );
}

function SortChip({
    sort_key,
    priority,
    column_name,
    keys,
    index,
    on_change,
}: {
    sort_key: SortKey;
    priority: number;
    column_name: string;
    keys: SortKey[];
    index: number;
    on_change: (keys: SortKey[]) => void;
}) {
    // Coords captured at open time; the popover renders position: fixed
    // so it escapes the strip's overflow-x clip, then a layout effect
    // clamps it to the viewport.
    const [coords, set_coords] =
        useState<{ left: number; top: number } | null>(null);
    const popover_ref = useRef<HTMLDivElement>(null);
    const chip_ref = useRef<HTMLButtonElement>(null);
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
    const my_arrow = sort_key.direction === 'asc' ? '▲' : '▼';
    const my_single = keys.length === 1;

    const toggle = () => {
        if (my_open) {
            set_coords(null);
            return;
        }
        const my_rect = chip_ref.current?.getBoundingClientRect();
        if (!my_rect) return;
        set_coords({ left: my_rect.left, top: my_rect.bottom + 4 });
    };

    const do_flip = () => {
        on_change(flip_key(keys, index));
        set_coords(null);
    };
    const do_remove = () => {
        on_change(remove_key(keys, index));
        set_coords(null);
    };
    const do_move_first = () => {
        on_change(move_to_first(keys, index));
        set_coords(null);
    };

    return (
        <>
            <button
                ref={chip_ref}
                type="button"
                className={my_open ? 'sort-chip open' : 'sort-chip'}
                data-priority={priority}
                aria-haspopup="menu"
                aria-expanded={my_open}
                aria-label={
                    `Sort key ${priority}: ${column_name} `
                    + `${sort_key.direction}ending. Open actions.`
                }
                onClick={toggle}
            >
                <span className="sort-chip-name">{column_name}</span>
                <span className="sort-chip-arrow">{my_arrow}</span>
            </button>
            {my_open && coords && (
                <div
                    ref={popover_ref}
                    className="sort-chip-popover"
                    role="menu"
                    style={{
                        left: `${coords.left}px`,
                        top: `${coords.top}px`,
                    }}
                >
                    <button
                        type="button"
                        className="sort-chip-popover-item"
                        role="menuitem"
                        onClick={do_flip}
                    >
                        Flip direction
                    </button>
                    <button
                        type="button"
                        className="sort-chip-popover-item"
                        role="menuitem"
                        onClick={do_remove}
                    >
                        Remove from sort
                    </button>
                    {!my_single && (
                        <button
                            type="button"
                            className="sort-chip-popover-item"
                            role="menuitem"
                            disabled={index === 0}
                            onClick={do_move_first}
                        >
                            Move to first
                        </button>
                    )}
                </div>
            )}
        </>
    );
}

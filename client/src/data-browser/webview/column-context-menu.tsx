import { useEffect, useRef, type MouseEvent } from 'react';
import { use_dismiss } from './use-dismiss';

/** Sort-related slice of the column context menu. Present only for
 *  column-header menus. */
export interface SortMenuProps {
    active_direction: 'asc' | 'desc' | 'none';
    any_sorted: boolean;
    other_columns_sorted: boolean;
    on_sort: (direction: 'asc' | 'desc', append: boolean) => void;
    on_add_to_sort: (direction: 'asc' | 'desc') => void;
    on_clear_column: () => void;
    on_clear_all: () => void;
}

export interface ColumnContextMenuProps {
    left_px: number;
    top_px: number;
    on_copy: () => void;
    on_hide: () => void;
    on_close: () => void;
    sort?: SortMenuProps;
}

const MARGIN_PX = 4;

export function ColumnContextMenu({
    left_px,
    top_px,
    on_copy,
    on_hide,
    on_close,
    sort,
}: ColumnContextMenuProps) {
    const menu_ref = useRef<HTMLDivElement>(null);

    use_dismiss(menu_ref, on_close);

    useEffect(() => {
        const my_el = menu_ref.current;
        if (!my_el) {
            return;
        }
        const my_parent = my_el.offsetParent as
            HTMLElement | null;
        if (!my_parent) {
            return;
        }
        const my_pw = my_parent.clientWidth;
        const my_ph = my_parent.clientHeight;
        const my_w = my_el.offsetWidth;
        const my_h = my_el.offsetHeight;

        let my_left = left_px;
        let my_top = top_px;

        if (my_left + my_w > my_pw - MARGIN_PX) {
            my_left = my_pw - my_w - MARGIN_PX;
        }
        if (my_top + my_h > my_ph - MARGIN_PX) {
            my_top = my_ph - my_h - MARGIN_PX;
        }
        my_left = Math.max(MARGIN_PX, my_left);
        my_top = Math.max(MARGIN_PX, my_top);

        my_el.style.left = `${my_left}px`;
        my_el.style.top = `${my_top}px`;
    }, [left_px, top_px]);

    return (
        <div
            ref={menu_ref}
            className="column-context-menu"
            style={{
                left: `${left_px}px`,
                top: `${top_px}px`,
            }}
        >
            <div
                className="column-context-menu-item"
                onClick={on_copy}
            >
                Copy column
            </div>
            <div
                className="column-context-menu-item"
                onClick={on_hide}
            >
                Hide column
            </div>
            {sort && (
                <>
                    <div
                        className="column-context-menu-divider"
                        role="separator"
                    />
                    <div
                        className={
                            sort.active_direction === 'asc'
                                ? 'column-context-menu-item active'
                                : 'column-context-menu-item'
                        }
                        onClick={(e: MouseEvent<HTMLDivElement>) =>
                            sort.on_sort('asc', e.shiftKey)
                        }
                    >
                        <span className="column-context-menu-check">
                            {sort.active_direction === 'asc' ? '✓' : ''}
                        </span>
                        Sort ascending
                        <span className="column-context-menu-shortcut">
                            ⇧⌥A
                        </span>
                    </div>
                    <div
                        className={
                            sort.active_direction === 'desc'
                                ? 'column-context-menu-item active'
                                : 'column-context-menu-item'
                        }
                        onClick={(e: MouseEvent<HTMLDivElement>) =>
                            sort.on_sort('desc', e.shiftKey)
                        }
                    >
                        <span className="column-context-menu-check">
                            {sort.active_direction === 'desc' ? '✓' : ''}
                        </span>
                        Sort descending
                        <span className="column-context-menu-shortcut">
                            ⇧⌥D
                        </span>
                    </div>
                    {sort.other_columns_sorted
                        && sort.active_direction === 'none' && (
                        <>
                            <div
                                className="column-context-menu-item"
                                onClick={() =>
                                    sort.on_add_to_sort('asc')
                                }
                            >
                                <span className="column-context-menu-check" />
                                Add ascending to sort
                            </div>
                            <div
                                className="column-context-menu-item"
                                onClick={() =>
                                    sort.on_add_to_sort('desc')
                                }
                            >
                                <span className="column-context-menu-check" />
                                Add descending to sort
                            </div>
                        </>
                    )}
                    {sort.active_direction !== 'none' && (
                        <div
                            className="column-context-menu-item"
                            onClick={sort.on_clear_column}
                        >
                            <span className="column-context-menu-check" />
                            Clear sort on this column
                        </div>
                    )}
                    {sort.any_sorted && (
                        <div
                            className="column-context-menu-item"
                            onClick={sort.on_clear_all}
                        >
                            <span className="column-context-menu-check" />
                            Clear all sorts
                            <span className="column-context-menu-shortcut">
                                ⇧⌥0
                            </span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

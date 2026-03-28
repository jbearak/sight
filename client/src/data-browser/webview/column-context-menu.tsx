import { useEffect, useRef } from 'react';
import { use_dismiss } from './use-dismiss';

export interface ColumnContextMenuProps {
    left_px: number;
    top_px: number;
    on_copy: () => void;
    on_hide: () => void;
    on_close: () => void;
}

const MARGIN_PX = 4;

export function ColumnContextMenu({
    left_px,
    top_px,
    on_copy,
    on_hide,
    on_close,
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
        </div>
    );
}

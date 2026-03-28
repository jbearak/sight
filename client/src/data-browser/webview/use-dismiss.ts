import { useEffect, type RefObject } from 'react';

export function use_dismiss(
    container_ref: RefObject<HTMLElement | null>,
    on_close: () => void
): void {
    useEffect(() => {
        const handle_mousedown = (e: MouseEvent) => {
            if (
                container_ref.current
                && !container_ref.current.contains(
                    e.target as Node
                )
            ) {
                on_close();
            }
        };

        const handle_keydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                on_close();
            }
        };

        document.addEventListener(
            'mousedown',
            handle_mousedown
        );
        document.addEventListener(
            'keydown',
            handle_keydown
        );

        return () => {
            document.removeEventListener(
                'mousedown',
                handle_mousedown
            );
            document.removeEventListener(
                'keydown',
                handle_keydown
            );
        };
    }, [on_close]);
}

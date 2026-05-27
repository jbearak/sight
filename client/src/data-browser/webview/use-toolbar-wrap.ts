/**
 * Decides when the data-browser toolbar's sort/filter chip group must
 * drop onto its own second row so the action buttons stay pinned
 * top-right.
 *
 * The pure `should_wrap` holds the policy and is unit-tested; the
 * `use_toolbar_wrap` hook feeds it widths measured from the DOM and
 * re-measures on resize and on chip/row-count changes.
 */

import {
    useLayoutEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';

/**
 * Once wrapped, the content must shrink this many pixels below the
 * available width before we unwrap again. The band keeps sub-pixel
 * layout jitter at the boundary from flapping the toolbar between one
 * and two rows.
 */
export const WRAP_HYSTERESIS_PX = 8;

/** Flex `gap` on `.toolbar` and `.toolbar-chips`, in px (see styles.css). */
const TOOLBAR_GAP_PX = 8;

/** Intrinsic (content) widths of the three toolbar regions, in px. */
export interface ToolbarPartWidths {
    lead_px: number; // the row-count span
    chips_px: number; // sort + filter strips (summed content + inner gaps)
    actions_px: number; // the Labels / Formats / Columns buttons
}

/**
 * Decide whether the chip group should wrap to its own row.
 *
 * `was_wrapped` is the current state, used only for the hysteresis
 * band. The decision is otherwise a fixed point — and so does not
 * oscillate — only as long as the measured `parts` widths are the same
 * whether or not the toolbar is currently wrapped. The hook below holds
 * up its end of that bargain by summing each strip's `scrollWidth`
 * (intrinsic content width); see the precondition documented there.
 */
export function should_wrap(
    parts: ToolbarPartWidths,
    available_px: number,
    gap_px: number,
    was_wrapped: boolean
): boolean {
    // With no chips there is nothing to move to a second row, so
    // wrapping could never relieve a row-1 overflow.
    if (parts.chips_px <= 0) {
        return false;
    }

    const the_present_widths = [
        parts.lead_px,
        parts.chips_px,
        parts.actions_px,
    ].filter(my_width => my_width > 0);

    const content_px = the_present_widths.reduce(
        (sum_px, my_width) => sum_px + my_width,
        0
    );
    const gaps_px = Math.max(0, the_present_widths.length - 1) * gap_px;
    const needed_px = content_px + gaps_px;

    const threshold_px = was_wrapped
        ? available_px - WRAP_HYSTERESIS_PX
        : available_px;
    return needed_px > threshold_px;
}

interface ToolbarWrapRefs {
    toolbar: RefObject<HTMLElement | null>;
    lead: RefObject<HTMLElement | null>;
    chips: RefObject<HTMLElement | null>;
    actions: RefObject<HTMLElement | null>;
}

/**
 * Track whether the toolbar chip group must wrap onto its own row.
 *
 * Measures intrinsic content widths — each region's `scrollWidth`, and
 * for the chips the sum of the individual strips' `scrollWidth` (not the
 * `.toolbar-chips` container's, which stretches to full width when
 * wrapped and would then read as overflowing) — and compares them to
 * the toolbar's client width via `should_wrap`.
 *
 * PRECONDITION (keeps `should_wrap` from oscillating): a strip's
 * `scrollWidth` must equal its intrinsic content width regardless of how
 * wide its parent is. That holds because every chip leaf is
 * non-shrinking (`flex-grow: 0`) and `white-space: nowrap`, so a strip
 * never reflows or ellipsizes when the wrapped container gives it more
 * room. Adding grow/ellipsis/wrapping to a strip child would break this
 * and could make the wrap decision flip-flop.
 *
 * Re-measures on toolbar width changes (ResizeObserver, ignoring
 * height-only churn from wrapping) and whenever `content_deps` change.
 * Callers must include in `content_deps` anything that changes a
 * region's width without changing the toolbar's width — e.g. the Columns
 * count badge, which widens the action buttons.
 */
export function use_toolbar_wrap(
    refs: ToolbarWrapRefs,
    content_deps: readonly unknown[]
): boolean {
    const [is_wrapped, set_is_wrapped] = useState(false);

    const measure = () => {
        const my_toolbar = refs.toolbar.current;
        if (!my_toolbar) {
            return;
        }

        const lead_px = refs.lead.current?.scrollWidth ?? 0;
        const actions_px = refs.actions.current?.scrollWidth ?? 0;

        let chips_px = 0;
        const my_chips = refs.chips.current;
        if (my_chips) {
            const the_strips = Array.from(my_chips.children);
            for (const my_strip of the_strips) {
                chips_px += my_strip.scrollWidth;
            }
            chips_px += Math.max(0, the_strips.length - 1) * TOOLBAR_GAP_PX;
        }

        const parts = { lead_px, chips_px, actions_px };
        const available_px = my_toolbar.clientWidth;
        // Decide against the committed `prev`, not a closed-over value, so
        // the hysteresis band always sees the true current wrap state.
        set_is_wrapped(prev => {
            const next_wrapped = should_wrap(
                parts,
                available_px,
                TOOLBAR_GAP_PX,
                prev
            );
            return prev === next_wrapped ? prev : next_wrapped;
        });
    };

    // Keep a ref to the latest `measure` (closing over the current
    // `refs`) so the one-time observer below can call it without
    // re-subscribing.
    const measure_ref = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        measure_ref.current = measure;
    });

    // Re-measure when chip/row-count content changes (width may be
    // unchanged, so the ResizeObserver would not fire on its own).
    useLayoutEffect(() => {
        measure_ref.current();
    }, content_deps);

    // Observe toolbar width once. Wrapping changes the toolbar's height
    // but not its width, so a width guard avoids a feedback callback.
    useLayoutEffect(() => {
        const my_toolbar = refs.toolbar.current;
        if (!my_toolbar || typeof ResizeObserver === 'undefined') {
            return;
        }
        let last_width_px = -1;
        const my_observer = new ResizeObserver(() => {
            const my_width_px = my_toolbar.clientWidth;
            if (my_width_px === last_width_px) {
                return;
            }
            last_width_px = my_width_px;
            measure_ref.current();
        });
        my_observer.observe(my_toolbar);
        return () => my_observer.disconnect();
    }, [refs.toolbar]);

    return is_wrapped;
}

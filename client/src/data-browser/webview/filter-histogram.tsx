/**
 * FilterHistogram — inline SVG histogram with two draggable range thumbs,
 * used by the numeric filter popover's "between" brush.
 *
 * Renders uniform-width bins as vertical bars (height ∝ count, normalized
 * to the max count). Two thumbs sit on the axis at the lo/hi positions;
 * dragging or keyboard-nudging calls on_change.
 *
 * Invariants:
 *  - lo ≤ hi at all times; swapping is clamped silently.
 *  - The value domain is [bins[0].lo, bins[last].hi].
 *  - Keyboard: Arrow nudges by one bin width; Shift+Arrow by 10×.
 *  - Each thumb exposes role="slider" / aria-valuemin/max/now.
 *
 * Ported from Raven's filter-histogram.
 */

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import type { HistogramBin } from '../types.js';

interface FilterHistogramProps {
    bins: HistogramBin[];
    lo: number;
    hi: number;
    on_change: (lo: number, hi: number) => void;
}

const SVG_W = 260;
const SVG_H = 52;
const AXIS_Y = SVG_H - 12;
const BAR_BOTTOM = AXIS_Y - 2;
const THUMB_R = 6;
const MARGIN_X = THUMB_R + 2;

function value_to_x(value: number, d_min: number, d_max: number): number {
    if (d_max === d_min) return MARGIN_X + (SVG_W - 2 * MARGIN_X) / 2;
    return MARGIN_X
        + ((value - d_min) / (d_max - d_min)) * (SVG_W - 2 * MARGIN_X);
}

function x_to_value(x: number, d_min: number, d_max: number): number {
    const my_frac = (x - MARGIN_X) / (SVG_W - 2 * MARGIN_X);
    return d_min + Math.max(0, Math.min(1, my_frac)) * (d_max - d_min);
}

function snap_to_bin(value: number, bins: HistogramBin[]): number {
    let my_best = bins[0].lo;
    let my_best_dist = Math.abs(value - my_best);
    for (const my_bin of bins) {
        for (const my_edge of [my_bin.lo, my_bin.hi]) {
            const my_dist = Math.abs(value - my_edge);
            if (my_dist < my_best_dist) {
                my_best_dist = my_dist;
                my_best = my_edge;
            }
        }
    }
    return my_best;
}

export function FilterHistogram({
    bins,
    lo,
    hi,
    on_change,
}: FilterHistogramProps): ReactElement | null {
    const svg_ref = useRef<SVGSVGElement>(null);
    const dragging = useRef<'lo' | 'hi' | null>(null);

    const d_min = bins.length > 0 ? bins[0].lo : 0;
    const d_max = bins.length > 0 ? bins[bins.length - 1].hi : 0;
    const max_count = Math.max(...bins.map(my_b => my_b.count), 1);
    const bin_width =
        bins.length > 0 ? (SVG_W - 2 * MARGIN_X) / bins.length : 0;

    const lo_x = value_to_x(lo, d_min, d_max);
    const hi_x = value_to_x(hi, d_min, d_max);

    const get_svg_x = useCallback((client_x: number): number => {
        const my_rect = svg_ref.current?.getBoundingClientRect();
        if (!my_rect) return MARGIN_X;
        return ((client_x - my_rect.left) / my_rect.width) * SVG_W;
    }, []);

    // The drag reads live lo/hi/bins/on_change from a ref so the window
    // listeners can be STABLE (registered once, identity never changes).
    // Otherwise each on_change re-renders and changes a handler's identity
    // mid-drag, leaking the original listener. The unmount effect below is
    // the backstop for closing the popover mid-drag.
    const live = useRef({ bins, d_min, d_max, lo, hi, on_change, get_svg_x });
    live.current = { bins, d_min, d_max, lo, hi, on_change, get_svg_x };

    const handlers_ref = useRef<{
        move: (e: PointerEvent) => void;
        up: () => void;
    } | null>(null);
    if (handlers_ref.current === null) {
        const move = (e: PointerEvent) => {
            if (!dragging.current) return;
            const my_state = live.current;
            const my_raw = x_to_value(
                my_state.get_svg_x(e.clientX),
                my_state.d_min,
                my_state.d_max
            );
            const my_snapped = snap_to_bin(my_raw, my_state.bins);
            if (dragging.current === 'lo') {
                my_state.on_change(
                    Math.min(my_snapped, my_state.hi),
                    my_state.hi
                );
            } else {
                my_state.on_change(
                    my_state.lo,
                    Math.max(my_snapped, my_state.lo)
                );
            }
        };
        const up = () => {
            dragging.current = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        handlers_ref.current = { move, up };
    }

    useEffect(() => () => {
        const my_handlers = handlers_ref.current;
        if (!my_handlers) return;
        window.removeEventListener('pointermove', my_handlers.move);
        window.removeEventListener('pointerup', my_handlers.up);
    }, []);

    const start_drag = useCallback(
        (which: 'lo' | 'hi') => (e: React.PointerEvent) => {
            e.preventDefault();
            dragging.current = which;
            const my_handlers = handlers_ref.current!;
            window.addEventListener('pointermove', my_handlers.move);
            window.addEventListener('pointerup', my_handlers.up);
        },
        []
    );

    const bin_step =
        bins.length > 1 ? bins[1].lo - bins[0].lo : d_max - d_min;

    const on_key_down = (which: 'lo' | 'hi') => (
        e: React.KeyboardEvent
    ) => {
        const my_step = e.shiftKey ? bin_step * 10 : bin_step;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (which === 'lo') on_change(Math.max(d_min, lo - my_step), hi);
            else on_change(lo, Math.max(lo, hi - my_step));
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (which === 'lo') on_change(Math.min(hi, lo + my_step), hi);
            else on_change(lo, Math.min(d_max, hi + my_step));
        }
    };

    if (bins.length === 0) return null;

    const sel_x = Math.min(lo_x, hi_x);
    const sel_w = Math.abs(hi_x - lo_x);

    return (
        <svg
            ref={svg_ref}
            className="filter-histogram"
            width={SVG_W}
            height={SVG_H}
            // viewBox lets the fixed 260-unit layout scale to the popover's
            // content width so the right thumb at the domain max stays in
            // the box. get_svg_x maps via the rendered rect, so drag math
            // is unaffected by the scale.
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            preserveAspectRatio="xMidYMid meet"
            role="group"
            aria-label="Range histogram"
            style={{
                display: 'block',
                width: '100%',
                maxWidth: `${SVG_W}px`,
                height: `${SVG_H}px`,
                cursor: 'default',
                userSelect: 'none',
            }}
        >
            {bins.map((my_bin, i) => {
                const my_bar_h = Math.round(
                    ((BAR_BOTTOM - 4) * my_bin.count) / max_count
                );
                const my_x = MARGIN_X + i * bin_width;
                const my_in_range = my_bin.lo >= lo && my_bin.hi <= hi;
                return (
                    <rect
                        key={i}
                        x={my_x + 0.5}
                        y={BAR_BOTTOM - my_bar_h}
                        width={Math.max(1, bin_width - 1)}
                        height={my_bar_h}
                        className={
                            my_in_range
                                ? 'filter-histogram-bar in-range'
                                : 'filter-histogram-bar'
                        }
                    />
                );
            })}
            <line
                x1={MARGIN_X}
                y1={AXIS_Y}
                x2={SVG_W - MARGIN_X}
                y2={AXIS_Y}
                className="filter-histogram-axis"
            />
            <rect
                x={sel_x}
                y={AXIS_Y - 2}
                width={sel_w}
                height={4}
                className="filter-histogram-range"
            />
            <circle
                cx={lo_x}
                cy={AXIS_Y}
                r={THUMB_R}
                className="filter-histogram-thumb"
                tabIndex={0}
                role="slider"
                aria-label="Low value"
                aria-valuemin={d_min}
                aria-valuemax={d_max}
                aria-valuenow={lo}
                onPointerDown={start_drag('lo')}
                onKeyDown={on_key_down('lo')}
                style={{ cursor: 'ew-resize', outline: 'none' }}
            />
            <circle
                cx={hi_x}
                cy={AXIS_Y}
                r={THUMB_R}
                className="filter-histogram-thumb"
                tabIndex={0}
                role="slider"
                aria-label="High value"
                aria-valuemin={d_min}
                aria-valuemax={d_max}
                aria-valuenow={hi}
                onPointerDown={start_drag('hi')}
                onKeyDown={on_key_down('hi')}
                style={{ cursor: 'ew-resize', outline: 'none' }}
            />
        </svg>
    );
}

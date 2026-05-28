/**
 * Real-layout test harness for the data-browser toolbar chip wrapping.
 *
 * Mounts the *production* toolbar markup — the real `.toolbar` structure
 * with the real `use_toolbar_wrap` hook, the real `ToolbarSortStrip` /
 * `ToolbarFilterStrip`, and the real `styles.css` — inside the real
 * `.browser-root` grid (mirroring `app.tsx`), itself inside a
 * width-pinnable `#harness-root` (the viewport analog). Running in a real
 * VS Code webview (real Chromium), it measures its own layout and posts
 * the numbers back to the extension-host test, which asserts. This is the
 * "self-measure" pattern: the host cannot read the sandboxed webview's
 * DOM, so the webview reads itself and `postMessage`s the result.
 *
 * Reproducing the real `.browser-root` grid is load-bearing: the toolbar
 * is a grid item, and its automatic minimum size is what made it overflow
 * the viewport (pushing the action buttons off-screen and defeating the
 * chip strips' scroll). A plain width-pinned block wrapper would mask that.
 *
 * Deliberately NOT shipped: built to `dist-test/` and excluded from the
 * packaged extension via `.vscodeignore`. It imports neither
 * glide-data-grid nor `use-row-loader`: the grid below the toolbar (the
 * data layer) is omitted; only the toolbar's own containing grid matters.
 *
 * See docs/superpowers/specs/2026-05-27-toolbar-wrap-webview-test-design.md.
 */

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import '../styles.css';
import { ToolbarSortStrip } from '../sort-strip';
import { ToolbarFilterStrip } from '../filter-strip';
import { use_toolbar_wrap } from '../use-toolbar-wrap';
import type {
    FilterState,
    SortKey,
    VariableDescription,
} from '../../types';

// Injected by VS Code in the real webview. Declared module-scoped here
// (not imported from use-row-loader, whose ambient declaration is also
// module-scoped) with a permissive `postMessage` so the harness can post
// `test:*` messages that are not part of the production `WebviewMessage`
// union.
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
};

// acquireVsCodeApi may be called only once per webview, so acquire it
// once at module load and reuse it for every outbound message.
const vscode_api = acquireVsCodeApi();

// Synthetic columns with fixed labels so each chip's intrinsic width is
// real-font-rendered and stable across machines. Sized well beyond the
// chip counts any test uses, so `col_index` always resolves to a column.
const HARNESS_COLUMN_COUNT = 64;

const HARNESS_COLUMNS: VariableDescription[] = Array.from(
    { length: HARNESS_COLUMN_COUNT },
    (_unused, i) => ({
        // Short, uniform-width labels keep each chip narrow and stable, so
        // ~10 chips comfortably fit a single row at 1200px yet overflow at
        // 400px (the margins the suite relies on).
        name: `c${String(i).padStart(2, '0')}`,
        type: 'int',
        format: '%9.0g',
        label: '',
        has_value_labels: false,
    })
);

const HARNESS_COLUMN_NAMES = HARNESS_COLUMNS.map(
    my_column => my_column.name
);

// ----- Inbound message protocol (host → webview) -----

interface ResetMessage {
    type: 'test:reset';
}
interface SetWidthMessage {
    type: 'test:setWidth';
    width_px: number;
}
interface SetStateMessage {
    type: 'test:setState';
    sort_chip_count: number;
    filter_chip_count: number;
    hidden_col_count: number;
    row_count_text: string;
}
interface RequestSnapshotMessage {
    type: 'test:requestSnapshot';
}

type InboundMessage =
    | ResetMessage
    | SetWidthMessage
    | SetStateMessage
    | RequestSnapshotMessage;

// ----- Outbound snapshot payload (webview → host) -----

interface PlainRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
}

function plain_rect(element: Element | null): PlainRect | null {
    if (!element) {
        return null;
    }
    const my_rect = element.getBoundingClientRect();
    return {
        top: my_rect.top,
        bottom: my_rect.bottom,
        left: my_rect.left,
        right: my_rect.right,
        width: my_rect.width,
        height: my_rect.height,
    };
}

export function HarnessApp() {
    const [width_px, set_width_px] = useState<number | null>(null);
    const [sort_chip_count, set_sort_chip_count] = useState(0);
    const [filter_chip_count, set_filter_chip_count] = useState(0);
    const [hidden_col_count, set_hidden_col_count] = useState(0);
    const [row_count_text, set_row_count_text] = useState('');
    // Bumped per setWidth/reset so a snapshot is emitted even when the
    // wrap state does not change (e.g. wide → wider, both single-row).
    const [width_set_counter, set_width_set_counter] = useState(0);
    // Bumped on an explicit snapshot request.
    const [snapshot_request_counter, set_snapshot_request_counter] =
        useState(0);

    const root_ref = useRef<HTMLDivElement>(null);
    const toolbar_ref = useRef<HTMLDivElement>(null);
    const row_count_ref = useRef<HTMLSpanElement>(null);
    const toolbar_chips_ref = useRef<HTMLDivElement>(null);
    const toolbar_actions_ref = useRef<HTMLDivElement>(null);
    const snapshot_seq_ref = useRef(0);

    // Build synthetic sort keys / filter entries from the requested
    // counts. Memoized on the counts so their identity (and thus the
    // hook's `content_deps`) is stable until a count changes — matching
    // production, where `sort.keys` / `filter.entries` change identity
    // only when the user edits them.
    const sort_keys = useMemo<SortKey[]>(
        () =>
            Array.from(
                { length: sort_chip_count },
                (_unused, i) => ({
                    col_index: i,
                    direction: 'asc' as const,
                })
            ),
        [sort_chip_count]
    );

    const filter_state = useMemo<FilterState>(
        () => ({
            entries: Array.from(
                { length: filter_chip_count },
                (_unused, i) => ({
                    id: `f${i}`,
                    col_index: i,
                    predicate: {
                        kind: 'numCompare' as const,
                        op: '>' as const,
                        value: 0,
                    },
                    enabled: true,
                    include_missing: false,
                })
            ),
            labels_on_when_filtered: true,
        }),
        [filter_chip_count]
    );

    // The real hook, wired with the same four refs and `content_deps`
    // shape as app.tsx.
    const is_wrapped = use_toolbar_wrap(
        {
            toolbar: toolbar_ref,
            lead: row_count_ref,
            chips: toolbar_chips_ref,
            actions: toolbar_actions_ref,
        },
        [sort_keys, filter_state.entries, row_count_text, hidden_col_count]
    );

    const noop = useCallback(() => {}, []);

    // Read the live layout from the DOM (not React state) and post it to
    // the host. Reading `is-wrapped` and the computed styles directly is
    // the ground truth the assertions check.
    const post_snapshot = useCallback(() => {
        const my_toolbar = toolbar_ref.current;
        const my_chips = toolbar_chips_ref.current;
        if (!my_toolbar || !my_chips) {
            return;
        }

        const my_sort_strip = my_chips.querySelector('.sort-strip');
        const my_filter_strip = my_chips.querySelector('.filter-strip');
        const my_toolbar_style = getComputedStyle(my_toolbar);
        const my_chips_style = getComputedStyle(my_chips);

        snapshot_seq_ref.current += 1;
        vscode_api.postMessage({
            type: 'test:layoutSnapshot',
            seq: snapshot_seq_ref.current,
            is_wrapped: my_toolbar.classList.contains('is-wrapped'),
            toolbar_rect: plain_rect(my_toolbar),
            chips_rect: plain_rect(my_chips),
            actions_rect: plain_rect(toolbar_actions_ref.current),
            lead_rect: plain_rect(row_count_ref.current),
            // The width-pinned viewport analog (mirrors the production
            // `#root`): the toolbar and its action buttons must stay
            // inside this box.
            root_rect: plain_rect(root_ref.current),
            chips_scroll_width: my_chips.scrollWidth,
            chips_client_width: my_chips.clientWidth,
            sort_strip_scroll_width: my_sort_strip?.scrollWidth ?? 0,
            // The strip's own client width: a strip is genuinely
            // horizontally scrollable only when its scrollWidth exceeds
            // *this* (not the chip container's width).
            sort_strip_client_width:
                (my_sort_strip as HTMLElement | null)?.clientWidth ?? 0,
            filter_strip_scroll_width: my_filter_strip?.scrollWidth ?? 0,
            toolbar_flex_wrap: my_toolbar_style.flexWrap,
            chips_order: my_chips_style.order,
            chips_flex_basis: my_chips_style.flexBasis,
        });
    }, []);

    // Keep a ref to the latest `post_snapshot` so the message handler
    // (subscribed once) can read the live DOM synchronously on an explicit
    // `test:requestSnapshot`. The host only requests after its change has
    // been applied, so a synchronous read is already settled — and it does
    // NOT depend on `requestAnimationFrame` firing, which stalls when the
    // webview panel is not actively painting (headless/backgrounded runs).
    const post_snapshot_ref = useRef(post_snapshot);
    useLayoutEffect(() => {
        post_snapshot_ref.current = post_snapshot;
    });

    // Emit a snapshot after each state/width change settles. A double
    // requestAnimationFrame lets the ResizeObserver callback →
    // set_is_wrapped → React commit finish before we read the layout.
    useLayoutEffect(() => {
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                post_snapshot();
            });
        });
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
        };
    }, [
        is_wrapped,
        sort_chip_count,
        filter_chip_count,
        hidden_col_count,
        row_count_text,
        width_set_counter,
        snapshot_request_counter,
        post_snapshot,
    ]);

    // Announce readiness only after the first ResizeObserver callback
    // sees a non-zero width, so the host never measures a pre-layout
    // 0-width toolbar.
    useEffect(() => {
        const my_toolbar = toolbar_ref.current;
        if (!my_toolbar || typeof ResizeObserver === 'undefined') {
            return;
        }
        let announced = false;
        const my_observer = new ResizeObserver(() => {
            if (announced) {
                return;
            }
            if (my_toolbar.clientWidth > 0) {
                announced = true;
                my_observer.disconnect();
                vscode_api.postMessage({ type: 'test:ready' });
            }
        });
        my_observer.observe(my_toolbar);
        return () => my_observer.disconnect();
    }, []);

    // Inbound test control messages.
    useEffect(() => {
        const on_message = (my_event: MessageEvent) => {
            const my_message = my_event.data as InboundMessage | undefined;
            if (!my_message || typeof my_message.type !== 'string') {
                return;
            }
            switch (my_message.type) {
                case 'test:reset':
                    set_width_px(null);
                    set_sort_chip_count(0);
                    set_filter_chip_count(0);
                    set_hidden_col_count(0);
                    set_row_count_text('');
                    set_width_set_counter(c => c + 1);
                    break;
                case 'test:setWidth':
                    set_width_px(my_message.width_px);
                    set_width_set_counter(c => c + 1);
                    break;
                case 'test:setState':
                    set_sort_chip_count(my_message.sort_chip_count);
                    set_filter_chip_count(my_message.filter_chip_count);
                    set_hidden_col_count(my_message.hidden_col_count);
                    set_row_count_text(my_message.row_count_text);
                    break;
                case 'test:requestSnapshot':
                    // Read synchronously now (robust against stalled rAF),
                    // and also bump the counter so the rAF-settled path
                    // emits a follow-up snapshot.
                    post_snapshot_ref.current();
                    set_snapshot_request_counter(c => c + 1);
                    break;
            }
        };
        window.addEventListener('message', on_message);
        return () => window.removeEventListener('message', on_message);
    }, []);

    // `#harness-root` is the viewport analog (mirrors the production
    // `#root`): `display: block` + `overflow: hidden`, with a pinned
    // `width_px`. The toolbar lives inside a real `.browser-root` grid
    // (mirroring `app.tsx`) so the harness reproduces the production
    // containing block — a single auto-track grid — not a width-pinned
    // block. Setting the width here makes the real ResizeObserver fire on
    // each change; a null width leaves the baseline at full-webview width.
    const wrapper_style: CSSProperties = {
        display: 'block',
        overflow: 'hidden',
        width: width_px === null ? undefined : `${width_px}px`,
    };

    return (
        <div id="harness-root" ref={root_ref} style={wrapper_style}>
            {/* Mirror the production container (`app.tsx`): the toolbar is
                a grid item in `.browser-root`, not a child of a
                width-pinned block. */}
            <div className="browser-root">
                <div
                    className={
                        is_wrapped ? 'toolbar is-wrapped' : 'toolbar'
                    }
                    ref={toolbar_ref}
                >
                    <span className="row-count" ref={row_count_ref}>
                        {row_count_text}
                    </span>
                    <div
                        className="toolbar-chips"
                        ref={toolbar_chips_ref}
                    >
                        <ToolbarSortStrip
                            keys={sort_keys}
                            column_names={HARNESS_COLUMN_NAMES}
                            on_change={noop}
                            on_clear_all={noop}
                        />
                        <ToolbarFilterStrip
                            filter={filter_state}
                            columns={HARNESS_COLUMNS}
                            on_edit={noop}
                            on_toggle_enabled={noop}
                            on_remove={noop}
                            on_clear_all={noop}
                        />
                    </div>
                    <div
                        className="toolbar-actions"
                        ref={toolbar_actions_ref}
                    >
                        <button className="toggle" type="button">
                            Labels
                        </button>
                        <button className="toggle" type="button">
                            Formats
                        </button>
                        <div className="columns-popover-anchor">
                            <button className="toggle" type="button">
                                Columns
                                {hidden_col_count > 0 && (
                                    <span className="hidden-count-badge">
                                        {hidden_col_count}
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

# Data browser toolbar: wrap chips to a second row when they don't fit

## Problem

The data browser toolbar (`client/src/data-browser/webview/`) is a single flex
row:

```
[120 rows] [Sort: a b] [Filter: x y]            [Labels][Formats][Columns]
```

Layout (`styles.css`):

- `.toolbar { display: flex; gap: 8px; align-items: center; }` — single row,
  no `flex-wrap`.
- `.toolbar-actions { margin-left: auto; }` — Labels/Formats/Columns pinned
  right.
- `.sort-strip` / `.filter-strip` each already have `min-width: 0;
  overflow-x: auto;` and render their chip popovers as `position: fixed` to
  escape that clip.

When many/long sort and filter chips are active on a narrow panel, the strips
shrink and scroll internally, but on tight widths the chips become cramped and
the toolbar offers no room to breathe. There is no responsive behavior: the
chips never get more horizontal space than what's left over beside the action
buttons.

## Goal

Make the toolbar reflow **only when needed**:

1. While everything fits, keep today's single row, with the action buttons
   pinned top-right (unchanged look).
2. When the row would overflow, drop the Sort and Filter strips together onto
   their own full-width second row. Row-count and the action buttons stay on
   the top row (row-count top-left, buttons top-right).
3. If the chips still overflow their own row, each strip scrolls horizontally
   — this tier already works via the existing `overflow-x: auto` on the
   strips, so it comes essentially for free.

The wrap/unwrap decision must be **stable**: no flapping or oscillation as the
panel is resized or chips are added/removed.

## Non-goals

- "Always own row" (a permanently two-tier toolbar). Rejected in favor of the
  conditional model.
- Wrapping Sort and Filter onto *separate* rows independently. They drop
  together onto one shared second row.
- Changing sort/filter logic, the chip popovers, or the strip components'
  internals (`sort-strip.tsx`, `filter-strip.tsx`).
- CSS container queries. The trigger is *content* size (how many/long the
  chips are), not container size, so fixed width breakpoints would wrap too
  early or too late as chip count varies.

## Why this needs JS (not pure CSS)

Plain flexbox cannot drop *just the chips* to a second row while keeping the
buttons pinned top-right. That requires the chips to render to the **left of**
the buttons when inline but **below** them when wrapped — a visual-order swap
that depends on DOM order, which `flex-wrap` + `order` cannot express
conditionally. So overflow detection is done in JS (a `ResizeObserver` +
measurement hook), and the result toggles a CSS class.

## Approach (chosen): ResizeObserver + intrinsic-width sum

### DOM structure (`app.tsx`)

Wrap the two strips in a `.toolbar-chips` container and add refs for
measurement. The action buttons block is unchanged except for the added ref.

```jsx
<div className={is_wrapped ? 'toolbar is-wrapped' : 'toolbar'} ref={toolbar_ref}>
    <span className="row-count" ref={row_count_ref}>{row_count_text}</span>
    <div className="toolbar-chips" ref={chips_ref}>
        <ToolbarSortStrip ... />
        {metadata && <ToolbarFilterStrip ... />}
    </div>
    <div className="toolbar-actions" ref={actions_ref}>
        {/* Labels / Formats / Columns — unchanged */}
    </div>
</div>
```

When no sorts/filters are active, both strips return `null`, so `.toolbar-chips`
is empty (≈0 width) and never triggers a wrap — the single-row look is
preserved.

### Measurement hook (`use-toolbar-wrap.ts`, new)

New file alongside the existing `use-dismiss.ts` / `use-row-loader.ts`.

The no-flap guarantee rests on measuring **intrinsic content widths**, which do
not change when the layout wraps:

- `lead = row_count.scrollWidth`
- `chips = Σ(child.scrollWidth over chips_ref.current.children) + inner_gaps`.
  Sum the **individual strips**, not the `.toolbar-chips` wrapper. This is
  critical: when wrapped, `.toolbar-chips` is stretched to `flex-basis: 100%`,
  so its *own* `scrollWidth` would falsely read as the full toolbar width. Each
  strip is content-sized (`flex: 0 1 auto`), so summing the children yields the
  true content width regardless of wrap state.
- `actions = actions.scrollWidth`
- `needed = lead + chips + actions + outer_gaps` (gaps counted only between
  non-empty parts, gap = 8px to match `.toolbar` / `.toolbar-chips`).
- Wrap when `needed > toolbar.clientWidth`.

Wiring:

- A `ResizeObserver` on `toolbar_ref` re-measures on width changes.
- The hook re-runs on content deps (`sort.keys`, `filter`, `row_count_text`,
  `metadata`) so adding/removing chips re-evaluates even when width is
  unchanged.
- Use `useLayoutEffect` so the initial measurement happens before paint (no
  flash of the wrong layout).

Stability:

- Because `needed` is computed from intrinsic widths, toggling the
  `is-wrapped` class does **not** change `needed` → the decision is a fixed
  point, so there is no oscillation.
- A small hysteresis band absorbs sub-pixel jitter at the exact boundary:
  unwrap only when `needed < available − HYSTERESIS_PX` (HYSTERESIS_PX = 8),
  wrap when `needed > available`.
- Toggling wrap changes the toolbar's **height**, not its `clientWidth`, and
  the measure reads only width, so the ResizeObserver does not feed back into
  an infinite loop. (A height-driven observer callback recomputes the same
  `is_wrapped`; React bails on the identical state.)

Testability: extract the comparison as a pure function

```ts
should_wrap(
    parts: { lead: number; chips: number; actions: number },
    available: number,
    gap: number,
    was_wrapped: boolean,
): boolean
```

The DOM/ResizeObserver wiring is not unit-tested (jsdom does not lay out;
`scrollWidth` returns 0); only the pure function is.

### CSS (`styles.css`)

```css
.toolbar-chips {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;            /* let strips shrink + scroll before/while measuring */
}

.toolbar.is-wrapped {
    flex-wrap: wrap;
}

.toolbar.is-wrapped .toolbar-chips {
    order: 1;                /* render after row-count + actions... */
    flex-basis: 100%;        /* ...on its own full-width second row */
}
```

- Non-wrapped: default `flex-wrap: nowrap`; `row-count`, `.toolbar-chips`,
  `.toolbar-actions` (margin-left:auto) sit on one row — same as today.
- Wrapped: `row-count` + `.toolbar-actions` (both order 0) stay on line 1;
  `.toolbar-chips` (order 1, basis 100%) wraps to line 2.
- The existing `.sort-strip` / `.filter-strip` `overflow-x: auto` provides the
  "still doesn't fit → scroll" tier.
- The toolbar's `gap: 8px` becomes the row gap between the two lines.
  `.browser-root`'s `grid-template-rows: auto 1fr auto` lets the toolbar grow
  taller while the grid (1fr) shrinks — no overlap.

## Rejected alternatives

- **Always own row (pure CSS).** Predictable and trivial, but spends a second
  row even when one would have fit. User chose the conditional model.
- **ResizeObserver + hidden ghost measuring row.** Detect overflow via
  `scrollWidth > clientWidth`, but keep an offscreen single-row clone to decide
  whether unwrapping would fit. Works, but the ghost element is extra DOM that
  can desync from the real toolbar.
- **CSS container queries.** See Non-goals — trigger is content size, not
  container size.

## Testing

- **Unit (`bun test`)** — `should_wrap` boundary cases: fits exactly;
  overflows by 1px; hysteresis (stays wrapped within the band); empty chips
  (`chips = 0`) never wraps.
- **Manual (`verify` workflow)** — narrow the panel with several sort+filter
  chips and confirm the chips drop to row 2 with the buttons pinned top-right;
  widen and confirm a clean unwrap with no flicker; pile on chips and confirm
  row-2 horizontal scroll within the strips.

## Scope

- New: `client/src/data-browser/webview/use-toolbar-wrap.ts` (~50 lines: hook +
  pure `should_wrap`).
- Edit: `app.tsx` (add `.toolbar-chips` wrapper, refs, `is-wrapped` class via
  the hook).
- Edit: `styles.css` (the rules above).
- Test: unit tests for `should_wrap`.

No changes to sort/filter logic, popovers, or the strip components themselves.

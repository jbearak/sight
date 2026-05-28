/* eslint-env node, mocha */
/**
 * Real-layout test for the data-browser toolbar chip wrapping.
 *
 * Runs inside a real VS Code webview (real Chromium, real flexbox). The
 * harness mounts the production toolbar markup with the real
 * `use_toolbar_wrap` hook and `styles.css`, pins its width, and posts its
 * measured layout back here. These cases assert the geometry the fast unit
 * tests (tests/unit/data-browser/toolbar-wrap.test.ts) cannot reach: that
 * the real CSS actually wraps, the real ResizeObserver fires, and the hook
 * toggles `is-wrapped` in a real browser.
 *
 * See docs/superpowers/specs/2026-05-27-toolbar-wrap-webview-test-design.md.
 */

const assert = require('assert');
const { open_harness_panel } = require('./harness-panel');

const ROW_TEXT = '74 rows';

// Distinct widths so the hook's clientWidth-change guard always fires
// between transitions.
const WIDE_PX = 1200;
const NARROW_PX = 400;
const MANY_CHIPS = 10;

function state(overrides) {
    return Object.assign(
        {
            type: 'test:setState',
            sort_chip_count: 0,
            filter_chip_count: 0,
            hidden_col_count: 0,
            row_count_text: ROW_TEXT,
        },
        overrides
    );
}

// ----- Invariant assertions (§4.5 of the design spec) -----

function assert_single_row(snap, { chips_present }) {
    assert.strictEqual(
        snap.is_wrapped,
        false,
        'expected is_wrapped === false'
    );
    assert.ok(
        snap.toolbar_flex_wrap === 'nowrap'
            || snap.toolbar_flex_wrap === '',
        `expected flex-wrap nowrap/'' got "${snap.toolbar_flex_wrap}"`
    );
    assert.notStrictEqual(
        snap.chips_order,
        '1',
        'chips must not be ordered onto row 2'
    );
    if (chips_present) {
        assert.ok(
            Math.abs(snap.chips_rect.top - snap.actions_rect.top) < 4,
            'chips should share the actions row '
                + `(chips.top=${snap.chips_rect.top}, `
                + `actions.top=${snap.actions_rect.top})`
        );
    } else {
        // An empty chip group is a zero-height, vertically-centered flex
        // item, so its top won't match the taller actions box; the
        // meaningful single-row invariant is just that it is not on a row
        // below the actions.
        assert.ok(
            snap.chips_rect.top < snap.actions_rect.bottom,
            'empty chips should not be on a row below actions '
                + `(chips.top=${snap.chips_rect.top}, `
                + `actions.bottom=${snap.actions_rect.bottom})`
        );
    }
}

function assert_wrapped(snap) {
    assert.strictEqual(
        snap.is_wrapped,
        true,
        'expected is_wrapped === true'
    );
    assert.strictEqual(
        snap.toolbar_flex_wrap,
        'wrap',
        `expected flex-wrap wrap got "${snap.toolbar_flex_wrap}"`
    );
    assert.strictEqual(
        snap.chips_order,
        '1',
        'wrapped chips should have order 1'
    );
    assert.strictEqual(
        snap.chips_flex_basis,
        '100%',
        `expected chips flex-basis 100% got "${snap.chips_flex_basis}"`
    );
    assert.ok(
        snap.chips_rect.top > snap.actions_rect.bottom,
        'wrapped chips should sit below the actions row '
            + `(chips.top=${snap.chips_rect.top}, `
            + `actions.bottom=${snap.actions_rect.bottom})`
    );
}

function assert_actions_pinned_right(snap) {
    assert.ok(
        snap.actions_rect.right >= snap.toolbar_rect.right - 12,
        'actions should stay pinned to the right edge '
            + `(actions.right=${snap.actions_rect.right}, `
            + `toolbar.right=${snap.toolbar_rect.right})`
    );
}

function assert_actions_on_top_row(snap) {
    // The row-count text is shorter than the action buttons and both are
    // vertically centered, so their tops differ by the centering offset
    // (~half the height delta), not zero. The robust "same top row"
    // invariant is that their vertical extents overlap — which still fails
    // (correctly) if the actions were pushed down onto the wrapped chip
    // row, since that row does not overlap the row count.
    const vertically_overlaps =
        snap.actions_rect.top < snap.lead_rect.bottom
        && snap.lead_rect.top < snap.actions_rect.bottom;
    assert.ok(
        vertically_overlaps,
        'actions should remain on the top row with the row count '
            + `(actions=[${snap.actions_rect.top}, `
            + `${snap.actions_rect.bottom}], `
            + `lead=[${snap.lead_rect.top}, ${snap.lead_rect.bottom}])`
    );
}

// Mirror the hook's needed_px so the columns-badge and hysteresis cases can
// self-calibrate a width at the wrap boundary from a measured single-row
// snapshot (taken wide enough that no region overflows).
const TOOLBAR_GAP_PX = 8;
function measure_needed_px(snap) {
    const the_widths = [
        snap.lead_rect.width,
        snap.chips_rect.width,
        snap.actions_rect.width,
    ].filter(my_width => my_width > 0);
    const content_px = the_widths.reduce(
        (sum_px, my_width) => sum_px + my_width,
        0
    );
    const gaps_px = Math.max(0, the_widths.length - 1) * TOOLBAR_GAP_PX;
    return content_px + gaps_px;
}

describe('data-browser toolbar chip wrapping (real layout)', function () {
    this.timeout(60000);

    let harness;

    before(async () => {
        harness = open_harness_panel();
        await harness.wait_for_ready();
    });

    after(async () => {
        if (harness) {
            await harness.dispose();
        }
    });

    beforeEach(async () => {
        await harness.reset();
    });

    it('no chips, wide → single row', async () => {
        await harness.apply({ type: 'test:setWidth', width_px: WIDE_PX });
        const snap = await harness.apply(
            state({}),
            my_snap => my_snap.is_wrapped === false
        );
        assert_single_row(snap, { chips_present: false });
        assert_actions_pinned_right(snap);
    });

    it('many sort chips, narrow → wrapped, buttons pinned right', async () => {
        await harness.apply({ type: 'test:setWidth', width_px: NARROW_PX });
        const snap = await harness.apply(
            state({ sort_chip_count: MANY_CHIPS }),
            my_snap => my_snap.is_wrapped === true
        );
        assert_wrapped(snap);
        assert_actions_pinned_right(snap);
        assert_actions_on_top_row(snap);
    });

    it('resizes wide → unwraps, then narrow → re-wraps', async () => {
        // Start wrapped at a narrow width with chips present.
        await harness.apply({ type: 'test:setWidth', width_px: NARROW_PX });
        const wrapped = await harness.apply(
            state({ sort_chip_count: MANY_CHIPS }),
            my_snap => my_snap.is_wrapped === true
        );
        assert_wrapped(wrapped);

        // Widen: chips fit again, so the toolbar unwraps and chips return
        // to the actions row.
        const unwrapped = await harness.apply(
            { type: 'test:setWidth', width_px: WIDE_PX },
            my_snap => my_snap.is_wrapped === false
        );
        assert_single_row(unwrapped, { chips_present: true });
        assert_actions_pinned_right(unwrapped);

        // Re-narrow to NARROW_PX (distinct from the preceding WIDE_PX, so
        // the hook's clientWidth-change guard fires): re-wraps.
        const rewrapped = await harness.apply(
            { type: 'test:setWidth', width_px: NARROW_PX },
            my_snap => my_snap.is_wrapped === true
        );
        assert_wrapped(rewrapped);
    });

    it('many filter chips only, narrow → wrapped', async () => {
        await harness.apply({ type: 'test:setWidth', width_px: NARROW_PX });
        const snap = await harness.apply(
            state({ filter_chip_count: MANY_CHIPS }),
            my_snap => my_snap.is_wrapped === true
        );
        assert_wrapped(snap);
        assert_actions_pinned_right(snap);
        assert_actions_on_top_row(snap);
        assert.ok(
            snap.filter_strip_scroll_width > 0,
            'filter strip should be present and measured'
        );
    });

    it('overflowing chips on row 2 expose the scroll tier', async () => {
        // Many sort chips (only) at a mid width: even on its own full-width
        // row the strip overflows, so the strip is horizontally scrollable.
        const MID_PX = 520;
        const OVERFLOW_CHIPS = 24;
        await harness.apply({ type: 'test:setWidth', width_px: MID_PX });
        const snap = await harness.apply(
            state({ sort_chip_count: OVERFLOW_CHIPS }),
            my_snap => my_snap.is_wrapped === true
        );
        assert_wrapped(snap);
        assert.ok(
            snap.sort_strip_scroll_width > snap.chips_client_width,
            'sort strip content should overflow the row (scrollable) '
                + `(sort_strip_scroll_width=${snap.sort_strip_scroll_width}, `
                + `chips_client_width=${snap.chips_client_width})`
        );
    });

    it('Columns badge widens actions and can flip the wrap (regression)', async () => {
        // The bug fixed in 08879b7: the Columns count badge widens the
        // action buttons without changing the toolbar width, so the wrap
        // must re-measure on the hidden_columns.size content-dep.
        const CHIPS = 6;
        const BADGE = 999;

        // Measure intrinsic widths at a width wide enough that nothing
        // wraps or overflows, with and without the badge.
        await harness.apply({ type: 'test:setWidth', width_px: 2000 });
        const no_badge = await harness.apply(
            state({ sort_chip_count: CHIPS, hidden_col_count: 0 }),
            my_snap => my_snap.is_wrapped === false
        );
        const with_badge = await harness.apply(
            state({ sort_chip_count: CHIPS, hidden_col_count: BADGE }),
            my_snap => my_snap.is_wrapped === false
        );

        // (a) The badge makes the actions region wider.
        assert.ok(
            with_badge.actions_rect.width > no_badge.actions_rect.width,
            'Columns badge should widen the actions region '
                + `(no_badge=${no_badge.actions_rect.width}, `
                + `with_badge=${with_badge.actions_rect.width})`
        );

        // (b) Tune the width to the boundary: between the without-badge and
        // with-badge needed widths, so the badge alone flips the decision.
        const needed_no_badge = measure_needed_px(no_badge);
        const needed_with_badge = measure_needed_px(with_badge);
        const boundary_px = Math.round(
            (needed_no_badge + needed_with_badge) / 2
        );

        await harness.reset();
        await harness.apply({
            type: 'test:setWidth',
            width_px: boundary_px,
        });
        const single = await harness.apply(
            state({ sort_chip_count: CHIPS, hidden_col_count: 0 }),
            my_snap => my_snap.is_wrapped === false
        );
        assert_single_row(single, { chips_present: true });

        // Adding the badge (a content-dep change, NOT a width change) must
        // push it over the boundary and wrap.
        const wrapped = await harness.apply(
            state({ sort_chip_count: CHIPS, hidden_col_count: BADGE }),
            my_snap => my_snap.is_wrapped === true
        );
        assert_wrapped(wrapped);
    });

    it('does not flap within the hysteresis band', async () => {
        const CHIPS = MANY_CHIPS;

        // Measure the wrap boundary from a wide single-row snapshot.
        await harness.apply({ type: 'test:setWidth', width_px: 2000 });
        const wide = await harness.apply(
            state({ sort_chip_count: CHIPS }),
            my_snap => my_snap.is_wrapped === false
        );
        const needed_px = measure_needed_px(wide);

        // Comfortably wide → single-row.
        const single = await harness.apply(
            { type: 'test:setWidth', width_px: needed_px + 60 },
            my_snap => my_snap.is_wrapped === false
        );
        assert_single_row(single, { chips_present: true });

        // Just under needed → wraps.
        const wrapped = await harness.apply(
            { type: 'test:setWidth', width_px: needed_px - 20 },
            my_snap => my_snap.is_wrapped === true
        );
        assert_wrapped(wrapped);

        // Back up but still inside the 8px hysteresis band (unwrap only
        // happens once width exceeds needed + 8) → stays wrapped. Poll for a
        // settled snapshot rather than accepting the first one: if the band
        // logic were broken and it unwrapped, the is_wrapped===true predicate
        // never matches and the returned (is_wrapped===false) snapshot fails
        // the assertion below.
        const still_wrapped = await harness.apply(
            { type: 'test:setWidth', width_px: needed_px + 4 },
            my_snap => my_snap.is_wrapped === true,
            3000
        );
        assert.strictEqual(
            still_wrapped.is_wrapped,
            true,
            'should stay wrapped within the hysteresis band '
                + `(needed≈${needed_px}, width=${needed_px + 4})`
        );

        // Clearly past the band → unwraps.
        const unwrapped = await harness.apply(
            { type: 'test:setWidth', width_px: needed_px + 60 },
            my_snap => my_snap.is_wrapped === false
        );
        assert_single_row(unwrapped, { chips_present: true });
    });
});

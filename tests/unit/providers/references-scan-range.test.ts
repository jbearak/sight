/**
 * Regression test for the find-references scan-cutoff off-by-one.
 *
 * The `ReferenceScanRange` contract (src/scope-resolver/visible-symbols.ts)
 * specifies that when `scan_through_line` is set, a URI includes matches whose
 * `range.start.line <= scan_through_line`. Before the fix, `find_definitions`
 * used `>= cutoff` (excluding the cutoff line itself), while `collect_references`
 * correctly used `> cutoff`. The two gating paths now route through a shared
 * helper, which this file pins to the spec.
 *
 * The feature that produces a cutoff is dormant today (every `classify_site`
 * branch in `collect_visible_reference_uris` currently returns `{ include }`
 * with no `scan_through_line`). These tests guard the helper so that when a
 * future change re-enables cutoffs, the boundary behaves per spec.
 */

import { describe, it, expect } from 'bun:test';
import { line_within_scan_range } from '../../../src/providers/references';

describe('line_within_scan_range — find-references cutoff boundary', () => {
    it('returns true when no cutoff is set (full scan)', () => {
        expect(line_within_scan_range(0, {})).toBe(true);
        expect(line_within_scan_range(999, {})).toBe(true);
    });

    it('includes lines strictly before the cutoff', () => {
        expect(line_within_scan_range(4, { scan_through_line: 5 })).toBe(true);
        expect(line_within_scan_range(0, { scan_through_line: 5 })).toBe(true);
    });

    it('includes the cutoff line itself (spec: line <= scan_through_line)', () => {
        expect(line_within_scan_range(5, { scan_through_line: 5 })).toBe(true);
        expect(line_within_scan_range(0, { scan_through_line: 0 })).toBe(true);
    });

    it('excludes lines strictly after the cutoff', () => {
        expect(line_within_scan_range(6, { scan_through_line: 5 })).toBe(false);
        expect(line_within_scan_range(999, { scan_through_line: 5 })).toBe(false);
    });
});

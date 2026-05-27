import { describe, expect, it } from 'bun:test';
import { compute_histogram } from '../../../client/src/data-browser/histograms';

describe('data-browser compute_histogram', () => {
    it('returns [] when there are no finite values', () => {
        expect(compute_histogram([])).toEqual([]);
        expect(compute_histogram([NaN, Infinity, -Infinity])).toEqual([]);
    });

    it('collapses a single distinct value to one bin', () => {
        expect(compute_histogram([5, 5, 5])).toEqual([
            { lo: 5, hi: 5, count: 3 },
        ]);
    });

    it('builds 50 uniform bins spanning min..max', () => {
        const values: number[] = [];
        for (let i = 0; i <= 100; i++) values.push(i);
        const bins = compute_histogram(values);
        expect(bins.length).toBe(50);
        expect(bins[0].lo).toBe(0);
        expect(bins[49].hi).toBe(100);
        const total = bins.reduce((a, b) => a + b.count, 0);
        expect(total).toBe(101);
    });

    it('excludes NaN and infinities from counts and range', () => {
        const bins = compute_histogram([0, NaN, 10, Infinity]);
        const total = bins.reduce((a, b) => a + b.count, 0);
        expect(total).toBe(2);
        expect(bins[0].lo).toBe(0);
        expect(bins[bins.length - 1].hi).toBe(10);
    });

    it('places the maximum value in the last bin', () => {
        const bins = compute_histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        // The exact max (10) must land in the final bin, not overflow.
        expect(bins[bins.length - 1].count).toBeGreaterThanOrEqual(1);
    });
});

import { describe, expect, it } from 'bun:test';
import { build_cell_value } from '../../../client/src/data-browser/cell-format';
import { make_missing_value } from '../../../src/dta-parser';
import {
    describe_status_summary,
    describe_visible_rows,
    get_cell_display_value,
    get_needed_page_starts,
} from '../../../client/src/data-browser/webview/grid-model';

describe('build_cell_value', () => {
    it('preserves exact missing markers', () => {
        const my_cell = build_cell_value(
            make_missing_value('.a'),
            {
                type: 'double',
                format: '%9.0g',
                value_label_name: '',
            }
        );

        expect(my_cell.raw).toBeNull();
        expect(my_cell.missing_type).toBe('.a');
        expect(my_cell.raw_display).toBe('.a');
        expect(my_cell.formatted_display).toBe('.a');
    });

    it('preserves raw, formatted, and labeled views', () => {
        const my_table = new Map<number, string>([
            [1, 'Foreign'],
        ]);
        const my_cell = build_cell_value(
            1,
            {
                type: 'byte',
                format: '%9.0g',
                value_label_name: 'foreign_lbl',
            },
            my_table
        );

        expect(my_cell.raw).toBe(1);
        expect(my_cell.raw_display).toBe('1');
        expect(my_cell.formatted_display).toBe('1');
        expect(my_cell.label_display).toBe('Foreign');
    });
});

describe('grid-model helpers', () => {
    it('picks the visible display in the correct precedence order', () => {
        expect(get_cell_display_value({
            raw: null,
            raw_display: '.z',
            formatted_display: '.z',
            missing_type: '.z',
        }, true, true)).toBe('.z');

        expect(get_cell_display_value({
            raw: 1,
            raw_display: '1',
            formatted_display: '1.00',
            label_display: 'Foreign',
        }, true, true)).toBe('Foreign');

        expect(get_cell_display_value({
            raw: 1,
            raw_display: '1',
            formatted_display: '1.00',
            label_display: 'Foreign',
        }, false, true)).toBe('1.00');

        expect(get_cell_display_value({
            raw: 1,
            raw_display: '1',
            formatted_display: '1.00',
            label_display: 'Foreign',
        }, false, false)).toBe('1');
    });

    it('formats visible row counts', () => {
        expect(describe_visible_rows(1000, 0, 50))
            .toBe('Showing 1-50 of 1,000');
    });

    it('builds subset-aware status summaries', () => {
        expect(describe_status_summary({
            type: 'metadata',
            nobs: 10,
            variables: [],
            dataset_label: 'Cars',
            name: 'auto',
            source: '/tmp/auto.dta',
            subsetted: true,
            varlist: ['make', 'price'],
            if_condition: 'foreign == 1',
            in_condition: '1/10',
        })).toContain('Subsetted');
    });

    it('normalizes row requests to page starts', () => {
        expect(get_needed_page_starts(10, 450))
            .toEqual([0, 200, 400]);
    });
});

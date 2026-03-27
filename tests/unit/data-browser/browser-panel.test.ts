import { describe, expect, it } from 'bun:test';
import { build_cell_value } from '../../../client/src/data-browser/cell-format';
import { make_missing_value } from '../../../src/dta-parser';
import {
    build_grid_columns,
    clamp_column_width,
    collect_sampled_value_width_hints,
    compute_default_column_width,
    compute_header_width_px,
    compute_sampled_value_width_px,
    describe_status_summary,
    describe_visible_rows,
    get_cell_display_value,
    get_variable_header_subtitle,
    get_variable_header_tooltip,
    get_needed_page_starts,
    MAX_COLUMN_WIDTH_PX,
    merge_persisted_and_default_widths,
    MIN_COLUMN_WIDTH_PX,
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

    it('exposes variable labels for header subtitles', () => {
        expect(get_variable_header_subtitle({
            name: 'foreign',
            type: 'byte',
            format: '%9.0g',
            label: 'Car origin',
            has_value_labels: true,
        })).toBe('Car origin');

        expect(build_grid_columns({
            type: 'metadata',
            nobs: 1,
            variables: [{
                name: 'foreign',
                type: 'byte',
                format: '%9.0g',
                label: 'Car origin',
                has_value_labels: true,
            }],
            dataset_label: '',
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
        }, {})[0]?.variable_label).toBe('Car origin');

        expect(get_variable_header_tooltip({
            name: 'foreign',
            type: 'byte',
            format: '%9.0g',
            label: 'Car origin',
            has_value_labels: true,
        })).toBe('Car origin');
    });

    it('builds subset-aware status summaries', () => {
        expect(describe_status_summary({
            type: 'metadata',
            nobs: 10,
            variables: [],
            dataset_label: 'Cars',
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
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

    it('builds explicit widths and prefers persisted widths by variable name', () => {
        const my_columns = build_grid_columns({
            type: 'metadata',
            nobs: 1,
            variables: [{
                name: 'foreign',
                type: 'byte',
                format: '%9.0g',
                label: 'Car origin',
                has_value_labels: true,
            }],
            dataset_label: '',
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
        }, {
            foreign: 222,
        });

        expect(my_columns[0]?.width).toBe(222);
    });

    it('computes header widths from the longer of name or label', () => {
        expect(compute_header_width_px({
            name: 'x',
            type: 'str10',
            format: '%9s',
            label: 'Long descriptive label',
            has_value_labels: false,
        })).toBeGreaterThan(compute_header_width_px({
            name: 'x',
            type: 'str10',
            format: '%9s',
            label: '',
            has_value_labels: false,
        }));
    });

    it('computes sampled widths from the longest sample and clamps them', () => {
        expect(compute_sampled_value_width_px({
            name: 'make',
            type: 'str18',
            format: '%18s',
            label: '',
            has_value_labels: false,
        }, ['short', 'significantly longer sample'])).toBeGreaterThan(
            compute_sampled_value_width_px({
                name: 'make',
                type: 'str18',
                format: '%18s',
                label: '',
                has_value_labels: false,
            }, ['short'])
        );

        expect(compute_sampled_value_width_px({
            name: 'make',
            type: 'strL',
            format: '%9s',
            label: '',
            has_value_labels: false,
        }, ['x'.repeat(400)])).toBe(MAX_COLUMN_WIDTH_PX);
    });

    it('computes default widths from sampled labels and formats', () => {
        const my_metadata = {
            type: 'metadata' as const,
            nobs: 2,
            variables: [{
                name: 'foreign',
                type: 'byte',
                format: '%9.0g',
                label: 'Car origin',
                has_value_labels: true,
            }],
            dataset_label: '',
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
        };

        const my_pages = new Map([
            [0, [[{
                raw: 1,
                raw_display: '1',
                formatted_display: '1',
                label_display: 'Domestic/Imported',
            }], [{
                raw: 0,
                raw_display: '0',
                formatted_display: '0',
                label_display: 'Domestic',
            }]]],
        ]);

        const my_label_widths =
            collect_sampled_value_width_hints(
                my_metadata,
                my_pages,
                true,
                true
            );
        const my_raw_widths =
            collect_sampled_value_width_hints(
                my_metadata,
                my_pages,
                false,
                false
            );

        expect(my_label_widths.foreign)
            .toBeGreaterThan(my_raw_widths.foreign);
    });

    it('merges persisted widths over sampled defaults and falls back to computed defaults', () => {
        const my_metadata = {
            type: 'metadata' as const,
            nobs: 1,
            variables: [{
                name: 'make',
                type: 'str18',
                format: '%18s',
                label: '',
                has_value_labels: false,
            }, {
                name: 'price',
                type: 'double',
                format: '%9.0g',
                label: '',
                has_value_labels: false,
            }],
            dataset_label: '',
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
        };

        const my_merged = merge_persisted_and_default_widths(
            my_metadata,
            { price: 180 },
            { make: 140 }
        );

        expect(my_merged.price).toBe(180);
        expect(my_merged.make).toBe(140);
        expect(my_merged.make).toBeGreaterThanOrEqual(
            MIN_COLUMN_WIDTH_PX
        );
    });

    it('clamps invalid widths to the supported range', () => {
        expect(clamp_column_width(10)).toBe(MIN_COLUMN_WIDTH_PX);
        expect(clamp_column_width(1000)).toBe(MAX_COLUMN_WIDTH_PX);
        expect(clamp_column_width(undefined)).toBe(150);
    });

    it('falls back to header widths when no samples are available', () => {
        const my_variable = {
            name: 'long_variable_name',
            type: 'str10',
            format: '%9s',
            label: '',
            has_value_labels: false,
        };

        expect(compute_default_column_width(my_variable, []))
            .toBe(compute_header_width_px(my_variable));
    });
});

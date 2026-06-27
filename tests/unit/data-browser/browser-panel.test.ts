import { describe, expect, it, mock } from 'bun:test';
import { make_missing_value } from '@jbearak/dta-parser';
import { build_cell_value } from '../../../client/src/data-browser/cell-format';
import {
    build_grid_columns,
    clamp_column_width,
    collect_sampled_value_width_hints,
    compute_default_column_width,
    compute_header_width_px,
    compute_sampled_value_width_px,
    describe_browser_row_count,
    describe_restore_message,
    describe_subset,
    describe_toolbar_row_count,
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

    it('looks up value label for extended missing values', () => {
        // 2147483622 = 0x7fffffe6 = Stata's int encoding for .a
        const my_table = new Map<number, string>([
            [2147483622, 'Not applicable'],
        ]);
        const my_cell = build_cell_value(
            make_missing_value('.a'),
            {
                type: 'double',
                format: '%9.0g',
                value_label_name: 'reason_lbl',
            },
            my_table
        );

        expect(my_cell.raw).toBeNull();
        expect(my_cell.missing_type).toBe('.a');
        expect(my_cell.raw_display).toBe('.a');
        expect(my_cell.label_display).toBe('Not applicable');
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

        // labeled missing shows label when show_labels=true
        expect(get_cell_display_value({
            raw: null,
            raw_display: '.a',
            formatted_display: '.a',
            label_display: 'Not applicable',
            missing_type: '.a',
        }, true, true)).toBe('Not applicable');

        // labeled missing shows missing type when show_labels=false
        expect(get_cell_display_value({
            raw: null,
            raw_display: '.a',
            formatted_display: '.a',
            label_display: 'Not applicable',
            missing_type: '.a',
        }, false, true)).toBe('.a');

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

    it('routes missing metadata to the loading row-count label', () => {
        expect(describe_browser_row_count(null, undefined, 0, 0))
            .toBe('Loading…');
    });

    it('suppresses the toolbar row count while a restore banner shows', () => {
        // The restore banner already explains the wait, so the bare
        // "Loading…" must not stack above it (PullFrog finding).
        expect(describe_toolbar_row_count(null, undefined, 0, 0, true))
            .toBe('');
        // No restore in flight: fall through to the normal label.
        expect(describe_toolbar_row_count(null, undefined, 0, 0, false))
            .toBe('Loading…');
        expect(describe_toolbar_row_count(
            { nobs: 1000 } as never, undefined, 0, 50, true
        )).toBe('');
    });

    it('words the restore message by which prefs apply', () => {
        expect(describe_restore_message(true, true))
            .toBe('Applying your saved sort & filter…');
        expect(describe_restore_message(true, false))
            .toBe('Applying your saved sort…');
        expect(describe_restore_message(false, true))
            .toBe('Applying your saved filter…');
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

    it('returns null when metadata is missing or not subsetted', () => {
        expect(describe_subset(null)).toBeNull();
        expect(describe_subset({
            type: 'metadata',
            nobs: 10,
            variables: [],
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
            schema_hash: 'h',
            subsetted: false,
        })).toBeNull();
    });

    it('describes the subset conditions when subsetted', () => {
        expect(describe_subset({
            type: 'metadata',
            nobs: 10,
            variables: [],
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
            schema_hash: 'h',
            subsetted: true,
            varlist: ['make', 'price'],
            if_condition: 'foreign == 1',
            in_condition: '1/10',
        })).toBe(
            'Subsetted (vars: make, price; if foreign == 1; in 1/10)'
        );
    });

    it('falls back to a bare label when subsetted with no conditions', () => {
        expect(describe_subset({
            type: 'metadata',
            nobs: 10,
            variables: [],
            name: 'auto',
            dataset_key: '/tmp/auto.dta',
            schema_hash: 'h',
            subsetted: true,
        })).toBe('Subsetted');
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

mock.module('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, default_value: unknown) => default_value,
        }),
    },
    window: {
        showErrorMessage: () => undefined,
    },
    env: {
        clipboard: {
            writeText: async () => undefined,
        },
    },
}));

type PostedMessage = {
    type: string;
    col_index?: number;
    bins?: unknown[];
};

type HistogramPanelHarness = {
    panel_like: any;
    posted: PostedMessage[];
    read_count: () => number;
};

async function make_histogram_panel(
    variable: {
        name: string;
        type: string;
        format: string;
        value_label_name: string;
    },
    values_or_error: number[] | Error,
    value_label_tables: Map<string, Map<number, string>> = new Map()
): Promise<HistogramPanelHarness> {
    const { DataBrowserPanel } = await import(
        '../../../client/src/data-browser/browser-panel'
    );
    const posted: PostedMessage[] = [];
    let read_count = 0;
    const panel_like: any = Object.create(DataBrowserPanel.prototype);
    panel_like.dta_file = {
        nvar: 1,
        variables: [variable],
        value_label_tables,
    };
    panel_like.histogram_cache = new Map();
    panel_like.panel = {
        webview: {
            postMessage: (message: PostedMessage) => {
                posted.push(message);
                return true;
            },
        },
    };
    panel_like.read_full_column = async () => {
        read_count += 1;
        if (values_or_error instanceof Error) {
            throw values_or_error;
        }
        return values_or_error;
    };

    return {
        panel_like,
        posted,
        read_count: () => read_count,
    };
}

describe('DataBrowserPanel histogram requests', () => {
    it('lazily computes and caches a numeric histogram on request', async () => {
        const { panel_like, posted, read_count } =
            await make_histogram_panel({
                name: 'price',
                type: 'double',
                format: '%9.0g',
                value_label_name: '',
            }, [1, 2, 3, 4, 5]);

        await panel_like.handle_request_histogram({
            type: 'requestHistogram',
            col_index: 0,
        });
        await panel_like.handle_request_histogram({
            type: 'requestHistogram',
            col_index: 0,
        });

        expect(read_count()).toBe(1);
        expect(posted.length).toBe(2);
        expect(posted[0]?.type).toBe('histogramData');
        expect(posted[0]?.col_index).toBe(0);
        expect(posted[0]?.bins?.length).toBe(50);
        expect(posted[0]?.bins).toEqual(posted[1]?.bins);
        expect(
            (posted[0]?.bins ?? [])
                .reduce((sum, bin: any) => sum + bin.count, 0)
        ).toBe(5);
    });

    it('allows labelled numeric columns to use histogram brushes', async () => {
        const the_labels = new Map<string, Map<number, string>>([
            ['origin', new Map([
                [0, 'Domestic'],
                [1, 'Foreign'],
            ])],
        ]);
        const { panel_like, posted, read_count } =
            await make_histogram_panel({
                name: 'foreign',
                type: 'byte',
                format: '%9.0g',
                value_label_name: 'origin',
            }, [0, 1, 1], the_labels);

        await panel_like.handle_request_histogram({
            type: 'requestHistogram',
            col_index: 0,
        });

        expect(read_count()).toBe(1);
        expect(posted[0]?.bins?.length).toBe(50);
        expect(
            (posted[0]?.bins ?? [])
                .reduce((sum, bin: any) => sum + bin.count, 0)
        ).toBe(3);
    });

    it('replies with empty bins for out-of-range histogram requests', async () => {
        const { panel_like, posted, read_count } =
            await make_histogram_panel({
                name: 'price',
                type: 'double',
                format: '%9.0g',
                value_label_name: '',
            }, [1, 2, 3]);

        await panel_like.handle_request_histogram({
            type: 'requestHistogram',
            col_index: 99,
        });

        expect(posted).toEqual([{
            type: 'histogramData',
            col_index: 99,
            bins: [],
        }]);
        expect(read_count()).toBe(0);
    });

    it('does not scan non-numeric columns for histogram requests', async () => {
        const { panel_like, posted, read_count } =
            await make_histogram_panel({
                name: 'make',
                type: 'str18',
                format: '%18s',
                value_label_name: '',
            }, [1, 2, 3]);

        await panel_like.handle_request_histogram({
            type: 'requestHistogram',
            col_index: 0,
        });

        expect(read_count()).toBe(0);
        expect(posted).toEqual([{
            type: 'histogramData',
            col_index: 0,
            bins: [],
        }]);
    });

    it('settles scan failures with an empty histogram reply', async () => {
        const { panel_like, posted } = await make_histogram_panel({
            name: 'price',
            type: 'double',
            format: '%9.0g',
            value_label_name: '',
        }, new Error('decode failed'));

        await expect(panel_like.handle_request_histogram({
            type: 'requestHistogram',
            col_index: 0,
        })).resolves.toBeUndefined();

        expect(posted).toEqual([{
            type: 'histogramData',
            col_index: 0,
            bins: [],
        }]);
    });
});

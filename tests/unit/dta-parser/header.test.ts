import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../../src/dta-parser/header';
import type { DtaMetadata } from '../../../src/dta-parser/types';

// -----------------------------------------------------------
// .dta header and metadata parsing
// -----------------------------------------------------------

const FIXTURE_DIR = path.join(
    __dirname, '..', '..', 'fixtures', 'dta'
);

function load_fixture(name: string): ArrayBuffer {
    const my_buf = fs.readFileSync(
        path.join(FIXTURE_DIR, name)
    );
    return my_buf.buffer.slice(
        my_buf.byteOffset,
        my_buf.byteOffset + my_buf.byteLength
    );
}

// Known facts about auto.dta
const AUTO_VARNAMES = [
    'make', 'price', 'mpg', 'rep78', 'headroom',
    'trunk', 'weight', 'length', 'turn',
    'displacement', 'gear_ratio', 'foreign',
];

describe('parse_metadata', () => {

    // ----- v118 tests (primary) -----

    describe('v118 auto.dta', () => {
        let meta: DtaMetadata;

        // Parse once for all v118 tests
        meta = parse_metadata(load_fixture('auto_v118.dta'));

        it('parses v118 header fields', () => {
            expect(meta.format_version).toBe(118);
            expect(meta.byte_order).toBe('LSF');
            expect(meta.nobs).toBe(74);
            expect(meta.nvar).toBe(12);
        });

        it('reads variable names from auto.dta', () => {
            const the_names = meta.variables.map(
                v => v.name
            );
            expect(the_names).toEqual(AUTO_VARNAMES);
        });

        it('reads variable types correctly', () => {
            // make is a string type (str18)
            const my_make = meta.variables[0];
            expect(my_make.type).toBe('str18');
            expect(my_make.byte_width).toBe(18);

            // headroom is float
            const my_headroom = meta.variables[4];
            expect(my_headroom.type).toBe('float');
            expect(my_headroom.byte_width).toBe(4);

            // gear_ratio is float
            const my_gear = meta.variables[10];
            expect(my_gear.type).toBe('float');
            expect(my_gear.byte_width).toBe(4);

            // foreign is byte
            const my_foreign = meta.variables[11];
            expect(my_foreign.type).toBe('byte');
            expect(my_foreign.byte_width).toBe(1);
        });

        it('reads display formats', () => {
            // make: string format
            expect(meta.variables[0].format).toMatch(
                /^%-?\d+s$/
            );

            // price: numeric format (e.g. %8.0gc)
            expect(meta.variables[1].format).toMatch(
                /^%\d+\.\d+[gfc]{1,2}$/
            );
        });

        it('reads variable labels', () => {
            expect(meta.variables[0].label).toBe(
                'Make and model'
            );
            expect(meta.variables[1].label).toBe('Price');
            expect(meta.variables[2].label).toBe(
                'Mileage (mpg)'
            );
        });

        it('reads value label names', () => {
            // foreign has value label "origin"
            const my_foreign = meta.variables[11];
            expect(my_foreign.value_label_name).toBe(
                'origin'
            );

            // make has no value label
            expect(meta.variables[0].value_label_name).toBe(
                ''
            );
        });

        it('computes obs_length as sum of byte widths', () => {
            const my_sum = meta.variables.reduce(
                (acc, v) => acc + v.byte_width, 0
            );
            expect(meta.obs_length).toBe(my_sum);
        });

        it('computes correct byte offsets per variable', () => {
            // First variable starts at 0
            expect(meta.variables[0].byte_offset).toBe(0);

            // Each subsequent offset equals cumulative width
            let my_running_offset = 0;
            for (const my_var of meta.variables) {
                expect(my_var.byte_offset).toBe(
                    my_running_offset
                );
                my_running_offset += my_var.byte_width;
            }
        });

        it('has valid section offsets', () => {
            const my_offsets = meta.section_offsets;
            // Offsets should be monotonically increasing
            expect(my_offsets.stata_data).toBe(0);
            expect(my_offsets.map).toBeGreaterThan(0);
            expect(my_offsets.variable_types).toBeGreaterThan(
                my_offsets.map
            );
            expect(my_offsets.varnames).toBeGreaterThan(
                my_offsets.variable_types
            );
            expect(my_offsets.data).toBeGreaterThan(
                my_offsets.variable_labels
            );
            expect(my_offsets.end_of_file).toBeGreaterThan(
                my_offsets.stata_data_close
            );
        });
    });

    // ----- v117 tests -----

    describe('v117 auto.dta', () => {
        it('parses v117 format', () => {
            const my_meta = parse_metadata(
                load_fixture('auto_v117.dta')
            );
            expect(my_meta.format_version).toBe(117);
            expect(my_meta.nobs).toBe(74);
            expect(my_meta.nvar).toBe(12);

            const the_names = my_meta.variables.map(
                v => v.name
            );
            expect(the_names).toEqual(AUTO_VARNAMES);
        });

        it('reads type codes correctly', () => {
            const my_meta = parse_metadata(
                load_fixture('auto_v117.dta')
            );

            // foreign is byte (Stata 16+ writes v118
            // codes even in saveold v117 files)
            const my_foreign = my_meta.variables[11];
            expect(my_foreign.type).toBe('byte');
            expect(my_foreign.type_code).toBe(65530);

            // price is int or long
            const my_price = my_meta.variables[1];
            expect(
                my_price.type === 'int'
                || my_price.type === 'long'
            ).toBe(true);
        });

        it('reads variable labels in v117', () => {
            const my_meta = parse_metadata(
                load_fixture('auto_v117.dta')
            );
            expect(my_meta.variables[0].label).toBe(
                'Make and model'
            );
        });
    });

    // ----- v119 tests -----

    // Note: Stata only writes v119 when K > 32,767 or
    // N > 2,147,483,647. The auto_v119.dta fixture is
    // actually v118 because its 12 vars and 74 obs fit
    // within v118 limits. We test it parses correctly
    // and matches v118.
    describe('v119 auto.dta (saved as v118 by Stata)', () => {
        it('parses auto_v119.dta as v118', () => {
            const my_meta = parse_metadata(
                load_fixture('auto_v119.dta')
            );
            // Stata saved this as v118 since data fits
            expect(my_meta.format_version).toBe(118);
            expect(my_meta.nobs).toBe(74);
            expect(my_meta.nvar).toBe(12);

            const the_names = my_meta.variables.map(
                v => v.name
            );
            expect(the_names).toEqual(AUTO_VARNAMES);
        });

        it('reads variable labels from auto_v119.dta', () => {
            const my_meta = parse_metadata(
                load_fixture('auto_v119.dta')
            );
            expect(my_meta.variables[0].label).toBe(
                'Make and model'
            );
            expect(my_meta.variables[11].value_label_name)
                .toBe('origin');
        });
    });

    // ----- Edge cases -----

    describe('empty dataset', () => {
        it('parses empty dataset (0 observations)', () => {
            const my_meta = parse_metadata(
                load_fixture('empty.dta')
            );
            expect(my_meta.nobs).toBe(0);
            expect(my_meta.nvar).toBe(3);
            expect(my_meta.variables.length).toBe(3);

            const the_names = my_meta.variables.map(
                v => v.name
            );
            expect(the_names).toEqual(
                ['price', 'make', 'mpg']
            );
        });
    });

    describe('wide dataset', () => {
        it('parses wide dataset (120 variables)', () => {
            const my_meta = parse_metadata(
                load_fixture('wide.dta')
            );
            expect(my_meta.nvar).toBe(120);
            expect(my_meta.nobs).toBe(20);
            expect(my_meta.variables.length).toBe(120);

            // First variable is var1, last is var120
            expect(my_meta.variables[0].name).toBe('var1');
            expect(my_meta.variables[119].name).toBe(
                'var120'
            );
        });
    });

    describe('all_types dataset', () => {
        it('parses all storage types (v119)', () => {
            const my_meta = parse_metadata(
                load_fixture('all_types.dta')
            );
            expect(my_meta.nvar).toBe(8);
            expect(my_meta.dataset_label).toBe(
                'All Stata storage types'
            );

            const the_types = my_meta.variables.map(
                v => v.type
            );
            expect(the_types).toEqual([
                'byte', 'int', 'long', 'float', 'double',
                'str5', 'str20', 'strL',
            ]);
        });

        it('parses all storage types (v118)', () => {
            const my_meta = parse_metadata(
                load_fixture('all_types_v118.dta')
            );
            const the_types = my_meta.variables.map(
                v => v.type
            );
            expect(the_types).toEqual([
                'byte', 'int', 'long', 'float', 'double',
                'str5', 'str20', 'strL',
            ]);
        });

        it('parses all storage types (v117)', () => {
            const my_meta = parse_metadata(
                load_fixture('all_types_v117.dta')
            );
            // v117 generated by Stata 16+ includes strL
            const the_types = my_meta.variables.map(
                v => v.type
            );
            expect(the_types).toEqual([
                'byte', 'int', 'long', 'float', 'double',
                'str5', 'str20', 'strL',
            ]);
        });
    });

    describe('value_labels dataset', () => {
        it('reads value label associations', () => {
            const my_meta = parse_metadata(
                load_fixture('value_labels.dta')
            );
            expect(my_meta.dataset_label).toBe(
                'Value labels test dataset'
            );

            const my_foreign = my_meta.variables.find(
                v => v.name === 'foreign'
            );
            expect(my_foreign?.value_label_name).toBe(
                'foreign_lbl'
            );

            const my_rep78 = my_meta.variables.find(
                v => v.name === 'rep78'
            );
            expect(my_rep78?.value_label_name).toBe(
                'rep_lbl'
            );

            const my_region = my_meta.variables.find(
                v => v.name === 'region'
            );
            expect(my_region?.value_label_name).toBe(
                'region_lbl'
            );
        });
    });

    // ----- Cross-version consistency -----

    describe('cross-version consistency', () => {
        it('produces same variable names across formats', () => {
            const my_v117 = parse_metadata(
                load_fixture('auto_v117.dta')
            );
            const my_v118 = parse_metadata(
                load_fixture('auto_v118.dta')
            );
            const my_v119 = parse_metadata(
                load_fixture('auto_v119.dta')
            );

            const the_names_117 = my_v117.variables.map(
                v => v.name
            );
            const the_names_118 = my_v118.variables.map(
                v => v.name
            );
            const the_names_119 = my_v119.variables.map(
                v => v.name
            );

            expect(the_names_117).toEqual(the_names_118);
            expect(the_names_118).toEqual(the_names_119);
        });

        it('produces same variable labels across formats',
            () => {
                const my_v117 = parse_metadata(
                    load_fixture('auto_v117.dta')
                );
                const my_v118 = parse_metadata(
                    load_fixture('auto_v118.dta')
                );
                const my_v119 = parse_metadata(
                    load_fixture('auto_v119.dta')
                );

                const the_labels_117 = my_v117.variables.map(
                    v => v.label
                );
                const the_labels_118 = my_v118.variables.map(
                    v => v.label
                );
                const the_labels_119 = my_v119.variables.map(
                    v => v.label
                );

                expect(the_labels_117).toEqual(
                    the_labels_118
                );
                expect(the_labels_118).toEqual(
                    the_labels_119
                );
            }
        );

        it('produces same logical types across formats',
            () => {
                const my_v117 = parse_metadata(
                    load_fixture('auto_v117.dta')
                );
                const my_v118 = parse_metadata(
                    load_fixture('auto_v118.dta')
                );
                const my_v119 = parse_metadata(
                    load_fixture('auto_v119.dta')
                );

                const the_types_117 = my_v117.variables.map(
                    v => v.type
                );
                const the_types_118 = my_v118.variables.map(
                    v => v.type
                );
                const the_types_119 = my_v119.variables.map(
                    v => v.type
                );

                expect(the_types_117).toEqual(
                    the_types_118
                );
                expect(the_types_118).toEqual(
                    the_types_119
                );
            }
        );
    });

    // ----- Error handling -----

    describe('error handling', () => {
        it('throws on truncated buffer', () => {
            const my_buf = new ArrayBuffer(10);
            expect(() => parse_metadata(my_buf)).toThrow();
        });

        it('throws on invalid format signature', () => {
            const my_buf = new ArrayBuffer(100);
            const my_view = new Uint8Array(my_buf);
            // Write garbage
            my_view.fill(0x41);
            expect(() => parse_metadata(my_buf)).toThrow();
        });
    });
});

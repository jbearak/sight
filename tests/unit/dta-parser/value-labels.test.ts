import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../../src/dta-parser/header';
import { parse_value_labels } from '../../../src/dta-parser/value-labels';
import type { DtaMetadata } from '../../../src/dta-parser/types';

// -----------------------------------------------------------
// Value label table parsing tests
// -----------------------------------------------------------

const FIXTURE_DIR = path.join(
    __dirname, '..', '..', 'fixtures', 'dta'
);

function load_fixture(name: string): {
    buffer: ArrayBuffer;
    metadata: DtaMetadata;
} {
    const my_buf = fs.readFileSync(
        path.join(FIXTURE_DIR, name)
    );
    const my_array_buf = my_buf.buffer.slice(
        my_buf.byteOffset,
        my_buf.byteOffset + my_buf.byteLength
    );
    const my_meta = parse_metadata(my_array_buf);
    return { buffer: my_array_buf, metadata: my_meta };
}

describe('parse_value_labels', () => {

    // ----- value_labels.dta -----

    describe('value_labels.dta', () => {
        const { buffer, metadata } =
            load_fixture('value_labels.dta');

        it('parses value labels from value_labels.dta', () => {
            const my_labels = parse_value_labels(
                buffer, metadata
            );
            // Should have 3 label tables
            expect(my_labels.size).toBe(3);
            expect(my_labels.has('foreign_lbl')).toBe(true);
            expect(my_labels.has('rep_lbl')).toBe(true);
            expect(my_labels.has('region_lbl')).toBe(true);
        });

        it('reads foreign label table correctly (0=Domestic, 1=Foreign)', () => {
            const my_labels = parse_value_labels(
                buffer, metadata
            );
            const my_foreign = my_labels.get('foreign_lbl');
            expect(my_foreign).toBeDefined();
            expect(my_foreign!.get(0)).toBe('Domestic');
            expect(my_foreign!.get(1)).toBe('Foreign');
            expect(my_foreign!.size).toBe(2);
        });

        it('reads repair record label table (1=Poor, 5=Excellent)', () => {
            const my_labels = parse_value_labels(
                buffer, metadata
            );
            const my_rep = my_labels.get('rep_lbl');
            expect(my_rep).toBeDefined();
            expect(my_rep!.get(1)).toBe('Poor');
            expect(my_rep!.get(5)).toBe('Excellent');
            expect(my_rep!.size).toBe(5);
        });

        it('reads region label table', () => {
            const my_labels = parse_value_labels(
                buffer, metadata
            );
            const my_region = my_labels.get('region_lbl');
            expect(my_region).toBeDefined();
            expect(my_region!.size).toBeGreaterThan(0);
            // At least verify one entry exists
            const the_values = [...my_region!.values()];
            for (const my_val of the_values) {
                expect(typeof my_val).toBe('string');
                expect(my_val.length).toBeGreaterThan(0);
            }
        });
    });

    // ----- auto_v118.dta -----

    describe('auto_v118.dta', () => {
        it('parses auto.dta value labels (origin)', () => {
            const { buffer, metadata } =
                load_fixture('auto_v118.dta');
            const my_labels = parse_value_labels(
                buffer, metadata
            );
            expect(my_labels.has('origin')).toBe(true);

            const my_origin = my_labels.get('origin');
            expect(my_origin).toBeDefined();
            expect(my_origin!.get(0)).toBe('Domestic');
            expect(my_origin!.get(1)).toBe('Foreign');
        });
    });

    // ----- Cross-version -----

    describe('cross-version', () => {
        it('parses v118 value labels fixture', () => {
            const { buffer, metadata } =
                load_fixture('value_labels_v118.dta');
            const my_labels = parse_value_labels(
                buffer, metadata
            );
            expect(my_labels.size).toBe(3);
            expect(my_labels.has('foreign_lbl')).toBe(true);

            const my_foreign = my_labels.get('foreign_lbl');
            expect(my_foreign!.get(0)).toBe('Domestic');
            expect(my_foreign!.get(1)).toBe('Foreign');
        });

        it('parses v117 value labels fixture', () => {
            const { buffer, metadata } =
                load_fixture('value_labels_v117.dta');
            const my_labels = parse_value_labels(
                buffer, metadata
            );
            expect(my_labels.size).toBe(3);
            expect(my_labels.has('foreign_lbl')).toBe(true);

            const my_foreign = my_labels.get('foreign_lbl');
            expect(my_foreign!.get(0)).toBe('Domestic');
            expect(my_foreign!.get(1)).toBe('Foreign');
        });
    });

    // ----- Empty dataset -----

    it('returns empty map for datasets without value labels', () => {
        const { buffer, metadata } =
            load_fixture('empty.dta');
        const my_labels = parse_value_labels(
            buffer, metadata
        );
        expect(my_labels.size).toBe(0);
    });
});

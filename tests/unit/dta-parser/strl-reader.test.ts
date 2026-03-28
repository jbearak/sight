import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../../src/dta-parser/header';
import {
    build_gso_index,
    resolve_strl,
} from '../../../src/dta-parser/strl-reader';
import type { DtaMetadata } from '../../../src/dta-parser/types';

// -----------------------------------------------------------
// strL (GSO) resolution tests
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

describe('build_gso_index', () => {

    // ----- strl_test.dta (v119) -----

    describe('strl_test.dta', () => {
        const { buffer, metadata } =
            load_fixture('strl_test.dta');

        it('builds an index from strl_test.dta', () => {
            const my_index = build_gso_index(
                buffer, metadata
            );
            // 5 observations with strL values
            expect(my_index.size).toBeGreaterThan(0);
        });

        it('resolves strL values to strings', () => {
            const my_index = build_gso_index(
                buffer, metadata
            );

            // Find the strL variable
            const my_strl_var = metadata.variables.find(
                v => v.type === 'strL'
            );
            expect(my_strl_var).toBeDefined();

            // Data starts after the <data> tag (6 bytes)
            const my_data_start =
                metadata.section_offsets.data + 6;

            // Read first observation's strL pointer
            const my_pointer_offset =
                my_data_start + my_strl_var!.byte_offset;
            const my_val = resolve_strl(
                buffer, metadata, my_index, my_pointer_offset
            );

            expect(typeof my_val).toBe('string');
            expect(my_val!.length).toBeGreaterThan(0);
        });

        it('resolves all 5 observations', () => {
            const my_index = build_gso_index(
                buffer, metadata
            );

            const my_strl_var = metadata.variables.find(
                v => v.type === 'strL'
            );
            expect(my_strl_var).toBeDefined();

            const my_data_start =
                metadata.section_offsets.data + 6;

            const the_values: (string | null)[] = [];
            for (let i = 0; i < 5; i++) {
                const my_pointer_offset = my_data_start
                    + i * metadata.obs_length
                    + my_strl_var!.byte_offset;
                the_values.push(
                    resolve_strl(
                        buffer,
                        metadata,
                        my_index,
                        my_pointer_offset
                    )
                );
            }

            // All 5 should be strings (not null)
            for (const my_val of the_values) {
                expect(typeof my_val).toBe('string');
            }

            // Obs 4 has (v=0,o=0) pointer => empty string
            expect(the_values[3]).toBe('');

            // The other 4 should be non-empty
            for (let i = 0; i < 5; i++) {
                if (i === 3) continue;
                expect(the_values[i]!.length)
                    .toBeGreaterThan(0);
            }

            // Each value should be distinct
            const my_unique = new Set(the_values);
            expect(my_unique.size).toBe(5);
        });
    });

    // ----- strl_test_v118.dta -----

    describe('strl_test_v118.dta', () => {
        it('resolves strL values from v118 format', () => {
            const { buffer, metadata } =
                load_fixture('strl_test_v118.dta');
            const my_index = build_gso_index(
                buffer, metadata
            );

            const my_strl_var = metadata.variables.find(
                v => v.type === 'strL'
            );
            expect(my_strl_var).toBeDefined();

            const my_data_start =
                metadata.section_offsets.data + 6;

            const my_pointer_offset =
                my_data_start + my_strl_var!.byte_offset;
            const my_val = resolve_strl(
                buffer, metadata, my_index, my_pointer_offset
            );

            expect(typeof my_val).toBe('string');
            expect(my_val!.length).toBeGreaterThan(0);
        });
    });

    // ----- (v=0, o=0) empty pointer -----

    it('returns empty string for (v=0, o=0) pointer', () => {
        const { buffer, metadata } =
            load_fixture('strl_test.dta');
        const my_index = build_gso_index(
            buffer, metadata
        );

        // Create a fake buffer with a zero pointer
        const my_fake_buf = new ArrayBuffer(8);
        const my_view = new DataView(my_fake_buf);
        my_view.setUint32(0, 0, true); // v = 0
        my_view.setUint32(4, 0, true); // o = 0

        const my_val = resolve_strl(
            my_fake_buf, metadata, my_index, 0
        );
        expect(my_val).toBe('');
    });

    // ----- Dataset without strL -----

    it('returns empty index for datasets without strL', () => {
        const { buffer, metadata } =
            load_fixture('auto_v118.dta');
        const my_index = build_gso_index(
            buffer, metadata
        );
        expect(my_index.size).toBe(0);
    });
});

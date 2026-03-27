import { describe, expect, it } from 'bun:test';
import {
    build_dataset_key,
    DATA_BROWSER_COLUMN_WIDTHS_KEY,
    get_stored_column_widths,
    sanitize_column_widths,
    set_stored_column_widths,
} from '../../../client/src/data-browser/column-width-state';

describe('data-browser column width state', () => {
    it('builds dataset keys preferring the logical source path', () => {
        expect(build_dataset_key('/tmp/exported.dta', {
            source: '/data/auto.dta',
        })).toBe('/data/auto.dta');

        expect(build_dataset_key('/tmp/exported.dta'))
            .toBe('/tmp/exported.dta');
    });

    it('sanitizes invalid width values', () => {
        expect(sanitize_column_widths({
            price: 120.2,
            bad: -1,
            nope: 'abc',
        })).toEqual({
            price: 120,
        });
    });

    it('reads empty persisted state safely', () => {
        expect(get_stored_column_widths({
            globalState: {
                get() {
                    return undefined;
                },
                async update() {},
            },
        })).toEqual({});
    });

    it('writes widths under the expected global-state key and preserves unrelated datasets', async () => {
        let my_state: unknown = {
            '/data/other.dta': {
                other: 99,
            },
        };
        let my_last_key = '';

        await set_stored_column_widths({
            globalState: {
                get() {
                    return my_state;
                },
                async update(key, value) {
                    my_last_key = key;
                    my_state = value;
                },
            },
        }, '/data/auto.dta', {
            price: 180,
            bad: -5,
        });

        expect(my_last_key).toBe(DATA_BROWSER_COLUMN_WIDTHS_KEY);
        expect(my_state).toEqual({
            '/data/other.dta': {
                other: 99,
            },
            '/data/auto.dta': {
                price: 180,
            },
        });
    });
});

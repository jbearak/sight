import { describe, expect, it } from 'bun:test';
import {
    build_dataset_key,
    build_dataset_key_aliases,
    DATA_BROWSER_COLUMN_WIDTHS_KEY,
    create_column_width_store,
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

    it('builds fallback aliases for dataset matching', () => {
        expect(build_dataset_key_aliases(
            '/tmp/exported.dta',
            {
                source: '/data/auto.dta',
                name: 'auto',
            }
        )).toContain('basename:auto.dta');

        expect(build_dataset_key_aliases(
            '/tmp/exported.dta',
            {
                source: '/data/auto.dta',
                name: 'auto',
            }
        )).toContain('name:auto');
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

    it('restores widths through alias keys when the exact dataset path changes', async () => {
        let my_state: unknown = {};
        const my_store = create_column_width_store({
            globalState: {
                get() {
                    return my_state;
                },
                async update(_key, value) {
                    my_state = value;
                },
            },
        } as never);

        await my_store.set('/tmp/session-a/auto.dta', {
            price: 180,
        }, ['basename:auto.dta']);

        expect(my_store.get(
            '/tmp/session-b/auto.dta',
            ['basename:auto.dta']
        )).toEqual({
            price: 180,
        });
    });
});

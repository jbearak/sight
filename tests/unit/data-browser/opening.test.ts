import * as path from 'path';
import { describe, expect, it } from 'bun:test';
import {
    build_direct_open_sidecar,
    should_unlink_data_browser_path,
} from '../../../client/src/data-browser/opening';

describe('data browser direct-open helpers', () => {
    it('builds a non-subset sidecar from a dataset path', () => {
        const my_sidecar = build_direct_open_sidecar(
            '/tmp/auto.dta'
        );

        expect(my_sidecar.name).toBe('auto');
        expect(my_sidecar.dtapath).toBe('/tmp/auto.dta');
        expect(my_sidecar.source).toBe('/tmp/auto.dta');
        expect(my_sidecar.subsetted).toBe(false);
        expect(my_sidecar.replace).toBe(false);
    });

    it('only unlinks files inside the browse temp directory', () => {
        const my_browse_dir = '/tmp/.sight/browse';

        expect(should_unlink_data_browser_path(
            path.join(my_browse_dir, 'abc.dta'),
            my_browse_dir
        )).toBe(true);

        expect(should_unlink_data_browser_path(
            path.join(my_browse_dir, 'nested', 'abc.dta'),
            my_browse_dir
        )).toBe(true);

        expect(should_unlink_data_browser_path(
            '/tmp/user/auto.dta',
            my_browse_dir
        )).toBe(false);

        expect(should_unlink_data_browser_path(
            '/tmp/.sight/browse-other/auto.dta',
            my_browse_dir
        )).toBe(false);
    });
});

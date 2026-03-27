import {
    describe,
    expect,
    it,
} from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('bundled vview asset', () => {
    it('matches the source vview.ado file', () => {
        const my_repo_root = path.resolve(
            import.meta.dir,
            '..',
            '..',
            '..'
        );
        const my_source_path = path.join(
            my_repo_root,
            'stata',
            'vview.ado'
        );
        const my_client_asset_path = path.join(
            my_repo_root,
            'client',
            'stata',
            'vview.ado'
        );

        expect(fs.existsSync(my_source_path)).toBe(true);
        expect(fs.existsSync(my_client_asset_path)).toBe(true);
        expect(
            fs.readFileSync(my_client_asset_path, 'utf-8')
        ).toBe(
            fs.readFileSync(my_source_path, 'utf-8')
        );
    });
});

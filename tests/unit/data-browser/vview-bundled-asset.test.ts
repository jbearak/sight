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

    it('does not depend on Mata path helpers for browse paths', () => {
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
        const my_source = fs.readFileSync(
            my_source_path,
            'utf-8'
        );

        expect(my_source).toContain(
            'local browseroot "~/.sight"'
        );
        expect(my_source).not.toContain(
            'pathjoin('
        );
        expect(my_source).not.toContain(
            'pathresolve('
        );
    });

    it('uses Mata char-based JSON escaping instead of nested Stata quote escapes', () => {
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
        const my_source = fs.readFileSync(
            my_source_path,
            'utf-8'
        );

        expect(my_source).toContain(
            'char(92) + char(92)'
        );
        expect(my_source).toContain(
            'char(92) + char(34)'
        );
        expect(my_source).not.toContain(
            '`"""\''
        );
    });

    it('writes the JSON sidecar through Mata file I/O', () => {
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
        const my_source = fs.readFileSync(
            my_source_path,
            'utf-8'
        );

        expect(my_source).toContain(
            'mata {'
        );
        expect(my_source).toContain(
            'my_vview_fh = fopen(st_local("jsonpath"), "w")'
        );
        expect(my_source).not.toContain(
            `file write \`fh' \`"  "version": 1,"' _n`
        );
    });
});

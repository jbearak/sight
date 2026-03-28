import {
    describe,
    expect,
    it,
} from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(
    import.meta.dir,
    '..',
    '..',
    '..'
);
const SOURCE_PATH = path.join(REPO_ROOT, 'stata', 'vview.ado');

function load_vview_source(): string {
    return fs.readFileSync(SOURCE_PATH, 'utf-8');
}

describe('bundled vview asset', () => {
    it('matches the source vview.ado file', () => {
        const my_client_asset_path = path.join(
            REPO_ROOT,
            'client',
            'stata',
            'vview.ado'
        );

        expect(fs.existsSync(SOURCE_PATH)).toBe(true);
        expect(fs.existsSync(my_client_asset_path)).toBe(true);
        expect(
            fs.readFileSync(my_client_asset_path, 'utf-8')
        ).toBe(load_vview_source());
    });

    it('does not depend on Mata path helpers for browse paths', () => {
        const my_source = load_vview_source();

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
        const my_source = load_vview_source();

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
        const my_source = load_vview_source();

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

    it('builds varlist JSON inside Mata rather than fragile Stata quote concatenation', () => {
        const my_source = load_vview_source();

        expect(my_source).toContain(
            'my_vview_vars = tokens(my_vview_varlist)'
        );
        expect(my_source).toContain(
            'st_local("json_varlist", my_vview_json_varlist)'
        );
        expect(my_source).not.toContain(
            'foreach my_var of local varlist'
        );
    });

    it('creates the signal file without replace noise', () => {
        const my_source = load_vview_source();

        expect(my_source).toContain(
            'cap erase "`signalpath\'"'
        );
        expect(my_source).toContain(
            'file open `fh\' using "`signalpath\'", write text'
        );
        expect(my_source).not.toContain(
            'file open `fh\' using "`signalpath\'", write replace'
        );
    });
});

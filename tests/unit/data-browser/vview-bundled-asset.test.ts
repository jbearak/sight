import {
    describe,
    expect,
    it,
} from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ADO_ASSET_DEFS } from '../../../client/src/data-browser/vview-install-core';

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

describe('bundled browse alias asset', () => {
    const BROWSE_SOURCE_PATH = path.join(
        REPO_ROOT,
        'stata',
        'browse.ado'
    );

    function load_browse_source(): string {
        return fs.readFileSync(BROWSE_SOURCE_PATH, 'utf-8');
    }

    it('matches the source browse.ado file', () => {
        const my_client_asset_path = path.join(
            REPO_ROOT,
            'client',
            'stata',
            'browse.ado'
        );

        expect(fs.existsSync(BROWSE_SOURCE_PATH)).toBe(true);
        expect(fs.existsSync(my_client_asset_path)).toBe(true);
        expect(
            fs.readFileSync(my_client_asset_path, 'utf-8')
        ).toBe(load_browse_source());
    });

    it('is a pure vview forwarder', () => {
        const my_source = load_browse_source();

        expect(my_source).toContain('program define browse');
        expect(my_source).toContain('vview `0\'');
    });

    it('guards on console mode so the GUI built-in is never replaced', () => {
        const my_source = load_browse_source();

        expect(my_source).toContain(
            '`"`c(console)\'"\' != "console"'
        );
        expect(my_source).toContain('exit 199');
    });

    it('carries the stable Sight ownership marker on its first line', () => {
        const my_source = load_browse_source();
        const my_first_line = my_source.split('\n', 1)[0];

        expect(my_first_line).toBe(
            '*! browse.ado — CLI alias for vview (Sight Data Browser)'
        );
    });
});

describe('bundled browse-abbreviation alias assets', () => {
    // `browse` can be abbreviated to `brows`/`brow`/`bro`/`br`; each
    // abbreviation ships its own forwarder ado, since Stata does not
    // auto-abbreviate ado command names.
    const THE_ABBREVIATIONS = [
        'brows',
        'brow',
        'bro',
        'br',
    ];

    for (const my_abbrev of THE_ABBREVIATIONS) {
        const my_file_name = `${my_abbrev}.ado`;
        const my_source_path = path.join(
            REPO_ROOT,
            'stata',
            my_file_name
        );

        const load_source = (): string =>
            fs.readFileSync(my_source_path, 'utf-8');

        describe(my_file_name, () => {
            it('matches the source file in client/stata', () => {
                const my_client_asset_path = path.join(
                    REPO_ROOT,
                    'client',
                    'stata',
                    my_file_name
                );

                expect(fs.existsSync(my_source_path)).toBe(true);
                expect(
                    fs.existsSync(my_client_asset_path)
                ).toBe(true);
                expect(
                    fs.readFileSync(
                        my_client_asset_path,
                        'utf-8'
                    )
                ).toBe(load_source());
            });

            it('is a pure vview forwarder', () => {
                const my_source = load_source();

                expect(my_source).toContain(
                    `program define ${my_abbrev}`
                );
                expect(my_source).toContain('vview `0\'');
            });

            it('guards on console mode so the GUI built-in is never replaced', () => {
                const my_source = load_source();

                expect(my_source).toContain(
                    '`"`c(console)\'"\' != "console"'
                );
                expect(my_source).toContain('exit 199');
            });

            it('names the typed command in its guard message', () => {
                const my_source = load_source();

                expect(my_source).toContain(
                    `di as err "${my_abbrev}: the Sight alias `
                );
            });

            it('carries the stable Sight ownership marker on its first line', () => {
                const my_first_line = load_source().split(
                    '\n',
                    1
                )[0];

                expect(my_first_line).toBe(
                    `*! ${my_file_name} — CLI alias for vview `
                    + '(Sight Data Browser)'
                );
            });
        });
    }
});

describe('ado ownership markers', () => {
    it('each marker equals the first line of its canonical ado', () => {
        // Ownership detection must use the FULL banner line, not a
        // truncated prefix — otherwise a foreign same-named file
        // could be misclassified as Sight-owned and overwritten.
        for (const my_def of ADO_ASSET_DEFS) {
            const my_source = fs.readFileSync(
                path.join(REPO_ROOT, 'stata', my_def.name),
                'utf-8'
            );
            const my_first_line = my_source.split('\n', 1)[0];
            expect(my_def.marker).toBe(my_first_line);
        }
    });
});

describe('bundled ado set reconciliation', () => {
    // The copy-vview-ado script globs `../stata/*.ado` into client/stata,
    // and the installer is driven only by ADO_ASSET_DEFS. These must
    // agree in both directions: an unregistered .ado dropped into stata/
    // would ship in the extension yet never install/uninstall, and a def
    // without a source file would abort the whole bundle install. Assert
    // the three sets are identical so neither drift slips through.
    const list_ados = (dir: string): string[] =>
        fs
            .readdirSync(dir)
            .filter((my_name) => my_name.endsWith('.ado'))
            .sort();

    const expected_ado_names = ADO_ASSET_DEFS.map(
        (my_def) => my_def.name
    ).sort();

    it('matches the canonical stata/ directory', () => {
        expect(
            list_ados(path.join(REPO_ROOT, 'stata'))
        ).toEqual(expected_ado_names);
    });

    it('matches the bundled client/stata/ directory', () => {
        expect(
            list_ados(path.join(REPO_ROOT, 'client', 'stata'))
        ).toEqual(expected_ado_names);
    });
});

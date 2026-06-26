import {
    afterEach,
    describe,
    expect,
    it,
} from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ADO_ASSET_DEFS,
    aggregate_bundle_state,
    build_install_prompt_message,
    classify_ado_asset,
    ensure_bundle_installed,
    get_install_permission,
    install_bundle,
    install_bundle_manually,
    is_sight_owned,
    reset_install_permission,
    uninstall_bundle,
    uninstall_bundle_and_reset,
    type AdoAsset,
    type AdoAssetStatus,
    type BundleInstallStatus,
    type VviewInstallContextLike,
    type VviewInstallPermission,
} from '../../../client/src/data-browser/vview-install-core';

const PERMISSION_KEY =
    'sight.stataCommandsInstallPermission';
// Use the production markers, so tests bind to the real ownership
// strings and catch any drift/truncation in them.
const VVIEW_MARKER = ADO_ASSET_DEFS[0].marker;
const BROWSE_MARKER = ADO_ASSET_DEFS[1].marker;

const the_temp_dirs: string[] = [];

function create_temp_dir(): string {
    const my_dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sight-vview-test-')
    );
    the_temp_dirs.push(my_dir);
    return my_dir;
}

function create_context(
    permission?: VviewInstallPermission
): VviewInstallContextLike {
    const my_state = new Map<string, unknown>();
    if (permission !== undefined) {
        my_state.set(PERMISSION_KEY, permission);
    }

    return {
        globalState: {
            get<T>(
                key: string,
                default_value?: T
            ): T | undefined {
                if (my_state.has(key)) {
                    return my_state.get(key) as T;
                }
                return default_value;
            },
            async update(
                key: string,
                value: unknown
            ): Promise<void> {
                if (value === undefined) {
                    my_state.delete(key);
                    return;
                }
                my_state.set(key, value);
            },
        },
    };
}

// Builds a bundle status whose assets live under a real temp dir, so
// install/uninstall actually touch the filesystem.
function build_bundle(
    target_dir: string,
    overrides: Partial<
        Record<'vview' | 'browse', Partial<AdoAssetStatus>>
    > = {}
): BundleInstallStatus {
    const make = (
        name: string,
        marker: string,
        protect_foreign: boolean,
        content: string,
        extra: Partial<AdoAssetStatus>
    ): AdoAssetStatus => {
        const my_asset: AdoAsset = {
            name,
            target_path: path.join(target_dir, name),
            bundled_path: path.join('/bundle', name),
            bundled_content: content,
            marker,
            protect_foreign,
        };
        return {
            ...my_asset,
            ...extra,
            state:
                extra.state
                ?? classify_ado_asset(my_asset, () => {}),
        };
    };

    const the_assets = [
        make(
            'vview.ado',
            VVIEW_MARKER,
            ADO_ASSET_DEFS[0].protect_foreign,
            `${VVIEW_MARKER}\nprogram define vview\nend\n`,
            overrides.vview ?? {}
        ),
        make(
            'browse.ado',
            BROWSE_MARKER,
            ADO_ASSET_DEFS[1].protect_foreign,
            `${BROWSE_MARKER}\nprogram define browse\nvview \`0'\nend\n`,
            overrides.browse ?? {}
        ),
    ];

    return {
        state: aggregate_bundle_state(
            the_assets.map((my_asset) => my_asset.state)
        ),
        target_dir,
        assets: the_assets,
    };
}

afterEach(() => {
    for (const my_dir of the_temp_dirs.splice(0)) {
        fs.rmSync(my_dir, { recursive: true, force: true });
    }
});

describe('ado ownership detection', () => {
    it('recognizes a Sight-shipped file by its exact banner marker', () => {
        expect(
            is_sight_owned(
                `${BROWSE_MARKER}\nprogram define browse\nend\n`,
                BROWSE_MARKER
            )
        ).toBe(true);
    });

    it('does not treat a banner with extra trailing text as owned', () => {
        // Exact match only: a file that merely starts with our banner
        // text must not be claimed as Sight-owned.
        expect(
            is_sight_owned(
                `${BROWSE_MARKER} (modified by user)\n...`,
                BROWSE_MARKER
            )
        ).toBe(false);
    });

    it('treats a foreign file with a different banner as not owned', () => {
        expect(
            is_sight_owned(
                '*! my own browse helper\nprogram define browse\nend\n',
                BROWSE_MARKER
            )
        ).toBe(false);
    });

    it('recognizes a CRLF-saved copy of our own file', () => {
        expect(
            is_sight_owned(
                `${BROWSE_MARKER}\r\nprogram define browse\r\n`,
                BROWSE_MARKER
            )
        ).toBe(true);
    });

    it('does not treat a whitespace-padded banner as owned', () => {
        expect(
            is_sight_owned(
                `  ${BROWSE_MARKER}\nx\n`,
                BROWSE_MARKER
            )
        ).toBe(false);
    });

    it('does not treat a mere prefix of the marker as owned', () => {
        // Guards against a truncated marker: a banner that only
        // starts to resemble ours must not be claimed as Sight-owned.
        const my_prefix = BROWSE_MARKER.slice(
            0,
            BROWSE_MARKER.length - 12
        );
        expect(
            is_sight_owned(my_prefix + '\nx\n', BROWSE_MARKER)
        ).toBe(false);
    });
});

describe('ado asset classification', () => {
    it('returns missing when target file is absent', () => {
        const my_dir = create_temp_dir();
        const my_asset: AdoAsset = {
            name: 'browse.ado',
            target_path: path.join(my_dir, 'browse.ado'),
            bundled_path: '/bundle/browse.ado',
            bundled_content: 'content',
            marker: BROWSE_MARKER,
            protect_foreign: true,
        };

        expect(classify_ado_asset(my_asset, () => {})).toBe(
            'missing'
        );
    });

    it('returns up_to_date when target matches bundled content', () => {
        const my_dir = create_temp_dir();
        const my_path = path.join(my_dir, 'browse.ado');
        fs.writeFileSync(my_path, 'content');

        expect(
            classify_ado_asset(
                {
                    name: 'browse.ado',
                    target_path: my_path,
                    bundled_path: '/bundle/browse.ado',
                    bundled_content: 'content',
                    marker: BROWSE_MARKER,
                    protect_foreign: true,
                },
                () => {}
            )
        ).toBe('up_to_date');
    });

    it('returns outdated when a Sight-owned file differs', () => {
        const my_dir = create_temp_dir();
        const my_path = path.join(my_dir, 'browse.ado');
        fs.writeFileSync(my_path, `${BROWSE_MARKER}\nold\n`);

        expect(
            classify_ado_asset(
                {
                    name: 'browse.ado',
                    target_path: my_path,
                    bundled_path: '/bundle/browse.ado',
                    bundled_content: `${BROWSE_MARKER}\nnew\n`,
                    marker: BROWSE_MARKER,
                    protect_foreign: true,
                },
                () => {}
            )
        ).toBe('outdated');
    });

    it('returns foreign when a non-Sight file occupies the path', () => {
        const my_dir = create_temp_dir();
        const my_path = path.join(my_dir, 'browse.ado');
        fs.writeFileSync(
            my_path,
            '*! someone else\nprogram define browse\nend\n'
        );

        expect(
            classify_ado_asset(
                {
                    name: 'browse.ado',
                    target_path: my_path,
                    bundled_path: '/bundle/browse.ado',
                    bundled_content: `${BROWSE_MARKER}\nx\n`,
                    marker: BROWSE_MARKER,
                    protect_foreign: true,
                },
                () => {}
            )
        ).toBe('foreign');
    });

    it('returns error when bundled content is unavailable', () => {
        const my_dir = create_temp_dir();
        expect(
            classify_ado_asset(
                {
                    name: 'browse.ado',
                    target_path: path.join(
                        my_dir,
                        'browse.ado'
                    ),
                    bundled_path: '/bundle/browse.ado',
                    bundled_content: undefined,
                    marker: BROWSE_MARKER,
                    protect_foreign: true,
                },
                () => {}
            )
        ).toBe('error');
    });

    it('returns outdated (not foreign) for an unowned file of a Sight-owned name', () => {
        // vview is Sight's own command name (protect_foreign: false):
        // a differing, non-Sight vview.ado is overwritten, never left
        // as a foreign file — otherwise browse could alias it.
        const my_dir = create_temp_dir();
        const my_path = path.join(my_dir, 'vview.ado');
        fs.writeFileSync(
            my_path,
            '*! someone else\nprogram define vview\nend\n'
        );

        expect(
            classify_ado_asset(
                {
                    name: 'vview.ado',
                    target_path: my_path,
                    bundled_path: '/bundle/vview.ado',
                    bundled_content: `${VVIEW_MARKER}\nx\n`,
                    marker: VVIEW_MARKER,
                    protect_foreign: false,
                },
                () => {}
            )
        ).toBe('outdated');
    });
});

describe('bundle aggregate state', () => {
    it('reports error when any asset errors', () => {
        expect(
            aggregate_bundle_state(['up_to_date', 'error'])
        ).toBe('error');
    });

    it('reports missing when any asset is missing', () => {
        expect(
            aggregate_bundle_state(['up_to_date', 'missing'])
        ).toBe('missing');
    });

    it('reports outdated when any Sight-owned asset differs', () => {
        expect(
            aggregate_bundle_state(['up_to_date', 'outdated'])
        ).toBe('outdated');
    });

    it('reports up_to_date when a foreign file is left alone', () => {
        expect(
            aggregate_bundle_state(['up_to_date', 'foreign'])
        ).toBe('up_to_date');
    });
});

describe('install prompt message', () => {
    it('frames consent as adding the browse alias when vview is already installed', () => {
        const my_dir = create_temp_dir();
        const my_status = build_bundle(my_dir, {
            vview: { state: 'up_to_date' },
            browse: { state: 'missing' },
        });

        const my_message =
            build_install_prompt_message(my_status);

        // Acknowledges vview is already present and frames the
        // consent around the browse alias, not a fresh vview install.
        expect(my_message).toContain('already installed');
        expect(my_message).toContain('browse');
        expect(my_message).toContain(my_dir);
        // Must NOT present vview as something to be added.
        expect(my_message).not.toContain('"vview" and "browse"');
    });

    it('offers the full vview + browse install when vview is absent', () => {
        const my_dir = create_temp_dir();
        const my_status = build_bundle(my_dir, {
            vview: { state: 'missing' },
            browse: { state: 'missing' },
        });

        const my_message =
            build_install_prompt_message(my_status);

        expect(my_message).toContain('"vview" and "browse"');
        expect(my_message).toContain(my_dir);
        expect(my_message).toContain('add');
        expect(my_message).not.toContain('already installed');
    });

    it('says "update" (not "add") when a present browse alias is merely outdated', () => {
        // vview current, browse already installed but stale: install
        // updates it, so the prompt must not describe it as a fresh add.
        const my_dir = create_temp_dir();
        const my_status = build_bundle(my_dir, {
            vview: { state: 'up_to_date' },
            browse: { state: 'outdated' },
        });

        const my_message =
            build_install_prompt_message(my_status);

        expect(my_message).toContain('already installed');
        expect(my_message).toContain('update');
        expect(my_message).not.toContain('also add the console');
    });

    it('says "update" when vview itself is outdated', () => {
        const my_dir = create_temp_dir();
        const my_status = build_bundle(my_dir, {
            vview: { state: 'outdated' },
            browse: { state: 'outdated' },
        });

        const my_message =
            build_install_prompt_message(my_status);

        expect(my_message).toContain('update');
        expect(my_message).toContain('"vview" and "browse"');
        expect(my_message).not.toContain('already installed');
    });

    it('names the abbreviation aliases from the canonical bundle defs', () => {
        const my_dir = create_temp_dir();
        const my_status = build_bundle(my_dir, {
            vview: { state: 'missing' },
        });

        const my_message =
            build_install_prompt_message(my_status);

        for (const my_def of ADO_ASSET_DEFS) {
            if (
                my_def.name === 'vview.ado'
                || my_def.name === 'browse.ado'
            ) {
                continue;
            }
            const my_label =
                '"' + my_def.name.replace(/\.ado$/, '') + '"';
            expect(my_message).toContain(my_label);
        }
    });
});

describe('bundle install orchestration', () => {
    it('prompts on startup when permission is unset and install is missing', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context();
        const the_logs: string[] = [];
        let my_prompt_calls = 0;

        await ensure_bundle_installed(
            my_context,
            (msg) => the_logs.push(msg),
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
                prompt_for_install: async () => {
                    my_prompt_calls += 1;
                    return 'not_now';
                },
            }
        );

        expect(my_prompt_calls).toBe(1);
        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBeUndefined();
        expect(the_logs).toContain(
            'Stata commands: prompting for install permission'
        );
    });

    it('passes the full bundle status to the prompt hook', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context();
        let my_received: BundleInstallStatus | undefined;

        await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
                prompt_for_install: async (status) => {
                    my_received = status;
                    return 'not_now';
                },
            }
        );

        // The hook must receive the status (so it can tailor copy),
        // not just the bare target_dir string.
        expect(my_received).toBeDefined();
        expect(my_received?.target_dir).toBe(my_dir);
        expect(Array.isArray(my_received?.assets)).toBe(true);
        expect(my_received?.assets.length).toBeGreaterThan(0);
    });

    it('installs without prompting when permission was already granted', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context('granted');
        let my_prompt_calls = 0;

        const my_result = await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
                prompt_for_install: async () => {
                    my_prompt_calls += 1;
                    return 'install';
                },
            }
        );

        expect(my_result).toBe(true);
        expect(my_prompt_calls).toBe(0);
        expect(
            fs.existsSync(path.join(my_dir, 'vview.ado'))
        ).toBe(true);
        expect(
            fs.existsSync(path.join(my_dir, 'browse.ado'))
        ).toBe(true);
    });

    it('skips prompt and install when permission was declined', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context('declined');
        let my_prompt_calls = 0;

        const my_result = await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
                prompt_for_install: async () => {
                    my_prompt_calls += 1;
                    return 'install';
                },
            }
        );

        expect(my_result).toBe(false);
        expect(my_prompt_calls).toBe(0);
        expect(
            fs.existsSync(path.join(my_dir, 'vview.ado'))
        ).toBe(false);
    });

    it('writes both files and stores granted permission after approval', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context();
        const my_bundle = build_bundle(my_dir);

        const my_result = await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () => my_bundle,
                prompt_for_install: async () => 'install',
            }
        );

        expect(my_result).toBe(true);
        expect(
            fs.readFileSync(
                path.join(my_dir, 'vview.ado'),
                'utf-8'
            )
        ).toBe(my_bundle.assets[0].bundled_content);
        expect(
            fs.readFileSync(
                path.join(my_dir, 'browse.ado'),
                'utf-8'
            )
        ).toBe(my_bundle.assets[1].bundled_content);
        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBe('granted');
    });

    it('does not persist permission when the user chooses not now', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context();

        const my_result = await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
                prompt_for_install: async () => 'not_now',
            }
        );

        expect(my_result).toBe(false);
        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBeUndefined();
    });

    it('does not store declined permission when the prompt is dismissed', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context();

        const my_result = await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
                prompt_for_install: async () => 'dismissed',
            }
        );

        expect(my_result).toBe(false);
        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBeUndefined();
    });

    it('does not store granted permission if install fails after approval', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context();

        const my_result = await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
                prompt_for_install: async () => 'install',
                install_bundle: () => false,
            }
        );

        expect(my_result).toBe(false);
        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBeUndefined();
    });

    it('silently updates an outdated install after prior approval', async () => {
        const my_dir = create_temp_dir();
        // Pre-seed an outdated, Sight-owned vview.ado.
        fs.writeFileSync(
            path.join(my_dir, 'vview.ado'),
            `${VVIEW_MARKER}\nstale\n`
        );
        fs.writeFileSync(
            path.join(my_dir, 'browse.ado'),
            `${BROWSE_MARKER}\nstale\n`
        );
        const my_context = create_context('granted');
        let my_prompt_calls = 0;

        const my_bundle = build_bundle(my_dir);
        expect(my_bundle.state).toBe('outdated');

        const my_result = await ensure_bundle_installed(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () => my_bundle,
                prompt_for_install: async () => {
                    my_prompt_calls += 1;
                    return 'install';
                },
            }
        );

        expect(my_result).toBe(true);
        expect(my_prompt_calls).toBe(0);
        expect(
            fs.readFileSync(
                path.join(my_dir, 'vview.ado'),
                'utf-8'
            )
        ).toBe(my_bundle.assets[0].bundled_content);
    });

    it('manual install succeeds even after a prior decline', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context('declined');

        const my_result = await install_bundle_manually(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
            }
        );

        expect(my_result).toBe(true);
        expect(
            fs.existsSync(path.join(my_dir, 'browse.ado'))
        ).toBe(true);
        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBe('granted');
    });

    it('reset clears remembered install permission', async () => {
        const my_context = create_context('declined');

        await reset_install_permission(
            my_context,
            () => {},
            PERMISSION_KEY
        );

        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBeUndefined();
    });
});

describe('bundle file installation', () => {
    it('writes bundled content for every asset', () => {
        const my_dir = create_temp_dir();
        const my_bundle = build_bundle(my_dir);
        const the_logs: string[] = [];

        const my_result = install_bundle(
            my_bundle,
            (msg) => the_logs.push(msg)
        );

        expect(my_result).toBe(true);
        expect(
            fs.readFileSync(
                path.join(my_dir, 'vview.ado'),
                'utf-8'
            )
        ).toBe(my_bundle.assets[0].bundled_content);
        expect(
            fs.readFileSync(
                path.join(my_dir, 'browse.ado'),
                'utf-8'
            )
        ).toBe(my_bundle.assets[1].bundled_content);
    });

    it('never overwrites a foreign browse.ado and reports it as satisfied', () => {
        const my_dir = create_temp_dir();
        const my_foreign =
            '*! my own browse\nprogram define browse\nend\n';
        fs.writeFileSync(
            path.join(my_dir, 'browse.ado'),
            my_foreign
        );

        const my_bundle = build_bundle(my_dir);
        // The foreign file must not drive a perpetual "outdated".
        expect(my_bundle.assets[1].state).toBe('foreign');
        expect(my_bundle.state).toBe('missing'); // vview still missing

        const my_result = install_bundle(
            my_bundle,
            () => {}
        );

        expect(my_result).toBe(true);
        // Foreign file untouched, vview installed.
        expect(
            fs.readFileSync(
                path.join(my_dir, 'browse.ado'),
                'utf-8'
            )
        ).toBe(my_foreign);
        expect(
            fs.existsSync(path.join(my_dir, 'vview.ado'))
        ).toBe(true);
    });

    it('installs Sight vview over a foreign vview so browse aliases Sight (not the foreign vview)', () => {
        const my_dir = create_temp_dir();
        // User has their own vview.ado; browse.ado is absent.
        fs.writeFileSync(
            path.join(my_dir, 'vview.ado'),
            '*! someone else\nprogram define vview\nend\n'
        );

        const my_bundle = build_bundle(my_dir);
        // vview is a Sight-owned name → reinstalled, not protected.
        expect(my_bundle.assets[0].state).toBe('outdated');
        expect(my_bundle.assets[1].state).toBe('missing');

        const my_result = install_bundle(
            my_bundle,
            () => {}
        );

        expect(my_result).toBe(true);
        // Sight's vview now in place, and browse is installed.
        expect(
            fs.readFileSync(
                path.join(my_dir, 'vview.ado'),
                'utf-8'
            )
        ).toBe(my_bundle.assets[0].bundled_content);
        expect(
            fs.existsSync(path.join(my_dir, 'browse.ado'))
        ).toBe(true);
    });

    it('does not overwrite a foreign file that appears after classification (TOCTOU)', () => {
        const my_dir = create_temp_dir();
        const my_foreign =
            '*! my own browse\nprogram define browse\nend\n';
        fs.writeFileSync(
            path.join(my_dir, 'browse.ado'),
            my_foreign
        );

        // Force a stale "missing" classification even though a
        // foreign file now sits at the target path.
        const my_bundle = build_bundle(my_dir, {
            browse: { state: 'missing' },
        });

        const my_result = install_bundle(
            my_bundle,
            () => {}
        );

        expect(my_result).toBe(true);
        expect(
            fs.readFileSync(
                path.join(my_dir, 'browse.ado'),
                'utf-8'
            )
        ).toBe(my_foreign);
    });

    it('a lone foreign browse.ado yields up_to_date once vview is present', () => {
        const my_dir = create_temp_dir();
        const my_bundle_seed = build_bundle(my_dir);
        // Install vview, leave a foreign browse.ado in place.
        fs.writeFileSync(
            path.join(my_dir, 'vview.ado'),
            my_bundle_seed.assets[0].bundled_content as string
        );
        fs.writeFileSync(
            path.join(my_dir, 'browse.ado'),
            '*! foreign\nprogram define browse\nend\n'
        );

        const my_bundle = build_bundle(my_dir);
        expect(my_bundle.assets[0].state).toBe('up_to_date');
        expect(my_bundle.assets[1].state).toBe('foreign');
        expect(my_bundle.state).toBe('up_to_date');
    });
});

describe('bundle uninstall', () => {
    it('removes only Sight-owned files and leaves foreign files intact', () => {
        const my_dir = create_temp_dir();
        const my_bundle = build_bundle(my_dir);
        // Install Sight vview, but a foreign browse.ado exists.
        install_bundle(my_bundle, () => {});
        const my_foreign =
            '*! my own browse\nprogram define browse\nend\n';
        fs.writeFileSync(
            path.join(my_dir, 'browse.ado'),
            my_foreign
        );

        const my_after = build_bundle(my_dir);
        const my_ok = uninstall_bundle(
            my_after,
            () => {}
        );

        expect(my_ok).toBe(true);
        // Sight-owned vview removed.
        expect(
            fs.existsSync(path.join(my_dir, 'vview.ado'))
        ).toBe(false);
        // Foreign browse left in place.
        expect(
            fs.readFileSync(
                path.join(my_dir, 'browse.ado'),
                'utf-8'
            )
        ).toBe(my_foreign);
    });

    it('uninstall_bundle_and_reset removes files and clears permission', async () => {
        const my_dir = create_temp_dir();
        const my_context = create_context('granted');
        const my_bundle = build_bundle(my_dir);
        install_bundle(my_bundle, () => {});

        const my_ok = await uninstall_bundle_and_reset(
            my_context,
            () => {},
            PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_bundle(my_dir),
            }
        );

        expect(my_ok).toBe(true);
        expect(
            fs.existsSync(path.join(my_dir, 'vview.ado'))
        ).toBe(false);
        expect(
            fs.existsSync(path.join(my_dir, 'browse.ado'))
        ).toBe(false);
        expect(
            get_install_permission(
                my_context,
                PERMISSION_KEY
            )
        ).toBeUndefined();
    });
});

// The four `browse` abbreviation forwarders share `browse`'s generic-name
// ownership posture. build_bundle models only vview+browse, so these
// data-driven tests exercise install-write, foreign protection, and
// ownership-gated uninstall directly over the production abbreviation defs.
describe('browse-abbreviation bundle assets', () => {
    const THE_ABBREV_DEFS = ADO_ASSET_DEFS.filter((my_def) =>
        ['brows.ado', 'brow.ado', 'bro.ado', 'br.ado'].includes(
            my_def.name
        )
    );

    function make_abbrev_asset(
        def: (typeof ADO_ASSET_DEFS)[number],
        target_dir: string,
        extra: Partial<AdoAssetStatus> = {}
    ): AdoAssetStatus {
        const my_asset: AdoAsset = {
            name: def.name,
            target_path: path.join(target_dir, def.name),
            bundled_path: path.join('/bundle', def.name),
            bundled_content: `${def.marker}\nprogram define x\nend\n`,
            marker: def.marker,
            protect_foreign: def.protect_foreign,
        };
        return {
            ...my_asset,
            ...extra,
            state:
                extra.state
                ?? classify_ado_asset(my_asset, () => {}),
        };
    }

    it('ships all four standard abbreviations as protected assets', () => {
        expect(THE_ABBREV_DEFS.map((my_def) => my_def.name)).toEqual([
            'brows.ado',
            'brow.ado',
            'bro.ado',
            'br.ado',
        ]);
        for (const my_def of THE_ABBREV_DEFS) {
            // Generic built-in names: a user's own copy must be protected.
            expect(my_def.protect_foreign).toBe(true);
        }
    });

    for (const my_def of THE_ABBREV_DEFS) {
        describe(my_def.name, () => {
            it('writes a missing target on install', () => {
                const my_dir = create_temp_dir();
                const my_asset = make_abbrev_asset(my_def, my_dir);
                expect(my_asset.state).toBe('missing');

                expect(
                    install_bundle(
                        {
                            state: 'missing',
                            target_dir: my_dir,
                            assets: [my_asset],
                        },
                        () => {}
                    )
                ).toBe(true);
                expect(
                    fs.readFileSync(
                        path.join(my_dir, my_def.name),
                        'utf-8'
                    )
                ).toBe(my_asset.bundled_content);
            });

            it('never overwrites a foreign file and leaves it intact', () => {
                const my_dir = create_temp_dir();
                const my_foreign =
                    `*! my own ${my_def.name}\nprogram define x\nend\n`;
                fs.writeFileSync(
                    path.join(my_dir, my_def.name),
                    my_foreign
                );

                const my_asset = make_abbrev_asset(my_def, my_dir);
                expect(my_asset.state).toBe('foreign');

                expect(
                    install_bundle(
                        {
                            state: 'up_to_date',
                            target_dir: my_dir,
                            assets: [my_asset],
                        },
                        () => {}
                    )
                ).toBe(true);
                expect(
                    fs.readFileSync(
                        path.join(my_dir, my_def.name),
                        'utf-8'
                    )
                ).toBe(my_foreign);
            });

            it('uninstall removes a Sight-owned copy but not a foreign one', () => {
                const my_owned_dir = create_temp_dir();
                const my_owned = make_abbrev_asset(
                    my_def,
                    my_owned_dir
                );
                fs.writeFileSync(
                    path.join(my_owned_dir, my_def.name),
                    my_owned.bundled_content as string
                );
                uninstall_bundle(
                    {
                        state: 'up_to_date',
                        target_dir: my_owned_dir,
                        assets: [my_owned],
                    },
                    () => {}
                );
                expect(
                    fs.existsSync(
                        path.join(my_owned_dir, my_def.name)
                    )
                ).toBe(false);

                const my_foreign_dir = create_temp_dir();
                const my_foreign =
                    `*! my own ${my_def.name}\nprogram define x\nend\n`;
                fs.writeFileSync(
                    path.join(my_foreign_dir, my_def.name),
                    my_foreign
                );
                uninstall_bundle(
                    {
                        state: 'up_to_date',
                        target_dir: my_foreign_dir,
                        assets: [
                            make_abbrev_asset(my_def, my_foreign_dir),
                        ],
                    },
                    () => {}
                );
                expect(
                    fs.readFileSync(
                        path.join(my_foreign_dir, my_def.name),
                        'utf-8'
                    )
                ).toBe(my_foreign);
            });
        });
    }
});

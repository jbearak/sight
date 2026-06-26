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
        content: string,
        extra: Partial<AdoAssetStatus>
    ): AdoAssetStatus => {
        const my_asset: AdoAsset = {
            name,
            target_path: path.join(target_dir, name),
            bundled_path: path.join('/bundle', name),
            bundled_content: content,
            marker,
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
            `${VVIEW_MARKER}\nprogram define vview\nend\n`,
            overrides.vview ?? {}
        ),
        make(
            'browse.ado',
            BROWSE_MARKER,
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
                },
                () => {}
            )
        ).toBe('error');
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

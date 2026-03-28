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
    ensure_vview_ado_installed,
    get_vview_install_permission,
    get_vview_install_state,
    install_vview_ado,
    install_vview_ado_manually,
    reset_vview_install_permission,
    type VviewInstallContextLike,
    type VviewInstallHooks,
    type VviewInstallPermission,
    type VviewInstallStatus,
} from '../../../client/src/data-browser/vview-install-core';

const VVIEW_INSTALL_PERMISSION_KEY =
    'sight.vviewInstallPermission';
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
        my_state.set(
            VVIEW_INSTALL_PERMISSION_KEY,
            permission
        );
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

function build_status(
    state: VviewInstallStatus['state']
): VviewInstallStatus {
    return {
        state,
        target_dir: '/tmp/personal',
        target_path: '/tmp/personal/vview.ado',
        bundled_path: '/bundle/vview.ado',
        bundled_content: 'program define vview\nend\n',
    };
}

afterEach(() => {
    for (const my_dir of the_temp_dirs.splice(0)) {
        fs.rmSync(my_dir, { recursive: true, force: true });
    }
});

describe('vview install state detection', () => {
    it('returns missing when target file is absent', () => {
        const my_dir = create_temp_dir();
        const my_target_path = path.join(
            my_dir,
            'vview.ado'
        );

        const my_state = get_vview_install_state(
            my_target_path,
            'content',
            () => {}
        );

        expect(my_state).toBe('missing');
    });

    it('returns up_to_date when target matches bundled content', () => {
        const my_dir = create_temp_dir();
        const my_target_path = path.join(
            my_dir,
            'vview.ado'
        );
        fs.writeFileSync(my_target_path, 'content');

        const my_state = get_vview_install_state(
            my_target_path,
            'content',
            () => {}
        );

        expect(my_state).toBe('up_to_date');
    });

    it('returns outdated when target differs from bundled content', () => {
        const my_dir = create_temp_dir();
        const my_target_path = path.join(
            my_dir,
            'vview.ado'
        );
        fs.writeFileSync(my_target_path, 'old');

        const my_state = get_vview_install_state(
            my_target_path,
            'new',
            () => {}
        );

        expect(my_state).toBe('outdated');
    });
});

describe('vview install orchestration', () => {
    it('prompts on startup when permission is unset and install is missing', async () => {
        const my_context = create_context();
        const the_logs: string[] = [];
        let my_prompt_calls = 0;

        await ensure_vview_ado_installed(
            my_context,
            (msg) => the_logs.push(msg),
            VVIEW_INSTALL_PERMISSION_KEY,
            {
                inspect_installation: () =>
                    build_status('missing'),
                prompt_for_vview_install: async () => {
                    my_prompt_calls += 1;
                    return 'not_now';
                },
            }
        );

        expect(my_prompt_calls).toBe(1);
        expect(
            get_vview_install_permission(
                my_context,
                VVIEW_INSTALL_PERMISSION_KEY
            )
        ).toBeUndefined();
        expect(the_logs).toContain(
            'vview.ado: prompting for install permission'
        );
    });

    it('installs without prompting when permission was already granted', async () => {
        const my_context = create_context('granted');
        let my_prompt_calls = 0;
        let my_install_calls = 0;

        const my_result =
            await ensure_vview_ado_installed(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () =>
                        build_status('missing'),
                    prompt_for_vview_install: async () => {
                        my_prompt_calls += 1;
                        return 'install';
                    },
                    install_vview_ado: () => {
                        my_install_calls += 1;
                        return true;
                    },
                }
            );

        expect(my_result).toBe(true);
        expect(my_prompt_calls).toBe(0);
        expect(my_install_calls).toBe(1);
    });

    it('skips prompt and install when permission was declined', async () => {
        const my_context = create_context('declined');
        let my_prompt_calls = 0;
        let my_install_calls = 0;

        const my_result =
            await ensure_vview_ado_installed(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () =>
                        build_status('missing'),
                    prompt_for_vview_install: async () => {
                        my_prompt_calls += 1;
                        return 'install';
                    },
                    install_vview_ado: () => {
                        my_install_calls += 1;
                        return true;
                    },
                }
            );

        expect(my_result).toBe(false);
        expect(my_prompt_calls).toBe(0);
        expect(my_install_calls).toBe(0);
    });

    it('writes the file and stores granted permission after approval', async () => {
        const my_dir = create_temp_dir();
        const my_status: VviewInstallStatus = {
            state: 'missing',
            target_dir: my_dir,
            target_path: path.join(my_dir, 'vview.ado'),
            bundled_path: path.join(my_dir, 'bundle', 'vview.ado'),
            bundled_content: 'program define vview\nend\n',
        };
        const my_context = create_context();

        const my_result =
            await ensure_vview_ado_installed(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () => my_status,
                    prompt_for_vview_install: async () =>
                        'install',
                }
            );

        expect(my_result).toBe(true);
        expect(
            fs.readFileSync(
                my_status.target_path,
                'utf-8'
            )
        ).toBe(my_status.bundled_content);
        expect(
            get_vview_install_permission(
                my_context,
                VVIEW_INSTALL_PERMISSION_KEY
            )
        ).toBe('granted');
    });

    it('does not persist permission when the user chooses not now', async () => {
        const my_context = create_context();

        const my_result =
            await ensure_vview_ado_installed(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () =>
                        build_status('missing'),
                    prompt_for_vview_install: async () =>
                        'not_now',
                }
            );

        expect(my_result).toBe(false);
        expect(
            get_vview_install_permission(
                my_context,
                VVIEW_INSTALL_PERMISSION_KEY
            )
        ).toBeUndefined();
    });

    it('does not store declined permission when the prompt is dismissed', async () => {
        const my_context = create_context();

        const my_result =
            await ensure_vview_ado_installed(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () =>
                        build_status('missing'),
                    prompt_for_vview_install: async () =>
                        'dismissed',
                }
            );

        expect(my_result).toBe(false);
        expect(
            get_vview_install_permission(
                my_context,
                VVIEW_INSTALL_PERMISSION_KEY
            )
        ).toBeUndefined();
    });

    it('does not store granted permission if install fails after approval', async () => {
        const my_context = create_context();

        const my_result =
            await ensure_vview_ado_installed(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () =>
                        build_status('missing'),
                    prompt_for_vview_install: async () =>
                        'install',
                    install_vview_ado: () => false,
                }
            );

        expect(my_result).toBe(false);
        expect(
            get_vview_install_permission(
                my_context,
                VVIEW_INSTALL_PERMISSION_KEY
            )
        ).toBeUndefined();
    });

    it('silently updates an outdated install after prior approval', async () => {
        const my_context = create_context('granted');
        let my_prompt_calls = 0;
        let my_install_calls = 0;

        const my_result =
            await ensure_vview_ado_installed(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () =>
                        build_status('outdated'),
                    prompt_for_vview_install: async () => {
                        my_prompt_calls += 1;
                        return 'install';
                    },
                    install_vview_ado: () => {
                        my_install_calls += 1;
                        return true;
                    },
                }
            );

        expect(my_result).toBe(true);
        expect(my_prompt_calls).toBe(0);
        expect(my_install_calls).toBe(1);
    });

    it('manual install succeeds even after a prior decline', async () => {
        const my_context = create_context('declined');
        let my_install_calls = 0;

        const my_result =
            await install_vview_ado_manually(
                my_context,
                () => {},
                VVIEW_INSTALL_PERMISSION_KEY,
                {
                    inspect_installation: () =>
                        build_status('missing'),
                    install_vview_ado: () => {
                        my_install_calls += 1;
                        return true;
                    },
                }
            );

        expect(my_result).toBe(true);
        expect(my_install_calls).toBe(1);
        expect(
            get_vview_install_permission(
                my_context,
                VVIEW_INSTALL_PERMISSION_KEY
            )
        ).toBe('granted');
    });

    it('reset clears remembered install permission', async () => {
        const my_context = create_context('declined');

        await reset_vview_install_permission(
            my_context,
            () => {},
            VVIEW_INSTALL_PERMISSION_KEY
        );

        expect(
            get_vview_install_permission(
                my_context,
                VVIEW_INSTALL_PERMISSION_KEY
            )
        ).toBeUndefined();
    });
});

describe('vview file installation', () => {
    it('writes bundled content to the target path', () => {
        const my_dir = create_temp_dir();
        const my_status: VviewInstallStatus = {
            state: 'missing',
            target_dir: my_dir,
            target_path: path.join(my_dir, 'vview.ado'),
            bundled_path: path.join(my_dir, 'bundle', 'vview.ado'),
            bundled_content: 'program define vview\nend\n',
        };
        const the_logs: string[] = [];

        const my_result = install_vview_ado(
            my_status,
            (msg) => the_logs.push(msg)
        );

        expect(my_result).toBe(true);
        expect(
            fs.readFileSync(
                my_status.target_path,
                'utf-8'
            )
        ).toBe(my_status.bundled_content);
        expect(the_logs).toContain(
            'vview.ado: installed to '
            + my_status.target_path
        );
    });
});

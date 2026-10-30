/**
 * Finds the Stata console binary for `sight console`.
 *
 * Order: `--stata`, then `SIGHT_STATA_PATH`, then each edition on PATH
 * (most capable first), then the macOS app bundles. This mirrors the VS
 * Code client's detector (`client/src/send-to-stata/stata-cli-detector.ts`
 * and `stata-install-roots.ts`); the client is a separate build unit, so
 * keep the edition order and install roots in sync with it.
 */

import * as fs from 'fs';
import * as path from 'path';

const CLI_BINARIES: readonly string[] =
    ['stata-mp', 'stata-se', 'stata-be', 'stata-ic', 'stata'];

const MAC_APP_INSTALL_ROOTS: readonly string[] = [
    '/Applications/Stata',
    '/Applications/StataNow',
];

const CLI_TO_APP_SUBPATH: Readonly<Record<string, string>> = {
    'stata-mp': 'StataMP.app/Contents/MacOS/stata-mp',
    'stata-se': 'StataSE.app/Contents/MacOS/stata-se',
    'stata-be': 'StataBE.app/Contents/MacOS/stata-be',
    'stata-ic': 'StataIC.app/Contents/MacOS/stata-ic',
    'stata': 'Stata.app/Contents/MacOS/stata',
};

export type LocateResult =
    | { found: true; path: string }
    | { found: false; error: string };

export interface LocateOptions {
    explicit_path?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    is_executable?: (file_path: string) => boolean;
}

/**
 * True for an existing executable file. `statSync` follows symlinks, so a
 * symlink to a binary counts and a dangling symlink does not.
 */
export function is_executable_file(file_path: string): boolean {
    try {
        if (!fs.statSync(file_path).isFile()) {
            return false;
        }
        fs.accessSync(file_path, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

export function locate_stata(options: LocateOptions = {}): LocateResult {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const is_executable = options.is_executable ?? is_executable_file;

    const requested = options.explicit_path ?? env.SIGHT_STATA_PATH;
    if (requested) {
        const source = options.explicit_path ? '--stata' : 'SIGHT_STATA_PATH';
        return is_executable(requested)
            ? { found: true, path: requested }
            : { found: false, error: `${source} is not an executable file: ${requested}` };
    }

    const the_path_dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
    for (const my_binary of CLI_BINARIES) {
        for (const my_dir of the_path_dirs) {
            const candidate = path.join(my_dir, my_binary);
            if (is_executable(candidate)) {
                return { found: true, path: candidate };
            }
        }
    }

    if (platform === 'darwin') {
        for (const my_binary of CLI_BINARIES) {
            const subpath = CLI_TO_APP_SUBPATH[my_binary];
            if (!subpath) {
                continue;
            }
            for (const my_root of MAC_APP_INSTALL_ROOTS) {
                const candidate = `${my_root}/${subpath}`;
                if (is_executable(candidate)) {
                    return { found: true, path: candidate };
                }
            }
        }
    }

    return {
        found: false,
        error: 'Stata console not found. Put stata-mp, stata-se, stata-be, '
            + 'stata-ic or stata on your PATH, or pass --stata PATH.',
    };
}

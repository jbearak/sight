/**
 * Stata install path auto-discovery
 *
 * Probes well-known Stata install and user ado directories across
 * macOS, Linux, and Windows. Returns only paths that actually exist.
 *
 * Used by the help-topic resolver so users can click a hover link and
 * open a `.sthlp` file without first having to configure
 * `sight.adoPaths` by hand — the base ado directory that ships with
 * every Stata install (home of `help include`, `help display`, etc.)
 * is picked up automatically when it lives in a standard location.
 *
 * This module intentionally avoids doing any work that would slow
 * startup: `fs.existsSync` is called at most a few hundred times
 * (the Windows candidate set, which includes drive-root probing
 * across mounted letters, is ~150–170 paths), on paths shallow
 * enough that the check is effectively free. The resolver consumes
 * the returned list for lookups — it does NOT add these directories
 * to the workspace scanner, so we never start recursively indexing
 * thousands of built-in `.ado` files.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Major Stata release versions to probe for under install roots.
// We scan in newest-first order so that a user with multiple versions
// installed gets the most recent one picked first. The range covers
// the common in-the-wild releases (13 through 18 are supported by the
// command-database generator) plus a small lookahead.
const STATA_MAJOR_VERSIONS = [20, 19, 18, 17, 16, 15, 14, 13];

const WINDOWS_VARIANT_DIRS = ['Stata'];
// StataNow is Stata's subscription release channel; it installs under
// `/Applications/StataNow/` rather than `/Applications/Stata/` (the .app
// bundle inside is still named by flavour, e.g. `StataSE.app`). We probe
// both roots so ado/help discovery works regardless of channel.
// NOTE: the VS Code extension keeps a parallel macOS root list in
// `client/src/send-to-stata/stata-install-roots.ts`; the two are separate
// build units, so keep the StataNow entry in sync across both.
const MAC_VARIANT_DIRS = [
    'Stata', 'StataMP', 'StataSE', 'StataBE', 'StataIC', 'StataNow',
];

// Drive letters to probe for drive-root installs like `C:\Stata18` or
// `D:\Stata18`. Many institutional and lab-image Windows machines put
// Stata directly under a drive root rather than under Program Files,
// either to avoid UAC issues during install or because `C:` is small
// and a separate data drive is preferred. Each candidate is filtered
// by `fs.statSync`, so non-existent drives cost a single failed stat.
const WINDOWS_DRIVE_LETTERS = ['C:', 'D:', 'E:'];

/**
 * Test-friendly options for path discovery. Each field defaults to
 * the real-world value so production callers can invoke
 * `discover_stata_ado_paths()` with no arguments.
 */
export interface DiscoverStataPathsOptions {
    /** Override the user's home directory (for tests). */
    home?: string;
    /** Override the platform name (for tests). */
    platform?: NodeJS.Platform;
    /**
     * Override the file-existence predicate (for tests). Must return
     * true if the given absolute path refers to an existing directory.
     */
    exists?: (candidate_path: string) => boolean;
    /**
     * Override environment variable lookup (for tests). Defaults to
     * `process.env`. Used on Windows to honour ProgramFiles, etc.
     */
    env?: Record<string, string | undefined>;
}

/**
 * Return the list of existing Stata-related ado directories that are
 * likely to contain `.sthlp` help files.
 *
 * The returned list is de-duplicated, order-stable, and composed of
 * absolute paths. Paths that do not currently exist are omitted so the
 * resolver can treat every entry as a safe `fs.access` target.
 */
export function discover_stata_ado_paths(
    options: DiscoverStataPathsOptions = {}
): string[] {
    const my_home = options.home ?? os.homedir();
    const my_platform = options.platform ?? process.platform;
    const my_exists = options.exists ?? ((p: string) => {
        try {
            return fs.statSync(p).isDirectory();
        } catch {
            return false;
        }
    });
    const my_env = options.env ?? (process.env as Record<string, string | undefined>);

    // Use platform-appropriate path semantics. This makes the tests
    // deterministic when running on a host whose native separator
    // differs from the platform under test.
    const my_path = path_for_platform(my_platform);
    const the_candidates = gather_candidates(my_home, my_platform, my_env, my_path);

    const the_seen = new Set<string>();
    const the_result: string[] = [];
    for (const my_candidate of the_candidates) {
        if (!my_candidate) continue;
        const my_normalized = my_path.resolve(my_candidate);
        if (the_seen.has(my_normalized)) continue;
        the_seen.add(my_normalized);
        if (my_exists(my_normalized)) {
            the_result.push(my_normalized);
        }
    }
    return the_result;
}

function path_for_platform(
    platform: NodeJS.Platform
): typeof path.posix | typeof path.win32 {
    return platform === 'win32' ? path.win32 : path.posix;
}

function gather_candidates(
    home: string,
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>,
    my_path: typeof path.posix | typeof path.win32
): string[] {
    const the_paths: string[] = [];

    // User-level ado directories (applicable on every platform).
    // `resolve_sthlp_file` probes both `dir/<letter>/topic.sthlp` and
    // `dir/topic.sthlp`, so including the ado root itself covers very
    // old installs that drop .sthlp files directly under `~/ado/`.
    for (const my_user_root of user_ado_roots(home, platform, env, my_path)) {
        the_paths.push(my_user_root);
        the_paths.push(my_path.join(my_user_root, 'personal'));
        the_paths.push(my_path.join(my_user_root, 'plus'));
    }

    // System / install ado directories.
    for (const my_install_root of stata_install_roots(platform, env, my_path)) {
        the_paths.push(my_path.join(my_install_root, 'ado', 'base'));
        the_paths.push(my_path.join(my_install_root, 'ado', 'site'));
        the_paths.push(my_path.join(my_install_root, 'ado', 'updates'));
    }

    return the_paths;
}

function user_ado_roots(
    home: string,
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>,
    my_path: typeof path.posix | typeof path.win32
): string[] {
    const the_roots: string[] = [
        // Cross-platform legacy convention that Stata's sysdir defaults to.
        my_path.join(home, 'ado'),
    ];
    if (platform === 'darwin') {
        // Modern macOS PERSONAL / PLUS location used by Stata 17+.
        the_roots.push(
            my_path.join(
                home,
                'Library',
                'Application Support',
                'Stata',
                'ado'
            )
        );
    }
    if (platform === 'win32') {
        // Stata's documented Windows defaults for PERSONAL, PLUS, and
        // OLDPLACE live at the system-drive root (e.g. `C:\ado\plus`),
        // not under the user's home directory. See `help sysdir`.
        // We probe both `%SystemDrive%\ado` and a hardcoded `C:\ado`
        // fallback in case the env var is missing.
        const the_drive_roots = new Set<string>();
        const my_system_drive = env['SystemDrive'];
        if (my_system_drive && my_system_drive.length > 0) {
            the_drive_roots.add(my_system_drive);
        }
        the_drive_roots.add('C:');
        for (const my_drive of the_drive_roots) {
            the_roots.push(my_path.join(my_drive + '\\', 'ado'));
        }
    }
    return the_roots;
}

function stata_install_roots(
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>,
    my_path: typeof path.posix | typeof path.win32
): string[] {
    if (platform === 'darwin') {
        return mac_install_roots(my_path);
    }
    if (platform === 'win32') {
        return windows_install_roots(env, my_path);
    }
    // Linux, FreeBSD, etc. treat as POSIX with standard prefixes.
    return posix_install_roots(my_path);
}

function mac_install_roots(
    my_path: typeof path.posix | typeof path.win32
): string[] {
    const the_roots: string[] = [];
    for (const my_variant of MAC_VARIANT_DIRS) {
        the_roots.push(my_path.join('/Applications', my_variant));
    }
    return the_roots;
}

function windows_install_roots(
    env: Record<string, string | undefined>,
    my_path: typeof path.posix | typeof path.win32
): string[] {
    const the_program_files_roots = new Set<string>();
    for (const my_var of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
        const my_value = env[my_var];
        if (my_value && my_value.length > 0) {
            the_program_files_roots.add(my_value);
        }
    }
    if (the_program_files_roots.size === 0) {
        // Common defaults when the env vars are unavailable.
        the_program_files_roots.add('C:\\Program Files');
        the_program_files_roots.add('C:\\Program Files (x86)');
    }
    const the_roots: string[] = [];
    for (const my_pf of the_program_files_roots) {
        for (const my_version of STATA_MAJOR_VERSIONS) {
            the_roots.push(my_path.join(my_pf, `Stata${my_version}`));
        }
        for (const my_variant of WINDOWS_VARIANT_DIRS) {
            the_roots.push(my_path.join(my_pf, my_variant));
        }
    }
    // Drive-root installs (e.g. `C:\Stata18`, `D:\Stata`). Common on
    // lab images and on machines where the `C:` drive is small. Stata's
    // installer accepts an arbitrary destination, and many older
    // installs predate the Program Files convention entirely.
    for (const my_drive of WINDOWS_DRIVE_LETTERS) {
        const my_drive_root = my_drive + '\\';
        for (const my_version of STATA_MAJOR_VERSIONS) {
            the_roots.push(my_path.join(my_drive_root, `Stata${my_version}`));
        }
        for (const my_variant of WINDOWS_VARIANT_DIRS) {
            the_roots.push(my_path.join(my_drive_root, my_variant));
        }
    }
    return the_roots;
}

function posix_install_roots(
    my_path: typeof path.posix | typeof path.win32
): string[] {
    const the_roots: string[] = [];
    for (const my_prefix of ['/usr/local', '/opt']) {
        for (const my_version of STATA_MAJOR_VERSIONS) {
            the_roots.push(my_path.join(my_prefix, `stata${my_version}`));
        }
        the_roots.push(my_path.join(my_prefix, 'stata'));
    }
    return the_roots;
}

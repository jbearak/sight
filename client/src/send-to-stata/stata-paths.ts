/**
 * Pure helpers for locating Stata installs on macOS.
 *
 * Kept free of `vscode` / `fs` imports so the path logic can be unit
 * tested directly (the surrounding detectors inject the real
 * filesystem checks). See `stata-detector.ts` (GUI app, AppleScript)
 * and `stata-cli-detector.ts` (terminal binary).
 */

import type { StataVariant } from './index.js';

/**
 * Parent directories under /Applications that may contain Stata .app
 * bundles on macOS, in probe-priority order.
 *
 * `/Applications/Stata` is the long-standing location for perpetual-
 * license installs. `/Applications/StataNow` is where StataNow (the
 * subscription edition) installs by default. Both directories hold the
 * same variant bundles (e.g. `StataSE.app`), and the AppleScript
 * application name is the bundle name (`StataSE`) regardless of which
 * directory it lives in — so the only thing that differs is where we
 * look on disk.
 */
export const MACOS_APP_DIRS: readonly string[] = [
    '/Applications/Stata',
    '/Applications/StataNow',
];

/**
 * GUI variant bundle names, in detection priority order
 * (StataMP > StataSE > StataIC > Stata).
 */
export const MACOS_VARIANT_PRIORITY: readonly StataVariant[] = [
    'StataMP', 'StataSE', 'StataIC', 'Stata',
];

/**
 * Candidate `.app` bundle paths for a GUI variant, across every known
 * /Applications install directory, in directory-priority order.
 */
export function macos_app_bundle_paths(
    variant: StataVariant,
    app_dirs: readonly string[] = MACOS_APP_DIRS
): string[] {
    return app_dirs.map(my_app_dir => `${my_app_dir}/${variant}.app`);
}

/**
 * Find the first installed GUI variant by probing each variant (in
 * priority order) across each install directory. `exists` must resolve
 * to true when the given `.app` bundle path is present on disk.
 *
 * Variant priority is the outer loop, so e.g. StataMP in
 * /Applications/StataNow is preferred over StataSE in
 * /Applications/Stata, preserving the historical variant precedence.
 */
export async function find_installed_stata_app(
    exists: (bundle_path: string) => Promise<boolean>,
    variants: readonly StataVariant[] = MACOS_VARIANT_PRIORITY,
    app_dirs: readonly string[] = MACOS_APP_DIRS
): Promise<StataVariant | null> {
    for (const my_variant of variants) {
        for (const my_bundle_path of macos_app_bundle_paths(my_variant, app_dirs)) {
            if (await exists(my_bundle_path)) {
                return my_variant;
            }
        }
    }
    return null;
}

/**
 * Maps CLI binary names to the bundle-relative path of the executable
 * inside a macOS Stata `.app`. Combined with `MACOS_APP_DIRS` to build
 * the full fallback paths probed when the binary is not on PATH.
 */
const CLI_TO_MACOS_BUNDLE_SUFFIX: Record<string, string> = {
    'stata-mp': 'StataMP.app/Contents/MacOS/stata-mp',
    'stata-se': 'StataSE.app/Contents/MacOS/stata-se',
    'stata-ic': 'StataIC.app/Contents/MacOS/stata-ic',
    'stata-be': 'StataBE.app/Contents/MacOS/stata-be',
    'stata': 'Stata.app/Contents/MacOS/stata',
};

/**
 * macOS `.app` fallback paths for a CLI binary name, across every known
 * /Applications install directory, in directory-priority order. Returns
 * an empty list for binaries with no known bundle mapping.
 */
export function macos_cli_paths(
    binary: string,
    app_dirs: readonly string[] = MACOS_APP_DIRS
): string[] {
    const my_suffix = CLI_TO_MACOS_BUNDLE_SUFFIX[binary];
    if (!my_suffix) {
        return [];
    }
    return app_dirs.map(my_app_dir => `${my_app_dir}/${my_suffix}`);
}

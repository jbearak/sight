/**
 * Shared, vscode-free logic for locating a Stata install on macOS.
 *
 * Stata ships through two channels that install to different roots:
 *   - perpetual-license editions install under `/Applications/Stata/`
 *   - StataNow (the subscription channel) installs under
 *     `/Applications/StataNow/`
 * In both cases the `.app` bundle inside is named by edition (e.g.
 * `StataSE.app`, `StataMP.app`), so only the install root differs. We
 * probe both roots so detection works regardless of channel (#200).
 */
import type { StataVariant } from './index.js';

/**
 * macOS install roots to probe, in priority order. A perpetual install
 * is preferred over StataNow when both are present; within each root,
 * the caller's variant priority applies.
 */
export const MAC_APP_INSTALL_ROOTS: readonly string[] = [
    '/Applications/Stata',
    '/Applications/StataNow',
];

/**
 * Find the first installed Stata GUI variant by probing
 * `<root>/<variant>.app` across the given roots. Roots are tried in
 * order, and within each root the variants are tried in order, so the
 * result reflects root priority first, then variant priority.
 *
 * `exists` must resolve true when the candidate `.app` bundle is present.
 */
export async function find_installed_variant(
    roots: readonly string[],
    variants: readonly StataVariant[],
    exists: (app_path: string) => Promise<boolean>
): Promise<StataVariant | null> {
    for (const my_root of roots) {
        for (const my_variant of variants) {
            if (await exists(`${my_root}/${my_variant}.app`)) {
                return my_variant;
            }
        }
    }
    return null;
}

/**
 * The macOS `.app` bundle subpath (relative to an install root) for each
 * Unix CLI binary name. Combined with `MAC_APP_INSTALL_ROOTS` to build
 * full candidate paths.
 */
const CLI_TO_APP_SUBPATH: Record<string, string> = {
    'stata-mp': 'StataMP.app/Contents/MacOS/stata-mp',
    'stata-se': 'StataSE.app/Contents/MacOS/stata-se',
    'stata-ic': 'StataIC.app/Contents/MacOS/stata-ic',
    'stata-be': 'StataBE.app/Contents/MacOS/stata-be',
    'stata': 'Stata.app/Contents/MacOS/stata',
};

/**
 * Build the list of candidate macOS CLI binary paths for a Unix CLI
 * binary name, one per install root (perpetual first, then StataNow).
 * Returns an empty list for an unrecognized binary name.
 */
export function macos_cli_candidate_paths(binary: string): string[] {
    const my_subpath = CLI_TO_APP_SUBPATH[binary];
    if (!my_subpath) {
        return [];
    }
    return MAC_APP_INSTALL_ROOTS.map(my_root => `${my_root}/${my_subpath}`);
}

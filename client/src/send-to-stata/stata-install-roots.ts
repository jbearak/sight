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
 *
 * NOTE: the server (`src/utils/stata-install-paths.ts`) keeps its own
 * macOS root list for ado/help discovery. That is deliberate: the server
 * is a separate build unit (CommonJS LSP bundle) with no import path to
 * `client/src`, and it works in terms of variant *directories* under
 * `/Applications` rather than full `.app` roots. Keep the StataNow entry
 * in both in sync.
 */
import type { StataVariant } from './index.js';

/**
 * macOS install roots to probe. When the same edition exists under both
 * roots, the perpetual `/Applications/Stata/` install is preferred over
 * StataNow (it appears first). Edition priority outranks channel — see
 * `find_installed_variant`.
 */
export const MAC_APP_INSTALL_ROOTS: readonly string[] = [
    '/Applications/Stata',
    '/Applications/StataNow',
];

/**
 * Find the best installed Stata GUI variant by probing
 * `<root>/<variant>.app`. Variants are tried in order (outer loop) and,
 * for each, the roots are tried in order (inner loop), so the result
 * reflects edition priority first, then channel/root priority. This
 * matches the CLI detector's edition-first fallback: a user who has a
 * more capable edition installed gets it regardless of channel.
 *
 * `exists` must resolve true when the candidate `.app` bundle is present.
 */
export async function find_installed_variant(
    the_roots: readonly string[],
    the_variants: readonly StataVariant[],
    exists: (app_path: string) => Promise<boolean>
): Promise<StataVariant | null> {
    for (const my_variant of the_variants) {
        for (const my_root of the_roots) {
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

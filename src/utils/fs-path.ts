/**
 * Canonical filesystem-path form and URI-to-path conversion.
 *
 * Sight's canonical form for a filesystem path is Node's: on Windows an
 * UPPER-case drive letter and native `\` separators (`C:\proj\a.do`),
 * which is what `path.resolve`, `os.tmpdir()`, `process.cwd()` and
 * `fs.realpathSync.native` return. `vscode-uri`'s `fsPath` instead
 * lower-cases the drive letter (`c:\proj\a.do`), so a path taken from a
 * URI and a root taken from Node would otherwise disagree on a
 * case-sensitive `startsWith`. Every URI-to-path conversion in the
 * server goes through `uri_to_fs_path` so both sides share one form.
 *
 * Only the drive letter and a UNC host name (`\\Server\share`, which a
 * URI lower-cases) are folded: the rest of a Windows path keeps the
 * casing it was given, because case-only mismatches below a workspace
 * root are reported on purpose (see docs/cross-file.md, "Case-Only Path
 * Mismatch Handling"). The drive letter is not part of that contract —
 * Windows never distinguishes `c:` from `C:` — so a path typed in Stata
 * source as `c:\proj\a.do` must still be found inside the root
 * `C:\proj`.
 *
 * Each helper takes the platform as a parameter (default: the host) so
 * the Windows behaviour is exercised by unit tests on any host.
 */

import * as node_path from 'path';
import { URI } from 'vscode-uri';

/** The platform whose path rules a helper applies. */
export type PathPlatform = NodeJS.Platform;

const LOWER_DRIVE_LETTER_PATTERN = /^([a-z]):/;
const FORWARD_SLASH_PATTERN = /\//g;
const BACKSLASH_PATTERN = /\\/g;
const URI_DRIVE_PATH_PATTERN = /^\/[a-zA-Z]:/;
// `\\host` or the extended form `\\?\UNC\host`, in either separator.
const UNC_HOST_PATTERN = /^([\\/]{2}(?:\?[\\/]UNC[\\/])?)([^\\/]+)/i;
const DRIVE_RELATIVE_PATTERN = /^([a-zA-Z]):(?![\\/])/;
const DRIVE_PREFIX_PATTERN = /^([a-zA-Z]):/;

/** The Node `path` implementation for `platform`. */
export function path_module_for(
    platform: PathPlatform = process.platform,
): node_path.PlatformPath {
    return platform === 'win32' ? node_path.win32 : node_path.posix;
}

/** Lower-case a UNC host name; any other text is unchanged. */
function lower_case_unc_host(fs_path: string): string {
    return fs_path.replace(
        UNC_HOST_PATTERN,
        (_match, prefix: string, host: string) =>
            `${prefix}${host.toLowerCase()}`,
    );
}

/** Upper-case a leading `x:` drive letter; any other text is unchanged. */
function upper_case_drive_letter(fs_path: string): string {
    return fs_path.replace(
        LOWER_DRIVE_LETTER_PATTERN,
        (_match, drive: string) => `${drive.toUpperCase()}:`,
    );
}

/**
 * Put `fs_path` in Sight's canonical form for `platform`.
 *
 * On Windows: `/` becomes `\`, a leading drive letter is upper-cased
 * and a UNC host name (`\\Server\share`) is lower-cased, which is the
 * form a URI gives it and which Windows treats as the same host.
 * On every other platform the path is returned unchanged. The path is
 * not resolved or normalised otherwise (no `.`/`..` folding).
 */
export function canonical_fs_path(
    fs_path: string,
    platform: PathPlatform = process.platform,
): string {
    if (platform !== 'win32') {
        return fs_path;
    }
    return lower_case_unc_host(upper_case_drive_letter(
        fs_path.replace(FORWARD_SLASH_PATTERN, '\\'),
    ));
}

/**
 * On Windows `C:foo.do` names `foo.do` in drive C's current directory.
 * When `base_dir` is on that drive, give the part after the drive
 * (`foo.do`), to be joined with `base_dir` like any relative path.
 * A path on another drive, whose current directory is unknown, and
 * every path on another platform are returned unchanged.
 */
export function drive_relative_rest(
    fs_path: string,
    base_dir: string,
    platform: PathPlatform = process.platform,
): string {
    if (platform !== 'win32') {
        return fs_path;
    }
    const my_drive = DRIVE_RELATIVE_PATTERN.exec(fs_path)?.[1];
    const my_base_drive = DRIVE_PREFIX_PATTERN.exec(base_dir)?.[1];
    if (
        my_drive === undefined ||
        my_base_drive === undefined ||
        my_drive.toUpperCase() !== my_base_drive.toUpperCase()
    ) {
        return fs_path;
    }
    return fs_path.slice(2);
}

/**
 * Convert a URI (string or parsed) to a filesystem path in canonical
 * form. Use this instead of a bare `URI.parse(uri).fsPath`.
 *
 * This is `vscode-uri`'s `fsPath` rule with the platform as a
 * parameter (`fsPath` reads the host's): a `file:` URI with an
 * authority is a UNC path, `/c:/...` is a drive path, and anything else
 * is the decoded URI path. The result is then put in canonical form.
 */
export function uri_to_fs_path(
    uri: string | URI,
    platform: PathPlatform = process.platform,
): string {
    const my_uri = typeof uri === 'string' ? URI.parse(uri) : uri;
    const my_path = my_uri.path;
    let my_fs_path: string;
    if (
        my_uri.authority &&
        my_path.length > 1 &&
        my_uri.scheme === 'file'
    ) {
        my_fs_path = `//${my_uri.authority}${my_path}`;
    } else if (URI_DRIVE_PATH_PATTERN.test(my_path)) {
        // `fsPath` lower-cases the drive letter; canonical_fs_path
        // upper-cases it again on Windows.
        my_fs_path = my_path[1]!.toLowerCase() + my_path.slice(2);
    } else {
        my_fs_path = my_path;
    }
    return canonical_fs_path(my_fs_path, platform);
}

/**
 * A `/`-separated form of `fs_path` for prefix comparisons, with the
 * drive letter upper-cased and a UNC host name lower-cased on Windows. The path-case walk compares in
 * this form on every platform (fixtures use `/` everywhere), so `\` is
 * converted on every platform, as that walk always has.
 */
export function slashed_comparison_path(
    fs_path: string,
    platform: PathPlatform = process.platform,
): string {
    const my_slashed = fs_path.replace(BACKSLASH_PATTERN, '/');
    return platform === 'win32'
        ? lower_case_unc_host(upper_case_drive_letter(my_slashed))
        : my_slashed;
}

/**
 * True when `fs_path` is `root` or lies below it. Both are resolved and
 * put in canonical form first, so on Windows the drive letter's case
 * does not matter; the rest of the comparison is exact.
 */
export function is_path_within_root(
    fs_path: string,
    root: string,
    platform: PathPlatform = process.platform,
): boolean {
    const the_path = path_module_for(platform);
    const my_path = canonical_fs_path(the_path.resolve(fs_path), platform);
    const my_root = canonical_fs_path(the_path.resolve(root), platform);
    if (my_path === my_root) {
        return true;
    }
    const my_prefix = my_root.endsWith(the_path.sep)
        ? my_root
        : my_root + the_path.sep;
    return my_path.startsWith(my_prefix);
}

/**
 * `fs_path` without separators at its end, so one directory has one
 * spelling: `work/` and `work` name the same directory, but compare
 * unequal as strings. A filesystem or drive root keeps its separator,
 * and so does a path made only of separators.
 */
export function without_trailing_separators(
    fs_path: string,
    platform: PathPlatform = process.platform,
): string {
    const is_separator = (character: string | undefined): boolean =>
        character === '/' || (platform === 'win32' && character === '\\');
    const root_length = path_module_for(platform).parse(fs_path).root.length;
    let end = fs_path.length;
    while (end > root_length && is_separator(fs_path[end - 1])) {
        end--;
    }
    return fs_path.slice(0, end);
}

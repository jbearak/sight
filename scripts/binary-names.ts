/**
 * Shared CLI binary names for source and package installation.
 */

import { join } from 'path';
import {
    LEGACY_BINARY_NAME,
    PRIMARY_BINARY_NAME,
} from '../src/cli-binary-names';

export {
    LEGACY_BINARY_NAME,
    PRIMARY_BINARY_NAME,
} from '../src/cli-binary-names';

/**
 * Get the primary installed binary name (with .exe on Windows).
 */
export function get_binary_name(
    platform: NodeJS.Platform = process.platform
): string {
    return platform === 'win32'
        ? `${PRIMARY_BINARY_NAME}.exe`
        : PRIMARY_BINARY_NAME;
}

/**
 * Get the legacy installed binary name (with .exe on Windows).
 */
export function get_legacy_binary_name(
    platform: NodeJS.Platform = process.platform
): string {
    return platform === 'win32'
        ? `${LEGACY_BINARY_NAME}.exe`
        : LEGACY_BINARY_NAME;
}

/**
 * Get all binary names that source install should write.
 */
export function get_binary_names_to_install(
    platform: NodeJS.Platform = process.platform
): string[] {
    return [
        get_binary_name(platform),
        get_legacy_binary_name(platform),
    ];
}

/**
 * Get all binary names that source uninstall should remove.
 */
export function get_binary_names_to_uninstall(
    platform: NodeJS.Platform = process.platform
): string[] {
    return get_binary_names_to_install(platform);
}

/**
 * Get installed binary paths for source install.
 */
export function get_binary_paths_to_install(
    user_bin_path: string,
    platform: NodeJS.Platform = process.platform
): string[] {
    return get_binary_names_to_install(platform).map(
        (binary_name) => join(user_bin_path, binary_name)
    );
}

/**
 * Get command paths that would be shadowed by source install on Windows.
 */
export function get_binary_shadow_paths_to_check(
    user_bin_path: string,
    platform: NodeJS.Platform = process.platform
): string[] {
    if (platform !== 'win32') {
        return [];
    }

    const the_base_names = [
        PRIMARY_BINARY_NAME,
        LEGACY_BINARY_NAME,
    ];
    const the_extensions = ['', '.cmd', '.bat', '.ps1'];

    return the_base_names.flatMap((binary_name) =>
        the_extensions.map((extension) => join(
            user_bin_path,
            `${binary_name}${extension}`
        ))
    );
}

/**
 * Get installed binary paths for source uninstall.
 */
export function get_binary_paths_to_uninstall(
    user_bin_path: string,
    platform: NodeJS.Platform = process.platform
): string[] {
    return get_binary_names_to_uninstall(platform).map(
        (binary_name) => join(user_bin_path, binary_name)
    );
}

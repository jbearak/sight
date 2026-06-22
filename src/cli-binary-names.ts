/**
 * Public CLI command names.
 */

export const PRIMARY_BINARY_NAME = 'sight';
export const LEGACY_BINARY_NAME = 'sight-language-server';
// Version-less tagline. The help banner composes this with the version
// (`sight <version>, <description>`); keeping it version-less lets it double as
// a stable identity marker for compiled binaries across releases.
export const CLI_DESCRIPTION =
    'a static analyzer and language server for Stata.';
export const SUPPORTED_BINARY_PLATFORMS = [
    'darwin',
    'linux',
    'windows',
] as const;
export const SUPPORTED_BINARY_ARCHS = ['x64', 'arm64'] as const;

export type BinaryPlatform = typeof SUPPORTED_BINARY_PLATFORMS[number];
export type BinaryArch = typeof SUPPORTED_BINARY_ARCHS[number];

export const NATIVE_BINARY_NAME_PATTERN = new RegExp(
    `^sight-(${SUPPORTED_BINARY_PLATFORMS.join('|')})-` +
    `(${SUPPORTED_BINARY_ARCHS.join('|')})(\\.exe)?$`
);

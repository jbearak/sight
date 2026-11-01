#!/usr/bin/env bun
/**
 * Classifies a Sight version as a stable or pre-release release.
 *
 * Usage: bun scripts/release-channel.ts <version>   # 0.18.0 or v0.18.0
 *
 * The VS Code Marketplace accepts only plain major.minor.patch versions,
 * so the channel lives in the minor number (Microsoft's recommended
 * scheme): an even minor is stable, an odd minor is a pre-release. A
 * pre-release user gets the highest version across both channels, so a
 * pre-release must be numbered above the current stable release.
 *
 * Every minor up to 0.15 shipped as stable before this scheme existed,
 * so 0.0 through 0.15 stay stable (a 0.15.x hotfix is still stable).
 * The first pre-release under the scheme is 0.17.0.
 *
 * This is the single classifier shared by the release scripts and the
 * release workflows, so they cannot disagree about a tag's channel.
 * Keep it free of imports: bump-homebrew.yml checks out only this file
 * and runs it without installing dependencies.
 */

export type ReleaseChannel = 'stable' | 'pre-release';

export interface ReleaseVersion {
    major: number;
    minor: number;
    patch: number;
}

const LAST_LEGACY_STABLE_MINOR = 15;

const RELEASE_VERSION_PATTERN =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Parses `X.Y.Z` or `vX.Y.Z`; throws for anything else. */
export function parse_release_version(version: string): ReleaseVersion {
    const match = RELEASE_VERSION_PATTERN.exec(version);
    if (!match) {
        throw new Error(
            `Invalid release version: ${version}. Expected X.Y.Z; the VS ` +
            'Code Marketplace rejects suffixes like -beta.1. Use an odd ' +
            'minor version for a pre-release instead.'
        );
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

/** Negative, zero, or positive as `a` is below, equal to, or above `b`. */
export function compare_versions(a: string, b: string): number {
    const left = parse_release_version(a);
    const right = parse_release_version(b);
    return left.major - right.major
        || left.minor - right.minor
        || left.patch - right.patch;
}

export function release_channel(version: string): ReleaseChannel {
    const { major, minor } = parse_release_version(version);
    if (major === 0 && minor <= LAST_LEGACY_STABLE_MINOR) {
        return 'stable';
    }
    return minor % 2 === 1 ? 'pre-release' : 'stable';
}

if (import.meta.main) {
    const the_args = process.argv.slice(2);
    if (the_args.length !== 1) {
        console.error('Usage: bun scripts/release-channel.ts <version>');
        process.exit(2);
    }
    try {
        console.log(release_channel(the_args[0]));
    } catch (error) {
        const message = error instanceof Error ? error.message : error;
        console.error(`ERROR: ${message}`);
        process.exit(1);
    }
}

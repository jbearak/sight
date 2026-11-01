#!/usr/bin/env bun
/**
 * Release script for creating GitHub releases.
 * 
 * Usage:
 *   bun scripts/release.ts [--dry-run] <version|patch|minor|preview|major>
 *   
 * Examples:
 *   bun scripts/release.ts 0.18.0
 *   bun scripts/release.ts preview
 *   bun scripts/release.ts --dry-run preview
 *
 * Even minor versions are stable releases and odd minor versions are
 * Marketplace pre-releases (see scripts/release-channel.ts).
 */

import { $ } from 'bun';
import { readFileSync } from 'fs';
import { createInterface } from 'readline/promises';
import { find_unknown_flags, next_version } from './bump-version';
import {
    compare_versions,
    release_channel,
    type ReleaseChannel,
} from './release-channel';

interface ReleaseConfig {
    version: string;
    tag: string;
    channel: ReleaseChannel;
}

interface ReleaseArgs {
    requested: string;
    is_dry_run: boolean;
}

const RELEASE_FLAGS: ReadonlySet<string> = new Set(['--dry-run']);

/**
 * Parses `[--dry-run] <version|bump>`. Throws on an unknown flag, so a
 * typo such as `--dryrun` cannot fall through to a real release.
 */
export function parse_release_args(the_args: string[]): ReleaseArgs {
    const the_unknown_flags = find_unknown_flags(the_args, RELEASE_FLAGS);
    if (the_unknown_flags.length > 0) {
        throw new Error(`Unknown option: ${the_unknown_flags.join(', ')}`);
    }
    const the_positional = the_args.filter((arg) => !arg.startsWith('-'));
    if (the_positional.length !== 1) {
        throw new Error('Expected one version or bump type');
    }
    return {
        requested: the_positional[0],
        is_dry_run: the_args.includes('--dry-run'),
    };
}

/**
 * Resolves a bump or explicit version against the current version.
 * Throws unless the result is a valid release version above `current`.
 */
export function resolve_release_version(
    current: string,
    requested: string
): string {
    const version = next_version(current, requested);
    if (compare_versions(version, current) <= 0) {
        throw new Error(
            `Release version ${version} must be above the current ` +
            `version ${current}`
        );
    }
    return version;
}

export function get_bump_version_args(version: string): string[] {
    return ['scripts/bump-version.ts', version, '--no-git'];
}

export function get_branch_push_ref(current_branch: string): string {
    if (!current_branch) {
        throw new Error('Cannot release from a detached HEAD');
    }

    return `HEAD:${current_branch}`;
}

/**
 * Create and push git tag.
 */
async function create_tag(config: ReleaseConfig): Promise<void> {
    console.log(`Creating tag ${config.tag}...`);
    
    try {
        await $`git tag ${config.tag}`;
        await $`git push origin ${config.tag}`;
        console.log(`Tag ${config.tag} created and pushed`);
    } catch (error) {
        console.error('Failed to create/push tag:', error);
        throw error;
    }
}

/**
 * Push the version bump commit before publishing the tag that triggers release.
 */
async function push_version_commit(): Promise<void> {
    const my_current_branch = (await $`git branch --show-current`.text())
        .trim();
    const my_push_ref = get_branch_push_ref(my_current_branch);

    await $`git push origin ${my_push_ref}`;
}

/**
 * Refuse a tag that already exists locally or on origin, before the
 * version bump commit is pushed without a matching release.
 */
async function assert_tag_is_new(tag: string): Promise<void> {
    const local = await $`git rev-parse -q --verify refs/tags/${tag}`
        .nothrow().quiet();
    if (local.exitCode === 0) {
        throw new Error(`Tag ${tag} already exists locally`);
    }

    // --exit-code: 2 means no matching ref; 0 means it exists.
    const remote = await $`git ls-remote --exit-code --tags origin refs/tags/${tag}`
        .nothrow().quiet();
    if (remote.exitCode === 0) {
        throw new Error(`Tag ${tag} already exists on origin`);
    }
    if (remote.exitCode !== 2) {
        throw new Error(
            `Could not check origin for ${tag}: ${remote.stderr.toString()}`
        );
    }
}

/**
 * Ask before a release from a terminal; scripted runs proceed.
 */
async function confirm_release(config: ReleaseConfig): Promise<boolean> {
    if (!process.stdin.isTTY) {
        return true;
    }
    const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const answer = await prompt.question(
        `Release ${config.tag} as ${config.channel}? This commits, tags, ` +
        'and pushes. [y/N] '
    );
    prompt.close();
    return /^(y|yes)$/i.test(answer.trim());
}

/**
 * Update package.json version.
 */
async function update_package_version(version: string): Promise<void> {
    console.log(`Updating package.json versions to ${version}...`);

    const [
        my_script_path,
        my_version_arg,
        my_no_git_arg,
    ] = get_bump_version_args(version);

    await $`bun ${my_script_path} ${my_version_arg} ${my_no_git_arg}`;

    await $`git add package.json client/package.json`;
    await $`git commit -m "chore: bump version to ${version}"`;
}

/**
 * Print usage information.
 */
function print_usage(): void {
    console.log(`
Usage: bun scripts/release.ts [--dry-run] <version|patch|minor|preview|major>

Examples:
  bun scripts/release.ts 0.18.0
  bun scripts/release.ts patch      # same channel: 0.18.0 → 0.18.1
  bun scripts/release.ts minor      # next stable: 0.17.2 → 0.18.0
  bun scripts/release.ts preview    # next pre-release: 0.18.1 → 0.19.0
  bun scripts/release.ts --dry-run preview   # print version and channel

Even minor versions are stable; odd minor versions are pre-releases.

This script will:
1. Update package.json versions (main + client)
2. Push the version bump commit
3. Create and push git tag
4. Trigger GitHub Action to build release artifacts

Distribution Channels:
🚀 GitHub Releases        - Direct binary downloads (pre-releases marked)
📦 npm                    - @jbearak/sight; pre-releases use the "next" tag
🎨 VS Code Marketplace    - Published only when RELEASE_PUBLISH_VSCODE=true
🌐 OpenVSX Registry       - Published only when RELEASE_PUBLISH_VSCODE=true
🍺 Homebrew               - Stable releases only

Make sure you have committed all changes before running this script.
`.trim());
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
    let release_args: ReleaseArgs;
    try {
        release_args = parse_release_args(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        print_usage();
        process.exit(1);
    }
    const { requested, is_dry_run } = release_args;

    let version: string;
    try {
        const package_json: { version?: unknown } =
            JSON.parse(readFileSync('package.json', 'utf8'));
        if (typeof package_json.version !== 'string') {
            throw new Error('package.json has no version');
        }
        version = resolve_release_version(package_json.version, requested);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }

    const config: ReleaseConfig = {
        version,
        tag: `v${version}`,
        channel: release_channel(version),
    };

    if (is_dry_run) {
        console.log(`${config.version} ${config.channel}`);
        return;
    }

    try {
        // Check git status
        const git_status = await $`git status --porcelain`.text();
        if (git_status.trim()) {
            console.error('Working directory is not clean. Please commit all changes first.');
            console.error('Uncommitted changes:');
            console.error(git_status);
            process.exit(1);
        }

        await assert_tag_is_new(config.tag);

        if (!(await confirm_release(config))) {
            console.error('Aborted.');
            process.exit(1);
        }
        console.log(`Releasing ${config.tag} (${config.channel})...`);

        // Update package version
        await update_package_version(version);

        // Push version bump commit before the tag makes the release public.
        await push_version_commit();
        
        // Create and push tag (triggers GitHub Action)
        await create_tag(config);
        
        console.log(`
✅ Release ${config.tag} (${config.channel}) initiated successfully!

What happens next:
1. 🚀 GitHub Action builds all artifacts and creates release
2. 📦 The publish workflow publishes @jbearak/sight to npm with Trusted Publishing
   (dist-tag "latest" for stable, "next" for pre-release)
3. 🎨 If RELEASE_PUBLISH_VSCODE=true, it publishes extension registry artifacts
4. 🍺 Stable releases open a Homebrew formula bump; pre-releases skip it

Next steps:
1. Check GitHub Actions: https://github.com/jbearak/sight/actions
2. Once release is created, test installations:
   - npm: npm install -g @jbearak/sight && sight --version
   - VS Code: Search for "jbearak.sight" in Extensions
   - Standalone: Download the matching sight-* release binary
`);
        
    } catch (error) {
        console.error('Release failed:', error);
        process.exit(1);
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('Release script failed:', error);
        process.exit(1);
    });
}

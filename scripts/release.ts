#!/usr/bin/env bun
/**
 * Release script for creating GitHub releases.
 * 
 * Usage:
 *   bun scripts/release.ts <version>
 *   
 * Examples:
 *   bun scripts/release.ts 0.1.0
 */

import { $ } from 'bun';

interface ReleaseConfig {
    version: string;
    tag: string;
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
    const current_branch = (await $`git branch --show-current`.text()).trim();
    const push_ref = get_branch_push_ref(current_branch);

    await $`git push origin ${push_ref}`;
}

/**
 * Update package.json version.
 */
async function update_package_version(version: string): Promise<void> {
    console.log(`Updating package.json versions to ${version}...`);

    const [script_path, version_arg, no_git_arg] = get_bump_version_args(
        version
    );

    await $`bun ${script_path} ${version_arg} ${no_git_arg}`;

    await $`git add package.json client/package.json`;
    await $`git commit -m "chore: bump version to ${version}"`;
}

/**
 * Print usage information.
 */
function print_usage(): void {
    console.log(`
Usage: bun scripts/release.ts <version>

Examples:
  bun scripts/release.ts 0.1.0
  bun scripts/release.ts 0.1.1

This script will:
1. Update package.json versions (main + client)
2. Push the version bump commit
3. Create and push git tag
4. Trigger GitHub Action to build release artifacts

Distribution Channels:
🚀 GitHub Releases        - Direct binary downloads
🎨 VS Code Marketplace    - Published only when RELEASE_PUBLISH_VSCODE=true
🌐 OpenVSX Registry       - Published only when RELEASE_PUBLISH_VSCODE=true

Make sure you have committed all changes before running this script.
`.trim());
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
    const version = process.argv[2];
    
    if (!version) {
        print_usage();
        process.exit(1);
    }
    
    // Validate version format
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
        console.error(`Invalid version format: ${version}`);
        console.error('Expected format: X.Y.Z or X.Y.Z-suffix');
        process.exit(1);
    }
    
    const config: ReleaseConfig = {
        version,
        tag: `v${version}`,
    };
    
    try {
        // Check git status
        const git_status = await $`git status --porcelain`.text();
        if (git_status.trim()) {
            console.error('Working directory is not clean. Please commit all changes first.');
            console.error('Uncommitted changes:');
            console.error(git_status);
            process.exit(1);
        }
        
        // Update package version
        await update_package_version(version);

        // Push version bump commit before the tag makes the release public.
        await push_version_commit();
        
        // Create and push tag (triggers GitHub Action)
        await create_tag(config);
        
        console.log(`
✅ Release ${config.tag} initiated successfully!

What happens next:
1. 🚀 GitHub Action builds all artifacts and creates release
2. 📦 If RELEASE_PUBLISH_VSCODE=true, it publishes extension registry artifacts

Next steps:
1. Check GitHub Actions: https://github.com/jbearak/sight/actions
2. Once release is created, test installations:
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

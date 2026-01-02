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
 * Update package.json version.
 */
async function update_package_version(version: string): Promise<void> {
    console.log(`Updating package.json versions to ${version}...`);

    await $`bun scripts/bump-version.ts ${version}`;

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
2. Create and push git tag
3. Trigger GitHub Action to build and publish

Distribution Channels:
🎨 VS Code Marketplace    - VS Code extension
🌐 OpenVSX Registry       - VSCodium, Kiro, Cursor, etc.
🚀 GitHub Releases        - Direct binary downloads

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
        
        // Create and push tag (triggers GitHub Action)
        await create_tag(config);
        
        console.log(`
✅ Release ${config.tag} initiated successfully!

What happens next:
1. 🚀 GitHub Action builds all artifacts and creates release
2. 📦 GitHub Action publishes to VS Code Marketplace + OpenVSX

Next steps:
1. Check GitHub Actions: https://github.com/jbearak/sight/actions
2. Once release is created, test installations:
   - VS Code: Search for "jbearak.sight-language-server" in Extensions
   - npm: npm install -g github:jbearak/sight
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

#!/usr/bin/env bun
/**
 * Build script for creating bundled JS and native binaries.
 * 
 * Usage:
 *   bun scripts/build-binary.ts bundle   - Create bundled JS file
 *   bun scripts/build-binary.ts binary   - Create native binaries for all platforms
 *   bun scripts/build-binary.ts all      - Create both bundle and binaries
 *   bun scripts/build-binary.ts current  - Create binary for current platform only
 */

import { $ } from 'bun';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Build target configuration.
 */
interface BuildTarget {
    platform: 'darwin' | 'linux' | 'windows';
    arch: 'x64' | 'arm64';
    output_name: string;
}

/**
 * Platform detection result.
 */
export interface PlatformInfo {
    platform: 'darwin' | 'linux' | 'windows';
    arch: 'arm64' | 'x64';
    binary_name: string;
}

/**
 * Detect the current platform and return platform info.
 * Returns undefined if the platform is not supported.
 */
export function detect_platform(): PlatformInfo | undefined {
    const platform = process.platform === 'darwin' ? 'darwin' 
        : process.platform === 'linux' ? 'linux'
        : process.platform === 'win32' ? 'windows'
        : undefined;
    
    const arch = process.arch === 'arm64' ? 'arm64'
        : process.arch === 'x64' ? 'x64'
        : undefined;

    if (!platform || !arch) {
        return undefined;
    }

    const binary_name = platform === 'windows' 
        ? `sight-${platform}-${arch}.exe`
        : `sight-${platform}-${arch}`;

    return { platform, arch, binary_name };
}

/**
 * All supported build targets.
 */
const TARGETS: BuildTarget[] = [
    { platform: 'darwin', arch: 'arm64', output_name: 'sight-darwin-arm64' },
    { platform: 'linux', arch: 'x64', output_name: 'sight-linux-x64' },
    { platform: 'linux', arch: 'arm64', output_name: 'sight-linux-arm64' },
    { platform: 'windows', arch: 'x64', output_name: 'sight-windows-x64.exe' },
    { platform: 'windows', arch: 'arm64', output_name: 'sight-windows-arm64.exe' },
];

/**
 * Paths configuration.
 */
const PATHS = {
    entry: 'src/cli.ts',
    dist: 'dist',
    bin: 'bin',
    bundle_output: 'dist/sight-server.js',
    cache_source: 'src/command-database/caches/v18.json',
    cache_dest_dir: 'dist/command-database/caches',
};

/**
 * Ensure a directory exists.
 */
function ensure_dir(dir_path: string): void {
    if (!fs.existsSync(dir_path)) {
        fs.mkdirSync(dir_path, { recursive: true });
    }
}

/**
 * Copy the command database cache to the dist directory.
 */
function copy_cache(): void {
    ensure_dir(PATHS.cache_dest_dir);
    const dest_path = path.join(PATHS.cache_dest_dir, 'v18.json');
    fs.copyFileSync(PATHS.cache_source, dest_path);
    console.log(`Copied cache to ${dest_path}`);
}

/**
 * Build the bundled JavaScript file using Bun.build.
 */
async function build_bundle(): Promise<void> {
    console.log('Building bundled JavaScript...');
    
    ensure_dir(PATHS.dist);
    
    const result = await Bun.build({
        entrypoints: [PATHS.entry],
        outdir: PATHS.dist,
        target: 'node',
        format: 'esm',
        minify: false, // Keep readable for debugging
        sourcemap: 'external',
        naming: {
            entry: 'sight-server.js',
        },
        external: [], // Bundle all dependencies
    });

    if (!result.success) {
        console.error('Bundle build failed:');
        for (const log of result.logs) {
            console.error(log);
        }
        process.exit(1);
    }

    // Copy the command database cache
    copy_cache();

    // Add shebang to the bundle
    const bundle_path = PATHS.bundle_output;
    const content = fs.readFileSync(bundle_path, 'utf-8');
    if (!content.startsWith('#!')) {
        fs.writeFileSync(bundle_path, '#!/usr/bin/env node\n' + content);
    }

    // Make executable
    fs.chmodSync(bundle_path, 0o755);

    console.log(`Bundle created: ${bundle_path}`);
}

/**
 * Get the current platform's target.
 */
function get_current_target(): BuildTarget | undefined {
    const platform_info = detect_platform();
    if (!platform_info) {
        return undefined;
    }

    return TARGETS.find(t => t.platform === platform_info.platform && t.arch === platform_info.arch);
}

/**
 * Build a native binary for a specific target using Bun compile.
 */
async function build_binary(target: BuildTarget): Promise<void> {
    console.log(`Building binary for ${target.platform}-${target.arch}...`);
    
    ensure_dir(PATHS.bin);
    
    const output_path = path.join(PATHS.bin, target.output_name);
    const bun_target = `bun-${target.platform}-${target.arch}`;
    
    try {
        // Use Bun's compile feature with cross-compilation
        // The --compile flag creates a standalone executable
        // --target specifies the platform/arch
        // The cache JSON is imported directly in server-factory.ts and bundled automatically
        await $`bun build ${PATHS.entry} --compile --target=${bun_target} --outfile=${output_path} --minify`;

        // Ad-hoc sign macOS binaries when building on macOS. On Apple Silicon
        // (and with stricter provenance enforcement on recent macOS releases),
        // the kernel rejects unsigned Mach-O binaries with SIGKILL / "load
        // code signature error 4". Strip the malformed stub signature bun
        // writes, then apply a fresh ad-hoc signature the loader accepts.
        if (target.platform === 'darwin' && process.platform === 'darwin') {
            await $`codesign --remove-signature ${output_path}`.quiet().nothrow();
            await $`codesign --sign - --force ${output_path}`.quiet();
        }

        console.log(`Binary created: ${output_path}`);
    } catch (error) {
        console.error(`Failed to build ${target.output_name}:`, error);
        throw error;
    }
}

/**
 * Build binaries for all supported platforms.
 */
async function build_all_binaries(): Promise<void> {
    console.log('Building binaries for all platforms...');
    
    // Build sequentially to avoid overwhelming the system
    for (const target of TARGETS) {
        try {
            await build_binary(target);
        } catch (error) {
            console.error(`Skipping ${target.output_name} due to error`);
        }
    }
    
    console.log('All binaries built.');
}

/**
 * Build binary for current platform only.
 */
async function build_current_binary(): Promise<void> {
    const target = get_current_target();
    if (!target) {
        console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
        process.exit(1);
    }
    
    await build_binary(target);
    
    const output_path = path.join(PATHS.bin, target.output_name);
    console.log(`\nBinary ready at: ${path.resolve(output_path)}`);
}

/**
 * Build everything (bundle + all binaries).
 */
async function build_all(): Promise<void> {
    await build_bundle();
    await build_all_binaries();
}

/**
 * Print usage information.
 */
function print_usage(): void {
    console.log(`
Usage: bun scripts/build-binary.ts <command>

Commands:
  bundle   Create bundled JavaScript file (dist/sight-server.js)
  binary   Create native binaries for all platforms (bin/)
  current  Create binary for current platform only
  all      Create both bundle and all binaries

Examples:
  bun scripts/build-binary.ts bundle
  bun scripts/build-binary.ts binary
  bun scripts/build-binary.ts all
`.trim());
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
    const command = process.argv[2];

    switch (command) {
        case 'bundle':
            await build_bundle();
            break;
        case 'binary':
            await build_all_binaries();
            break;
        case 'current':
            await build_current_binary();
            break;
        case 'all':
            await build_all();
            break;
        case '--help':
        case '-h':
            print_usage();
            break;
        default:
            if (command) {
                console.error(`Unknown command: ${command}`);
            }
            print_usage();
            process.exit(1);
    }
}

// Only run main when executed directly (not when imported)
if (import.meta.main) {
    main().catch((error) => {
        console.error('Build failed:', error);
        process.exit(1);
    });
}

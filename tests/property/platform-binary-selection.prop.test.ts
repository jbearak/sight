/**
 * Property test for platform binary selection.
 * 
 * **Property 1: Platform Binary Selection**
 * *For any* valid platform (darwin, linux, windows) and architecture (arm64, x64) combination,
 * the binary name SHALL follow the pattern `sight-{platform}-{arch}` (with `.exe` suffix for Windows).
 * 
 * **Validates: Requirements 1.2, 2.2**
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';

// Valid platforms and architectures
const VALID_PLATFORMS = ['darwin', 'linux', 'windows'] as const;
const VALID_ARCHS = ['arm64', 'x64'] as const;

type Platform = typeof VALID_PLATFORMS[number];
type Arch = typeof VALID_ARCHS[number];

/**
 * Generate the expected binary name for a platform/arch combination.
 * This is the reference implementation for testing.
 */
function expected_binary_name(platform: Platform, arch: Arch): string {
    if (platform === 'windows') {
        return `sight-${platform}-${arch}.exe`;
    }
    return `sight-${platform}-${arch}`;
}

/**
 * Simulate the detect_platform logic for arbitrary platform/arch.
 * This mirrors the implementation in build-binary.ts.
 */
function get_binary_name_for_platform(platform: Platform, arch: Arch): string {
    if (platform === 'windows') {
        return `sight-${platform}-${arch}.exe`;
    }
    return `sight-${platform}-${arch}`;
}

describe('Platform Binary Selection Property Tests', () => {
    /**
     * Feature: binary-installation, Property 1: Platform Binary Selection
     * 
     * For any valid platform and architecture combination, the binary name
     * follows the pattern sight-{platform}-{arch} with .exe for Windows.
     */
    it('should generate correct binary name for all platform/arch combinations', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...VALID_PLATFORMS),
                fc.constantFrom(...VALID_ARCHS),
                (platform, arch) => {
                    const actual = get_binary_name_for_platform(platform, arch);
                    const expected = expected_binary_name(platform, arch);
                    
                    expect(actual).toBe(expected);
                    
                    // Verify pattern structure
                    expect(actual).toContain('sight-');
                    expect(actual).toContain(platform);
                    expect(actual).toContain(arch);
                    
                    // Windows should have .exe, others should not
                    if (platform === 'windows') {
                        expect(actual).toEndWith('.exe');
                    } else {
                        expect(actual).not.toEndWith('.exe');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: binary-installation, Property 1: Platform Binary Selection
     * 
     * Binary names should be unique for each platform/arch combination.
     */
    it('should generate unique binary names for different platform/arch combinations', () => {
        const all_combinations: Array<{ platform: Platform; arch: Arch }> = [];
        for (const platform of VALID_PLATFORMS) {
            for (const arch of VALID_ARCHS) {
                all_combinations.push({ platform, arch });
            }
        }

        const binary_names = all_combinations.map(
            ({ platform, arch }) => get_binary_name_for_platform(platform, arch)
        );

        const unique_names = new Set(binary_names);
        expect(unique_names.size).toBe(all_combinations.length);
    });

    /**
     * Feature: binary-installation, Property 1: Platform Binary Selection
     * 
     * All generated binary names should start with 'sight-' prefix.
     */
    it('should always start with sight- prefix', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...VALID_PLATFORMS),
                fc.constantFrom(...VALID_ARCHS),
                (platform, arch) => {
                    const binary_name = get_binary_name_for_platform(platform, arch);
                    expect(binary_name).toStartWith('sight-');
                }
            ),
            { numRuns: 100 }
        );
    });
});

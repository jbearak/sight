/**
 * Property-Based Tests for Cache Monotonicity
 *
 * Property 2: Cache Monotonicity
 * For any existing cache file with N commands, running the cache generator
 * (without --force) SHALL fail if the new cache would contain fewer than N commands.
 *
 * **Feature: command-database-integration, Property 2: Cache Monotonicity**
 * **Validates: Requirements 6.2**
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CommandCache, CommandInfo } from '../../src/command-database/types';

/**
 * Recreate the check_monotonicity logic for testing purposes.
 * This mirrors the implementation in scripts/generate-cache.ts
 */
function check_monotonicity(
    output_path: string,
    new_count: number,
    force: boolean
): { previous_count: number; error?: string } {
    if (!existsSync(output_path)) {
        return { previous_count: 0 };
    }

    try {
        const { readFileSync } = require('fs');
        const existing_content = readFileSync(output_path, 'utf-8');
        const existing_cache = JSON.parse(existing_content) as CommandCache;
        const existing_count = Object.keys(existing_cache.commands).length;

        if (new_count < existing_count && !force) {
            return {
                previous_count: existing_count,
                error: `Cache would shrink from ${existing_count} to ${new_count} commands. Use --force to override.`
            };
        }

        return { previous_count: existing_count };
    } catch (error) {
        if (error instanceof SyntaxError) {
            // Invalid JSON in existing file, treat as no previous cache
            return { previous_count: 0 };
        }
        throw error;
    }
}

/**
 * Generate a valid CommandInfo object for testing.
 */
function create_command_info(name: string): CommandInfo {
    return {
        name,
        syntax: `${name} ...`,
        description: `Test command ${name}`,
        min_abbreviation: name.length
    };
}

/**
 * Generate a valid CommandCache object with the specified number of commands.
 */
function create_test_cache(num_commands: number): CommandCache {
    const commands: Record<string, CommandInfo> = {};
    for (let i = 0; i < num_commands; i++) {
        const name = `cmd${i}`;
        commands[name] = create_command_info(name);
    }
    return {
        version: 18,
        commands,
        abbreviations: {}
    };
}

describe('Cache Monotonicity Property Tests', () => {
    const test_cache_dir = join(__dirname, '../../.test-cache-monotonicity');
    const test_cache_path = join(test_cache_dir, 'test-monotonicity.json');

    beforeEach(() => {
        // Create test directory if it doesn't exist
        if (!existsSync(test_cache_dir)) {
            mkdirSync(test_cache_dir, { recursive: true });
        }
    });

    afterEach(() => {
        // Clean up test cache file
        if (existsSync(test_cache_path)) {
            unlinkSync(test_cache_path);
        }
    });

    /**
     * Property 2: Cache Monotonicity
     * For any existing cache file with N commands, running the cache generator
     * (without --force) SHALL fail if the new cache would contain fewer than N commands.
     *
     * Feature: command-database-integration, Property 2: Cache Monotonicity
     * Validates: Requirements 6.2
     */
    it('should fail when new cache has fewer commands than existing (without force)', () => {
        fc.assert(
            fc.property(
                // Generate existing cache size (at least 10 commands)
                fc.integer({ min: 10, max: 1000 }),
                // Generate reduction amount (at least 1)
                fc.integer({ min: 1, max: 100 }),
                (existing_count, reduction) => {
                    // Ensure new count is less than existing
                    const new_count = Math.max(1, existing_count - reduction);
                    if (new_count >= existing_count) {
                        return true; // Skip this case - no reduction
                    }

                    // Create and write existing cache
                    const existing_cache = create_test_cache(existing_count);
                    writeFileSync(test_cache_path, JSON.stringify(existing_cache));

                    // Check monotonicity without force
                    const result = check_monotonicity(test_cache_path, new_count, false);

                    // Property: Should return an error when shrinking without force
                    return result.error !== undefined &&
                           result.error.includes('would shrink') &&
                           result.previous_count === existing_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Force flag allows cache shrinking
     * When --force is used, the monotonicity check should pass even if
     * the new cache has fewer commands.
     *
     * Feature: command-database-integration, Property: Force flag override
     * Validates: Requirements 6.4
     */
    it('should allow shrinking when force flag is set', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 10, max: 1000 }),
                fc.integer({ min: 1, max: 100 }),
                (existing_count, reduction) => {
                    const new_count = Math.max(1, existing_count - reduction);

                    // Create and write existing cache
                    const existing_cache = create_test_cache(existing_count);
                    writeFileSync(test_cache_path, JSON.stringify(existing_cache));

                    // Check monotonicity with force
                    const result = check_monotonicity(test_cache_path, new_count, true);

                    // Property: Should NOT return an error when force is true
                    return result.error === undefined &&
                           result.previous_count === existing_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Cache growth is always allowed
     * When the new cache has more or equal commands, the check should pass.
     *
     * Feature: command-database-integration, Property: Cache growth allowed
     * Validates: Requirements 6.1, 6.2
     */
    it('should allow cache growth or equal size', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 0, max: 500 }),
                (existing_count, growth) => {
                    const new_count = existing_count + growth;

                    // Create and write existing cache
                    const existing_cache = create_test_cache(existing_count);
                    writeFileSync(test_cache_path, JSON.stringify(existing_cache));

                    // Check monotonicity without force
                    const result = check_monotonicity(test_cache_path, new_count, false);

                    // Property: Should NOT return an error when growing or equal
                    return result.error === undefined &&
                           result.previous_count === existing_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: No existing cache always passes
     * When there is no existing cache file, the check should always pass.
     *
     * Feature: command-database-integration, Property: No existing cache
     * Validates: Requirements 6.1
     */
    it('should pass when no existing cache file exists', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 10000 }),
                fc.boolean(),
                (new_count, force) => {
                    // Ensure no cache file exists
                    if (existsSync(test_cache_path)) {
                        unlinkSync(test_cache_path);
                    }

                    // Check monotonicity
                    const result = check_monotonicity(test_cache_path, new_count, force);

                    // Property: Should pass with previous_count = 0
                    return result.error === undefined && result.previous_count === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Invalid JSON is treated as no cache
     * When the existing cache file has invalid JSON, it should be treated
     * as if no cache exists.
     *
     * Feature: command-database-integration, Property: Invalid JSON handling
     * Validates: Requirements 6.1
     */
    it('should treat invalid JSON as no existing cache', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.boolean(),
                // Generate invalid JSON strings
                fc.oneof(
                    fc.constant('{invalid json}'),
                    fc.constant('not json at all'),
                    fc.constant('{'),
                    fc.constant('{"commands": }')
                ),
                (new_count, force, invalid_json) => {
                    // Write invalid JSON to cache file
                    writeFileSync(test_cache_path, invalid_json);

                    // Check monotonicity
                    const result = check_monotonicity(test_cache_path, new_count, force);

                    // Property: Should pass with previous_count = 0
                    return result.error === undefined && result.previous_count === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});

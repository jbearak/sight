/**
 * Property-based tests for CLI unknown flag rejection.
 * 
 * **Feature: standalone-binary-distribution, Property 2: Unknown Flag Rejection**
 * **Validates: Requirements 2.3**
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { parse_args } from '../../src/cli';

describe('CLI Unknown Flag Rejection', () => {
    /**
     * Property 2: Unknown Flag Rejection
     * 
     * *For any* string argument that does not match a recognized flag pattern
     * (`--stdio`, `--node-ipc`, `--help`, `--version`, `--quiet`, `-s`, `-i`, `-h`, `-v`, `-q`),
     * the CLI parser SHALL return an error result indicating the unknown flag.
     */

    const KNOWN_FLAGS = new Set([
        '--stdio', '-s',
        '--node-ipc', '-i',
        '--help', '-h',
        '--version', '-v',
        '--quiet', '-q',
    ]);

    it('should reject unknown flags starting with --', () => {
        // Generate unknown long flags (--something that isn't known)
        const unknown_long_flag = fc.string({ minLength: 1, maxLength: 20 })
            .filter(s => /^[a-z][a-z0-9-]*$/i.test(s))
            .map(s => `--${s}`)
            .filter(flag => !KNOWN_FLAGS.has(flag));

        fc.assert(
            fc.property(unknown_long_flag, (unknown_flag) => {
                const result = parse_args([unknown_flag]);
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(result.error).toContain('Unknown flag');
                    expect(result.error).toContain(unknown_flag);
                }
            }),
            { numRuns: 100 }
        );
    });

    it('should reject unknown flags starting with -', () => {
        // Generate unknown short flags (-x that isn't known)
        const unknown_short_flag = fc.string({ minLength: 1, maxLength: 5 })
            .filter(s => /^[a-z][a-z0-9]*$/i.test(s))
            .map(s => `-${s}`)
            .filter(flag => !KNOWN_FLAGS.has(flag));

        fc.assert(
            fc.property(unknown_short_flag, (unknown_flag) => {
                const result = parse_args([unknown_flag]);
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(result.error).toContain('Unknown flag');
                    expect(result.error).toContain(unknown_flag);
                }
            }),
            { numRuns: 100 }
        );
    });

    it('should reject unknown flags mixed with valid flags', () => {
        const valid_flag = fc.constantFrom(
            '--stdio', '-s',
            '--node-ipc', '-i',
            '--help', '-h',
            '--version', '-v'
        );

        const unknown_flag = fc.string({ minLength: 1, maxLength: 10 })
            .filter(s => /^[a-z][a-z0-9-]*$/i.test(s))
            .map(s => `--${s}`)
            .filter(flag => !KNOWN_FLAGS.has(flag));

        fc.assert(
            fc.property(valid_flag, unknown_flag, (valid, unknown) => {
                // Test with unknown flag before valid
                const result1 = parse_args([unknown, valid]);
                expect(result1.success).toBe(false);
                if (!result1.success) {
                    expect(result1.error).toContain('Unknown flag');
                }

                // Test with unknown flag after valid
                const result2 = parse_args([valid, unknown]);
                expect(result2.success).toBe(false);
                if (!result2.success) {
                    expect(result2.error).toContain('Unknown flag');
                }
            }),
            { numRuns: 100 }
        );
    });

    it('should accept all known flags without error', () => {
        const known_flags_arb = fc.array(
            fc.constantFrom(...Array.from(KNOWN_FLAGS)),
            { minLength: 1, maxLength: 4 }
        ).filter(flags => {
            // Filter out conflicting combinations
            const has_stdio = flags.includes('--stdio') || flags.includes('-s');
            const has_node_ipc = flags.includes('--node-ipc') || flags.includes('-i');
            return !(has_stdio && has_node_ipc);
        });

        fc.assert(
            fc.property(known_flags_arb, (flags) => {
                const result = parse_args(flags);
                expect(result.success).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    it('should handle empty argument array', () => {
        const result = parse_args([]);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.options.transport).toBe('stdio');
            expect(result.options.help).toBe(false);
            expect(result.options.version).toBe(false);
        }
    });
});

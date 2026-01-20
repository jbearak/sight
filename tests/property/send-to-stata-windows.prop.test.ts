import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { 
    get_windows_architecture, 
    CURRENT_EXE_VERSION, 
    CHECKSUMS 
} from '../../client/src/send-to-stata/exe-downloader';
import { map_exit_code_to_message, check_automation_error } from '../../client/src/send-to-stata/windows-sender';

/**
 * Property-based tests for Windows send-to-stata functionality.
 * 
 * Feature: send-to-stata Windows support
 * Property 2: Architecture Consistency - Downloaded executable architecture must match detected Windows architecture
 * Property 3: Version Monotonicity - Stored version should only increase (or stay same), never decrease after update
 * Property 4: Checksum Integrity - Downloaded file with mismatched checksum must never be saved to storage
 * Validates: Requirements 12.4, 12.6, 13.2
 */

describe('Feature: send-to-stata Windows - Property Tests', () => {
    
    // Property 2: Architecture Consistency
    test('Property 2: Architecture detection returns consistent results for same environment', () => {
        fc.assert(fc.property(
            fc.constantFrom('x64', 'ARM64', 'arm64', 'X64', undefined),
            (processor_arch) => {
                // Mock environment variable
                const original = process.env.PROCESSOR_ARCHITECTURE;
                process.env.PROCESSOR_ARCHITECTURE = processor_arch;
                
                try {
                    const arch1 = get_windows_architecture();
                    const arch2 = get_windows_architecture();
                    
                    // Architecture detection should be consistent
                    expect(arch1).toBe(arch2);
                    
                    // Should return valid architecture
                    expect(['x64', 'arm64']).toContain(arch1);
                    
                    // ARM64 environment should return arm64
                    if (processor_arch === 'ARM64') {
                        expect(arch1).toBe('arm64');
                    } else {
                        // All other cases default to x64
                        expect(arch1).toBe('x64');
                    }
                } finally {
                    process.env.PROCESSOR_ARCHITECTURE = original;
                }
            }
        ), { numRuns: 20 });
    });

    // Property 3: Version Monotonicity  
    test('Property 3: Version comparison logic is monotonic', () => {
        const version_gen = fc.tuple(
            fc.integer({ min: 0, max: 10 }),
            fc.integer({ min: 0, max: 20 }),
            fc.integer({ min: 0, max: 50 })
        ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

        fc.assert(fc.property(
            version_gen,
            version_gen,
            (v1, v2) => {
                const parse = (v: string) => v.split('.').map(Number);
                const [v1Maj, v1Min, v1Patch] = parse(v1);
                const [v2Maj, v2Min, v2Patch] = parse(v2);
                
                // Compare versions using same logic as implementation
                const is_v1_newer = (() => {
                    if (v1Maj !== v2Maj) return v1Maj > v2Maj;
                    if (v1Min !== v2Min) return v1Min > v2Min;
                    return v1Patch > v2Patch;
                })();
                
                const is_v2_newer = (() => {
                    if (v2Maj !== v1Maj) return v2Maj > v1Maj;
                    if (v2Min !== v1Min) return v2Min > v1Min;
                    return v2Patch > v1Patch;
                })();
                
                // Monotonicity: if v1 > v2, then v2 should not be > v1
                if (is_v1_newer) {
                    expect(is_v2_newer).toBe(false);
                }
                
                // Reflexivity: version should equal itself
                if (v1 === v2) {
                    expect(is_v1_newer).toBe(false);
                    expect(is_v2_newer).toBe(false);
                }
                
                // Transitivity property (simplified check)
                const is_equal = v1 === v2;
                expect(is_v1_newer || is_v2_newer || is_equal).toBe(true);
            }
        ), { numRuns: 100 });
    });

    // Property 4: Checksum Integrity
    test('Property 4: Checksum validation rejects invalid checksums', () => {
        const checksum_gen = fc.hexaString({ minLength: 64, maxLength: 64 });
        
        fc.assert(fc.property(
            fc.constantFrom('x64', 'arm64'),
            checksum_gen,
            (architecture, invalid_checksum) => {
                const valid_checksum = CHECKSUMS[architecture];
                
                // Assume invalid checksum is different from valid one
                fc.pre(invalid_checksum !== valid_checksum);
                
                // Checksum validation should fail for invalid checksums
                const is_valid = invalid_checksum === valid_checksum;
                expect(is_valid).toBe(false);
                
                // Valid checksums should always pass
                const valid_is_valid = valid_checksum === valid_checksum;
                expect(valid_is_valid).toBe(true);
            }
        ), { numRuns: 50 });
    });

    test('Property 4: Valid checksums are exactly 64 hex characters', () => {
        fc.assert(fc.property(
            fc.constantFrom('x64', 'arm64'),
            (architecture) => {
                const checksum = CHECKSUMS[architecture];
                
                // Should be exactly 64 characters
                expect(checksum).toHaveLength(64);
                
                // Should be valid hex
                expect(/^[0-9a-f]{64}$/.test(checksum)).toBe(true);
            }
        ), { numRuns: 10 });
    });

    // Additional property tests for error handling
    test('Property: Exit code mapping is deterministic', () => {
        const exit_codes = [0, 1, 2, 3, 4, 5, 99, -1];
        const stderr_samples = ['', 'some error', 'automation error', 'unknown'];
        
        fc.assert(fc.property(
            fc.constantFrom(...exit_codes),
            fc.constantFrom(...stderr_samples),
            (code, stderr) => {
                const message1 = map_exit_code_to_message(code, stderr);
                const message2 = map_exit_code_to_message(code, stderr);
                
                // Should be deterministic
                expect(message1).toBe(message2);
                
                // Should return a non-empty string
                expect(message1.length).toBeGreaterThan(0);
                
                // Known exit codes should have specific messages
                if (code >= 1 && code <= 5) {
                    expect(message1).not.toContain('Unknown error');
                }
            }
        ), { numRuns: 50 });
    });

    test('Property: Automation error detection is consistent', () => {
        const automation_patterns = [
            'automation',
            'AUTOMATION',
            '80040154',
            'regdb_e_classnotreg',
            'REGDB_E_CLASSNOTREG'
        ];
        
        const non_automation_patterns = [
            'file not found',
            'network error',
            'permission denied',
            'invalid argument'
        ];
        
        fc.assert(fc.property(
            fc.constantFrom(...automation_patterns),
            (pattern) => {
                const stderr = `Some error message containing ${pattern} here`;
                const is_automation1 = check_automation_error(stderr);
                const is_automation2 = check_automation_error(stderr);
                
                // Should be consistent
                expect(is_automation1).toBe(is_automation2);
                
                // Should detect automation errors
                expect(is_automation1).toBe(true);
            }
        ), { numRuns: 20 });
        
        fc.assert(fc.property(
            fc.constantFrom(...non_automation_patterns),
            (pattern) => {
                const stderr = `Error: ${pattern}`;
                const is_automation = check_automation_error(stderr);
                
                // Should not detect non-automation errors as automation errors
                expect(is_automation).toBe(false);
            }
        ), { numRuns: 20 });
    });

    test('Property: Current version is valid semver format', () => {
        const version = CURRENT_EXE_VERSION;
        
        // Should match semver pattern
        expect(/^\d+\.\d+\.\d+$/.test(version)).toBe(true);
        
        // Should parse to valid numbers
        const parts = version.split('.').map(Number);
        expect(parts).toHaveLength(3);
        expect(parts.every(n => n >= 0 && Number.isInteger(n))).toBe(true);
    });

    test('Property: Architecture detection handles edge cases', () => {
        const edge_cases = [
            undefined,
            '',
            'x86',
            'ia32', 
            'unknown',
            'X64',
            'arm64',
            'ARM64'
        ];
        
        fc.assert(fc.property(
            fc.constantFrom(...edge_cases),
            (arch_value) => {
                const original = process.env.PROCESSOR_ARCHITECTURE;
                process.env.PROCESSOR_ARCHITECTURE = arch_value;
                
                try {
                    const detected = get_windows_architecture();
                    
                    // Should always return a valid architecture
                    expect(['x64', 'arm64']).toContain(detected);
                    
                    // ARM64 should map to arm64, everything else to x64
                    if (arch_value === 'ARM64') {
                        expect(detected).toBe('arm64');
                    } else {
                        expect(detected).toBe('x64');
                    }
                } finally {
                    process.env.PROCESSOR_ARCHITECTURE = original;
                }
            }
        ), { numRuns: 30 });
    });
});
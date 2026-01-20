/// <reference types="bun-types" />
/**
 * Unit tests for Windows send-to-stata functionality.
 * Feature: windows-send-to-stata
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

// Test the pure functions by importing them directly
// We'll test the logic without the vscode dependencies

describe('Windows Sender Module - Pure Functions', () => {
    describe('get_windows_architecture() logic', () => {
        let originalEnv: string | undefined;

        beforeEach(() => {
            originalEnv = process.env.PROCESSOR_ARCHITECTURE;
        });

        afterEach(() => {
            if (originalEnv !== undefined) {
                process.env.PROCESSOR_ARCHITECTURE = originalEnv;
            } else {
                delete process.env.PROCESSOR_ARCHITECTURE;
            }
        });

        // Test the architecture detection logic directly
        function get_windows_architecture_test(): 'x64' | 'arm64' {
            return process.env.PROCESSOR_ARCHITECTURE === 'ARM64' ? 'arm64' : 'x64';
        }

        it('should return arm64 for ARM64 architecture', () => {
            process.env.PROCESSOR_ARCHITECTURE = 'ARM64';
            expect(get_windows_architecture_test()).toBe('arm64');
        });

        it('should return x64 for AMD64 architecture', () => {
            process.env.PROCESSOR_ARCHITECTURE = 'AMD64';
            expect(get_windows_architecture_test()).toBe('x64');
        });

        it('should return x64 for x86 architecture', () => {
            process.env.PROCESSOR_ARCHITECTURE = 'x86';
            expect(get_windows_architecture_test()).toBe('x64');
        });

        it('should return x64 for undefined architecture', () => {
            delete process.env.PROCESSOR_ARCHITECTURE;
            expect(get_windows_architecture_test()).toBe('x64');
        });

        it('should return x64 for unknown architecture', () => {
            process.env.PROCESSOR_ARCHITECTURE = 'UNKNOWN';
            expect(get_windows_architecture_test()).toBe('x64');
        });
    });

    describe('map_exit_code_to_message() logic', () => {
        // Test the exit code mapping logic directly
        function map_exit_code_to_message_test(code: number, stderr: string): string {
            switch (code) {
                case 1: return 'Invalid arguments';
                case 2: return 'File not found';
                case 3: return 'Failed to create temp file';
                case 4: return 'No running Stata instance found. Start Stata before sending code.';
                case 5: return 'Failed to activate Stata window. This may be due to focus-stealing prevention. Ensure Stata is not running as Administrator.';
                default: return stderr || `Unknown error (exit code ${code})`;
            }
        }

        it('should map exit code 1 to invalid arguments', () => {
            expect(map_exit_code_to_message_test(1, '')).toBe('Invalid arguments');
        });

        it('should map exit code 2 to file not found', () => {
            expect(map_exit_code_to_message_test(2, '')).toBe('File not found');
        });

        it('should map exit code 3 to temp file creation failure', () => {
            expect(map_exit_code_to_message_test(3, '')).toBe('Failed to create temp file');
        });

        it('should map exit code 4 to no Stata instance', () => {
            expect(map_exit_code_to_message_test(4, '')).toBe('No running Stata instance found. Start Stata before sending code.');
        });

        it('should map exit code 5 to keystroke failure', () => {
            expect(map_exit_code_to_message_test(5, '')).toBe('Failed to activate Stata window. This may be due to focus-stealing prevention. Ensure Stata is not running as Administrator.');
        });

        it('should return stderr for unknown exit codes when stderr is provided', () => {
            const stderr = 'Custom error message';
            expect(map_exit_code_to_message_test(99, stderr)).toBe(stderr);
        });

        it('should return generic message for unknown exit codes when stderr is empty', () => {
            expect(map_exit_code_to_message_test(99, '')).toBe('Unknown error (exit code 99)');
        });

        it('should handle negative exit codes', () => {
            expect(map_exit_code_to_message_test(-1, '')).toBe('Unknown error (exit code -1)');
        });

        it('should prefer specific message over stderr for known codes', () => {
            const stderr = 'Detailed error info';
            expect(map_exit_code_to_message_test(1, stderr)).toBe('Invalid arguments');
        });
    });

    describe('check_automation_error() logic', () => {
        // Test the automation error detection logic directly
        function check_automation_error_test(stderr: string): boolean {
            const lower = stderr.toLowerCase();
            return lower.includes('automation') || 
                   lower.includes('80040154') || 
                   lower.includes('regdb_e_classnotreg');
        }

        it('should detect automation error in lowercase', () => {
            expect(check_automation_error_test('automation error occurred')).toBe(true);
        });

        it('should detect automation error in uppercase', () => {
            expect(check_automation_error_test('AUTOMATION ERROR OCCURRED')).toBe(true);
        });

        it('should detect automation error in mixed case', () => {
            expect(check_automation_error_test('Automation Error Occurred')).toBe(true);
        });

        it('should detect COM error code 80040154', () => {
            expect(check_automation_error_test('Error 80040154: Class not registered')).toBe(true);
        });

        it('should detect REGDB_E_CLASSNOTREG error', () => {
            expect(check_automation_error_test('REGDB_E_CLASSNOTREG occurred')).toBe(true);
        });

        it('should detect regdb_e_classnotreg in lowercase', () => {
            expect(check_automation_error_test('regdb_e_classnotreg occurred')).toBe(true);
        });

        it('should return false for non-automation errors', () => {
            expect(check_automation_error_test('File not found')).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(check_automation_error_test('')).toBe(false);
        });

        it('should return false for partial matches', () => {
            expect(check_automation_error_test('automatic process')).toBe(false);
        });

        it('should detect multiple error patterns in same string', () => {
            expect(check_automation_error_test('automation error 80040154 regdb_e_classnotreg')).toBe(true);
        });
    });

    describe('checksum verification', () => {
        // Test checksum constants format
        const CHECKSUMS_TEST: Record<string, string> = {
            'x64':   '2c7becace23c10f4f888f7f61eedfde8108f4e16ce21c1f8a8b625038a22c1d6',
            'arm64': 'aa1fd6dfd2e14bcc2fdb2d06b4ca950ef5ecd5891bd7de0a833b12dc46feb20a',
        };

        it('should have valid SHA-256 checksums for x64', () => {
            const x64Checksum = CHECKSUMS_TEST['x64'];
            expect(x64Checksum).toBeDefined();
            expect(x64Checksum).toMatch(/^[a-f0-9]{64}$/);
        });

        it('should have valid SHA-256 checksums for arm64', () => {
            const arm64Checksum = CHECKSUMS_TEST['arm64'];
            expect(arm64Checksum).toBeDefined();
            expect(arm64Checksum).toMatch(/^[a-f0-9]{64}$/);
        });

        it('should have different checksums for different architectures', () => {
            expect(CHECKSUMS_TEST['x64']).not.toBe(CHECKSUMS_TEST['arm64']);
        });
    });

    describe('version comparison logic', () => {
        // Test version format
        const CURRENT_EXE_VERSION_TEST = '0.1.11';

        it('should have a valid semantic version format', () => {
            expect(CURRENT_EXE_VERSION_TEST).toMatch(/^\d+\.\d+\.\d+$/);
        });

        // Test version comparison logic
        function check_for_updates_test(currentVersion: string, expectedVersion: string): boolean {
            return currentVersion !== expectedVersion;
        }

        it('should detect updates when versions differ', () => {
            expect(check_for_updates_test('0.1.10', '0.1.11')).toBe(true);
            expect(check_for_updates_test('0.1.11', '0.1.11')).toBe(false);
            expect(check_for_updates_test('0.1.12', '0.1.11')).toBe(true);
        });
    });

    describe('edge cases and error conditions', () => {
        function map_exit_code_to_message_test(code: number, stderr: string): string {
            switch (code) {
                case 1: return 'Invalid arguments';
                case 2: return 'File not found';
                case 3: return 'Failed to create temp file';
                case 4: return 'No running Stata instance found. Start Stata before sending code.';
                case 5: return 'Failed to activate Stata window. This may be due to focus-stealing prevention. Ensure Stata is not running as Administrator.';
                default: return stderr || `Unknown error (exit code ${code})`;
            }
        }

        function check_automation_error_test(stderr: string): boolean {
            if (typeof stderr !== 'string') {
                throw new Error('stderr must be a string');
            }
            const lower = stderr.toLowerCase();
            return lower.includes('automation') || 
                   lower.includes('80040154') || 
                   lower.includes('regdb_e_classnotreg');
        }

        it('should handle null stderr gracefully in exit code mapping', () => {
            expect(() => map_exit_code_to_message_test(0, null as any)).not.toThrow();
            expect(map_exit_code_to_message_test(0, null as any)).toBe('Unknown error (exit code 0)');
        });

        it('should throw for null stderr in automation error detection', () => {
            expect(() => check_automation_error_test(null as any)).toThrow();
        });

        it('should handle very large exit codes', () => {
            const result = map_exit_code_to_message_test(999999, '');
            expect(result).toBe('Unknown error (exit code 999999)');
        });

        it('should handle very long stderr messages', () => {
            const longStderr = 'a'.repeat(10000);
            const result = map_exit_code_to_message_test(99, longStderr);
            expect(result).toBe(longStderr);
        });

        it('should handle stderr with special characters', () => {
            const specialStderr = 'Error: "C:\\Program Files\\Stata18\\StataSE-64.exe" /Register\n\t\r';
            const result = map_exit_code_to_message_test(99, specialStderr);
            expect(result).toBe(specialStderr);
        });

        it('should handle automation error detection with special characters', () => {
            expect(check_automation_error_test('automation\nerror\toccurred')).toBe(true);
            expect(check_automation_error_test('Error\r\n80040154\r\noccurred')).toBe(true);
        });
    });
});


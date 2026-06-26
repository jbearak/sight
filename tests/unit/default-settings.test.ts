/**
 * Unit tests for DEFAULT_SETTINGS in server-handlers.ts
 */

import { describe, it, expect } from 'bun:test';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

describe('DEFAULT_SETTINGS', () => {
    describe('diagnostics.indentation', () => {
        it('should default to false', () => {
            // Requirement 1.1: THE DEFAULT_SETTINGS object SHALL set
            // `diagnostics.indentation` to `false`
            expect(DEFAULT_SETTINGS.diagnostics.indentation).toBe(false);
        });
    });

    describe('cross_file.diagnostics', () => {
        it('should not include removed out_of_scope config', () => {
            expect('out_of_scope' in DEFAULT_SETTINGS.cross_file.diagnostics).toBe(
                false
            );
        });

        it('should default case_mismatch to "auto"', () => {
            expect(DEFAULT_SETTINGS.cross_file.diagnostics.case_mismatch).toBe(
                'auto'
            );
        });
    });
});

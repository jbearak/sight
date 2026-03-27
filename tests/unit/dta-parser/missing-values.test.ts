import { describe, it, expect } from 'bun:test';
import {
    classify_raw_float_missing,
    is_missing_value,
    classify_missing_value,
    STATA_MISSING,
    STATA_MISSING_A,
    STATA_MISSING_B,
    STATA_MISSING_Z,
} from '../../../src/dta-parser/missing-values';

// -----------------------------------------------------------
// Stata missing value detection and classification
// -----------------------------------------------------------

describe('missing-values', () => {

    // ----- Exported constants -----

    describe('exported constants', () => {
        it('STATA_MISSING is a finite number', () => {
            expect(Number.isFinite(STATA_MISSING)).toBe(true);
        });

        it('STATA_MISSING < STATA_MISSING_A < STATA_MISSING_Z',
            () => {
                expect(STATA_MISSING).toBeLessThan(
                    STATA_MISSING_A
                );
                expect(STATA_MISSING_A).toBeLessThan(
                    STATA_MISSING_Z
                );
            }
        );
    });

    // ----- System missing (.) -----

    describe('system missing (.) detection', () => {
        it('detects byte system missing (101)', () => {
            expect(is_missing_value(101, 'byte')).toBe(true);
            expect(classify_missing_value(101, 'byte'))
                .toBe('.');
        });

        it('detects int system missing (32741)', () => {
            expect(is_missing_value(32741, 'int')).toBe(true);
            expect(classify_missing_value(32741, 'int'))
                .toBe('.');
        });

        it('detects long system missing (2147483621)', () => {
            expect(is_missing_value(2147483621, 'long'))
                .toBe(true);
            expect(classify_missing_value(2147483621, 'long'))
                .toBe('.');
        });

        it('detects float system missing via raw bits', () => {
            expect(classify_raw_float_missing(0x7F000000))
                .toBe('.');
        });

        it('detects float .a and .z via raw bits', () => {
            expect(classify_raw_float_missing(0x7F000800))
                .toBe('.a');
            expect(classify_raw_float_missing(0x7F00D000))
                .toBe('.z');
        });

        it('detects double system missing via constant', () => {
            expect(is_missing_value(STATA_MISSING, 'double'))
                .toBe(true);
            expect(classify_missing_value(
                STATA_MISSING, 'double'
            )).toBe('.');
        });
    });

    // ----- Extended missing .a -----

    describe('extended missing .a detection', () => {
        it('detects byte .a (102)', () => {
            expect(is_missing_value(102, 'byte')).toBe(true);
            expect(classify_missing_value(102, 'byte'))
                .toBe('.a');
        });

        it('detects int .a (32742)', () => {
            expect(is_missing_value(32742, 'int')).toBe(true);
            expect(classify_missing_value(32742, 'int'))
                .toBe('.a');
        });

        it('detects long .a (2147483622)', () => {
            expect(is_missing_value(2147483622, 'long'))
                .toBe(true);
            expect(classify_missing_value(2147483622, 'long'))
                .toBe('.a');
        });

        it('detects double .a via constant', () => {
            expect(is_missing_value(STATA_MISSING_A, 'double'))
                .toBe(true);
            expect(classify_missing_value(
                STATA_MISSING_A, 'double'
            )).toBe('.a');
        });

        it('detects double .b via constant', () => {
            expect(is_missing_value(STATA_MISSING_B, 'double'))
                .toBe(true);
            expect(classify_missing_value(
                STATA_MISSING_B, 'double'
            )).toBe('.b');
        });
    });

    // ----- Extended missing .z -----

    describe('extended missing .z detection', () => {
        it('detects byte .z (127)', () => {
            expect(is_missing_value(127, 'byte')).toBe(true);
            expect(classify_missing_value(127, 'byte'))
                .toBe('.z');
        });

        it('detects int .z (32767)', () => {
            expect(is_missing_value(32767, 'int')).toBe(true);
            expect(classify_missing_value(32767, 'int'))
                .toBe('.z');
        });

        it('detects long .z (2147483647)', () => {
            expect(is_missing_value(2147483647, 'long'))
                .toBe(true);
            expect(classify_missing_value(2147483647, 'long'))
                .toBe('.z');
        });

        it('detects double .z via constant', () => {
            expect(is_missing_value(STATA_MISSING_Z, 'double'))
                .toBe(true);
            expect(classify_missing_value(
                STATA_MISSING_Z, 'double'
            )).toBe('.z');
        });
    });

    // ----- Normal values are NOT missing -----

    describe('normal values are not missing', () => {
        it('byte 100 is not missing', () => {
            expect(is_missing_value(100, 'byte')).toBe(false);
            expect(classify_missing_value(100, 'byte'))
                .toBeNull();
        });

        it('byte 0 is not missing', () => {
            expect(is_missing_value(0, 'byte')).toBe(false);
        });

        it('int 32740 is not missing', () => {
            expect(is_missing_value(32740, 'int')).toBe(false);
            expect(classify_missing_value(32740, 'int'))
                .toBeNull();
        });

        it('int 0 is not missing', () => {
            expect(is_missing_value(0, 'int')).toBe(false);
        });

        it('long 2147483620 is not missing', () => {
            expect(is_missing_value(2147483620, 'long'))
                .toBe(false);
            expect(classify_missing_value(2147483620, 'long'))
                .toBeNull();
        });

        it('long 0 is not missing', () => {
            expect(is_missing_value(0, 'long')).toBe(false);
        });

        it('double 0.0 is not missing', () => {
            expect(is_missing_value(0.0, 'double'))
                .toBe(false);
        });

        it('double 1.5 is not missing', () => {
            expect(is_missing_value(1.5, 'double'))
                .toBe(false);
        });

        it('float 3.14 is not missing', () => {
            expect(is_missing_value(3.14, 'float'))
                .toBe(false);
        });

        it('negative numbers are not missing', () => {
            expect(is_missing_value(-1, 'byte')).toBe(false);
            expect(is_missing_value(-32000, 'int'))
                .toBe(false);
            expect(is_missing_value(-999.99, 'double'))
                .toBe(false);
        });
    });

    // ----- Boundary values -----

    describe('boundary values', () => {
        it('byte: 100 is NOT missing, 101 IS missing', () => {
            expect(is_missing_value(100, 'byte')).toBe(false);
            expect(is_missing_value(101, 'byte')).toBe(true);
        });

        it('int: 32740 is NOT missing, 32741 IS missing',
            () => {
                expect(is_missing_value(32740, 'int'))
                    .toBe(false);
                expect(is_missing_value(32741, 'int'))
                    .toBe(true);
            }
        );

        it('long: 2147483620 NOT missing, 2147483621 IS',
            () => {
                expect(is_missing_value(2147483620, 'long'))
                    .toBe(false);
                expect(is_missing_value(2147483621, 'long'))
                    .toBe(true);
            }
        );
    });

    // ----- classify returns correct labels -----

    describe('classify_missing_value labels', () => {
        it('returns . for system missing', () => {
            expect(classify_missing_value(101, 'byte'))
                .toBe('.');
            expect(classify_missing_value(32741, 'int'))
                .toBe('.');
            expect(classify_missing_value(2147483621, 'long'))
                .toBe('.');
            expect(classify_missing_value(
                STATA_MISSING, 'double'
            )).toBe('.');
        });

        it('returns .a through .z for extended missing', () => {
            // byte: .a=102, .b=103, ..., .z=127
            expect(classify_missing_value(102, 'byte'))
                .toBe('.a');
            expect(classify_missing_value(103, 'byte'))
                .toBe('.b');
            expect(classify_missing_value(127, 'byte'))
                .toBe('.z');

            // int: .a=32742, .b=32743, ..., .z=32767
            expect(classify_missing_value(32742, 'int'))
                .toBe('.a');
            expect(classify_missing_value(32743, 'int'))
                .toBe('.b');
            expect(classify_missing_value(32767, 'int'))
                .toBe('.z');
        });

        it('returns null for non-missing values', () => {
            expect(classify_missing_value(0, 'byte'))
                .toBeNull();
            expect(classify_missing_value(50, 'int'))
                .toBeNull();
            expect(classify_missing_value(1.0, 'double'))
                .toBeNull();
        });
    });

    // ----- Type-unspecified (no type arg) -----

    describe('is_missing_value without explicit type', () => {
        it('detects double missing without type arg', () => {
            expect(is_missing_value(STATA_MISSING)).toBe(true);
            expect(is_missing_value(STATA_MISSING_A))
                .toBe(true);
            expect(is_missing_value(STATA_MISSING_Z))
                .toBe(true);
        });

        it('normal doubles are not missing', () => {
            expect(is_missing_value(0.0)).toBe(false);
            expect(is_missing_value(42)).toBe(false);
            expect(is_missing_value(-1.5)).toBe(false);
        });
    });

    describe('classify_missing_value without type', () => {
        it('classifies double missing without type arg',
            () => {
                expect(classify_missing_value(STATA_MISSING))
                    .toBe('.');
                expect(classify_missing_value(STATA_MISSING_A))
                    .toBe('.a');
                expect(classify_missing_value(STATA_MISSING_Z))
                    .toBe('.z');
            }
        );

        it('returns null for normal values', () => {
            expect(classify_missing_value(0.0)).toBeNull();
            expect(classify_missing_value(42)).toBeNull();
        });
    });
});

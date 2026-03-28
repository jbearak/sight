import { describe, it, expect } from 'bun:test';
import {
    apply_display_format,
} from '../../../src/dta-parser/display-format';

// -----------------------------------------------------------
// Stata display format application
// -----------------------------------------------------------

describe('display-format', () => {

    // ----- Null passthrough -----

    describe('null values', () => {
        it('returns null for null input', () => {
            expect(apply_display_format(null, '%9.0g'))
                .toBeNull();
        });

        it('returns null regardless of format', () => {
            expect(apply_display_format(null, '%9.2f'))
                .toBeNull();
            expect(apply_display_format(null, '%td'))
                .toBeNull();
            expect(apply_display_format(null, '%20s'))
                .toBeNull();
        });
    });

    // ----- String passthrough -----

    describe('string values', () => {
        it('returns string unchanged with %s format', () => {
            expect(apply_display_format('hello', '%20s'))
                .toBe('hello');
        });

        it('returns string unchanged with numeric format',
            () => {
                expect(apply_display_format('hello', '%9.0g'))
                    .toBe('hello');
            }
        );

        it('returns empty string unchanged', () => {
            expect(apply_display_format('', '%20s')).toBe('');
        });
    });

    // ----- Fixed-point %f -----

    describe('%f fixed-point format', () => {
        it('formats %9.2f with 3.14159', () => {
            expect(apply_display_format(3.14159, '%9.2f'))
                .toBe('3.14');
        });

        it('formats %9.0f with integer value', () => {
            expect(apply_display_format(42, '%9.0f'))
                .toBe('42');
        });

        it('formats %9.4f with many decimals', () => {
            expect(apply_display_format(1.23456789, '%9.4f'))
                .toBe('1.2346');
        });

        it('formats negative values', () => {
            expect(apply_display_format(-3.14, '%9.2f'))
                .toBe('-3.14');
        });

        it('formats zero', () => {
            expect(apply_display_format(0, '%9.2f'))
                .toBe('0.00');
        });
    });

    // ----- Fixed-point with commas %fc -----

    describe('%fc fixed-point with commas', () => {
        it('formats %9.2fc with large number', () => {
            expect(
                apply_display_format(1234567.89, '%9.2fc')
            ).toBe('1,234,567.89');
        });

        it('formats %12.0fc with integer', () => {
            expect(
                apply_display_format(1234567, '%12.0fc')
            ).toBe('1,234,567');
        });

        it('does not add comma for small numbers', () => {
            expect(apply_display_format(999, '%9.2fc'))
                .toBe('999.00');
        });

        it('formats negative with commas', () => {
            expect(
                apply_display_format(-1234567.89, '%12.2fc')
            ).toBe('-1,234,567.89');
        });
    });

    // ----- General %g -----

    describe('%g general format', () => {
        it('formats %9.0g with decimal value', () => {
            expect(apply_display_format(1234.5, '%9.0g'))
                .toBe('1234.5');
        });

        it('formats %9.0g with integer — no decimals', () => {
            expect(apply_display_format(42, '%9.0g'))
                .toBe('42');
        });

        it('formats %9.0g with zero', () => {
            expect(apply_display_format(0, '%9.0g'))
                .toBe('0');
        });

        it('formats %9.0g with negative', () => {
            expect(apply_display_format(-5.5, '%9.0g'))
                .toBe('-5.5');
        });

        it('formats %9.0g large integer', () => {
            expect(apply_display_format(1000000, '%9.0g'))
                .toBe('1000000');
        });
    });

    // ----- General with commas %gc -----

    describe('%gc general with commas', () => {
        it('formats %12.0gc with large integer', () => {
            expect(
                apply_display_format(1234567, '%12.0gc')
            ).toBe('1,234,567');
        });

        it('formats %12.0gc with decimal', () => {
            expect(
                apply_display_format(1234567.89, '%12.0gc')
            ).toBe('1,234,567.89');
        });

        it('formats small number without commas', () => {
            expect(apply_display_format(42, '%12.0gc'))
                .toBe('42');
        });
    });

    // ----- Scientific %e -----

    describe('%e scientific format', () => {
        it('formats %9.2e', () => {
            expect(apply_display_format(1234.5, '%9.2e'))
                .toBe('1.23e+03');
        });

        it('formats %9.4e', () => {
            expect(apply_display_format(0.001234, '%9.4e'))
                .toBe('1.2340e-03');
        });

        it('formats negative in scientific', () => {
            expect(apply_display_format(-42, '%9.2e'))
                .toBe('-4.20e+01');
        });

        it('formats zero in scientific', () => {
            expect(apply_display_format(0, '%9.2e'))
                .toBe('0.00e+00');
        });

        it('handles large exponents correctly', () => {
            expect(apply_display_format(1e+100, '%9.2e'))
                .toBe('1.00e+100');
            expect(apply_display_format(1e-100, '%9.2e'))
                .toBe('1.00e-100');
        });
    });

    // ----- Date %td -----

    describe('%td date format', () => {
        it('formats epoch as 01jan1960', () => {
            expect(apply_display_format(0, '%td'))
                .toBe('01jan1960');
        });

        it('formats 21185 as 01jan2018', () => {
            expect(apply_display_format(21185, '%td'))
                .toBe('01jan2018');
        });

        it('formats negative days (before epoch)', () => {
            expect(apply_display_format(-1, '%td'))
                .toBe('31dec1959');
        });

        it('formats leap year date', () => {
            // 29feb2000: 2000 is leap. Days from
            // 01jan1960 to 29feb2000.
            // 40 years, but we compute exactly:
            // 01jan1960 to 01jan2000 = 14610 days
            // 01jan2000 to 29feb2000 = 59 days
            expect(apply_display_format(14669, '%td'))
                .toBe('29feb2000');
        });
    });

    // ----- DateTime %tc -----

    describe('%tc datetime format', () => {
        it('formats epoch as 01jan1960 00:00:00', () => {
            expect(apply_display_format(0, '%tc'))
                .toBe('01jan1960 00:00:00');
        });

        it('formats one day in ms', () => {
            // 86400000 ms = 1 day
            expect(
                apply_display_format(86400000, '%tc')
            ).toBe('02jan1960 00:00:00');
        });

        it('formats with hours/minutes/seconds', () => {
            // 3661000 ms = 1h 1m 1s
            expect(
                apply_display_format(3661000, '%tc')
            ).toBe('01jan1960 01:01:01');
        });
    });

    // ----- Week %tw -----

    describe('%tw week format', () => {
        it('formats week 0 as 1960w1', () => {
            expect(apply_display_format(0, '%tw'))
                .toBe('1960w1');
        });

        it('formats week 52 as 1961w1', () => {
            expect(apply_display_format(52, '%tw'))
                .toBe('1961w1');
        });

        it('formats negative week', () => {
            expect(apply_display_format(-1, '%tw'))
                .toBe('1959w52');
        });
    });

    // ----- Month %tm -----

    describe('%tm month format', () => {
        it('formats month 0 as 1960m1', () => {
            expect(apply_display_format(0, '%tm'))
                .toBe('1960m1');
        });

        it('formats month 12 as 1961m1', () => {
            expect(apply_display_format(12, '%tm'))
                .toBe('1961m1');
        });

        it('formats negative month', () => {
            expect(apply_display_format(-1, '%tm'))
                .toBe('1959m12');
        });
    });

    // ----- Quarter %tq -----

    describe('%tq quarter format', () => {
        it('formats quarter 0 as 1960q1', () => {
            expect(apply_display_format(0, '%tq'))
                .toBe('1960q1');
        });

        it('formats quarter 4 as 1961q1', () => {
            expect(apply_display_format(4, '%tq'))
                .toBe('1961q1');
        });

        it('formats negative quarter', () => {
            expect(apply_display_format(-1, '%tq'))
                .toBe('1959q4');
        });
    });

    // ----- Year %ty -----

    describe('%ty year format', () => {
        it('formats 2020 as 2020', () => {
            expect(apply_display_format(2020, '%ty'))
                .toBe('2020');
        });

        it('formats 1960 as 1960', () => {
            expect(apply_display_format(1960, '%ty'))
                .toBe('1960');
        });
    });

    // ----- Fallback -----

    describe('unknown/fallback formats', () => {
        it('falls back to String() for unknown format', () => {
            expect(apply_display_format(42, '%unknown'))
                .toBe('42');
        });

        it('falls back for empty format string', () => {
            expect(apply_display_format(42, '')).toBe('42');
        });
    });

    // ----- Leading modifiers -----

    describe('format modifiers', () => {
        it('handles leading - in format', () => {
            expect(apply_display_format(3.14, '%-9.2f'))
                .toBe('3.14');
        });

        it('handles leading 0 in format', () => {
            expect(apply_display_format(3.14, '%09.2f'))
                .toBe('3.14');
        });

        it('handles leading + in format', () => {
            expect(apply_display_format(3.14, '%+9.2f'))
                .toBe('3.14');
        });
    });
});

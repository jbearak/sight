// -----------------------------------------------------------
// Stata missing value detection and classification
//
// Stata encodes missing values as sentinel values at the
// upper end of each numeric type's range:
//   .  = system missing
//   .a through .z = extended missing (26 values)
//
// Integer types (byte, int, long) use simple thresholds.
// Floating-point types (float, double) use IEEE 754 bit
// patterns in the quiet-NaN range.
// -----------------------------------------------------------

// ----- Integer-type thresholds -----

const BYTE_MISSING_DOT = 101;
const BYTE_MISSING_Z = 127;

const INT_MISSING_DOT = 32741;
const INT_MISSING_Z = 32767;

const LONG_MISSING_DOT = 2147483621;
const LONG_MISSING_Z = 2147483647;

// ----- IEEE 754 double missing values -----
// Stata's double missing . is the big-endian byte pattern
// 7f e0 00 00 00 00 00 00.  Each extended missing adds 1
// to the low byte: .a = ...01, .b = ...02, .z = ...1a.

const DOUBLE_MISSING_BYTES = new Uint8Array(
    [0x7f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
);
const DOUBLE_MISSING_A_BYTES = new Uint8Array(
    [0x7f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]
);
const DOUBLE_MISSING_Z_BYTES = new Uint8Array(
    [0x7f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1a]
);

function bytes_to_double(bytes: Uint8Array): number {
    // Stata stores big-endian bit patterns. DataView
    // getFloat64 with false = big-endian.
    const my_view = new DataView(bytes.buffer);
    return my_view.getFloat64(0, false);
}

/** System missing (.) as a double value. */
export const STATA_MISSING: number =
    bytes_to_double(DOUBLE_MISSING_BYTES);

/** Extended missing .a as a double value. */
export const STATA_MISSING_A: number =
    bytes_to_double(DOUBLE_MISSING_A_BYTES);

/** Extended missing .z as a double value. */
export const STATA_MISSING_Z: number =
    bytes_to_double(DOUBLE_MISSING_Z_BYTES);

type NumericDtaType =
    | 'byte'
    | 'int'
    | 'long'
    | 'float'
    | 'double';

// ----- Integer helpers -----

function is_integer_missing(
    value: number,
    dot: number,
    z: number
): boolean {
    return value >= dot && value <= z;
}

function classify_integer_missing(
    value: number,
    dot: number,
    z: number
): string | null {
    if (value < dot || value > z) return null;
    if (value === dot) return '.';
    const my_offset = value - dot;
    // offset 1 = .a, offset 26 = .z
    return '.' + String.fromCharCode(96 + my_offset);
}

// ----- Floating-point helpers -----

/**
 * Test whether a double value falls in Stata's missing
 * range (. through .z).  We compare the raw IEEE 754 bits
 * because NaN !== NaN in JavaScript.
 */
function is_double_missing(value: number): boolean {
    const my_buf = new ArrayBuffer(8);
    const my_view = new DataView(my_buf);
    my_view.setFloat64(0, value, false); // big-endian

    // Compare the first 6 bytes against the missing prefix
    // (7f e0 00 00 00 00).  Bytes 6-7 encode the letter.
    for (let i = 0; i < 6; i++) {
        if (my_view.getUint8(i) !== DOUBLE_MISSING_BYTES[i]) {
            return false;
        }
    }
    const my_low_word =
        (my_view.getUint8(6) << 8) | my_view.getUint8(7);
    return my_low_word >= 0x0000 && my_low_word <= 0x001a;
}

function classify_double_missing(
    value: number
): string | null {
    const my_buf = new ArrayBuffer(8);
    const my_view = new DataView(my_buf);
    my_view.setFloat64(0, value, false);

    for (let i = 0; i < 6; i++) {
        if (my_view.getUint8(i) !== DOUBLE_MISSING_BYTES[i]) {
            return null;
        }
    }
    const my_low_word =
        (my_view.getUint8(6) << 8) | my_view.getUint8(7);
    if (my_low_word > 0x001a) return null;
    if (my_low_word === 0x0000) return '.';
    return '.' + String.fromCharCode(96 + my_low_word);
}

// -----------------------------------------------------------
// Public API
// -----------------------------------------------------------

/**
 * Returns true if `value` is a Stata missing value for the
 * given type.  When no type is provided, checks against
 * double/float thresholds (the default for in-memory values
 * after reading a .dta).
 */
export function is_missing_value(
    value: number,
    type?: NumericDtaType
): boolean {
    switch (type) {
        case 'byte':
            return is_integer_missing(
                value, BYTE_MISSING_DOT, BYTE_MISSING_Z
            );
        case 'int':
            return is_integer_missing(
                value, INT_MISSING_DOT, INT_MISSING_Z
            );
        case 'long':
            return is_integer_missing(
                value, LONG_MISSING_DOT, LONG_MISSING_Z
            );
        case 'float':
        case 'double':
            return is_double_missing(value);
        default:
            // No type specified — use double range
            return is_double_missing(value);
    }
}

/**
 * Classify a Stata missing value.  Returns '.', '.a' ..
 * '.z', or null if the value is not missing.
 */
export function classify_missing_value(
    value: number,
    type?: NumericDtaType
): string | null {
    switch (type) {
        case 'byte':
            return classify_integer_missing(
                value,
                BYTE_MISSING_DOT,
                BYTE_MISSING_Z
            );
        case 'int':
            return classify_integer_missing(
                value,
                INT_MISSING_DOT,
                INT_MISSING_Z
            );
        case 'long':
            return classify_integer_missing(
                value,
                LONG_MISSING_DOT,
                LONG_MISSING_Z
            );
        case 'float':
        case 'double':
            return classify_double_missing(value);
        default:
            return classify_double_missing(value);
    }
}

# Sight Data Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code integrated data browser for Stata `.dta` datasets, invoked from Stata's console via `vview`, rendering in a webview panel with virtualized scrolling and lazy row loading.

**Architecture:** The feature has four layers: (1) a TypeScript `.dta` parser that reads format v117/v118/v119 files with random-access row reads, (2) a webview panel with a virtualized data grid for rendering millions of rows, (3) a file watcher that detects `vview` signals from Stata and opens browser tabs, and (4) the `vview.ado` Stata command that writes temp files and signals the extension.

**Tech Stack:** TypeScript, VS Code Webview API, glide-data-grid (React + canvas), Node.js `fs` for file I/O, chokidar for file watching.

**Spec:** `specs/sight_data_browser.md`

---

## File Structure

### New files — Server-side (`.dta` parser)

```text
src/dta-parser/
  index.ts               - Public API: DtaFile class (open, readRows, close)
  types.ts               - DtaType enum, VariableInfo, Row, format version constants
  header.ts              - Parse header, map section, variable metadata
  data-reader.ts         - Random-access row reads from data section
  strl-reader.ts         - GSO block indexing and strL resolution
  value-labels.ts        - Value label table parsing
  display-format.ts      - Stata display format application (%9.2f, %td, etc.)
  missing-values.ts      - Extended missing value detection (.a–.z)
```

### New files — Client-side (webview + watcher)

```text
client/src/data-browser/
  index.ts               - Module entry: register_data_browser(), command registration
  panel-manager.ts       - DataBrowserPanelManager (tab map, replace logic)
  browser-panel.ts       - DataBrowserPanel (webview lifecycle, postMessage protocol)
  signal-watcher.ts      - chokidar watcher on ~/.sight/browse/ for signal files
  webview-html.ts        - HTML shell with React mount point + bundled grid JS
  types.ts               - Shared message types (RowRequest, RowResponse, MetadataMessage)
```

### New files — Webview app (React, bundled separately)

```text
client/src/data-browser/webview/
  index.tsx              - React entry point, renders DataGrid
  data-grid.tsx          - glide-data-grid wrapper with row loading
  toolbar.tsx            - Toggle buttons, search, row count
  status-bar.tsx         - Dataset info display
  use-row-loader.ts      - React hook for lazy row fetching via postMessage
  cell-renderer.ts       - Custom cell rendering (missing values, value labels)
  types.ts               - Webview-side type definitions
```

### New files — Stata

```text
stata/vview.ado          - Stata command: save temp .dta, write JSON sidecar, signal
```

### New files — Tests

```text
tests/unit/dta-parser/
  header.test.ts         - Header + metadata parsing for v117/v118/v119
  data-reader.test.ts    - Row reads, type decoding, byte order
  strl-reader.test.ts    - GSO index building and strL resolution
  value-labels.test.ts   - Value label table parsing
  display-format.test.ts - Stata format string application
  missing-values.test.ts - Extended missing value detection

tests/unit/data-browser/
  signal-watcher.test.ts - Signal file detection and JSON parsing
  panel-manager.test.ts  - Tab management, replace logic
  row-cache.test.ts      - LRU page cache behavior

tests/fixtures/dta/
  auto_v117.dta          - Stata 13 format test fixture
  auto_v118.dta          - Stata 14 format test fixture (primary)
  auto_v119.dta          - Stata 15+ format test fixture
  strl_test.dta          - Dataset with strL variables
  value_labels.dta       - Dataset with value label tables
  empty.dta              - Zero observations
  wide.dta               - Many variables (100+)
  missing_values.dta     - Extended missing values (.a–.z)
```

### Modified files

```text
client/src/extension.ts          - Import and call register_data_browser()
client/package.json              - Add sight.personalAdoDir setting, commands, dependencies
package.json                     - Add chokidar dependency (if not using fs.watch)
```

---

## Task 1: Generate .dta Test Fixtures

Before writing the parser, we need real `.dta` files to test against. We'll create a Stata script that generates fixture files, then commit them as binary test fixtures.

**Files:**
- Create: `tests/fixtures/dta/generate_fixtures.do`
- Create: `tests/fixtures/dta/auto_v118.dta` (and others — binary, committed)

- [ ] **Step 1: Write the Stata fixture generator script**

```stata
// tests/fixtures/dta/generate_fixtures.do
// Run in Stata 16+ to generate test .dta files for the parser

// v118 — standard auto dataset
sysuse auto, clear
save "auto_v118.dta", replace

// v117 — Stata 13 format
sysuse auto, clear
saveold "auto_v117.dta", version(13) replace

// v119 — large format (needs Stata 15+/MP, but saveold 15 works)
sysuse auto, clear
save "auto_v119.dta", replace
// Note: v119 only differs from v118 when K > 32,767 or N > 2B.
// For testing, v118 and v119 share the same tag in normal datasets.
// We'll create a v119 marker by hand if needed, or test with v118 logic.

// strL test — dataset with long string variables
clear
set obs 5
gen strL long_text = "This is observation " + string(_n)
replace long_text = long_text + ". " + "Extra text to make it longer." if _n == 3
gen id = _n
gen str10 short_text = "short" + string(_n)
save "strl_test.dta", replace

// Value labels test
clear
set obs 10
gen byte foreign = mod(_n, 2)
gen byte rep78 = mod(_n, 5) + 1
label define foreign_lbl 0 "Domestic" 1 "Foreign"
label define rep_lbl 1 "Poor" 2 "Fair" 3 "Average" 4 "Good" 5 "Excellent"
label values foreign foreign_lbl
label values rep78 rep_lbl
label variable foreign "Car origin"
label variable rep78 "Repair record"
save "value_labels.dta", replace

// Empty dataset
clear
gen x = .
drop x
gen double price = .
gen str20 make = ""
drop if 1
save "empty.dta", replace

// Wide dataset (100+ variables)
clear
set obs 20
forvalues i = 1/120 {
    gen var`i' = runiform()
}
save "wide.dta", replace

// Extended missing values
clear
set obs 30
gen double x = _n
replace x = . if _n == 1
replace x = .a if _n == 2
replace x = .b if _n == 3
replace x = .z if _n == 4
gen str10 label = "obs" + string(_n)
label variable x "Test variable with missing values"
save "missing_values.dta", replace
```

- [ ] **Step 2: Run the fixture generator in Stata**

Run: Open Stata 16+, `cd` to `tests/fixtures/dta/`, and `do generate_fixtures.do`.

This produces: `auto_v117.dta`, `auto_v118.dta`, `strl_test.dta`, `value_labels.dta`, `empty.dta`, `wide.dta`, `missing_values.dta`.

- [ ] **Step 3: Verify fixtures exist and have reasonable sizes**

Run: `ls -la tests/fixtures/dta/*.dta`

Expected: 7 `.dta` files, sizes ranging from ~200 bytes (empty) to ~10KB (auto).

- [ ] **Step 4: Commit fixtures**

```bash
git add tests/fixtures/dta/
git commit -m "test: add .dta fixture files for data browser parser tests"
```

---

## Task 2: .dta Types and Constants

Define the type system for the `.dta` parser — format versions, type codes, byte widths, and public interfaces.

**Files:**
- Create: `src/dta-parser/types.ts`
- Create: `src/dta-parser/missing-values.ts`
- Test: `tests/unit/dta-parser/missing-values.test.ts`

- [ ] **Step 1: Write tests for missing value detection**

```typescript
// tests/unit/dta-parser/missing-values.test.ts
import { describe, it, expect } from 'bun:test';
import {
    is_missing_value,
    classify_missing_value,
    STATA_MISSING,
    STATA_MISSING_A,
    STATA_MISSING_Z,
} from '../../src/dta-parser/missing-values';

describe('missing value detection', () => {
    it('detects system missing (.)', () => {
        expect(is_missing_value(STATA_MISSING)).toBe(true);
        expect(classify_missing_value(STATA_MISSING)).toBe('.');
    });

    it('detects extended missing .a', () => {
        expect(is_missing_value(STATA_MISSING_A)).toBe(true);
        expect(classify_missing_value(STATA_MISSING_A)).toBe('.a');
    });

    it('detects extended missing .z', () => {
        expect(is_missing_value(STATA_MISSING_Z)).toBe(true);
        expect(classify_missing_value(STATA_MISSING_Z)).toBe('.z');
    });

    it('does not flag normal numbers as missing', () => {
        expect(is_missing_value(0)).toBe(false);
        expect(is_missing_value(42.5)).toBe(false);
        expect(is_missing_value(-1)).toBe(false);
        expect(is_missing_value(Number.MAX_VALUE)).toBe(false);
    });

    it('detects byte-level missing values', () => {
        // Stata byte missing is 127
        expect(is_missing_value(127, 'byte')).toBe(true);
        expect(is_missing_value(126, 'byte')).toBe(false);
    });

    it('detects int-level missing values', () => {
        // Stata int missing is 32767
        expect(is_missing_value(32767, 'int')).toBe(true);
        expect(is_missing_value(32766, 'int')).toBe(false);
    });

    it('detects long-level missing values', () => {
        // Stata long missing is 2147483621
        expect(is_missing_value(2147483621, 'long')).toBe(true);
        expect(is_missing_value(2147483620, 'long')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/dta-parser/missing-values.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create types.ts with format constants and type definitions**

```typescript
// src/dta-parser/types.ts

// .dta format version tags
export const DTA_FORMAT_117 = '<stata_dta><header><release>117</release>';
export const DTA_FORMAT_118 = '<stata_dta><header><release>118</release>';
export const DTA_FORMAT_119 = '<stata_dta><header><release>119</release>';

// Type codes used in the variable types section
export const enum DtaTypeCode {
    // Fixed-width numeric types
    BYTE = 65530,      // 1 byte  (v118). v117: 251
    INT = 65529,       // 2 bytes (v118). v117: 252
    LONG = 65528,      // 4 bytes (v118). v117: 253
    FLOAT = 65527,     // 4 bytes (v118). v117: 254
    DOUBLE = 65526,    // 8 bytes (v118). v117: 255
    STRL = 32768,      // 8 bytes (GSO pointer). v117: 32768

    // v117 numeric type codes
    BYTE_V117 = 251,
    INT_V117 = 252,
    LONG_V117 = 253,
    FLOAT_V117 = 254,
    DOUBLE_V117 = 255,
}

// String types: 1..2045 in v118, 1..244 in v117
// The type code IS the string width in bytes

export type DtaType =
    | 'byte' | 'int' | 'long' | 'float' | 'double'
    | 'strL'
    | `str${number}`;

// Byte widths for each numeric type
export function byte_width_for_type_code(
    code: number,
    format_version: 117 | 118 | 119
): number {
    if (format_version === 117) {
        if (code === DtaTypeCode.BYTE_V117) return 1;
        if (code === DtaTypeCode.INT_V117) return 2;
        if (code === DtaTypeCode.LONG_V117) return 4;
        if (code === DtaTypeCode.FLOAT_V117) return 4;
        if (code === DtaTypeCode.DOUBLE_V117) return 8;
        if (code === DtaTypeCode.STRL) return 8;
        // str1..str244
        if (code >= 1 && code <= 244) return code;
    } else {
        // v118, v119
        if (code === DtaTypeCode.BYTE) return 1;
        if (code === DtaTypeCode.INT) return 2;
        if (code === DtaTypeCode.LONG) return 4;
        if (code === DtaTypeCode.FLOAT) return 4;
        if (code === DtaTypeCode.DOUBLE) return 8;
        if (code === DtaTypeCode.STRL) return 8;
        // str1..str2045
        if (code >= 1 && code <= 2045) return code;
    }
    throw new Error(`Unknown type code: ${code} for format v${format_version}`);
}

export function type_code_to_dta_type(
    code: number,
    format_version: 117 | 118 | 119
): DtaType {
    if (format_version === 117) {
        if (code === DtaTypeCode.BYTE_V117) return 'byte';
        if (code === DtaTypeCode.INT_V117) return 'int';
        if (code === DtaTypeCode.LONG_V117) return 'long';
        if (code === DtaTypeCode.FLOAT_V117) return 'float';
        if (code === DtaTypeCode.DOUBLE_V117) return 'double';
        if (code === DtaTypeCode.STRL) return 'strL';
        if (code >= 1 && code <= 244) return `str${code}`;
    } else {
        if (code === DtaTypeCode.BYTE) return 'byte';
        if (code === DtaTypeCode.INT) return 'int';
        if (code === DtaTypeCode.LONG) return 'long';
        if (code === DtaTypeCode.FLOAT) return 'float';
        if (code === DtaTypeCode.DOUBLE) return 'double';
        if (code === DtaTypeCode.STRL) return 'strL';
        if (code >= 1 && code <= 2045) return `str${code}`;
    }
    throw new Error(`Unknown type code: ${code} for format v${format_version}`);
}

export interface VariableInfo {
    name: string;
    type: DtaType;
    type_code: number;
    format: string;           // e.g., "%9.0g", "%20s", "%td"
    label: string;            // variable label
    value_label_name: string; // name of associated value label table, or ""
    byte_width: number;       // width in bytes in the data section
    byte_offset: number;      // offset within an observation row
}

export type Row = (number | string | null)[];

export interface DtaMetadata {
    format_version: 117 | 118 | 119;
    byte_order: 'MSF' | 'LSF';  // big-endian or little-endian
    nvar: number;
    nobs: number;
    dataset_label: string;
    variables: VariableInfo[];
    // Byte offsets to each section (from the <map> section)
    section_offsets: SectionOffsets;
    obs_length: number;  // total bytes per observation row
}

export interface SectionOffsets {
    stata_data: number;
    map: number;
    variable_types: number;
    varnames: number;
    sortlist: number;
    formats: number;
    value_label_names: number;
    variable_labels: number;
    characteristics: number;
    data: number;
    strls: number;
    value_labels: number;
    stata_data_close: number;
    end_of_file: number;
}
```

- [ ] **Step 4: Create missing-values.ts**

```typescript
// src/dta-parser/missing-values.ts

// Stata's double-precision missing value constants.
// System missing (.) is the smallest; .a through .z follow.
// These are specific bit patterns in IEEE 754 double format.

// In Stata's double representation:
// . (system missing) = 2^1023 + 1 (specific quiet NaN pattern)
// The actual double value: bytes 7f e0 00 00 00 00 00 00 (big-endian)
export const STATA_MISSING = new DataView(
    new Uint8Array([0x7f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer
).getFloat64(0, false);

export const STATA_MISSING_A = new DataView(
    new Uint8Array([0x7f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]).buffer
).getFloat64(0, false);

export const STATA_MISSING_Z = new DataView(
    new Uint8Array([0x7f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1a]).buffer
).getFloat64(0, false);

// Missing value thresholds for integer types
const BYTE_MISSING_MIN = 101;    // . = 101, .a = 102, ..., .z = 127
const INT_MISSING_MIN = 32741;   // . = 32741, ..., .z = 32767
const LONG_MISSING_MIN = 2147483621; // . = 2147483621, ..., .z = 2147483647

export function is_missing_value(
    value: number,
    type?: 'byte' | 'int' | 'long' | 'float' | 'double'
): boolean {
    if (type === 'byte') return value >= BYTE_MISSING_MIN;
    if (type === 'int') return value >= INT_MISSING_MIN;
    if (type === 'long') return value >= LONG_MISSING_MIN;
    // float and double: compare against the double missing threshold
    return value >= STATA_MISSING;
}

export function classify_missing_value(
    value: number,
    type?: 'byte' | 'int' | 'long' | 'float' | 'double'
): string | null {
    let offset: number;

    if (type === 'byte') {
        if (value < BYTE_MISSING_MIN) return null;
        offset = value - BYTE_MISSING_MIN;
    } else if (type === 'int') {
        if (value < INT_MISSING_MIN) return null;
        offset = value - INT_MISSING_MIN;
    } else if (type === 'long') {
        if (value < LONG_MISSING_MIN) return null;
        offset = value - LONG_MISSING_MIN;
    } else {
        // float or double — use DataView to extract the offset byte
        if (value < STATA_MISSING) return null;
        const my_buf = new ArrayBuffer(8);
        new DataView(my_buf).setFloat64(0, value, false);
        offset = new DataView(my_buf).getUint8(7);
    }

    if (offset === 0) return '.';
    if (offset >= 1 && offset <= 26) {
        return '.' + String.fromCharCode(96 + offset); // .a = 1, .z = 26
    }
    return '.';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/dta-parser/missing-values.test.ts`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dta-parser/types.ts src/dta-parser/missing-values.ts tests/unit/dta-parser/missing-values.test.ts
git commit -m "feat(data-browser): add .dta type definitions and missing value detection"
```

---

## Task 3: .dta Header and Metadata Parsing

Parse the `.dta` file header, section map, variable types, names, formats, labels, and value label names. This is the metadata-only read path.

**Files:**
- Create: `src/dta-parser/header.ts`
- Test: `tests/unit/dta-parser/header.test.ts`

- [ ] **Step 1: Write tests for header parsing**

```typescript
// tests/unit/dta-parser/header.test.ts
import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../src/dta-parser/header';

const FIXTURE_DIR = path.join(__dirname, '../../tests/fixtures/dta');

describe('parse_metadata', () => {
    it('parses v118 auto.dta header', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        expect(my_meta.format_version).toBe(118);
        expect(my_meta.nobs).toBe(74);
        expect(my_meta.nvar).toBe(12);
        expect(my_meta.byte_order).toMatch(/^[LM]SF$/);
    });

    it('reads variable names from auto.dta', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const the_names = my_meta.variables.map(v => v.name);

        expect(the_names).toContain('make');
        expect(the_names).toContain('price');
        expect(the_names).toContain('mpg');
        expect(the_names).toContain('foreign');
        expect(the_names.length).toBe(12);
    });

    it('reads variable types correctly', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        const my_make = my_meta.variables.find(v => v.name === 'make');
        expect(my_make?.type).toMatch(/^str\d+$/);

        const my_price = my_meta.variables.find(v => v.name === 'price');
        expect(['int', 'long', 'float', 'double']).toContain(
            my_price?.type
        );
    });

    it('reads display formats', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        const my_price = my_meta.variables.find(v => v.name === 'price');
        expect(my_price?.format).toBeTruthy();
        expect(my_price?.format).toMatch(/^%/);
    });

    it('reads variable labels', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        const my_make = my_meta.variables.find(v => v.name === 'make');
        expect(my_make?.label).toBe('Make and model');
    });

    it('reads value label names', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'value_labels.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        const my_foreign = my_meta.variables.find(
            v => v.name === 'foreign'
        );
        expect(my_foreign?.value_label_name).toBeTruthy();
    });

    it('computes obs_length as sum of variable byte widths', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        const my_expected_length = my_meta.variables.reduce(
            (sum, v) => sum + v.byte_width, 0
        );
        expect(my_meta.obs_length).toBe(my_expected_length);
    });

    it('parses v117 format', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v117.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        expect(my_meta.format_version).toBe(117);
        expect(my_meta.nobs).toBe(74);
        expect(my_meta.nvar).toBe(12);
    });

    it('parses empty dataset', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'empty.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        expect(my_meta.nobs).toBe(0);
        expect(my_meta.nvar).toBeGreaterThan(0);
    });

    it('parses wide dataset (100+ variables)', async () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'wide.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        expect(my_meta.nvar).toBe(120);
    });

    it('computes correct byte offsets per variable', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);

        // First variable starts at offset 0
        expect(my_meta.variables[0].byte_offset).toBe(0);

        // Each subsequent variable starts after the previous one
        for (let i = 1; i < my_meta.variables.length; i++) {
            const my_expected = my_meta.variables[i - 1].byte_offset
                + my_meta.variables[i - 1].byte_width;
            expect(my_meta.variables[i].byte_offset).toBe(my_expected);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/dta-parser/header.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement header.ts**

The `.dta` format uses XML-like tags as section markers. The implementation reads the file as an ArrayBuffer, finds the `<header>` section, extracts format version, byte order, K (nvar), N (nobs), and dataset label, then reads the `<map>` section for byte offsets to all subsequent sections, and finally reads variable types, names, formats, labels, and value label names from their respective sections.

```typescript
// src/dta-parser/header.ts
import {
    DtaMetadata,
    SectionOffsets,
    VariableInfo,
    byte_width_for_type_code,
    type_code_to_dta_type,
} from './types';

// XML-like tag markers used in .dta format
const TAG_OPEN_HEADER = '<header>';
const TAG_CLOSE_HEADER = '</header>';
const TAG_RELEASE = '<release>';
const TAG_CLOSE_RELEASE = '</release>';
const TAG_BYTEORDER = '<byteorder>';
const TAG_CLOSE_BYTEORDER = '</byteorder>';
const TAG_K = '<K>';
const TAG_CLOSE_K = '</K>';
const TAG_N = '<N>';
const TAG_CLOSE_N = '</N>';
const TAG_LABEL = '<label>';
const TAG_CLOSE_LABEL = '</label>';

const TAG_MAP = '<map>';
const TAG_VARIABLE_TYPES = '<variable_types>';
const TAG_VARNAMES = '<varnames>';
const TAG_SORTLIST = '<sortlist>';
const TAG_FORMATS = '<formats>';
const TAG_VALUE_LABEL_NAMES = '<value_label_names>';
const TAG_VARIABLE_LABELS = '<variable_labels>';

const TEXT_DECODER = new TextDecoder('utf-8');

export function parse_metadata(buffer: ArrayBuffer): DtaMetadata {
    const my_view = new DataView(buffer);
    const my_bytes = new Uint8Array(buffer);

    // Detect format version from first bytes
    const my_header_str = TEXT_DECODER.decode(my_bytes.slice(0, 80));
    let format_version: 117 | 118 | 119;
    if (my_header_str.includes('117')) {
        format_version = 117;
    } else if (my_header_str.includes('118')) {
        format_version = 118;
    } else if (my_header_str.includes('119')) {
        format_version = 119;
    } else {
        throw new Error(
            'Unsupported .dta format. Expected v117, v118, or v119.'
        );
    }

    // Byte order
    const my_bo_start = find_tag(my_bytes, TAG_BYTEORDER)
        + TAG_BYTEORDER.length;
    const my_bo_str = TEXT_DECODER.decode(my_bytes.slice(
        my_bo_start, my_bo_start + 3
    ));
    const byte_order: 'MSF' | 'LSF' =
        my_bo_str === 'MSF' ? 'MSF' : 'LSF';
    const is_little_endian = byte_order === 'LSF';

    // K (number of variables)
    const my_k_start = find_tag(my_bytes, TAG_K) + TAG_K.length;
    // v117: K is 2 bytes; v118/v119: K is 2 bytes (v118) or 4 bytes (v119)
    let nvar: number;
    if (format_version === 119) {
        nvar = my_view.getUint32(my_k_start, is_little_endian);
    } else {
        nvar = my_view.getUint16(my_k_start, is_little_endian);
    }

    // N (number of observations)
    const my_n_start = find_tag(my_bytes, TAG_N) + TAG_N.length;
    // v117: N is 4 bytes; v118: 4 bytes; v119: 8 bytes
    let nobs: number;
    if (format_version === 119) {
        // Read as BigInt64 then convert (safe for reasonable dataset sizes)
        const my_lo = my_view.getUint32(my_n_start, is_little_endian);
        const my_hi = my_view.getUint32(my_n_start + 4, is_little_endian);
        nobs = is_little_endian
            ? my_lo + my_hi * 0x100000000
            : my_hi + my_lo * 0x100000000;
    } else {
        nobs = my_view.getUint32(my_n_start, is_little_endian);
    }

    // Dataset label
    const my_label_start = find_tag(my_bytes, TAG_LABEL)
        + TAG_LABEL.length;
    // v117: 1-byte length prefix + string; v118/v119: 2-byte length prefix
    let dataset_label: string;
    if (format_version === 117) {
        const my_label_len = my_view.getUint8(my_label_start);
        dataset_label = read_string(
            my_bytes, my_label_start + 1, my_label_len
        );
    } else {
        const my_label_len = my_view.getUint16(
            my_label_start, is_little_endian
        );
        dataset_label = read_string(
            my_bytes, my_label_start + 2, my_label_len
        );
    }

    // Section map (14 eight-byte offsets)
    const my_map_start = find_tag(my_bytes, TAG_MAP) + TAG_MAP.length;
    const section_offsets = read_section_map(
        my_view, my_map_start, is_little_endian
    );

    // Variable types
    const my_types_start = section_offsets.variable_types
        + TAG_VARIABLE_TYPES.length;
    const the_type_codes = read_variable_types(
        my_view, my_types_start, nvar, format_version, is_little_endian
    );

    // Variable names
    const my_names_start = section_offsets.varnames
        + TAG_VARNAMES.length;
    const the_names = read_variable_names(
        my_bytes, my_names_start, nvar, format_version
    );

    // Display formats
    const my_formats_start = section_offsets.formats
        + TAG_FORMATS.length;
    const the_formats = read_formats(
        my_bytes, my_formats_start, nvar, format_version
    );

    // Value label names
    const my_vl_names_start = section_offsets.value_label_names
        + TAG_VALUE_LABEL_NAMES.length;
    const the_value_label_names = read_value_label_names(
        my_bytes, my_vl_names_start, nvar, format_version
    );

    // Variable labels
    const my_var_labels_start = section_offsets.variable_labels
        + TAG_VARIABLE_LABELS.length;
    const the_variable_labels = read_variable_labels(
        my_bytes, my_var_labels_start, nvar, format_version
    );

    // Build VariableInfo array with byte offsets
    let my_byte_offset = 0;
    const the_variables: VariableInfo[] = [];
    for (let i = 0; i < nvar; i++) {
        const my_width = byte_width_for_type_code(
            the_type_codes[i], format_version
        );
        the_variables.push({
            name: the_names[i],
            type: type_code_to_dta_type(the_type_codes[i], format_version),
            type_code: the_type_codes[i],
            format: the_formats[i],
            label: the_variable_labels[i],
            value_label_name: the_value_label_names[i],
            byte_width: my_width,
            byte_offset: my_byte_offset,
        });
        my_byte_offset += my_width;
    }

    return {
        format_version,
        byte_order,
        nvar,
        nobs,
        dataset_label,
        variables: the_variables,
        section_offsets,
        obs_length: my_byte_offset,
    };
}

// Helper: find a UTF-8 tag in the byte array and return its start position
function find_tag(bytes: Uint8Array, tag: string): number {
    const my_tag_bytes = new TextEncoder().encode(tag);
    outer:
    for (let i = 0; i <= bytes.length - my_tag_bytes.length; i++) {
        for (let j = 0; j < my_tag_bytes.length; j++) {
            if (bytes[i + j] !== my_tag_bytes[j]) continue outer;
        }
        return i;
    }
    throw new Error(`Tag not found: ${tag}`);
}

function read_string(
    bytes: Uint8Array, offset: number, length: number
): string {
    // Read up to `length` bytes, stop at null terminator
    let my_end = offset + length;
    for (let i = offset; i < my_end; i++) {
        if (bytes[i] === 0) { my_end = i; break; }
    }
    return TEXT_DECODER.decode(bytes.slice(offset, my_end));
}

function read_section_map(
    view: DataView, offset: number, little_endian: boolean
): SectionOffsets {
    const the_offsets: number[] = [];
    for (let i = 0; i < 14; i++) {
        // Each offset is 8 bytes (int64)
        const my_lo = view.getUint32(offset + i * 8, little_endian);
        const my_hi = view.getUint32(offset + i * 8 + 4, little_endian);
        the_offsets.push(
            little_endian
                ? my_lo + my_hi * 0x100000000
                : my_hi + my_lo * 0x100000000
        );
    }
    return {
        stata_data: the_offsets[0],
        map: the_offsets[1],
        variable_types: the_offsets[2],
        varnames: the_offsets[3],
        sortlist: the_offsets[4],
        formats: the_offsets[5],
        value_label_names: the_offsets[6],
        variable_labels: the_offsets[7],
        characteristics: the_offsets[8],
        data: the_offsets[9],
        strls: the_offsets[10],
        value_labels: the_offsets[11],
        stata_data_close: the_offsets[12],
        end_of_file: the_offsets[13],
    };
}

function read_variable_types(
    view: DataView,
    offset: number,
    nvar: number,
    format_version: 117 | 118 | 119,
    little_endian: boolean
): number[] {
    const the_codes: number[] = [];
    if (format_version === 117) {
        // v117: each type is 1 byte for str, 1 byte for numeric
        // Actually v117 uses 1-byte unsigned codes: 251-255 for numerics,
        // 1-244 for strings, 32768 doesn't exist in v117
        // Wait — v117 uses 2-byte type codes same as v118, just different values
        // Actually the .dta v117 spec says types are uint8 codes... let me check.
        // Per Stata docs: v117 uses 2-byte type codes.
        for (let i = 0; i < nvar; i++) {
            the_codes.push(
                view.getUint16(offset + i * 2, little_endian)
            );
        }
    } else {
        // v118/v119: 2-byte type codes
        for (let i = 0; i < nvar; i++) {
            the_codes.push(
                view.getUint16(offset + i * 2, little_endian)
            );
        }
    }
    return the_codes;
}

function read_variable_names(
    bytes: Uint8Array,
    offset: number,
    nvar: number,
    format_version: 117 | 118 | 119
): string[] {
    // v117: 33 bytes per name; v118/v119: 129 bytes per name
    const my_name_len = format_version === 117 ? 33 : 129;
    const the_names: string[] = [];
    for (let i = 0; i < nvar; i++) {
        the_names.push(
            read_string(bytes, offset + i * my_name_len, my_name_len)
        );
    }
    return the_names;
}

function read_formats(
    bytes: Uint8Array,
    offset: number,
    nvar: number,
    format_version: 117 | 118 | 119
): string[] {
    // v117: 49 bytes per format; v118/v119: 57 bytes per format
    const my_fmt_len = format_version === 117 ? 49 : 57;
    const the_formats: string[] = [];
    for (let i = 0; i < nvar; i++) {
        the_formats.push(
            read_string(bytes, offset + i * my_fmt_len, my_fmt_len)
        );
    }
    return the_formats;
}

function read_value_label_names(
    bytes: Uint8Array,
    offset: number,
    nvar: number,
    format_version: 117 | 118 | 119
): string[] {
    // v117: 33 bytes; v118/v119: 129 bytes
    const my_name_len = format_version === 117 ? 33 : 129;
    const the_names: string[] = [];
    for (let i = 0; i < nvar; i++) {
        the_names.push(
            read_string(bytes, offset + i * my_name_len, my_name_len)
        );
    }
    return the_names;
}

function read_variable_labels(
    bytes: Uint8Array,
    offset: number,
    nvar: number,
    format_version: 117 | 118 | 119
): string[] {
    // v117: 81 bytes; v118/v119: 321 bytes
    const my_label_len = format_version === 117 ? 81 : 321;
    const the_labels: string[] = [];
    for (let i = 0; i < nvar; i++) {
        the_labels.push(
            read_string(bytes, offset + i * my_label_len, my_label_len)
        );
    }
    return the_labels;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/dta-parser/header.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dta-parser/header.ts tests/unit/dta-parser/header.test.ts
git commit -m "feat(data-browser): parse .dta header and metadata (v117/v118/v119)"
```

---

## Task 4: Data Section Row Reader

Read decoded observation data from the data section using random-access seeks.

**Files:**
- Create: `src/dta-parser/data-reader.ts`
- Test: `tests/unit/dta-parser/data-reader.test.ts`

- [ ] **Step 1: Write tests for row reading**

```typescript
// tests/unit/dta-parser/data-reader.test.ts
import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../src/dta-parser/header';
import { read_rows_from_buffer } from '../../src/dta-parser/data-reader';

const FIXTURE_DIR = path.join(__dirname, '../../tests/fixtures/dta');

function load_fixture(name: string) {
    const my_buf = fs.readFileSync(path.join(FIXTURE_DIR, name));
    const my_meta = parse_metadata(my_buf.buffer);
    return { buffer: my_buf.buffer, metadata: my_meta };
}

describe('read_rows_from_buffer', () => {
    it('reads the first row of auto.dta', () => {
        const { buffer, metadata } = load_fixture('auto_v118.dta');
        const the_rows = read_rows_from_buffer(buffer, metadata, 0, 1);

        expect(the_rows.length).toBe(1);
        expect(the_rows[0].length).toBe(metadata.nvar);
    });

    it('reads string values correctly', () => {
        const { buffer, metadata } = load_fixture('auto_v118.dta');
        const the_rows = read_rows_from_buffer(buffer, metadata, 0, 5);

        // 'make' is the first variable and should be a string
        const my_make_idx = metadata.variables.findIndex(
            v => v.name === 'make'
        );
        for (const my_row of the_rows) {
            expect(typeof my_row[my_make_idx]).toBe('string');
            expect((my_row[my_make_idx] as string).length).toBeGreaterThan(0);
        }
    });

    it('reads numeric values correctly', () => {
        const { buffer, metadata } = load_fixture('auto_v118.dta');
        const the_rows = read_rows_from_buffer(buffer, metadata, 0, 5);

        const my_price_idx = metadata.variables.findIndex(
            v => v.name === 'price'
        );
        for (const my_row of the_rows) {
            expect(typeof my_row[my_price_idx]).toBe('number');
            expect(my_row[my_price_idx] as number).toBeGreaterThan(0);
        }
    });

    it('reads all 74 rows', () => {
        const { buffer, metadata } = load_fixture('auto_v118.dta');
        const the_rows = read_rows_from_buffer(
            buffer, metadata, 0, metadata.nobs
        );

        expect(the_rows.length).toBe(74);
    });

    it('reads a middle page correctly', () => {
        const { buffer, metadata } = load_fixture('auto_v118.dta');
        const the_rows = read_rows_from_buffer(buffer, metadata, 10, 5);

        expect(the_rows.length).toBe(5);
    });

    it('handles reading past end of data', () => {
        const { buffer, metadata } = load_fixture('auto_v118.dta');
        const the_rows = read_rows_from_buffer(buffer, metadata, 70, 10);

        // Only 4 rows left (70..73)
        expect(the_rows.length).toBe(4);
    });

    it('returns empty array for empty dataset', () => {
        const { buffer, metadata } = load_fixture('empty.dta');
        const the_rows = read_rows_from_buffer(
            buffer, metadata, 0, 10
        );

        expect(the_rows.length).toBe(0);
    });

    it('returns null for missing values', () => {
        const { buffer, metadata } = load_fixture('missing_values.dta');
        const the_rows = read_rows_from_buffer(
            buffer, metadata, 0, metadata.nobs
        );

        const my_x_idx = metadata.variables.findIndex(
            v => v.name === 'x'
        );
        // Row 0 should have system missing (.)
        expect(the_rows[0][my_x_idx]).toBeNull();
    });

    it('reads v117 format correctly', () => {
        const { buffer, metadata } = load_fixture('auto_v117.dta');
        const the_rows = read_rows_from_buffer(
            buffer, metadata, 0, 1
        );

        expect(the_rows.length).toBe(1);
        expect(the_rows[0].length).toBe(metadata.nvar);
    });

    it('handles column subsetting', () => {
        const { buffer, metadata } = load_fixture('auto_v118.dta');
        const the_rows = read_rows_from_buffer(
            buffer, metadata, 0, 5, 0, 3
        );

        expect(the_rows.length).toBe(5);
        // Each row should only have 3 columns
        expect(the_rows[0].length).toBe(3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/dta-parser/data-reader.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement data-reader.ts**

```typescript
// src/dta-parser/data-reader.ts
import { DtaMetadata, Row } from './types';
import { is_missing_value, classify_missing_value } from './missing-values';

const TEXT_DECODER = new TextDecoder('utf-8');

/**
 * Read decoded rows from a .dta file buffer.
 * Uses the metadata's section_offsets.data and obs_length for
 * random-access row reads.
 *
 * @param buffer - The full .dta file as an ArrayBuffer
 * @param metadata - Parsed metadata from parse_metadata()
 * @param start - First row index (0-based)
 * @param count - Number of rows to read
 * @param col_start - Optional first column index (0-based)
 * @param col_end - Optional exclusive end column index
 * @returns Array of decoded rows
 */
export function read_rows_from_buffer(
    buffer: ArrayBuffer,
    metadata: DtaMetadata,
    start: number,
    count: number,
    col_start?: number,
    col_end?: number
): Row[] {
    const my_data_tag = '<data>';
    const my_data_offset = metadata.section_offsets.data
        + my_data_tag.length;
    const my_obs_length = metadata.obs_length;
    const is_little_endian = metadata.byte_order === 'LSF';
    const my_view = new DataView(buffer);
    const my_bytes = new Uint8Array(buffer);

    // Clamp to actual observation count
    const my_actual_start = Math.min(start, metadata.nobs);
    const my_actual_end = Math.min(
        my_actual_start + count, metadata.nobs
    );

    const my_col_start = col_start ?? 0;
    const my_col_end = col_end ?? metadata.nvar;

    const the_rows: Row[] = [];

    for (let my_row = my_actual_start; my_row < my_actual_end; my_row++) {
        const my_row_offset = my_data_offset + my_row * my_obs_length;
        const my_values: Row = [];

        for (let my_col = my_col_start; my_col < my_col_end; my_col++) {
            const my_var = metadata.variables[my_col];
            const my_cell_offset = my_row_offset + my_var.byte_offset;

            my_values.push(
                read_cell(
                    my_view, my_bytes, my_cell_offset,
                    my_var, is_little_endian
                )
            );
        }

        the_rows.push(my_values);
    }

    return the_rows;
}

function read_cell(
    view: DataView,
    bytes: Uint8Array,
    offset: number,
    variable: { type: string; type_code: number; byte_width: number },
    little_endian: boolean
): number | string | null {
    switch (variable.type) {
        case 'byte': {
            const my_val = view.getInt8(offset);
            if (is_missing_value(my_val, 'byte')) return null;
            return my_val;
        }
        case 'int': {
            const my_val = view.getInt16(offset, little_endian);
            if (is_missing_value(my_val, 'int')) return null;
            return my_val;
        }
        case 'long': {
            const my_val = view.getInt32(offset, little_endian);
            if (is_missing_value(my_val, 'long')) return null;
            return my_val;
        }
        case 'float': {
            const my_val = view.getFloat32(offset, little_endian);
            if (is_missing_value(my_val, 'float')) return null;
            return my_val;
        }
        case 'double': {
            const my_val = view.getFloat64(offset, little_endian);
            if (is_missing_value(my_val, 'double')) return null;
            return my_val;
        }
        case 'strL': {
            // strL stores an 8-byte (v, o) GSO pointer.
            // Return a placeholder — strL resolution is in Task 5.
            return `__strl_${offset}__`;
        }
        default: {
            // Fixed-width string: str1..str2045
            if (variable.type.startsWith('str')) {
                return read_fixed_string(
                    bytes, offset, variable.byte_width
                );
            }
            return null;
        }
    }
}

function read_fixed_string(
    bytes: Uint8Array,
    offset: number,
    max_length: number
): string {
    let my_end = offset + max_length;
    for (let i = offset; i < my_end; i++) {
        if (bytes[i] === 0) { my_end = i; break; }
    }
    return TEXT_DECODER.decode(bytes.slice(offset, my_end));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/dta-parser/data-reader.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dta-parser/data-reader.ts tests/unit/dta-parser/data-reader.test.ts
git commit -m "feat(data-browser): add random-access row reader for .dta data section"
```

---

## Task 5: strL (GSO) Resolution

Build the GSO index for `strL` fields and resolve string pointers.

**Files:**
- Create: `src/dta-parser/strl-reader.ts`
- Test: `tests/unit/dta-parser/strl-reader.test.ts`

- [ ] **Step 1: Write tests for strL resolution**

```typescript
// tests/unit/dta-parser/strl-reader.test.ts
import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../src/dta-parser/header';
import { build_gso_index, resolve_strl } from '../../src/dta-parser/strl-reader';

const FIXTURE_DIR = path.join(__dirname, '../../tests/fixtures/dta');

describe('GSO index', () => {
    it('builds an index from strl_test.dta', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'strl_test.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_index = build_gso_index(my_buf.buffer, my_meta);

        expect(my_index.size).toBeGreaterThan(0);
    });

    it('resolves strL values to strings', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'strl_test.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_index = build_gso_index(my_buf.buffer, my_meta);

        // Read the GSO pointer from the first observation's strL column
        const my_strl_var = my_meta.variables.find(
            v => v.type === 'strL'
        );
        if (!my_strl_var) {
            throw new Error('No strL variable found in fixture');
        }

        const my_data_offset = my_meta.section_offsets.data
            + '<data>'.length;
        const my_view = new DataView(my_buf.buffer);
        const is_le = my_meta.byte_order === 'LSF';

        // Read (v, o) pointer from first row
        const my_ptr_offset = my_data_offset + my_strl_var.byte_offset;
        const my_resolved = resolve_strl(
            my_buf.buffer, my_meta, my_index, my_ptr_offset
        );

        expect(typeof my_resolved).toBe('string');
        expect(my_resolved!.length).toBeGreaterThan(0);
    });

    it('returns empty index for datasets without strL', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_index = build_gso_index(my_buf.buffer, my_meta);

        expect(my_index.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/dta-parser/strl-reader.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement strl-reader.ts**

```typescript
// src/dta-parser/strl-reader.ts
import { DtaMetadata } from './types';

const TEXT_DECODER = new TextDecoder('utf-8');

/**
 * A GSO index entry: maps "v:o" key to the byte offset in the file
 * where the string content starts, plus its length.
 */
export interface GsoEntry {
    content_offset: number;
    content_length: number;
    type: number;  // 129 = binary, 130 = ASCII string
}

/**
 * Build an index of all GSO (Generic String Object) entries in the
 * strls section. This is a single sequential pass that records byte
 * offsets — it does not load string content into memory.
 */
export function build_gso_index(
    buffer: ArrayBuffer,
    metadata: DtaMetadata
): Map<string, GsoEntry> {
    const my_index = new Map<string, GsoEntry>();

    // Check if any variable uses strL
    const my_has_strl = metadata.variables.some(
        v => v.type === 'strL'
    );
    if (!my_has_strl) return my_index;

    const my_tag = '<strls>';
    const my_close_tag = '</strls>';
    const my_strls_start = metadata.section_offsets.strls
        + my_tag.length;
    const my_strls_end = metadata.section_offsets.value_labels;

    const my_view = new DataView(buffer);
    const my_bytes = new Uint8Array(buffer);
    const is_le = metadata.byte_order === 'LSF';
    const is_v117 = metadata.format_version === 117;

    let my_pos = my_strls_start;

    while (my_pos < my_strls_end) {
        // Check for closing tag
        if (my_bytes[my_pos] === 0x3C) {
            // '<' character — likely </strls>
            break;
        }

        // GSO entry format:
        // v117: GSO tag (3 bytes "GSO"), v (4 bytes), o (4 bytes),
        //       t (1 byte), len (4 bytes), content
        // v118: GSO tag (3 bytes "GSO"), v (4 bytes), o (8 bytes),
        //       t (1 byte), len (4 bytes), content
        // v119: GSO tag (3 bytes "GSO"), v (4 bytes), o (8 bytes),
        //       t (1 byte), len (4 bytes), content

        // Skip "GSO" tag
        my_pos += 3;

        let my_v: number;
        let my_o: number;

        if (is_v117) {
            my_v = my_view.getUint32(my_pos, is_le);
            my_pos += 4;
            my_o = my_view.getUint32(my_pos, is_le);
            my_pos += 4;
        } else {
            my_v = my_view.getUint32(my_pos, is_le);
            my_pos += 4;
            // o is 8 bytes in v118/v119
            const my_lo = my_view.getUint32(my_pos, is_le);
            const my_hi = my_view.getUint32(my_pos + 4, is_le);
            my_o = is_le
                ? my_lo + my_hi * 0x100000000
                : my_hi + my_lo * 0x100000000;
            my_pos += 8;
        }

        const my_type = my_view.getUint8(my_pos);
        my_pos += 1;

        const my_len = my_view.getUint32(my_pos, is_le);
        my_pos += 4;

        const my_key = `${my_v}:${my_o}`;
        my_index.set(my_key, {
            content_offset: my_pos,
            content_length: my_len,
            type: my_type,
        });

        my_pos += my_len;
    }

    return my_index;
}

/**
 * Resolve a strL pointer at a given offset in the data section
 * to the actual string content.
 */
export function resolve_strl(
    buffer: ArrayBuffer,
    metadata: DtaMetadata,
    gso_index: Map<string, GsoEntry>,
    pointer_offset: number
): string | null {
    const my_view = new DataView(buffer);
    const is_le = metadata.byte_order === 'LSF';
    const is_v117 = metadata.format_version === 117;

    let my_v: number;
    let my_o: number;

    if (is_v117) {
        my_v = my_view.getUint32(pointer_offset, is_le);
        my_o = my_view.getUint32(pointer_offset + 4, is_le);
    } else {
        // v118/v119: (v, o) packed as two 4-byte values
        my_v = my_view.getUint32(pointer_offset, is_le);
        my_o = my_view.getUint32(pointer_offset + 4, is_le);
    }

    // v=0, o=0 means empty string
    if (my_v === 0 && my_o === 0) return '';

    const my_key = `${my_v}:${my_o}`;
    const my_entry = gso_index.get(my_key);
    if (!my_entry) return null;

    const my_bytes = new Uint8Array(buffer);
    // Content may be null-terminated
    let my_actual_len = my_entry.content_length;
    if (my_entry.type === 130) {
        // ASCII string — may include null terminator in length
        const my_last = my_bytes[
            my_entry.content_offset + my_actual_len - 1
        ];
        if (my_last === 0) my_actual_len--;
    }

    return TEXT_DECODER.decode(
        my_bytes.slice(
            my_entry.content_offset,
            my_entry.content_offset + my_actual_len
        )
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/dta-parser/strl-reader.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Update data-reader.ts to use strL resolution**

In `src/dta-parser/data-reader.ts`, update the `read_rows_from_buffer` function signature and the `strL` case:

Add `gso_index` parameter and replace the strL placeholder with actual resolution.

```typescript
// In read_rows_from_buffer, add gso_index parameter:
export function read_rows_from_buffer(
    buffer: ArrayBuffer,
    metadata: DtaMetadata,
    start: number,
    count: number,
    col_start?: number,
    col_end?: number,
    gso_index?: Map<string, GsoEntry>
): Row[] {
    // ... existing code ...
    // In the strL case of read_cell:
    case 'strL': {
        if (!gso_index) return `__strl_${offset}__`;
        return resolve_strl(buffer, metadata, gso_index, offset);
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/dta-parser/strl-reader.ts src/dta-parser/data-reader.ts tests/unit/dta-parser/strl-reader.test.ts
git commit -m "feat(data-browser): add GSO index building and strL resolution"
```

---

## Task 6: Value Label Table Parsing

Parse value label tables from the value_labels section of the `.dta` file.

**Files:**
- Create: `src/dta-parser/value-labels.ts`
- Test: `tests/unit/dta-parser/value-labels.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/unit/dta-parser/value-labels.test.ts
import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse_metadata } from '../../src/dta-parser/header';
import { parse_value_labels } from '../../src/dta-parser/value-labels';

const FIXTURE_DIR = path.join(__dirname, '../../tests/fixtures/dta');

describe('parse_value_labels', () => {
    it('parses value labels from value_labels.dta', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'value_labels.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_tables = parse_value_labels(my_buf.buffer, my_meta);

        expect(my_tables.size).toBeGreaterThan(0);
    });

    it('reads foreign label table correctly', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'value_labels.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_tables = parse_value_labels(my_buf.buffer, my_meta);

        // Find the table associated with 'foreign' variable
        const my_foreign_var = my_meta.variables.find(
            v => v.name === 'foreign'
        );
        const my_table = my_tables.get(
            my_foreign_var!.value_label_name
        );

        expect(my_table).toBeDefined();
        expect(my_table!.get(0)).toBe('Domestic');
        expect(my_table!.get(1)).toBe('Foreign');
    });

    it('reads repair record label table', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'value_labels.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_tables = parse_value_labels(my_buf.buffer, my_meta);

        const my_rep_var = my_meta.variables.find(
            v => v.name === 'rep78'
        );
        const my_table = my_tables.get(
            my_rep_var!.value_label_name
        );

        expect(my_table).toBeDefined();
        expect(my_table!.get(1)).toBe('Poor');
        expect(my_table!.get(5)).toBe('Excellent');
    });

    it('returns empty map for datasets without value labels', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'wide.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_tables = parse_value_labels(my_buf.buffer, my_meta);

        expect(my_tables.size).toBe(0);
    });

    it('parses auto.dta value labels (origin)', () => {
        const my_buf = fs.readFileSync(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const my_meta = parse_metadata(my_buf.buffer);
        const my_tables = parse_value_labels(my_buf.buffer, my_meta);

        // auto.dta has origin label for foreign variable
        const my_foreign = my_meta.variables.find(
            v => v.name === 'foreign'
        );
        if (my_foreign?.value_label_name) {
            const my_table = my_tables.get(
                my_foreign.value_label_name
            );
            expect(my_table).toBeDefined();
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/dta-parser/value-labels.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement value-labels.ts**

```typescript
// src/dta-parser/value-labels.ts
import { DtaMetadata } from './types';

const TEXT_DECODER = new TextDecoder('utf-8');

/**
 * Parse all value label tables from the value_labels section.
 * Returns a Map of table name → Map of integer value → string label.
 */
export function parse_value_labels(
    buffer: ArrayBuffer,
    metadata: DtaMetadata
): Map<string, Map<number, string>> {
    const my_tables = new Map<string, Map<number, string>>();
    const my_view = new DataView(buffer);
    const my_bytes = new Uint8Array(buffer);
    const is_le = metadata.byte_order === 'LSF';

    const my_tag = '<value_labels>';
    const my_section_start = metadata.section_offsets.value_labels
        + my_tag.length;
    const my_section_end = metadata.section_offsets.stata_data_close;

    let my_pos = my_section_start;

    while (my_pos < my_section_end) {
        // Check for closing tag </value_labels>
        if (my_bytes[my_pos] === 0x3C && my_bytes[my_pos + 1] === 0x2F) {
            break;
        }

        // Each value label table starts with <lbl> tag
        // Skip <lbl> tag
        const my_lbl_tag = '<lbl>';
        my_pos += my_lbl_tag.length;

        // Table length (4 bytes) — total bytes for this table entry
        const my_table_len = my_view.getInt32(my_pos, is_le);
        my_pos += 4;

        // Label name (129 bytes in v118/v119, 33 in v117)
        const my_name_len = metadata.format_version === 117 ? 33 : 129;
        let my_name_end = my_pos + my_name_len;
        for (let i = my_pos; i < my_name_end; i++) {
            if (my_bytes[i] === 0) { my_name_end = i; break; }
        }
        const my_name = TEXT_DECODER.decode(
            my_bytes.slice(my_pos, my_name_end)
        );
        my_pos += my_name_len;

        // Padding (3 bytes)
        my_pos += 3;

        // Number of entries (4 bytes)
        const my_n = my_view.getInt32(my_pos, is_le);
        my_pos += 4;

        // Text length (4 bytes) — total bytes of all label strings
        const my_txt_len = my_view.getInt32(my_pos, is_le);
        my_pos += 4;

        // Offsets into text block (n × 4 bytes)
        const the_offsets: number[] = [];
        for (let i = 0; i < my_n; i++) {
            the_offsets.push(my_view.getInt32(my_pos, is_le));
            my_pos += 4;
        }

        // Values (n × 4 bytes)
        const the_values: number[] = [];
        for (let i = 0; i < my_n; i++) {
            the_values.push(my_view.getInt32(my_pos, is_le));
            my_pos += 4;
        }

        // Text block (txt_len bytes) — null-terminated strings
        const my_text_start = my_pos;
        const my_table = new Map<number, string>();

        for (let i = 0; i < my_n; i++) {
            const my_str_start = my_text_start + the_offsets[i];
            let my_str_end = my_str_start;
            while (
                my_str_end < my_text_start + my_txt_len
                && my_bytes[my_str_end] !== 0
            ) {
                my_str_end++;
            }
            const my_label = TEXT_DECODER.decode(
                my_bytes.slice(my_str_start, my_str_end)
            );
            my_table.set(the_values[i], my_label);
        }

        my_tables.set(my_name, my_table);
        my_pos = my_text_start + my_txt_len;

        // Skip </lbl> tag
        my_pos += '</lbl>'.length;
    }

    return my_tables;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/dta-parser/value-labels.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dta-parser/value-labels.ts tests/unit/dta-parser/value-labels.test.ts
git commit -m "feat(data-browser): parse value label tables from .dta files"
```

---

## Task 7: Stata Display Format Application

Apply Stata display format strings (`%9.2f`, `%12.0gc`, `%td`, etc.) to raw numeric values.

**Files:**
- Create: `src/dta-parser/display-format.ts`
- Test: `tests/unit/dta-parser/display-format.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/unit/dta-parser/display-format.test.ts
import { describe, it, expect } from 'bun:test';
import { apply_display_format } from '../../src/dta-parser/display-format';

describe('apply_display_format', () => {
    it('formats %9.2f', () => {
        expect(apply_display_format(3.14159, '%9.2f')).toBe('3.14');
    });

    it('formats %9.0g (general)', () => {
        const my_result = apply_display_format(1234.5, '%9.0g');
        expect(my_result).toBe('1234.5');
    });

    it('formats %12.0gc (general with commas)', () => {
        expect(apply_display_format(1234567, '%12.0gc')).toBe('1,234,567');
    });

    it('formats %8.0fc (fixed with commas)', () => {
        expect(apply_display_format(1234567.89, '%8.0fc')).toBe(
            '1,234,568'
        );
    });

    it('formats %9.2fc (fixed with commas and decimals)', () => {
        expect(apply_display_format(1234567.89, '%9.2fc')).toBe(
            '1,234,567.89'
        );
    });

    it('formats integers with %9.0g', () => {
        expect(apply_display_format(42, '%9.0g')).toBe('42');
    });

    it('returns string values unchanged', () => {
        expect(apply_display_format('hello', '%20s')).toBe('hello');
    });

    it('returns null for null values', () => {
        expect(apply_display_format(null, '%9.2f')).toBeNull();
    });

    it('formats %td (Stata date)', () => {
        // Stata date 0 = 01jan1960
        expect(apply_display_format(0, '%td')).toBe('01jan1960');
        // Stata date 21185 = 01jan2018
        expect(apply_display_format(21185, '%td')).toBe('01jan2018');
    });

    it('formats %tc (Stata datetime)', () => {
        // Stata datetime is ms since 01jan1960 00:00:00
        expect(apply_display_format(0, '%tc')).toBe(
            '01jan1960 00:00:00'
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/dta-parser/display-format.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement display-format.ts**

```typescript
// src/dta-parser/display-format.ts

// Stata epoch: 01jan1960
const STATA_EPOCH_MS = Date.UTC(1960, 0, 1);

const STATA_MONTHS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/**
 * Apply a Stata display format string to a raw cell value.
 * Returns the formatted string representation.
 */
export function apply_display_format(
    value: number | string | null,
    format: string
): string | null {
    if (value === null) return null;
    if (typeof value === 'string') return value;

    // Date/time formats
    if (format.startsWith('%t') || format.startsWith('%-t')) {
        return format_stata_date(value, format);
    }

    // Parse the numeric format: %[flags]w[.d][gfeGFE][c]
    const my_match = format.match(
        /^%-?(\d+)?\.?(\d+)?([gfeGFE])?(c)?$/
    );
    if (!my_match) {
        // Fallback: just convert to string
        return String(value);
    }

    const my_decimals = my_match[2] !== undefined
        ? parseInt(my_match[2], 10) : undefined;
    const my_type = my_match[3] || 'g';
    const my_comma = my_match[4] === 'c';

    let my_result: string;

    switch (my_type.toLowerCase()) {
        case 'f': {
            // Fixed-point
            my_result = my_decimals !== undefined
                ? value.toFixed(my_decimals)
                : String(value);
            break;
        }
        case 'e': {
            // Scientific notation
            my_result = my_decimals !== undefined
                ? value.toExponential(my_decimals)
                : value.toExponential();
            break;
        }
        case 'g':
        default: {
            // General: use fixed if it fits, otherwise scientific
            if (my_decimals !== undefined && my_decimals === 0) {
                // %w.0g — show as many significant digits as needed
                my_result = String(value);
            } else {
                my_result = my_decimals !== undefined
                    ? parseFloat(value.toPrecision(
                        Math.max(1, my_decimals)
                    )).toString()
                    : String(value);
            }
            break;
        }
    }

    if (my_comma) {
        my_result = add_commas(my_result);
    }

    return my_result;
}

function add_commas(num_str: string): string {
    const the_parts = num_str.split('.');
    the_parts[0] = the_parts[0].replace(
        /\B(?=(\d{3})+(?!\d))/g, ','
    );
    return the_parts.join('.');
}

function format_stata_date(value: number, format: string): string {
    // Strip leading %- and any width specifiers
    const my_clean = format.replace(/^%-?/, '%');

    if (my_clean.startsWith('%td')) {
        // Days since 01jan1960
        return format_date_days(value);
    }
    if (my_clean.startsWith('%tc')) {
        // Milliseconds since 01jan1960 00:00:00
        return format_datetime_ms(value);
    }
    if (my_clean.startsWith('%tw')) {
        // Stata weeks
        return format_week(value);
    }
    if (my_clean.startsWith('%tm')) {
        // Stata months
        return format_month(value);
    }
    if (my_clean.startsWith('%tq')) {
        // Stata quarters
        return format_quarter(value);
    }
    if (my_clean.startsWith('%ty')) {
        // Year
        return String(value);
    }

    return format_date_days(value);
}

function format_date_days(days_since_epoch: number): string {
    const my_date = new Date(
        STATA_EPOCH_MS + days_since_epoch * 86400000
    );
    const my_day = String(my_date.getUTCDate()).padStart(2, '0');
    const my_month = STATA_MONTHS[my_date.getUTCMonth()];
    const my_year = my_date.getUTCFullYear();
    return `${my_day}${my_month}${my_year}`;
}

function format_datetime_ms(ms_since_epoch: number): string {
    const my_date = new Date(STATA_EPOCH_MS + ms_since_epoch);
    const my_day = String(my_date.getUTCDate()).padStart(2, '0');
    const my_month = STATA_MONTHS[my_date.getUTCMonth()];
    const my_year = my_date.getUTCFullYear();
    const my_hours = String(my_date.getUTCHours()).padStart(2, '0');
    const my_mins = String(my_date.getUTCMinutes()).padStart(2, '0');
    const my_secs = String(my_date.getUTCSeconds()).padStart(2, '0');
    return `${my_day}${my_month}${my_year} ${my_hours}:${my_mins}:${my_secs}`;
}

function format_week(weeks_since_epoch: number): string {
    const my_year = 1960 + Math.floor(weeks_since_epoch / 52);
    const my_week = (weeks_since_epoch % 52) + 1;
    return `${my_year}w${my_week}`;
}

function format_month(months_since_epoch: number): string {
    const my_year = 1960 + Math.floor(months_since_epoch / 12);
    const my_month = STATA_MONTHS[months_since_epoch % 12];
    return `${my_year}m${((months_since_epoch % 12) + 1)}`;
}

function format_quarter(quarters_since_epoch: number): string {
    const my_year = 1960 + Math.floor(quarters_since_epoch / 4);
    const my_quarter = (quarters_since_epoch % 4) + 1;
    return `${my_year}q${my_quarter}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/dta-parser/display-format.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dta-parser/display-format.ts tests/unit/dta-parser/display-format.test.ts
git commit -m "feat(data-browser): add Stata display format application"
```

---

## Task 8: DtaFile Public API

Combine all parser components into the public `DtaFile` class with file-descriptor-based access.

**Files:**
- Create: `src/dta-parser/index.ts`
- Test: `tests/unit/dta-parser/dta-file.test.ts` (integration test)

- [ ] **Step 1: Write tests for DtaFile**

```typescript
// tests/unit/dta-parser/dta-file.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import * as path from 'path';
import { DtaFile } from '../../src/dta-parser';

const FIXTURE_DIR = path.join(__dirname, '../../tests/fixtures/dta');

describe('DtaFile', () => {
    let my_file: DtaFile | null = null;

    afterEach(() => {
        my_file?.close();
        my_file = null;
    });

    it('opens and reads metadata from auto.dta', async () => {
        my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );

        expect(my_file.nobs).toBe(74);
        expect(my_file.nvar).toBe(12);
        expect(my_file.variables.length).toBe(12);
    });

    it('reads rows', async () => {
        my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const the_rows = await my_file.read_rows(0, 5);

        expect(the_rows.length).toBe(5);
        expect(the_rows[0].length).toBe(12);
    });

    it('provides value label tables', async () => {
        my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );

        expect(my_file.value_label_tables).toBeDefined();
        expect(my_file.value_label_tables instanceof Map).toBe(true);
    });

    it('provides dataset label', async () => {
        my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );

        expect(typeof my_file.dataset_label).toBe('string');
    });

    it('reads rows with column subsetting', async () => {
        my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );
        const the_rows = await my_file.read_rows(0, 5, 0, 3);

        expect(the_rows.length).toBe(5);
        expect(the_rows[0].length).toBe(3);
    });

    it('resolves strL values', async () => {
        my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'strl_test.dta')
        );
        const the_rows = await my_file.read_rows(0, 5);

        // Find the strL column
        const my_strl_idx = my_file.variables.findIndex(
            v => v.type === 'strL'
        );
        if (my_strl_idx >= 0) {
            for (const my_row of the_rows) {
                const my_val = my_row[my_strl_idx];
                expect(typeof my_val).toBe('string');
                expect(
                    (my_val as string).startsWith('__strl_')
                ).toBe(false);
            }
        }
    });

    it('handles v117 format', async () => {
        my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'auto_v117.dta')
        );

        expect(my_file.nobs).toBe(74);
        const the_rows = await my_file.read_rows(0, 1);
        expect(the_rows.length).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/dta-parser/dta-file.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement index.ts (DtaFile class)**

```typescript
// src/dta-parser/index.ts
import * as fs from 'fs';
import { DtaMetadata, VariableInfo, Row } from './types';
import { parse_metadata } from './header';
import { read_rows_from_buffer } from './data-reader';
import { build_gso_index, GsoEntry } from './strl-reader';
import { parse_value_labels } from './value-labels';

export { VariableInfo, Row, DtaMetadata } from './types';
export { apply_display_format } from './display-format';
export { classify_missing_value, is_missing_value } from './missing-values';

export class DtaFile {
    private buffer: ArrayBuffer;
    private metadata: DtaMetadata;
    private gso_index: Map<string, GsoEntry>;
    private label_tables: Map<string, Map<number, string>>;

    private constructor(
        buffer: ArrayBuffer,
        metadata: DtaMetadata,
        gso_index: Map<string, GsoEntry>,
        label_tables: Map<string, Map<number, string>>
    ) {
        this.buffer = buffer;
        this.metadata = metadata;
        this.gso_index = gso_index;
        this.label_tables = label_tables;
    }

    static async open(file_path: string): Promise<DtaFile> {
        const my_buf = fs.readFileSync(file_path);
        const my_array_buffer = my_buf.buffer.slice(
            my_buf.byteOffset,
            my_buf.byteOffset + my_buf.byteLength
        );

        const my_metadata = parse_metadata(my_array_buffer);
        const my_gso_index = build_gso_index(
            my_array_buffer, my_metadata
        );
        const my_labels = parse_value_labels(
            my_array_buffer, my_metadata
        );

        return new DtaFile(
            my_array_buffer, my_metadata, my_gso_index, my_labels
        );
    }

    get nobs(): number { return this.metadata.nobs; }
    get nvar(): number { return this.metadata.nvar; }
    get variables(): VariableInfo[] { return this.metadata.variables; }
    get dataset_label(): string { return this.metadata.dataset_label; }
    get value_label_tables(): Map<string, Map<number, string>> {
        return this.label_tables;
    }

    async read_rows(
        start: number,
        count: number,
        col_start?: number,
        col_end?: number
    ): Promise<Row[]> {
        return read_rows_from_buffer(
            this.buffer,
            this.metadata,
            start,
            count,
            col_start,
            col_end,
            this.gso_index
        );
    }

    close(): void {
        // Release buffer reference for GC
        this.buffer = new ArrayBuffer(0);
        this.gso_index.clear();
        this.label_tables.clear();
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/dta-parser/dta-file.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Run all dta-parser tests together**

Run: `bun test tests/unit/dta-parser/`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dta-parser/index.ts tests/unit/dta-parser/dta-file.test.ts
git commit -m "feat(data-browser): add DtaFile public API combining parser components"
```

---

## Task 9: Row Page Cache

Implement an LRU cache for decoded row pages to smooth out rapid scrolling.

**Files:**
- Create: `client/src/data-browser/row-cache.ts`
- Test: `tests/unit/data-browser/row-cache.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/unit/data-browser/row-cache.test.ts
import { describe, it, expect } from 'bun:test';
import { RowCache } from '../../client/src/data-browser/row-cache';

describe('RowCache', () => {
    it('stores and retrieves a page', () => {
        const my_cache = new RowCache(10, 200);
        const my_rows = [[1, 'a'], [2, 'b']];

        my_cache.set_page(0, my_rows);
        expect(my_cache.get_page(0)).toEqual(my_rows);
    });

    it('returns undefined for missing pages', () => {
        const my_cache = new RowCache(10, 200);

        expect(my_cache.get_page(0)).toBeUndefined();
    });

    it('evicts oldest page when max is exceeded', () => {
        const my_cache = new RowCache(3, 200);

        my_cache.set_page(0, []);
        my_cache.set_page(200, []);
        my_cache.set_page(400, []);

        // Access page 0 to make it recently used
        my_cache.get_page(0);

        // Add a 4th page — should evict page 200 (least recently used)
        my_cache.set_page(600, []);

        expect(my_cache.get_page(0)).toBeDefined();
        expect(my_cache.get_page(200)).toBeUndefined();
        expect(my_cache.get_page(400)).toBeDefined();
        expect(my_cache.get_page(600)).toBeDefined();
    });

    it('clears all pages', () => {
        const my_cache = new RowCache(10, 200);
        my_cache.set_page(0, []);
        my_cache.set_page(200, []);

        my_cache.clear();

        expect(my_cache.get_page(0)).toBeUndefined();
        expect(my_cache.get_page(200)).toBeUndefined();
    });

    it('reports size correctly', () => {
        const my_cache = new RowCache(10, 200);

        expect(my_cache.size).toBe(0);
        my_cache.set_page(0, []);
        expect(my_cache.size).toBe(1);
        my_cache.set_page(200, []);
        expect(my_cache.size).toBe(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/data-browser/row-cache.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement row-cache.ts**

```typescript
// client/src/data-browser/row-cache.ts
import type { Row } from '../../../src/dta-parser/types';

export class RowCache {
    private cache = new Map<number, {
        rows: (number | string | null)[][];
        access_time: number;
    }>();
    private max_pages: number;
    private page_size: number;

    constructor(max_pages: number = 10, page_size: number = 200) {
        this.max_pages = max_pages;
        this.page_size = page_size;
    }

    get_page(
        start_row: number
    ): (number | string | null)[][] | undefined {
        const my_entry = this.cache.get(start_row);
        if (!my_entry) return undefined;
        my_entry.access_time = Date.now();
        return my_entry.rows;
    }

    set_page(
        start_row: number,
        rows: (number | string | null)[][]
    ): void {
        if (this.cache.size >= this.max_pages) {
            this.evict_oldest();
        }
        this.cache.set(start_row, {
            rows,
            access_time: Date.now(),
        });
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }

    private evict_oldest(): void {
        let my_oldest_key = -1;
        let my_oldest_time = Infinity;

        for (const [my_key, my_entry] of this.cache) {
            if (my_entry.access_time < my_oldest_time) {
                my_oldest_time = my_entry.access_time;
                my_oldest_key = my_key;
            }
        }

        if (my_oldest_key >= 0) {
            this.cache.delete(my_oldest_key);
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/data-browser/row-cache.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/data-browser/row-cache.ts tests/unit/data-browser/row-cache.test.ts
git commit -m "feat(data-browser): add LRU row page cache"
```

---

## Task 10: Data Browser Message Types and Protocol

Define the shared TypeScript types for the webview ↔ extension host postMessage protocol.

**Files:**
- Create: `client/src/data-browser/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// client/src/data-browser/types.ts

// Webview → Extension messages
export interface RowRequest {
    type: 'requestRows';
    start: number;
    count: number;
    col_start?: number;
    col_end?: number;
    request_id: string;
}

export interface ReadyMessage {
    type: 'ready';
}

export type WebviewMessage = RowRequest | ReadyMessage;

// Extension → Webview messages
export interface RowResponse {
    type: 'rowData';
    start: number;
    col_start?: number;
    rows: CellValue[][];
    request_id: string;
}

export interface MetadataMessage {
    type: 'metadata';
    nobs: number;
    variables: VariableDescription[];
    dataset_label: string;
    name: string;
}

export type ExtensionMessage = RowResponse | MetadataMessage;

export interface VariableDescription {
    name: string;
    type: string;
    format: string;
    label: string;
    has_value_labels: boolean;
}

export interface CellValue {
    raw: number | string | null;
    display: string;
    missing_type?: string; // '.', '.a', etc.
}

// Sidecar JSON written by vview.ado
export interface VviewSidecar {
    version: number;
    uuid: string;
    name: string;
    dtapath: string;
    N: number;
    k: number;
    replace: boolean;
    subsetted: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/data-browser/types.ts
git commit -m "feat(data-browser): add postMessage protocol types"
```

---

## Task 11: Signal Watcher

Watch `~/.sight/browse/` for signal files from `vview.ado` using `fs.watch`.

**Files:**
- Create: `client/src/data-browser/signal-watcher.ts`
- Test: `tests/unit/data-browser/signal-watcher.test.ts`

- [ ] **Step 1: Write tests for signal file parsing**

```typescript
// tests/unit/data-browser/signal-watcher.test.ts
import { describe, it, expect } from 'bun:test';
import { parse_sidecar_json } from '../../client/src/data-browser/signal-watcher';

describe('parse_sidecar_json', () => {
    it('parses valid sidecar JSON', () => {
        const my_json = JSON.stringify({
            version: 1,
            uuid: 'test_abc123',
            name: 'auto',
            dtapath: '/tmp/test.dta',
            N: 74,
            k: 12,
            replace: false,
            subsetted: false,
        });

        const my_result = parse_sidecar_json(my_json);

        expect(my_result).not.toBeNull();
        expect(my_result!.uuid).toBe('test_abc123');
        expect(my_result!.name).toBe('auto');
        expect(my_result!.N).toBe(74);
        expect(my_result!.replace).toBe(false);
    });

    it('returns null for invalid JSON', () => {
        expect(parse_sidecar_json('not json')).toBeNull();
    });

    it('returns null for missing required fields', () => {
        expect(parse_sidecar_json('{"version": 1}')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/data-browser/signal-watcher.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement signal-watcher.ts**

```typescript
// client/src/data-browser/signal-watcher.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { VviewSidecar } from './types';

export type SignalCallback = (sidecar: VviewSidecar) => void;

/**
 * Parse a vview sidecar JSON string. Returns null if invalid.
 */
export function parse_sidecar_json(
    content: string
): VviewSidecar | null {
    try {
        const my_obj = JSON.parse(content);
        if (
            typeof my_obj.uuid !== 'string'
            || typeof my_obj.name !== 'string'
            || typeof my_obj.N !== 'number'
            || typeof my_obj.k !== 'number'
            || typeof my_obj.replace !== 'boolean'
        ) {
            return null;
        }
        return my_obj as VviewSidecar;
    } catch {
        return null;
    }
}

/**
 * Watches ~/.sight/browse/ for signal_<uuid> files.
 * When a signal is detected, reads the corresponding sidecar JSON
 * and calls the callback.
 */
export class SignalWatcher {
    private watcher: fs.FSWatcher | null = null;
    private browse_dir: string;
    private on_signal: SignalCallback;
    private log: (msg: string) => void;

    constructor(
        on_signal: SignalCallback,
        log: (msg: string) => void = () => {}
    ) {
        this.browse_dir = path.join(os.homedir(), '.sight', 'browse');
        this.on_signal = on_signal;
        this.log = log;
    }

    start(): void {
        // Ensure the browse directory exists
        fs.mkdirSync(this.browse_dir, { recursive: true });

        this.watcher = fs.watch(
            this.browse_dir,
            (event_type, filename) => {
                if (!filename) return;
                if (!filename.startsWith('signal_')) return;
                this.handle_signal(filename);
            }
        );

        this.log(
            `Data browser: watching ${this.browse_dir} for signals`
        );
    }

    stop(): void {
        this.watcher?.close();
        this.watcher = null;
    }

    private async handle_signal(signal_filename: string): Promise<void> {
        try {
            const my_signal_path = path.join(
                this.browse_dir, signal_filename
            );

            // Read UUID from signal file
            const my_uuid = fs.readFileSync(
                my_signal_path, 'utf-8'
            ).trim();

            // Read sidecar JSON
            const my_json_path = path.join(
                this.browse_dir, `${my_uuid}.json`
            );
            const my_json_content = fs.readFileSync(
                my_json_path, 'utf-8'
            );
            const my_sidecar = parse_sidecar_json(my_json_content);

            if (!my_sidecar) {
                this.log(
                    `Data browser: invalid sidecar JSON: ${my_json_path}`
                );
                return;
            }

            // Clean up signal and sidecar files
            try { fs.unlinkSync(my_signal_path); } catch { /* ok */ }
            try { fs.unlinkSync(my_json_path); } catch { /* ok */ }

            this.on_signal(my_sidecar);
        } catch (err) {
            this.log(
                `Data browser: error handling signal ` +
                `${signal_filename}: ${err}`
            );
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/data-browser/signal-watcher.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/data-browser/signal-watcher.ts tests/unit/data-browser/signal-watcher.test.ts
git commit -m "feat(data-browser): add signal file watcher for vview integration"
```

---

## Task 12: Data Browser Panel

Create the webview panel that manages a single data browser tab — loading the `.dta` file, handling row requests from the webview, and formatting cell values.

**Files:**
- Create: `client/src/data-browser/browser-panel.ts`

- [ ] **Step 1: Implement browser-panel.ts**

```typescript
// client/src/data-browser/browser-panel.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { DtaFile, apply_display_format, classify_missing_value } from '../../../src/dta-parser';
import { RowCache } from './row-cache';
import type {
    WebviewMessage,
    RowResponse,
    MetadataMessage,
    CellValue,
    VviewSidecar,
} from './types';

const PAGE_SIZE = 200;

export class DataBrowserPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel;
    private dta_file: DtaFile | null = null;
    private row_cache = new RowCache(10, PAGE_SIZE);
    private disposables: vscode.Disposable[] = [];
    private sidecar: VviewSidecar;
    private dta_path: string;
    private disposed = false;

    constructor(
        panel: vscode.WebviewPanel,
        sidecar: VviewSidecar,
        dta_path: string,
        webview_html: string
    ) {
        this.panel = panel;
        this.sidecar = sidecar;
        this.dta_path = dta_path;

        panel.webview.html = webview_html;

        this.disposables.push(
            panel.webview.onDidReceiveMessage(
                msg => this.handle_message(msg)
            )
        );
    }

    get name(): string { return this.sidecar.name; }

    on_did_dispose(callback: () => void): void {
        this.disposables.push(this.panel.onDidDispose(callback));
    }

    reveal(column: vscode.ViewColumn): void {
        this.panel.reveal(column);
    }

    async refresh(
        sidecar: VviewSidecar, dta_path: string
    ): Promise<void> {
        // Close old file
        this.dta_file?.close();
        this.dta_file = null;
        this.row_cache.clear();

        this.sidecar = sidecar;
        this.dta_path = dta_path;

        // Re-initialize
        await this.initialize();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.dta_file?.close();
        this.dta_file = null;

        // Delete the temp .dta file on tab close (Windows fallback)
        if (process.platform === 'win32') {
            try { fs.unlinkSync(this.dta_path); } catch { /* ok */ }
        }

        for (const my_d of this.disposables) {
            my_d.dispose();
        }
        this.panel.dispose();
    }

    private async initialize(): Promise<void> {
        try {
            this.dta_file = await DtaFile.open(this.dta_path);

            // On non-Windows, unlink the temp file immediately
            // (the open file handle keeps it accessible)
            if (process.platform !== 'win32') {
                try { fs.unlinkSync(this.dta_path); } catch { /* ok */ }
            }

            const my_metadata: MetadataMessage = {
                type: 'metadata',
                nobs: this.dta_file.nobs,
                variables: this.dta_file.variables.map(v => ({
                    name: v.name,
                    type: v.type,
                    format: v.format,
                    label: v.label,
                    has_value_labels: v.value_label_name !== ''
                        && this.dta_file!.value_label_tables.has(
                            v.value_label_name
                        ),
                })),
                dataset_label: this.dta_file.dataset_label,
                name: this.sidecar.name,
            };

            this.panel.webview.postMessage(my_metadata);
        } catch (err) {
            vscode.window.showErrorMessage(
                `Failed to open .dta file: ${err}`
            );
        }
    }

    private async handle_message(msg: WebviewMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                await this.initialize();
                break;
            case 'requestRows':
                await this.handle_row_request(msg);
                break;
        }
    }

    private async handle_row_request(
        request: WebviewMessage & { type: 'requestRows' }
    ): Promise<void> {
        if (!this.dta_file) return;

        // Check cache first
        const my_cached = this.row_cache.get_page(request.start);
        if (my_cached) {
            const my_response: RowResponse = {
                type: 'rowData',
                start: request.start,
                rows: this.format_rows(my_cached, request.col_start),
                request_id: request.request_id,
            };
            this.panel.webview.postMessage(my_response);
            return;
        }

        // Read from file
        const the_raw_rows = await this.dta_file.read_rows(
            request.start,
            request.count,
            request.col_start,
            request.col_end
        );

        // Cache the raw rows
        this.row_cache.set_page(request.start, the_raw_rows);

        const my_response: RowResponse = {
            type: 'rowData',
            start: request.start,
            col_start: request.col_start,
            rows: this.format_rows(the_raw_rows, request.col_start),
            request_id: request.request_id,
        };

        this.panel.webview.postMessage(my_response);
    }

    private format_rows(
        raw_rows: (number | string | null)[][],
        col_start?: number
    ): CellValue[][] {
        const my_col_offset = col_start ?? 0;

        return raw_rows.map(my_row =>
            my_row.map((my_raw, my_idx) => {
                const my_var = this.dta_file!.variables[
                    my_col_offset + my_idx
                ];
                return this.format_cell(my_raw, my_var);
            })
        );
    }

    private format_cell(
        raw: number | string | null,
        variable: {
            type: string;
            format: string;
            value_label_name: string;
        }
    ): CellValue {
        if (raw === null) {
            // Missing value — we lost the specific type in read_rows
            return { raw: null, display: '.', missing_type: '.' };
        }

        // Check for value labels
        if (
            typeof raw === 'number'
            && variable.value_label_name
            && this.dta_file
        ) {
            const my_table = this.dta_file.value_label_tables.get(
                variable.value_label_name
            );
            if (my_table) {
                const my_label = my_table.get(raw);
                if (my_label !== undefined) {
                    return {
                        raw,
                        display: my_label,
                    };
                }
            }
        }

        // Apply display format
        const my_formatted = apply_display_format(raw, variable.format);
        return {
            raw,
            display: my_formatted ?? String(raw),
        };
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/data-browser/browser-panel.ts
git commit -m "feat(data-browser): add DataBrowserPanel webview lifecycle manager"
```

---

## Task 13: Panel Manager and Module Entry Point

Create the panel manager (tab map, replace logic) and the module entry point that wires everything together.

**Files:**
- Create: `client/src/data-browser/panel-manager.ts`
- Create: `client/src/data-browser/webview-html.ts`
- Create: `client/src/data-browser/index.ts`
- Modify: `client/src/extension.ts`

- [ ] **Step 1: Create webview-html.ts**

This provides the HTML shell for the webview. Initially it will use a simple HTML table while we set up the infrastructure; the React grid comes in Task 14.

```typescript
// client/src/data-browser/webview-html.ts
import * as crypto from 'crypto';

export function build_data_browser_html(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Sight Data Browser</title>
<style nonce="${nonce}">
${DATA_BROWSER_CSS}
</style>
</head>
<body>
<div id="toolbar">
    <span id="row-count"></span>
    <button id="toggle-labels" title="Toggle value labels">Labels</button>
    <button id="toggle-formats" title="Toggle display formats">Formats</button>
</div>
<div id="grid-container">
    <table id="data-grid">
        <thead id="grid-header"></thead>
        <tbody id="grid-body"></tbody>
    </table>
</div>
<div id="status-bar">
    <span id="dataset-info"></span>
</div>
<script nonce="${nonce}">
${DATA_BROWSER_SCRIPT}
</script>
</body>
</html>`;
}

export function generate_nonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

const DATA_BROWSER_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
}

#toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
}

#toolbar button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
}

#toolbar button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}

#row-count {
    margin-left: auto;
    opacity: 0.7;
}

#grid-container {
    flex: 1;
    overflow: auto;
}

table {
    border-collapse: collapse;
    width: max-content;
    min-width: 100%;
}

th, td {
    padding: 2px 8px;
    text-align: left;
    white-space: nowrap;
    border-right: 1px solid var(--vscode-panel-border);
    border-bottom: 1px solid var(--vscode-panel-border);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
}

th {
    position: sticky;
    top: 0;
    background: var(--vscode-editorWidget-background);
    z-index: 1;
    font-weight: bold;
}

th .var-label {
    display: block;
    font-weight: normal;
    font-size: 0.85em;
    opacity: 0.6;
}

td.missing {
    color: var(--vscode-disabledForeground);
    font-style: italic;
}

td.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* Row number column */
th:first-child, td:first-child {
    background: var(--vscode-editorWidget-background);
    position: sticky;
    left: 0;
    z-index: 2;
    text-align: right;
    color: var(--vscode-editorLineNumber-foreground);
    min-width: 50px;
}
th:first-child { z-index: 3; }

#status-bar {
    padding: 2px 8px;
    background: var(--vscode-statusBar-background);
    color: var(--vscode-statusBar-foreground);
    font-size: 0.9em;
    flex-shrink: 0;
    border-top: 1px solid var(--vscode-panel-border);
}
`;

const DATA_BROWSER_SCRIPT = `
(function() {
    const vscode = acquireVsCodeApi();
    let metadata = null;
    let allRows = {};
    let showLabels = true;
    let showFormats = true;
    let totalRows = 0;
    const PAGE_SIZE = 200;

    // Signal ready
    vscode.postMessage({ type: 'ready' });

    window.addEventListener('message', function(event) {
        const msg = event.data;
        switch (msg.type) {
            case 'metadata':
                metadata = msg;
                totalRows = msg.nobs;
                renderHeader();
                updateStatusBar();
                requestRows(0, Math.min(PAGE_SIZE, totalRows));
                break;
            case 'rowData':
                for (let i = 0; i < msg.rows.length; i++) {
                    allRows[msg.start + i] = msg.rows[i];
                }
                renderBody();
                updateRowCount();
                break;
        }
    });

    function renderHeader() {
        const thead = document.getElementById('grid-header');
        let html = '<tr><th>#</th>';
        for (const v of metadata.variables) {
            const label = v.label
                ? '<span class="var-label">' + escapeHtml(v.label) + '</span>'
                : '';
            html += '<th>' + escapeHtml(v.name) + label + '</th>';
        }
        html += '</tr>';
        thead.innerHTML = html;
    }

    function renderBody() {
        const tbody = document.getElementById('grid-body');
        let html = '';
        const loaded = Object.keys(allRows).map(Number).sort((a,b) => a-b);
        for (const rowIdx of loaded) {
            const row = allRows[rowIdx];
            html += '<tr><td>' + (rowIdx + 1) + '</td>';
            for (let c = 0; c < row.length; c++) {
                const cell = row[c];
                if (cell.missing_type) {
                    html += '<td class="missing">' +
                        escapeHtml(cell.missing_type) + '</td>';
                } else {
                    const isNum = typeof cell.raw === 'number';
                    const cls = isNum ? ' class="numeric"' : '';
                    const display = showFormats ? cell.display : String(cell.raw ?? '');
                    html += '<td' + cls + ' title="' +
                        escapeHtml(String(cell.raw ?? '')) + '">' +
                        escapeHtml(display) + '</td>';
                }
            }
            html += '</tr>';
        }
        tbody.innerHTML = html;
    }

    function updateRowCount() {
        const loaded = Object.keys(allRows).length;
        document.getElementById('row-count').textContent =
            'Showing ' + loaded + ' of ' +
            totalRows.toLocaleString() + ' observations';
    }

    function updateStatusBar() {
        document.getElementById('dataset-info').textContent =
            metadata.name + ' — ' +
            metadata.nobs.toLocaleString() + ' obs × ' +
            metadata.variables.length + ' vars' +
            (metadata.dataset_label ? ' — ' + metadata.dataset_label : '');
    }

    function requestRows(start, count) {
        vscode.postMessage({
            type: 'requestRows',
            start: start,
            count: count,
            request_id: 'req_' + start + '_' + Date.now()
        });
    }

    // Lazy loading on scroll
    const container = document.getElementById('grid-container');
    container.addEventListener('scroll', function() {
        if (!metadata) return;
        const scrollBottom = container.scrollTop + container.clientHeight;
        const contentHeight = container.scrollHeight;
        if (scrollBottom > contentHeight - 200) {
            const loaded = Object.keys(allRows).length;
            if (loaded < totalRows) {
                requestRows(loaded, PAGE_SIZE);
            }
        }
    });

    // Toggle buttons
    document.getElementById('toggle-labels').addEventListener('click', function() {
        showLabels = !showLabels;
        this.classList.toggle('active', showLabels);
        renderBody();
    });
    document.getElementById('toggle-formats').addEventListener('click', function() {
        showFormats = !showFormats;
        this.classList.toggle('active', showFormats);
        renderBody();
    });
    document.getElementById('toggle-labels').classList.add('active');
    document.getElementById('toggle-formats').classList.add('active');

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();
`;

- [ ] **Step 2: Create panel-manager.ts**

```typescript
// client/src/data-browser/panel-manager.ts
import * as vscode from 'vscode';
import { DataBrowserPanel } from './browser-panel';
import { build_data_browser_html, generate_nonce } from './webview-html';
import type { VviewSidecar } from './types';

const VIEW_TYPE = 'sightDataBrowser';

export class DataBrowserPanelManager implements vscode.Disposable {
    private panels = new Map<string, DataBrowserPanel>();

    async open_or_refresh(sidecar: VviewSidecar): Promise<void> {
        const my_key = sidecar.name;

        // Check for replace
        if (sidecar.replace) {
            const my_existing = this.panels.get(my_key);
            if (my_existing) {
                await my_existing.refresh(sidecar, sidecar.dtapath);
                my_existing.reveal(vscode.ViewColumn.Active);
                return;
            }
        }

        // Create new panel
        const my_nonce = generate_nonce();
        const my_panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            `Data: ${sidecar.name}`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        const my_html = build_data_browser_html(my_nonce);
        const my_browser = new DataBrowserPanel(
            my_panel, sidecar, sidecar.dtapath, my_html
        );

        my_browser.on_did_dispose(() => {
            this.panels.delete(my_key);
        });

        this.panels.set(my_key, my_browser);
    }

    dispose(): void {
        for (const my_panel of this.panels.values()) {
            my_panel.dispose();
        }
        this.panels.clear();
    }
}
```

- [ ] **Step 3: Create index.ts (module entry point)**

```typescript
// client/src/data-browser/index.ts
import * as vscode from 'vscode';
import { DataBrowserPanelManager } from './panel-manager';
import { SignalWatcher } from './signal-watcher';

export function register_data_browser(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    const my_manager = new DataBrowserPanelManager();
    context.subscriptions.push(my_manager);

    const my_watcher = new SignalWatcher(
        sidecar => my_manager.open_or_refresh(sidecar),
        log
    );
    my_watcher.start();

    context.subscriptions.push({
        dispose: () => my_watcher.stop(),
    });
}
```

- [ ] **Step 4: Wire into extension.ts**

Add import and registration call to `client/src/extension.ts`:

```typescript
// Add import at top:
import { register_data_browser } from './data-browser';

// Add registration in activate(), after SMCL preview registration:
    // Register data browser
    register_data_browser(context, (msg) => output_channel?.appendLine(msg));
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/jmb/repos/sight && bun run typecheck`

Expected: No type errors (may need to adjust imports for the DtaFile path since client uses CommonJS).

- [ ] **Step 6: Commit**

```bash
git add client/src/data-browser/ client/src/extension.ts
git commit -m "feat(data-browser): add panel manager, webview shell, and extension wiring"
```

---

## Task 14: vview.ado Stata Command

Create the Stata-side command that saves a temp `.dta` file, writes a JSON sidecar, and signals the extension.

**Files:**
- Create: `stata/vview.ado`

- [ ] **Step 1: Create vview.ado**

Use the reference implementation from the spec with minor adjustments:

```stata
*! vview.ado — Open dataset in Sight Data Browser
*! Version 0.1.0

program define vview
    version 16.0
    syntax [varlist] [if] [in] [, Rows(integer 0) Name(string) Replace]

    // Resolve output directory
    local browsedir "~/.sight/browse"
    mata: st_local("browsedir", pathjoin(pathresolve("~"), ".sight", "browse"))
    cap mkdir "`browsedir'"

    // Generate request UUID
    local uuid = strtoname("_" + subinstr(c(current_date) + c(current_time), " ", "", .) ///
        + string(runiform(), "%12.0g"), 1)

    local dtapath "`browsedir'/`uuid'.dta"
    local jsonpath "`browsedir'/`uuid'.json"
    local signalpath "`browsedir'/signal_`uuid'"

    // Determine tab name
    if `"`name'"' == "" {
        if `"`c(filename)'"' != "" {
            local name = c(filename)
        }
        else {
            local name "Untitled"
        }
    }

    // Save subsetted data
    preserve

    // Apply if/in qualifiers
    marksample touse, novarlist
    qui keep if `touse'
    drop `touse'

    if "`varlist'" != "" {
        keep `varlist'
    }
    if `rows' > 0 {
        if _N > `rows' {
            keep in 1/`rows'
            di as txt "(showing first `rows' of `=_N' observations)"
        }
    }

    local obs_n = c(N)
    local var_k = c(k)

    qui save "`dtapath'", replace
    restore

    // Escape backslashes for JSON (Windows paths)
    local json_dtapath = subinstr(`"`dtapath'"', "\", "\\", .)
    local json_name = subinstr(`"`name'"', "\", "\\", .)

    // Write JSON sidecar
    tempname fh
    file open `fh' using "`jsonpath'", write replace
    file write `fh' `"{"' _n
    file write `fh' `"  "version": 1,"' _n
    file write `fh' `"  "uuid": "`uuid'","' _n
    file write `fh' `"  "name": "`json_name'","' _n
    file write `fh' `"  "dtapath": "`json_dtapath'","' _n
    file write `fh' `"  "N": `obs_n',"' _n
    file write `fh' `"  "k": `var_k',"' _n
    file write `fh' `"  "replace": `= cond("`replace'" != "", "true", "false")',"' _n
    file write `fh' `"  "subsetted": `= cond("`varlist'`if'`in'" != "", "true", "false")'"' _n
    file write `fh' `"}"' _n
    file close `fh'

    // Signal the extension
    file open `fh' using "`signalpath'", write replace
    file write `fh' "`uuid'"
    file close `fh'

    di as txt "Opened in Sight Data Browser" as res " (`obs_n' obs, `var_k' vars)"
end
```

- [ ] **Step 2: Commit**

```bash
git add stata/vview.ado
git commit -m "feat(data-browser): add vview.ado Stata command"
```

---

## Task 15: vview.ado Auto-Installation

Install/update `vview.ado` to Stata's PERSONAL ado directory on extension activation.

**Files:**
- Modify: `client/src/data-browser/index.ts`
- Modify: `client/package.json` (add `sight.personalAdoDir` setting)

- [ ] **Step 1: Add the setting to client/package.json**

Add to `contributes.configuration.properties`:

```json
"sight.personalAdoDir": {
    "type": "string",
    "default": "",
    "description": "Path to Stata's PERSONAL ado directory. Leave empty for auto-detection (macOS: ~/Documents/Stata/ado/personal/, Linux: ~/ado/personal/, Windows: %USERPROFILE%\\ado\\personal\\)."
}
```

- [ ] **Step 2: Add ado installer to index.ts**

Update `client/src/data-browser/index.ts` to add the ado installation logic:

```typescript
// Add to client/src/data-browser/index.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function get_personal_ado_dir(): string {
    const my_config = vscode.workspace.getConfiguration('sight');
    const my_setting = my_config.get<string>('personalAdoDir', '');

    if (my_setting) return my_setting;

    // Platform defaults
    switch (process.platform) {
        case 'darwin':
            return path.join(
                os.homedir(), 'Documents', 'Stata', 'ado', 'personal'
            );
        case 'win32':
            return path.join(os.homedir(), 'ado', 'personal');
        default:
            return path.join(os.homedir(), 'ado', 'personal');
    }
}

function install_vview_ado(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    try {
        const my_personal_dir = get_personal_ado_dir();
        const my_target_path = path.join(my_personal_dir, 'vview.ado');

        // Read bundled vview.ado
        const my_bundled_uri = vscode.Uri.joinPath(
            context.extensionUri, 'stata', 'vview.ado'
        );
        const my_bundled_path = my_bundled_uri.fsPath;

        if (!fs.existsSync(my_bundled_path)) {
            log('Data browser: bundled vview.ado not found');
            return;
        }

        const my_bundled_content = fs.readFileSync(
            my_bundled_path, 'utf-8'
        );

        // Check if target exists and matches
        if (fs.existsSync(my_target_path)) {
            const my_existing = fs.readFileSync(
                my_target_path, 'utf-8'
            );
            if (my_existing === my_bundled_content) {
                log(
                    `Data browser: vview.ado already current at ` +
                    my_target_path
                );
                return;
            }
        }

        // Create directory if needed
        fs.mkdirSync(my_personal_dir, { recursive: true });

        // Write the file
        fs.writeFileSync(my_target_path, my_bundled_content, 'utf-8');
        log(`Data browser: installed vview.ado to ${my_target_path}`);
    } catch (err) {
        log(`Data browser: failed to install vview.ado: ${err}`);
    }
}

// Update register_data_browser to call install_vview_ado:
export function register_data_browser(
    context: vscode.ExtensionContext,
    log: (msg: string) => void
): void {
    const my_manager = new DataBrowserPanelManager();
    context.subscriptions.push(my_manager);

    const my_watcher = new SignalWatcher(
        sidecar => my_manager.open_or_refresh(sidecar),
        log
    );
    my_watcher.start();

    context.subscriptions.push({
        dispose: () => my_watcher.stop(),
    });

    // Install/update vview.ado
    install_vview_ado(context, log);
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/data-browser/index.ts client/package.json
git commit -m "feat(data-browser): auto-install vview.ado to PERSONAL directory"
```

---

## Task 16: Build Integration and Bundling

Ensure the new files are included in the build pipeline and the extension bundles correctly.

**Files:**
- Modify: Build scripts as needed

- [ ] **Step 1: Verify TypeScript compilation**

Run: `cd /Users/jmb/repos/sight && bun run typecheck`

Expected: No type errors. Fix any import path issues.

- [ ] **Step 2: Verify extension bundles**

Run: `cd /Users/jmb/repos/sight/client && bun run bundle`

Expected: `client/dist/extension.js` created without errors.

- [ ] **Step 3: Verify stata/vview.ado is included in the extension package**

The `vview.ado` file needs to be included in the `.vsix` package. Check if `.vscodeignore` excludes it. If the build uses `vsce package`, the file must be accessible at `context.extensionUri + '/stata/vview.ado'`.

Run: Check that `stata/vview.ado` is accessible from the client directory. The file lives at the repo root (`stata/vview.ado`) so we need to ensure the extension can access it. Either:
- Copy it to `client/stata/vview.ado` during build, or
- Reference it relative to the extension root

- [ ] **Step 4: Run all tests**

Run: `bun test tests/unit/dta-parser/ tests/unit/data-browser/`

Expected: All tests PASS.

- [ ] **Step 5: Commit any build fixes**

```bash
git add -A
git commit -m "build: integrate data browser into extension build pipeline"
```

---

## Task 17: End-to-End Smoke Test

Create a manual test procedure and a minimal integration test.

**Files:**
- Create: `tests/integration/data-browser-smoke.test.ts`

- [ ] **Step 1: Write an integration test for the parser pipeline**

```typescript
// tests/integration/data-browser-smoke.test.ts
import { describe, it, expect } from 'bun:test';
import * as path from 'path';
import { DtaFile, apply_display_format } from '../../src/dta-parser';

const FIXTURE_DIR = path.join(
    __dirname, '../../tests/fixtures/dta'
);

describe('data browser smoke test', () => {
    it('full pipeline: open, read metadata, read rows, format cells', async () => {
        const my_file = await DtaFile.open(
            path.join(FIXTURE_DIR, 'auto_v118.dta')
        );

        // Metadata
        expect(my_file.nobs).toBe(74);
        expect(my_file.nvar).toBe(12);
        expect(my_file.variables.length).toBe(12);

        // Read a page of rows
        const the_rows = await my_file.read_rows(0, 10);
        expect(the_rows.length).toBe(10);

        // Format a numeric cell
        const my_price_idx = my_file.variables.findIndex(
            v => v.name === 'price'
        );
        const my_price_var = my_file.variables[my_price_idx];
        const my_raw_price = the_rows[0][my_price_idx] as number;
        const my_formatted = apply_display_format(
            my_raw_price, my_price_var.format
        );
        expect(my_formatted).toBeTruthy();
        expect(typeof my_formatted).toBe('string');

        // Value labels
        const my_foreign_var = my_file.variables.find(
            v => v.name === 'foreign'
        );
        if (my_foreign_var?.value_label_name) {
            const my_table = my_file.value_label_tables.get(
                my_foreign_var.value_label_name
            );
            expect(my_table).toBeDefined();
            expect(my_table!.get(0)).toBeDefined();
            expect(my_table!.get(1)).toBeDefined();
        }

        my_file.close();
    });

    it('handles all fixture files without crashing', async () => {
        const the_fixtures = [
            'auto_v118.dta', 'auto_v117.dta',
            'value_labels.dta', 'empty.dta',
            'wide.dta', 'missing_values.dta',
            'strl_test.dta',
        ];

        for (const my_fixture of the_fixtures) {
            const my_path = path.join(FIXTURE_DIR, my_fixture);
            const my_file = await DtaFile.open(my_path);

            expect(my_file.nvar).toBeGreaterThanOrEqual(0);
            expect(my_file.variables.length).toBe(my_file.nvar);

            if (my_file.nobs > 0) {
                const the_rows = await my_file.read_rows(0, 1);
                expect(the_rows.length).toBe(1);
            }

            my_file.close();
        }
    });
});
```

- [ ] **Step 2: Run the integration test**

Run: `bun test tests/integration/data-browser-smoke.test.ts`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/data-browser-smoke.test.ts
git commit -m "test(data-browser): add end-to-end smoke test for parser pipeline"
```

---

## Task 18: Run Full Test Suite

Verify nothing in the existing codebase is broken.

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`

Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `bun test ./tests`

Expected: All existing tests still pass, plus new data browser tests pass.

- [ ] **Step 3: Fix any issues found**

If tests fail, fix them and commit the fixes.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify full test suite passes with data browser changes"
```

---

## Summary of Milestones Coverage

| Spec Milestone | Plan Tasks | Status |
|---|---|---|
| **M0: .dta Parser** | Tasks 1–8 | Full coverage |
| **M1: Webview Grid** | Tasks 9–10, 12–13 | Initial HTML table grid (canvas grid upgrade is M3) |
| **M2: Stata Integration** | Tasks 11, 14–16 | Full coverage |
| **M3: Polish** | Deferred | Column sorting, keyboard nav, theming, a11y, glide-data-grid upgrade, custom editor for `.dta` files |

M3 items (sorting, filtering, keyboard navigation, canvas-rendered grid, accessibility, performance benchmarking, custom `.dta` editor) are deferred to a follow-up plan once M0–M2 are validated end-to-end.

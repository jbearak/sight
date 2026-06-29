import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    LexerErrorCode,
    ParseErrorCode,
    ContextErrorCode,
    StataDiagnosticCode,
} from '../../src/types';
import { diagnostic_code_anchor } from '../../src/utils/diagnostic-code-description';

/**
 * Every diagnostic code now carries a `codeDescription.href` (and SARIF
 * `helpUri`) pointing at docs/diagnostics.md#<anchor>, where <anchor> is
 * derived by diagnostic_code_anchor(). If a code lacks a matching anchor in
 * the docs, that generated link is broken — exactly the regression that left
 * SIGHT_INVALID_ENCODING undocumented. This guard keeps the emitted codes and
 * the documentation anchors in lockstep.
 */

// File-level `sight check` codes are emitted as inline string literals in
// src/cli/source-files.ts (they are not part of an enum). Keep this list in
// sync with the codes passed to file_level_diagnostic() there.
const FILE_LEVEL_CODES = [
    'SIGHT_FILE_TOO_LARGE',
    'SIGHT_FILE_NOT_INDEXED',
    'SIGHT_UNREADABLE',
    'SIGHT_INVALID_ENCODING',
];

describe('diagnostic code documentation coverage', () => {
    const docs_path = join(process.cwd(), 'docs', 'diagnostics.md');
    const docs = readFileSync(docs_path, 'utf-8');

    const the_codes: string[] = [
        ...Object.values(LexerErrorCode),
        ...Object.values(ParseErrorCode),
        ...Object.values(ContextErrorCode),
        ...Object.values(StataDiagnosticCode),
        ...FILE_LEVEL_CODES,
    ];

    for (const my_code of the_codes) {
        it(`documents an anchor for ${my_code}`, () => {
            const my_anchor = diagnostic_code_anchor(my_code);
            expect(my_anchor).toBeTruthy();
            expect(docs).toContain(`id="${my_anchor}"`);
        });
    }
});

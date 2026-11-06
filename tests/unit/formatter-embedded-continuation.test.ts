/**
 * A one-line `mata:` statement continued with `///` formats the same
 * the second time as the first. The source-preserving formatter moves
 * the continued lines by as much as it moves the statement's first
 * line; it used to measure that move from column 0, so they moved one
 * more level on every format (and a `mata:` line continuing a prefix
 * went to column 0).
 */

import { describe, it, expect } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
    mode_specific_assertion,
} from '../property/helpers/formatter-test-utils';
import { create_document_state } from '../property/helpers/document-utils';

function format_source(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        { tabSize: 4, insertSpaces: true },
        create_formatter_config(mode));
    return edits[0]?.newText ?? source;
}

// The base ados' shape: two tabs in, the continuation six columns
// further (u_mi_estimate.ado, _pss_user_init.ado).
const CONTINUED_STATEMENT = [
    'program p',
    '\t\tmata: st_local("a", "1"); ///',
    '\t\t      st_local("b", "2")',
    'end',
    '',
].join('\n');

// A `mata:` line that continues a prefix (fp.ado, _svy2.ado).
const CONTINUED_PREFIX = [
    'program p',
    '\t\tcapture ///',
    '\t\tmata: x = 1',
    'end',
    '',
].join('\n');

describe('a one-line mata: statement continued with ///', () => {
    for_each_formatter_mode('formats the same a second time', (mode) => {
        for (const my_source of [CONTINUED_STATEMENT, CONTINUED_PREFIX]) {
            const once = format_source(my_source, mode);
            expect(format_source(once, mode)).toBe(once);
        }
    });

    for_each_formatter_mode('moves the continued lines with the statement', (mode) => {
        mode_specific_assertion(mode, {
            'source-preserving': () => {
                // The first line moves from column 8 to 4, so the
                // continuation moves from 14 to 10.
                expect(format_source(CONTINUED_STATEMENT, mode)).toBe([
                    'program p',
                    '    mata: st_local("a", "1"); ///',
                    '          st_local("b", "2")',
                    'end',
                    '',
                ].join('\n'));
                expect(format_source(CONTINUED_PREFIX, mode)).toBe([
                    'program p',
                    '    capture ///',
                    '    mata: x = 1',
                    'end',
                    '',
                ].join('\n'));
            },
        });
    });

    it('keeps a block opener on its line with the first line', () => {
        // The placeholder now sits after the line's indentation; a
        // block's restored text must still start at the new indent.
        const source = 'if 1 {\n\t\tmata:\n\t\tx = 1\n\t\tend\n}\n';
        const once = format_source(source, 'source-preserving');
        expect(once.split('\n')[1]).toBe('    mata:');
        expect(format_source(once, 'source-preserving')).toBe(once);
    });
});

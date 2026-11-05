/**
 * `syntax_option_spelling` against the spellings StataMP 18 accepts
 * and the locals it defines for each declared `syntax` option.
 */

import { describe, it, expect } from 'bun:test';
import { syntax_option_spelling } from '../../src/utils/syntax-option-name';

describe('syntax_option_spelling', () => {
    const CASES: Array<[string, boolean, string, string, string]> = [
        // declared, has argument, full, minimum, local
        ['Detail', false, 'detail', 'd', 'detail'],
        ['CACHE', true, 'cache', 'cache', 'cache'],
        ['cache', true, 'cache', 'cache', 'cache'],
        ['LOCal', true, 'local', 'loc', 'local'],
        ['MyOption', false, 'myOption', 'm', 'myOption'],
        ['myOPTion', false, 'myOPTion', 'myOPTion', 'myOPTion'],
        ['noCONStant', false, 'noconstant', 'nocons', 'constant'],
        ['nolog', false, 'nolog', 'nolog', 'log'],
        ['NOLOg', false, 'nolog', 'nolo', 'nolog'],
        ['nomyOption', false, 'nomyOption', 'nomyOption', 'myOption'],
        ['noABc', true, 'noABc', 'noABc', 'noABc'],
        ['notable', true, 'notable', 'notable', 'notable'],
    ];

    for (const [declared, has_argument, full, minimum, local_name] of CASES) {
        it(`reads ${declared}${has_argument ? '()' : ''}`, () => {
            expect(syntax_option_spelling(declared, has_argument)).toEqual({
                full,
                min_abbreviation: minimum,
                local_name,
            });
        });
    }
});

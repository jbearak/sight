/**
 * Unit tests for canonical function name extraction used by the
 * cache-generation script.
 */

import { describe, it, expect } from 'bun:test';
import { extract_canonical_function_name } from '../../scripts/generate-cache';

describe('extract_canonical_function_name', () => {
    it('extracts a mixed-case canonical name from {cmd:Cdhms(...}', () => {
        const my_content =
            '{cmd:Cdhms(}{it:e_d}{cmd:,}{it:h}{cmd:,}{it:m}{cmd:,}{it:s}{cmd:)}';
        expect(extract_canonical_function_name(my_content, 'cdhms')).toBe(
            'Cdhms'
        );
    });

    it('extracts a lowercase canonical name from {cmd:abs(}', () => {
        const my_content = '{cmd:abs(}{it:x}{cmd:)}';
        expect(extract_canonical_function_name(my_content, 'abs')).toBe('abs');
    });

    it('returns null when no {cmd:NAME(} pattern is present', () => {
        const my_content = 'no command pattern here';
        expect(extract_canonical_function_name(my_content, 'foo')).toBeNull();
    });

    it('returns null when the extracted name does not match the filename stem', () => {
        // Defensive: the file f_foo.ihlp references a different function.
        const my_content = '{cmd:OtherFn(}{it:x}{cmd:)}';
        expect(extract_canonical_function_name(my_content, 'foo')).toBeNull();
    });

    it('handles names with underscores and digits', () => {
        const my_content = '{cmd:my_fn2(}{it:x}{cmd:)}';
        expect(extract_canonical_function_name(my_content, 'my_fn2')).toBe(
            'my_fn2'
        );
    });
});

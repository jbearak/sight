/**
 * Tests for the shared SMCL marker extraction utility.
 */
import { describe, it, expect } from 'bun:test';
import { extract_marker_names } from '../../src/utils/marker-scanner';

describe('extract_marker_names', () => {
    it('extracts a single marker name', () => {
        const result = extract_marker_names('{marker syntax}{...}');
        expect(result).toEqual(new Set(['syntax']));
    });

    it('extracts multiple marker names', () => {
        const result = extract_marker_names(
            '{marker syntax}{...}\n{marker options}{...}\n{marker examples}'
        );
        expect(result).toEqual(new Set(['syntax', 'options', 'examples']));
    });

    it('handles names with metacharacters: parentheses', () => {
        const result = extract_marker_names('{marker level()}{...}');
        expect(result).toEqual(new Set(['level()']));
    });

    it('handles names with metacharacters: dots and hashes', () => {
        const result = extract_marker_names(
            '{marker rule15.2}{...}\n{marker lev#_equation}{...}'
        );
        expect(result).toEqual(new Set(['rule15.2', 'lev#_equation']));
    });

    it('handles names with asterisks', () => {
        const result = extract_marker_names('{marker stub*}{...}');
        expect(result).toEqual(new Set(['stub*']));
    });

    it('trims trailing whitespace from marker names', () => {
        const result = extract_marker_names('{marker level() }{...}');
        expect(result).toEqual(new Set(['level()']));
    });

    it('returns empty set for content with no markers', () => {
        const result = extract_marker_names('{title:Syntax}\n{cmd:regress}');
        expect(result).toEqual(new Set());
    });

    it('returns empty set for empty string', () => {
        const result = extract_marker_names('');
        expect(result).toEqual(new Set());
    });

    it('ignores malformed markers with no name', () => {
        const result = extract_marker_names('{marker }');
        expect(result).toEqual(new Set());
    });
});

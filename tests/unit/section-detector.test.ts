/**
 * Unit tests for the Stata Section Detector
 *
 * Tests all four detection patterns (single-line, banner, starred inline,
 * numbered) plus helper functions and real-world patterns from fertility
 * survey codebases.
 */

import { describe, it, expect } from 'bun:test';
import {
    is_delimiter_only,
    is_asterisk_delimiter,
    is_standalone_heading,
    count_delimiter_chars,
    classify_delimiter_line,
    extract_banner_name,
    extract_block_comment_heading,
    derive_numbered_level,
    derive_level_from_delimiter_count,
    derive_banner_level_from_middle_line,
    extract_sections,
    RawSection,
    DelimiterKind,
} from '../../src/providers/section-detector';
import { compute_line_offsets } from '../../src/utils/line-utils';

// ---------------------------------------------------------------------------
// is_delimiter_only()
// ---------------------------------------------------------------------------

describe('is_delimiter_only', () => {
    it('should return true for empty string', () => {
        expect(is_delimiter_only('')).toBe(true);
    });

    it('should return true for whitespace only', () => {
        expect(is_delimiter_only('   ')).toBe(true);
        expect(is_delimiter_only('\t')).toBe(true);
        expect(is_delimiter_only(' \t ')).toBe(true);
    });

    it('should return true for all delimiter chars (* - = + / #)', () => {
        expect(is_delimiter_only('*-=+/#')).toBe(true);
        expect(is_delimiter_only('****')).toBe(true);
        expect(is_delimiter_only('----')).toBe(true);
        expect(is_delimiter_only('====')).toBe(true);
        expect(is_delimiter_only('++++')).toBe(true);
        expect(is_delimiter_only('////')).toBe(true);
        expect(is_delimiter_only('####')).toBe(true);
    });

    it('should return true for mixed delimiters with spaces', () => {
        expect(is_delimiter_only('* - = + / #')).toBe(true);
        expect(is_delimiter_only('  ---- **** ')).toBe(true);
        expect(is_delimiter_only('\t***\t---\t')).toBe(true);
    });

    it('should return false for string with a letter', () => {
        expect(is_delimiter_only('a')).toBe(false);
        expect(is_delimiter_only('----a----')).toBe(false);
        expect(is_delimiter_only('Section')).toBe(false);
    });

    it('should return false for string with a digit', () => {
        expect(is_delimiter_only('1')).toBe(false);
        expect(is_delimiter_only('----1----')).toBe(false);
        expect(is_delimiter_only('123')).toBe(false);
    });

    it('should return false for string with Unicode', () => {
        expect(is_delimiter_only('\u00e9')).toBe(false);
        expect(is_delimiter_only('----\u00e9----')).toBe(false);
        expect(is_delimiter_only('\u4e16\u754c')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// is_asterisk_delimiter()
// ---------------------------------------------------------------------------

describe('is_asterisk_delimiter', () => {
    it('should return true for pure asterisk lines with 4+ asterisks', () => {
        expect(is_asterisk_delimiter('****')).toBe(true);
        expect(is_asterisk_delimiter('*****')).toBe(true);
        expect(is_asterisk_delimiter('********************')).toBe(true);
        expect(is_asterisk_delimiter('*******************************************************************')).toBe(true);
    });

    it('should return true for asterisk lines with leading/trailing whitespace', () => {
        expect(is_asterisk_delimiter('  ****')).toBe(true);
        expect(is_asterisk_delimiter('****  ')).toBe(true);
        expect(is_asterisk_delimiter('  ****  ')).toBe(true);
        expect(is_asterisk_delimiter('\t****\t')).toBe(true);
        expect(is_asterisk_delimiter('   ********************   ')).toBe(true);
    });

    it('should return true for comment-prefixed asterisk lines (/****...)', () => {
        expect(is_asterisk_delimiter('/****')).toBe(true);
        expect(is_asterisk_delimiter('/*****')).toBe(true);
        expect(is_asterisk_delimiter('/********************************************************************')).toBe(true);
        expect(is_asterisk_delimiter('  /****  ')).toBe(true);
    });

    it('should return true for comment-suffixed asterisk lines (*****/)', () => {
        expect(is_asterisk_delimiter('*****/')).toBe(true);
        expect(is_asterisk_delimiter('****/')).toBe(true);
        expect(is_asterisk_delimiter('******************************************************************/')).toBe(true);
        expect(is_asterisk_delimiter('  *****/  ')).toBe(true);
    });

    it('should return true for full block comment delimiters (/****...*/)', () => {
        expect(is_asterisk_delimiter('/****/')).toBe(true);
        expect(is_asterisk_delimiter('/*****/')).toBe(true);
        expect(is_asterisk_delimiter('/******/')).toBe(true);
        expect(is_asterisk_delimiter('/********************************************************************/')).toBe(true);
        expect(is_asterisk_delimiter('  /*****/  ')).toBe(true);
    });

    it('should return true for asterisk lines ending with */', () => {
        expect(is_asterisk_delimiter('******/')).toBe(true);
        expect(is_asterisk_delimiter('*****/')).toBe(true);
        expect(is_asterisk_delimiter('*******************************************************************/')).toBe(true);
    });

    it('should return false for lines with fewer than 4 asterisks', () => {
        expect(is_asterisk_delimiter('***')).toBe(false);
        expect(is_asterisk_delimiter('**')).toBe(false);
        expect(is_asterisk_delimiter('*')).toBe(false);
        expect(is_asterisk_delimiter('')).toBe(false);
    });

    it('should return false for lines with fewer than 4 asterisks after stripping comment markers', () => {
        expect(is_asterisk_delimiter('/***')).toBe(false);
        expect(is_asterisk_delimiter('/**/')).toBe(false);
        expect(is_asterisk_delimiter('/**')).toBe(false);
        expect(is_asterisk_delimiter('***/')).toBe(false);
    });

    it('should return false for lines with non-asterisk characters', () => {
        expect(is_asterisk_delimiter('****a****')).toBe(false);
        expect(is_asterisk_delimiter('****-****')).toBe(false);
        expect(is_asterisk_delimiter('**** ****')).toBe(false);
        expect(is_asterisk_delimiter('****text****')).toBe(false);
        expect(is_asterisk_delimiter('/*** text ***/')).toBe(false);
    });

    it('should return false for other delimiter types', () => {
        expect(is_asterisk_delimiter('----')).toBe(false);
        expect(is_asterisk_delimiter('====')).toBe(false);
        expect(is_asterisk_delimiter('++++')).toBe(false);
        expect(is_asterisk_delimiter('////')).toBe(false);
    });

    it('should handle real-world block comment patterns', () => {
        // From contraceptive_methods.do
        expect(is_asterisk_delimiter('/********************************************************************')).toBe(true);
        expect(is_asterisk_delimiter('*******************************************************************/')).toBe(true);
        // Standard asterisk banner
        expect(is_asterisk_delimiter('*******************************************************************')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// extract_block_comment_heading()
// ---------------------------------------------------------------------------

describe('extract_block_comment_heading', () => {
    it('should extract heading text from middle line with leading space', () => {
        expect(extract_block_comment_heading(' Current contraceptive methods')).toBe('Current contraceptive methods');
    });

    it('should extract heading text from middle line with leading asterisk', () => {
        expect(extract_block_comment_heading('* Current contraceptive methods')).toBe('Current contraceptive methods');
    });

    it('should extract heading text from middle line with leading space + asterisk', () => {
        expect(extract_block_comment_heading(' * Current contraceptive methods')).toBe('Current contraceptive methods');
    });

    it('should strip trailing asterisks from heading text', () => {
        expect(extract_block_comment_heading(' Current contraceptive methods ***')).toBe('Current contraceptive methods');
    });

    it('should strip both leading and trailing asterisks', () => {
        expect(extract_block_comment_heading('*** Current contraceptive methods ***')).toBe('Current contraceptive methods');
    });

    it('should return null for empty string', () => {
        expect(extract_block_comment_heading('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
        expect(extract_block_comment_heading('   ')).toBeNull();
        expect(extract_block_comment_heading('\t\t')).toBeNull();
    });

    it('should return null for asterisk-only string', () => {
        expect(extract_block_comment_heading('****')).toBeNull();
        expect(extract_block_comment_heading('  ****  ')).toBeNull();
    });

    it('should return null for delimiter-only content after stripping', () => {
        expect(extract_block_comment_heading('* ---- *')).toBeNull();
        expect(extract_block_comment_heading('* ==== *')).toBeNull();
        expect(extract_block_comment_heading('* ++++ *')).toBeNull();
    });

    it('should handle real-world block comment middle line', () => {
        expect(extract_block_comment_heading(' Current contraceptive methods for Rounds IV-VIII (v307_01-v307_21)')).toBe('Current contraceptive methods for Rounds IV-VIII (v307_01-v307_21)');
    });
});

// ---------------------------------------------------------------------------
// Block comment heading detection edge cases
// ---------------------------------------------------------------------------

describe('Block comment heading detection edge cases', () => {
    /**
     * Test block comment at start of file (line 0)
     * Should NOT be detected because there's no line i-1 for the top delimiter.
     * The block comment detection loop starts at line 1 (i > 0).
     * _Requirements: 1.1, 1.2, 1.3, 1.4_
     */
    it('should NOT detect block comment when heading is at line 0 (no line above)', () => {
        // If the heading text is at line 0, there's no line -1 for the top delimiter
        // This tests the boundary condition where i > 0 is required
        const my_content = [
            ' Current contraceptive methods',  // line 0: would-be heading (no line above)
            '*******************************************************************/', // line 1: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect as block comment because there's no top delimiter
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment when top delimiter is at line 0 and only 2 lines exist', () => {
        // Only 2 lines: top delimiter at line 0, heading at line 1
        // No bottom delimiter exists
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            ' Current contraceptive methods',  // line 1: heading (no line below)
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because there's no bottom delimiter
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    /**
     * Test block comment at end of file
     * Should be detected if there are 3 lines (top delimiter, heading, bottom delimiter).
     * _Requirements: 1.1, 1.2, 1.3, 1.4_
     */
    it('should detect block comment at end of file with 3 lines', () => {
        const my_content = [
            'use mydata.dta',  // line 0: code
            '/********************************************************************', // line 1: top delimiter
            ' Current contraceptive methods',  // line 2: heading
            '*******************************************************************/', // line 3: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Current contraceptive methods');
        expect(my_sections[0].detection_type).toBe('banner');
        expect(my_sections[0].range.start.line).toBe(1);
        expect(my_sections[0].range.end.line).toBe(3);
    });

    it('should detect block comment when it is the entire file (exactly 3 lines)', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            ' Current contraceptive methods',  // line 1: heading
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Current contraceptive methods');
        expect(my_sections[0].detection_type).toBe('banner');
        expect(my_sections[0].range.start.line).toBe(0);
        expect(my_sections[0].range.end.line).toBe(2);
    });

    it('should detect block comment at very end of file (last 3 lines)', () => {
        const my_content = [
            'use mydata.dta',  // line 0
            'gen x = 1',       // line 1
            'reg y x',         // line 2
            '/********************************************************************', // line 3: top delimiter
            ' Final Section',  // line 4: heading
            '*******************************************************************/', // line 5: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Final Section');
        expect(my_sections[0].detection_type).toBe('banner');
        expect(my_sections[0].range.start.line).toBe(3);
        expect(my_sections[0].range.end.line).toBe(5);
    });

    /**
     * Test empty heading text after stripping
     * Should NOT be detected when the middle line is empty or whitespace-only.
     * _Requirements: 1.1, 1.4_
     */
    it('should NOT detect block comment with empty heading text', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            '',  // line 1: empty heading
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because heading text is empty
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment with whitespace-only heading text', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            '     ',  // line 1: whitespace-only heading
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because heading text is whitespace-only
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment with asterisk-only heading text', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            ' *** ',  // line 1: asterisk-only heading (becomes empty after stripping)
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because heading text is asterisk-only
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    /**
     * Test heading text that is all delimiters (e.g., `****`)
     * Should NOT be detected because is_delimiter_only() returns true.
     * _Requirements: 1.1, 1.4_
     */
    it('should NOT detect block comment when heading is all asterisks', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            '****',  // line 1: all asterisks
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because heading text is delimiter-only
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment when heading is all dashes', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            '----',  // line 1: all dashes
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because heading text is delimiter-only
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment when heading is mixed delimiters', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            '* ---- *',  // line 1: mixed delimiters
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because heading text is delimiter-only after stripping
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment when heading is equals signs', () => {
        const my_content = [
            '/********************************************************************', // line 0: top delimiter
            '====',  // line 1: all equals
            '*******************************************************************/', // line 2: bottom delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect because heading text is delimiter-only
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    /**
     * Test mismatched delimiters (asterisks vs dashes)
     * Should NOT be detected as block comment because both delimiters must be asterisks.
     * _Requirements: 1.2, 1.3_
     */
    it('should NOT detect block comment with mismatched delimiters (asterisks top, dashes bottom)', () => {
        const my_content = [
            '/********************************************************************', // line 0: asterisk delimiter
            ' Section Name',  // line 1: heading
            '-------------------------------------------------------------------', // line 2: dash delimiter (not asterisks!)
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect as block comment because bottom is not asterisk delimiter
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment with mismatched delimiters (dashes top, asterisks bottom)', () => {
        const my_content = [
            '-------------------------------------------------------------------', // line 0: dash delimiter (not asterisks!)
            ' Section Name',  // line 1: heading
            '*******************************************************************/', // line 2: asterisk delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect as block comment because top is not asterisk delimiter
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment with mismatched delimiters (equals top, asterisks bottom)', () => {
        const my_content = [
            '===================================================================', // line 0: equals delimiter (not asterisks!)
            ' Section Name',  // line 1: heading
            '*******************************************************************/', // line 2: asterisk delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect as block comment because top is not asterisk delimiter
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should NOT detect block comment with mismatched delimiters (slashes top, asterisks bottom)', () => {
        const my_content = [
            '///////////////////////////////////////////////////////////////////', // line 0: slash delimiter (not asterisks!)
            ' Section Name',  // line 1: heading
            '*******************************************************************/', // line 2: asterisk delimiter
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect as block comment because top is not asterisk delimiter
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    /**
     * Additional edge cases for block comment detection
     */
    it('should detect block comment with pure asterisk delimiters (no comment markers)', () => {
        const my_content = [
            '*******************************************************************', // line 0: pure asterisks
            ' Section Name',  // line 1: heading
            '*******************************************************************', // line 2: pure asterisks
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Section Name');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should detect block comment with comment-prefixed asterisk delimiters', () => {
        const my_content = [
            '/********************************************************************', // line 0: /****...
            ' Current contraceptive methods for Rounds IV-VIII (v307_01-v307_21)',  // line 1: heading
            '*******************************************************************/', // line 2: ****/
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Current contraceptive methods for Rounds IV-VIII (v307_01-v307_21)');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should handle block comment with minimal asterisks (exactly 4)', () => {
        const my_content = [
            '****', // line 0: minimal asterisks
            ' Section Name',  // line 1: heading
            '****', // line 2: minimal asterisks
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Section Name');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should NOT detect block comment with too few asterisks (3)', () => {
        const my_content = [
            '***', // line 0: only 3 asterisks (not enough)
            ' Section Name',  // line 1: heading
            '***', // line 2: only 3 asterisks (not enough)
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not detect as block comment because delimiters have < 4 asterisks
        const my_block_comments = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_block_comments.length).toBe(0);
    });

    it('should handle multiple block comments in same file', () => {
        const my_content = [
            '/********************************************************************', // line 0
            ' First Section',  // line 1
            '*******************************************************************/', // line 2
            'use mydata.dta',  // line 3
            '/********************************************************************', // line 4
            ' Second Section',  // line 5
            '*******************************************************************/', // line 6
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(2);
        expect(my_sections[0].name).toBe('First Section');
        expect(my_sections[0].range.start.line).toBe(0);
        expect(my_sections[1].name).toBe('Second Section');
        expect(my_sections[1].range.start.line).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// is_standalone_heading()
// ---------------------------------------------------------------------------

describe('is_standalone_heading', () => {
    it('should return true for lines at column 0 (no leading whitespace)', () => {
        expect(is_standalone_heading('* 1. Section Name')).toBe(true);
        expect(is_standalone_heading('// 1.1 Analysis')).toBe(true);
        expect(is_standalone_heading('* 0 not using')).toBe(true);
        expect(is_standalone_heading('text at column 0')).toBe(true);
    });

    it('should return true for lines with 1-3 spaces of leading whitespace', () => {
        expect(is_standalone_heading(' * 1. Section')).toBe(true);
        expect(is_standalone_heading('  * 2. Section')).toBe(true);
        expect(is_standalone_heading('   * 3. Section')).toBe(true);
    });

    it('should return false for lines with 4+ spaces of leading whitespace', () => {
        expect(is_standalone_heading('    * 0 not using')).toBe(false);
        expect(is_standalone_heading('    * 1 pill')).toBe(false);
        expect(is_standalone_heading('    * 2 iud')).toBe(false);
        expect(is_standalone_heading('     * 5 spaces')).toBe(false);
        expect(is_standalone_heading('        * 8 spaces')).toBe(false);
    });

    it('should return false for lines starting with a tab character', () => {
        expect(is_standalone_heading('\t* 1 pill')).toBe(false);
        expect(is_standalone_heading('\t* 0 not using')).toBe(false);
        expect(is_standalone_heading('\t\t* double tab')).toBe(false);
    });

    it('should return true for empty string', () => {
        expect(is_standalone_heading('')).toBe(true);
    });

    it('should return true for whitespace-only lines with < 4 spaces', () => {
        expect(is_standalone_heading('   ')).toBe(true);
    });

    it('should return false for whitespace-only lines with 4+ spaces', () => {
        expect(is_standalone_heading('    ')).toBe(false);
    });

    it('should handle the specific list pattern from contraceptive_methods.do', () => {
        // These are indented list items that should NOT be detected as headings
        expect(is_standalone_heading('    * 0 not using')).toBe(false);
        expect(is_standalone_heading('    * 1 pill')).toBe(false);
        expect(is_standalone_heading('    * 2 iud')).toBe(false);
        expect(is_standalone_heading('    * 3 injections')).toBe(false);
    });

    it('should return true for valid numbered section patterns at column 0', () => {
        expect(is_standalone_heading('* 1.1 Section Name')).toBe(true);
        expect(is_standalone_heading('// 2.10.1 Complex')).toBe(true);
    });

    it('should handle mixed whitespace (spaces then tab)', () => {
        // Any tab in leading whitespace means indented code → rejected
        expect(is_standalone_heading('  \t* mixed')).toBe(false);
    });

    it('should return false for tab followed by spaces', () => {
        expect(is_standalone_heading('\t  * tab then spaces')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// count_delimiter_chars()
// ---------------------------------------------------------------------------

describe('count_delimiter_chars', () => {
    describe('pure delimiter lines', () => {
        it('should count asterisks in pure asterisk line', () => {
            expect(count_delimiter_chars('****', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('*****', 'asterisk')).toBe(5);
            expect(count_delimiter_chars('********************', 'asterisk')).toBe(20);
        });

        it('should count dashes in pure dash line', () => {
            expect(count_delimiter_chars('----', 'dash')).toBe(4);
            expect(count_delimiter_chars('-----', 'dash')).toBe(5);
            expect(count_delimiter_chars('--------------------', 'dash')).toBe(20);
        });

        it('should count slashes in pure slash line', () => {
            expect(count_delimiter_chars('////', 'slash')).toBe(4);
            expect(count_delimiter_chars('/////', 'slash')).toBe(5);
            expect(count_delimiter_chars('////////////////////', 'slash')).toBe(20);
        });

        it('should count equals in pure equals line', () => {
            expect(count_delimiter_chars('====', 'equals')).toBe(4);
            expect(count_delimiter_chars('=====', 'equals')).toBe(5);
            expect(count_delimiter_chars('====================', 'equals')).toBe(20);
        });

        it('should count plus in pure plus line', () => {
            expect(count_delimiter_chars('++++', 'plus')).toBe(4);
            expect(count_delimiter_chars('+++++', 'plus')).toBe(5);
            expect(count_delimiter_chars('++++++++++++++++++++', 'plus')).toBe(20);
        });

        it('should handle leading/trailing whitespace', () => {
            expect(count_delimiter_chars('  ****  ', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('\t----\t', 'dash')).toBe(4);
            expect(count_delimiter_chars('   ========   ', 'equals')).toBe(8);
        });
    });

    describe('comment-prefixed delimiter lines', () => {
        it('should count dashes after // prefix', () => {
            expect(count_delimiter_chars('// ----', 'dash')).toBe(4);
            expect(count_delimiter_chars('// --------', 'dash')).toBe(8);
            expect(count_delimiter_chars('// ----------------------------------------', 'dash')).toBe(40);
        });

        it('should count equals after // prefix', () => {
            expect(count_delimiter_chars('// ====', 'equals')).toBe(4);
            expect(count_delimiter_chars('// ========', 'equals')).toBe(8);
            expect(count_delimiter_chars('// ========================================', 'equals')).toBe(40);
        });

        it('should count asterisks after // prefix', () => {
            expect(count_delimiter_chars('// ****', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('// ********', 'asterisk')).toBe(8);
        });

        it('should count plus after // prefix', () => {
            expect(count_delimiter_chars('// ++++', 'plus')).toBe(4);
            expect(count_delimiter_chars('// ++++++++', 'plus')).toBe(8);
        });

        it('should count dashes after * prefix', () => {
            expect(count_delimiter_chars('* ----', 'dash')).toBe(4);
            expect(count_delimiter_chars('* --------', 'dash')).toBe(8);
            expect(count_delimiter_chars('* ----------------------------------------', 'dash')).toBe(40);
        });

        it('should count equals after * prefix', () => {
            expect(count_delimiter_chars('* ====', 'equals')).toBe(4);
            expect(count_delimiter_chars('* ========', 'equals')).toBe(8);
        });

        it('should count plus after * prefix', () => {
            expect(count_delimiter_chars('* ++++', 'plus')).toBe(4);
            expect(count_delimiter_chars('* ++++++++', 'plus')).toBe(8);
        });
    });

    describe('asterisk block comment patterns', () => {
        it('should count asterisks in /****... pattern', () => {
            expect(count_delimiter_chars('/****', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('/*****', 'asterisk')).toBe(5);
            expect(count_delimiter_chars('/********************************************************************', 'asterisk')).toBe(68);
        });

        it('should count asterisks in ****/ pattern', () => {
            expect(count_delimiter_chars('****/', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('*****/', 'asterisk')).toBe(5);
            expect(count_delimiter_chars('*******************************************************************/', 'asterisk')).toBe(67);
        });

        it('should count asterisks in /****/ pattern', () => {
            expect(count_delimiter_chars('/****/', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('/*****/', 'asterisk')).toBe(5);
            expect(count_delimiter_chars('/******/', 'asterisk')).toBe(6);
        });

        it('should handle whitespace around block comment patterns', () => {
            expect(count_delimiter_chars('  /****  ', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('  ****/  ', 'asterisk')).toBe(4);
            expect(count_delimiter_chars('  /****/  ', 'asterisk')).toBe(4);
        });
    });

    describe('mismatched delimiter kinds', () => {
        it('should return 0 when kind does not match line content', () => {
            expect(count_delimiter_chars('****', 'dash')).toBe(0);
            expect(count_delimiter_chars('----', 'asterisk')).toBe(0);
            expect(count_delimiter_chars('====', 'dash')).toBe(0);
            expect(count_delimiter_chars('// ----', 'asterisk')).toBe(0);
            expect(count_delimiter_chars('// ====', 'dash')).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('should return 0 for empty line', () => {
            expect(count_delimiter_chars('', 'asterisk')).toBe(0);
            expect(count_delimiter_chars('', 'dash')).toBe(0);
        });

        it('should return 0 for whitespace-only line', () => {
            expect(count_delimiter_chars('   ', 'asterisk')).toBe(0);
            expect(count_delimiter_chars('\t\t', 'dash')).toBe(0);
        });

        it('should return 0 for lines with mixed content', () => {
            expect(count_delimiter_chars('****text****', 'asterisk')).toBe(0);
            expect(count_delimiter_chars('----text----', 'dash')).toBe(0);
            expect(count_delimiter_chars('// Section Name', 'dash')).toBe(0);
        });

        it('should handle single-character delimiter counts', () => {
            // These should return 0 because they don't meet the minimum threshold
            // for pure delimiter lines (which is implicitly 1 character)
            expect(count_delimiter_chars('*', 'asterisk')).toBe(1);
            expect(count_delimiter_chars('-', 'dash')).toBe(1);
        });

        it('should handle very large delimiter counts', () => {
            const my_long_asterisks = '*'.repeat(100);
            expect(count_delimiter_chars(my_long_asterisks, 'asterisk')).toBe(100);

            const my_long_dashes = '-'.repeat(100);
            expect(count_delimiter_chars(my_long_dashes, 'dash')).toBe(100);
        });
    });

    describe('real-world patterns', () => {
        it('should count delimiters in real banner patterns', () => {
            // From fertility_surveys codebase
            expect(count_delimiter_chars('// ---------------------------------------------------------', 'dash')).toBe(57);
            expect(count_delimiter_chars('*******************************************************************', 'asterisk')).toBe(67);
            expect(count_delimiter_chars('/********************************************************************', 'asterisk')).toBe(68);
            expect(count_delimiter_chars('*******************************************************************/', 'asterisk')).toBe(67);
        });

        it('should count delimiters in equals banner patterns', () => {
            expect(count_delimiter_chars('// ========================================', 'equals')).toBe(40);
        });
    });
});

// ---------------------------------------------------------------------------
// Single-line section detection
// ---------------------------------------------------------------------------

describe('Single-line section detection', () => {
    it('should detect slash-style with dashes: // Section Name ----', () => {
        const my_content = '// Section Name ----';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Section Name');
        expect(my_sections[0].detection_type).toBe('single_line');
        expect(my_sections[0].level).toBe(1);
    });

    it('should detect slash-style with equals: // Setup ====', () => {
        const my_content = '// Setup ====';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Setup');
        expect(my_sections[0].detection_type).toBe('single_line');
    });

    it('should detect slash-style with asterisks: // Analysis ****', () => {
        const my_content = '// Analysis ****';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Analysis');
        expect(my_sections[0].detection_type).toBe('single_line');
    });

    it('should detect slash-style with plus: // Results ++++', () => {
        const my_content = '// Results ++++';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Results');
        expect(my_sections[0].detection_type).toBe('single_line');
    });

    it('should detect star-style with dashes: * Section Name ----', () => {
        const my_content = '* Section Name ----';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Section Name');
        expect(my_sections[0].detection_type).toBe('single_line');
    });

    it('should detect star-style with equals: * Setup ====', () => {
        const my_content = '* Setup ====';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Setup');
        expect(my_sections[0].detection_type).toBe('single_line');
    });

    it('should detect with leading whitespace: "  // Section Name ----"', () => {
        const my_content = '  // Section Name ----';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Section Name');
        expect(my_sections[0].detection_type).toBe('single_line');
    });

    it('should NOT detect when name is delimiter-only: // ---- ----', () => {
        const my_content = '// ---- ----';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Banner section detection
// ---------------------------------------------------------------------------

describe('Banner section detection', () => {
    it('should detect a dash banner', () => {
        const my_content = [
            '// ---------------------------------------------------------',
            '// confirm proper scope of survey years',
            '// ---------------------------------------------------------',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('confirm proper scope of survey years');
        expect(my_sections[0].detection_type).toBe('banner');
        // Middle line `// ...` → 2 slashes → level 1
        expect(my_sections[0].level).toBe(1);
        expect(my_sections[0].range.start.line).toBe(0);
        expect(my_sections[0].range.end.line).toBe(2);
        expect(my_sections[0].selection_range.start.line).toBe(1);
        expect(my_sections[0].selection_range.end.line).toBe(1);
    });

    it('should detect an asterisk banner', () => {
        const my_content = [
            '*******************************************************************',
            '********************** MARITAL STATUS *****************************',
            '*******************************************************************',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('MARITAL STATUS');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should detect a slash banner', () => {
        const my_content = [
            '/////////////////////////////////////////////////////',
            '/////Creating a variable for contraceptive usage///////',
            '///////////////////////////////////////////////////////',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Creating a variable for contraceptive usage');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should detect an equals banner', () => {
        const my_content = [
            '// ========================================',
            '// Data Validation',
            '// ========================================',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Data Validation');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should NOT detect banner with mismatched delimiter types (dash top, equals bottom)', () => {
        const my_content = [
            '// ----------------------------------------',
            '// Mismatched Section',
            '// ========================================',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should not be detected as a banner because top is 'dash' and bottom is 'equals'
        const my_banners = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_banners.length).toBe(0);
    });

    it('should NOT detect banner when name is delimiter-only', () => {
        const my_content = [
            '// ----------------------------------------',
            '// ---- ---- ----',
            '// ----------------------------------------',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        const my_banners = my_sections.filter(s => s.detection_type === 'banner');
        expect(my_banners.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Starred inline section detection
// ---------------------------------------------------------------------------

describe('Starred inline section detection', () => {
    it('should detect *** MARITAL STATUS ***', () => {
        const my_content = '*** MARITAL STATUS ***';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('MARITAL STATUS');
        expect(my_sections[0].detection_type).toBe('starred_inline');
        expect(my_sections[0].level).toBe(1);
    });

    it('should detect ** Quality Checks **', () => {
        const my_content = '** Quality Checks **';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Quality Checks');
        expect(my_sections[0].detection_type).toBe('starred_inline');
    });

    it('should detect ************** Section **************', () => {
        const my_content = '************** Section **************';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Section');
        expect(my_sections[0].detection_type).toBe('starred_inline');
    });

    it('should NOT detect decorative-only starred inline: *** ---- ***', () => {
        const my_content = '*** ---- ***';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        const my_starred = my_sections.filter(s => s.detection_type === 'starred_inline');
        expect(my_starred.length).toBe(0);
    });

    it('should NOT detect single asterisk each side: * text *', () => {
        const my_content = '* text *';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        const my_starred = my_sections.filter(s => s.detection_type === 'starred_inline');
        expect(my_starred.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Numbered section detection
// ---------------------------------------------------------------------------

describe('Numbered section detection', () => {
    it('should detect * 1. Setup as level 1', () => {
        const my_content = '* 1. Setup';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('1. Setup');
        expect(my_sections[0].level).toBe(1);
        expect(my_sections[0].detection_type).toBe('numbered');
    });

    it('should detect * 1.1 Analysis as level 2', () => {
        const my_content = '* 1.1 Analysis';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('1.1 Analysis');
        expect(my_sections[0].level).toBe(2);
        expect(my_sections[0].detection_type).toBe('numbered');
    });

    it('should detect * 1.1.1 Details as level 3', () => {
        const my_content = '* 1.1.1 Details';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('1.1.1 Details');
        expect(my_sections[0].level).toBe(3);
        expect(my_sections[0].detection_type).toBe('numbered');
    });

    it('should detect // 2.10.1 Complex as level 3', () => {
        const my_content = '// 2.10.1 Complex';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('2.10.1 Complex');
        expect(my_sections[0].level).toBe(3);
        expect(my_sections[0].detection_type).toBe('numbered');
    });

    it('should detect * 1. ---- as single-line (not numbered, since rest is delimiter-only)', () => {
        const my_content = '* 1. ----';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Single-line detector sees name "1." with trailing delimiter "----"
        // Numbered detector would reject because rest after "1." is delimiter-only
        // But single-line runs first and detects it
        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('1.');
        expect(my_sections[0].detection_type).toBe('single_line');
    });
});

// ---------------------------------------------------------------------------
// classify_delimiter_line()
// ---------------------------------------------------------------------------

describe('classify_delimiter_line', () => {
    it('should classify all-asterisk line as asterisk', () => {
        expect(classify_delimiter_line('****************************')).toBe('asterisk');
        expect(classify_delimiter_line('  ****  ')).toBe('asterisk');
    });

    it('should classify all-slash line as slash', () => {
        expect(classify_delimiter_line('////////////////////////////')).toBe('slash');
        expect(classify_delimiter_line('  ////  ')).toBe('slash');
    });

    it('should classify // ======== as equals', () => {
        expect(classify_delimiter_line('// ========')).toBe('equals');
        expect(classify_delimiter_line('// =========================================')).toBe('equals');
    });

    it('should classify * -------- as dash', () => {
        expect(classify_delimiter_line('* --------')).toBe('dash');
        expect(classify_delimiter_line('* ------------------------------------------')).toBe('dash');
    });

    it('should return null for // text (non-delimiter content)', () => {
        expect(classify_delimiter_line('// text')).toBeNull();
        expect(classify_delimiter_line('// Section Name')).toBeNull();
    });

    it('should return null for short line --- (less than 4 characters)', () => {
        expect(classify_delimiter_line('---')).toBeNull();
        expect(classify_delimiter_line('**')).toBeNull();
        expect(classify_delimiter_line('//')).toBeNull();
    });

    it('should classify // ---- as dash', () => {
        expect(classify_delimiter_line('// ----')).toBe('dash');
    });

    it('should classify // **** as asterisk', () => {
        expect(classify_delimiter_line('// ****')).toBe('asterisk');
    });

    it('should classify // ++++ as plus', () => {
        expect(classify_delimiter_line('// ++++')).toBe('plus');
    });

    it('should classify * ==== as equals', () => {
        expect(classify_delimiter_line('* ====')).toBe('equals');
    });

    it('should classify * ++++ as plus', () => {
        expect(classify_delimiter_line('* ++++')).toBe('plus');
    });
});

// ---------------------------------------------------------------------------
// extract_banner_name()
// ---------------------------------------------------------------------------

describe('extract_banner_name', () => {
    it('should extract name from // Section Name', () => {
        expect(extract_banner_name('// Section Name')).toBe('Section Name');
    });

    it('should strip trailing delimiters from // Section Name //', () => {
        expect(extract_banner_name('// Section Name //')).toBe('Section Name');
    });

    it('should extract name from * Name *', () => {
        expect(extract_banner_name('* Name *')).toBe('Name');
    });

    it('should return null for delimiter-only middle: * ---- *', () => {
        expect(extract_banner_name('* ---- *')).toBeNull();
    });

    it('should return null when no comment marker: just text', () => {
        expect(extract_banner_name('just text')).toBeNull();
    });

    it('should strip trailing asterisks from * MARITAL STATUS ***', () => {
        expect(extract_banner_name('********************** MARITAL STATUS *****************************')).toBe('MARITAL STATUS');
    });

    it('should strip trailing slashes from /////Name//////', () => {
        expect(extract_banner_name('/////Creating a variable for contraceptive usage///////')).toBe('Creating a variable for contraceptive usage');
    });

    it('should return null for empty name after stripping', () => {
        expect(extract_banner_name('//')).toBeNull();
        expect(extract_banner_name('*')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// derive_banner_level_from_middle_line()
// ---------------------------------------------------------------------------

describe('derive_banner_level_from_middle_line', () => {
    it('should return 1 for "//" prefix', () => {
        expect(derive_banner_level_from_middle_line('// Section Name')).toBe(1);
    });

    it('should return 2 for "///" prefix', () => {
        expect(derive_banner_level_from_middle_line('/// Section Name')).toBe(2);
    });

    it('should return 3 for "////" prefix', () => {
        expect(derive_banner_level_from_middle_line('//// Section Name')).toBe(3);
    });

    it('should return 4 for "/////" or more slashes', () => {
        expect(derive_banner_level_from_middle_line('///// Section Name')).toBe(4);
        expect(derive_banner_level_from_middle_line('////// Section Name')).toBe(4);
    });

    it('should return 1 for "*" prefix', () => {
        expect(derive_banner_level_from_middle_line('* Section Name')).toBe(1);
    });

    it('should return 2 for "**" prefix', () => {
        expect(derive_banner_level_from_middle_line('** Section Name')).toBe(2);
    });

    it('should return 3 for "***" prefix', () => {
        expect(derive_banner_level_from_middle_line('*** Section Name')).toBe(3);
    });

    it('should return 4 for "****" or more asterisks', () => {
        expect(derive_banner_level_from_middle_line('**** Section Name')).toBe(4);
        expect(derive_banner_level_from_middle_line('***** Section Name')).toBe(4);
    });

    it('should return 1 for single "/" (edge case)', () => {
        expect(derive_banner_level_from_middle_line('/ Section Name')).toBe(1);
    });

    it('should return 1 for empty string', () => {
        expect(derive_banner_level_from_middle_line('')).toBe(1);
    });

    it('should return 1 for whitespace only', () => {
        expect(derive_banner_level_from_middle_line('   ')).toBe(1);
        expect(derive_banner_level_from_middle_line('\t')).toBe(1);
    });

    it('should return 1 for no comment prefix', () => {
        expect(derive_banner_level_from_middle_line('Section Name')).toBe(1);
    });

    it('should handle leading whitespace', () => {
        expect(derive_banner_level_from_middle_line('  // Section')).toBe(1);
        expect(derive_banner_level_from_middle_line('\t/// Section')).toBe(2);
        expect(derive_banner_level_from_middle_line('  * Section')).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// derive_numbered_level()
// ---------------------------------------------------------------------------

describe('derive_numbered_level', () => {
    it('should return 1 for "1."', () => {
        expect(derive_numbered_level('1.')).toBe(1);
    });

    it('should return 2 for "1.1"', () => {
        expect(derive_numbered_level('1.1')).toBe(2);
    });

    it('should return 3 for "1.1.1"', () => {
        expect(derive_numbered_level('1.1.1')).toBe(3);
    });

    it('should return 3 for "2.10.1"', () => {
        expect(derive_numbered_level('2.10.1')).toBe(3);
    });

    it('should return 1 for single number without trailing dot', () => {
        expect(derive_numbered_level('5')).toBe(1);
    });

    it('should handle deep nesting "1.2.3.4" as level 4', () => {
        expect(derive_numbered_level('1.2.3.4')).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Real-world patterns from fertility_surveys
// ---------------------------------------------------------------------------

describe('Real-world patterns from fertility_surveys', () => {
    it('should detect dash banner: confirm proper scope of survey years', () => {
        const my_content = [
            '// ---------------------------------------------------------',
            '// confirm proper scope of survey years',
            '// ---------------------------------------------------------',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('confirm proper scope of survey years');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should detect asterisk banner: MARITAL STATUS', () => {
        const my_content = [
            '*******************************************************************',
            '********************** MARITAL STATUS *****************************',
            '*******************************************************************',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('MARITAL STATUS');
        expect(my_sections[0].detection_type).toBe('banner');
    });

    it('should detect starred inline: 2.10.1 surveys missing timing', () => {
        const my_content = '*** 2.10.1 surveys missing timing of last sexual activity ***';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('2.10.1 surveys missing timing of last sexual activity');
        expect(my_sections[0].detection_type).toBe('starred_inline');
    });

    it('should NOT detect decorative slash line as a section', () => {
        const my_content = '////////////////////////////////////////////////////////////////////////////////';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(0);
    });

    it('should NOT detect decorative asterisk line as a section', () => {
        const my_content = '*************************************************************';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Integration: extract_sections()
// ---------------------------------------------------------------------------

describe('extract_sections', () => {
    it('should return empty array for document with no sections', () => {
        const my_content = [
            'use mydata.dta',
            'gen x = 1',
            'reg y x',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections).toEqual([]);
    });

    it('should return one RawSection for document with one single-line section', () => {
        const my_content = [
            '// Data Loading ----',
            'use mydata.dta',
            'gen x = 1',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Data Loading');
        expect(my_sections[0].detection_type).toBe('single_line');
        expect(my_sections[0].range.start.line).toBe(0);
    });

    it('should return correct count and order for document with mixed types', () => {
        const my_content = [
            '// Setup ----',                          // line 0: single_line
            'use mydata.dta',                          // line 1
            '// ----------------------------------------', // line 2: banner top
            '// Data Processing',                      // line 3: banner middle
            '// ----------------------------------------', // line 4: banner bottom
            'gen x = 1',                               // line 5
            '*** Results ***',                         // line 6: starred_inline
            'reg y x',                                 // line 7
            '* 2.1 Robustness Checks',                // line 8: numbered
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(4);

        expect(my_sections[0].name).toBe('Setup');
        expect(my_sections[0].detection_type).toBe('single_line');
        expect(my_sections[0].range.start.line).toBe(0);

        expect(my_sections[1].name).toBe('Data Processing');
        expect(my_sections[1].detection_type).toBe('banner');
        expect(my_sections[1].range.start.line).toBe(2);

        expect(my_sections[2].name).toBe('Results');
        expect(my_sections[2].detection_type).toBe('starred_inline');
        expect(my_sections[2].range.start.line).toBe(6);

        expect(my_sections[3].name).toBe('2.1 Robustness Checks');
        expect(my_sections[3].detection_type).toBe('numbered');
        expect(my_sections[3].range.start.line).toBe(8);
    });

    it('should respect detection priority: single-line consumed lines skipped by banner', () => {
        // If single-line detection consumes a line, banner detection should skip it.
        // Here, lines 0 and 2 match single-line patterns, which would be
        // consumed. That means lines 0-2 cannot form a banner because
        // lines 0 and 2 are already consumed.
        const my_content = [
            '// Setup ----',                          // line 0: single_line (consumed)
            '// Middle Name',                          // line 1
            '// Cleanup ----',                         // line 2: single_line (consumed)
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // Should get 2 single-line sections, NOT a banner
        expect(my_sections.length).toBe(2);
        expect(my_sections[0].detection_type).toBe('single_line');
        expect(my_sections[1].detection_type).toBe('single_line');
    });

    it('should sort sections by start line', () => {
        const my_content = [
            '*** Alpha ***',           // line 0: starred_inline
            'code here',                // line 1
            '// Beta ----',             // line 2: single_line
            'more code',                // line 3
            '* 3. Gamma',              // line 4: numbered
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(3);
        expect(my_sections[0].range.start.line).toBe(0);
        expect(my_sections[1].range.start.line).toBe(2);
        expect(my_sections[2].range.start.line).toBe(4);
    });

    it('should produce correct range for single-line sections', () => {
        const my_content = '// My Section ----';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].range).toEqual({
            start: { line: 0, character: 0 },
            end: { line: 0, character: my_content.length },
        });
        expect(my_sections[0].selection_range).toEqual({
            start: { line: 0, character: 0 },
            end: { line: 0, character: my_content.length },
        });
    });

    it('should produce correct range for banner sections', () => {
        const my_lines = [
            '// ========================================',
            '// Banner Content',
            '// ========================================',
        ];
        const my_content = my_lines.join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        // Range spans all three lines
        expect(my_sections[0].range.start.line).toBe(0);
        expect(my_sections[0].range.end.line).toBe(2);
        expect(my_sections[0].range.end.character).toBe(my_lines[2].length);
        // Selection range is the middle line
        expect(my_sections[0].selection_range.start.line).toBe(1);
        expect(my_sections[0].selection_range.end.line).toBe(1);
        expect(my_sections[0].selection_range.end.character).toBe(my_lines[1].length);
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
    it('should return empty array for empty document', () => {
        const my_content = '';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections).toEqual([]);
    });

    it('should handle file with only comments and no code', () => {
        const my_content = [
            '// This is a comment',
            '* Another comment',
            '// Yet another comment',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        // None of these are section patterns
        expect(my_sections.length).toBe(0);
    });

    it('should detect section at first line', () => {
        const my_content = [
            '// First Line Section ----',
            'use mydata.dta',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('First Line Section');
        expect(my_sections[0].range.start.line).toBe(0);
    });

    it('should detect section at last line', () => {
        const my_content = [
            'use mydata.dta',
            '// Last Line Section ----',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Last Line Section');
        expect(my_sections[0].range.start.line).toBe(1);
    });

    it('should handle document with only a single line (no newline)', () => {
        const my_content = '** Section Name **';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Section Name');
    });

    it('should handle banner at the very end of document', () => {
        const my_content = [
            'use mydata.dta',
            '// ----------------------------------------',
            '// Final Section',
            '// ----------------------------------------',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('Final Section');
        expect(my_sections[0].detection_type).toBe('banner');
        expect(my_sections[0].range.start.line).toBe(1);
        expect(my_sections[0].range.end.line).toBe(3);
    });

    it('should handle banner at the very beginning of document', () => {
        const my_content = [
            '// ----------------------------------------',
            '// First Section',
            '// ----------------------------------------',
            'use mydata.dta',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(1);
        expect(my_sections[0].name).toBe('First Section');
        expect(my_sections[0].detection_type).toBe('banner');
        expect(my_sections[0].range.start.line).toBe(0);
    });

    it('should handle consecutive sections on adjacent lines', () => {
        const my_content = [
            '// Section A ----',
            '// Section B ----',
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(2);
        expect(my_sections[0].name).toBe('Section A');
        expect(my_sections[1].name).toBe('Section B');
    });

    it('should handle single-line document that is not a section', () => {
        const my_content = 'gen x = 1';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(0);
    });

    it('should not detect numbered section when rest is all delimiters', () => {
        const my_content = '* 2. ****';
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(0);
    });

    it('should handle a large mixed document correctly', () => {
        const my_content = [
            '// Preamble ----',                                            // line 0: single_line
            'clear all',                                                    // line 1
            'set more off',                                                 // line 2
            '*******************************************************************', // line 3: banner top
            '*********************** DATA SETUP ********************************', // line 4: banner middle
            '*******************************************************************', // line 5: banner bottom
            'use mydata.dta, clear',                                        // line 6
            '*** Quality Checks ***',                                       // line 7: starred_inline
            'assert _N > 0',                                                // line 8
            '* 1. Main Analysis',                                           // line 9: numbered level 1
            'reg y x',                                                      // line 10
            '* 1.1 Robustness',                                             // line 11: numbered level 2
            'reg y x z',                                                    // line 12
            '* 1.1.1 Sub-analysis',                                         // line 13: numbered level 3
            'reg y x z w',                                                  // line 14
        ].join('\n');
        const my_offsets = compute_line_offsets(my_content);
        const my_sections = extract_sections(my_content, my_offsets);

        expect(my_sections.length).toBe(6);

        expect(my_sections[0].name).toBe('Preamble');
        expect(my_sections[0].detection_type).toBe('single_line');

        expect(my_sections[1].name).toBe('DATA SETUP');
        expect(my_sections[1].detection_type).toBe('banner');

        expect(my_sections[2].name).toBe('Quality Checks');
        expect(my_sections[2].detection_type).toBe('starred_inline');

        expect(my_sections[3].name).toBe('1. Main Analysis');
        expect(my_sections[3].detection_type).toBe('numbered');
        expect(my_sections[3].level).toBe(1);

        expect(my_sections[4].name).toBe('1.1 Robustness');
        expect(my_sections[4].detection_type).toBe('numbered');
        expect(my_sections[4].level).toBe(2);

        expect(my_sections[5].name).toBe('1.1.1 Sub-analysis');
        expect(my_sections[5].detection_type).toBe('numbered');
        expect(my_sections[5].level).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Level calculation edge cases (derive_level_from_delimiter_count)
// ---------------------------------------------------------------------------

describe('Level calculation edge cases', () => {
    /**
     * Test single-character delimiter counts (1-3 chars) - should map to level 1
     * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
     */
    describe('single-character delimiter counts (should map to level 1)', () => {
        it('should return level 1 for count of 1', () => {
            expect(derive_level_from_delimiter_count(1)).toBe(1);
        });

        it('should return level 1 for count of 2', () => {
            expect(derive_level_from_delimiter_count(2)).toBe(1);
        });

        it('should return level 1 for count of 3', () => {
            expect(derive_level_from_delimiter_count(3)).toBe(1);
        });

        it('should return level 1 for count of 0 (edge case)', () => {
            expect(derive_level_from_delimiter_count(0)).toBe(1);
        });

        it('should return level 1 for negative count (edge case)', () => {
            expect(derive_level_from_delimiter_count(-1)).toBe(1);
        });
    });

    /**
     * Test very large delimiter counts (20+ characters) - should map to level 4
     * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
     */
    describe('very large delimiter counts (should map to level 4)', () => {
        it('should return level 4 for count of 20', () => {
            expect(derive_level_from_delimiter_count(20)).toBe(4);
        });

        it('should return level 4 for count of 50', () => {
            expect(derive_level_from_delimiter_count(50)).toBe(4);
        });

        it('should return level 4 for count of 100', () => {
            expect(derive_level_from_delimiter_count(100)).toBe(4);
        });

        it('should return level 4 for count of 1000', () => {
            expect(derive_level_from_delimiter_count(1000)).toBe(4);
        });
    });

    /**
     * Test matching delimiter counts at each level threshold
     * Level calculation formula:
     * - 4 chars → level 1
     * - 5-7 chars → level 2
     * - 8-11 chars → level 3
     * - 12+ chars → level 4
     * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
     */
    describe('level threshold boundaries', () => {
        // Level 1: count <= 4
        it('should return level 1 for count of 4 (upper boundary of level 1)', () => {
            expect(derive_level_from_delimiter_count(4)).toBe(1);
        });

        // Level 2: 5 <= count <= 7
        it('should return level 2 for count of 5 (lower boundary of level 2)', () => {
            expect(derive_level_from_delimiter_count(5)).toBe(2);
        });

        it('should return level 2 for count of 6 (middle of level 2)', () => {
            expect(derive_level_from_delimiter_count(6)).toBe(2);
        });

        it('should return level 2 for count of 7 (upper boundary of level 2)', () => {
            expect(derive_level_from_delimiter_count(7)).toBe(2);
        });

        // Level 3: 8 <= count <= 11
        it('should return level 3 for count of 8 (lower boundary of level 3)', () => {
            expect(derive_level_from_delimiter_count(8)).toBe(3);
        });

        it('should return level 3 for count of 9 (middle of level 3)', () => {
            expect(derive_level_from_delimiter_count(9)).toBe(3);
        });

        it('should return level 3 for count of 10 (middle of level 3)', () => {
            expect(derive_level_from_delimiter_count(10)).toBe(3);
        });

        it('should return level 3 for count of 11 (upper boundary of level 3)', () => {
            expect(derive_level_from_delimiter_count(11)).toBe(3);
        });

        // Level 4: count >= 12
        it('should return level 4 for count of 12 (lower boundary of level 4)', () => {
            expect(derive_level_from_delimiter_count(12)).toBe(4);
        });

        it('should return level 4 for count of 13', () => {
            expect(derive_level_from_delimiter_count(13)).toBe(4);
        });
    });

    /**
     * Test mismatched delimiter counts - verify minimum is used for level
     * When top and bottom delimiter lines have different counts, the minimum
     * should be used for level determination.
     * _Requirements: 2.5_
     */
    describe('delimiter lengths do not affect banner level (middle line prefix determines level)', () => {
        it('should assign level 1 regardless of mismatched asterisk delimiter lengths', () => {
            // Middle line ` Section Name` has no prefix → level 1
            const my_content = [
                '********************', // line 0: 20 asterisks
                ' Section Name',        // line 1: heading (no prefix)
                '****',                 // line 2: 4 asterisks
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('Section Name');
            expect(my_sections[0].level).toBe(1); // no prefix → level 1
        });

        it('should assign level 1 regardless of equal asterisk delimiter lengths', () => {
            const my_content = [
                '********',             // line 0: 8 asterisks
                ' Section Name',        // line 1: heading (no prefix)
                '********',             // line 2: 8 asterisks
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('Section Name');
            expect(my_sections[0].level).toBe(1); // no prefix → level 1
        });

        it('should assign level 1 regardless of mismatched dash delimiter lengths', () => {
            // Middle line `// Section Name` has `//` prefix → level 1
            const my_content = [
                '// --------',          // line 0: 8 dashes
                '// Section Name',      // line 1: heading (// prefix)
                '// -----',             // line 2: 5 dashes
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('Section Name');
            expect(my_sections[0].level).toBe(1); // // → level 1
        });

        it('should assign level 1 regardless of mismatched equals delimiter lengths', () => {
            const my_content = [
                '// ============',      // line 0: 12 equals
                '// Section Name',      // line 1: heading (// prefix)
                '// ========',          // line 2: 8 equals
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('Section Name');
            expect(my_sections[0].level).toBe(1); // // → level 1
        });
    });

    /**
     * Integration tests for banner level derived from middle line prefix
     * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
     */
    describe('banner level from middle line prefix', () => {
        it('should assign level 1 for no-prefix middle line (long delimiters)', () => {
            const my_content = [
                '*******************************************************************', // 67 asterisks
                ' Section Name',
                '*******************************************************************', // 67 asterisks
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(1); // no prefix → level 1
        });

        it('should assign level 1 for no-prefix middle line (4-char delimiters)', () => {
            const my_content = [
                '****',
                ' Section Name',
                '****',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(1); // no prefix → level 1
        });

        it('should assign level 1 for no-prefix middle line (6-char delimiters)', () => {
            const my_content = [
                '******',
                ' Section Name',
                '******',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(1); // no prefix → level 1
        });

        it('should assign level 1 for no-prefix middle line (10-char delimiters)', () => {
            const my_content = [
                '**********',
                ' Section Name',
                '**********',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(1); // no prefix → level 1
        });

        it('should assign level 1 for no-prefix middle line (block comment pattern)', () => {
            const my_content = [
                '/************',
                ' Section Name',
                '************/',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(1); // no prefix → level 1
        });

        it('should assign level 1 for * middle line prefix', () => {
            const my_content = [
                '****************************',
                '* Section Name',
                '****************************',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(1); // * → level 1
        });

        it('should assign level 2 for ** middle line prefix', () => {
            const my_content = [
                '****************************',
                '** Section Name',
                '****************************',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(2); // ** → level 2
        });

        it('should assign level 3 for *** middle line prefix', () => {
            const my_content = [
                '****************************',
                '*** Section Name',
                '****************************',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(3); // *** → level 3
        });

        it('should assign level 1 for // middle line prefix', () => {
            const my_content = [
                '// ----------------------------------------',
                '// Section Name',
                '// ----------------------------------------',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(1); // // → level 1
        });

        it('should assign level 2 for /// middle line prefix', () => {
            const my_content = [
                '// ----------------------------------------',
                '/// Section Name',
                '// ----------------------------------------',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(2); // /// → level 2
        });

        it('should assign level 3 for //// middle line prefix', () => {
            const my_content = [
                '// ----------------------------------------',
                '//// Section Name',
                '// ----------------------------------------',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].level).toBe(3); // //// → level 3
        });
    });
});




// ---------------------------------------------------------------------------
// List item filtering (numbered section detection with indentation check)
// ---------------------------------------------------------------------------

describe('List item filtering', () => {
    /**
     * Test the specific list pattern from contraceptive_methods.do
     * These indented list items should NOT be detected as sections.
     * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
     */
    describe('contraceptive_methods.do list pattern', () => {
        it('should NOT detect indented list items as sections', () => {
            // This is the exact pattern from contraceptive_methods.do
            // The explanatory comment is followed by indented list items
            const my_content = [
                '// For DHS datasets for round I-III they contain v312, a variable indicating...',
                '    * 0 not using',
                '    * 1 pill',
                '    * 2 iud',
                '    * 3 injections',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // None of the indented list items should be detected as sections
            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect indented list items even with valid numbered patterns', () => {
            // List items that look like numbered sections but are indented
            const my_content = [
                '// Variable codes:',
                '    * 1. not using',
                '    * 2. pill',
                '    * 3. iud',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // None should be detected because they are indented with 4 spaces
            expect(my_sections.length).toBe(0);
        });

        it('should detect numbered sections at column 0 but NOT indented list items', () => {
            // Mix of valid section at column 0 and indented list items
            const my_content = [
                '* 1. Data Setup',                    // line 0: valid section at column 0
                'use mydata.dta',                      // line 1: code
                '// Variable codes:',                  // line 2: comment
                '    * 0 not using',                   // line 3: indented list item
                '    * 1 pill',                        // line 4: indented list item
                '    * 2 iud',                         // line 5: indented list item
                '* 2. Analysis',                       // line 6: valid section at column 0
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // Should detect only the two sections at column 0
            expect(my_sections.length).toBe(2);
            expect(my_sections[0].name).toBe('1. Data Setup');
            expect(my_sections[0].range.start.line).toBe(0);
            expect(my_sections[1].name).toBe('2. Analysis');
            expect(my_sections[1].range.start.line).toBe(6);
        });
    });

    /**
     * Test numbered line with exactly 4 spaces (should NOT detect)
     * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
     */
    describe('numbered line with exactly 4 spaces', () => {
        it('should NOT detect numbered line with exactly 4 spaces of indentation', () => {
            const my_content = '    * 1. Section Name';  // exactly 4 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line with exactly 4 spaces (single digit)', () => {
            const my_content = '    * 0 not using';  // exactly 4 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line with exactly 4 spaces (multi-level)', () => {
            const my_content = '    * 1.1.1 Deep Section';  // exactly 4 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line with exactly 4 spaces (slash comment)', () => {
            const my_content = '    // 1. Section Name';  // exactly 4 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });
    });

    /**
     * Test numbered line with 3 spaces (should detect)
     * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
     */
    describe('numbered line with 3 spaces', () => {
        it('should detect numbered line with 3 spaces of indentation', () => {
            const my_content = '   * 1. Section Name';  // 3 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('1. Section Name');
            expect(my_sections[0].detection_type).toBe('numbered');
            expect(my_sections[0].level).toBe(1);
        });

        it('should detect numbered line with 3 spaces (single digit)', () => {
            const my_content = '   * 5 Analysis';  // 3 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('5 Analysis');
            expect(my_sections[0].detection_type).toBe('numbered');
        });

        it('should detect numbered line with 3 spaces (multi-level)', () => {
            const my_content = '   * 1.1.1 Deep Section';  // 3 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('1.1.1 Deep Section');
            expect(my_sections[0].detection_type).toBe('numbered');
            expect(my_sections[0].level).toBe(3);
        });

        it('should detect numbered line with 3 spaces (slash comment)', () => {
            const my_content = '   // 2.1 Subsection';  // 3 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('2.1 Subsection');
            expect(my_sections[0].detection_type).toBe('numbered');
            expect(my_sections[0].level).toBe(2);
        });

        it('should detect numbered line with 1 space of indentation', () => {
            const my_content = ' * 1. Section Name';  // 1 space
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('1. Section Name');
            expect(my_sections[0].detection_type).toBe('numbered');
        });

        it('should detect numbered line with 2 spaces of indentation', () => {
            const my_content = '  * 1. Section Name';  // 2 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('1. Section Name');
            expect(my_sections[0].detection_type).toBe('numbered');
        });
    });

    /**
     * Test numbered line with tab character (should NOT detect)
     * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
     */
    describe('numbered line with tab character', () => {
        it('should NOT detect numbered line starting with a tab', () => {
            const my_content = '\t* 1. Section Name';  // tab character
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line starting with a tab (single digit)', () => {
            const my_content = '\t* 0 not using';  // tab character
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line starting with a tab (multi-level)', () => {
            const my_content = '\t* 1.1.1 Deep Section';  // tab character
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line starting with a tab (slash comment)', () => {
            const my_content = '\t// 1. Section Name';  // tab character
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line starting with multiple tabs', () => {
            const my_content = '\t\t* 1. Section Name';  // two tabs
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect numbered line with tab followed by spaces', () => {
            const my_content = '\t  * 1. Section Name';  // tab + 2 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });
    });

    /**
     * Test numbered line at column 0 (should detect)
     * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
     */
    describe('numbered line at column 0', () => {
        it('should detect numbered line at column 0 (star comment)', () => {
            const my_content = '* 1. Section Name';  // column 0
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('1. Section Name');
            expect(my_sections[0].detection_type).toBe('numbered');
            expect(my_sections[0].level).toBe(1);
        });

        it('should detect numbered line at column 0 (slash comment)', () => {
            const my_content = '// 1. Section Name';  // column 0
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('1. Section Name');
            expect(my_sections[0].detection_type).toBe('numbered');
            expect(my_sections[0].level).toBe(1);
        });

        it('should detect numbered line at column 0 (single digit)', () => {
            const my_content = '* 5 Analysis';  // column 0
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('5 Analysis');
            expect(my_sections[0].detection_type).toBe('numbered');
        });

        it('should detect numbered line at column 0 (multi-level)', () => {
            const my_content = '* 1.1.1 Deep Section';  // column 0
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('1.1.1 Deep Section');
            expect(my_sections[0].detection_type).toBe('numbered');
            expect(my_sections[0].level).toBe(3);
        });

        it('should detect numbered line at column 0 (complex numbering)', () => {
            const my_content = '// 2.10.1 Complex Numbering';  // column 0
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].name).toBe('2.10.1 Complex Numbering');
            expect(my_sections[0].detection_type).toBe('numbered');
            expect(my_sections[0].level).toBe(3);
        });

        it('should detect multiple numbered lines at column 0', () => {
            const my_content = [
                '* 1. First Section',
                'use mydata.dta',
                '* 1.1 Subsection',
                'gen x = 1',
                '* 2. Second Section',
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(3);
            expect(my_sections[0].name).toBe('1. First Section');
            expect(my_sections[0].level).toBe(1);
            expect(my_sections[1].name).toBe('1.1 Subsection');
            expect(my_sections[1].level).toBe(2);
            expect(my_sections[2].name).toBe('2. Second Section');
            expect(my_sections[2].level).toBe(1);
        });
    });

    /**
     * Edge cases for list item filtering
     * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
     */
    describe('edge cases', () => {
        it('should NOT detect with 5 spaces of indentation', () => {
            const my_content = '     * 1. Section Name';  // 5 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect with 8 spaces of indentation', () => {
            const my_content = '        * 1. Section Name';  // 8 spaces
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should handle mixed valid and invalid indentation in same document', () => {
            const my_content = [
                '* 1. Valid Section',           // line 0: column 0 (valid)
                '    * 2. Invalid Section',     // line 1: 4 spaces (invalid)
                '   * 3. Valid Section',        // line 2: 3 spaces (valid)
                '\t* 4. Invalid Section',       // line 3: tab (invalid)
                '  * 5. Valid Section',         // line 4: 2 spaces (valid)
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(3);
            expect(my_sections[0].name).toBe('1. Valid Section');
            expect(my_sections[0].range.start.line).toBe(0);
            expect(my_sections[1].name).toBe('3. Valid Section');
            expect(my_sections[1].range.start.line).toBe(2);
            expect(my_sections[2].name).toBe('5. Valid Section');
            expect(my_sections[2].range.start.line).toBe(4);
        });

        it('should handle spaces followed by tab (tab not at start)', () => {
            // Any tab in leading whitespace means indented code → not detected
            const my_content = '  \t* 1. Section Name';  // 2 spaces + tab
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(0);
        });

        it('should NOT detect when line is only whitespace followed by numbered pattern', () => {
            // This tests that the pattern still requires the comment marker
            const my_content = '    1. Section Name';  // 4 spaces, no comment marker
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // Should not detect because there's no comment marker (* or //)
            expect(my_sections.length).toBe(0);
        });
    });
});

// ---------------------------------------------------------------------------
// Integration tests for mixed pattern documents
// _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_
// ---------------------------------------------------------------------------

describe('Integration tests for mixed pattern documents', () => {
    /**
     * Test document with all four pattern types
     * Validates that all pattern types are detected correctly in a single document.
     * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
     */
    describe('document with all four pattern types', () => {
        it('should detect all four pattern types in a single document', () => {
            const my_content = [
                '// Preamble ----',                                            // line 0: single_line
                'clear all',                                                    // line 1
                'set more off',                                                 // line 2
                '',                                                             // line 3
                '/********************************************************************', // line 4: block comment top
                ' Data Setup Section',                                          // line 5: block comment middle
                '*******************************************************************/', // line 6: block comment bottom
                '',                                                             // line 7
                'use mydata.dta, clear',                                        // line 8
                '',                                                             // line 9
                '*** Quality Checks ***',                                       // line 10: starred_inline
                'assert _N > 0',                                                // line 11
                '',                                                             // line 12
                '* 1. Main Analysis',                                           // line 13: numbered level 1
                'reg y x',                                                      // line 14
                '',                                                             // line 15
                '* 1.1 Robustness',                                             // line 16: numbered level 2
                'reg y x z',                                                    // line 17
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(5);

            // Single-line section
            expect(my_sections[0].name).toBe('Preamble');
            expect(my_sections[0].detection_type).toBe('single_line');
            expect(my_sections[0].range.start.line).toBe(0);

            // Block comment (banner) section
            expect(my_sections[1].name).toBe('Data Setup Section');
            expect(my_sections[1].detection_type).toBe('banner');
            expect(my_sections[1].range.start.line).toBe(4);
            expect(my_sections[1].range.end.line).toBe(6);

            // Starred inline section
            expect(my_sections[2].name).toBe('Quality Checks');
            expect(my_sections[2].detection_type).toBe('starred_inline');
            expect(my_sections[2].range.start.line).toBe(10);

            // Numbered sections
            expect(my_sections[3].name).toBe('1. Main Analysis');
            expect(my_sections[3].detection_type).toBe('numbered');
            expect(my_sections[3].level).toBe(1);
            expect(my_sections[3].range.start.line).toBe(13);

            expect(my_sections[4].name).toBe('1.1 Robustness');
            expect(my_sections[4].detection_type).toBe('numbered');
            expect(my_sections[4].level).toBe(2);
            expect(my_sections[4].range.start.line).toBe(16);
        });

        it('should detect all four pattern types with standard banner (not block comment)', () => {
            const my_content = [
                '// Setup ----',                                               // line 0: single_line
                'clear all',                                                    // line 1
                '',                                                             // line 2
                '// ----------------------------------------',                  // line 3: banner top
                '// Data Processing',                                           // line 4: banner middle
                '// ----------------------------------------',                  // line 5: banner bottom
                '',                                                             // line 6
                'use mydata.dta',                                               // line 7
                '',                                                             // line 8
                '*** Results ***',                                              // line 9: starred_inline
                'reg y x',                                                      // line 10
                '',                                                             // line 11
                '* 2.1 Robustness Checks',                                      // line 12: numbered
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(4);

            expect(my_sections[0].name).toBe('Setup');
            expect(my_sections[0].detection_type).toBe('single_line');

            expect(my_sections[1].name).toBe('Data Processing');
            expect(my_sections[1].detection_type).toBe('banner');

            expect(my_sections[2].name).toBe('Results');
            expect(my_sections[2].detection_type).toBe('starred_inline');

            expect(my_sections[3].name).toBe('2.1 Robustness Checks');
            expect(my_sections[3].detection_type).toBe('numbered');
        });

        it('should handle all four pattern types with varying nesting levels', () => {
            const my_content = [
                '// Main Setup ----',                                          // line 0: single_line
                '',                                                             // line 1
                '*******************************************************************', // line 2: banner top
                '********************** DATA LOADING *******************************', // line 3: banner middle
                '*******************************************************************', // line 4: banner bottom
                '',                                                             // line 5
                '*** ANALYSIS ***',                                             // line 6: starred_inline
                '',                                                             // line 7
                '* 1. First Section',                                           // line 8: numbered level 1
                '* 1.1 Subsection',                                             // line 9: numbered level 2
                '* 1.1.1 Sub-subsection',                                       // line 10: numbered level 3
                '* 1.1.1.1 Deep section',                                       // line 11: numbered level 4
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(7);

            // Verify detection types
            expect(my_sections[0].name).toBe('Main Setup');
            expect(my_sections[0].detection_type).toBe('single_line');

            expect(my_sections[1].name).toBe('DATA LOADING');
            expect(my_sections[1].detection_type).toBe('banner');

            expect(my_sections[2].name).toBe('ANALYSIS');
            expect(my_sections[2].detection_type).toBe('starred_inline');

            // Verify nesting levels for numbered sections
            expect(my_sections[3].name).toBe('1. First Section');
            expect(my_sections[3].detection_type).toBe('numbered');
            expect(my_sections[3].level).toBe(1);

            expect(my_sections[4].name).toBe('1.1 Subsection');
            expect(my_sections[4].detection_type).toBe('numbered');
            expect(my_sections[4].level).toBe(2);

            expect(my_sections[5].name).toBe('1.1.1 Sub-subsection');
            expect(my_sections[5].detection_type).toBe('numbered');
            expect(my_sections[5].level).toBe(3);

            expect(my_sections[6].name).toBe('1.1.1.1 Deep section');
            expect(my_sections[6].detection_type).toBe('numbered');
            expect(my_sections[6].level).toBe(4);
        });
    });

    /**
     * Test document with overlapping pattern candidates
     * Validates that detection priority is respected and no duplicate detections occur.
     * _Requirements: 4.5, 5.4_
     */
    describe('document with overlapping pattern candidates', () => {
        it('should respect detection priority when patterns could overlap', () => {
            // Single-line pattern takes priority over potential banner detection
            const my_content = [
                '// Setup ----',                                               // line 0: single_line (consumed)
                '// Middle Content',                                            // line 1: could be banner middle
                '// Cleanup ----',                                              // line 2: single_line (consumed)
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // Should get 2 single-line sections, NOT a banner
            expect(my_sections.length).toBe(2);
            expect(my_sections[0].detection_type).toBe('single_line');
            expect(my_sections[0].name).toBe('Setup');
            expect(my_sections[1].detection_type).toBe('single_line');
            expect(my_sections[1].name).toBe('Cleanup');
        });

        it('should not detect banner when delimiter lines are consumed by single-line', () => {
            // Lines that look like banner delimiters but are consumed by single-line detection
            const my_content = [
                '// First ----',                                               // line 0: single_line
                '// Section Name',                                              // line 1
                '// Second ----',                                               // line 2: single_line
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // Lines 0 and 2 are consumed by single-line, so no banner can form
            expect(my_sections.length).toBe(2);
            const my_banners = my_sections.filter(s => s.detection_type === 'banner');
            expect(my_banners.length).toBe(0);
        });

        it('should handle starred inline that could look like banner middle', () => {
            // Starred inline pattern should be detected, not confused with banner
            const my_content = [
                '*** SECTION NAME ***',                                        // line 0: starred_inline
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].detection_type).toBe('starred_inline');
            expect(my_sections[0].name).toBe('SECTION NAME');
        });

        it('should not create duplicate detections for same line', () => {
            // A line that could match multiple patterns should only be detected once
            const my_content = [
                '// ----------------------------------------',                  // line 0: banner top
                '// 1. Section Name',                                           // line 1: could be numbered OR banner middle
                '// ----------------------------------------',                  // line 2: banner bottom
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // Should be detected as banner (higher priority than numbered)
            expect(my_sections.length).toBe(1);
            expect(my_sections[0].detection_type).toBe('banner');
            expect(my_sections[0].name).toBe('1. Section Name');
        });

        it('should handle numbered pattern inside banner context', () => {
            // Numbered pattern on middle line of banner should be extracted as banner name
            const my_content = [
                '// ========================================',                  // line 0: banner top
                '// 2.1 Analysis Section',                                      // line 1: banner middle (numbered-looking name)
                '// ========================================',                  // line 2: banner bottom
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(1);
            expect(my_sections[0].detection_type).toBe('banner');
            expect(my_sections[0].name).toBe('2.1 Analysis Section');
        });

        it('should handle multiple overlapping candidates in sequence', () => {
            const my_content = [
                '// First ----',                                               // line 0: single_line
                '// ----------------------------------------',                  // line 1: banner top
                '// Banner Section',                                            // line 2: banner middle
                '// ----------------------------------------',                  // line 3: banner bottom
                '*** Starred Section ***',                                      // line 4: starred_inline
                '* 1. Numbered Section',                                        // line 5: numbered
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(4);
            expect(my_sections[0].detection_type).toBe('single_line');
            expect(my_sections[1].detection_type).toBe('banner');
            expect(my_sections[2].detection_type).toBe('starred_inline');
            expect(my_sections[3].detection_type).toBe('numbered');
        });
    });

    /**
     * Test document with block comments and regular banners
     * Validates that both block comment headings and standard banners are detected.
     * _Requirements: 4.2, 4.5_
     */
    describe('document with block comments and regular banners', () => {
        it('should detect both block comment headings and standard banners', () => {
            const my_content = [
                '/********************************************************************', // line 0: block comment top
                ' Block Comment Section',                                       // line 1: block comment middle
                '*******************************************************************/', // line 2: block comment bottom
                '',                                                             // line 3
                'use mydata.dta',                                               // line 4
                '',                                                             // line 5
                '// ----------------------------------------',                  // line 6: standard banner top
                '// Standard Banner Section',                                   // line 7: standard banner middle
                '// ----------------------------------------',                  // line 8: standard banner bottom
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(2);

            // Block comment heading
            expect(my_sections[0].name).toBe('Block Comment Section');
            expect(my_sections[0].detection_type).toBe('banner');
            expect(my_sections[0].range.start.line).toBe(0);
            expect(my_sections[0].range.end.line).toBe(2);

            // Standard banner
            expect(my_sections[1].name).toBe('Standard Banner Section');
            expect(my_sections[1].detection_type).toBe('banner');
            expect(my_sections[1].range.start.line).toBe(6);
            expect(my_sections[1].range.end.line).toBe(8);
        });

        it('should detect multiple block comments and banners interleaved', () => {
            const my_content = [
                '/********************************************************************', // line 0
                ' First Block Comment',                                         // line 1
                '*******************************************************************/', // line 2
                '',                                                             // line 3
                '// ========================================',                  // line 4
                '// First Standard Banner',                                     // line 5
                '// ========================================',                  // line 6
                '',                                                             // line 7
                '/********************************************************************', // line 8
                ' Second Block Comment',                                        // line 9
                '*******************************************************************/', // line 10
                '',                                                             // line 11
                '// ----------------------------------------',                  // line 12
                '// Second Standard Banner',                                    // line 13
                '// ----------------------------------------',                  // line 14
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(4);

            expect(my_sections[0].name).toBe('First Block Comment');
            expect(my_sections[0].range.start.line).toBe(0);

            expect(my_sections[1].name).toBe('First Standard Banner');
            expect(my_sections[1].range.start.line).toBe(4);

            expect(my_sections[2].name).toBe('Second Block Comment');
            expect(my_sections[2].range.start.line).toBe(8);

            expect(my_sections[3].name).toBe('Second Standard Banner');
            expect(my_sections[3].range.start.line).toBe(12);
        });

        it('should handle block comments with different delimiter lengths', () => {
            const my_content = [
                '/****',                                                        // line 0: minimal block comment top
                ' Short Block',                                                 // line 1
                '****/',                                                        // line 2: minimal block comment bottom
                '',                                                             // line 3
                '/********************************************************************', // line 4: long block comment top
                ' Long Block Comment Section',                                  // line 5
                '*******************************************************************/', // line 6: long block comment bottom
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(2);

            expect(my_sections[0].name).toBe('Short Block');
            expect(my_sections[0].level).toBe(1); // 4 asterisks → level 1

            expect(my_sections[1].name).toBe('Long Block Comment Section');
            expect(my_sections[1].level).toBe(1); // no prefix → level 1
        });

        it('should handle pure asterisk banners alongside block comments', () => {
            const my_content = [
                '*******************************************************************', // line 0: pure asterisk banner top
                '********************** PURE ASTERISK BANNER ***********************', // line 1
                '*******************************************************************', // line 2: pure asterisk banner bottom
                '',                                                             // line 3
                '/********************************************************************', // line 4: block comment top
                ' Block Comment With Slashes',                                  // line 5
                '*******************************************************************/', // line 6: block comment bottom
            ].join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            expect(my_sections.length).toBe(2);

            expect(my_sections[0].name).toBe('PURE ASTERISK BANNER');
            expect(my_sections[0].range.start.line).toBe(0);

            expect(my_sections[1].name).toBe('Block Comment With Slashes');
            expect(my_sections[1].range.start.line).toBe(4);
        });
    });

    /**
     * Test large document (1000+ lines) with mixed patterns
     * Validates O(N) performance and correct detection in large documents.
     * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
     */
    describe('large document (1000+ lines) with mixed patterns', () => {
        it('should handle large document with 1000+ lines efficiently', () => {
            // Build a large document with mixed patterns
            const the_lines: string[] = [];
            let my_expected_section_count = 0;

            // Add initial single-line section
            the_lines.push('// Initial Setup ----');
            my_expected_section_count++;

            // Add 200 code lines
            for (let my_i = 0; my_i < 200; my_i++) {
                the_lines.push(`gen var${my_i} = ${my_i}`);
            }

            // Add block comment section
            the_lines.push('/********************************************************************');
            the_lines.push(' Data Processing Section');
            the_lines.push('*******************************************************************/');
            my_expected_section_count++;

            // Add 200 more code lines
            for (let my_i = 0; my_i < 200; my_i++) {
                the_lines.push(`replace var${my_i} = var${my_i} + 1`);
            }

            // Add standard banner section
            the_lines.push('// ----------------------------------------');
            the_lines.push('// Analysis Section');
            the_lines.push('// ----------------------------------------');
            my_expected_section_count++;

            // Add 200 more code lines
            for (let my_i = 0; my_i < 200; my_i++) {
                the_lines.push(`reg y var${my_i}`);
            }

            // Add starred inline section
            the_lines.push('*** Results Section ***');
            my_expected_section_count++;

            // Add 200 more code lines
            for (let my_i = 0; my_i < 200; my_i++) {
                the_lines.push(`estimates store model${my_i}`);
            }

            // Add numbered sections
            the_lines.push('* 1. Main Results');
            my_expected_section_count++;
            the_lines.push('* 1.1 Robustness');
            my_expected_section_count++;
            the_lines.push('* 1.1.1 Sensitivity');
            my_expected_section_count++;

            // Add 200 more code lines
            for (let my_i = 0; my_i < 200; my_i++) {
                the_lines.push(`esttab model${my_i}`);
            }

            // Add final section
            the_lines.push('// Cleanup ----');
            my_expected_section_count++;

            const my_content = the_lines.join('\n');
            const my_offsets = compute_line_offsets(my_content);

            // Verify document is large enough
            expect(the_lines.length).toBeGreaterThan(1000);

            // Time the extraction (should be fast due to O(N) complexity)
            const my_start_time = performance.now();
            const my_sections = extract_sections(my_content, my_offsets);
            const my_end_time = performance.now();
            const my_elapsed_ms = my_end_time - my_start_time;

            // Verify correct number of sections detected
            expect(my_sections.length).toBe(my_expected_section_count);

            // Verify sections are in correct order
            expect(my_sections[0].name).toBe('Initial Setup');
            expect(my_sections[0].detection_type).toBe('single_line');

            expect(my_sections[1].name).toBe('Data Processing Section');
            expect(my_sections[1].detection_type).toBe('banner');

            expect(my_sections[2].name).toBe('Analysis Section');
            expect(my_sections[2].detection_type).toBe('banner');

            expect(my_sections[3].name).toBe('Results Section');
            expect(my_sections[3].detection_type).toBe('starred_inline');

            expect(my_sections[4].name).toBe('1. Main Results');
            expect(my_sections[4].detection_type).toBe('numbered');
            expect(my_sections[4].level).toBe(1);

            expect(my_sections[5].name).toBe('1.1 Robustness');
            expect(my_sections[5].detection_type).toBe('numbered');
            expect(my_sections[5].level).toBe(2);

            expect(my_sections[6].name).toBe('1.1.1 Sensitivity');
            expect(my_sections[6].detection_type).toBe('numbered');
            expect(my_sections[6].level).toBe(3);

            expect(my_sections[7].name).toBe('Cleanup');
            expect(my_sections[7].detection_type).toBe('single_line');

            // Performance check: should complete in reasonable time (< 100ms for 1000+ lines)
            // This is a soft check - actual time depends on machine, but O(N) should be fast
            expect(my_elapsed_ms).toBeLessThan(1000); // Very generous limit
        });

        it('should handle large document with many sections', () => {
            // Build a document with many sections (100+ sections)
            const the_lines: string[] = [];
            let my_expected_section_count = 0;

            // Add 50 single-line sections with code between them
            for (let my_i = 0; my_i < 50; my_i++) {
                the_lines.push(`// Section ${my_i} ----`);
                my_expected_section_count++;
                for (let my_j = 0; my_j < 10; my_j++) {
                    the_lines.push(`gen x${my_i}_${my_j} = ${my_i * 10 + my_j}`);
                }
            }

            // Add 25 banner sections
            for (let my_i = 0; my_i < 25; my_i++) {
                the_lines.push('// ----------------------------------------');
                the_lines.push(`// Banner Section ${my_i}`);
                the_lines.push('// ----------------------------------------');
                my_expected_section_count++;
                for (let my_j = 0; my_j < 5; my_j++) {
                    the_lines.push(`reg y x${my_i}_${my_j}`);
                }
            }

            // Add 25 numbered sections
            for (let my_i = 0; my_i < 25; my_i++) {
                the_lines.push(`* ${my_i + 1}. Numbered Section ${my_i}`);
                my_expected_section_count++;
                for (let my_j = 0; my_j < 5; my_j++) {
                    the_lines.push(`summarize x${my_i}_${my_j}`);
                }
            }

            const my_content = the_lines.join('\n');
            const my_offsets = compute_line_offsets(my_content);

            // Verify document has many lines
            expect(the_lines.length).toBeGreaterThan(500);

            const my_sections = extract_sections(my_content, my_offsets);

            // Verify correct number of sections
            expect(my_sections.length).toBe(my_expected_section_count);

            // Verify no duplicate line detections
            const my_start_lines = my_sections.map(s => s.range.start.line);
            const my_unique_start_lines = new Set(my_start_lines);
            expect(my_unique_start_lines.size).toBe(my_start_lines.length);
        });

        it('should handle document with dense section patterns', () => {
            // Document where sections are very close together
            const the_lines: string[] = [];

            // Alternating sections and single code lines
            for (let my_i = 0; my_i < 100; my_i++) {
                if (my_i % 4 === 0) {
                    the_lines.push(`// Section ${my_i} ----`);
                } else if (my_i % 4 === 1) {
                    the_lines.push(`*** Starred ${my_i} ***`);
                } else if (my_i % 4 === 2) {
                    the_lines.push(`* ${my_i}. Numbered`);
                } else {
                    the_lines.push(`gen x${my_i} = ${my_i}`);
                }
            }

            const my_content = the_lines.join('\n');
            const my_offsets = compute_line_offsets(my_content);
            const my_sections = extract_sections(my_content, my_offsets);

            // Should detect 75 sections (100 lines, 25 are code)
            expect(my_sections.length).toBe(75);

            // Verify no duplicate detections
            const my_start_lines = my_sections.map(s => s.range.start.line);
            const my_unique_start_lines = new Set(my_start_lines);
            expect(my_unique_start_lines.size).toBe(my_start_lines.length);
        });

        it('should maintain O(N) performance with increasing document size', () => {
            // Test that doubling document size roughly doubles processing time
            // (within reasonable variance)

            const my_sizes = [500, 1000, 2000];
            const my_times: number[] = [];

            for (const my_size of my_sizes) {
                const the_lines: string[] = [];

                // Add sections every 50 lines
                for (let my_i = 0; my_i < my_size; my_i++) {
                    if (my_i % 50 === 0) {
                        the_lines.push(`// Section ${my_i} ----`);
                    } else {
                        the_lines.push(`gen x${my_i} = ${my_i}`);
                    }
                }

                const my_content = the_lines.join('\n');
                const my_offsets = compute_line_offsets(my_content);

                const my_start_time = performance.now();
                extract_sections(my_content, my_offsets);
                const my_end_time = performance.now();

                my_times.push(my_end_time - my_start_time);
            }

            // Verify that processing time scales roughly linearly
            // Allow for some variance due to system load, JIT compilation, etc.
            // The ratio of times should be roughly proportional to ratio of sizes
            // We just verify that 4x size doesn't take more than 10x time
            const my_ratio = my_times[2] / my_times[0];
            expect(my_ratio).toBeLessThan(10); // Very generous limit for O(N)
        });
    });
});

// ---------------------------------------------------------------------------
// Regression tests for existing patterns (backward compatibility)
// _Requirements: 4.1, 4.2, 4.3, 4.4_
// ---------------------------------------------------------------------------

describe('Regression tests for existing patterns', () => {
    /**
     * Regression tests for single-line section patterns
     * Validates that existing single-line patterns continue to work as before.
     * _Requirements: 4.1_
     */
    describe('single-line section patterns (Requirement 4.1)', () => {
        describe('slash-style patterns (// Section Name delimiter)', () => {
            it('should detect // Section Name ---- (dashes)', () => {
                const my_content = '// Section Name ----';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('single_line');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect // Section Name ==== (equals)', () => {
                const my_content = '// Section Name ====';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('single_line');
            });

            it('should detect // Section Name **** (asterisks)', () => {
                const my_content = '// Section Name ****';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('single_line');
            });

            it('should detect // Section Name ++++ (plus)', () => {
                const my_content = '// Section Name ++++';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('single_line');
            });

            it('should detect // Section Name with long delimiter ----------------------------------------', () => {
                const my_content = '// Data Loading ----------------------------------------';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Data Loading');
                expect(my_sections[0].detection_type).toBe('single_line');
            });

            it('should detect // Section Name with trailing whitespace', () => {
                const my_content = '// Section Name ----   ';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
            });

            it('should detect // Section Name with leading whitespace', () => {
                const my_content = '   // Section Name ----';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
            });
        });

        describe('star-style patterns (* Section Name delimiter)', () => {
            it('should detect * Section Name ---- (dashes)', () => {
                const my_content = '* Section Name ----';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('single_line');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect * Section Name ==== (equals)', () => {
                const my_content = '* Section Name ====';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('single_line');
            });

            it('should detect * Section Name ++++ (plus)', () => {
                const my_content = '* Section Name ++++';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('single_line');
            });

            it('should detect * Section Name with long delimiter ========================================', () => {
                const my_content = '* Analysis Section ========================================';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Analysis Section');
                expect(my_sections[0].detection_type).toBe('single_line');
            });

            it('should detect * Section Name with trailing whitespace', () => {
                const my_content = '* Section Name ----   ';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
            });

            it('should detect * Section Name with leading whitespace', () => {
                const my_content = '   * Section Name ----';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
            });
        });

        describe('various delimiter lengths', () => {
            it('should detect with exactly 4 delimiter characters (minimum)', () => {
                const my_content = '// Section ----';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section');
            });

            it('should NOT detect with only 3 delimiter characters', () => {
                const my_content = '// Section ---';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(0);
            });

            it('should detect with many delimiter characters', () => {
                const my_content = '// Section ================================================================';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section');
            });
        });
    });

    /**
     * Regression tests for banner section patterns
     * Validates that existing banner patterns continue to work as before.
     * _Requirements: 4.2_
     */
    describe('banner section patterns (Requirement 4.2)', () => {
        describe('slash-comment banner patterns (// delimiter / // name / // delimiter)', () => {
            it('should detect // ---- / // Name / // ---- (dashes)', () => {
                const my_content = [
                    '// ----------------------------------------',
                    '// Section Name',
                    '// ----------------------------------------',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('banner');
                expect(my_sections[0].range.start.line).toBe(0);
                expect(my_sections[0].range.end.line).toBe(2);
            });

            it('should detect // ==== / // Name / // ==== (equals)', () => {
                const my_content = [
                    '// ========================================',
                    '// Data Validation',
                    '// ========================================',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Data Validation');
                expect(my_sections[0].detection_type).toBe('banner');
            });

            it('should detect // **** / // Name / // **** (asterisks)', () => {
                const my_content = [
                    '// ****************************************',
                    '// Analysis Section',
                    '// ****************************************',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Analysis Section');
                expect(my_sections[0].detection_type).toBe('banner');
            });

            it('should detect // ++++ / // Name / // ++++ (plus)', () => {
                const my_content = [
                    '// ++++++++++++++++++++++++++++++++++++++++',
                    '// Results Section',
                    '// ++++++++++++++++++++++++++++++++++++++++',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Results Section');
                expect(my_sections[0].detection_type).toBe('banner');
            });
        });

        describe('star-comment banner patterns (* delimiter / * name / * delimiter)', () => {
            it('should detect * ---- / * Name / * ---- (dashes)', () => {
                const my_content = [
                    '* ----------------------------------------',
                    '* Section Name',
                    '* ----------------------------------------',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('banner');
            });

            it('should detect * ==== / * Name / * ==== (equals)', () => {
                const my_content = [
                    '* ========================================',
                    '* Data Processing',
                    '* ========================================',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Data Processing');
                expect(my_sections[0].detection_type).toBe('banner');
            });

            it('should detect * ++++ / * Name / * ++++ (plus)', () => {
                const my_content = [
                    '* ++++++++++++++++++++++++++++++++++++++++',
                    '* Cleanup Section',
                    '* ++++++++++++++++++++++++++++++++++++++++',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Cleanup Section');
                expect(my_sections[0].detection_type).toBe('banner');
            });
        });

        describe('pure delimiter banner patterns (all same character)', () => {
            it('should detect pure asterisk banner (**** / * Name * / ****)', () => {
                const my_content = [
                    '*******************************************************************',
                    '********************** MARITAL STATUS *****************************',
                    '*******************************************************************',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('MARITAL STATUS');
                expect(my_sections[0].detection_type).toBe('banner');
            });

            it('should detect pure slash banner (//// / // Name // / ////)', () => {
                const my_content = [
                    '/////////////////////////////////////////////////////',
                    '/////Creating a variable for contraceptive usage///////',
                    '///////////////////////////////////////////////////////',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Creating a variable for contraceptive usage');
                expect(my_sections[0].detection_type).toBe('banner');
            });
        });

        describe('banner selection range', () => {
            it('should set selection_range to the middle line (name line)', () => {
                const my_lines = [
                    '// ========================================',
                    '// Banner Content',
                    '// ========================================',
                ];
                const my_content = my_lines.join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                // Selection range is the middle line
                expect(my_sections[0].selection_range.start.line).toBe(1);
                expect(my_sections[0].selection_range.end.line).toBe(1);
                expect(my_sections[0].selection_range.end.character).toBe(my_lines[1].length);
            });
        });
    });

    /**
     * Regression tests for starred inline section patterns
     * Validates that existing starred inline patterns continue to work as before.
     * _Requirements: 4.3_
     */
    describe('starred inline section patterns (Requirement 4.3)', () => {
        describe('double asterisk patterns (** Name **)', () => {
            it('should detect ** Section Name **', () => {
                const my_content = '** Section Name **';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('starred_inline');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect ** Quality Checks **', () => {
                const my_content = '** Quality Checks **';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Quality Checks');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });
        });

        describe('triple asterisk patterns (*** Name ***)', () => {
            it('should detect *** Section Name ***', () => {
                const my_content = '*** Section Name ***';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });

            it('should detect *** MARITAL STATUS ***', () => {
                const my_content = '*** MARITAL STATUS ***';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('MARITAL STATUS');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });

            it('should detect *** 2.10.1 surveys missing timing of last sexual activity ***', () => {
                const my_content = '*** 2.10.1 surveys missing timing of last sexual activity ***';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('2.10.1 surveys missing timing of last sexual activity');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });
        });

        describe('various asterisk counts', () => {
            it('should detect **** Section Name **** (4 asterisks)', () => {
                const my_content = '**** Section Name ****';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });

            it('should detect ************** Section ************** (many asterisks)', () => {
                const my_content = '************** Section **************';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });

            it('should NOT detect * Section Name * (single asterisk each side)', () => {
                const my_content = '* Section Name *';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                // Single asterisk each side is not a starred inline pattern
                const my_starred = my_sections.filter(s => s.detection_type === 'starred_inline');
                expect(my_starred.length).toBe(0);
            });
        });

        describe('asymmetric asterisk counts', () => {
            it('should detect ** Section Name *** (different counts)', () => {
                const my_content = '** Section Name ***';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });

            it('should detect *** Section Name ** (different counts reversed)', () => {
                const my_content = '*** Section Name **';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
                expect(my_sections[0].detection_type).toBe('starred_inline');
            });
        });

        describe('starred inline with whitespace', () => {
            it('should detect with leading whitespace', () => {
                const my_content = '   *** Section Name ***';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
            });

            it('should detect with trailing whitespace', () => {
                const my_content = '*** Section Name ***   ';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('Section Name');
            });
        });
    });

    /**
     * Regression tests for numbered section patterns (without indentation)
     * Validates that existing numbered patterns continue to work as before.
     * _Requirements: 4.4_
     */
    describe('numbered section patterns (Requirement 4.4)', () => {
        describe('star-comment numbered patterns (* N. Name)', () => {
            it('should detect * 1. Setup as level 1', () => {
                const my_content = '* 1. Setup';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1. Setup');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect * 1.1 Analysis as level 2', () => {
                const my_content = '* 1.1 Analysis';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1.1 Analysis');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(2);
            });

            it('should detect * 1.1.1 Details as level 3', () => {
                const my_content = '* 1.1.1 Details';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1.1.1 Details');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(3);
            });

            it('should detect * 1.1.1.1 Deep Section as level 4', () => {
                const my_content = '* 1.1.1.1 Deep Section';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1.1.1.1 Deep Section');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(4);
            });
        });

        describe('slash-comment numbered patterns (// N. Name)', () => {
            it('should detect // 1. Setup as level 1', () => {
                const my_content = '// 1. Setup';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1. Setup');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect // 1.1 Analysis as level 2', () => {
                const my_content = '// 1.1 Analysis';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1.1 Analysis');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(2);
            });

            it('should detect // 2.10.1 Complex as level 3', () => {
                const my_content = '// 2.10.1 Complex';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('2.10.1 Complex');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(3);
            });
        });

        describe('various numbering formats', () => {
            it('should detect single digit without trailing dot: * 5 Analysis', () => {
                const my_content = '* 5 Analysis';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('5 Analysis');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect double digit: * 10. Section', () => {
                const my_content = '* 10. Section';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('10. Section');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect complex numbering: * 2.10.15 Complex Numbering', () => {
                const my_content = '* 2.10.15 Complex Numbering';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('2.10.15 Complex Numbering');
                expect(my_sections[0].detection_type).toBe('numbered');
                expect(my_sections[0].level).toBe(3);
            });

            it('should detect with trailing dot in number: * 1. Section', () => {
                const my_content = '* 1. Section';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1. Section');
                expect(my_sections[0].level).toBe(1);
            });

            it('should detect without trailing dot in number: * 1 Section', () => {
                const my_content = '* 1 Section';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1 Section');
                expect(my_sections[0].level).toBe(1);
            });
        });

        describe('numbered sections at column 0 (valid headings)', () => {
            it('should detect numbered section at column 0', () => {
                const my_content = '* 1. Main Analysis';
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(1);
                expect(my_sections[0].name).toBe('1. Main Analysis');
            });

            it('should detect multiple numbered sections at column 0', () => {
                const my_content = [
                    '* 1. First Section',
                    'use mydata.dta',
                    '* 1.1 Subsection',
                    'gen x = 1',
                    '* 2. Second Section',
                ].join('\n');
                const my_offsets = compute_line_offsets(my_content);
                const my_sections = extract_sections(my_content, my_offsets);

                expect(my_sections.length).toBe(3);
                expect(my_sections[0].name).toBe('1. First Section');
                expect(my_sections[0].level).toBe(1);
                expect(my_sections[1].name).toBe('1.1 Subsection');
                expect(my_sections[1].level).toBe(2);
                expect(my_sections[2].name).toBe('2. Second Section');
                expect(my_sections[2].level).toBe(1);
            });
        });
    });
});

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
    classify_delimiter_line,
    extract_banner_name,
    derive_numbered_level,
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

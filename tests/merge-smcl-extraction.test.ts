import { test, expect, describe } from 'bun:test';
import {
    extract_commands_from_content,
    extract_options_from_section,
    extract_options_section
} from '../src/command-database/smcl-extractor.js';

/**
 * Realistic merge.sthlp content simulating the actual Stata help file structure.
 * This includes all 12 documented merge options with proper SMCL formatting.
 */
const MERGE_STHLP_REALISTIC = [
    '{smcl}',
    '{* *! version 1.2.0  15jul2024}{...}',
    '{viewerdialog merge "dialog merge"}',
    '{vieweralsosee "[D] merge" "mansection D merge"}{...}',
    '{vieweralsosee "" "--"}{...}',
    '{vieweralsosee "[D] append" "help append"}{...}',
    '{vieweralsosee "[D] joinby" "help joinby"}{...}',
    '{p2col:{bf:[D] merge} {hline 2}}Merge datasets{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:merge} {it:varlist} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:merge} {cmd:1:1} {it:varlist} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:merge} {cmd:1:m} {it:varlist} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:merge} {cmd:m:1} {it:varlist} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:merge} {cmd:m:m} {it:varlist} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{marker options}{...}',
    '{title:Options}',
    '',
    '{synoptset 20 tabbed}{...}',
    '{synopthdr}',
    '{synoptline}',
    '{syntab:Main}',
    '{synopt:{opt keepusing(varlist)}}keep only specified variables from using data{p_end}',
    '{synopt:{opth g:enerate(newvar)}}create merge result variable{p_end}',
    '{synopt:{opt nogenerate}}do not create merge result variable{p_end}',
    '',
    '{syntab:Options}',
    '{synopt:{opt nol:abel}}do not copy value labels from using data{p_end}',
    '{synopt:{opt nonotes}}do not copy notes from using data{p_end}',
    '{synopt:{opt update}}update missing values in master with using{p_end}',
    '{synopt:{opt replace}}replace all values in master with using{p_end}',
    '',
    '{syntab:Reporting}',
    '{synopt:{opt nor:eport}}do not display merge table{p_end}',
    '{synopt:{opt force}}allow string/numeric type mismatches{p_end}',
    '',
    '{syntab:Advanced}',
    '{synopt:{opth assert(merge_results)}}require specified merge results{p_end}',
    '{synopt:{opth keep(merge_results)}}keep only specified merge results{p_end}',
    '{synopt:{opt sorted}}data are already sorted on merge variables{p_end}',
    '{synoptline}',
    '{p2colreset}{...}',
    '',
    '{marker description}{...}',
    '{title:Description}',
    '',
    '{pstd}',
    '{cmd:merge} joins corresponding observations from the dataset currently in memory',
    '(called the master dataset) with those from {it:filename} (called the using dataset).',
    'The result is a new dataset containing information from both datasets.',
    '',
    '{marker examples}{...}',
    '{title:Examples}',
    '',
    '{pstd}One-to-one merge on variable {cmd:id}{p_end}',
    '{phang2}{cmd:. merge 1:1 id using mydata}{p_end}',
    '',
    '{pstd}Many-to-one merge with options{p_end}',
    '{phang2}{cmd:. merge m:1 country year using countrydata, keep(match master) noreport}{p_end}',
    ''
].join('\n');

/**
 * Alternative SMCL format test - some help files use different paragraph formatting
 */
const MERGE_ALTERNATIVE_FORMAT = [
    '{smcl}',
    '{viewerdialog merge "dialog merge"}',
    '{p2col:{bf:[D] merge} {hline 2}}Merge datasets{p_end}',
    '',
    '{marker syntax}',
    '{title:Syntax}',
    '{cmd:merge} {it:varlist} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{title:Options}',
    '',
    '{p 4 8 2}{opt keepusing(varlist)} keep only specified variables{p_end}',
    '{p 4 8 2}{opth g:enerate(newvar)} create merge result variable{p_end}',
    '{p 4 8 2}{opt nogenerate} do not create merge result variable{p_end}',
    '{p 4 8 2}{opt nol:abel} do not copy value labels{p_end}',
    '{p 4 8 2}{opt nonotes} do not copy notes{p_end}',
    '{p 4 8 2}{opt update} update missing values{p_end}',
    '{p 4 8 2}{opt replace} replace all values{p_end}',
    '{p 4 8 2}{opt nor:eport} do not display merge table{p_end}',
    '{p 4 8 2}{opt force} allow type mismatches{p_end}',
    '{p 4 8 2}{opth assert(merge_results)} require specified results{p_end}',
    '{p 4 8 2}{opth keep(merge_results)} keep only specified results{p_end}',
    '{p 4 8 2}{opt sorted} data are already sorted{p_end}',
    ''
].join('\n');

/**
 * Test with {dlgtab:} format that some help files use
 */
const MERGE_DLGTAB_FORMAT = [
    '{smcl}',
    '{viewerdialog merge "dialog merge"}',
    '{p2col:{bf:[D] merge} {hline 2}}Merge datasets{p_end}',
    '',
    '{marker syntax}',
    '{title:Syntax}',
    '{cmd:merge} {it:varlist} {cmd:using} {it:filename}',
    '',
    '{dlgtab:Options}',
    '',
    '{synopt:{opt keepusing(varlist)}}keep specified variables{p_end}',
    '{synopt:{opth g:enerate(newvar)}}create result variable{p_end}',
    '{synopt:{opt nogenerate}}do not create result variable{p_end}',
    '{synopt:{opt nol:abel}}do not copy labels{p_end}',
    '{synopt:{opt nonotes}}do not copy notes{p_end}',
    '{synopt:{opt update}}update missing values{p_end}',
    '{synopt:{opt replace}}replace all values{p_end}',
    '{synopt:{opt nor:eport}}do not display table{p_end}',
    '{synopt:{opt force}}allow mismatches{p_end}',
    '{synopt:{opth assert(merge_results)}}require results{p_end}',
    '{synopt:{opth keep(merge_results)}}keep results{p_end}',
    '{synopt:{opt sorted}}data already sorted{p_end}',
    '',
    '{dlgtab:Examples}',
    'Some examples here...',
    ''
].join('\n');

describe('Enhanced SMCL Extraction - Merge Command Test', () => {
    test('extracts merge command with all 12 documented options', () => {
        const result = extract_commands_from_content(
            MERGE_STHLP_REALISTIC,
            'merge.sthlp'
        );

        // Verify merge command is extracted
        expect(result.commands).toHaveLength(1);
        const merge_command = result.commands[0];
        expect(merge_command.name).toBe('merge');
        expect(merge_command.is_primary).toBe(true);
        expect(merge_command.source_file).toBe('merge.sthlp');

        // Verify all 12 options are extracted
        const option_names = merge_command.options.map(opt => opt.name);
        expect(option_names).toContain('keepusing');
        expect(option_names).toContain('generate');
        expect(option_names).toContain('nogenerate');
        expect(option_names).toContain('nolabel');
        expect(option_names).toContain('nonotes');
        expect(option_names).toContain('update');
        expect(option_names).toContain('replace');
        expect(option_names).toContain('noreport');
        expect(option_names).toContain('force');
        expect(option_names).toContain('assert');
        expect(option_names).toContain('keep');
        expect(option_names).toContain('sorted');

        expect(merge_command.options).toHaveLength(12);
        expect(result.warnings).toHaveLength(0);
    });

    test('correctly extracts option abbreviations and argument types', () => {
        const result = extract_commands_from_content(
            MERGE_STHLP_REALISTIC,
            'merge.sthlp'
        );

        const merge_command = result.commands[0];
        const options_by_name = new Map(
            merge_command.options.map(opt => [opt.name, opt])
        );

        // Test abbreviations
        expect(options_by_name.get('generate')?.min_abbreviation).toBe(1); // g:enerate
        expect(options_by_name.get('nolabel')?.min_abbreviation).toBe(3); // nol:abel
        expect(options_by_name.get('noreport')?.min_abbreviation).toBe(3); // nor:eport

        // Test options without abbreviations (full name required)
        expect(options_by_name.get('keepusing')?.min_abbreviation).toBe(9); // full name
        expect(options_by_name.get('nogenerate')?.min_abbreviation).toBe(10); // full name
        expect(options_by_name.get('sorted')?.min_abbreviation).toBe(6); // full name

        // Test argument types
        expect(options_by_name.get('keepusing')?.has_argument).toBe(true);
        expect(options_by_name.get('keepusing')?.argument_type).toBe('varlist');
        expect(options_by_name.get('generate')?.has_argument).toBe(true);
        expect(options_by_name.get('generate')?.argument_type).toBe('newvar');
        expect(options_by_name.get('assert')?.has_argument).toBe(true);
        expect(options_by_name.get('assert')?.argument_type).toBe('merge_results');

        // Test options without arguments
        expect(options_by_name.get('nogenerate')?.has_argument).toBe(false);
        expect(options_by_name.get('update')?.has_argument).toBe(false);
        expect(options_by_name.get('force')?.has_argument).toBe(false);
    });

    test('handles alternative paragraph formatting', () => {
        const result = extract_commands_from_content(
            MERGE_ALTERNATIVE_FORMAT,
            'merge_alt.sthlp'
        );

        const merge_command = result.commands[0];
        expect(merge_command.name).toBe('merge');
        
        // Should still extract all 12 options
        const option_names = merge_command.options.map(opt => opt.name);
        expect(option_names).toHaveLength(12);
        expect(option_names).toContain('keepusing');
        expect(option_names).toContain('generate');
        expect(option_names).toContain('sorted');
    });

    test('handles dlgtab format correctly', () => {
        const result = extract_commands_from_content(
            MERGE_DLGTAB_FORMAT,
            'merge_dlgtab.sthlp'
        );

        const merge_command = result.commands[0];
        expect(merge_command.name).toBe('merge');
        
        // Should extract all 12 options and stop at {dlgtab:Examples}
        const option_names = merge_command.options.map(opt => opt.name);
        expect(option_names).toHaveLength(12);
        expect(option_names).toContain('keepusing');
        expect(option_names).toContain('sorted');
        
        // Should not include content from Examples section
        const descriptions = merge_command.options.map(opt => opt.description);
        expect(descriptions.some(desc => desc.includes('Some examples here'))).toBe(false);
    });

    test('extracts options section correctly', () => {
        const options_section = extract_options_section(MERGE_STHLP_REALISTIC);
        
        // Should contain the options content
        expect(options_section).toContain('{synopt:{opt keepusing(varlist)}}');
        expect(options_section).toContain('{synopt:{opt sorted}}');
        
        // Should not contain content from other sections
        expect(options_section).not.toContain('{marker description}');
        expect(options_section).not.toContain('{marker examples}');
        expect(options_section).not.toContain('One-to-one merge');
    });

    test('extracts options from section with proper deduplication', () => {
        // Test content with duplicate options (should keep first occurrence)
        const duplicate_content = `
{title:Options}

{synopt:{opt keepusing(varlist)}}keep specified variables{p_end}
{synopt:{opt generate(newvar)}}create result variable{p_end}
{synopt:{opt keepusing(varlist)}}duplicate entry should be ignored{p_end}
{synopt:{opt force}}allow mismatches{p_end}
        `;
        
        const extracted_options = extract_options_from_section(duplicate_content);
        const option_names = extracted_options.map(opt => opt.name);
        
        // Should have 3 unique options (keepusing should appear only once)
        expect(extracted_options).toHaveLength(3);
        expect(option_names).toContain('keepusing');
        expect(option_names).toContain('generate');
        expect(option_names).toContain('force');
        
        // First occurrence should be kept
        const keepusing_option = extracted_options.find(opt => opt.name === 'keepusing');
        expect(keepusing_option?.description).toContain('keep specified variables');
        expect(keepusing_option?.description).not.toContain('duplicate entry');
    });

    test('end-to-end extraction pipeline works correctly', () => {
        // Test the complete extraction pipeline
        const result = extract_commands_from_content(
            MERGE_STHLP_REALISTIC,
            'merge.sthlp'
        );

        // Command extraction
        expect(result.commands).toHaveLength(1);
        expect(result.warnings).toHaveLength(0);
        
        const merge_command = result.commands[0];
        
        // Basic command properties
        expect(merge_command.name).toBe('merge');
        expect(merge_command.is_primary).toBe(true);
        expect(merge_command.source_file).toBe('merge.sthlp');
        expect(merge_command.min_abbreviation).toBe(5); // full name required
        
        // Syntax extraction is deprecated - syntax field should be undefined
        expect(merge_command.syntax).toBeUndefined();
        
        // Description extraction
        expect(merge_command.description).toContain('Merge datasets');
        
        // Options extraction - verify specific critical options
        const options_by_name = new Map(
            merge_command.options.map(opt => [opt.name, opt])
        );
        
        // Critical merge options that must be present
        const critical_options = [
            'keepusing', 'generate', 'nogenerate', 'update', 'replace',
            'force', 'assert', 'keep', 'sorted', 'nolabel', 'nonotes', 'noreport'
        ];
        
        for (const option_name of critical_options) {
            expect(options_by_name.has(option_name)).toBe(true);
        }
        
        // Verify option details for key options
        expect(options_by_name.get('keepusing')?.has_argument).toBe(true);
        expect(options_by_name.get('keepusing')?.argument_type).toBe('varlist');
        expect(options_by_name.get('generate')?.min_abbreviation).toBe(1);
        expect(options_by_name.get('force')?.has_argument).toBe(false);
    });

    test('handles malformed option patterns gracefully', () => {
        const malformed_content = `
{title:Options}

{synopt:{opt keepusing(varlist)}}valid option{p_end}
{synopt:{opt}}malformed - no name{p_end}
{synopt:{opt invalid(}}malformed - unclosed paren{p_end}
{synopt:{opt generate(newvar)}}another valid option{p_end}
{synopt:{opt :invalid}}malformed - no name before colon{p_end}
        `;
        
        const extracted_options = extract_options_from_section(malformed_content);
        
        // Should extract only valid options, skip malformed ones
        expect(extracted_options).toHaveLength(2);
        const option_names = extracted_options.map(opt => opt.name);
        expect(option_names).toContain('keepusing');
        expect(option_names).toContain('generate');
    });
});
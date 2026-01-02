import { test, expect, describe } from 'bun:test';
import {
    extract_commands_from_content,
    extract_viewerdialog_commands,
    extract_cmdab_patterns,
    extract_syntax_section,
    extract_primary_command,
    extract_cmd_patterns
} from '../../src/command-database/smcl-extractor.js';

// ============================================================================
// Mock SMCL Content for Multi-Command Files
// ============================================================================

/**
 * Mock content simulating generate.sthlp which documents both
 * generate and replace commands.
 */
const GENERATE_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "generate" "dialog generate"}',
    '{viewerdialog "replace" "dialog replace"}',
    '{vieweralsosee "[D] generate" "mansection D generate"}{...}',
    '{p2col:{bf:[D] generate} {hline 2}}Create or change contents of variable{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{opt g:enerate} [{it:type}] {newvar}[{cmd::}{it:lblname}] {cmd:=}{it:exp} {ifin}',
    '',
    '{p 8 14 2}',
    '{cmd:replace} {it:oldvar} {cmd:=}{it:exp} {ifin} [{cmd:,} {opt nopromote}]',
    '',
    '{pstd}',
    '{cmd:generate} creates a new variable.  {cmd:replace} changes the contents',
    'of an existing variable.'
].join('\n');

/**
 * Mock content simulating drop.sthlp which documents both
 * drop and keep commands.
 */
const DROP_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "drop" "dialog drop"}',
    '{viewerdialog "keep" "dialog keep"}',
    '{vieweralsosee "[D] drop" "mansection D drop"}{...}',
    '{p2col:{bf:[D] drop} {hline 2}}Drop or keep observations and variables{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:drop} {varlist}',
    '',
    '{p 8 14 2}',
    '{cmd:drop} {ifin}',
    '',
    '{p 8 14 2}',
    '{cmd:keep} {varlist}',
    '',
    '{p 8 14 2}',
    '{cmd:keep} {ifin}',
    '',
    '{pstd}',
    '{cmd:drop} eliminates variables or observations from the data.',
    '{cmd:keep} does the opposite.'
].join('\n');


/**
 * Mock content simulating macro.sthlp which documents
 * local, global, tempvar, tempname, tempfile commands.
 */
const MACRO_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "local" "dialog local"}',
    '{viewerdialog "global" "dialog global"}',
    '{viewerdialog "tempvar" "dialog tempvar"}',
    '{viewerdialog "tempname" "dialog tempname"}',
    '{viewerdialog "tempfile" "dialog tempfile"}',
    '{vieweralsosee "[P] macro" "mansection P macro"}{...}',
    '{p2col:{bf:[P] macro} {hline 2}}Macro definition and manipulation{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmdab:loc:al} {it:lclname} [{cmd:=} {it:exp}]',
    '',
    '{p 8 14 2}',
    '{cmdab:gl:obal} {it:glbname} [{cmd:=} {it:exp}]',
    '',
    '{p 8 14 2}',
    '{cmd:tempvar} {it:lclname} [{it:lclname} ...]',
    '',
    '{p 8 14 2}',
    '{cmd:tempname} {it:lclname} [{it:lclname} ...]',
    '',
    '{p 8 14 2}',
    '{cmd:tempfile} {it:lclname} [{it:lclname} ...]',
    '',
    '{pstd}',
    '{cmd:local} and {cmd:global} define macros.'
].join('\n');

/**
 * Mock content simulating by.sthlp which documents
 * by and bysort commands.
 */
const BY_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "by" "dialog by"}',
    '{viewerdialog "bysort" "dialog bysort"}',
    '{vieweralsosee "[D] by" "mansection D by"}{...}',
    '{p2col:{bf:[D] by} {hline 2}}Repeat Stata command on subsets of the data{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:by} {varlist}{cmd::} {it:stata_cmd}',
    '',
    '{p 8 14 2}',
    '{cmdab:bys:ort} {varlist}{cmd::} {it:stata_cmd}',
    '',
    '{pstd}',
    '{cmd:by} repeats a Stata command for each group of observations.'
].join('\n');

/**
 * Mock content simulating quietly.sthlp which documents
 * quietly and noisily commands.
 */
const QUIETLY_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "quietly" "dialog quietly"}',
    '{viewerdialog "noisily" "dialog noisily"}',
    '{vieweralsosee "[P] quietly" "mansection P quietly"}{...}',
    '{p2col:{bf:[P] quietly} {hline 2}}Quietly and noisily perform Stata command{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmdab:qui:etly} [{cmd::}] {it:stata_cmd}',
    '',
    '{p 8 14 2}',
    '{cmdab:n:oisily} [{cmd::}] {it:stata_cmd}',
    '',
    '{pstd}',
    '{cmd:quietly} suppresses output. {cmd:noisily} restores output.'
].join('\n');

/**
 * Mock content simulating if.sthlp which documents
 * if and else commands.
 */
const IF_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "if" "dialog if"}',
    '{viewerdialog "else" "dialog else"}',
    '{vieweralsosee "[P] if" "mansection P if"}{...}',
    '{p2col:{bf:[P] if} {hline 2}}if programming command{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:if} {it:exp} {cmd:{c -(}}{it:stata_cmds}{cmd:{c )-}}',
    '',
    '{p 8 14 2}',
    '{cmd:else} {cmd:{c -(}}{it:stata_cmds}{cmd:{c )-}}',
    '',
    '{pstd}',
    '{cmd:if} and {cmd:else} are programming commands for conditional execution.'
].join('\n');

/**
 * Mock content simulating do.sthlp which documents
 * do and run commands.
 */
const DO_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "do" "dialog do"}',
    '{viewerdialog "run" "dialog run"}',
    '{vieweralsosee "[R] do" "mansection R do"}{...}',
    '{p2col:{bf:[R] do} {hline 2}}Execute commands from a file{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:do} {it:filename} [{it:arguments}] [{cmd:,} {opt nostop}]',
    '',
    '{p 8 14 2}',
    '{cmd:run} {it:filename} [{it:arguments}] [{cmd:,} {opt nostop}]',
    '',
    '{pstd}',
    '{cmd:do} executes commands from a do-file. {cmd:run} does the same silently.'
].join('\n');

/**
 * Mock content simulating preserve.sthlp which documents
 * preserve and restore commands.
 */
const PRESERVE_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "preserve" "dialog preserve"}',
    '{viewerdialog "restore" "dialog restore"}',
    '{vieweralsosee "[P] preserve" "mansection P preserve"}{...}',
    '{p2col:{bf:[P] preserve} {hline 2}}Preserve and restore data{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:preserve} [{cmd:,} {opt changed}]',
    '',
    '{p 8 14 2}',
    '{cmd:restore} [{cmd:,} {opt not} | {opt preserve}]',
    '',
    '{pstd}',
    '{cmd:preserve} saves a copy of the data. {cmd:restore} restores it.'
].join('\n');

/**
 * Mock content simulating encode.sthlp which documents
 * encode and decode commands.
 */
const ENCODE_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "encode" "dialog encode"}',
    '{viewerdialog "decode" "dialog decode"}',
    '{vieweralsosee "[D] encode" "mansection D encode"}{...}',
    '{p2col:{bf:[D] encode} {hline 2}}Encode string into numeric and vice versa{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:encode} {varname} [{ifin}]{cmd:,} {opth g:enerate(newvar)} [{it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:decode} {varname} [{ifin}]{cmd:,} {opth g:enerate(newvar)} [{it:options}]',
    '',
    '{pstd}',
    '{cmd:encode} converts string to numeric. {cmd:decode} does the reverse.'
].join('\n');

/**
 * Mock content simulating destring.sthlp which documents
 * destring and tostring commands.
 */
const DESTRING_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "destring" "dialog destring"}',
    '{viewerdialog "tostring" "dialog tostring"}',
    '{vieweralsosee "[D] destring" "mansection D destring"}{...}',
    '{p2col:{bf:[D] destring} {hline 2}}Convert string variables to numeric and vice versa{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:destring} {varlist} {cmd:,} {{opth g:enerate(newvarlist)}|{opt replace}} [{it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:tostring} {varlist} {cmd:,} {{opth g:enerate(newvarlist)}|{opt replace}} [{it:options}]',
    '',
    '{pstd}',
    '{cmd:destring} converts string to numeric. {cmd:tostring} does the reverse.'
].join('\n');

/**
 * Mock content simulating correlate.sthlp which documents
 * correlate and pwcorr commands.
 */
const CORRELATE_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "correlate" "dialog correlate"}',
    '{viewerdialog "pwcorr" "dialog pwcorr"}',
    '{vieweralsosee "[R] correlate" "mansection R correlate"}{...}',
    '{p2col:{bf:[R] correlate} {hline 2}}Correlations of variables{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmdab:cor:relate} [{varlist}] {ifin} [{weight}] [{cmd:,} {it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:pwcorr} [{varlist}] {ifin} [{weight}] [{cmd:,} {it:options}]',
    '',
    '{pstd}',
    '{cmd:correlate} displays correlation matrix. {cmd:pwcorr} displays pairwise correlations.'
].join('\n');

/**
 * Mock content simulating cd.sthlp which documents
 * cd and pwd commands.
 */
const CD_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "cd" "dialog cd"}',
    '{viewerdialog "pwd" "dialog pwd"}',
    '{vieweralsosee "[D] cd" "mansection D cd"}{...}',
    '{p2col:{bf:[D] cd} {hline 2}}Change directory{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:cd} [{it:directory_name}]',
    '',
    '{p 8 14 2}',
    '{cmd:pwd}',
    '',
    '{pstd}',
    '{cmd:cd} changes the current working directory. {cmd:pwd} displays it.'
].join('\n');

/**
 * Mock content simulating log.sthlp which documents
 * log and cmdlog commands.
 */
const LOG_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "log" "dialog log"}',
    '{viewerdialog "cmdlog" "dialog cmdlog"}',
    '{vieweralsosee "[R] log" "mansection R log"}{...}',
    '{p2col:{bf:[R] log} {hline 2}}Echo copy of session to file{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:log} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{p 8 14 2}',
    '{cmd:cmdlog} {cmd:using} {it:filename} [{cmd:,} {it:options}]',
    '',
    '{pstd}',
    '{cmd:log} records session output. {cmd:cmdlog} records only commands.'
].join('\n');

/**
 * Mock content simulating sysdir.sthlp which documents
 * sysdir and adopath commands.
 */
const SYSDIR_STHLP_MOCK = [
    '{smcl}',
    '{* *! version 1.0.0  01jan2024}{...}',
    '{viewerdialog "sysdir" "dialog sysdir"}',
    '{viewerdialog "adopath" "dialog adopath"}',
    '{vieweralsosee "[P] sysdir" "mansection P sysdir"}{...}',
    '{p2col:{bf:[P] sysdir} {hline 2}}Query and set system directories{p_end}',
    '',
    '{marker syntax}{...}',
    '{title:Syntax}',
    '',
    '{p 8 14 2}',
    '{cmd:sysdir} [{cmd:list}]',
    '',
    '{p 8 14 2}',
    '{cmd:adopath}',
    '',
    '{pstd}',
    '{cmd:sysdir} displays system directories. {cmd:adopath} displays ado-file path.'
].join('\n');


// ============================================================================
// Tests for Multi-Command File Extraction
// ============================================================================

describe('SMCL Command Extractor - Multi-Command Files', () => {
    test('generate.sthlp extracts generate and replace', () => {
        const result = extract_commands_from_content(
            GENERATE_STHLP_MOCK,
            'generate.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('generate');
        expect(the_command_names).toContain('replace');
        expect(result.warnings).toHaveLength(0);
    });

    test('drop.sthlp extracts drop and keep', () => {
        const result = extract_commands_from_content(
            DROP_STHLP_MOCK,
            'drop.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('drop');
        expect(the_command_names).toContain('keep');
        expect(result.warnings).toHaveLength(0);
    });

    test('macro.sthlp extracts local, global, tempvar, tempname, tempfile', () => {
        const result = extract_commands_from_content(
            MACRO_STHLP_MOCK,
            'macro.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('local');
        expect(the_command_names).toContain('global');
        expect(the_command_names).toContain('tempvar');
        expect(the_command_names).toContain('tempname');
        expect(the_command_names).toContain('tempfile');
        expect(result.warnings).toHaveLength(0);
    });

    test('by.sthlp extracts by and bysort', () => {
        const result = extract_commands_from_content(
            BY_STHLP_MOCK,
            'by.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('by');
        expect(the_command_names).toContain('bysort');
        expect(result.warnings).toHaveLength(0);
    });

    test('quietly.sthlp extracts quietly and noisily', () => {
        const result = extract_commands_from_content(
            QUIETLY_STHLP_MOCK,
            'quietly.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('quietly');
        expect(the_command_names).toContain('noisily');
        expect(result.warnings).toHaveLength(0);
    });

    test('if.sthlp extracts if and else', () => {
        const result = extract_commands_from_content(
            IF_STHLP_MOCK,
            'if.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('if');
        expect(the_command_names).toContain('else');
        expect(result.warnings).toHaveLength(0);
    });

    test('do.sthlp extracts do and run', () => {
        const result = extract_commands_from_content(
            DO_STHLP_MOCK,
            'do.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('do');
        expect(the_command_names).toContain('run');
        expect(result.warnings).toHaveLength(0);
    });

    test('preserve.sthlp extracts preserve and restore', () => {
        const result = extract_commands_from_content(
            PRESERVE_STHLP_MOCK,
            'preserve.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('preserve');
        expect(the_command_names).toContain('restore');
        expect(result.warnings).toHaveLength(0);
    });

    test('encode.sthlp extracts encode and decode', () => {
        const result = extract_commands_from_content(
            ENCODE_STHLP_MOCK,
            'encode.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('encode');
        expect(the_command_names).toContain('decode');
        expect(result.warnings).toHaveLength(0);
    });

    test('destring.sthlp extracts destring and tostring', () => {
        const result = extract_commands_from_content(
            DESTRING_STHLP_MOCK,
            'destring.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('destring');
        expect(the_command_names).toContain('tostring');
        expect(result.warnings).toHaveLength(0);
    });

    test('correlate.sthlp extracts correlate and pwcorr', () => {
        const result = extract_commands_from_content(
            CORRELATE_STHLP_MOCK,
            'correlate.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('correlate');
        expect(the_command_names).toContain('pwcorr');
        expect(result.warnings).toHaveLength(0);
    });

    test('cd.sthlp extracts cd and pwd', () => {
        const result = extract_commands_from_content(
            CD_STHLP_MOCK,
            'cd.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('cd');
        expect(the_command_names).toContain('pwd');
        expect(result.warnings).toHaveLength(0);
    });

    test('log.sthlp extracts log and cmdlog', () => {
        const result = extract_commands_from_content(
            LOG_STHLP_MOCK,
            'log.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('log');
        expect(the_command_names).toContain('cmdlog');
        expect(result.warnings).toHaveLength(0);
    });

    test('sysdir.sthlp extracts sysdir and adopath', () => {
        const result = extract_commands_from_content(
            SYSDIR_STHLP_MOCK,
            'sysdir.sthlp'
        );

        const the_command_names = result.commands.map(c => c.name);
        expect(the_command_names).toContain('sysdir');
        expect(the_command_names).toContain('adopath');
        expect(result.warnings).toHaveLength(0);
    });
});

// ============================================================================
// Tests for Primary Command Detection
// ============================================================================

describe('SMCL Command Extractor - Primary Command', () => {
    test('identifies primary command from title', () => {
        const result = extract_commands_from_content(
            GENERATE_STHLP_MOCK,
            'generate.sthlp'
        );

        const my_primary = result.commands.find(c => c.is_primary);
        expect(my_primary).toBeDefined();
        expect(my_primary?.name).toBe('generate');
    });

    test('marks non-primary commands correctly', () => {
        const result = extract_commands_from_content(
            GENERATE_STHLP_MOCK,
            'generate.sthlp'
        );

        const my_replace = result.commands.find(c => c.name === 'replace');
        expect(my_replace).toBeDefined();
        expect(my_replace?.is_primary).toBe(false);
    });
});

// ============================================================================
// Tests for Abbreviation Extraction
// ============================================================================

describe('SMCL Command Extractor - Abbreviations', () => {
    test('extracts correct abbreviation for generate (g)', () => {
        const result = extract_commands_from_content(
            GENERATE_STHLP_MOCK,
            'generate.sthlp'
        );

        const my_generate = result.commands.find(c => c.name === 'generate');
        expect(my_generate).toBeDefined();
        expect(my_generate?.min_abbreviation).toBe(1); // g:enerate
    });

    test('extracts correct abbreviation for local (loc)', () => {
        const result = extract_commands_from_content(
            MACRO_STHLP_MOCK,
            'macro.sthlp'
        );

        const my_local = result.commands.find(c => c.name === 'local');
        expect(my_local).toBeDefined();
        expect(my_local?.min_abbreviation).toBe(3); // loc:al
    });

    test('extracts correct abbreviation for global (gl)', () => {
        const result = extract_commands_from_content(
            MACRO_STHLP_MOCK,
            'macro.sthlp'
        );

        const my_global = result.commands.find(c => c.name === 'global');
        expect(my_global).toBeDefined();
        expect(my_global?.min_abbreviation).toBe(2); // gl:obal
    });

    test('extracts correct abbreviation for quietly (qui)', () => {
        const result = extract_commands_from_content(
            QUIETLY_STHLP_MOCK,
            'quietly.sthlp'
        );

        const my_quietly = result.commands.find(c => c.name === 'quietly');
        expect(my_quietly).toBeDefined();
        expect(my_quietly?.min_abbreviation).toBe(3); // qui:etly
    });

    test('extracts correct abbreviation for noisily (n)', () => {
        const result = extract_commands_from_content(
            QUIETLY_STHLP_MOCK,
            'quietly.sthlp'
        );

        const my_noisily = result.commands.find(c => c.name === 'noisily');
        expect(my_noisily).toBeDefined();
        expect(my_noisily?.min_abbreviation).toBe(1); // n:oisily
    });

    test('extracts correct abbreviation for bysort (bys)', () => {
        const result = extract_commands_from_content(
            BY_STHLP_MOCK,
            'by.sthlp'
        );

        const my_bysort = result.commands.find(c => c.name === 'bysort');
        expect(my_bysort).toBeDefined();
        expect(my_bysort?.min_abbreviation).toBe(3); // bys:ort
    });

    test('extracts correct abbreviation for correlate (cor)', () => {
        const result = extract_commands_from_content(
            CORRELATE_STHLP_MOCK,
            'correlate.sthlp'
        );

        const my_correlate = result.commands.find(c => c.name === 'correlate');
        expect(my_correlate).toBeDefined();
        expect(my_correlate?.min_abbreviation).toBe(3); // cor:relate
    });
});

// ============================================================================
// Tests for Helper Functions
// ============================================================================

describe('SMCL Command Extractor - Helper Functions', () => {
    test('extract_viewerdialog_commands finds all dialogs', () => {
        const the_commands = extract_viewerdialog_commands(MACRO_STHLP_MOCK);
        expect(the_commands).toContain('local');
        expect(the_commands).toContain('global');
        expect(the_commands).toContain('tempvar');
        expect(the_commands).toContain('tempname');
        expect(the_commands).toContain('tempfile');
        expect(the_commands).toHaveLength(5);
    });

    test('extract_primary_command finds title command', () => {
        const my_primary = extract_primary_command(GENERATE_STHLP_MOCK);
        expect(my_primary).toBe('generate');
    });

    test('extract_syntax_section extracts syntax content', () => {
        const my_syntax = extract_syntax_section(GENERATE_STHLP_MOCK);
        // The syntax section starts after {marker syntax} or {title:Syntax}
        // and ends at the next {marker} or {title:}
        // In our mock, the content after {marker syntax}{...} is extracted
        expect(my_syntax.length).toBeGreaterThan(0);
    });

    test('extract_cmdab_patterns finds abbreviation patterns', () => {
        const the_patterns = extract_cmdab_patterns(MACRO_STHLP_MOCK);
        const my_local = the_patterns.find(p => p.name === 'local');
        const my_global = the_patterns.find(p => p.name === 'global');

        expect(my_local).toBeDefined();
        expect(my_local?.min_abbrev).toBe(3);
        expect(my_global).toBeDefined();
        expect(my_global?.min_abbrev).toBe(2);
    });

    test('extract_cmd_patterns finds cmd patterns', () => {
        // Test with the full content since syntax section extraction
        // may not capture all patterns in our mock format
        const the_commands = extract_cmd_patterns(DROP_STHLP_MOCK);

        expect(the_commands).toContain('drop');
        expect(the_commands).toContain('keep');
    });

    test('extract_cmd_patterns should not extract "r" from option contexts', () => {
        // Test case for the bug where "r" gets extracted as a standalone command
        // from syntax like: {cmdab:mat:rix} {cmd:dispCns} [{cmd:,} {cmd:r} ]
        const problematic_syntax = '{cmdab:mat:rix} {cmd:dispCns} [{cmd:,} {cmd:r} ]';
        const the_commands = extract_cmd_patterns(problematic_syntax);

        expect(the_commands).toContain('dispcns');
        expect(the_commands).not.toContain('r'); // "r" should not be extracted as a command
    });

    test('extract_cmd_patterns should still extract legitimate single-letter commands', () => {
        // Ensure we don't break legitimate single-letter commands that appear outside option contexts
        const legitimate_syntax = '{cmd:x} varname';
        const the_commands = extract_cmd_patterns(legitimate_syntax);

        expect(the_commands).toContain('x'); // Should extract legitimate single-letter commands
    });
});

// ============================================================================
// Tests for Source File Tracking
// ============================================================================

describe('SMCL Command Extractor - Source File Tracking', () => {
    test('stores source file path for all commands', () => {
        const result = extract_commands_from_content(
            GENERATE_STHLP_MOCK,
            'generate.sthlp'
        );

        for (const my_command of result.commands) {
            expect(my_command.source_file).toBe('generate.sthlp');
        }
    });
});

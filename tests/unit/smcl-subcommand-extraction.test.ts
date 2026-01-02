import { describe, it, expect } from 'bun:test';
import {
    extract_cmdab_patterns,
    extract_commands_from_content,
    is_preceded_by_prefix_command,
    PREFIX_COMMANDS,
} from '../../src/command-database/smcl-extractor';

/**
 * Unit tests for SMCL Subcommand Extraction Bug Fix
 * Feature: smcl-subcommand-extraction-bug
 */
describe('SMCL Subcommand Extraction Unit Tests', () => {
    /**
     * Test 5.1: sem_estat_framework.sthlp extraction
     * Verifies that "framework" is not extracted as a standalone command
     * when it appears as a subcommand of "estat".
     * Validates: Requirements 2.2, 2.3
     */
    describe('sem_estat_framework.sthlp extraction', () => {
        it('should NOT extract "framework" as a standalone command', () => {
            // Mock content matching sem_estat_framework.sthlp syntax section
            const mock_content = `{smcl}
{* *! version 1.0.0}
{viewerdialog "estat framework" "dialog sem_estat_framework"}
{p2col:{bf:[SEM] estat framework} {hline 2}}Fit indices for SEM{p_end}

{marker syntax}
{title:Syntax}

{p 8 14 2}
{cmd:estat} {cmdab:fra:mework} [{cmd:,} {it:options}]

{title:Description}
{pstd}
{cmd:estat framework} displays fit indices for structural equation models.
`;

            const result = extract_commands_from_content(mock_content, 'sem_estat_framework.sthlp');
            const extracted_names = result.commands.map(c => c.name);

            // "framework" should NOT be extracted as a standalone command
            expect(extracted_names).not.toContain('framework');
        });

        it('should still extract "estat" if present as standalone', () => {
            // Content where estat appears as a standalone command
            const mock_content = `{smcl}
{viewerdialog "estat" "dialog estat"}
{p2col:{bf:[R] estat} {hline 2}}Postestimation statistics{p_end}

{marker syntax}
{title:Syntax}

{p 8 14 2}
{cmd:estat} {it:subcommand}

{title:Description}
`;

            const result = extract_commands_from_content(mock_content, 'estat.sthlp');
            const extracted_names = result.commands.map(c => c.name);

            // "estat" should be extracted
            expect(extracted_names).toContain('estat');
        });
    });

    /**
     * Test 5.2: PREFIX_COMMANDS completeness
     * Verifies all 15 prefix commands are in the set.
     * Validates: Requirements 1.2
     */
    describe('PREFIX_COMMANDS completeness', () => {
        it('should contain all 15 specified prefix commands', () => {
            const expected_prefix_commands = [
                'estat',
                'mi',
                'graph',
                'sts',
                'stcox',
                'streg',
                'me',
                'sem',
                'gsem',
                'bayes',
                'bayesmh',
                'collect',
                'dtable',
                'etable',
                'table',
            ];

            expect(PREFIX_COMMANDS.size).toBe(15);

            for (const cmd of expected_prefix_commands) {
                expect(PREFIX_COMMANDS.has(cmd)).toBe(true);
            }
        });
    });

    /**
     * Test 5.3: Whitespace handling
     * Tests various whitespace patterns between {cmd:PREFIX} and {cmdab:...}.
     * Validates: Requirements 1.1
     */
    describe('whitespace handling', () => {
        it('should handle single space between prefix and subcommand', () => {
            const content = '{cmd:estat} {cmdab:fra:mework}';
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);
            expect(names).not.toContain('framework');
        });

        it('should handle multiple spaces between prefix and subcommand', () => {
            const content = '{cmd:estat}   {cmdab:fra:mework}';
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);
            expect(names).not.toContain('framework');
        });

        it('should handle newline between prefix and subcommand', () => {
            const content = '{cmd:estat}\n{cmdab:fra:mework}';
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);
            expect(names).not.toContain('framework');
        });

        it('should handle tab between prefix and subcommand', () => {
            const content = '{cmd:estat}\t{cmdab:fra:mework}';
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);
            expect(names).not.toContain('framework');
        });

        it('should handle mixed whitespace between prefix and subcommand', () => {
            const content = '{cmd:estat} \n\t {cmdab:fra:mework}';
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);
            expect(names).not.toContain('framework');
        });

        it('should extract standalone command with no preceding prefix', () => {
            const content = '{cmdab:fra:mework}';
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);
            expect(names).toContain('framework');
        });
    });

    /**
     * Additional edge case tests
     */
    describe('edge cases', () => {
        it('should handle multiple subcommands in same content', () => {
            const content = `
{cmd:estat} {cmdab:fra:mework}
{cmd:mi} {cmdab:est:imate}
{cmdab:reg:ress}
`;
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);

            // Subcommands should NOT be extracted
            expect(names).not.toContain('framework');
            expect(names).not.toContain('estimate');

            // Standalone command should be extracted
            expect(names).toContain('regress');
        });

        it('should handle prefix command appearing later in content', () => {
            // First cmdab is standalone, second is a subcommand
            const content = `
{cmdab:gen:erate}
{cmd:estat} {cmdab:sum:marize}
`;
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);

            // Standalone should be extracted
            expect(names).toContain('generate');

            // Subcommand should NOT be extracted
            expect(names).not.toContain('summarize');
        });

        it('should not be confused by {cmd:} tags that are not prefix commands', () => {
            const content = '{cmd:display} {cmdab:fra:mework}';
            const results = extract_cmdab_patterns(content);
            const names = results.map(r => r.name);

            // "display" is not a prefix command, so "framework" should be extracted
            expect(names).toContain('framework');
        });
    });

    /**
     * is_preceded_by_prefix_command helper tests
     */
    describe('is_preceded_by_prefix_command helper', () => {
        it('should return true for content preceded by prefix command', () => {
            const content = '{cmd:estat} {cmdab:test:ing}';
            const match_index = content.indexOf('{cmdab:');
            expect(is_preceded_by_prefix_command(content, match_index)).toBe(true);
        });

        it('should return false for content not preceded by any {cmd:}', () => {
            const content = '{cmdab:test:ing}';
            const match_index = 0;
            expect(is_preceded_by_prefix_command(content, match_index)).toBe(false);
        });

        it('should return false for content preceded by non-prefix {cmd:}', () => {
            const content = '{cmd:display} {cmdab:test:ing}';
            const match_index = content.indexOf('{cmdab:');
            expect(is_preceded_by_prefix_command(content, match_index)).toBe(false);
        });

        it('should return false when there is text between {cmd:} and match', () => {
            const content = '{cmd:estat} some text {cmdab:test:ing}';
            const match_index = content.indexOf('{cmdab:');
            // "some text" is not just whitespace, so should return false
            expect(is_preceded_by_prefix_command(content, match_index)).toBe(false);
        });
    });
});

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import {
    extract_cmdab_patterns,
    extract_viewerdialog_commands,
    extract_commands_from_content,
} from '../../src/command-database/smcl-extractor';

/**
 * Property-based tests for SMCL Command Extraction
 * Feature: smcl-command-extraction
 */
describe('SMCL Command Extraction Property Tests', () => {
    /**
     * Generator for lowercase alphabetic strings of specified length range.
     */
    function arbitrary_lowercase_alpha(
        min_length: number,
        max_length: number
    ): fc.Arbitrary<string> {
        return fc.stringMatching(
            new RegExp(`^[a-z]{${min_length},${max_length}}$`)
        );
    }

    /**
     * Property 2: Abbreviation Correctness
     * For any {cmdab:X:Y} pattern where X is 1-5 chars and Y is 1-10 chars,
     * the extracted min_abbreviation SHALL equal the length of X.
     * Feature: smcl-command-extraction, Property 2: Abbreviation Correctness
     * Validates: Requirements 2.1, 2.4
     */
    it('should extract correct abbreviation length from cmdab patterns', () => {
        fc.assert(
            fc.property(
                arbitrary_lowercase_alpha(1, 5),
                arbitrary_lowercase_alpha(1, 10),
                (abbrev_part, suffix_part) => {
                    // Build a {cmdab:X:Y} pattern
                    const smcl_content = `{cmdab:${abbrev_part}:${suffix_part}}`;
                    const expected_full_name = abbrev_part + suffix_part;
                    const expected_min_abbrev = abbrev_part.length;

                    // Extract using the function
                    const the_results = extract_cmdab_patterns(smcl_content);

                    // Should find exactly one command
                    if (the_results.length !== 1) {
                        return false;
                    }

                    const my_result = the_results[0];

                    // Full name should be abbrev + suffix
                    if (my_result.name !== expected_full_name) {
                        return false;
                    }

                    // Min abbreviation should equal length of abbrev part
                    if (my_result.min_abbrev !== expected_min_abbrev) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1: Multi-Command Extraction
     * For any help file containing N {viewerdialog} tags, the extractor
     * SHALL return at least N distinct command names.
     * Feature: smcl-command-extraction, Property 1: Multi-Command Extraction
     * Validates: Requirements 1.1, 1.2
     */
    it('should extract at least N commands from N viewerdialog tags', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5 }),
                fc.array(arbitrary_lowercase_alpha(3, 10), {
                    minLength: 5,
                    maxLength: 10,
                }),
                (num_commands, command_pool) => {
                    // Ensure we have enough unique commands
                    const unique_commands = [...new Set(command_pool)];
                    if (unique_commands.length < num_commands) {
                        // Skip this test case if not enough unique commands
                        return true;
                    }

                    // Select N unique command names
                    const selected_commands = unique_commands.slice(
                        0,
                        num_commands
                    );

                    // Build mock SMCL content with N viewerdialog tags
                    const viewerdialog_tags = selected_commands
                        .map(
                            (cmd) =>
                                `{viewerdialog "${cmd}" "dialog ${cmd}"}`
                        )
                        .join('\n');

                    const smcl_content = `{smcl}
{* *! version 1.0.0}
${viewerdialog_tags}
{title:Test Help File}
{marker syntax}
{title:Syntax}
Some syntax content here
{title:Description}
`;

                    // Extract commands using viewerdialog extractor
                    const the_extracted = extract_viewerdialog_commands(
                        smcl_content
                    );

                    // Should extract at least N distinct commands
                    const unique_extracted = new Set(the_extracted);
                    if (unique_extracted.size < num_commands) {
                        return false;
                    }

                    // All selected commands should be in the extracted set
                    for (const my_cmd of selected_commands) {
                        if (!unique_extracted.has(my_cmd)) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Additional property: Multiple cmdab patterns extraction
     * For any SMCL content with multiple {cmdab:} patterns, all should be
     * extracted with correct abbreviation lengths.
     */
    it('should extract all cmdab patterns with correct abbreviations', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.tuple(
                        arbitrary_lowercase_alpha(1, 4),
                        arbitrary_lowercase_alpha(2, 8)
                    ),
                    { minLength: 1, maxLength: 5 }
                ),
                (the_patterns) => {
                    // Build SMCL content with multiple cmdab patterns
                    const cmdab_tags = the_patterns
                        .map(([abbrev, suffix]) => `{cmdab:${abbrev}:${suffix}}`)
                        .join(' ');

                    const smcl_content = `{marker syntax}
{title:Syntax}
${cmdab_tags}
{title:Description}`;

                    // Extract commands
                    const the_results = extract_cmdab_patterns(smcl_content);

                    // Build expected results map (handle duplicates)
                    const expected_map = new Map<string, number>();
                    for (const [abbrev, suffix] of the_patterns) {
                        const full_name = abbrev + suffix;
                        // First occurrence wins for duplicates
                        if (!expected_map.has(full_name)) {
                            expected_map.set(full_name, abbrev.length);
                        }
                    }

                    // Should have extracted all unique commands
                    if (the_results.length !== expected_map.size) {
                        return false;
                    }

                    // Each result should have correct abbreviation length
                    for (const my_result of the_results) {
                        const expected_abbrev = expected_map.get(my_result.name);
                        if (expected_abbrev === undefined) {
                            return false;
                        }
                        if (my_result.min_abbrev !== expected_abbrev) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Full extraction pipeline with viewerdialog
     * For any SMCL content with N viewerdialog tags, extract_commands_from_content
     * should return at least N commands.
     */
    it('should extract at least N commands from full content with N viewerdialogs', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5 }),
                fc.array(arbitrary_lowercase_alpha(3, 8), {
                    minLength: 5,
                    maxLength: 10,
                }),
                (num_commands, command_pool) => {
                    // Ensure we have enough unique commands
                    const unique_commands = [...new Set(command_pool)];
                    if (unique_commands.length < num_commands) {
                        return true; // Skip if not enough unique commands
                    }

                    const selected_commands = unique_commands.slice(
                        0,
                        num_commands
                    );

                    // Build mock SMCL content
                    const viewerdialog_tags = selected_commands
                        .map(
                            (cmd) =>
                                `{viewerdialog "${cmd}" "dialog ${cmd}"}`
                        )
                        .join('\n');

                    const smcl_content = `{smcl}
{* *! version 1.0.0}
${viewerdialog_tags}
{p2col:{bf:[D] ${selected_commands[0]}} {hline 2}}Test command{p_end}
{marker syntax}
{title:Syntax}
{cmd:${selected_commands[0]}} varlist
{title:Description}
{pstd}This is a test help file.{p_end}
`;

                    // Extract using full pipeline
                    const result = extract_commands_from_content(
                        smcl_content,
                        'test.sthlp'
                    );

                    // Should extract at least N commands
                    const unique_extracted = new Set(
                        result.commands.map((c) => c.name)
                    );
                    if (unique_extracted.size < num_commands) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

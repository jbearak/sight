import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    extract_cmdab_patterns,
    is_preceded_by_prefix_command,
    PREFIX_COMMANDS,
} from '../../src/command-database/smcl-extractor';

/**
 * Property-based tests for SMCL Subcommand Extraction Bug Fix
 * Feature: smcl-subcommand-extraction-bug
 */
describe('SMCL Subcommand Extraction Property Tests', () => {
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
     * Generator for a random prefix command from PREFIX_COMMANDS.
     */
    function arbitrary_prefix_command(): fc.Arbitrary<string> {
        const the_prefix_commands = Array.from(PREFIX_COMMANDS);
        return fc.constantFrom(...the_prefix_commands);
    }

    /**
     * Generator for whitespace between prefix command and subcommand.
     * Includes single space, multiple spaces, newlines, and tabs.
     */
    function arbitrary_whitespace(): fc.Arbitrary<string> {
        return fc.oneof(
            fc.constant(' '),
            fc.constant('  '),
            fc.constant('\n'),
            fc.constant('\t'),
            fc.constant(' \n '),
            fc.constant('   ')
        );
    }

    /**
     * Property 1: Subcommand Suppression
     * For any SMCL content containing {cmd:PREFIX} {cmdab:X:Y} where PREFIX
     * is a known prefix command, the extractor SHALL NOT include the command
     * X+Y in its output.
     * 
     * Feature: smcl-subcommand-extraction-bug, Property 1: Subcommand Suppression
     * Validates: Requirements 1.1
     */
    it('should NOT extract subcommands that follow prefix commands', () => {
        fc.assert(
            fc.property(
                arbitrary_prefix_command(),
                arbitrary_lowercase_alpha(1, 5),
                arbitrary_lowercase_alpha(1, 10),
                arbitrary_whitespace(),
                (prefix_cmd, abbrev_part, suffix_part, whitespace) => {
                    // Build SMCL content with {cmd:PREFIX} {cmdab:X:Y} pattern
                    const subcommand_name = abbrev_part + suffix_part;
                    const smcl_content = `{cmd:${prefix_cmd}}${whitespace}{cmdab:${abbrev_part}:${suffix_part}}`;

                    // Extract using the function
                    const the_results = extract_cmdab_patterns(smcl_content);

                    // The subcommand should NOT be extracted
                    const extracted_names = the_results.map(r => r.name);
                    const has_subcommand = extracted_names.includes(subcommand_name);

                    if (has_subcommand) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Standalone Command Preservation
     * For any SMCL content containing {cmdab:X:Y} that is NOT immediately
     * preceded by a {cmd:PREFIX} pattern where PREFIX is a known prefix
     * command, the extractor SHALL include the command X+Y in its output
     * with min_abbreviation equal to the length of X.
     * 
     * Feature: smcl-subcommand-extraction-bug, Property 2: Standalone Command Preservation
     * Validates: Requirements 1.3, 3.1
     */
    it('should extract standalone commands not preceded by prefix commands', () => {
        fc.assert(
            fc.property(
                arbitrary_lowercase_alpha(1, 5),
                arbitrary_lowercase_alpha(1, 10),
                (abbrev_part, suffix_part) => {
                    // Build SMCL content with standalone {cmdab:X:Y} pattern
                    const expected_full_name = abbrev_part + suffix_part;
                    const expected_min_abbrev = abbrev_part.length;
                    const smcl_content = `{cmdab:${abbrev_part}:${suffix_part}}`;

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
     * Property: Commands preceded by non-prefix {cmd:} are still extracted
     * For any SMCL content containing {cmd:NONPREFIX} {cmdab:X:Y} where
     * NONPREFIX is NOT a known prefix command, the extractor SHALL include
     * the command X+Y in its output.
     */
    it('should extract commands preceded by non-prefix {cmd:} tags', () => {
        fc.assert(
            fc.property(
                arbitrary_lowercase_alpha(3, 8).filter(
                    name => !PREFIX_COMMANDS.has(name)
                ),
                arbitrary_lowercase_alpha(1, 5),
                arbitrary_lowercase_alpha(1, 10),
                (non_prefix_cmd, abbrev_part, suffix_part) => {
                    // Build SMCL content with {cmd:NONPREFIX} {cmdab:X:Y} pattern
                    const expected_full_name = abbrev_part + suffix_part;
                    const smcl_content = `{cmd:${non_prefix_cmd}} {cmdab:${abbrev_part}:${suffix_part}}`;

                    // Extract using the function
                    const the_results = extract_cmdab_patterns(smcl_content);

                    // The command should be extracted (non-prefix doesn't suppress)
                    const extracted_names = the_results.map(r => r.name);
                    const has_command = extracted_names.includes(expected_full_name);

                    if (!has_command) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: is_preceded_by_prefix_command helper correctness
     * For any content with {cmd:PREFIX} followed by whitespace at position P,
     * is_preceded_by_prefix_command(content, P + whitespace_length) should return true.
     */
    it('should correctly detect prefix command precedence', () => {
        fc.assert(
            fc.property(
                arbitrary_prefix_command(),
                arbitrary_whitespace(),
                (prefix_cmd, whitespace) => {
                    // Build content with {cmd:PREFIX} followed by whitespace
                    const prefix_tag = `{cmd:${prefix_cmd}}`;
                    const content = prefix_tag + whitespace + '{cmdab:test:ing}';
                    const match_index = prefix_tag.length + whitespace.length;

                    // Should detect the prefix command
                    const result = is_preceded_by_prefix_command(content, match_index);
                    return result === true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: is_preceded_by_prefix_command returns false for non-prefix
     */
    it('should return false for non-prefix commands', () => {
        fc.assert(
            fc.property(
                arbitrary_lowercase_alpha(3, 8).filter(
                    name => !PREFIX_COMMANDS.has(name)
                ),
                (non_prefix_cmd) => {
                    // Build content with {cmd:NONPREFIX} followed by space
                    const prefix_tag = `{cmd:${non_prefix_cmd}}`;
                    const content = prefix_tag + ' {cmdab:test:ing}';
                    const match_index = prefix_tag.length + 1;

                    // Should NOT detect as prefix command
                    const result = is_preceded_by_prefix_command(content, match_index);
                    return result === false;
                }
            ),
            { numRuns: 100 }
        );
    });
});

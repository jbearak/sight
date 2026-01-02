import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { isMacroCreatingCommand, expandMacroCreatingCommand, find_macro_creating_command, matches_option, MACRO_CREATING_COMMANDS } from '../../src/analyzer/macro-creating-commands';

/**
 * Property-based tests for Macro-Creating Commands
 * Feature: macro-creating-options
 * 
 * NOTE: Stata is case-sensitive. Command matching is case-sensitive.
 */
describe('Macro-Creating Commands Property Tests', () => {
    /**
     * Generator for valid command names from the known list
     */
    const known_command = fc.oneof(
        ...MACRO_CREATING_COMMANDS.map(cmd => fc.constant(cmd.name))
    );

    /**
     * Generator for valid abbreviations of known commands
     */
    const valid_abbreviation = fc.oneof(
        ...MACRO_CREATING_COMMANDS.flatMap(cmd => {
            const abbrevs = [];
            // Only full name is valid when min_abbreviation is 0
            if (cmd.min_abbreviation === 0) {
                abbrevs.push(fc.constant(cmd.name));
            } else {
                for (let i = cmd.min_abbreviation; i <= cmd.name.length; i++) {
                    abbrevs.push(fc.constant(cmd.name.substring(0, i)));
                }
            }
            return abbrevs;
        }).filter(abbrev => abbrev !== undefined)
    );

    /**
     * Generator for unknown command names
     */
    const unknown_command = fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s))
        .filter(s => !MACRO_CREATING_COMMANDS.some(cmd => 
            s === cmd.name || 
            (cmd.min_abbreviation > 0 && s.length >= cmd.min_abbreviation && cmd.name.startsWith(s))
        ));

    /**
     * Property 1: Full Command Name Recognition
     * For any known macro-creating command name, isMacroCreatingCommand should return true.
     * Feature: macro-creating-options, Property 1: Full Command Name Recognition
     * Validates: Requirements 2.1, 2.2
     */
    it('should recognize full command names', () => {
        fc.assert(
            fc.property(
                known_command,
                (command) => {
                    expect(isMacroCreatingCommand(command)).toBe(true);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2: Case Sensitive Recognition
     * Command matching is case-sensitive. Mixed case should NOT match.
     * Feature: macro-creating-options, Property 2: Case Sensitive Recognition
     * Validates: AGENTS.md rule that Stata is case-sensitive
     */
    it('should be case sensitive for command recognition', () => {
        fc.assert(
            fc.property(
                known_command,
                (command) => {
                    // Exact case should match
                    expect(isMacroCreatingCommand(command)).toBe(true);
                    
                    // Upper case should NOT match (Stata is case-sensitive)
                    const upper_case = command.toUpperCase();
                    if (upper_case !== command) {
                        expect(isMacroCreatingCommand(upper_case)).toBe(false);
                    }
                    
                    // Mixed case should NOT match
                    const mixed_case = command.charAt(0).toUpperCase() + command.slice(1);
                    if (mixed_case !== command) {
                        expect(isMacroCreatingCommand(mixed_case)).toBe(false);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 3: Valid Abbreviation Recognition
     * For any valid abbreviation of a known command, isMacroCreatingCommand should return true.
     * Feature: macro-creating-options, Property 3: Valid Abbreviation Recognition
     * Validates: Requirements 1.5, 2.1, 2.2
     */
    it('should recognize valid abbreviations', () => {
        fc.assert(
            fc.property(
                valid_abbreviation,
                (abbreviation) => {
                    expect(isMacroCreatingCommand(abbreviation)).toBe(true);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 4: Invalid Abbreviation Rejection
     * For any abbreviation that is too short for a known command, isMacroCreatingCommand should return false.
     * Feature: macro-creating-options, Property 4: Invalid Abbreviation Rejection
     * Validates: Requirements 1.5
     */
    it('should reject invalid abbreviations', () => {
        // levelsof has min_abbreviation=0, so only full name is valid
        // glevelsof has min_abbreviation=0, so only full name is valid
        // Test short prefixes that should not match
        expect(isMacroCreatingCommand('l')).toBe(false);
        expect(isMacroCreatingCommand('lev')).toBe(false);
        expect(isMacroCreatingCommand('level')).toBe(false);
        expect(isMacroCreatingCommand('g')).toBe(false);
        expect(isMacroCreatingCommand('glev')).toBe(false);
        expect(isMacroCreatingCommand('glevel')).toBe(false);
    });

    /**
     * Property 5: Unknown Command Rejection
     * For any command name not in the known list, isMacroCreatingCommand should return false.
     * Feature: macro-creating-options, Property 5: Unknown Command Rejection
     * Validates: Requirements 2.1, 2.2
     */
    it('should reject unknown commands', () => {
        fc.assert(
            fc.property(
                unknown_command,
                (command) => {
                    expect(isMacroCreatingCommand(command)).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6: Expansion Consistency
     * For any command that isMacroCreatingCommand recognizes, expandMacroCreatingCommand should return a valid expansion.
     * Feature: macro-creating-options, Property 6: Expansion Consistency
     * Validates: Requirements 2.1, 2.2
     */
    it('should provide consistent expansion for recognized commands', () => {
        fc.assert(
            fc.property(
                fc.oneof(known_command, valid_abbreviation),
                (command) => {
                    const is_recognized = isMacroCreatingCommand(command);
                    const expansion = expandMacroCreatingCommand(command);
                    
                    if (is_recognized) {
                        expect(expansion).toBeDefined();
                        expect(MACRO_CREATING_COMMANDS.some(cmd => cmd.name === expansion)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Expansion Returns Full Name
     * For any valid abbreviation, expandMacroCreatingCommand should return the full command name.
     * Feature: macro-creating-options, Property 7: Expansion Returns Full Name
     * Validates: Requirements 1.5
     */
    it('should expand abbreviations to full names', () => {
        fc.assert(
            fc.property(
                valid_abbreviation,
                (abbreviation) => {
                    const expansion = expandMacroCreatingCommand(abbreviation);
                    const expected_command = MACRO_CREATING_COMMANDS.find(cmd => 
                        abbreviation === cmd.name ||
                        (cmd.min_abbreviation > 0 && abbreviation.length >= cmd.min_abbreviation && cmd.name.startsWith(abbreviation))
                    );
                    
                    expect(expansion).toBe(expected_command?.name);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 8: Unknown Command Expansion
     * For any unknown command, expandMacroCreatingCommand should return undefined.
     * Feature: macro-creating-options, Property 8: Unknown Command Expansion
     * Validates: Requirements 2.1, 2.2
     */
    it('should return undefined for unknown commands', () => {
        fc.assert(
            fc.property(
                unknown_command,
                (command) => {
                    const expansion = expandMacroCreatingCommand(command);
                    expect(expansion).toBeUndefined();
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 9: Deterministic Behavior
     * For any given input, both functions should always return the same result.
     * Feature: macro-creating-options, Property 9: Deterministic Behavior
     * Validates: General correctness
     */
    it('should be deterministic', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 }),
                (command) => {
                    const result1 = isMacroCreatingCommand(command);
                    const result2 = isMacroCreatingCommand(command);
                    const expansion1 = expandMacroCreatingCommand(command);
                    const expansion2 = expandMacroCreatingCommand(command);
                    
                    expect(result1).toBe(result2);
                    expect(expansion1).toBe(expansion2);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 10: Abbreviation Minimality
     * For any command, the shortest valid abbreviation should be exactly min_abbreviation characters.
     * Feature: macro-creating-options, Property 10: Abbreviation Minimality
     * Validates: Requirements 1.5
     */
    it('should respect minimum abbreviation lengths', () => {
        MACRO_CREATING_COMMANDS.forEach(cmd => {
            // Full name should always work
            expect(isMacroCreatingCommand(cmd.name)).toBe(true);
            
            // If min_abbreviation is 0, only full name works
            if (cmd.min_abbreviation === 0) {
                // Shorter prefixes should not work
                if (cmd.name.length > 1) {
                    const too_short = cmd.name.substring(0, cmd.name.length - 1);
                    expect(isMacroCreatingCommand(too_short)).toBe(false);
                }
            } else {
                // Test that min_abbreviation length works
                const min_abbrev = cmd.name.substring(0, cmd.min_abbreviation);
                expect(isMacroCreatingCommand(min_abbrev)).toBe(true);
                
                // Test that shorter than min_abbreviation doesn't work
                if (cmd.min_abbreviation > 1) {
                    const too_short = cmd.name.substring(0, cmd.min_abbreviation - 1);
                    expect(isMacroCreatingCommand(too_short)).toBe(false);
                }
            }
        });
    });

    /**
     * Property 11: Prefix Matching Accuracy
     * For any string that is a prefix of a known command but shorter than min_abbreviation, 
     * it should not be recognized.
     * Feature: macro-creating-options, Property 11: Prefix Matching Accuracy
     * Validates: Requirements 1.5
     */
    it('should only match prefixes that meet minimum abbreviation requirements', () => {
        fc.assert(
            fc.property(
                fc.oneof(...MACRO_CREATING_COMMANDS.map(cmd => fc.constant(cmd))),
                fc.integer({ min: 1, max: 20 }),
                (cmd, prefix_length) => {
                    if (prefix_length <= cmd.name.length) {
                        const prefix = cmd.name.substring(0, prefix_length);
                        let should_match: boolean;
                        if (cmd.min_abbreviation === 0) {
                            // Only full name matches
                            should_match = prefix_length === cmd.name.length;
                        } else {
                            should_match = prefix_length >= cmd.min_abbreviation;
                        }
                        
                        expect(isMacroCreatingCommand(prefix)).toBe(should_match);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 12: Empty String Handling
     * Empty strings should not be recognized as macro-creating commands.
     * Feature: macro-creating-options, Property 12: Empty String Handling
     * Validates: General correctness
     */
    it('should handle empty strings correctly', () => {
        expect(isMacroCreatingCommand('')).toBe(false);
        expect(expandMacroCreatingCommand('')).toBeUndefined();
    });

    /**
     * Property 13: matches_option function correctness
     * Feature: macro-creating-options, Property 13: Option Matching
     * Validates: Requirements 1.5
     */
    it('should correctly match options with abbreviations', () => {
        // Test local option matching for levelsof (min_abbreviation: 1)
        const levelsof = find_macro_creating_command('levelsof')!;
        const local_opt = levelsof.local_options[0];
        
        expect(matches_option('local', local_opt)).toBe(true);
        expect(matches_option('l', local_opt)).toBe(true);
        expect(matches_option('lo', local_opt)).toBe(true);
        expect(matches_option('loc', local_opt)).toBe(true);
        expect(matches_option('loca', local_opt)).toBe(true);
        
        // Test global option matching for glevelsof (min_abbreviation: 0 means no abbreviation)
        const glevelsof = find_macro_creating_command('glevelsof')!;
        const global_opt = glevelsof.global_options[0];
        
        expect(matches_option('global', global_opt)).toBe(true);
        expect(matches_option('g', global_opt)).toBe(false);
        expect(matches_option('glo', global_opt)).toBe(false);
        expect(matches_option('globa', global_opt)).toBe(false);
    });
});

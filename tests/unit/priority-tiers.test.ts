/**
 * Unit tests for priority tier assignment
 */

import {
    TIER_1_COMMANDS,
    TIER_2_COMMANDS,
    get_command_priority,
} from '../../src/command-database/priority-tiers';

describe('Priority Tiers', () => {
    describe('TIER_1_COMMANDS', () => {
        it('should contain core data manipulation commands', () => {
            expect(TIER_1_COMMANDS.has('generate')).toBe(true);
            expect(TIER_1_COMMANDS.has('replace')).toBe(true);
            expect(TIER_1_COMMANDS.has('drop')).toBe(true);
            expect(TIER_1_COMMANDS.has('keep')).toBe(true);
            expect(TIER_1_COMMANDS.has('merge')).toBe(true);
        });

        it('should contain programming commands', () => {
            expect(TIER_1_COMMANDS.has('local')).toBe(true);
            expect(TIER_1_COMMANDS.has('global')).toBe(true);
            expect(TIER_1_COMMANDS.has('foreach')).toBe(true);
            expect(TIER_1_COMMANDS.has('forvalues')).toBe(true);
            expect(TIER_1_COMMANDS.has('program')).toBe(true);
        });

        it('should contain analysis commands', () => {
            expect(TIER_1_COMMANDS.has('summarize')).toBe(true);
            expect(TIER_1_COMMANDS.has('describe')).toBe(true);
            expect(TIER_1_COMMANDS.has('tabulate')).toBe(true);
        });

        it('should contain I/O commands', () => {
            expect(TIER_1_COMMANDS.has('use')).toBe(true);
            expect(TIER_1_COMMANDS.has('save')).toBe(true);
            expect(TIER_1_COMMANDS.has('clear')).toBe(true);
        });
    });

    describe('TIER_2_COMMANDS', () => {
        it('should contain estimation commands', () => {
            expect(TIER_2_COMMANDS.has('regress')).toBe(true);
            expect(TIER_2_COMMANDS.has('logit')).toBe(true);
            expect(TIER_2_COMMANDS.has('probit')).toBe(true);
            expect(TIER_2_COMMANDS.has('margins')).toBe(true);
        });

        it('should contain graphics commands', () => {
            expect(TIER_2_COMMANDS.has('graph')).toBe(true);
            expect(TIER_2_COMMANDS.has('twoway')).toBe(true);
            expect(TIER_2_COMMANDS.has('histogram')).toBe(true);
        });

        it('should contain extended I/O commands', () => {
            expect(TIER_2_COMMANDS.has('import')).toBe(true);
            expect(TIER_2_COMMANDS.has('export')).toBe(true);
            expect(TIER_2_COMMANDS.has('log')).toBe(true);
        });
    });

    describe('get_command_priority', () => {
        it('should return 1 for Tier 1 commands', () => {
            expect(get_command_priority('generate')).toBe(1);
            expect(get_command_priority('local')).toBe(1);
            expect(get_command_priority('summarize')).toBe(1);
            expect(get_command_priority('use')).toBe(1);
        });

        it('should return 2 for Tier 2 commands', () => {
            expect(get_command_priority('regress')).toBe(2);
            expect(get_command_priority('graph')).toBe(2);
            expect(get_command_priority('import')).toBe(2);
            expect(get_command_priority('margins')).toBe(2);
        });

        it('should return 3 for unknown commands (Tier 3)', () => {
            expect(get_command_priority('unknowncommand')).toBe(3);
            expect(get_command_priority('myprog')).toBe(3);
            expect(get_command_priority('xyz')).toBe(3);
        });

        it('should be case-insensitive', () => {
            expect(get_command_priority('GENERATE')).toBe(1);
            expect(get_command_priority('Generate')).toBe(1);
            expect(get_command_priority('REGRESS')).toBe(2);
            expect(get_command_priority('Regress')).toBe(2);
        });

        it('should not have overlap between tiers', () => {
            // Verify no command is in both tiers
            for (const my_cmd of TIER_1_COMMANDS) {
                expect(TIER_2_COMMANDS.has(my_cmd)).toBe(false);
            }
            for (const my_cmd of TIER_2_COMMANDS) {
                expect(TIER_1_COMMANDS.has(my_cmd)).toBe(false);
            }
        });
    });
});

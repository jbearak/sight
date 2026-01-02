/**
 * Property Test: Priority Tier Ordering
 *
 * Feature: completion-improvements, Property 7: Priority Tier Ordering
 * Validates: Requirements 5.2, 5.4
 *
 * For any completion list of built-in commands, commands shall be ordered
 * by priority tier (Tier 1 before Tier 2 before Tier 3), and within each
 * tier, commands shall be sorted alphabetically.
 */

import * as fc from 'fast-check';
import { CompletionProvider, compute_ranking_key } from '../../src/providers/completion';
import { DocumentState, SymbolTable, CompletionRankingFactors } from '../../src/types';
import { command_database } from '../../src/command-database';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { ContextTracker } from '../../src/context-tracker';
import { Position, CompletionItem } from 'vscode-languageserver/node';
import { get_command_priority, TIER_1_COMMANDS, TIER_2_COMMANDS } from '../../src/command-database/priority-tiers';

describe('Property 7: Priority Tier Ordering', () => {
    let completion_provider: CompletionProvider;
    const empty_symbols: SymbolTable = {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };

    beforeAll(() => {
        command_database.register_all(BUILTIN_COMMANDS);
        completion_provider = new CompletionProvider(command_database);
    });

    function create_document(content: string): DocumentState {
        return {
            uri: 'file:///test.do',
            version: 1,
            content,
            tokens: [],
            ast: null,
            symbols: empty_symbols,
            diagnostics: [],
            context_ranges: [],
            context_tracker: new ContextTracker(),
            line_offsets: [],
        };
    }

    function get_tier(command_name: string): number {
        return get_command_priority(command_name);
    }

    it('tier 1 commands sort before tier 2 commands', async () => {
        // Use a prefix that matches both tier 1 and tier 2 commands
        // 'r' matches 'replace' (tier 1) and 'regress' (tier 2)
        const document = create_document('r');
        const position: Position = { line: 0, character: 1 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        // Sort by sortText to get the actual order
        const sorted = [...completions].sort((a, b) =>
            (a.sortText || a.label).localeCompare(b.sortText || b.label)
        );

        // Find tier 1 and tier 2 commands in the results
        const tier_1_indices: number[] = [];
        const tier_2_indices: number[] = [];

        sorted.forEach((item, index) => {
            const tier = get_tier(item.label);
            if (tier === 1) tier_1_indices.push(index);
            if (tier === 2) tier_2_indices.push(index);
        });

        // All tier 1 commands should come before all tier 2 commands
        if (tier_1_indices.length > 0 && tier_2_indices.length > 0) {
            const max_tier_1 = Math.max(...tier_1_indices);
            const min_tier_2 = Math.min(...tier_2_indices);
            expect(max_tier_1).toBeLessThan(min_tier_2);
        }
    });

    it('tier 2 commands sort before tier 3 commands', async () => {
        // Use a prefix that matches tier 2 and tier 3 commands
        const document = create_document('l');
        const position: Position = { line: 0, character: 1 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        // Sort by sortText to get the actual order
        const sorted = [...completions].sort((a, b) =>
            (a.sortText || a.label).localeCompare(b.sortText || b.label)
        );

        // Find tier 2 and tier 3 commands in the results
        const tier_2_indices: number[] = [];
        const tier_3_indices: number[] = [];

        sorted.forEach((item, index) => {
            const tier = get_tier(item.label);
            if (tier === 2) tier_2_indices.push(index);
            if (tier === 3) tier_3_indices.push(index);
        });

        // All tier 2 commands should come before all tier 3 commands
        if (tier_2_indices.length > 0 && tier_3_indices.length > 0) {
            const max_tier_2 = Math.max(...tier_2_indices);
            const min_tier_3 = Math.min(...tier_3_indices);
            expect(max_tier_2).toBeLessThan(min_tier_3);
        }
    });

    it('commands within same tier are sorted alphabetically', async () => {
        // Get completions for a prefix that matches multiple tier 1 commands
        const document = create_document('g');
        const position: Position = { line: 0, character: 1 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        // Sort by sortText to get the actual order
        const sorted = [...completions].sort((a, b) =>
            (a.sortText || a.label).localeCompare(b.sortText || b.label)
        );

        // Group by tier
        const tier_1_commands = sorted.filter((c) => get_tier(c.label) === 1);
        const tier_2_commands = sorted.filter((c) => get_tier(c.label) === 2);
        const tier_3_commands = sorted.filter((c) => get_tier(c.label) === 3);

        // Within each tier, commands should be alphabetically sorted
        for (let i = 1; i < tier_1_commands.length; i++) {
            expect(
                tier_1_commands[i - 1].label.toLowerCase() <=
                    tier_1_commands[i].label.toLowerCase()
            ).toBe(true);
        }

        for (let i = 1; i < tier_2_commands.length; i++) {
            expect(
                tier_2_commands[i - 1].label.toLowerCase() <=
                    tier_2_commands[i].label.toLowerCase()
            ).toBe(true);
        }

        for (let i = 1; i < tier_3_commands.length; i++) {
            expect(
                tier_3_commands[i - 1].label.toLowerCase() <=
                    tier_3_commands[i].label.toLowerCase()
            ).toBe(true);
        }
    });

    it('property: ranking key respects priority tiers', () => {
        // Test that compute_ranking_key produces correct ordering
        fc.assert(
            fc.property(
                fc.constantFrom(1, 2, 3) as fc.Arbitrary<1 | 2 | 3>,
                fc.constantFrom(1, 2, 3) as fc.Arbitrary<1 | 2 | 3>,
                fc.string({ minLength: 1, maxLength: 10 }),
                fc.string({ minLength: 1, maxLength: 10 }),
                (tier_a, tier_b, name_a, name_b) => {
                    const factors_a: CompletionRankingFactors = {
                        scope_depth: 0,
                        directive_type: 'current',
                        symbol_type: 'builtin',
                        alphabetical_order: name_a,
                        command_priority: tier_a,
                    };

                    const factors_b: CompletionRankingFactors = {
                        scope_depth: 0,
                        directive_type: 'current',
                        symbol_type: 'builtin',
                        alphabetical_order: name_b,
                        command_priority: tier_b,
                    };

                    const key_a = compute_ranking_key(factors_a);
                    const key_b = compute_ranking_key(factors_b);

                    // If tier_a < tier_b, key_a should be less than key_b
                    if (tier_a < tier_b) {
                        return key_a < key_b;
                    }
                    // If tier_a > tier_b, key_a should be greater than key_b
                    if (tier_a > tier_b) {
                        return key_a > key_b;
                    }
                    // If same tier, alphabetical order determines
                    if (name_a.toLowerCase() < name_b.toLowerCase()) {
                        return key_a < key_b;
                    }
                    if (name_a.toLowerCase() > name_b.toLowerCase()) {
                        return key_a > key_b;
                    }
                    // Same tier and same name (case-insensitive)
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

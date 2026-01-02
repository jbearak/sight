/**
 * Property Test: User Programs Rank Above Built-ins
 *
 * Feature: completion-improvements, Property 6: User Programs Rank Above Built-ins
 * Validates: Requirements 5.1
 *
 * For any completion list containing both user-defined programs and built-in
 * commands, all user-defined programs shall appear before all built-in
 * commands (have lower sortText values).
 */

import * as fc from 'fast-check';
import { CompletionProvider, compute_ranking_key } from '../../src/providers/completion';
import { DocumentState, SymbolTable, CompletionRankingFactors, ProgramDefinition } from '../../src/types';
import { command_database } from '../../src/command-database';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { ContextTracker } from '../../src/context-tracker';
import { Position, CompletionItemKind } from 'vscode-languageserver/node';

describe('Property 6: User Programs Rank Above Built-ins', () => {
    let completion_provider: CompletionProvider;

    beforeAll(() => {
        command_database.register_all(BUILTIN_COMMANDS);
        completion_provider = new CompletionProvider(command_database);
    });

    function create_document_with_programs(
        content: string,
        program_names: string[]
    ): DocumentState {
        const programs = new Map<string, ProgramDefinition>();
        for (const my_name of program_names) {
            programs.set(my_name, {
                name: my_name,
                sourceUri: 'file:///test.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
            });
        }

        return {
            uri: 'file:///test.do',
            version: 1,
            content,
            tokens: [],
            ast: null,
            symbols: {
                programs,
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            diagnostics: [],
            context_ranges: [],
            context_tracker: new ContextTracker(),
            line_offsets: [],
        };
    }

    it('user programs appear before built-in commands', async () => {
        // Create a document with a user program that starts with 'g'
        const document = create_document_with_programs('g', ['gtest', 'gfoo']);
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

        // Find user programs and built-in commands
        const user_program_indices: number[] = [];
        const builtin_indices: number[] = [];

        sorted.forEach((item, index) => {
            if (item.kind === CompletionItemKind.Function) {
                user_program_indices.push(index);
            } else if (item.kind === CompletionItemKind.Keyword) {
                builtin_indices.push(index);
            }
        });

        // All user programs should come before all built-in commands
        if (user_program_indices.length > 0 && builtin_indices.length > 0) {
            const max_user_program = Math.max(...user_program_indices);
            const min_builtin = Math.min(...builtin_indices);
            expect(max_user_program).toBeLessThan(min_builtin);
        }
    });

    it('user program with same name as builtin shadows the builtin', async () => {
        // Create a user program named 'generate' (same as builtin)
        const document = create_document_with_programs('gen', ['generate']);
        const position: Position = { line: 0, character: 3 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        // Find completions for 'generate'
        const generate_completions = completions.filter(
            (c) => c.label === 'generate'
        );

        // Should only have one 'generate' completion (the user program)
        expect(generate_completions.length).toBe(1);
        expect(generate_completions[0].kind).toBe(CompletionItemKind.Function);
    });

    it('property: user-program ranking key is always less than builtin', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 10 }),
                fc.constantFrom(1, 2, 3) as fc.Arbitrary<1 | 2 | 3>,
                (name, tier) => {
                    const user_program_factors: CompletionRankingFactors = {
                        scope_depth: 0,
                        directive_type: 'current',
                        symbol_type: 'user-program',
                        alphabetical_order: name,
                    };

                    const builtin_factors: CompletionRankingFactors = {
                        scope_depth: 0,
                        directive_type: 'current',
                        symbol_type: 'builtin',
                        alphabetical_order: name,
                        command_priority: tier,
                    };

                    const user_key = compute_ranking_key(user_program_factors);
                    const builtin_key = compute_ranking_key(builtin_factors);

                    // User program key should always be less than builtin key
                    return user_key < builtin_key;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('property: randomly generated user programs rank above builtins', async () => {
        const program_name_gen = fc.stringOf(
            fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'),
            { minLength: 2, maxLength: 8 }
        );

        await fc.assert(
            fc.asyncProperty(
                fc.array(program_name_gen, { minLength: 1, maxLength: 3 }),
                async (program_names) => {
                    // Use first letter of first program as prefix
                    const prefix = program_names[0][0];
                    const document = create_document_with_programs(
                        prefix,
                        program_names
                    );
                    const position: Position = { line: 0, character: 1 };

                    const completions = await completion_provider.get_completions(
                        document,
                        position,
                        undefined
                    );

                    // Sort by sortText
                    const sorted = [...completions].sort((a, b) =>
                        (a.sortText || a.label).localeCompare(b.sortText || b.label)
                    );

                    // Find user programs and built-ins
                    const user_program_indices: number[] = [];
                    const builtin_indices: number[] = [];

                    sorted.forEach((item, index) => {
                        if (item.kind === CompletionItemKind.Function) {
                            user_program_indices.push(index);
                        } else if (item.kind === CompletionItemKind.Keyword) {
                            builtin_indices.push(index);
                        }
                    });

                    // All user programs should come before all built-ins
                    if (user_program_indices.length > 0 && builtin_indices.length > 0) {
                        const max_user = Math.max(...user_program_indices);
                        const min_builtin = Math.min(...builtin_indices);
                        return max_user < min_builtin;
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });
});

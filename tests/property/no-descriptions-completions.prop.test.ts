/**
 * Property Test: No Descriptions in Completion Items
 *
 * Feature: completion-improvements, Property 2: No Descriptions in Completion Items
 * Validates: Requirements 2.3, 2.4
 *
 * For any completion item returned by the Completion_Provider (command or
 * option), the `detail` field shall not contain a description string from
 * the command database.
 */

import * as fc from 'fast-check';
import { CompletionProvider } from '../../src/providers/completion';
import { DocumentState, SymbolTable } from '../../src/types';
import { command_database } from '../../src/command-database';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { ContextTracker } from '../../src/context-tracker';
import { Position, CompletionItemKind } from 'vscode-languageserver/node';

describe('Property 2: No Descriptions in Completion Items', () => {
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

    it('command completions use options in detail, not description', async () => {
        const document = create_document('gen');
        const position: Position = { line: 0, character: 3 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        // Find the 'generate' completion
        const generate_completion = completions.find(
            (c) => c.label === 'generate'
        );

        expect(generate_completion).toBeDefined();
        if (generate_completion) {
            // Detail should show options (if any) or be undefined, not a description
            // Should not contain typical description phrases
            if (generate_completion.detail) {
                expect(generate_completion.detail).not.toContain('Create a new variable');
                // If detail exists, it should be options-based or empty
                // (generate may not have options, so detail could be undefined)
            }
        }
    });

    it('option completions do not include option descriptions', async () => {
        const document = create_document('regress y x, noc');
        const position: Position = { line: 0, character: 16 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        // Find option completions
        const option_completions = completions.filter(
            (c) => c.kind === CompletionItemKind.Property
        );

        for (const my_opt of option_completions) {
            // Detail should indicate it's an option, not contain a description
            expect(my_opt.detail).toContain('Option for');
            // Should not contain typical description phrases
            expect(my_opt.detail).not.toContain('Suppress');
            expect(my_opt.detail).not.toContain('constant term');
        }
    });

    it('property: no command completion detail contains description-like text', async () => {
        const prefix_gen = fc.stringOf(
            fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                           'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
            { minLength: 1, maxLength: 3 }
        );

        await fc.assert(
            fc.asyncProperty(prefix_gen, async (prefix) => {
                const document = create_document(prefix);
                const position: Position = { line: 0, character: prefix.length };

                const completions = await completion_provider.get_completions(
                    document,
                    position,
                    undefined
                );

                // Check command completions (Keyword kind)
                const command_completions = completions.filter(
                    (c) => c.kind === CompletionItemKind.Keyword
                );

                for (const my_cmd of command_completions) {
                    // Detail should be options-based (starts with "Options:") or undefined
                    // Should not be a long description sentence
                    if (my_cmd.detail) {
                        const is_options_based = my_cmd.detail.startsWith('Options:');
                        const is_abbreviation = my_cmd.detail.startsWith('Abbreviation for');

                        // Should not be a long description sentence
                        const is_description_like =
                            my_cmd.detail.length > 100 ||
                            my_cmd.detail.includes('Create') ||
                            my_cmd.detail.includes('Display') ||
                            my_cmd.detail.includes('Perform');

                        if (is_description_like && !is_options_based && !is_abbreviation) {
                            return false;
                        }
                    }
                }

                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('property: no option completion detail contains description text', async () => {
        const the_commands_with_options = ['regress', 'summarize', 'tabulate', 'merge'];

        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(...the_commands_with_options),
                fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'n', 'o', 'v'), { minLength: 1, maxLength: 2 }),
                async (cmd, opt_prefix) => {
                    const content = `${cmd} y x, ${opt_prefix}`;
                    const document = create_document(content);
                    const position: Position = { line: 0, character: content.length };

                    const completions = await completion_provider.get_completions(
                        document,
                        position,
                        undefined
                    );

                    // Check option completions (Property kind)
                    const option_completions = completions.filter(
                        (c) => c.kind === CompletionItemKind.Property
                    );

                    for (const my_opt of option_completions) {
                        if (my_opt.detail) {
                            // Detail should be "Option for <command>"
                            // Not a description of what the option does
                            const is_option_indicator = my_opt.detail.startsWith('Option for') ||
                                                       my_opt.detail.startsWith('Abbreviation for');

                            if (!is_option_indicator) {
                                // If not an option indicator, it shouldn't be a description
                                const is_description =
                                    my_opt.detail.includes('Suppress') ||
                                    my_opt.detail.includes('Display') ||
                                    my_opt.detail.includes('Include') ||
                                    my_opt.detail.includes('Specify');

                                if (is_description) {
                                    return false;
                                }
                            }
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });
});

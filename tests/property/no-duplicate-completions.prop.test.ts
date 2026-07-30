/**
 * Property Test: No Duplicate Commands in Completions
 *
 * Feature: completion-improvements, Property 1: No Duplicate Commands in Completions
 * Validates: Requirements 1.1, 1.2
 *
 * For any prefix string and document state, when the Completion_Provider
 * generates command completions, the resulting list shall contain no
 * duplicate command names (each label appears at most once).
 */

import * as fc from 'fast-check';
import { CompletionProvider } from '../../src/providers/completion';
import { DocumentState, SymbolTable } from '../../src/types';
import { CommandDatabase } from '../../src/command-database';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { ContextTracker } from '../../src/context-tracker';
import { Position } from 'vscode-languageserver/node';

describe('Property 1: No Duplicate Commands in Completions', () => {
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
        const command_db = new CommandDatabase();
        command_db.register_all(BUILTIN_COMMANDS);
        completion_provider = new CompletionProvider(command_db);
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

    it('no duplicate labels in command completions', async () => {
        // Test with various prefixes
        const the_prefixes = ['g', 'ge', 'gen', 'r', 're', 'reg', 's', 'su', 'sum'];

        for (const my_prefix of the_prefixes) {
            const document = create_document(my_prefix);
            const position: Position = { line: 0, character: my_prefix.length };

            const completions = await completion_provider.get_completions(
                document,
                position,
                undefined
            );

            // Check for duplicates
            const the_labels = completions.map((c) => c.label);
            const unique_labels = new Set(the_labels);

            expect(the_labels.length).toBe(unique_labels.size);
        }
    });

    it('no duplicate labels in option completions', async () => {
        // Test with various option prefixes
        const the_test_cases = [
            { content: 'regress y x, n', position: 14 },
            { content: 'regress y x, v', position: 14 },
            { content: 'summarize x, d', position: 14 },
        ];

        for (const my_case of the_test_cases) {
            const document = create_document(my_case.content);
            const position: Position = { line: 0, character: my_case.position };

            const completions = await completion_provider.get_completions(
                document,
                position,
                undefined
            );

            // Check for duplicates
            const the_labels = completions.map((c) => c.label);
            const unique_labels = new Set(the_labels);

            expect(the_labels.length).toBe(unique_labels.size);
        }
    });

    it('property: randomly generated prefixes produce no duplicates', async () => {
        // Generate random prefixes from common command starting letters
        const prefix_gen = fc.stringOf(
            fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                           'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
            { minLength: 1, maxLength: 5 }
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

                // Check for duplicates
                const the_labels = completions.map((c) => c.label);
                const unique_labels = new Set(the_labels);

                return the_labels.length === unique_labels.size;
            }),
            { numRuns: 100 }
        );
    });

    it('each command appears at most once regardless of abbreviation', async () => {
        // Specifically test commands with abbreviations
        const the_commands_with_abbrevs = [
            { prefix: 'gen', full: 'generate' },
            { prefix: 'reg', full: 'regress' },
            { prefix: 'sum', full: 'summarize' },
            { prefix: 'tab', full: 'tabulate' },
            { prefix: 'des', full: 'describe' },
        ];

        for (const my_cmd of the_commands_with_abbrevs) {
            const document = create_document(my_cmd.prefix);
            const position: Position = { line: 0, character: my_cmd.prefix.length };

            const completions = await completion_provider.get_completions(
                document,
                position,
                undefined
            );

            // Count occurrences of the full command name
            const full_name_count = completions.filter(
                (c) => c.label === my_cmd.full
            ).length;

            // Should appear at most once
            expect(full_name_count).toBeLessThanOrEqual(1);

            // The abbreviation should NOT appear as a separate item
            const abbrev_count = completions.filter(
                (c) => c.label === my_cmd.prefix && c.label !== my_cmd.full
            ).length;

            // Abbreviation should not be a separate completion item
            // (unless it happens to be another command's full name)
            const is_another_command = BUILTIN_COMMANDS.some(
                (cmd) => cmd.name === my_cmd.prefix
            );
            if (!is_another_command) {
                expect(abbrev_count).toBe(0);
            }
        }
    });
});

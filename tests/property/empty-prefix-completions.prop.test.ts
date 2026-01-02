/**
 * Property Test: Empty Prefix Returns Empty Completions
 *
 * Feature: completion-improvements, Property 4: Empty Prefix Returns Empty Completions
 * Validates: Requirements 3.1, 3.2, 3.7, 6.4
 *
 * For any document position where the word prefix is empty (empty line,
 * whitespace-only before cursor), the Completion_Provider shall return an
 * empty completion list.
 *
 * NOTE: Option context (immediately after comma) is excluded from this property
 * because empty prefix in option context now returns all available options
 * per the option-completion-trigger spec.
 */

import * as fc from 'fast-check';
import { CompletionProvider, detect_completion_context } from '../../src/providers/completion';
import { DocumentState, SymbolTable } from '../../src/types';
import { command_database } from '../../src/command-database';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin-commands';
import { ContextTracker } from '../../src/context-tracker';
import { Position } from 'vscode-languageserver/node';

describe('Property 4: Empty Prefix Returns Empty Completions', () => {
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

    it('empty line returns empty completions', async () => {
        const document = create_document('\n\n\n');
        const position: Position = { line: 1, character: 0 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        expect(completions).toEqual([]);
    });

    it('whitespace-only line returns empty completions', async () => {
        const document = create_document('    \n   \n\t\t\n');
        const position: Position = { line: 1, character: 3 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        expect(completions).toEqual([]);
    });

    it('property: generated empty prefix positions return empty completions', async () => {
        // Generate various empty prefix scenarios
        // NOTE: Option context (after comma) is excluded because empty prefix
        // in option context now returns all available options (per Requirements 3.1)
        const empty_prefix_scenarios = fc.oneof(
            // Empty line
            fc.constant({ content: '\n\n\n', line: 1, character: 0 }),
            // Whitespace only
            fc.nat({ max: 10 }).map((spaces) => ({
                content: ' '.repeat(spaces) + '\n',
                line: 0,
                character: spaces,
            }))
        );

        await fc.assert(
            fc.asyncProperty(empty_prefix_scenarios, async (scenario) => {
                const document = create_document(scenario.content);
                const position: Position = {
                    line: scenario.line,
                    character: scenario.character,
                };

                const completions = await completion_provider.get_completions(
                    document,
                    position,
                    undefined
                );

                return completions.length === 0;
            }),
            { numRuns: 100 }
        );
    });

    it('non-empty prefix returns non-empty completions', async () => {
        // Verify that when we DO have a prefix, we get completions
        const document = create_document('gen');
        const position: Position = { line: 0, character: 3 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        expect(completions.length).toBeGreaterThan(0);
        expect(completions.some((c) => c.label === 'generate')).toBe(true);
    });

    it('option prefix returns option completions', async () => {
        // Verify that when we have an option prefix, we get option completions
        const document = create_document('regress y x, noc');
        const position: Position = { line: 0, character: 16 };

        const completions = await completion_provider.get_completions(
            document,
            position,
            undefined
        );

        expect(completions.length).toBeGreaterThan(0);
        expect(completions.some((c) => c.label === 'noconstant')).toBe(true);
    });
});

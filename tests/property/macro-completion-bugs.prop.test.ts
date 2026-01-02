/**
 * Property-Based Tests for Macro Completion Bug Fixes
 *
 * Bug 1: Backtick trigger should return both snippet AND macro completions
 * Bug 2: Extended macro syntax (`: list`) should suggest macro names
 *
 * These tests generalize from the specific examples in the bug reports.
 */

import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CompletionProvider, detect_completion_context } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { arbitrary_macro_name } from './generators/primitives';
import { parse_and_analyze } from './helpers/document-utils';

describe('Bug Fix Property Tests: Macro Completion', () => {
    let my_command_db: CommandDatabase;
    let my_completion_provider: CompletionProvider;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_completion_provider = new CompletionProvider(my_command_db, {
            snippet_support: true,
        });
    });

    describe('Bug 1: Backtick trigger returns snippet AND macro completions', () => {
        /**
         * Property 1: Backtick Trigger Includes Snippet
         * For any document with defined local macros, when the backtick
         * trigger character is used, the completions SHALL include the
         * "Local macro reference" snippet.
         */
        it('should always include snippet when backtick is trigger character', async () => {
            fc.assert(
                fc.asyncProperty(
                    // Generate 1-5 unique macro names
                    fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 5 })
                        .filter(names => new Set(names).size === names.length),
                    async (my_macro_names) => {
                        // Create document with macro definitions
                        const my_defs = my_macro_names
                            .map(name => `local ${name} = "value"`)
                            .join('\n');

                        // Add a line that triggers completion with backtick
                        const my_trigger = 'local fruit `';
                        const my_document = `${my_defs}\n${my_trigger}`;
                        const my_doc_state = parse_and_analyze(my_document);

                        // Calculate position at end of trigger
                        const my_num_lines = my_defs.split('\n').length;
                        const my_position = {
                            line: my_num_lines,
                            character: my_trigger.length,
                        };

                        // Get completions with backtick as trigger
                        const my_completions = await my_completion_provider.get_completions(
                            my_doc_state,
                            my_position,
                            '`'
                        );

                        // Should include the snippet
                        const my_has_snippet = my_completions.some(
                            c => c.label === 'Local macro reference'
                        );

                        return my_has_snippet;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2: Backtick Trigger Includes Macro Completions
         * For any document with defined local macros, when the backtick
         * trigger character is used, the completions SHALL include the
         * defined macros.
         */
        it('should include macro completions when backtick is trigger character', async () => {
            fc.assert(
                fc.asyncProperty(
                    // Generate 1-5 unique macro names
                    fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 5 })
                        .filter(names => new Set(names).size === names.length),
                    async (my_macro_names) => {
                        // Create document with macro definitions
                        const my_defs = my_macro_names
                            .map(name => `local ${name} = "value"`)
                            .join('\n');

                        // Add a line that triggers completion with backtick
                        const my_trigger = 'local fruit `';
                        const my_document = `${my_defs}\n${my_trigger}`;
                        const my_doc_state = parse_and_analyze(my_document);

                        // Calculate position at end of trigger
                        const my_num_lines = my_defs.split('\n').length;
                        const my_position = {
                            line: my_num_lines,
                            character: my_trigger.length,
                        };

                        // Get completions with backtick as trigger
                        const my_completions = await my_completion_provider.get_completions(
                            my_doc_state,
                            my_position,
                            '`'
                        );

                        // Should include at least one of the defined macros
                        const my_has_macro = my_completions.some(
                            c => my_macro_names.includes(c.label)
                        );

                        return my_has_macro;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
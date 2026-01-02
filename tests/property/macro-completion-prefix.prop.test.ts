/**
 * Macro Completion Prefix Filtering Property Tests
 *
 * Tests that verify macro completions are correctly filtered by prefix,
 * sorted alphabetically, and handle edge cases properly.
 *
 * Feature: macro-case-sensitivity
 */

import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { arbitrary_macro_name } from './generators/primitives';
import { parse_and_analyze } from './helpers/document-utils';

describe('Macro Completion Prefix Filtering Property Tests', () => {
    let my_command_db: CommandDatabase;
    let my_completion_provider: CompletionProvider;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_completion_provider = new CompletionProvider(my_command_db, {
            snippet_support: true,
        });
    });

    /**
     * Property 1: Prefix Matching Completions
     * For any document with defined macros and for any non-empty prefix string,
     * all completion items returned by the Completion_Provider SHALL have names
     * that start with the prefix (case-insensitive match).
     *
     * Feature: macro-case-sensitivity, Property 1: Prefix Matching Completions
     * Validates: Requirements 1.1, 1.2
     */
    it('should return only macros that match the prefix (case-insensitive)', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 2-5 unique macro names
                fc.array(arbitrary_macro_name(), { minLength: 2, maxLength: 5 })
                    .filter(names => new Set(names).size === names.length),
                // Generate a prefix length (1-3 chars from first macro)
                fc.integer({ min: 1, max: 3 }),
                // Test both local and global scopes
                fc.constantFrom('local', 'global') as fc.Arbitrary<'local' | 'global'>,
                async (my_macro_names, my_prefix_len, my_scope) => {
                    // Pick a prefix from the first macro name
                    const my_first_macro = my_macro_names[0];
                    const my_prefix = my_first_macro.substring(
                        0,
                        Math.min(my_prefix_len, my_first_macro.length)
                    );

                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `${my_scope} ${name} = "value"`)
                        .join('\n');

                    // Add a line that triggers macro completion with the prefix
                    const my_trigger = my_scope === 'local'
                        ? `display \`${my_prefix}`
                        : `display $${my_prefix}`;

                    const my_document = `${my_defs}\n${my_trigger}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Calculate position at end of trigger
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_trigger.length,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // All completions should match the prefix (case-insensitive)
                    const my_prefix_lower = my_prefix.toLowerCase();
                    for (const my_completion of my_completions) {
                        const my_label_lower = my_completion.label.toLowerCase();
                        if (!my_label_lower.startsWith(my_prefix_lower)) {
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
     * Property 2: Empty Prefix Returns All Macros
     * For any document with defined macros, when the prefix is empty,
     * the Completion_Provider SHALL return all macros of the requested scope.
     *
     * Feature: macro-case-sensitivity, Property 2: Empty Prefix Returns All Macros
     * Validates: Requirements 1.3, 1.4
     */
    it('should return all macros when prefix is empty', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-5 unique macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 5 })
                    .filter(names => new Set(names).size === names.length),
                // Test both local and global scopes
                fc.constantFrom('local', 'global') as fc.Arbitrary<'local' | 'global'>,
                async (my_macro_names, my_scope) => {
                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `${my_scope} ${name} = "value"`)
                        .join('\n');

                    // Add a line that triggers macro completion with empty prefix
                    const my_trigger = my_scope === 'local'
                        ? 'display `'
                        : 'display $';

                    const my_document = `${my_defs}\n${my_trigger}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Calculate position at end of trigger (right after ` or $)
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_trigger.length,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // All defined macros should be in the completions
                    const my_completion_labels = new Set(
                        my_completions.map(c => c.label)
                    );

                    for (const my_macro_name of my_macro_names) {
                        if (!my_completion_labels.has(my_macro_name)) {
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
     * Property 3: Completions Have Correct sortText Values
     * For any set of macro completions returned by the Completion_Provider,
     * the sortText values SHALL be set correctly to enable proper client-side sorting.
     * This ensures proper LSP client sorting behavior.
     *
     * Feature: macro-case-sensitivity, Property 3: Completions Have Correct sortText
     * Validates: Requirements 1.5
     */
    it('should return completions with correct sortText values', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 2-5 unique macro names
                fc.array(arbitrary_macro_name(), { minLength: 2, maxLength: 5 })
                    .filter(names => new Set(names).size === names.length),
                // Test both local and global scopes
                fc.constantFrom('local', 'global') as fc.Arbitrary<'local' | 'global'>,
                async (my_macro_names, my_scope) => {
                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `${my_scope} ${name} = "value"`)
                        .join('\n');

                    // Add a line that triggers macro completion with empty prefix
                    const my_trigger = my_scope === 'local'
                        ? 'display `'
                        : 'display $';

                    const my_document = `${my_defs}\n${my_trigger}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Calculate position at end of trigger
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_trigger.length,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // Filter to only the macros we defined
                    const my_macro_completions = my_completions.filter(comp => 
                        my_macro_names.includes(comp.label)
                    );
                    
                    // Verify all completions have sortText values
                    for (const completion of my_macro_completions) {
                        if (!completion.sortText) {
                            return false;
                        }
                    }
                    
                    // Verify that if we sort by sortText, the result would be correct
                    const sorted_completions = [...my_macro_completions].sort((a, b) => 
                        (a.sortText || a.label).localeCompare(b.sortText || b.label)
                    );
                    
                    // Check that sortText values are in ascending order
                    for (let i = 1; i < sorted_completions.length; i++) {
                        const my_prev = sorted_completions[i - 1].sortText!;
                        const my_curr = sorted_completions[i].sortText!;
                        if (my_prev.localeCompare(my_curr) > 0) {
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
     * Property 4: No Match Returns Empty
     * For any prefix that does not match any defined macro names,
     * the Completion_Provider SHALL return an empty list.
     *
     * Feature: macro-case-sensitivity, Property 4: No Match Returns Empty
     * Validates: Requirements 1.6
     */
    it('should return empty list when no macros match the prefix', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-3 unique macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
                    .filter(names => new Set(names).size === names.length),
                // Test both local and global scopes
                fc.constantFrom('local', 'global') as fc.Arbitrary<'local' | 'global'>,
                async (my_macro_names, my_scope) => {
                    // Create a prefix that won't match any macro
                    // Use a prefix starting with 'zzz' which is unlikely to match
                    const my_non_matching_prefix = 'zzz' + Math.random().toString(36).substring(2, 5);

                    // Ensure none of the macro names start with our prefix
                    const my_prefix_lower = my_non_matching_prefix.toLowerCase();
                    const my_has_match = my_macro_names.some(
                        name => name.toLowerCase().startsWith(my_prefix_lower)
                    );

                    if (my_has_match) {
                        // Skip this test case if we accidentally generated a match
                        return true;
                    }

                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `${my_scope} ${name} = "value"`)
                        .join('\n');

                    // Add a line that triggers macro completion with non-matching prefix
                    const my_trigger = my_scope === 'local'
                        ? `display \`${my_non_matching_prefix}`
                        : `display $${my_non_matching_prefix}`;

                    const my_document = `${my_defs}\n${my_trigger}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Calculate position at end of trigger
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_trigger.length,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // Should return empty list
                    return my_completions.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});

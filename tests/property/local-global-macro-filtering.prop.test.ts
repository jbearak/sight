/**
 * Property-Based Tests for Local vs Global Macro Completion Filtering
 *
 * Tests that verify the completion provider correctly filters local and global
 * macros based on the prefix character used (backtick for local, dollar for global).
 *
 * Feature: local-global-macro-completion
 */

import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { arbitrary_macro_name } from './generators/primitives';
import { parse_and_analyze } from './helpers/document-utils';

describe('Local vs Global Macro Completion Filtering Property Tests', () => {
    let my_command_db: CommandDatabase;
    let my_completion_provider: CompletionProvider;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_completion_provider = new CompletionProvider(my_command_db, {
            snippet_support: true,
        });
    });

    /**
     * Property 1: Backtick Prefix Returns Only Local Macros
     * For any document with local and global macros, when the user types a
     * backtick (`) followed by a prefix, all returned completion items shall
     * be local macros, and no global macros shall be returned.
     *
     * Feature: local-global-macro-completion, Property 1: Backtick Prefix Returns Only Local Macros
     * Validates: Requirements 1.5, 1.6
     */
    it('should return only local macros with backtick prefix', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-3 unique local macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
                    .filter(names => new Set(names).size === names.length),
                // Generate 1-3 unique global macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
                    .filter(names => new Set(names).size === names.length),
                async (my_local_names, my_global_names) => {
                    // Ensure no overlap between local and global names for this test
                    const my_local_set = new Set(my_local_names.map(n => n.toLowerCase()));
                    const my_filtered_globals = my_global_names.filter(
                        n => !my_local_set.has(n.toLowerCase())
                    );
                    if (my_filtered_globals.length === 0) {
                        return true; // Skip if all globals overlap with locals
                    }

                    // Create document with both local and global macro definitions
                    const my_local_defs = my_local_names
                        .map(name => `local ${name} = "local_value"`)
                        .join('\n');
                    const my_global_defs = my_filtered_globals
                        .map(name => `global ${name} = "global_value"`)
                        .join('\n');

                    // Trigger local macro completion with backtick
                    const my_trigger = 'display `';
                    const my_document = `${my_local_defs}\n${my_global_defs}\n${my_trigger}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Calculate position at end of trigger
                    const my_num_lines = my_local_defs.split('\n').length +
                        my_global_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_trigger.length,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // Filter out snippet completions
                    const my_macro_completions = my_completions.filter(
                        c => c.detail && c.detail.includes('macro')
                    );

                    // All completions should be local macros
                    for (const my_completion of my_macro_completions) {
                        if (!my_completion.detail?.includes('local macro')) {
                            return false;
                        }
                    }

                    // No global macros should be in completions
                    const my_completion_labels = new Set(my_macro_completions.map(c => c.label));
                    for (const my_global_name of my_filtered_globals) {
                        if (my_completion_labels.has(my_global_name)) {
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
     * Property 2: Dollar Prefix Returns Only Global Macros
     * For any document with local and global macros, when the user types a
     * dollar sign ($) followed by a prefix, all returned completion items shall
     * be global macros, and no local macros shall be returned.
     *
     * Feature: local-global-macro-completion, Property 2: Dollar Prefix Returns Only Global Macros
     * Validates: Requirements 2.6, 2.7
     */
    it('should return only global macros with dollar prefix', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-3 unique local macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
                    .filter(names => new Set(names).size === names.length),
                // Generate 1-3 unique global macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
                    .filter(names => new Set(names).size === names.length),
                async (my_local_names, my_global_names) => {
                    // Ensure no overlap between local and global names for this test
                    const my_global_set = new Set(my_global_names.map(n => n.toLowerCase()));
                    const my_filtered_locals = my_local_names.filter(
                        n => !my_global_set.has(n.toLowerCase())
                    );
                    if (my_filtered_locals.length === 0) {
                        return true; // Skip if all locals overlap with globals
                    }

                    // Create document with both local and global macro definitions
                    const my_local_defs = my_filtered_locals
                        .map(name => `local ${name} = "local_value"`)
                        .join('\n');
                    const my_global_defs = my_global_names
                        .map(name => `global ${name} = "global_value"`)
                        .join('\n');

                    // Trigger global macro completion with dollar sign
                    const my_trigger = 'display $';
                    const my_document = `${my_local_defs}\n${my_global_defs}\n${my_trigger}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Calculate position at end of trigger
                    const my_num_lines = my_local_defs.split('\n').length +
                        my_global_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_trigger.length,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // Filter to only macro completions
                    const my_macro_completions = my_completions.filter(
                        c => c.detail && c.detail.includes('macro')
                    );

                    // All completions should be global macros
                    for (const my_completion of my_macro_completions) {
                        if (!my_completion.detail?.includes('global macro')) {
                            return false;
                        }
                    }

                    // No local macros should be in completions
                    const my_completion_labels = new Set(my_macro_completions.map(c => c.label));
                    for (const my_local_name of my_filtered_locals) {
                        if (my_completion_labels.has(my_local_name)) {
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
     * Property 3: Local Macros Labeled as "local macro"
     * For any local macro in the completion results, the detail field shall
     * contain the text "local macro".
     *
     * Feature: local-global-macro-completion, Property 3: Local Macros Labeled as "local macro"
     * Validates: Requirements 3.1, 3.3
     */
    it('should label local macros as "local macro" in detail field', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-5 unique local macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 5 })
                    .filter(names => new Set(names).size === names.length),
                async (my_local_names) => {
                    // Create document with local macro definitions
                    const my_defs = my_local_names
                        .map(name => `local ${name} = "value"`)
                        .join('\n');

                    // Trigger local macro completion
                    const my_trigger = 'display `';
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

                    // Filter to only our defined macros
                    const my_macro_completions = my_completions.filter(
                        c => my_local_names.includes(c.label)
                    );

                    // All should have "local macro" in detail
                    for (const my_completion of my_macro_completions) {
                        if (!my_completion.detail?.includes('local macro')) {
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
     * Property 4: Global Macros Labeled as "global macro"
     * For any global macro in the completion results, the detail field shall
     * contain the text "global macro".
     *
     * Feature: local-global-macro-completion, Property 4: Global Macros Labeled as "global macro"
     * Validates: Requirements 3.2, 3.4
     */
    it('should label global macros as "global macro" in detail field', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-5 unique global macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 5 })
                    .filter(names => new Set(names).size === names.length),
                async (my_global_names) => {
                    // Create document with global macro definitions
                    const my_defs = my_global_names
                        .map(name => `global ${name} = "value"`)
                        .join('\n');

                    // Trigger global macro completion
                    const my_trigger = 'display $';
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

                    // Filter to only our defined macros
                    const my_macro_completions = my_completions.filter(
                        c => my_global_names.includes(c.label)
                    );

                    // All should have "global macro" in detail
                    for (const my_completion of my_macro_completions) {
                        if (!my_completion.detail?.includes('global macro')) {
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
     * Property 5: Backtick Filtering Independent of Definition Order
     * For any document where a global macro is defined before a local macro
     * with the same name, when the user types a backtick (`) followed by the
     * prefix, the completion provider shall return only the local macro.
     *
     * Feature: local-global-macro-completion, Property 5: Backtick Filtering Independent of Definition Order
     * Validates: Requirements 1.4, 4.1
     */
    it('should return local macro with backtick prefix regardless of definition order', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate a macro name that will be used for both local and global
                arbitrary_macro_name(),
                async (my_shared_name) => {
                    // Define global BEFORE local (order should not matter)
                    const my_document = `global ${my_shared_name} = "global_value"
local ${my_shared_name} = "local_value"
display \``;

                    const my_doc_state = parse_and_analyze(my_document);

                    // Position at end of backtick trigger
                    const my_position = {
                        line: 2,
                        character: 9,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // Filter to only macro completions with our name
                    const my_matching = my_completions.filter(
                        c => c.label === my_shared_name && c.detail?.includes('macro')
                    );

                    // Should have exactly one completion (the local one)
                    if (my_matching.length !== 1) {
                        return false;
                    }

                    // It should be labeled as local macro
                    if (!my_matching[0].detail?.includes('local macro')) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 6: Dollar Filtering Independent of Definition Order
     * For any document where a local macro is defined before a global macro
     * with the same name, when the user types a dollar sign ($) followed by
     * the prefix, the completion provider shall return only the global macro.
     *
     * Feature: local-global-macro-completion, Property 6: Dollar Filtering Independent of Definition Order
     * Validates: Requirements 2.5, 4.2
     */
    it('should return global macro with dollar prefix regardless of definition order', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate a macro name that will be used for both local and global
                arbitrary_macro_name(),
                async (my_shared_name) => {
                    // Define local BEFORE global (order should not matter)
                    const my_document = `local ${my_shared_name} = "local_value"
global ${my_shared_name} = "global_value"
display $`;

                    const my_doc_state = parse_and_analyze(my_document);

                    // Position at end of dollar trigger
                    const my_position = {
                        line: 2,
                        character: 9,
                    };

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // Filter to only macro completions with our name
                    const my_matching = my_completions.filter(
                        c => c.label === my_shared_name && c.detail?.includes('macro')
                    );

                    // Should have exactly one completion (the global one)
                    if (my_matching.length !== 1) {
                        return false;
                    }

                    // It should be labeled as global macro
                    if (!my_matching[0].detail?.includes('global macro')) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Shadowing Respects Scope Rules
     * For any document where a local macro shadows a global macro with the
     * same name, when the user types a backtick (`) the local macro is
     * suggested, and when the user types a dollar sign ($) the global macro
     * is suggested.
     *
     * Feature: local-global-macro-completion, Property 7: Shadowing Respects Scope Rules
     * Validates: Requirements 4.3
     */
    it('should respect scope rules when local shadows global', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate a macro name for shadowing
                arbitrary_macro_name(),
                async (my_shared_name) => {
                    // Create document with both local and global with same name
                    const my_document = `local ${my_shared_name} = "local_value"
global ${my_shared_name} = "global_value"
display \`
display $`;

                    const my_doc_state = parse_and_analyze(my_document);

                    // Test backtick context (line 2)
                    const my_backtick_position = { line: 2, character: 9 };
                    const my_backtick_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_backtick_position
                    );

                    // Test dollar context (line 3)
                    const my_dollar_position = { line: 3, character: 9 };
                    const my_dollar_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_dollar_position
                    );

                    // Filter to matching macros
                    const my_backtick_matching = my_backtick_completions.filter(
                        c => c.label === my_shared_name && c.detail?.includes('macro')
                    );
                    const my_dollar_matching = my_dollar_completions.filter(
                        c => c.label === my_shared_name && c.detail?.includes('macro')
                    );

                    // Backtick should return local macro
                    if (my_backtick_matching.length !== 1 ||
                        !my_backtick_matching[0].detail?.includes('local macro')) {
                        return false;
                    }

                    // Dollar should return global macro
                    if (my_dollar_matching.length !== 1 ||
                        !my_dollar_matching[0].detail?.includes('global macro')) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 8: Analyzer Classifies Local Macros Correctly
     * For any macro definition with the `local` keyword, the analyzer shall
     * place it in the symbol table's `localMacros` map, not in `globalMacros`.
     *
     * Feature: local-global-macro-completion, Property 8: Analyzer Classifies Local Macros Correctly
     * Validates: Requirements 5.1, 5.3
     */
    it('should classify local macros in localMacros map', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-5 unique local macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 5 })
                    .filter(names => new Set(names).size === names.length),
                async (my_local_names) => {
                    // Create document with local macro definitions
                    const my_defs = my_local_names
                        .map(name => `local ${name} = "value"`)
                        .join('\n');

                    const my_doc_state = parse_and_analyze(my_defs);

                    // All local macros should be in localMacros
                    for (const my_name of my_local_names) {
                        if (!my_doc_state.symbols.localMacros.has(my_name)) {
                            return false;
                        }
                    }

                    // None should be in globalMacros
                    for (const my_name of my_local_names) {
                        if (my_doc_state.symbols.globalMacros.has(my_name)) {
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
     * Property 9: Analyzer Classifies Global Macros Correctly
     * For any macro definition with the `global` keyword, the analyzer shall
     * place it in the symbol table's `globalMacros` map, not in `localMacros`.
     *
     * Feature: local-global-macro-completion, Property 9: Analyzer Classifies Global Macros Correctly
     * Validates: Requirements 5.2, 5.3
     */
    it('should classify global macros in globalMacros map', () => {
        fc.assert(
            fc.asyncProperty(
                // Generate 1-5 unique global macro names
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 5 })
                    .filter(names => new Set(names).size === names.length),
                async (my_global_names) => {
                    // Create document with global macro definitions
                    const my_defs = my_global_names
                        .map(name => `global ${name} = "value"`)
                        .join('\n');

                    const my_doc_state = parse_and_analyze(my_defs);

                    // All global macros should be in globalMacros
                    for (const my_name of my_global_names) {
                        if (!my_doc_state.symbols.globalMacros.has(my_name)) {
                            return false;
                        }
                    }

                    // None should be in localMacros
                    for (const my_name of my_global_names) {
                        if (my_doc_state.symbols.localMacros.has(my_name)) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

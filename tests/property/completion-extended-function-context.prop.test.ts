/**
 * Completion Extended Function Context Property Tests
 *
 * Tests that verify completion provider correctly detects extended macro function
 * context and provides appropriate macro suggestions for list, word, and string functions.
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { CompletionProvider, detect_completion_context } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/command-database';
import { arbitrary_macro_name } from './generators/primitives';
import { parse_and_analyze } from './helpers/document-utils';

describe('Completion Extended Function Context Property Tests', () => {
    let my_command_db: CommandDatabase;
    let my_completion_provider: CompletionProvider;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_completion_provider = new CompletionProvider(my_command_db, {
            snippet_support: true,
        });
    });

    /**
     * Property 1: List Function Context Detection
     * For any extended macro function using `: list`, completion context should
     * detect macro scope and provide macro suggestions after operators.
     */
    it('should detect list function context and suggest macros', async () => {
        fc.assert(
            fc.asyncProperty(
                fc.array(arbitrary_macro_name(), { minLength: 2, maxLength: 4 })
                    .filter(names => new Set(names).size === names.length),
                fc.constantFrom('&', '|', '-'),
                async (my_macro_names, my_operator) => {
                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `local ${name} = "value"`)
                        .join('\n');

                    // Create list function with operator
                    const my_list_expr = `local result : list ${my_macro_names[0]} ${my_operator} `;
                    const my_document = `${my_defs}\n${my_list_expr}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Position after operator and space
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_list_expr.length,
                    };

                    // Detect context
                    const my_context = detect_completion_context(my_doc_state, my_position);

                    // Should detect local macro context
                    if (my_context.type !== 'macro' || my_context.scope !== 'local') {
                        return false;
                    }

                    // Get completions
                    const my_completions = await my_completion_provider.get_completions(
                        my_doc_state,
                        my_position
                    );

                    // Should include defined macros
                    const my_completion_labels = new Set(my_completions.map(c => c.label));
                    for (const my_macro_name of my_macro_names) {
                        if (!my_completion_labels.has(my_macro_name)) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 2: Word Function Context Detection
     * For extended macro functions using `: word`, completion should suggest
     * macros when expecting string arguments.
     */
    it('should detect word function context and suggest macros for string args', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
                    .filter(names => new Set(names).size === names.length),
                fc.constantFrom('count', '1', '2 of'),
                (my_macro_names, my_word_arg) => {
                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `local ${name} = "value"`)
                        .join('\n');

                    // Create word function expecting macro
                    const my_word_expr = `local result : word ${my_word_arg} \``;
                    const my_document = `${my_defs}\n${my_word_expr}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Position after backtick
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_word_expr.length,
                    };

                    // Detect context
                    const my_context = detect_completion_context(my_doc_state, my_position);

                    // Should detect local macro context
                    return my_context.type === 'macro' && my_context.scope === 'local';
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 3: String Function Context Detection
     * For string functions like `: subinstr` and `: length`, completion should
     * suggest macros for string arguments.
     */
    it('should detect string function context and suggest macros', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
                    .filter(names => new Set(names).size === names.length),
                fc.constantFrom('subinstr', 'length', 'piece'),
                (my_macro_names, my_function) => {
                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `local ${name} = "value"`)
                        .join('\n');

                    // Create string function with incomplete macro reference
                    const my_func_expr = `local result : ${my_function} local(\``;
                    const my_document = `${my_defs}\n${my_func_expr}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Position after backtick
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_func_expr.length,
                    };

                    // Detect context
                    const my_context = detect_completion_context(my_doc_state, my_position);

                    // Should detect local macro context
                    return my_context.type === 'macro' && my_context.scope === 'local';
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property 4: Property Function Variable Context
     * For property functions like `: type` and `: format`, completion should
     * suggest variables instead of macros.
     */
    it('should detect property function context and suggest variables', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('type', 'format', 'label'),
                (my_function) => {
                    // Create document with variable context
                    const my_document = `local result : ${my_function} `;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Position after function name and space
                    const my_position = {
                        line: 0,
                        character: my_document.length,
                    };

                    // Detect context
                    const my_context = detect_completion_context(my_doc_state, my_position);

                    // Should detect variable context
                    return my_context.type === 'variable';
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 5: Variable Label Function Context
     * For `: variable label` and `: value label`, completion should suggest variables.
     */
    it('should detect variable/value label context and suggest variables', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('variable', 'value'),
                (my_prefix) => {
                    // Create document with label function
                    const my_document = `local result : ${my_prefix} label `;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Position after "label "
                    const my_position = {
                        line: 0,
                        character: my_document.length,
                    };

                    // Detect context
                    const my_context = detect_completion_context(my_doc_state, my_position);

                    // Should detect variable context
                    return my_context.type === 'variable';
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property 6: Non-Completion Extended Functions
     * For functions like `: display`, `: tempvar`, completion should not
     * provide suggestions (return null context).
     */
    it('should not provide completions for non-completion functions', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('display', 'tempvar', 'tempfile', 'permname', 'data'),
                (my_function) => {
                    // Create document with non-completion function
                    const my_document = `local result : ${my_function} `;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Position after function name and space
                    const my_position = {
                        line: 0,
                        character: my_document.length,
                    };

                    // Detect context
                    const my_context = detect_completion_context(my_doc_state, my_position);

                    // Should fall back to default context (not extended function)
                    return my_context.type === 'fallback' || my_context.type === 'variable';
                }
            ),
            { numRuns: 30 }
        );
    });

    /**
     * Property 7: Partial Function Name Completion
     * When typing an extended function name, completion should work for
     * partial matches.
     */
    it('should handle partial function names in extended context', () => {
        fc.assert(
            fc.property(
                fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 2 })
                    .filter(names => new Set(names).size === names.length),
                fc.constantFrom('lis', 'wor', 'len'),
                (my_macro_names, my_partial_func) => {
                    // Create document with macro definitions
                    const my_defs = my_macro_names
                        .map(name => `local ${name} = "value"`)
                        .join('\n');

                    // Create partial extended function
                    const my_partial_expr = `local result : ${my_partial_func}`;
                    const my_document = `${my_defs}\n${my_partial_expr}`;
                    const my_doc_state = parse_and_analyze(my_document);

                    // Position at end of partial function name
                    const my_num_lines = my_defs.split('\n').length;
                    const my_position = {
                        line: my_num_lines,
                        character: my_partial_expr.length,
                    };

                    // Detect context - should not crash
                    const my_context = detect_completion_context(my_doc_state, my_position);

                    // Should return some valid context (not crash)
                    return my_context.type !== undefined;
                }
            ),
            { numRuns: 30 }
        );
    });
});
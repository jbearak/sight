import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { detect_completion_context } from '../../src/providers/completion';
import { DocumentState, DocumentStore } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { Position } from 'vscode-languageserver';
import { create_completion_handler } from '../../src/server-handlers';
import type { HandlerDependencies } from '../../src/server-handlers';

/**
 * Property tests for isIncomplete reflecting macro context.
 *
 * Property 10: isIncomplete reflects macro context
 *
 * For any completion request, the returned isIncomplete flag
 * shall be true if and only if the detected completion context
 * type is 'macro'.
 *
 * **Validates: Requirements 9.1, 9.2**
 */
describe('Completion isIncomplete Property Tests', () => {
    /**
     * Helper to create a minimal document state for testing.
     */
    function create_mock_document(content: string): DocumentState {
        return {
            uri: 'file:///test.do',
            content,
            version: 1,
            symbols: {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            tokens: [],
            ast: { nodes: [] },
            diagnostics: [],
            context_ranges: [],
            context_tracker: new ContextTracker(),
            line_offsets: [0],
            forward_calls: [],
            token_line_index: new Map(),
        };
    }

    /**
     * Generator for non-macro Stata source lines that produce
     * non-macro context types (command, option, variable, fallback).
     */
    function arbitrary_non_macro_line(): fc.Arbitrary<string> {
        return fc.oneof(
            // Command context: start of line with partial command
            fc.constantFrom(
                'gen',
                'reg',
                'sum',
                'display',
                'list',
                'describe',
                'tabulate',
                'sort',
                'merge',
                'append'
            ),
            // Variable context: after a command name
            fc.constantFrom(
                'gen x',
                'regress y x',
                'summarize income',
                'list var1 var2',
                'drop myvar',
                'keep age income'
            ),
            // Option context: after comma
            fc.constantFrom(
                'regress y x, ',
                'summarize income, ',
                'list var1, ',
                'tabulate x y, '
            ),
            // Fallback context: empty or whitespace
            fc.constantFrom(
                '',
                '   '
            )
        );
    }

    /**
     * Generator for macro trigger patterns that produce macro
     * context type.
     */
    function arbitrary_macro_line(): fc.Arbitrary<string> {
        return fc.oneof(
            // Local macro: backtick followed by optional identifier
            fc.tuple(
                fc.constantFrom('', 'display ', 'gen x = '),
                fc.constant('`'),
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,5}$/)
            ).map(([my_prefix, my_backtick, my_id]) =>
                `${my_prefix}${my_backtick}${my_id}`
            ),
            // Global macro unbraced: $ followed by identifier chars
            fc.tuple(
                fc.constantFrom('', 'display ', 'gen x = '),
                fc.constant('$'),
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,5}$/)
            ).map(([my_prefix, my_dollar, my_id]) =>
                `${my_prefix}${my_dollar}${my_id}`
            ),
            // Global macro braced: ${ followed by identifier chars
            fc.tuple(
                fc.constantFrom('', 'display ', 'gen x = '),
                fc.constant('${'),
                fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,5}$/)
            ).map(([my_prefix, my_dollar_brace, my_id]) =>
                `${my_prefix}${my_dollar_brace}${my_id}`
            ),
            // Bare backtick (local macro start)
            fc.constantFrom(
                '`',
                'display `',
                'gen x = `'
            ),
            // Bare dollar (global macro start)
            fc.constantFrom(
                '$',
                'display $',
                'gen x = $'
            )
        );
    }

    /**
     * Property 10: Non-macro contexts produce isIncomplete=false
     *
     * For any completion request in a non-macro context, the
     * detected context type is not 'macro', so isIncomplete
     * shall be false.
     *
     * **Validates: Requirements 9.1**
     */
    it('non-macro contexts produce isIncomplete=false', () => {
        fc.assert(
            fc.property(
                arbitrary_non_macro_line(),
                (my_line) => {
                    const my_document = create_mock_document(my_line);
                    const my_position = Position.create(
                        0,
                        my_line.length
                    );

                    const my_context = detect_completion_context(
                        my_document,
                        my_position,
                        my_document.tokens
                    );

                    // Context should not be macro
                    expect(my_context.type).not.toBe('macro');

                    // isIncomplete logic: type === 'macro'
                    const is_macro_context =
                        my_context.type === 'macro';
                    expect(is_macro_context).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 10: Macro contexts produce isIncomplete=true
     *
     * For any completion request in a macro context (local macro,
     * global macro, or compound quote trigger), the detected
     * context type is 'macro', so isIncomplete shall be true.
     *
     * **Validates: Requirements 9.2**
     */
    it('macro contexts produce isIncomplete=true', () => {
        fc.assert(
            fc.property(
                arbitrary_macro_line(),
                (my_line) => {
                    const my_document = create_mock_document(my_line);
                    const my_position = Position.create(
                        0,
                        my_line.length
                    );

                    const my_context = detect_completion_context(
                        my_document,
                        my_position,
                        my_document.tokens
                    );

                    // Context should be macro
                    expect(my_context.type).toBe('macro');

                    // isIncomplete logic: type === 'macro'
                    const is_macro_context =
                        my_context.type === 'macro';
                    expect(is_macro_context).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 10: isIncomplete is true iff context type is 'macro'
     *
     * For any generated Stata source line (macro or non-macro),
     * the isIncomplete flag (computed as type === 'macro') shall
     * be true if and only if the context type is 'macro'.
     *
     * This is the biconditional property: isIncomplete ↔ macro.
     *
     * **Validates: Requirements 9.1, 9.2**
     */
    it('isIncomplete is true iff context type is macro', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.oneof(
                    arbitrary_non_macro_line(),
                    arbitrary_macro_line()
                ),
                async (my_line) => {
                    const my_uri = 'file:///biconditional.do';
                    const document_store = new DocumentStore();
                    try {
                        await document_store.open(
                            my_uri,
                            my_line,
                            1
                        );

                        const deps: HandlerDependencies = {
                            debounce_manager: null,
                            document_store,
                            diagnostics_provider: null,
                            completion_provider: {
                                get_completions:
                                    async () => [],
                            },
                            hover_provider: null,
                            definition_provider: null,
                            references_provider: null,
                            symbol_provider: null,
                            formatter_provider: null,
                            workspace_indexer: null,
                            scope_resolver: null,
                            forward_scope_resolver: null,
                            rename_handler: null,
                            get_document_settings:
                                async () => ({}) as any,
                            connection: {
                                sendDiagnostics: () => {},
                                console: {
                                    log: () => {},
                                },
                            },
                        } as any;

                        const handler =
                            create_completion_handler(deps);
                        const my_position = Position.create(
                            0,
                            my_line.length
                        );

                        const my_result = await handler(
                            {
                                textDocument: {
                                    uri: my_uri,
                                },
                                position: my_position,
                            },
                            undefined
                        );

                        const my_document =
                            document_store.get(my_uri)!;
                        const my_context =
                            detect_completion_context(
                                my_document,
                                my_position,
                                my_document.tokens
                            );

                        // Biconditional: handler
                        // isIncomplete ↔ macro context
                        if (my_context.type === 'macro') {
                            expect(
                                my_result.isIncomplete
                            ).toBe(true);
                        } else {
                            expect(
                                my_result.isIncomplete
                            ).toBe(false);
                        }
                    } finally {
                        await document_store.dispose();
                    }
                }
            ),
            { numRuns: 200 }
        );
    });

    /**
     * Property 10: All non-macro context types produce
     * isIncomplete=false
     *
     * For representative inputs that produce each non-macro
     * context type (command, option, variable, fallback), the
     * isIncomplete flag (type === 'macro') shall be false.
     * For macro inputs, it shall be true.
     *
     * **Validates: Requirements 9.1, 9.2**
     */
    it('only macro type maps to isIncomplete=true among all context types', () => {
        const the_context_inputs: Array<{
            line: string;
            expected_macro: boolean;
        }> = [
            // Non-macro contexts → isIncomplete=false
            { line: 'gen', expected_macro: false },
            { line: 'regress', expected_macro: false },
            { line: 'gen x', expected_macro: false },
            { line: 'regress y x', expected_macro: false },
            { line: 'regress y x, ', expected_macro: false },
            { line: '', expected_macro: false },
            { line: '   ', expected_macro: false },
            // Macro contexts → isIncomplete=true
            { line: '`myvar', expected_macro: true },
            { line: 'display `x', expected_macro: true },
            { line: '$myvar', expected_macro: true },
            { line: 'display $x', expected_macro: true },
            { line: '${myvar', expected_macro: true },
            { line: 'display ${x', expected_macro: true },
            { line: '`', expected_macro: true },
            { line: '$', expected_macro: true },
        ];

        for (const my_input of the_context_inputs) {
            const my_document = create_mock_document(my_input.line);
            const my_position = Position.create(
                0,
                my_input.line.length
            );

            const my_context = detect_completion_context(
                my_document,
                my_position,
                my_document.tokens
            );

            const is_incomplete = my_context.type === 'macro';

            // The biconditional: isIncomplete ↔ macro
            expect(is_incomplete).toBe(my_input.expected_macro);
        }
    });
});

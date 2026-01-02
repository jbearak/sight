/**
 * Property tests for macro completion suffix handling
 * 
 * Tests that macro completions correctly handle closing delimiters:
 * - Local macros: append apostrophe only if not already present
 * - Global braced macros: append brace only if not already present
 */

import * as fc from 'fast-check';
import { Position, Range } from 'vscode-languageserver';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/command-database';
import { DocumentState } from '../../src/document-store';
import { SymbolTable } from '../../src/types';

describe('Macro Completion Suffix Handling Properties', () => {
    let completion_provider: CompletionProvider;
    let command_db: CommandDatabase;

    beforeEach(() => {
        command_db = new CommandDatabase();
        completion_provider = new CompletionProvider(command_db);
    });

    /**
     * Property 8: Local macro suffix handling
     * Inserted text SHALL include closing apostrophe if and only if 
     * no apostrophe immediately follows replacement range
     */
    test('Property 8: Local macro closing apostrophe handling', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    macro_name: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/),
                    prefix: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,5}$/),
                    has_closing_apostrophe: fc.boolean(),
                    extra_chars_after: fc.stringMatching(/^[a-zA-Z0-9_]{0,3}$/),
                }),
                async ({ macro_name, prefix, has_closing_apostrophe, extra_chars_after }) => {
                    // Skip if prefix doesn't match macro name
                    if (!macro_name.toLowerCase().startsWith(prefix.toLowerCase())) {
                        return;
                    }

                    // Create document content with local macro reference
                    const closing_part = has_closing_apostrophe ? "'" : '';
                    const after_part = has_closing_apostrophe ? extra_chars_after : '';
                    const content = `local result \`${prefix}${closing_part}${after_part}`;
                    const cursor_pos = Position.create(0, `local result \`${prefix}`.length);

                    // Create document state with macro in symbol table
                    const symbols: SymbolTable = {
                        localMacros: new Map([[macro_name, {
                            name: macro_name,
                            value: 'test_value',
                            sourceUri: 'file:///test.do',
                            location: {
                                range: Range.create(0, 0, 0, 10),
                                uri: 'file:///test.do'
                            }
                        }]]),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    };

                    const document: DocumentState = {
                        uri: 'file:///test.do',
                        content,
                        version: 1,
                        symbols,
                        ast: null,
                        tokens: [],
                        diagnostics: [],
                        context_tracker: undefined,
                    };

                    // Get completions
                    const the_completions = await completion_provider.get_completions(
                        document,
                        cursor_pos
                    );

                    // Find the completion for our macro
                    const my_completion = the_completions.find(c => c.label === macro_name);
                    expect(my_completion).toBeDefined();
                    expect(my_completion?.textEdit).toBeDefined();

                    if (my_completion?.textEdit && 'newText' in my_completion.textEdit) {
                        const new_text = my_completion.textEdit.newText;
                        
                        // Property: closing apostrophe included if and only if not already present
                        if (has_closing_apostrophe) {
                            expect(new_text).toBe(macro_name); // No apostrophe added
                        } else {
                            expect(new_text).toBe(macro_name + "'"); // Apostrophe added
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 9: Global macro brace suffix handling
     * Inserted text SHALL include closing brace if and only if 
     * no } immediately follows replacement range
     */
    test('Property 9: Global macro closing brace handling', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    macro_name: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/),
                    prefix: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,5}$/),
                    has_closing_brace: fc.boolean(),
                    extra_chars_after: fc.stringMatching(/^[a-zA-Z0-9_]{0,3}$/),
                }),
                async ({ macro_name, prefix, has_closing_brace, extra_chars_after }) => {
                    // Skip if prefix doesn't match macro name
                    if (!macro_name.toLowerCase().startsWith(prefix.toLowerCase())) {
                        return;
                    }

                    // Create document content with global braced macro reference
                    const closing_part = has_closing_brace ? '}' : '';
                    const after_part = has_closing_brace ? extra_chars_after : '';
                    const content = `local result \${${prefix}${closing_part}${after_part}`;
                    const cursor_pos = Position.create(0, `local result \${${prefix}`.length);

                    // Create document state with macro in symbol table
                    const symbols: SymbolTable = {
                        localMacros: new Map(),
                        globalMacros: new Map([[macro_name, {
                            name: macro_name,
                            value: 'test_value',
                            sourceUri: 'file:///test.do',
                            location: {
                                range: Range.create(0, 0, 0, 10),
                                uri: 'file:///test.do'
                            }
                        }]]),
                        variables: new Map(),
                        programs: new Map(),
                    };

                    const document: DocumentState = {
                        uri: 'file:///test.do',
                        content,
                        version: 1,
                        symbols,
                        ast: null,
                        tokens: [],
                        diagnostics: [],
                        context_tracker: undefined,
                    };

                    // Get completions
                    const the_completions = await completion_provider.get_completions(
                        document,
                        cursor_pos
                    );

                    // Find the completion for our macro
                    const my_completion = the_completions.find(c => c.label === macro_name);
                    expect(my_completion).toBeDefined();
                    expect(my_completion?.textEdit).toBeDefined();

                    if (my_completion?.textEdit && 'newText' in my_completion.textEdit) {
                        const new_text = my_completion.textEdit.newText;
                        
                        // Property: closing brace included if and only if not already present
                        if (has_closing_brace) {
                            expect(new_text).toBe(macro_name); // No brace added
                        } else {
                            expect(new_text).toBe(macro_name + '}'); // Brace added
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 10: Global unbraced macro handling
     * Global unbraced macros should never have closing delimiters added
     */
    test('Property 10: Global unbraced macro no suffix', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    macro_name: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/),
                    prefix: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,5}$/),
                }),
                async ({ macro_name, prefix }) => {
                    // Skip if prefix doesn't match macro name
                    if (!macro_name.toLowerCase().startsWith(prefix.toLowerCase())) {
                        return;
                    }

                    // Create document content with global unbraced macro reference
                    const content = `local result $${prefix}`;
                    const cursor_pos = Position.create(0, `local result $${prefix}`.length);

                    // Create document state with macro in symbol table
                    const symbols: SymbolTable = {
                        localMacros: new Map(),
                        globalMacros: new Map([[macro_name, {
                            name: macro_name,
                            value: 'test_value',
                            sourceUri: 'file:///test.do',
                            location: {
                                range: Range.create(0, 0, 0, 10),
                                uri: 'file:///test.do'
                            }
                        }]]),
                        variables: new Map(),
                        programs: new Map(),
                    };

                    const document: DocumentState = {
                        uri: 'file:///test.do',
                        content,
                        version: 1,
                        symbols,
                        ast: null,
                        tokens: [],
                        diagnostics: [],
                        context_tracker: undefined,
                    };

                    // Get completions
                    const the_completions = await completion_provider.get_completions(
                        document,
                        cursor_pos
                    );

                    // Find the completion for our macro
                    const my_completion = the_completions.find(c => c.label === macro_name);
                    expect(my_completion).toBeDefined();
                    expect(my_completion?.textEdit).toBeDefined();

                    if (my_completion?.textEdit && 'newText' in my_completion.textEdit) {
                        const new_text = my_completion.textEdit.newText;
                        
                        // Property: no closing delimiter for unbraced global macros
                        expect(new_text).toBe(macro_name);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
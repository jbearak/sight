/**
 * Macro Completion Range Property Tests
 *
 * Tests that verify replacement range computation and prefix derivation
 * for Stata LSP macro completions.
 *
 * Feature: macro-completion-range
 */

import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/command-database';
import { DocumentState } from '../../src/document-store';
import { Position, Range } from 'vscode-languageserver';
import { detect_macro_context } from '../../src/providers/completion/macro-completion';

describe('Macro Completion Range Property Tests', () => {
    let my_command_db: CommandDatabase;
    let my_completion_provider: CompletionProvider;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_completion_provider = new CompletionProvider(my_command_db, {
            snippet_support: true,
        });
    });

    /**
     * Property 3: Replacement Range Stops at Non-Identifier Characters
     * The replacement range SHALL include only contiguous macro identifier chars
     * and SHALL NOT include non-identifier chars (whitespace, .).
     * Selecting completion SHALL NOT delete text after first non-identifier.
     */
    it('replacement range should stop at non-identifier characters', () => {
        fc.assert(
            fc.property(
                // Generate identifier chars followed by non-identifier chars
                fc.record({
                    prefix: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'A', 'B', 'C', '0', '1', '2', '_'), { minLength: 1, maxLength: 8 }),
                    suffix: fc.stringOf(fc.constantFrom(' ', '.', '(', ')', '[', ']', ',', ';'), { minLength: 1, maxLength: 3 }),
                    cursor_offset: fc.integer({ min: 0, max: 8 })
                }),
                fc.constantFrom('local', 'global') as fc.Arbitrary<'local' | 'global'>,
                (my_data, my_scope) => {
                    const my_identifier = my_data.prefix;
                    const my_non_identifier = my_data.suffix;
                    const my_cursor_pos = Math.min(my_data.cursor_offset, my_identifier.length);
                    
                    // Create document with identifier followed by non-identifier
                    const my_content = `${my_identifier}${my_non_identifier}`;
                    const my_document: DocumentState = {
                        uri: 'test://test.do',
                        content: my_content,
                        version: 1,
                        symbols: {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map()
                        }
                    };
                    
                    const my_position: Position = { line: 0, character: my_cursor_pos };
                    const my_context = { 
                        type: 'macro' as const, 
                        scope: my_scope,
                        form: my_scope === 'local' ? 'local' as const : 'global-unbraced' as const,
                        delimiterStart: Position.create(0, -1),
                        identifierRange: Range.create(Position.create(0, 0), Position.create(0, my_identifier.length))
                    };
                    
                    // Compute replacement range
                    const my_range = my_completion_provider.compute_macro_replacement_range(
                        my_document,
                        my_position,
                        my_context
                    );
                    
                    // Range should include only identifier chars
                    expect(my_range.start.character).toBe(0);
                    expect(my_range.end.character).toBe(my_identifier.length);
                    
                    // Range should not include non-identifier chars
                    expect(my_range.end.character).toBeLessThanOrEqual(my_identifier.length);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4: Unbraced Global Terminates at First Non-Identifier
     * For $apple.sauce, macro name SHALL be 'apple', suffix '.sauce' SHALL NOT be replaced.
     */
    it('unbraced global should terminate at first non-identifier', () => {
        fc.assert(
            fc.property(
                fc.record({
                    macro_name: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'A', 'B', 'C', '0', '1', '2', '_'), { minLength: 1, maxLength: 8 }),
                    suffix: fc.stringOf(fc.constantFrom('.', ' ', '(', ')', '[', ']'), { minLength: 1, maxLength: 3 }),
                    cursor_offset: fc.integer({ min: 0, max: 8 })
                }),
                (my_data) => {
                    const my_macro_name = my_data.macro_name;
                    const my_suffix = my_data.suffix;
                    const my_cursor_pos = Math.min(my_data.cursor_offset, my_macro_name.length);
                    
                    // Create document with $macro_name.suffix
                    const my_content = `$${my_macro_name}${my_suffix}`;
                    const my_document: DocumentState = {
                        uri: 'test://test.do',
                        content: my_content,
                        version: 1,
                        symbols: {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map()
                        }
                    };
                    
                    // Position cursor within the macro name (after $)
                    const my_position: Position = { line: 0, character: 1 + my_cursor_pos };
                    const my_context = { 
                        type: 'macro' as const, 
                        scope: 'global' as const,
                        form: 'global-unbraced' as const,
                        delimiterStart: Position.create(0, 0), // $ at index 0
                        identifierRange: Range.create(Position.create(0, 1), Position.create(0, 1 + my_macro_name.length))
                    };
                    
                    // Compute replacement range
                    const my_range = my_completion_provider.compute_macro_replacement_range(
                        my_document,
                        my_position,
                        my_context
                    );
                    
                    // Range should start after $ and include only macro name
                    expect(my_range.start.character).toBe(1);
                    expect(my_range.end.character).toBe(1 + my_macro_name.length);
                    
                    // Range should not include suffix
                    expect(my_range.end.character).toBeLessThanOrEqual(1 + my_macro_name.length);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 5: Prefix Derivation Matches Replacement Range
     * The derived prefix SHALL equal the exact text inside the computed replacement range.
     */
    it('prefix derivation should match replacement range text', () => {
        fc.assert(
            fc.property(
                fc.record({
                    before_text: fc.string({ minLength: 0, maxLength: 10 }),
                    identifier: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'A', 'B', 'C', '0', '1', '2', '_'), { minLength: 0, maxLength: 8 }),
                    after_text: fc.string({ minLength: 0, maxLength: 10 }),
                    cursor_offset: fc.integer({ min: 0, max: 8 })
                }),
                fc.constantFrom('local', 'global') as fc.Arbitrary<'local' | 'global'>,
                (my_data, my_scope) => {
                    const my_identifier = my_data.identifier;
                    const my_cursor_pos = Math.min(my_data.cursor_offset, my_identifier.length);
                    
                    // Create document with text before, identifier, and text after
                    const my_content = `${my_data.before_text}${my_identifier}${my_data.after_text}`;
                    const my_document: DocumentState = {
                        uri: 'test://test.do',
                        content: my_content,
                        version: 1,
                        symbols: {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map()
                        }
                    };
                    
                    // Position cursor within the identifier
                    const my_position: Position = { 
                        line: 0, 
                        character: my_data.before_text.length + my_cursor_pos 
                    };
                    
                    // Detect context first
                    const detected_context = detect_macro_context(
                        my_content.substring(0, my_position.character),
                        my_document,
                        my_position
                    );
                    
                    if (!detected_context) {
                        // If no context detected (e.g. invalid cursor pos), skip
                        return;
                    }

                    // Get prefix using the method
                    const my_prefix = my_completion_provider.get_macro_prefix(
                        my_document,
                        my_position,
                        detected_context
                    );

                    const my_range = my_completion_provider.compute_macro_replacement_range(
                        my_document,
                        my_position,
                        detected_context
                    );
                    
                    // Extract text from replacement range
                    const my_line = my_content.split('\n')[0];
                    const my_range_text = my_line.substring(my_range.start.character, my_range.end.character);
                    
                    // Prefix should match replacement range text
                    expect(my_prefix).toBe(my_range_text);
                }
            ),
            { numRuns: 100 }
        );
    });
});
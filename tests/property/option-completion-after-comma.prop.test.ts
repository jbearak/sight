/**
 * Property tests for option completion after comma feature.
 * Validates option completions, command name extraction, hover suppression, and option hover.
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { Position, CompletionItemKind } from 'vscode-languageserver';
import { CompletionProvider, detect_completion_context } from '../../src/providers/completion';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { DocumentState } from '../../src/document-store';
import { SymbolTable } from '../../src/types';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(content: string): DocumentState {
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        ast: null,
        symbols: {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        } as SymbolTable,
        diagnostics: [],
        tokens: [],
        context_ranges: [],
        line_offsets: [],
    };
}

/**
 * Generator for valid Stata command names that are NOT file commands.
 */
function arbitrary_command_name(): fc.Arbitrary<string> {
    return fc.constantFrom(
        'regress', 'summarize', 'generate', 'replace', 'tabulate', 'describe',
        'list', 'display', 'count', 'sort', 'drop', 'keep', 'rename'
    );
}

/**
 * Generator for valid option names.
 */
function arbitrary_option_name(): fc.Arbitrary<string> {
    return fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
}

/**
 * Generator for prefix commands.
 */
function arbitrary_prefix_commands(): fc.Arbitrary<string[]> {
    return fc.array(
        fc.constantFrom('by', 'bysort', 'quietly', 'qui', 'capture', 'cap', 'noisily', 'noi'),
        { minLength: 0, maxLength: 2 }
    );
}

describe('Option Completion After Comma Property Tests', () => {
    const command_db = new CommandDatabase();
    const completion_provider = new CompletionProvider(command_db);
    const hover_provider = new HoverProvider(command_db);

    /**
     * Property 1: Option context detection
     * When cursor is after comma in a command, context should be detected as 'option'.
     */
    describe('Property 1: Option Context Detection', () => {
        it('should detect option context after comma', () => {
            fc.assert(
                fc.property(
                    arbitrary_command_name(),
                    arbitrary_option_name(),
                    (command, option_prefix) => {
                        const content = `${command} var1, ${option_prefix}`;
                        const position = Position.create(0, content.length);
                        const document = create_test_document(content);
                        
                        const context = detect_completion_context(document, position);
                        
                        // Should detect option context
                        expect(context.type).toBe('option');
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Command name extraction handles various formats
     * Command name should be correctly extracted from various command formats.
     */
    describe('Property 2: Command Name Extraction', () => {
        it('should extract command name from various formats', () => {
            fc.assert(
                fc.property(
                    arbitrary_prefix_commands(),
                    arbitrary_command_name(),
                    fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/), { minLength: 0, maxLength: 2 }),
                    (prefixes, command, vars) => {
                        const prefix_part = prefixes.length > 0 ? prefixes.join(' ') + ' ' : '';
                        const var_part = vars.length > 0 ? ' ' + vars.join(' ') : '';
                        const content = `${prefix_part}${command}${var_part}, opt`;
                        const position = Position.create(0, content.length);
                        
                        const document = create_test_document(content);
                        const context = detect_completion_context(document, position);
                        
                        // Should detect option context
                        expect(context.type).toBe('option');
                        
                        if (context.type === 'option') {
                            // Command name should match (case-insensitive)
                            expect(context.command.toLowerCase()).toBe(command.toLowerCase());
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle colon in arguments (e.g., merge 1:m)', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('merge'),  // merge is the main command that uses 1:m syntax
                    fc.constantFrom('1:1', '1:m', 'm:1', 'm:m'),  // valid merge match types
                    (command, match_type) => {
                        const content = `${command} ${match_type} var1, opt`;
                        const position = Position.create(0, content.length);
                        
                        const document = create_test_document(content);
                        const context = detect_completion_context(document, position);
                        
                        // Should detect option context
                        expect(context.type).toBe('option');
                        
                        if (context.type === 'option') {
                            // Command name should be merge, not affected by the colon in match_type
                            expect(context.command.toLowerCase()).toBe(command.toLowerCase());
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Option completions behavior
     * Option completions should return appropriate results based on command database.
     */
    describe('Property 3: Option Completions Behavior', () => {
        it('should return consistent completion results', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbitrary_command_name(),
                    arbitrary_option_name(),
                    async (command, option_prefix) => {
                        const content = `${command} var1, ${option_prefix}`;
                        const position = Position.create(0, content.length);
                        const document = create_test_document(content);
                        
                        // Get completions
                        const completions = await completion_provider.get_completions(
                            document,
                            position
                        );
                        
                        // Should return an array (may be empty)
                        expect(Array.isArray(completions)).toBe(true);
                        
                        // All completions should be valid completion items
                        for (const completion of completions) {
                            expect(completion).toHaveProperty('label');
                            expect(typeof completion.label).toBe('string');
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Hover behavior in option context
     * Hover should behave consistently in option context.
     */
    describe('Property 4: Hover Behavior in Option Context', () => {
        it('should handle hover requests in option context', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbitrary_command_name(),
                    arbitrary_option_name(),
                    async (command, option_name) => {
                        const content = `${command} var1, ${option_name}`;
                        // Use lastIndexOf to find the option after the comma, not in var1
                        const option_start = content.lastIndexOf(option_name);
                        const position = Position.create(0, option_start + 1);
                        
                        const document = create_test_document(content);
                        
                        // Get hover - should not throw
                        const hover = await hover_provider.get_hover(document, position);
                        
                        // Hover can be null or a valid hover object
                        if (hover !== null) {
                            expect(hover).toHaveProperty('contents');
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 5: Context detection accuracy
     * Option context should be detected accurately regardless of whitespace and formatting.
     */
    describe('Property 5: Context Detection Accuracy', () => {
        it('should detect option context with various whitespace patterns', () => {
            fc.assert(
                fc.property(
                    arbitrary_command_name(),
                    fc.integer({ min: 0, max: 3 }),
                    fc.integer({ min: 0, max: 3 }),
                    arbitrary_option_name(),
                    (command, spaces_before_comma, spaces_after_comma, option) => {
                        const before_spaces = ' '.repeat(spaces_before_comma);
                        const after_spaces = ' '.repeat(spaces_after_comma);
                        const content = `${command} var1${before_spaces},${after_spaces}${option}`;
                        const position = Position.create(0, content.length);
                        
                        const document = create_test_document(content);
                        const context = detect_completion_context(document, position);
                        
                        // Should always detect option context
                        expect(context.type).toBe('option');
                        
                        if (context.type === 'option') {
                            expect(context.command.toLowerCase()).toBe(command.toLowerCase());
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle simple argument patterns correctly', () => {
            fc.assert(
                fc.property(
                    arbitrary_command_name(),
                    fc.stringMatching(/^[a-z0-9_]{1,8}$/),
                    arbitrary_option_name(),
                    (command, simple_arg, option) => {
                        const content = `${command} ${simple_arg}, ${option}`;
                        const position = Position.create(0, content.length);
                        
                        const document = create_test_document(content);
                        const context = detect_completion_context(document, position);
                        
                        // Should detect option context
                        expect(context.type).toBe('option');
                        
                        if (context.type === 'option') {
                            expect(context.command.toLowerCase()).toBe(command.toLowerCase());
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
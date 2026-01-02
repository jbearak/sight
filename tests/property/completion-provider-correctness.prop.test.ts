import { init_tracker_from_source } from '../test-context-helper';
/**
 * Property tests for completion provider correctness.
 * Validates that completion provider suggests correct end delimiters for embedded blocks.
 */

import * as fc from 'fast-check';
import { describe, it } from 'bun:test';
import { Position } from 'vscode-languageserver';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/command-database';
import { DocumentState } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext } from '../../src/context-tracker/types';
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
        } as SymbolTable,
        diagnostics: [],
    };
}

/**
 * Generate embedded block documents with proper end delimiters.
 */
function arbitrary_embedded_block_document(): fc.Arbitrary<{
    document: string;
    language: 'mata' | 'python';
    completion_position: Position;
}> {
    return fc.oneof(
        // Mata block
        fc.record({
            language: fc.constant('mata' as const),
            document: fc.constant('mata\nx = 5\n'),
            completion_position: fc.constant({ line: 2, character: 0 }),
        }),
        // Python block  
        fc.record({
            language: fc.constant('python' as const),
            document: fc.constant('python\nx = 5\n'),
            completion_position: fc.constant({ line: 2, character: 0 }),
        })
    );
}

/**
 * Generate positions at the start of lines within embedded blocks.
 */
function arbitrary_block_boundary_position(): fc.Arbitrary<{
    document: string;
    language: 'mata' | 'python';
    position: Position;
}> {
    return fc.oneof(
        // Position at start of line in mata block
        fc.record({
            document: fc.constant('mata\n// Some mata code\n'),
            language: fc.constant('mata' as const),
            position: fc.constant({ line: 2, character: 0 }),
        }),
        // Position at start of line in python block
        fc.record({
            document: fc.constant('python\n# Some python code\n'),
            language: fc.constant('python' as const),
            position: fc.constant({ line: 2, character: 0 }),
        }),
        // Position after whitespace in mata block
        fc.record({
            document: fc.constant('mata\n    \n'),
            language: fc.constant('mata' as const),
            position: fc.constant({ line: 1, character: 4 }),
        }),
        // Position after whitespace in python block
        fc.record({
            document: fc.constant('python\n    \n'),
            language: fc.constant('python' as const),
            position: fc.constant({ line: 1, character: 4 }),
        })
    );
}

describe('Property 6: Completion Provider Correctness', () => {
    it('should suggest "end" for both mata and python blocks at block boundaries', () => {
        fc.assert(
            fc.asyncProperty(
                arbitrary_block_boundary_position(),
                async ({ document, language, position }) => {
                    // Setup
                    const my_command_db = new CommandDatabase();
                    const my_provider = new CompletionProvider(my_command_db, { snippet_support: false });
                    const my_context_tracker = new ContextTracker();
                    const my_document = create_test_document(document);
                    
                    // Initialize context tracker
                    init_tracker_from_source(my_context_tracker, document);
                    my_provider.set_context_tracker(my_context_tracker);
                    
                    // Get completions
                    const my_completions = await my_provider.get_completions(my_document, position);
                    
                    // Verify that "end" is suggested for both mata and python blocks
                    const my_end_completion = my_completions.find(c => c.label === 'end');
                    
                    // Should have exactly one "end" completion
                    if (my_end_completion) {
                        return my_end_completion.detail === `End ${language} block`;
                    }
                    
                    return false;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should not suggest "end python" for python blocks', () => {
        fc.assert(
            fc.asyncProperty(
                arbitrary_embedded_block_document(),
                async ({ document, language, completion_position }) => {
                    // Only test python blocks for this property
                    if (language !== 'python') return true;
                    
                    // Setup
                    const my_command_db = new CommandDatabase();
                    const my_provider = new CompletionProvider(my_command_db, { snippet_support: false });
                    const my_context_tracker = new ContextTracker();
                    const my_document = create_test_document(document);
                    
                    // Initialize context tracker
                    init_tracker_from_source(my_context_tracker, document);
                    my_provider.set_context_tracker(my_context_tracker);
                    
                    // Get completions
                    const my_completions = await my_provider.get_completions(my_document, completion_position);
                    
                    // Should not suggest "end python"
                    const my_end_python_completion = my_completions.find(c => c.label === 'end python');
                    
                    return my_end_python_completion === undefined;
                }
            ),
            { numRuns: 30 }
        );
    });

    it('should only suggest block end completions when at start of line or after whitespace', () => {
        fc.assert(
            fc.asyncProperty(
                fc.record({
                    language: fc.oneof(fc.constant('mata'), fc.constant('python')),
                    position_type: fc.oneof(
                        fc.constant('start_of_line'),
                        fc.constant('after_whitespace'),
                        fc.constant('middle_of_code')
                    ),
                }),
                async ({ language, position_type }) => {
                    let my_document: string;
                    let my_position: Position;
                    
                    switch (position_type) {
                        case 'start_of_line':
                            my_document = `${language}\nx = 5\n`;
                            my_position = { line: 2, character: 0 };
                            break;
                        case 'after_whitespace':
                            my_document = `${language}\n    `;
                            my_position = { line: 1, character: 4 };
                            break;
                        case 'middle_of_code':
                            my_document = `${language}\nsome_code`;
                            my_position = { line: 1, character: 4 };
                            break;
                    }
                    
                    // Setup
                    const my_command_db = new CommandDatabase();
                    const my_provider = new CompletionProvider(my_command_db, { snippet_support: false });
                    const my_context_tracker = new ContextTracker();
                    const my_doc_state = create_test_document(my_document);
                    
                    // Initialize context tracker
                    init_tracker_from_source(my_context_tracker, my_document);
                    my_provider.set_context_tracker(my_context_tracker);
                    
                    // Get completions
                    const my_completions = await my_provider.get_completions(my_doc_state, my_position);
                    
                    // Check if "end" completion is present
                    const my_has_end_completion = my_completions.some(c => c.label === 'end');
                    
                    // Should only suggest "end" at start of line or after whitespace
                    if (position_type === 'middle_of_code') {
                        return !my_has_end_completion;
                    } else {
                        return my_has_end_completion;
                    }
                }
            ),
            { numRuns: 40 }
        );
    });

    it('should not suggest block end completions in Stata context', () => {
        fc.assert(
            fc.asyncProperty(
                fc.record({
                    document: fc.constant('display "hello"\n'),
                    position: fc.constant({ line: 1, character: 0 }),
                }),
                async ({ document, position }) => {
                    // Setup
                    const my_command_db = new CommandDatabase();
                    const my_provider = new CompletionProvider(my_command_db, { snippet_support: false });
                    const my_context_tracker = new ContextTracker();
                    const my_doc_state = create_test_document(document);
                    
                    // Initialize context tracker
                    init_tracker_from_source(my_context_tracker, document);
                    my_provider.set_context_tracker(my_context_tracker);
                    
                    // Get completions
                    const my_completions = await my_provider.get_completions(my_doc_state, position);
                    
                    // Should not suggest "end" in Stata context
                    const my_has_end_completion = my_completions.some(c => c.label === 'end');
                    
                    return !my_has_end_completion;
                }
            ),
            { numRuns: 20 }
        );
    });

    it('should provide correct documentation for end completions', () => {
        fc.assert(
            fc.asyncProperty(
                fc.oneof(fc.constant('mata'), fc.constant('python')),
                async (language) => {
                    // Setup
                    const my_document = `${language}\nx = 5\n`;
                    const my_position = { line: 2, character: 0 };
                    
                    const my_command_db = new CommandDatabase();
                    const my_provider = new CompletionProvider(my_command_db, { snippet_support: false });
                    const my_context_tracker = new ContextTracker();
                    const my_doc_state = create_test_document(my_document);
                    
                    // Initialize context tracker
                    init_tracker_from_source(my_context_tracker, my_document);
                    my_provider.set_context_tracker(my_context_tracker);
                    
                    // Get completions
                    const my_completions = await my_provider.get_completions(my_doc_state, my_position);
                    
                    // Find "end" completion
                    const my_end_completion = my_completions.find(c => c.label === 'end');
                    
                    if (my_end_completion) {
                        // Check that documentation mentions the correct language
                        const my_expected_detail = `End ${language} block`;
                        const my_expected_doc = `Closes the current ${language} block`;
                        
                        return my_end_completion.detail === my_expected_detail &&
                               my_end_completion.documentation === my_expected_doc;
                    }
                    
                    return false;
                }
            ),
            { numRuns: 30 }
        );
    });
});
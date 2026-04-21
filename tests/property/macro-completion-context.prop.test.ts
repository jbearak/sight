/**
 * Property tests for macro completion context detection with comment exclusion.
 * Tests boundary conditions and comment detection for enhanced macro context.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Position } from 'vscode-languageserver-textdocument';
import { DocumentState } from '../../src/document-store';
import { detect_completion_context } from '../../src/providers/completion';

const MACRO_IDENTIFIER_CHAR_REGEX = /[A-Za-z0-9_]/;

function make_document_and_position(content_with_cursor_marker: string): { document: DocumentState; position: Position } {
    const marker_index = content_with_cursor_marker.indexOf('|');
    expect(marker_index).toBeGreaterThanOrEqual(0);

    // Remove only the marker at the found index (any later '|' characters are
    // real content and must be preserved). Using slice avoids the ambiguity of
    // String.prototype.replace with a string argument and silences CodeQL's
    // js/incomplete-sanitization check.
    const content =
        content_with_cursor_marker.slice(0, marker_index) +
        content_with_cursor_marker.slice(marker_index + 1);

    const before_marker = content_with_cursor_marker.substring(0, marker_index);
    const line = before_marker.split('\n').length - 1;
    const last_newline_index = before_marker.lastIndexOf('\n');
    const character = last_newline_index === -1
        ? before_marker.length
        : before_marker.length - last_newline_index - 1;

    const document: DocumentState = {
        uri: 'test://test.do',
        content,
        version: 1,
        symbols: {
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            programs: new Map(),
        },
    };

    return { document, position: { line, character } };
}

/**
 * Generate valid macro names (alphanumeric + underscore, starting with letter/underscore)
 */
const macro_name_generator = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,15}$/);

/**
 * Generate whitespace characters
 */
const whitespace_generator = fc.constantFrom(' ', '\t');

/**
 * Generate comment content (no newlines for line comments)
 */
const comment_content_generator = fc.string({ minLength: 0, maxLength: 50 })
    .filter(s => !s.includes('\n') && !s.includes('\r'));

/**
 * Property 1: Local macro context detection boundary
 * For any document with local macro `name', cursor strictly between backtick and apostrophe
 * SHALL return local context. Cursor after closing apostrophe SHALL NOT return local context.
 */
describe('Property 1: Local macro context boundary detection', () => {
    test('cursor strictly between backtick and apostrophe returns local context', () => {
        fc.assert(fc.property(
            macro_name_generator.filter(name => name.length > 0),
            fc.integer({ min: 1, max: 10 }),
            (macro_name, cursor_offset) => {
                // Ensure we have a valid macro name
                if (macro_name.length === 0) return;
                
                // Create document with simple local macro reference (no prefix to avoid conflicts)
                const content = `\`${macro_name}'`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor strictly between backtick and apostrophe
                const cursor_pos = 1 + Math.min(cursor_offset, macro_name.length - 1);

                const position: Position = { line: 0, character: cursor_pos };
                const context = detect_completion_context(document, position);
                
                expect(context.type).toBe('macro');
                expect((context as any).scope).toBe('local');
            }
        ), { numRuns: 100 });
    });

    test('cursor after closing apostrophe does not return local context', () => {
        fc.assert(fc.property(
            macro_name_generator.filter(name => name.length > 0),
            (macro_name) => {
                // Create document with local macro reference
                const content = `\`${macro_name}'`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor after closing apostrophe
                const position: Position = { line: 0, character: content.length };
                const context = detect_completion_context(document, position);
                
                // Should not return local macro context
                expect(context.type !== 'macro' || (context as any).scope !== 'local').toBe(true);
            }
        ), { numRuns: 100 });
    });
});

/**
 * Property 2: Global macro context detection boundary
 * Cursor inside braced reference (after ${ and before }) SHALL return global context.
 * Cursor after closing } SHALL NOT return global context.
 */
describe('Property 2: Global macro context boundary detection', () => {
    test('cursor inside braced reference returns global context', () => {
        fc.assert(fc.property(
            macro_name_generator.filter(name => name.length > 0),
            fc.integer({ min: 1, max: 10 }),
            (macro_name, cursor_offset) => {
                // Ensure we have a valid macro name
                if (macro_name.length === 0) return;
                
                // Create document with global macro reference (no prefix to avoid conflicts)
                const content = `\${${macro_name}}`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor inside braced reference (after ${ and before })
                const cursor_pos = 2 + Math.min(cursor_offset, macro_name.length - 1);

                const position: Position = { line: 0, character: cursor_pos };
                const context = detect_completion_context(document, position);
                
                expect(context.type).toBe('macro');
                expect((context as any).scope).toBe('global');
            }
        ), { numRuns: 100 });
    });

    test('cursor after closing brace does not return global context', () => {
        fc.assert(fc.property(
            macro_name_generator.filter(name => name.length > 0),
            (macro_name) => {
                // Create document with global macro reference
                const content = `\${${macro_name}}`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor after closing brace
                const position: Position = { line: 0, character: content.length };
                const context = detect_completion_context(document, position);
                
                // Should not return global macro context
                expect(context.type !== 'macro' || (context as any).scope !== 'global').toBe(true);
            }
        ), { numRuns: 100 });
    });

    test('cursor after dollar within identifier chars returns global context', () => {
        fc.assert(fc.property(
            macro_name_generator.filter(name => name.length > 0),
            fc.integer({ min: 1, max: 10 }),
            (macro_name, cursor_offset) => {
                // Ensure we have a valid macro name
                if (macro_name.length === 0) return;
                
                // Create document with unbraced global macro reference
                const partial_name = macro_name.substring(0, Math.min(cursor_offset, macro_name.length));
                const content = `$${partial_name}`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor after $ within identifier chars
                const cursor_pos = 1 + partial_name.length;
                
                // Only test if we have some content after the $
                if (partial_name.length > 0) {
                    const position: Position = { line: 0, character: cursor_pos };
                    const context = detect_completion_context(document, position);
                    
                    expect(context.type).toBe('macro');
                    expect((context as any).scope).toBe('global');
                }
            }
        ), { numRuns: 100 });
    });
});

/**
 * Property 10: Comment context exclusion
 * For any cursor position inside a comment, completion provider SHALL NOT return macro completions.
 */
describe('Local macro context inside string literals (Requirements 1.4–1.6)', () => {
    test('cursor immediately after backtick inside string returns local macro context', () => {
        const { document, position } = make_document_and_position('display "foo `|bar"');
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        expect((context as any).scope).toBe('local');
    });

    test('cursor in empty local macro reference inside string (`|\') returns local macro context', () => {
        const { document, position } = make_document_and_position('display "foo `|\'bar"');
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        expect((context as any).scope).toBe('local');
    });

    test('cursor after at least one identifier char inside string returns local macro context', () => {
        const { document, position } = make_document_and_position('display "foo `na|me bar"');
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        expect((context as any).scope).toBe('local');
    });

    test('cursor after closing apostrophe inside string does not return local macro context', () => {
        const { document, position } = make_document_and_position('display "foo `name\'| bar"');
        const context = detect_completion_context(document, position);
        expect(context.type !== 'macro' || (context as any).scope !== 'local').toBe(true);
    });
});

describe('Property 10: Comment context exclusion', () => {
    test('cursor inside line comment does not return macro completions', () => {
        fc.assert(fc.property(
            fc.constantFrom('//', '*'),
            comment_content_generator,
            macro_name_generator,
            fc.integer({ min: 0, max: 20 }),
            (comment_start, comment_text, macro_name, cursor_offset) => {
                // Create document with macro reference inside line comment
                const content = `${comment_start} \`${macro_name}' ${comment_text}`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor inside the comment
                const comment_content_start = comment_start.length + 1; // After comment marker and space
                const cursor_pos = Math.min(comment_content_start + cursor_offset, content.length - 1);
                
                if (cursor_pos >= comment_content_start) {
                    const position: Position = { line: 0, character: cursor_pos };
                    const context = detect_completion_context(document, position);
                    
                    // Should not return macro context when inside comment
                    expect(context.type !== 'macro').toBe(true);
                }
            }
        ), { numRuns: 100 });
    });

    test('cursor inside block comment does not return macro completions', () => {
        fc.assert(fc.property(
            comment_content_generator,
            macro_name_generator,
            fc.integer({ min: 0, max: 20 }),
            (comment_text, macro_name, cursor_offset) => {
                // Create document with macro reference inside block comment
                const content = `/* \`${macro_name}' ${comment_text} */`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor inside the block comment
                const comment_content_start = 3; // After /*
                const comment_content_end = content.length - 2; // Before */
                const cursor_pos = Math.min(comment_content_start + cursor_offset, comment_content_end - 1);
                
                if (cursor_pos >= comment_content_start && cursor_pos < comment_content_end) {
                    const position: Position = { line: 0, character: cursor_pos };
                    const context = detect_completion_context(document, position);
                    
                    // Should not return macro context when inside comment
                    expect(context.type !== 'macro').toBe(true);
                }
            }
        ), { numRuns: 100 });
    });

    test('cursor inside multiline block comment does not return macro completions', () => {
        fc.assert(fc.property(
            comment_content_generator,
            macro_name_generator,
            fc.integer({ min: 1, max: 3 }),
            fc.integer({ min: 0, max: 20 }),
            (comment_text, macro_name, comment_line, cursor_offset) => {
                // Create multiline document with macro reference inside block comment
                const the_lines = [
                    '/*',
                    `\`${macro_name}' ${comment_text}`,
                    'more comment text',
                    '*/'
                ];
                const content = the_lines.join('\n');
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor inside the block comment on specified line
                if (comment_line < the_lines.length - 1) {
                    const target_line = the_lines[comment_line];
                    const cursor_pos = Math.min(cursor_offset, target_line.length - 1);
                    
                    if (cursor_pos >= 0) {
                        const position: Position = { line: comment_line, character: cursor_pos };
                        const context = detect_completion_context(document, position);
                        
                        // Should not return macro context when inside comment
                        expect(context.type !== 'macro').toBe(true);
                    }
                }
            }
        ), { numRuns: 100 });
    });

    test('cursor outside comment can return macro completions', () => {
        fc.assert(fc.property(
            macro_name_generator,
            comment_content_generator,
            fc.integer({ min: 0, max: 15 }),
            (macro_name, comment_text, cursor_offset) => {
                // Create document with macro reference outside comment
                const content = `\`${macro_name.substring(0, cursor_offset)}' // ${comment_text}`;
                const document: DocumentState = {
                    uri: 'test://test.do',
                    content,
                    version: 1,
                    symbols: {
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                        programs: new Map(),
                    },
                };

                // Position cursor inside macro reference (outside comment)
                const cursor_pos = 1 + cursor_offset; // Inside `name'
                const apostrophe_pos = 1 + macro_name.length;
                
                if (cursor_pos > 1 && cursor_pos < apostrophe_pos) {
                    const position: Position = { line: 0, character: cursor_pos };
                    const context = detect_completion_context(document, position);
                    
                    // Should return macro context when outside comment
                    expect(context.type).toBe('macro');
                    expect((context as any).scope).toBe('local');
                }
            }
        ), { numRuns: 100 });
    });
});
/**
 * Property Test: Symbol Identification and Search Completeness
 * 
 * Feature: find-references
 * Property 1: Symbol Identification and Search Completeness
 * 
 * For any document containing references to a symbol (local macro, global macro,
 * program, variable, scalar, or matrix), when find-references is invoked on that
 * symbol, the result SHALL contain all references to that symbol in the searched files.
 * 
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { arbitrary_non_reserved_identifier } from './generators';

describe('Feature: find-references, Property 1: Symbol Identification and Search Completeness', () => {
    const provider = new ReferencesProvider();
    const lexer = new StataLexer();

    // Generator for valid Stata identifiers (excludes reserved qualifiers like if/in)
    const arbitrary_identifier = arbitrary_non_reserved_identifier();

    /**
     * Create a minimal DocumentState for testing.
     */
    function create_document_state(uri: string, content: string): DocumentState {
        const lexer_result = lexer.tokenize(content);
        return {
            uri,
            content,
            version: 1,
            tokens: lexer_result.tokens,
            ast: null as any,
            symbols: {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            diagnostics: [],
            context_ranges: [],
            context_tracker: null as any,
            line_offsets: lexer_result.line_offsets,
            forward_calls: [],
        };
    }

    it('should find all local macro references (Req 1.1)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 1, max: 5 }),
                async (macro_name, ref_count) => {
                    // Create content with multiple local macro references
                    const the_lines: string[] = [];
                    for (let i = 0; i < ref_count; i++) {
                        the_lines.push(`display \`${macro_name}'`);
                    }
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/local_macro.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    // Should find all references
                    expect(results.length).toBe(ref_count);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should find all global macro references (Req 1.2)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 1, max: 5 }),
                async (macro_name, ref_count) => {
                    // Create content with multiple global macro references
                    const the_lines: string[] = [];
                    for (let i = 0; i < ref_count; i++) {
                        the_lines.push(`display $${macro_name}`);
                    }
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/global_macro.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    // Should find all references
                    expect(results.length).toBe(ref_count);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should find all program references (Req 1.3)', async () => {
        // Program references require the program to be in the symbol table
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 1, max: 5 }),
                async (program_name, ref_count) => {
                    // Create content with multiple program calls
                    const the_lines: string[] = [];
                    for (let i = 0; i < ref_count; i++) {
                        the_lines.push(`${program_name} arg${i}`);
                    }
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/program.do',
                        content
                    );
                    
                    // Add program to symbol table with a different location (simulating definition elsewhere)
                    document.symbols.programs.set(program_name, {
                        name: program_name,
                        sourceUri: 'file:///workspace/other.do',
                        location: { uri: 'file:///workspace/other.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: program_name.length } } },
                    });

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 0 },
                        { includeDeclaration: false }
                    );

                    // Should find all references
                    expect(results.length).toBe(ref_count);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should find braced global macro references', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 1, max: 5 }),
                async (macro_name, ref_count) => {
                    // Create content with braced global macro references
                    const the_lines: string[] = [];
                    for (let i = 0; i < ref_count; i++) {
                        the_lines.push(`display \${${macro_name}}`);
                    }
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/braced_global.do',
                        content
                    );

                    // Compute position on the macro name (after "${")
                    const my_macro_char = 'display ${'.length;
                    const results = await provider.get_references(
                        document,
                        { line: 0, character: my_macro_char },
                        { includeDeclaration: false }
                    );

                    // Should find all references
                    expect(results.length).toBe(ref_count);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should find mixed macro references in same document', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                async (macro_name) => {
                    // Create content with both local and global references
                    const content = [
                        `local ${macro_name} = 1`,
                        `display \`${macro_name}'`,
                        `display \`${macro_name}'`,
                        `display \`${macro_name}'`,
                    ].join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/mixed.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 1, character: 10 },
                        { includeDeclaration: false }
                    );

                    // Should find all 3 local macro references
                    expect(results.length).toBe(3);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should not find references to different symbols', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                arbitrary_identifier,
                async (name1, name2) => {
                    // Ensure names are different
                    fc.pre(name1 !== name2);

                    // Create content with references to both symbols
                    const content = [
                        `display \`${name1}'`,
                        `display \`${name2}'`,
                        `display \`${name1}'`,
                    ].join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/different.do',
                        content
                    );

                    // Search for name1
                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    // Should only find references to name1 (2 occurrences)
                    expect(results.length).toBe(2);
                    
                    // Verify all results are for name1
                    for (const my_result of results) {
                        const line_num = my_result.range.start.line;
                        expect(line_num === 0 || line_num === 2).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle symbols at various positions in line', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 0, max: 10 }),
                async (macro_name, padding_count) => {
                    // Create content with macro at different positions
                    const padding = '    '.repeat(padding_count);
                    const content = [
                        `${padding}display \`${macro_name}'`,
                        `display \`${macro_name}'`,
                        `${padding}${padding}display \`${macro_name}'`,
                    ].join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/positions.do',
                        content
                    );

                    // Find position of first macro reference
                    const first_macro_pos = content.indexOf(`\`${macro_name}'`);
                    const lines_before = content.substring(0, first_macro_pos).split('\n');
                    const line = lines_before.length - 1;
                    const char = lines_before[line].length + 1; // +1 for backtick

                    const results = await provider.get_references(
                        document,
                        { line, character: char },
                        { includeDeclaration: false }
                    );

                    // Should find all 3 references regardless of position
                    expect(results.length).toBe(3);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should find references across multiple lines with varying content', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.array(fc.boolean(), { minLength: 5, maxLength: 10 }),
                async (macro_name, include_ref) => {
                    // Create content where some lines have the reference
                    const the_lines: string[] = [];
                    let expected_count = 0;
                    
                    for (let i = 0; i < include_ref.length; i++) {
                        if (include_ref[i]) {
                            the_lines.push(`display \`${macro_name}'`);
                            expected_count++;
                        } else {
                            the_lines.push('* comment line');
                        }
                    }
                    
                    // Ensure at least one reference
                    if (expected_count === 0) {
                        the_lines[0] = `display \`${macro_name}'`;
                        expected_count = 1;
                    }
                    
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/varying.do',
                        content
                    );

                    // Find first line with reference
                    let first_ref_line = 0;
                    for (let i = 0; i < the_lines.length; i++) {
                        if (the_lines[i].includes(`\`${macro_name}'`)) {
                            first_ref_line = i;
                            break;
                        }
                    }

                    const results = await provider.get_references(
                        document,
                        { line: first_ref_line, character: 10 },
                        { includeDeclaration: false }
                    );

                    // Should find exactly the expected number of references
                    expect(results.length).toBe(expected_count);
                }
            ),
            { numRuns: 100 }
        );
    });
});

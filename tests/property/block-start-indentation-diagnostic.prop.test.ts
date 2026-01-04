/**
 * Property Tests: Block Start Indentation Diagnostic
 *
 * Feature: block-start-indentation-diagnostic
 * Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4
 *
 * Tests the IndentationDiagnosticAnalyzer's ability to detect unnecessary
 * indentation at any depth level, and the formatter's ability to normalize
 * mixed indentation.
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    skip_for_mode,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('Block Start Indentation Diagnostic Properties', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();
    
    const default_config: StataLSPConfig = {
        ...DEFAULT_SETTINGS,
        diagnostics: {
            ...DEFAULT_SETTINGS.diagnostics,
            enabled: true,
            indentation: true,
        },
    };

    // Generator for simple top-level statements
    const simple_statement = fc.constantFrom(
        'gen x = 1',
        'display "hello"',
        'local y = 2',
        'replace x = 2',
        'summarize x',
        'regress y x'
    );

    // Generator for whitespace indentation (spaces and/or tabs)
    const indentation_arb = fc.tuple(
        fc.integer({ min: 1, max: 8 }),
        fc.boolean()
    ).map(([count, use_tabs]) => {
        if (use_tabs) {
            return '\t'.repeat(Math.ceil(count / 4));
        }
        return ' '.repeat(count);
    });

    /**
     * Property 1: Top-level unnecessary indentation detection
     * 
     * For any Stata source code where a non-excluded statement at depth 0
     * has leading whitespace, the IndentationDiagnosticAnalyzer SHALL emit
     * an UNNECESSARY_INDENTATION diagnostic for that line.
     * 
     * Validates: Requirements 1.1, 2.1
     */
    test('Property 1: Top-level unnecessary indentation detection', () => {
        fc.assert(
            fc.property(
                simple_statement,
                indentation_arb,
                (statement, indent) => {
                    // Create source with indented top-level statement
                    const source = `${indent}${statement}`;
                    const doc_state = create_document_state(source);
                    
                    const diagnostics = analyzer.analyze(doc_state, default_config);
                    
                    // Should have at least one UNNECESSARY_INDENTATION diagnostic
                    const unnecessary_diagnostics = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                    );
                    
                    expect(unnecessary_diagnostics.length).toBeGreaterThanOrEqual(1);
                    
                    // The diagnostic should be on line 0
                    const line_0_diagnostics = unnecessary_diagnostics.filter(
                        d => d.range.start.line === 0
                    );
                    expect(line_0_diagnostics.length).toBeGreaterThanOrEqual(1);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Correct indentation produces no unnecessary diagnostic
     * 
     * For any Stata source code where statements inside blocks have exactly
     * the expected indentation for their depth, the IndentationDiagnosticAnalyzer
     * SHALL NOT emit an UNNECESSARY_INDENTATION diagnostic for those lines.
     * 
     * Validates: Requirements 1.2
     */
    test('Property 2: Correct indentation produces no unnecessary diagnostic', () => {
        fc.assert(
            fc.property(
                simple_statement,
                (statement) => {
                    // Create properly indented code
                    const source = `if 1 == 1 {
    ${statement}
}`;
                    const doc_state = create_document_state(source);
                    
                    const diagnostics = analyzer.analyze(doc_state, default_config);
                    
                    // Should NOT have UNNECESSARY_INDENTATION for the body line (line 1)
                    const unnecessary_on_body = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                             d.range.start.line === 1
                    );
                    
                    expect(unnecessary_on_body.length).toBe(0);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 5: Excluded lines produce no unnecessary diagnostic
     * 
     * For any blank line, comment-only line, or continuation line (following ///),
     * regardless of its indentation, the IndentationDiagnosticAnalyzer SHALL NOT
     * emit an UNNECESSARY_INDENTATION diagnostic.
     * 
     * Validates: Requirements 2.3, 2.4
     */
    test('Property 5: Excluded lines produce no unnecessary diagnostic', () => {
        // Test blank lines
        fc.assert(
            fc.property(
                indentation_arb,
                (indent) => {
                    // Blank line with indentation
                    const source = `gen x = 1\n${indent}\ngen y = 2`;
                    const doc_state = create_document_state(source);
                    
                    const diagnostics = analyzer.analyze(doc_state, default_config);
                    
                    // Should NOT have UNNECESSARY_INDENTATION for the blank line (line 1)
                    const unnecessary_on_blank = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                             d.range.start.line === 1
                    );
                    
                    expect(unnecessary_on_blank.length).toBe(0);
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );

        // Test comment-only lines
        fc.assert(
            fc.property(
                indentation_arb,
                fc.constantFrom('// comment', '* star comment'),
                (indent, comment) => {
                    // Comment line with indentation
                    const source = `gen x = 1\n${indent}${comment}\ngen y = 2`;
                    const doc_state = create_document_state(source);
                    
                    const diagnostics = analyzer.analyze(doc_state, default_config);
                    
                    // Should NOT have UNNECESSARY_INDENTATION for the comment line (line 1)
                    const unnecessary_on_comment = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                             d.range.start.line === 1
                    );
                    
                    expect(unnecessary_on_comment.length).toBe(0);
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );

        // Test continuation lines
        fc.assert(
            fc.property(
                indentation_arb,
                (indent) => {
                    // Continuation line with indentation
                    const source = `gen x = 1 ///\n${indent}+ 2`;
                    const doc_state = create_document_state(source);
                    
                    const diagnostics = analyzer.analyze(doc_state, default_config);
                    
                    // Should NOT have UNNECESSARY_INDENTATION for the continuation line (line 1)
                    const unnecessary_on_continuation = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                             d.range.start.line === 1
                    );
                    
                    expect(unnecessary_on_continuation.length).toBe(0);
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });
});

describe('Formatter Indentation Normalization Properties', () => {
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    // Generator for simple statements
    const simple_statement = fc.constantFrom(
        'gen x = 1',
        'display "hello"',
        'local y = 2',
        'replace x = 2'
    );

    // Generator for mixed indentation (spaces and tabs combined)
    const mixed_indentation_arb = fc.tuple(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 2 })
    ).map(([spaces, tabs]) => {
        // Create various mixed patterns
        const patterns = [
            ' '.repeat(spaces) + '\t'.repeat(tabs),  // spaces then tabs
            '\t'.repeat(tabs) + ' '.repeat(spaces),  // tabs then spaces
            ' '.repeat(spaces) + '\t' + ' '.repeat(spaces),  // space-tab-space
        ];
        return patterns[Math.floor(Math.random() * patterns.length)];
    });

    /**
     * Property 6: Formatter normalizes indentation to configured style
     * 
     * For any Stata source code with mixed indentation (spaces and tabs),
     * after formatting:
     * - If configured for spaces: all leading whitespace SHALL be spaces only
     * - If configured for tabs: all leading whitespace SHALL be tabs only
     * 
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    for_each_formatter_mode_property(
        'Property 6: Formatter normalizes indentation to configured style',
        fc.tuple(simple_statement, mixed_indentation_arb),
        (mode: FormatterMode, [statement, mixed_indent]) => {
            // Create source with mixed indentation inside a block
            const source = `if 1 == 1 {\n${mixed_indent}${statement}\n}`;
            const doc_state = create_document_state(source);
            
            // Test with spaces configuration
            const spaces_config = {
                ...create_formatter_config(mode),
                formatting: {
                    ...create_formatter_config(mode).formatting,
                    indentStyle: 'spaces' as const,
                    indentSize: 4,
                },
            };
            
            const spaces_edits = formatter.format(doc_state, options, spaces_config);
            
            if (spaces_edits.length > 0) {
                const formatted_spaces = spaces_edits[0].newText;
                const the_lines = formatted_spaces.split('\n');
                
                // Skip for AST mode which may not preserve structure
                skip_for_mode(mode, 'ast', () => {
                    // Body line (line 1) should have only spaces for indentation
                    const body_line = the_lines[1];
                    if (body_line && body_line.trim()) {
                        const leading_whitespace = body_line.match(/^(\s*)/)?.[1] || '';
                        // Should not contain tabs
                        expect(leading_whitespace.includes('\t')).toBe(false);
                        // Should have some spaces (4 for depth 1)
                        expect(leading_whitespace.length).toBeGreaterThan(0);
                    }
                });
            }
            
            // Test with tabs configuration
            const tabs_config = {
                ...create_formatter_config(mode),
                formatting: {
                    ...create_formatter_config(mode).formatting,
                    indentStyle: 'tabs' as const,
                    indentSize: 4,
                },
            };
            
            const tabs_edits = formatter.format(doc_state, { tabSize: 4, insertSpaces: false }, tabs_config);
            
            if (tabs_edits.length > 0) {
                const formatted_tabs = tabs_edits[0].newText;
                const the_lines = formatted_tabs.split('\n');
                
                // Skip for AST mode which may not preserve structure
                skip_for_mode(mode, 'ast', () => {
                    // Body line (line 1) should have only tabs for indentation
                    const body_line = the_lines[1];
                    if (body_line && body_line.trim()) {
                        const leading_whitespace = body_line.match(/^(\s*)/)?.[1] || '';
                        // Should not contain spaces in leading whitespace
                        expect(leading_whitespace.includes(' ')).toBe(false);
                        // Should have at least one tab (for depth 1)
                        expect(leading_whitespace.includes('\t')).toBe(true);
                    }
                });
            }
            
            return true;
        },
        100
    );
});


describe('Formatter Content Preservation Properties', () => {
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    // Generator for simple statements with various content
    const statement_with_content = fc.constantFrom(
        'gen x = 1',
        'display "hello world"',
        'local y = 2 + 3',
        'replace x = y * 2',
        'summarize x y z',
        'regress y x, robust',
        'gen z = x + y if x > 0',
        'local msg "test message"'
    );

    // Generator for various indentation patterns
    const any_indentation = fc.tuple(
        fc.integer({ min: 0, max: 8 }),
        fc.boolean()
    ).map(([count, use_tabs]) => {
        if (count === 0) return '';
        if (use_tabs) {
            return '\t'.repeat(Math.ceil(count / 4));
        }
        return ' '.repeat(count);
    });

    /**
     * Property 7: Formatter preserves non-whitespace content
     * 
     * For any Stata source code, after formatting, the non-whitespace content
     * of each line SHALL be identical to the original.
     * 
     * Validates: Requirements 3.4
     */
    for_each_formatter_mode_property(
        'Property 7: Formatter preserves non-whitespace content',
        fc.tuple(statement_with_content, any_indentation),
        (mode: FormatterMode, [statement, indent]) => {
            // Create source with various indentation
            const source = `if 1 == 1 {\n${indent}${statement}\n}`;
            const doc_state = create_document_state(source);
            
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc_state, options, config);
            
            if (edits.length > 0) {
                const formatted = edits[0].newText;
                const original_lines = source.split('\n');
                const formatted_lines = formatted.split('\n');
                
                // Skip for AST mode which may restructure code
                skip_for_mode(mode, 'ast', () => {
                    // For each line, the trimmed content should be preserved
                    for (let i = 0; i < Math.min(original_lines.length, formatted_lines.length); i++) {
                        const original_trimmed = original_lines[i].trim();
                        const formatted_trimmed = formatted_lines[i].trim();
                        
                        // Non-whitespace content should be identical
                        expect(formatted_trimmed).toBe(original_trimmed);
                    }
                });
            }
            
            return true;
        },
        100
    );

    /**
     * Additional test: Content preservation with mixed indentation
     * 
     * Verifies that mixed indentation is normalized without affecting
     * the actual code content.
     */
    for_each_formatter_mode_property(
        'Property 7b: Mixed indentation normalization preserves content',
        statement_with_content,
        (mode: FormatterMode, statement) => {
            // Create source with mixed indentation (space + tab)
            const mixed_indent = ' \t';
            const source = `if 1 == 1 {\n${mixed_indent}${statement}\n}`;
            const doc_state = create_document_state(source);
            
            const config = create_formatter_config(mode);
            const edits = formatter.format(doc_state, options, config);
            
            if (edits.length > 0) {
                const formatted = edits[0].newText;
                
                // Skip for AST mode which may restructure code
                skip_for_mode(mode, 'ast', () => {
                    // The statement content should be preserved
                    expect(formatted).toContain(statement);
                    
                    // The formatted output should be parseable
                    const formatted_doc = create_document_state(formatted);
                    expect(formatted_doc.ast).toBeDefined();
                    expect(formatted_doc.tokens).toBeDefined();
                });
            }
            
            return true;
        },
        100
    );
});


describe('Round-Trip Diagnostic Elimination Properties', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    const default_config: StataLSPConfig = {
        ...DEFAULT_SETTINGS,
        diagnostics: {
            ...DEFAULT_SETTINGS.diagnostics,
            enabled: true,
            indentation: true,
        },
    };

    // Generator for simple statements
    const simple_statement = fc.constantFrom(
        'gen x = 1',
        'display "hello"',
        'local y = 2',
        'replace x = 2',
        'summarize x',
        'regress y x'
    );

    // Generator for various indentation patterns (including problematic ones)
    const problematic_indentation = fc.oneof(
        // Spaces only (various amounts)
        fc.integer({ min: 1, max: 12 }).map(n => ' '.repeat(n)),
        // Tabs only
        fc.integer({ min: 1, max: 3 }).map(n => '\t'.repeat(n)),
        // Mixed: spaces then tabs
        fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 2 }))
            .map(([s, t]) => ' '.repeat(s) + '\t'.repeat(t)),
        // Mixed: tabs then spaces
        fc.tuple(fc.integer({ min: 1, max: 2 }), fc.integer({ min: 1, max: 4 }))
            .map(([t, s]) => '\t'.repeat(t) + ' '.repeat(s))
    );

    /**
     * Property 8: Formatting eliminates all indentation diagnostics (Round-trip)
     * 
     * For any Stata source code, after running the formatter, re-analyzing
     * the formatted code SHALL produce zero indentation diagnostics
     * (UNNECESSARY_INDENTATION or MISSING_INDENTATION).
     * 
     * Validates: Requirements 4.1, 4.2, 4.3
     */
    for_each_formatter_mode_property(
        'Property 8: Formatting eliminates all indentation diagnostics',
        fc.tuple(simple_statement, problematic_indentation),
        (mode: FormatterMode, [statement, indent]) => {
            // Create source with indentation issues at top level
            const source_top_level = `${indent}${statement}`;
            const doc_state_top = create_document_state(source_top_level);
            
            const config = {
                ...create_formatter_config(mode),
                diagnostics: {
                    ...default_config.diagnostics,
                },
            };
            
            // Format the code
            const edits_top = formatter.format(doc_state_top, options, config);
            
            if (edits_top.length > 0) {
                const formatted_top = edits_top[0].newText;
                
                // Re-analyze the formatted code
                const formatted_doc_top = create_document_state(formatted_top);
                const diagnostics_after_top = analyzer.analyze(formatted_doc_top, default_config);
                
                // Filter for indentation diagnostics only
                const indent_diagnostics_top = diagnostics_after_top.filter(
                    d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                         d.code === StataDiagnosticCode.MISSING_INDENTATION
                );
                
                // Should have no indentation diagnostics after formatting
                expect(indent_diagnostics_top.length).toBe(0);
            }
            
            return true;
        },
        100
    );

    /**
     * Property 8b: Formatting eliminates diagnostics inside blocks
     * 
     * For any Stata source code with indentation issues inside brace blocks,
     * after formatting, there should be no indentation diagnostics.
     * 
     * Validates: Requirements 4.1, 4.2, 4.3
     */
    for_each_formatter_mode_property(
        'Property 8b: Formatting eliminates diagnostics inside blocks',
        fc.tuple(simple_statement, problematic_indentation),
        (mode: FormatterMode, [statement, indent]) => {
            // Create source with indentation issues inside a block
            const source_block = `if 1 == 1 {\n${indent}${statement}\n}`;
            const doc_state_block = create_document_state(source_block);
            
            const config = {
                ...create_formatter_config(mode),
                diagnostics: {
                    ...default_config.diagnostics,
                },
            };
            
            // Format the code
            const edits_block = formatter.format(doc_state_block, options, config);
            
            if (edits_block.length > 0) {
                const formatted_block = edits_block[0].newText;
                
                // Skip for AST mode which may restructure code
                skip_for_mode(mode, 'ast', () => {
                    // Re-analyze the formatted code
                    const formatted_doc_block = create_document_state(formatted_block);
                    const diagnostics_after_block = analyzer.analyze(formatted_doc_block, default_config);
                    
                    // Filter for indentation diagnostics only
                    const indent_diagnostics_block = diagnostics_after_block.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                             d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );
                    
                    // Should have no indentation diagnostics after formatting
                    expect(indent_diagnostics_block.length).toBe(0);
                });
            }
            
            return true;
        },
        100
    );

    /**
     * Property 8c: Formatting eliminates diagnostics in nested blocks
     * 
     * For any Stata source code with nested blocks and indentation issues,
     * after formatting, there should be no indentation diagnostics.
     * 
     * Validates: Requirements 4.1, 4.2, 4.3
     */
    for_each_formatter_mode_property(
        'Property 8c: Formatting eliminates diagnostics in nested blocks',
        fc.tuple(simple_statement, problematic_indentation),
        (mode: FormatterMode, [statement, indent]) => {
            // Create source with nested blocks and indentation issues
            const source_nested = `if 1 == 1 {\n${indent}if 2 == 2 {\n${indent}${statement}\n}\n}`;
            const doc_state_nested = create_document_state(source_nested);
            
            const config = {
                ...create_formatter_config(mode),
                diagnostics: {
                    ...default_config.diagnostics,
                },
            };
            
            // Format the code
            const edits_nested = formatter.format(doc_state_nested, options, config);
            
            if (edits_nested.length > 0) {
                const formatted_nested = edits_nested[0].newText;
                
                // Skip for AST mode which may restructure code
                skip_for_mode(mode, 'ast', () => {
                    // Re-analyze the formatted code
                    const formatted_doc_nested = create_document_state(formatted_nested);
                    const diagnostics_after_nested = analyzer.analyze(formatted_doc_nested, default_config);
                    
                    // Filter for indentation diagnostics only
                    const indent_diagnostics_nested = diagnostics_after_nested.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                             d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );
                    
                    // Should have no indentation diagnostics after formatting
                    expect(indent_diagnostics_nested.length).toBe(0);
                });
            }
            
            return true;
        },
        100
    );
});

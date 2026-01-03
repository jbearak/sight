/**
 * Regression test for formatter tabSize respect bug.
 * 
 * Issue: The IndentationAnalyzer had a hardcoded indent_size = 4, ignoring
 * the user's configured tabSize. This caused incorrect indentation when
 * users configured tabSize to values other than 4 (e.g., 2 spaces).
 * 
 * The bug was particularly visible with nested blocks and continuation lines,
 * where the indent_delta calculation was wrong.
 * 
 * Requirements: 2.1, 2.2
 */

import { describe, it, expect } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { FormattingOptions } from 'vscode-languageserver';
import { create_document_state } from '../property/helpers/document-utils';

describe('Formatter tabSize respect - Regression test', () => {
    const formatter = new CodeFormatter();

    it('should indent nested if block body at 4 spaces with tabSize=2 (2 levels × 2 spaces)', async () => {
        // This is the exact reproduction case from the bug report:
        // - Nested if block with continuation lines in condition
        // - tabSize = 2
        // - Inner content should be at 4 spaces (2 levels × 2 spaces)
        const my_source = `capture confirm variable mn35
if (_rc == 0) {
local variable_label_for_mn35: variable label mn35
if strpos("\`variable_label_for_mn35'", "test1") | ///
   strpos("\`variable_label_for_mn35'", "test2") {
* then:
replace period_returned = mn35
* Recode values
replace period_returned = 0 if period_returned == 2
}
}`;

        const my_options: FormattingOptions = { tabSize: 2, insertSpaces: true };
        const my_doc = create_document_state(my_source);
        
        const my_config = {
            ...DEFAULT_SETTINGS,
            formatting: {
                ...DEFAULT_SETTINGS.formatting,
                mode: 'source-preserving' as const,
            },
        };
        
        const my_result = await formatter.format(my_doc, my_options, my_config);
        const my_formatted = my_result[0]?.newText ?? my_source;
        
        const my_lines = my_formatted.split('\n');
        
        // Lines inside the inner if block should have 4 spaces (2 levels × 2 spaces)
        const then_line = my_lines.find(l => l.includes('* then:'));
        expect(then_line).toBe('    * then:');
        
        const replace_mn35_line = my_lines.find(l => l.includes('replace period_returned = mn35'));
        expect(replace_mn35_line).toBe('    replace period_returned = mn35');
        
        const recode_comment_line = my_lines.find(l => l.includes('* Recode values'));
        expect(recode_comment_line).toBe('    * Recode values');
        
        const replace_recode_line = my_lines.find(l => l.includes('replace period_returned = 0'));
        expect(replace_recode_line).toBe('    replace period_returned = 0 if period_returned == 2');
    });

    it('should indent nested blocks correctly with tabSize=2', async () => {
        // Simpler case: two levels of nesting with tabSize=2
        const my_source = `if a {
if b {
replace x = 1
}
}`;

        const my_options: FormattingOptions = { tabSize: 2, insertSpaces: true };
        const my_doc = create_document_state(my_source);
        
        const my_config = {
            ...DEFAULT_SETTINGS,
            formatting: {
                ...DEFAULT_SETTINGS.formatting,
                mode: 'source-preserving' as const,
            },
        };
        
        const my_result = await formatter.format(my_doc, my_options, my_config);
        const my_formatted = my_result[0]?.newText ?? my_source;
        
        const my_lines = my_formatted.split('\n');
        
        // Outer if: 0 spaces
        expect(my_lines[0]).toBe('if a {');
        // Inner if: 2 spaces (1 level × 2 spaces)
        expect(my_lines[1]).toBe('  if b {');
        // replace: 4 spaces (2 levels × 2 spaces)
        expect(my_lines[2]).toBe('    replace x = 1');
        // Inner closing brace: 2 spaces
        expect(my_lines[3]).toBe('  }');
        // Outer closing brace: 0 spaces
        expect(my_lines[4]).toBe('}');
    });

    it('should indent nested blocks correctly with tabSize=4', async () => {
        // Same structure but with tabSize=4 for comparison
        const my_source = `if a {
if b {
replace x = 1
}
}`;

        const my_options: FormattingOptions = { tabSize: 4, insertSpaces: true };
        const my_doc = create_document_state(my_source);
        
        const my_config = {
            ...DEFAULT_SETTINGS,
            formatting: {
                ...DEFAULT_SETTINGS.formatting,
                mode: 'source-preserving' as const,
            },
        };
        
        const my_result = await formatter.format(my_doc, my_options, my_config);
        const my_formatted = my_result[0]?.newText ?? my_source;
        
        const my_lines = my_formatted.split('\n');
        
        // Outer if: 0 spaces
        expect(my_lines[0]).toBe('if a {');
        // Inner if: 4 spaces (1 level × 4 spaces)
        expect(my_lines[1]).toBe('    if b {');
        // replace: 8 spaces (2 levels × 4 spaces)
        expect(my_lines[2]).toBe('        replace x = 1');
        // Inner closing brace: 4 spaces
        expect(my_lines[3]).toBe('    }');
        // Outer closing brace: 0 spaces
        expect(my_lines[4]).toBe('}');
    });

    it('should handle continuation lines in nested block condition with tabSize=2', async () => {
        // Nested if with continuation lines in condition
        const my_source = `if a {
if b | ///
   c {
replace x = 1
}
}`;

        const my_options: FormattingOptions = { tabSize: 2, insertSpaces: true };
        const my_doc = create_document_state(my_source);
        
        const my_config = {
            ...DEFAULT_SETTINGS,
            formatting: {
                ...DEFAULT_SETTINGS.formatting,
                mode: 'source-preserving' as const,
            },
        };
        
        const my_result = await formatter.format(my_doc, my_options, my_config);
        const my_formatted = my_result[0]?.newText ?? my_source;
        
        const my_lines = my_formatted.split('\n');
        
        // Inner if: 2 spaces (1 level × 2 spaces)
        expect(my_lines[1]).toMatch(/^  if b/);
        // replace: 4 spaces (2 levels × 2 spaces)
        const replace_line = my_lines.find(l => l.includes('replace'));
        expect(replace_line).toBe('    replace x = 1');
    });
});

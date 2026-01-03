/**
 * Reproduction test for nested if block indentation issue.
 * 
 * Issue: When there's a nested if block where the condition spans multiple
 * continuation lines, the formatter doesn't fix the indentation of the
 * statements inside the inner block, even though diagnostics are correctly
 * emitted.
 * 
 * NOTE: This is a reproduction test file used for debugging the original issue.
 * The comprehensive regression tests are in tests/integration/formatter-tabsize-respect.test.ts.
 * This file is kept for historical reference and manual debugging of similar issues.
 */

import { describe, it, expect } from 'bun:test';
import { CodeFormatter } from '../src/providers/formatter';
import { DEFAULT_SETTINGS } from '../src/server-handlers';
import { FormattingOptions } from 'vscode-languageserver';
import { create_document_state } from './property/helpers/document-utils';

describe('Nested if block indentation issue', () => {
    const formatter = new CodeFormatter();
    const options: FormattingOptions = { tabSize: 2, insertSpaces: true };

    it('should fix indentation inside nested if block with continuation lines', async () => {
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

        const my_doc = create_document_state(my_source);
        
        // Now format the document
        const my_config = {
            ...DEFAULT_SETTINGS,
            formatting: {
                ...DEFAULT_SETTINGS.formatting,
                mode: 'source-preserving' as const,
            },
        };
        
        const my_result = await formatter.format(my_doc, options, my_config);
        const my_formatted = my_result[0]?.newText ?? my_source;
        
        const my_lines = my_formatted.split('\n');
        
        // The lines inside the inner if block should be indented
        // Line with "* then:" should have 4 spaces (2 levels of nesting * 2 spaces)
        const then_line = my_lines.find(l => l.includes('* then:'));
        expect(then_line).toMatch(/^    \* then:/);
        
        // Line with "replace period_returned = mn35" should have 4 spaces
        const replace_line = my_lines.find(l => l.includes('replace period_returned = mn35'));
        expect(replace_line).toMatch(/^    replace/);
    });

    it('should fix indentation in simpler nested if case', async () => {
        // Simpler case without continuation lines
        const my_source = `if a {
if b {
replace x = 1
}
}`;

        const my_doc = create_document_state(my_source);
        
        const my_config = {
            ...DEFAULT_SETTINGS,
            formatting: {
                ...DEFAULT_SETTINGS.formatting,
                mode: 'source-preserving' as const,
            },
        };
        
        const my_result = await formatter.format(my_doc, options, my_config);
        const my_formatted = my_result[0]?.newText ?? my_source;
        
        const my_lines = my_formatted.split('\n');
        
        // Inner if should have 2 spaces
        expect(my_lines[1]).toMatch(/^  if b/);
        // replace should have 4 spaces
        expect(my_lines[2]).toMatch(/^    replace/);
        // Inner closing brace should have 2 spaces
        expect(my_lines[3]).toMatch(/^  }/);
    });

    it('should fix indentation in nested if with continuation condition', async () => {
        // Case with continuation lines in the condition
        const my_source = `if a {
if b | ///
   c {
replace x = 1
}
}`;

        const my_doc = create_document_state(my_source);
        
        const my_config = {
            ...DEFAULT_SETTINGS,
            formatting: {
                ...DEFAULT_SETTINGS.formatting,
                mode: 'source-preserving' as const,
            },
        };
        
        const my_result = await formatter.format(my_doc, options, my_config);
        const my_formatted = my_result[0]?.newText ?? my_source;
        
        const my_lines = my_formatted.split('\n');
        
        // Inner if should have 2 spaces
        expect(my_lines[1]).toMatch(/^  if b/);
        // replace should have 4 spaces (inside nested if)
        const replace_line = my_lines.find(l => l.includes('replace'));
        expect(replace_line).toMatch(/^    replace/);
    });
});

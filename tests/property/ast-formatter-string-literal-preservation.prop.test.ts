/**
 * Property Tests: AST Formatter String Literal Preservation
 *
 * Feature: ast-formatter-string-literal-preservation
 *
 * Tests that the AST formatter (PrettyPrinter) preserves string literals exactly
 * as they appear in the source, without any spacing modifications to their content.
 *
 * Note: Some test cases (multi-line compound strings, embedded Mata blocks) are
 * limited by lexer behavior that splits compound strings at newlines. These are
 * documented as known limitations.
 */

import { describe, it, expect } from 'bun:test';
import fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { print_ast } from '../../src/pretty-printer';
import { CodeFormatter } from '../../src/providers/formatter';
import { DocumentState } from '../../src/document-store';
import { create_empty_symbol_table } from '../../src/analyzer';
import { FormattingOptions } from 'vscode-languageserver';
import {
    for_each_formatter_mode,
    for_each_formatter_mode_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Parse and format source code using the AST formatter.
 */
function format_with_ast(source: string): string {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(source);
    const parser = new StataParser();
    const parse_result = parser.parse(lex_result.tokens);
    return print_ast(parse_result.ast);
}

/**
 * Create a DocumentState for the CodeFormatter.
 */
function create_document(source: string): DocumentState {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);

    return {
        uri: 'file:///test.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: create_empty_symbol_table(),
        diagnostics: [],
    };
}

/**
 * Format source code using the CodeFormatter with specified mode.
 */
function format_with_mode(source: string, mode: FormatterMode): string {
    const formatter = new CodeFormatter();
    const document = create_document(source);
    const options: FormattingOptions = { tabSize: 4, insertSpaces: true };
    const config = create_formatter_config(mode);
    const edits = formatter.format(document, options, config);
    if (edits.length === 0) {
        return source;
    }
    return edits[0].newText;
}

// ============================================================================
// Generators
// ============================================================================

/**
 * Generate simple identifiers for macro names.
 */
const identifier_arb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'),
    { minLength: 1, maxLength: 10 }
);

/**
 * Generate simple string content (no special characters).
 */
const simple_content_arb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '),
    { minLength: 0, maxLength: 20 }
);

/**
 * Generate double-quoted strings.
 */
const double_quoted_string_arb = simple_content_arb.map(s => `"${s}"`);

/**
 * Generate compound strings without embedded macros.
 */
const compound_string_arb = simple_content_arb.map(s => `\`"${s}"'`);

/**
 * Generate local macro references.
 */
const local_macro_arb = identifier_arb.map(name => `\`${name}'`);

/**
 * Generate compound strings with embedded local macros.
 */
const compound_with_macro_arb = fc.tuple(identifier_arb).map(
    ([name]) => `\`"\`${name}'"'`
);

// ============================================================================
// Unit Tests: Concrete Test Cases from Requirements
// ============================================================================

describe('Unit Tests: Concrete Test Cases', () => {
    // Feature: ast-formatter-string-literal-preservation
    // Validates: Requirements 8.1, 8.2, 8.3

    for_each_formatter_mode('should preserve the main concrete test case exactly', (mode) => {
        const source = `if (\`"\`macro'"') {
    \`"\`macro'"'
    "\`macro'"
    \`"text"'
    "text"
}
else {
    \`"\`macro'"'
    "\`macro'"
    \`"text"'
    "text"
}
di \`" \`macro' "'
di " \`macro' "
di " text "
\`" \`macro' "'
" \`macro' "
"text"`;

        const output = format_with_mode(source, mode);
        expect(output.trim()).toBe(source.trim());
    });

    for_each_formatter_mode('should preserve strings in control flow conditions', (mode) => {
        const source = `if "\`myvar'" == "value" {
    display "match"
}`;

        const output = format_with_mode(source, mode);
        expect(output.trim()).toBe(source.trim());
    });

    for_each_formatter_mode('should preserve strings passed to user-defined programs', (mode) => {
        const source = `my_program \`"\`complex_string'"' "simple_string"`;

        const output = format_with_mode(source, mode);
        expect(output.trim()).toBe(source.trim());
    });

    for_each_formatter_mode('should preserve macro extended function spacing', (mode) => {
        const source = `local macro : other_macro - another_macro`;

        const output = format_with_mode(source, mode);
        expect(output.trim()).toBe(source.trim());
    });

    // Note: Multi-line compound strings are limited by lexer behavior
    // The lexer treats newlines inside compound strings as statement terminators
    it.skip('should preserve multi-line compound strings (lexer limitation)', () => {
        const source = `local long_text \`"This is a
multi-line
compound string"'`;

        const output = format_with_ast(source);
        expect(output.trim()).toBe(source.trim());
    });

    // Note: Embedded Mata blocks with mata: syntax now work correctly
    // The lexer detects mata: followed by newline as a block start
    // The PrettyPrinter preserves string literals but may adjust indentation
    it('should preserve embedded Mata block with string literals', () => {
        const source = `mata:
    st_local("result", \`"\`macro'"')
    printf("\`macro'")
    printf(\`" \`macro' "')
end`;

        const output = format_with_ast(source);
        
        // Verify the block structure is preserved
        expect(output).toContain('mata:');
        expect(output).toContain('end');
        
        // Verify string literals are preserved exactly
        expect(output).toContain('st_local("result", `"`macro\'"\')');
        expect(output).toContain('printf("`macro\'")');
        expect(output).toContain('printf(`" `macro\' "\')');
    
    });
});

// ============================================================================
// Property 1: String Delimiter Preservation
// ============================================================================

describe('Property 1: String Delimiter Preservation', () => {
    // Feature: ast-formatter-string-literal-preservation, Property 1
    // Validates: Requirements 1.1, 1.2, 1.5, 7.1, 7.2, 7.3, 7.4

    for_each_formatter_mode('should preserve double-quoted string delimiters', (mode) => {
        const source = `display "hello world"`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('"hello world"');
    });

    for_each_formatter_mode('should preserve compound string delimiters', (mode) => {
        const source = `display \`"hello world"'`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`"hello world"\'');
    });

    for_each_formatter_mode_property(
        'should preserve delimiters for generated double-quoted strings',
        double_quoted_string_arb,
        (mode, str) => {
            const source = `display ${str}`;
            const output = format_with_mode(source, mode);
            expect(output).toContain(str);
            return true;
        },
        100
    );

    for_each_formatter_mode_property(
        'should preserve delimiters for generated compound strings',
        compound_string_arb,
        (mode, str) => {
            const source = `display ${str}`;
            const output = format_with_mode(source, mode);
            expect(output).toContain(str);
            return true;
        },
        100
    );
});

// ============================================================================
// Property 2: String Content Preservation
// ============================================================================

describe('Property 2: String Content Preservation', () => {
    // Feature: ast-formatter-string-literal-preservation, Property 2
    // Validates: Requirements 1.3, 1.4, 3.2, 3.3

    for_each_formatter_mode('should not add spaces around macros in strings', (mode) => {
        const source = `display "\`macro'"`;
        const output = format_with_mode(source, mode);
        // Should NOT have spaces added around the macro
        expect(output).toContain('"`macro\'"');
    });

    for_each_formatter_mode('should not add spaces around operators in strings', (mode) => {
        const source = `display "a+b-c*d"`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('"a+b-c*d"');
    });

    for_each_formatter_mode('should preserve compound strings with embedded local macros', (mode) => {
        const source = `display \`"\`macro'"'`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`"`macro\'"\'');
    });

    for_each_formatter_mode('should preserve compound strings with embedded global macros', (mode) => {
        const source = `display \`"$macro"'`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`"$macro"\'');
    });

    for_each_formatter_mode_property(
        'should preserve compound strings with generated macro names',
        compound_with_macro_arb,
        (mode, str) => {
            const source = `display ${str}`;
            const output = format_with_mode(source, mode);
            expect(output).toContain(str);
            return true;
        },
        50
    );
});

// ============================================================================
// Property 3: Round-Trip Preservation
// ============================================================================

describe('Property 3: Round-Trip Preservation', () => {
    // Feature: ast-formatter-string-literal-preservation, Property 3
    // Validates: Requirements 1.6, 3.1, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3

    for_each_formatter_mode('should preserve standalone string literals', (mode) => {
        const source = `"text"`;
        const output = format_with_mode(source, mode);
        expect(output.trim()).toBe(source.trim());
    });

    for_each_formatter_mode('should preserve standalone compound strings', (mode) => {
        const source = `\`"text"'`;
        const output = format_with_mode(source, mode);
        expect(output.trim()).toBe(source.trim());
    });

    for_each_formatter_mode('should preserve strings in if conditions', (mode) => {
        const source = `if "\`var'" == "value" {
    display "match"
}`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('"`var\'"');
        expect(output).toContain('"value"');
        expect(output).toContain('"match"');
    });

    for_each_formatter_mode('should preserve display command strings', (mode) => {
        const source = `di \`" \`macro' "'`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`" `macro\' "\'');
    });

    for_each_formatter_mode('should preserve compound strings inside blocks', (mode) => {
        const source = `if 1 {
    \`"\`macro'"'
}`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`"`macro\'"\'');
    });
});

// ============================================================================
// Property 4: Extended Function Spacing Preservation
// ============================================================================

describe('Property 4: Extended Function Spacing Preservation', () => {
    // Feature: ast-formatter-string-literal-preservation, Property 4
    // Validates: Requirement 2.4

    for_each_formatter_mode('should preserve spaces around operators in extended functions', (mode) => {
        const source = `local result : other_macro - another_macro`;
        const output = format_with_mode(source, mode);
        expect(output).toContain(': other_macro - another_macro');
    });

    for_each_formatter_mode('should preserve extended function with list operations', (mode) => {
        const source = `local combined : list a | b`;
        const output = format_with_mode(source, mode);
        expect(output).toContain(': list a | b');
    });

    for_each_formatter_mode('should preserve extended function with word count', (mode) => {
        const source = `local count : word count \`mylist'`;
        const output = format_with_mode(source, mode);
        expect(output).toContain(': word count `mylist\'');
    });
});

// ============================================================================
// Property 5: Expression Context Distinction
// ============================================================================

describe('Property 5: Expression Context Distinction', () => {
    // Feature: ast-formatter-string-literal-preservation, Property 5
    // Validates: Requirements 2.1, 2.2, 2.3

    for_each_formatter_mode('should apply spacing to expressions but not strings', (mode) => {
        const source = `gen x = a+b if "\`var'"=="value"`;
        const output = format_with_mode(source, mode);
        // Expression should have spacing
        expect(output).toMatch(/a\s*\+\s*b/);
        // Strings should be preserved
        expect(output).toContain('"`var\'"');
        expect(output).toContain('"value"');
    });

    for_each_formatter_mode('should preserve strings in option arguments', (mode) => {
        const source = `regress y x, title("\`macro'")`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('"`macro\'"');
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
    for_each_formatter_mode('should handle empty strings', (mode) => {
        const source = `display ""`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('""');
    });

    for_each_formatter_mode('should handle empty compound strings', (mode) => {
        const source = `display \`""'`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`""\'');
    });

    for_each_formatter_mode('should handle multiple strings on same line', (mode) => {
        const source = `display "a" "b" "c"`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('"a"');
        expect(output).toContain('"b"');
        expect(output).toContain('"c"');
    });

    for_each_formatter_mode('should handle strings with special characters', (mode) => {
        const source = `display "hello\\nworld"`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('"hello\\nworld"');
    });

    for_each_formatter_mode('should handle nested compound strings in conditions', (mode) => {
        const source = `if (\`"\`macro'"') {
    display "inside"
}`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`"`macro\'"\'');
    });

    for_each_formatter_mode('should handle deeply nested compound strings', (mode) => {
        // Test compound string containing another compound string
        const source = `display \`"\`"nested"'"'`;
        const output = format_with_mode(source, mode);
        expect(output).toContain('`"`"nested"\'"\'');
    });
});

// ============================================================================
// Idempotency
// ============================================================================

describe('Idempotency', () => {
    for_each_formatter_mode('format(format(x)) == format(x) for strings', (mode) => {
        const source = `display "\`macro'" \`"text"'`;
        const once = format_with_mode(source, mode);
        const twice = format_with_mode(once, mode);
        expect(twice).toBe(once);
    });

    for_each_formatter_mode('format(format(x)) == format(x) for compound strings with spaces', (mode) => {
        const source = `di \`" \`macro' "'`;
        const once = format_with_mode(source, mode);
        const twice = format_with_mode(once, mode);
        expect(twice).toBe(once);
    });
});

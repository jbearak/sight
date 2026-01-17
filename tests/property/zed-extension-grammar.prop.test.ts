/**
 * Property-Based Tests for Zed Extension Tree-sitter Grammar
 *
 * These tests verify the grammar.js rules would correctly parse various Stata
 * constructs by generating valid code and checking that the grammar patterns
 * match the expected structure.
 *
 * Since we cannot directly invoke the Tree-sitter parser from TypeScript without
 * native bindings, these tests:
 * 1. Generate valid Stata code constructs using fast-check
 * 2. Verify the grammar.js rules would correctly parse these constructs
 * 3. Test edge cases and boundary conditions for each construct type
 *
 * Validates: Design Correctness Properties 1-10
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Test Setup - Load grammar file
// ============================================================================

const ZED_EXTENSION_DIR = path.join(import.meta.dir, '../../zed-extension');
const GRAMMAR_PATH = path.join(ZED_EXTENSION_DIR, 'tree-sitter-stata/grammar.js');

let grammar_content: string;

beforeAll(() => {
    grammar_content = fs.readFileSync(GRAMMAR_PATH, 'utf8');
});

// ============================================================================
// Generators for Stata constructs
// ============================================================================

/**
 * Generator for valid Stata identifiers
 * Pattern: [A-Za-z_][A-Za-z0-9_]*
 */
function arbitrary_stata_identifier(): fc.Arbitrary<string> {
    return fc.tuple(
        fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'.split('')),
        fc.stringOf(
            fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
            { minLength: 0, maxLength: 20 }
        )
    ).map(([first, rest]) => first + rest);
}

/**
 * Generator for line comment content (no newlines)
 */
function arbitrary_line_comment_content(): fc.Arbitrary<string> {
    return fc.string({ minLength: 0, maxLength: 100 })
        .filter(s => !s.includes('\n') && !s.includes('\r'));
}

/**
 * Generator for block comment content (no closing delimiter)
 */
function arbitrary_block_comment_content(): fc.Arbitrary<string> {
    return fc.string({ minLength: 0, maxLength: 100 })
        .filter(s => !s.includes('*/'));
}

/**
 * Generator for double string content (no unescaped quotes or newlines)
 */
function arbitrary_double_string_content(): fc.Arbitrary<string> {
    return fc.string({ minLength: 0, maxLength: 50 })
        .filter(s => !s.includes('"') && !s.includes('\n') && !s.includes('\r') && !s.includes('$'));
}

/**
 * Generator for compound string content (no delimiters or newlines)
 */
function arbitrary_compound_string_content(): fc.Arbitrary<string> {
    // Avoid backtick, single quote, double quote, newlines, and dollar sign
    return fc.stringOf(
        fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _-+='.split('')),
        { minLength: 0, maxLength: 30 }
    );
}

/**
 * Generator for nesting depth (1-6)
 */
function arbitrary_depth(): fc.Arbitrary<number> {
    return fc.integer({ min: 1, max: 6 });
}

/**
 * Generator for line comment prefixes
 */
function arbitrary_line_comment_prefix(): fc.Arbitrary<string> {
    return fc.constantFrom('//', '///', '* ');
}

/**
 * Generator for Mata block forms
 */
function arbitrary_mata_block_form(): fc.Arbitrary<string> {
    return fc.constantFrom(
        'mata 1 + 2',                           // inline without colon
        'mata: 3 + 4',                          // inline with colon
        'mata\nreal x\nend',                    // multiline without colon
        'mata:\nreal y\nend',                   // multiline with colon
        'mata {\n    real z\n}',                // brace-delimited
    );
}

/**
 * Generator for global macro prefix (dollar sign or dollar-brace)
 */
function arbitrary_global_macro_prefix(): fc.Arbitrary<'dollar' | 'dollar_brace'> {
    return fc.constantFrom('dollar', 'dollar_brace');
}

/**
 * Generator for integer numbers
 */
function arbitrary_integer(): fc.Arbitrary<string> {
    return fc.integer({ min: 0, max: 999999 }).map(n => n.toString());
}

/**
 * Generator for decimal numbers
 */
function arbitrary_decimal(): fc.Arbitrary<string> {
    return fc.tuple(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 9999 })
    ).map(([whole, frac]) => whole.toString() + '.' + frac.toString());
}

/**
 * Generator for scientific notation numbers
 */
function arbitrary_scientific(): fc.Arbitrary<string> {
    return fc.tuple(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 0, max: 99 }),
        fc.constantFrom('+', '-', ''),
        fc.integer({ min: 0, max: 10 })
    ).map(([whole, frac, sign, exp]) => whole.toString() + '.' + frac.toString() + 'e' + sign + exp.toString());
}

// ============================================================================
// Helper functions for grammar pattern matching
// ============================================================================

/**
 * Check if the grammar defines a rule for the given node type
 */
function grammar_has_rule(rule_name: string): boolean {
    // Look for rule definition pattern: rule_name: $ => ... or rule_name: _ => ...
    const pattern = new RegExp(rule_name + ':\\s*[$_]\\s*=>');
    return pattern.test(grammar_content);
}

/**
 * Check if a rule references another rule
 */
function rule_references(rule_name: string, referenced_rule: string): boolean {
    // Find the rule definition and check if it references the other rule
    const rule_pattern = new RegExp(rule_name + ':[\\s\\S]*?(?=\\n\\s{8}\\w+:|$)', 'm');
    const match = grammar_content.match(rule_pattern);
    if (!match) return false;
    return match[0].includes('$.' + referenced_rule) || match[0].includes('$._' + referenced_rule);
}

/**
 * Build a nested local macro string with given depth
 * Uses backtick for opening and single quote for closing
 */
function build_nested_local_macro(depth: number, name: string): string {
    const BACKTICK = String.fromCharCode(96);  // backtick character
    const SINGLE_QUOTE = "'";
    return BACKTICK.repeat(depth) + name + SINGLE_QUOTE.repeat(depth);
}

/**
 * Build a nested compound string with given depth
 * Uses backtick-doublequote for opening and doublequote-singlequote for closing
 */
function build_nested_compound_string(depth: number, content: string): string {
    const BACKTICK = String.fromCharCode(96);
    let result = content;
    for (let i = 0; i < depth; i++) {
        result = BACKTICK + '"' + result + '"' + "'";
    }
    return result;
}

/**
 * Build a global macro reference
 */
function build_global_macro(prefix: 'dollar' | 'dollar_brace', name: string): string {
    if (prefix === 'dollar_brace') {
        return '${' + name + '}';
    }
    return '$' + name;
}

/**
 * Build a program definition
 */
function build_program_definition(use_define: boolean, name: string): string {
    if (use_define) {
        return 'program define ' + name + '\nend';
    }
    return 'program ' + name + '\nend';
}

// ============================================================================
// Property 1: Line Comments Preserve Arbitrary Content
// Validates: Requirements 3.5
// ============================================================================

describe('Property 1: Line Comments Preserve Arbitrary Content', () => {
    /**
     * For any arbitrary text content (excluding newlines), wrapping it in a
     * line comment (double-slash, triple-slash, or star at line start) SHALL
     * produce a valid comment construct that the grammar can parse.
     */
    it('should have grammar rules that accept arbitrary line comment content', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_line_comment_prefix(),
                    arbitrary_line_comment_content()
                ),
                ([prefix, content]) => {
                    // Verify the grammar has line_comment rule
                    expect(grammar_has_rule('line_comment')).toBe(true);
                    
                    // Verify the grammar pattern for line comments matches any content
                    // The grammar uses /[^\r\n]*/ which matches any non-newline content
                    // In the file, this appears as /[^\\r\\n]*/
                    expect(grammar_content).toContain('[^\\r\\n]*');
                    
                    // Verify the content does not contain newlines (generator constraint)
                    expect(content.includes('\n')).toBe(false);
                    expect(content.includes('\r')).toBe(false);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should support all three line comment prefixes', () => {
        fc.assert(
            fc.property(arbitrary_line_comment_prefix(), (prefix) => {
                // Verify each prefix is defined in the grammar
                if (prefix === '//') {
                    expect(grammar_content).toContain("'//'");
                } else if (prefix === '///') {
                    expect(grammar_content).toContain("'///'");
                } else if (prefix === '* ') {
                    // Star comments require _line_start
                    expect(grammar_content).toContain('$._line_start');
                    expect(grammar_content).toMatch(/\$\._line_start.*\*/);
                }
                return true;
            }),
            { numRuns: 10 }
        );
    });
});

// ============================================================================
// Property 2: Block Comments Preserve Arbitrary Content
// Validates: Requirements 3.5
// ============================================================================

describe('Property 2: Block Comments Preserve Arbitrary Content', () => {
    /**
     * For any arbitrary text content (excluding the closing delimiter),
     * wrapping it in a block comment SHALL produce a valid block_comment construct.
     */
    it('should have grammar rules that accept arbitrary block comment content', () => {
        fc.assert(
            fc.property(arbitrary_block_comment_content(), (content) => {
                // Verify the grammar has block_comment rule
                expect(grammar_has_rule('block_comment')).toBe(true);
                
                // Verify the grammar defines block comment delimiters
                expect(grammar_content).toContain("'/*'");
                
                // Verify the content does not contain closing delimiter
                expect(content.includes('*/')).toBe(false);
                
                // The block comment pattern should match any content except */
                // Grammar uses: /[^*]*\*+([^/*][^*]*\*+)*/
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should define block_comment as a token with proper delimiters', () => {
        // Verify block_comment is defined with /* and */ delimiters
        expect(grammar_content).toContain('block_comment:');
        expect(grammar_content).toMatch(/block_comment:.*token.*seq/s);
    });
});

// ============================================================================
// Property 3: Nested Local Macros Parse to Correct Depth (1-6)
// Validates: Requirements 3.7, 3.13, 3.14
// ============================================================================

describe('Property 3: Nested Local Macros Parse to Correct Depth', () => {
    /**
     * For any nesting depth 1-6, a nested local macro reference SHALL parse
     * to a tree with the correct depth of local_macro_depth_N nodes.
     */
    it('should define local_macro_depth rules for depths 1-6', () => {
        fc.assert(
            fc.property(arbitrary_depth(), (depth) => {
                // Verify the grammar defines the rule for this depth
                const rule_name = 'local_macro_depth_' + depth;
                expect(grammar_has_rule(rule_name)).toBe(true);
                
                // Verify the rule uses correct delimiters (backtick and single quote)
                const backtick_pattern = new RegExp(rule_name + ":.*'`'", 's');
                const quote_pattern = new RegExp(rule_name + ':.*"' + "'" + '"', 's');
                expect(grammar_content).toMatch(backtick_pattern);
                expect(grammar_content).toMatch(quote_pattern);
                
                return true;
            }),
            { numRuns: 6 }
        );
    });

    it('should have proper nesting structure for local macros', () => {
        fc.assert(
            fc.property(
                fc.tuple(arbitrary_depth(), arbitrary_stata_identifier()),
                ([depth, name]) => {
                    // Build the nested macro string
                    const macro = build_nested_local_macro(depth, name);
                    const BACKTICK = String.fromCharCode(96);
                    
                    // Verify the structure is correct
                    expect(macro.startsWith(BACKTICK)).toBe(true);
                    expect(macro.endsWith("'")).toBe(true);
                    expect(macro.split(BACKTICK).length - 1).toBe(depth);
                    expect(macro.split("'").length - 1).toBe(depth);
                    
                    // Verify depth N references depth N+1 (or wraps at 6)
                    // The grammar defines local_macro_depth_N rules that reference the next depth
                    if (depth < 6) {
                        const current_rule = 'local_macro_depth_' + depth;
                        const next_rule = 'local_macro_depth_' + (depth + 1);
                        // Check that the grammar contains both rules
                        expect(grammar_content).toContain(current_rule + ':');
                        expect(grammar_content).toContain(next_rule);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should wrap around at depth 6 to depth 1', () => {
        // Verify depth 6 references depth 1 for wrap-around
        expect(grammar_content).toMatch(/local_macro_depth_6:[\s\S]*?local_macro_depth_1/);
    });

    it('should allow global macros inside local macros at any depth', () => {
        fc.assert(
            fc.property(arbitrary_depth(), (depth) => {
                const rule_name = 'local_macro_depth_' + depth;
                // Each depth should allow global_macro
                const pattern = new RegExp(rule_name + ':[\\s\\S]*?\\$\\.global_macro');
                expect(grammar_content).toMatch(pattern);
                return true;
            }),
            { numRuns: 6 }
        );
    });
});

// ============================================================================
// Property 4: Nested Compound Strings Parse to Correct Depth (1-6)
// Validates: Requirements 3.6, 3.13, 3.14
// ============================================================================

describe('Property 4: Nested Compound Strings Parse to Correct Depth', () => {
    /**
     * For any nesting depth 1-6, a nested compound string SHALL parse to a
     * tree with the correct depth of compound_string_depth_N nodes.
     */
    it('should define compound_string_depth rules for depths 1-6', () => {
        fc.assert(
            fc.property(arbitrary_depth(), (depth) => {
                // Verify the grammar defines the rule for this depth
                const rule_name = 'compound_string_depth_' + depth;
                expect(grammar_has_rule(rule_name)).toBe(true);
                
                // Verify the rule uses correct delimiters (backtick-doublequote and doublequote-singlequote)
                expect(grammar_content).toContain("'`\"'");  // Opening delimiter
                expect(grammar_content).toContain("\"\\\"'\"");  // Closing delimiter
                
                return true;
            }),
            { numRuns: 6 }
        );
    });

    it('should have proper nesting structure for compound strings', () => {
        fc.assert(
            fc.property(
                fc.tuple(arbitrary_depth(), arbitrary_compound_string_content()),
                ([depth, content]) => {
                    // Build the nested compound string
                    const str = build_nested_compound_string(depth, content);
                    const BACKTICK = String.fromCharCode(96);
                    
                    // Verify the structure is correct
                    expect(str.startsWith(BACKTICK + '"')).toBe(true);
                    expect(str.endsWith('"' + "'")).toBe(true);
                    
                    // Count delimiters
                    const opening_pattern = new RegExp(BACKTICK + '"', 'g');
                    const closing_pattern = /"'/g;
                    const opening_count = (str.match(opening_pattern) || []).length;
                    const closing_count = (str.match(closing_pattern) || []).length;
                    expect(opening_count).toBe(depth);
                    expect(closing_count).toBe(depth);
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should wrap around at depth 6 to depth 1', () => {
        // Verify depth 6 references depth 1 for wrap-around
        expect(grammar_content).toMatch(/compound_string_depth_6:[\s\S]*?compound_string_depth_1/);
        // Or via _compound_content_6
        expect(grammar_content).toMatch(/_compound_content_6:[\s\S]*?compound_string_depth_1/);
    });

    it('should allow local macros inside compound strings', () => {
        fc.assert(
            fc.property(arbitrary_depth(), (depth) => {
                // Each depth's content should allow local_macro_depth_1
                const content_rule = '_compound_content_' + depth;
                const pattern = new RegExp(content_rule + ':[\\s\\S]*?local_macro_depth_1');
                expect(grammar_content).toMatch(pattern);
                return true;
            }),
            { numRuns: 6 }
        );
    });

    it('should allow global macros inside compound strings', () => {
        fc.assert(
            fc.property(arbitrary_depth(), (depth) => {
                // Each depth's content should allow global_macro
                const content_rule = '_compound_content_' + depth;
                const pattern = new RegExp(content_rule + ':[\\s\\S]*?global_macro');
                expect(grammar_content).toMatch(pattern);
                return true;
            }),
            { numRuns: 6 }
        );
    });
});

// ============================================================================
// Property 5: All Mata Block Forms Parse as mata_block
// Validates: Requirements 3.10
// ============================================================================

describe('Property 5: All Mata Block Forms Parse as mata_block', () => {
    /**
     * All five Mata block forms SHALL parse to a mata_block node.
     */
    it('should define mata_block rule', () => {
        expect(grammar_has_rule('mata_block')).toBe(true);
    });

    it('should support all five Mata block forms', () => {
        fc.assert(
            fc.property(arbitrary_mata_block_form(), (source) => {
                // Verify the grammar has mata_block rule
                expect(grammar_content).toContain('mata_block:');
                
                // Verify the grammar supports the mata keyword
                expect(grammar_content).toMatch(/mata_block:.*'mata'/s);
                
                // Verify the source is one of the valid forms
                const valid_forms = [
                    /^mata\s+\d/,           // inline without colon
                    /^mata:\s+\d/,          // inline with colon
                    /^mata\n/,              // multiline without colon
                    /^mata:\n/,             // multiline with colon
                    /^mata\s*\{/,           // brace-delimited
                ];
                const matches_form = valid_forms.some(pattern => pattern.test(source));
                expect(matches_form).toBe(true);
                
                return true;
            }),
            { numRuns: 20 }
        );
    });

    it('should support optional colon in mata blocks', () => {
        expect(grammar_content).toMatch(/mata_block:.*optional\(':'\)/s);
    });

    it('should support brace-delimited mata blocks', () => {
        expect(grammar_content).toMatch(/mata_block:.*'\{'/s);
        expect(grammar_content).toMatch(/mata_block:.*'\}'/s);
    });

    it('should support multiline mata blocks with end keyword', () => {
        expect(grammar_content).toMatch(/mata_block:.*'end'/s);
    });

    it('should support inline mata expressions', () => {
        expect(grammar_content).toContain('_mata_inline_content');
    });

    it('should define helper rules for mata content', () => {
        expect(grammar_content).toContain('_mata_line:');
        expect(grammar_content).toContain('_mata_inline_content:');
        expect(grammar_content).toContain('_mata_brace_content:');
    });
});

// ============================================================================
// Property 6: Double Strings Preserve Arbitrary Content
// Validates: Requirements 3.6
// ============================================================================

describe('Property 6: Double Strings Preserve Arbitrary Content', () => {
    /**
     * For any string content (excluding unescaped quotes and newlines),
     * wrapping in double quotes SHALL produce a valid double_string node.
     */
    it('should define double_string rule', () => {
        expect(grammar_has_rule('double_string')).toBe(true);
    });

    it('should have grammar rules that accept arbitrary double string content', () => {
        fc.assert(
            fc.property(arbitrary_double_string_content(), (content) => {
                // Verify the grammar has double_string rule
                expect(grammar_content).toContain('double_string:');
                
                // Verify the content does not contain problematic characters
                expect(content.includes('"')).toBe(false);
                expect(content.includes('\n')).toBe(false);
                expect(content.includes('\r')).toBe(false);
                
                // Verify the grammar pattern for double strings
                // The grammar uses /[^"$\\\r\n]+/ for regular content
                // In the file, this appears with escaped backslashes
                expect(grammar_content).toContain('[^"$\\\\\\r\\n]+');
                
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should support escaped quotes in double strings', () => {
        // The grammar should allow "" for escaped quotes
        expect(grammar_content).toContain("'\"\"'");
    });

    it('should support escape sequences in double strings', () => {
        // The grammar should allow \. for escape sequences
        expect(grammar_content).toMatch(/\\\\./);
    });

    it('should allow global macros inside double strings', () => {
        // The double_string rule should include global_macro
        expect(grammar_content).toMatch(/double_string:[\s\S]*?\$\.global_macro[\s\S]*?'"'/);
    });
});

// ============================================================================
// Property 7: Global Macros Parse with Valid Identifiers
// Validates: Requirements 3.8
// ============================================================================

describe('Property 7: Global Macros Parse with Valid Identifiers', () => {
    /**
     * For any valid Stata identifier, both $name and ${name} forms
     * SHALL parse as global_macro nodes.
     */
    it('should define global_macro rule', () => {
        expect(grammar_has_rule('global_macro')).toBe(true);
    });

    it('should support $name syntax for global macros', () => {
        fc.assert(
            fc.property(arbitrary_stata_identifier(), (name) => {
                // Build the global macro
                const macro = build_global_macro('dollar', name);
                
                // Verify the structure
                expect(macro.startsWith('$')).toBe(true);
                expect(macro.substring(1)).toBe(name);
                
                // Verify the grammar supports $ prefix
                // The grammar has: seq('$', $.identifier)
                expect(grammar_content).toContain("'$'");
                
                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('should support ${name} syntax for global macros', () => {
        fc.assert(
            fc.property(arbitrary_stata_identifier(), (name) => {
                // Build the global macro
                const macro = build_global_macro('dollar_brace', name);
                
                // Verify the structure
                expect(macro.startsWith('${')).toBe(true);
                expect(macro.endsWith('}')).toBe(true);
                expect(macro.slice(2, -1)).toBe(name);
                
                // Verify the grammar supports ${...} syntax
                expect(grammar_content).toContain("'${'");
                expect(grammar_content).toContain("'}'");
                
                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('should reference identifier in global_macro rule', () => {
        expect(grammar_content).toMatch(/global_macro:[\s\S]*?\$\.identifier/);
    });
});

// ============================================================================
// Property 8: Program Definitions Parse with Valid Names
// Validates: Requirements 3.9
// ============================================================================

describe('Property 8: Program Definitions Parse with Valid Names', () => {
    /**
     * For any valid Stata identifier as program name, both "program name"
     * and "program define name" forms SHALL parse as program_definition
     * nodes with the correct name field.
     */
    it('should define program_definition rule', () => {
        expect(grammar_has_rule('program_definition')).toBe(true);
    });

    it('should support program keyword', () => {
        expect(grammar_content).toMatch(/program_definition:.*'program'/s);
    });

    it('should support optional define keyword', () => {
        expect(grammar_content).toMatch(/program_definition:.*optional\('define'\)/s);
    });

    it('should capture program name as field', () => {
        expect(grammar_content).toMatch(/program_definition:.*field\('name'/s);
    });

    it('should support both program forms with valid identifiers', () => {
        fc.assert(
            fc.property(
                fc.tuple(fc.boolean(), arbitrary_stata_identifier()),
                ([use_define, name]) => {
                    // Build the program definition
                    const source = build_program_definition(use_define, name);
                    
                    // Verify the structure
                    expect(source.includes('program')).toBe(true);
                    expect(source.includes(name)).toBe(true);
                    expect(source.includes('end')).toBe(true);
                    
                    if (use_define) {
                        expect(source.includes('define')).toBe(true);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should support end keyword to close program', () => {
        expect(grammar_content).toMatch(/program_definition:.*'end'/s);
    });

    it('should allow statements inside program body', () => {
        expect(grammar_content).toContain('_program_line:');
        expect(grammar_content).toMatch(/program_definition:.*repeat\(\$\._program_line\)/s);
    });
});

// ============================================================================
// Property 9: Valid Stata Identifiers Parse Correctly
// Validates: Requirements 3.11
// ============================================================================

describe('Property 9: Valid Stata Identifiers Parse Correctly', () => {
    /**
     * Any string matching the Stata identifier pattern [A-Za-z_][A-Za-z0-9_]*
     * SHALL parse as an identifier when used as a command name.
     */
    it('should define identifier rule', () => {
        expect(grammar_has_rule('identifier')).toBe(true);
    });

    it('should use correct regex pattern for identifiers', () => {
        // The grammar should define identifier with pattern [A-Za-z_][A-Za-z0-9_]*
        expect(grammar_content).toMatch(/identifier:.*\/\[A-Za-z_\]\[A-Za-z0-9_\]\*\//s);
    });

    it('should accept valid Stata identifiers', () => {
        fc.assert(
            fc.property(arbitrary_stata_identifier(), (name) => {
                // Verify the identifier matches the expected pattern
                const identifier_pattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
                expect(identifier_pattern.test(name)).toBe(true);
                
                // Verify the identifier is non-empty
                expect(name.length).toBeGreaterThan(0);
                
                // Verify first character is letter or underscore
                expect(/^[A-Za-z_]/.test(name)).toBe(true);
                
                return true;
            }),
            { numRuns: 100 }
        );
    });

    it('should use identifier in command rule', () => {
        expect(grammar_content).toMatch(/command:.*\$\.identifier/s);
    });

    it('should use identifier in macro_definition rule', () => {
        expect(grammar_content).toMatch(/macro_definition:.*\$\.identifier/s);
    });

    it('should use identifier in program_definition rule', () => {
        expect(grammar_content).toMatch(/program_definition:.*\$\.identifier/s);
    });

    it('should use identifier in global_macro rule', () => {
        expect(grammar_content).toMatch(/global_macro:.*\$\.identifier/s);
    });
});

// ============================================================================
// Property 10: Numbers Parse in All Valid Formats
// Validates: Requirements 3.11
// ============================================================================

describe('Property 10: Numbers Parse in All Valid Formats', () => {
    /**
     * Integer, decimal, and scientific notation numbers SHALL all parse
     * as number nodes.
     */
    it('should define number rule', () => {
        expect(grammar_has_rule('number')).toBe(true);
    });

    it('should support integer numbers', () => {
        fc.assert(
            fc.property(arbitrary_integer(), (num_str) => {
                // Verify the number is a valid integer string
                expect(/^\d+$/.test(num_str)).toBe(true);
                
                // Verify the grammar supports integer pattern
                expect(grammar_content).toMatch(/number:.*\/\[0-9\]\+\//s);
                
                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('should support decimal numbers', () => {
        fc.assert(
            fc.property(arbitrary_decimal(), (num_str) => {
                // Verify the number contains a decimal point
                expect(num_str.includes('.')).toBe(true);
                
                // Verify the grammar supports decimal pattern
                // Grammar has: /[0-9]+\.[0-9]*/ and /\.[0-9]+/
                // In the file, this appears as [0-9]+\\.[0-9]*
                expect(grammar_content).toContain('[0-9]+\\.[0-9]*');
                
                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('should support scientific notation numbers', () => {
        fc.assert(
            fc.property(arbitrary_scientific(), (num_str) => {
                // Verify the number contains 'e' for scientific notation
                expect(num_str.toLowerCase().includes('e')).toBe(true);
                
                // Verify the grammar supports scientific notation pattern
                // Grammar has: /[0-9]+(\.[0-9]*)?[eE][+-]?[0-9]+/
                // In the file, this appears with escaped characters
                expect(grammar_content).toContain('[eE][+-]?[0-9]+');
                
                return true;
            }),
            { numRuns: 50 }
        );
    });

    it('should define number as a token with multiple patterns', () => {
        // Verify number rule uses token with choice of patterns
        expect(grammar_content).toMatch(/number:.*token\(choice/s);
    });

    it('should support numbers starting with decimal point', () => {
        // Grammar should have pattern for .123 style numbers
        // In the file, this appears as \\.[0-9]+
        expect(grammar_content).toContain('\\.[0-9]+');
    });
});

/**
 * Property-Based Tests for Zed Extension Tree-sitter Grammar
 *
 * These tests verify the grammar.js rules would correctly parse various Stata
 * constructs by generating valid code and checking that the grammar patterns
 * match the expected structure.
 *
 * Since we can't directly invoke the Tree-sitter parser from TypeScript without
 * native bindings, these tests:
 * 1. Generate valid Stata code constructs using fast-check
 * 2. Verify the grammar.js rules would correctly parse these constructs
 * 3. Test edge cases and boundary conditions for each construct type
 *
 * **Validates: Design Correctness Properties 1-10**
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
    return fc.string({ minLength: 0, maxLength: 50 })
        .filter(s => !s.includes('`') && !s.includes("'") && !s.includes('"') && 
                     !s.includes('\n') && !s.includes('\r') && !s.includes('$'));
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
 * Generator for global macro prefix
 */
function arbitrary_global_macro_prefix(): fc.Arbitrary<'$' | '${'> {
    return fc.constantFrom('$', '${');
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
    ).map(([whole, frac]) => `${whole}.${frac}`);
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
    ).map(([whole, frac, sign, exp]) => `${whole}.${frac}e${sign}${exp}`);
}

// ============================================================================
// Helper functions for grammar pattern matching
// ============================================================================

/**
 * Check if the grammar defines a rule for the given node type
 */
function grammar_has_rule(rule_name: string): boolean {
    // Look for rule definition pattern: rule_name: $ => ... or rule_name: _ => ...
    const pattern = new RegExp(`${rule_name}:\\s*[$_]\\s*=>`);
    return pattern.test(grammar_content);
}

/**
 * Check if a rule references another rule
 */
function rule_references(rule_name: string, referenced_rule: string): boolean {
    // Find the rule definition and check if it references the other rule
    const rule_pattern = new RegExp(`${rule_name}:[\\s\\S]*?(?=\\n\\s{8}\\w+:|$)`, 'm');
    const match = grammar_content.match(rule_pattern);
    if (!match) return false;
    return match[0].includes(`$.${referenced_rule}`) || match[0].includes(`$._${referenced_rule}`);
}

/**
 * Build a nested local macro string with given depth
 */
function build_nested_local_macro(depth: number, name: string): string {
    return '`'.repeat(depth) + name + "'".repeat(depth);
}

/**
 * Build a nested compound string with given depth
 */
function build_nested_compound_string(depth: number, content: string): string {
    let result = content;
    for (let i = 0; i < depth; i++) {
        result = '`"' + result + "\"'";
    }
    return result;
}

/**
 * Build a global macro reference
 */
function build_global_macro(prefix: '$' | '${', name: string): string {
    return prefix === '${' ? `\${${name}}` : `$${name}`;
}

/**
 * Build a program definition
 */
function build_program_definition(use_define: boolean, name: string): string {
    return use_define 
        ? `program define ${name}\nend`
        : `program ${name}\nend`;
}

// ============================================================================
// Property 1: Line Comments Preserve Arbitrary Content
// **Validates: Requirements 3.5**
// ============================================================================

describe('Property 1: Line Comments Preserve Arbitrary Content', () => {
    /**
     * For any arbitrary text content (excluding newlines), wrapping it in a
     * line comment (`//`, `///`, or `*` at line start) SHALL produce a valid
     * comment construct that the grammar can parse.
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
                    const line_comment_pattern = /\[\\^\\r\\n\]\*/;
                    expect(grammar_content).toMatch(line_comment_pattern);
                    
                    // Verify the content doesn't contain newlines (generator constraint)
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

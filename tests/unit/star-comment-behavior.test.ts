/**
 * Tests for star comment (*) recognition in Stata.
 * 
 * Based on actual Stata behavior:
 * - `display * comment` - the * is NOT a comment, it's parsed as an expression
 * - `display * (*` - Stata gives "too few ')' or ']'" error (not a comment)
 * - Inside braces after newline: `{ * stuff` - the * IS a comment
 * - At start of line: `* comment` - the * IS a comment
 */

import { describe, it, expect } from 'bun:test';
import { StataLexer, StataParser } from '../../src/index';

describe('Star Comment Recognition - Lexer', () => {
    const my_lexer = new StataLexer();

    describe('Star at start of line (should be comment)', () => {
        it('should recognize * at start of line as comment', () => {
            const my_source = '* this is a comment';
            const my_result = my_lexer.tokenize(my_source);
            
            const my_comment_tokens = my_result.tokens.filter(t => t.type === 'COMMENT_LINE');
            expect(my_comment_tokens.length).toBe(1);
            expect(my_comment_tokens[0].value).toBe('* this is a comment');
        });

        it('should recognize * after whitespace at start of line as comment', () => {
            const my_source = '    * indented comment';
            const my_result = my_lexer.tokenize(my_source);
            
            const my_comment_tokens = my_result.tokens.filter(t => t.type === 'COMMENT_LINE');
            expect(my_comment_tokens.length).toBe(1);
            expect(my_comment_tokens[0].value).toBe('* indented comment');
        });
    });

    describe('Star after command (should NOT be comment)', () => {
        it('should NOT recognize * after display as comment', () => {
            const my_source = 'display 1234 * merp';
            const my_result = my_lexer.tokenize(my_source);
            
            const my_comment_tokens = my_result.tokens.filter(t => t.type === 'COMMENT_LINE');
            expect(my_comment_tokens.length).toBe(0);
            
            const my_operator_tokens = my_result.tokens.filter(t => t.type === 'OPERATOR' && t.value === '*');
            expect(my_operator_tokens.length).toBe(1);
        });

        it('should NOT recognize * after display with no arguments as comment', () => {
            const my_source = 'display * (*';
            const my_result = my_lexer.tokenize(my_source);
            
            const my_tokens = my_result.tokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'EOF');
            expect(my_tokens[0].type).toBe('WORD');
            expect(my_tokens[0].value).toBe('display');
            expect(my_tokens[1].type).toBe('OPERATOR');
            expect(my_tokens[1].value).toBe('*');
        });

        it('should NOT recognize * after any command as comment', () => {
            const my_source = 'regress * y';
            const my_result = my_lexer.tokenize(my_source);
            
            const my_comment_tokens = my_result.tokens.filter(t => t.type === 'COMMENT_LINE');
            expect(my_comment_tokens.length).toBe(0);
        });
    });

    describe('Star inside braces after newline (should be comment)', () => {
        it('should recognize * after opening brace on new line as comment', () => {
            const my_source = 'if (0 < 1) {\n* stuff\ndisplay 1234\n}';
            const my_result = my_lexer.tokenize(my_source);
            
            const my_comment_tokens = my_result.tokens.filter(t => t.type === 'COMMENT_LINE');
            expect(my_comment_tokens.length).toBe(1);
            expect(my_comment_tokens[0].value).toBe('* stuff');
        });

        it('should recognize * at start of line inside block as comment', () => {
            const my_source = 'foreach x of varlist a b c {\n    * loop comment\n    display 1\n}';
            const my_result = my_lexer.tokenize(my_source);
            
            const my_comment_tokens = my_result.tokens.filter(t => t.type === 'COMMENT_LINE');
            expect(my_comment_tokens.length).toBe(1);
            expect(my_comment_tokens[0].value).toBe('* loop comment');
        });
    });
});


describe('Star Comment Recognition - Parser/AST', () => {
    const my_lexer = new StataLexer();
    const my_parser = new StataParser();

    function parse(source: string) {
        const my_lex_result = my_lexer.tokenize(source);
        return my_parser.parse(my_lex_result.tokens);
    }

    describe('Star at start of line', () => {
        it('should parse * at start of line as standalone comment (no command node)', () => {
            const my_result = parse('* this is a comment');
            
            // A comment-only line should not create a command node
            expect(my_result.ast.nodes.length).toBe(0);
        });

        it('should attach leading * comment to following command', () => {
            const my_result = parse('* comment\ndisplay 1234');
            
            expect(my_result.ast.nodes.length).toBe(1);
            const my_node = my_result.ast.nodes[0];
            expect(my_node.type).toBe('command');
            
            // The comment should be attached as leading trivia
            if ('leadingTrivia' in my_node && my_node.leadingTrivia) {
                expect(my_node.leadingTrivia.length).toBe(1);
                expect(my_node.leadingTrivia[0].content).toBe('* comment');
            }
        });
    });

    describe('Star after command (NOT a comment)', () => {
        it('should parse display * 2 as command with expression, not comment', () => {
            const my_result = parse('display * 2');
            
            expect(my_result.ast.nodes.length).toBe(1);
            const my_node = my_result.ast.nodes[0];
            expect(my_node.type).toBe('command');
            
            // Should NOT have trailing trivia (the * is part of expression)
            if ('trailingTrivia' in my_node) {
                expect(my_node.trailingTrivia?.length ?? 0).toBe(0);
            }
        });

        it('should parse display * (* without treating first * as comment', () => {
            const my_result = parse('display * (*');
            
            expect(my_result.ast.nodes.length).toBeGreaterThanOrEqual(1);
            
            const my_node = my_result.ast.nodes[0];
            if ('trailingTrivia' in my_node && my_node.trailingTrivia) {
                // If there's trailing trivia, it should not be the first *
                const my_star_trivia = my_node.trailingTrivia.filter(
                    t => t.content === '*' || t.content === '* (*'
                );
                expect(my_star_trivia.length).toBe(0);
            }
        });
    });

    describe('Star inside braces', () => {
        it('should parse * inside if block as comment', () => {
            const my_result = parse('if (0 < 1) {\n* stuff\ndisplay 1234\n}');
            
            expect(my_result.ast.nodes.length).toBe(1);
            const my_if_node = my_result.ast.nodes[0];
            expect(my_if_node.type).toBe('if');
            
            if ('body' in my_if_node) {
                expect(my_if_node.body.length).toBe(1);
                const my_display_node = my_if_node.body[0];
                expect(my_display_node.type).toBe('command');
                
                if ('leadingTrivia' in my_display_node && my_display_node.leadingTrivia) {
                    expect(my_display_node.leadingTrivia.length).toBe(1);
                    expect(my_display_node.leadingTrivia[0].content).toBe('* stuff');
                }
            }
        });
    });
});

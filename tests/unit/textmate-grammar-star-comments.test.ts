/**
 * Tests for TextMate grammar star comment patterns.
 * 
 * These tests validate that the TextMate grammar patterns correctly identify
 * star comments based on actual Stata behavior:
 * - `* comment` at start of line (after optional whitespace) IS a comment
 * - `display * expr` is NOT a comment (the * is an operator)
 * - `{ * comment` on a new line inside braces IS a comment
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('TextMate Grammar - Star Comment Patterns', () => {
    // Load the grammar
    const grammar_path = path.join(__dirname, '../../client/syntaxes/stata.tmLanguage.json');
    const grammar = JSON.parse(fs.readFileSync(grammar_path, 'utf-8'));
    
    // Extract the star comment pattern
    const comment_patterns = grammar.repository.comments.patterns;
    const star_comment_pattern = comment_patterns.find(
        (p: { match?: string; name?: string }) => p.name === 'comment.line.star.stata'
    );
    
    describe('Star comment pattern structure', () => {
        it('should have a star comment pattern defined', () => {
            expect(star_comment_pattern).toBeDefined();
        });
        
        it('should use a regex that requires * at start of line', () => {
            expect(star_comment_pattern.match).toBeDefined();
            // The pattern should start with ^ (start of line)
            expect(star_comment_pattern.match.startsWith('^')).toBe(true);
        });
    });
    
    describe('Star comment pattern matching', () => {
        const pattern = new RegExp(star_comment_pattern.match, 'm');
        
        it('should match * at start of line', () => {
            const my_source = '* this is a comment';
            expect(pattern.test(my_source)).toBe(true);
        });
        
        it('should match * after whitespace at start of line', () => {
            const my_source = '    * indented comment';
            expect(pattern.test(my_source)).toBe(true);
        });
        
        it('should NOT match * after command on same line', () => {
            const my_source = 'display * expr';
            // The pattern should not match because * is not at start of line
            const my_match = my_source.match(pattern);
            expect(my_match).toBeNull();
        });
        
        it('should match * on new line inside braces', () => {
            const my_source = 'if (1) {\n* comment inside block\ndisplay 1\n}';
            // The pattern should match the comment line
            const my_match = my_source.match(pattern);
            expect(my_match).not.toBeNull();
            expect(my_match![0]).toBe('* comment inside block');
        });
        
        it('should NOT match * in middle of expression', () => {
            const my_source = 'gen x = y * z';
            // The pattern should not match because * is not at start of line
            const my_lines = my_source.split('\n');
            for (const my_line of my_lines) {
                const my_match = my_line.match(pattern);
                // No line starts with * so none should match the pattern
                expect(my_match).toBeNull();
            }
        });
    });
    
    describe('Grammar pattern order', () => {
        it('should have comments before commands in top-level patterns', () => {
            const top_patterns = grammar.patterns;
            const comment_index = top_patterns.findIndex(
                (p: { include?: string }) => p.include === '#comments'
            );
            // Find the first command-consuming pattern. Command rules may be
            // included directly (#commands-*), via the #statement-content group
            // that houses them after the #187 file-path refactor, or via the
            // file-path/io rules (#path-after-*) that consume command keywords
            // and their arguments. Comments must precede ALL of these so a
            // `* ...` / `// ...` line is never mis-tokenized.
            const command_index = top_patterns.findIndex(
                (p: { include?: string }) =>
                    p.include?.startsWith('#commands') ||
                    p.include?.startsWith('#path-after') ||
                    p.include === '#statement-content'
            );

            // Comments should be matched before commands
            expect(command_index).toBeGreaterThanOrEqual(0);
            expect(comment_index).toBeLessThan(command_index);
        });
    });
});

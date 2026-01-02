/**
 * Property-Based Tests for Code Generation Style Consistency
 *
 * Feature: comment-style-normalization, Property 10: Code generation style consistency
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * Tests that all auto-generated comments (templates, documentation, TODO) use
 * the configured preferred comment style.
 */

import * as fc from 'fast-check';
import {
  generate_comment,
  generate_comment_block,
  generate_todo_comment,
  generate_documentation_comment,
  generate_program_template,
  generate_section_header,
} from '../../src/comment-processor/code-generator';

describe('Code Generation Style Consistency', () => {
  describe('Property 10: Code generation style consistency', () => {
    it('should generate comments with preferred style', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\n')),
          fc.integer({ min: 0, max: 10 }),
          (my_style, my_text, my_indent) => {
            const my_comment = generate_comment(my_text, my_style, my_indent);

            // Verify the comment uses the preferred style delimiter
            if (my_style === '//') {
              // Check that the comment starts with the style delimiter (after indent)
              const my_trimmed = my_comment.trimStart();
              expect(my_trimmed).toMatch(/^\/\//);
            } else if (my_style === '*') {
              // Check that the comment starts with the style delimiter (after indent)
              const my_trimmed = my_comment.trimStart();
              expect(my_trimmed).toMatch(/^\*/);
            } else if (my_style === '/* */') {
              // Check that the comment uses block delimiters
              expect(my_comment).toContain('/*');
              expect(my_comment).toContain('*/');
            }

            // Verify indentation is applied
            if (my_indent > 0) {
              expect(my_comment).toMatch(/^\s+/);
            }

            // Verify content is preserved
            expect(my_comment).toContain(my_text);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate multi-line comment blocks with preferred style', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          fc.array(fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n')), {
            minLength: 1,
            maxLength: 5,
          }),
          fc.integer({ min: 0, max: 10 }),
          (my_style, my_lines, my_indent) => {
            const my_block = generate_comment_block(my_lines, my_style, my_indent);

            // Verify the block uses the preferred style delimiter
            if (my_style === '//') {
              expect(my_block).toMatch(/\/\//);
            } else if (my_style === '*') {
              const my_trimmed = my_block.trimStart();
              expect(my_trimmed).toMatch(/^\*/);
            } else if (my_style === '/* */') {
              expect(my_block).toContain('/*');
              expect(my_block).toContain('*/');
            }

            // Verify all lines are included
            for (const my_line of my_lines) {
              expect(my_block).toContain(my_line);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate TODO comments with preferred style', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\n')),
          (my_style, my_task) => {
            const my_todo = generate_todo_comment(my_task, my_style);

            // Verify the TODO uses the preferred style delimiter
            if (my_style === '//') {
              expect(my_todo).toMatch(/\/\//);
            } else if (my_style === '*') {
              const my_trimmed = my_todo.trimStart();
              expect(my_trimmed).toMatch(/^\*/);
            } else if (my_style === '/* */') {
              expect(my_todo).toContain('/*');
              expect(my_todo).toContain('*/');
            }

            // Verify TODO marker is present
            expect(my_todo).toContain('TODO');

            // Verify task is included
            expect(my_todo).toContain(my_task);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate documentation comments with preferred style', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          fc.array(fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n')), {
            minLength: 1,
            maxLength: 5,
          }),
          (my_style, my_doc_lines) => {
            const my_doc = generate_documentation_comment(my_doc_lines, my_style);

            // Verify the documentation uses the preferred style delimiter
            if (my_style === '//') {
              expect(my_doc).toMatch(/\/\//);
            } else if (my_style === '*') {
              const my_trimmed = my_doc.trimStart();
              expect(my_trimmed).toMatch(/^\*/);
            } else if (my_style === '/* */') {
              expect(my_doc).toContain('/*');
              expect(my_doc).toContain('*/');
            }

            // Verify all documentation lines are included
            for (const my_line of my_doc_lines) {
              expect(my_doc).toContain(my_line);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate program templates with preferred style', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n')),
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\n')),
          (my_style, my_program_name, my_description) => {
            const my_template = generate_program_template(
              my_program_name,
              my_description,
              my_style
            );

            // Verify the template uses the preferred style delimiter
            if (my_style === '//') {
              expect(my_template).toMatch(/\/\//);
            } else if (my_style === '*') {
              expect(my_template).toMatch(/\*/);
            } else if (my_style === '/* */') {
              expect(my_template).toContain('/*');
              expect(my_template).toContain('*/');
            }

            // Verify program structure
            expect(my_template).toContain('program define');
            expect(my_template).toContain(my_program_name);
            expect(my_template).toContain('end');

            // Verify description is included
            expect(my_template).toContain(my_description);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate section headers with preferred style', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n')),
          (my_style, my_section_name) => {
            const my_header = generate_section_header(my_section_name, my_style);

            // Verify the header uses the preferred style delimiter
            if (my_style === '//') {
              expect(my_header).toMatch(/\/\//);
            } else if (my_style === '*') {
              expect(my_header).toMatch(/\*/);
            } else if (my_style === '/* */') {
              expect(my_header).toContain('/*');
              expect(my_header).toContain('*/');
            }

            // Verify section name is included
            expect(my_header).toContain(my_section_name);

            // Verify separator is present
            expect(my_header).toContain('=');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve content across all comment styles', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\n')),
          (my_text) => {
            const my_styles: Array<'//' | '*' | '/* */'> = ['//', '*', '/* */'];

            for (const my_style of my_styles) {
              const my_comment = generate_comment(my_text, my_style);

              // Verify content is preserved
              expect(my_comment).toContain(my_text);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty strings gracefully', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          (my_style) => {
            const my_comment = generate_comment('', my_style);

            // Should still generate a valid comment
            expect(my_comment).toBeDefined();
            expect(my_comment.length).toBeGreaterThan(0);

            // Should use the preferred style delimiter
            if (my_style === '//') {
              expect(my_comment).toMatch(/\/\//);
            } else if (my_style === '*') {
              const my_trimmed = my_comment.trimStart();
              expect(my_trimmed).toMatch(/^\*/);
            } else if (my_style === '/* */') {
              expect(my_comment).toContain('/*');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should apply indentation consistently across styles', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('//'),
            fc.constant('*'),
            fc.constant('/* */')
          ),
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.integer({ min: 1, max: 10 }),
          (my_style, my_text, my_indent_level) => {
            const my_comment = generate_comment(my_text, my_style, my_indent_level);
            const my_expected_spaces = ' '.repeat(my_indent_level);

            // Verify indentation is applied
            expect(my_comment).toMatch(new RegExp(`^${my_expected_spaces}`));
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

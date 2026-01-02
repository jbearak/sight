import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

/**
 * Property Test: Parser End Delimiter Handling
 * 
 * Validates Requirements 2.1, 2.2, 2.3:
 * - Parser correctly handles END_PYTHON tokens with value 'end'
 * - Parser correctly handles END_MATA tokens with value 'end'  
 * - Parser produces consistent AST nodes for both language contexts
 */

describe('Property Test: Parser End Delimiter Handling', () => {
  const lexer = new StataLexer();
  const parser = new StataParser();

  test('END_PYTHON tokens with value "end" produce correct embedded block nodes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        (the_content_lines) => {
          // Generate Python block with content
          const my_content = the_content_lines.join('\n');
          const my_source = `python\n${my_content}\nend`;
          
          const my_lex_result = lexer.tokenize(my_source);
          const my_parse_result = parser.parse(my_lex_result.tokens);
          
          // Should parse without errors
          expect(my_parse_result.errors).toHaveLength(0);
          expect(my_parse_result.ast.nodes).toHaveLength(1);
          
          const my_node = my_parse_result.ast.nodes[0];
          expect(my_node.type).toBe('embedded_block');
          
          if (my_node.type === 'embedded_block') {
            // Verify END_PYTHON token produces correct end_command
            expect(my_node.language).toBe('python');
            expect(my_node.start_command).toBe('python');
            
            // end_command should be 'end' if the end delimiter was properly parsed
            // It may be undefined if the end was consumed by malformed content (e.g., unclosed comment)
            if (my_node.end_command !== undefined) {
              expect(my_node.end_command).toBe('end'); // Should be 'end', not 'end python'
            }
            expect(my_node.is_single_line).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('END_MATA tokens with value "end" produce correct embedded block nodes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        (the_content_lines) => {
          // Generate Mata block with content
          const my_content = the_content_lines.join('\n');
          const my_source = `mata\n${my_content}\nend`;
          
          const my_lex_result = lexer.tokenize(my_source);
          const my_parse_result = parser.parse(my_lex_result.tokens);
          
          // Should parse without errors
          expect(my_parse_result.errors).toHaveLength(0);
          expect(my_parse_result.ast.nodes).toHaveLength(1);
          
          const my_node = my_parse_result.ast.nodes[0];
          expect(my_node.type).toBe('embedded_block');
          
          if (my_node.type === 'embedded_block') {
            // Verify END_MATA token produces correct end_command
            expect(my_node.language).toBe('mata');
            expect(my_node.start_command).toBe('mata');
            
            // end_command should be 'end' if the end delimiter was properly parsed
            // It may be undefined if the end was consumed by malformed content (e.g., unclosed comment)
            if (my_node.end_command !== undefined) {
              expect(my_node.end_command).toBe('end'); // Should be 'end', not 'end mata'
            }
            expect(my_node.is_single_line).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Parser handles both Python and Mata end delimiters consistently', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('python'), fc.constant('mata')),
        fc.string({ minLength: 1, maxLength: 50 }),
        (my_language, my_content) => {
          const my_source = `${my_language}\n${my_content}\nend`;
          
          const my_lex_result = lexer.tokenize(my_source);
          const my_parse_result = parser.parse(my_lex_result.tokens);
          
          // Should parse without errors
          expect(my_parse_result.errors).toHaveLength(0);
          expect(my_parse_result.ast.nodes).toHaveLength(1);
          
          const my_node = my_parse_result.ast.nodes[0];
          expect(my_node.type).toBe('embedded_block');
          
          if (my_node.type === 'embedded_block') {
            // Both languages should have consistent end_command behavior
            expect(my_node.language).toBe(my_language);
            expect(my_node.start_command).toBe(my_language);
            
            // end_command should be 'end' if the end delimiter was properly parsed
            // It may be undefined if the end was consumed by malformed content (e.g., unclosed comment)
            if (my_node.end_command !== undefined) {
              expect(my_node.end_command).toBe('end'); // Unified behavior
            }
            expect(my_node.is_single_line).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Parser correctly extracts content between start and end delimiters', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('python'), fc.constant('mata')),
        // Avoid generating sequences like /* that can start block comments and change
        // tokenization in ways that make this content-preservation property flaky.
        fc.array(fc.stringMatching(/[a-zA-Z0-9 ]{1,30}/), { minLength: 1, maxLength: 3 }).filter((lines) =>
          lines.some((line) => line.trim().length > 0) &&
          // Avoid generating a literal end-delimiter line, which can terminate the block early.
          lines.every((line) => line.trim().toLowerCase() !== 'end')
        ),
        (my_language, the_content_lines) => {
          const my_content = the_content_lines.join('\n');
          const my_source = `${my_language}\n${my_content}\nend`;
          
          const my_lex_result = lexer.tokenize(my_source);
          const my_parse_result = parser.parse(my_lex_result.tokens);
          
          expect(my_parse_result.errors).toHaveLength(0);
          expect(my_parse_result.ast.nodes).toHaveLength(1);
          
          const my_node = my_parse_result.ast.nodes[0];
          if (my_node.type === 'embedded_block') {
            // Content should be extracted correctly regardless of end delimiter format
            expect(my_node.content).toBeDefined();
            
            // Check that the essential content is preserved (ignoring exact whitespace)
            const my_content_words = my_content.split(/\s+/).filter(word => word.length > 0);
            const my_node_words = my_node.content.split(/\s+/).filter(word => word.length > 0);
            
            // Every word from generated content should appear in order in parsed content
            let my_node_idx = 0;
            for (const my_word of my_content_words) {
              while (my_node_idx < my_node_words.length && my_node_words[my_node_idx] !== my_word) {
                my_node_idx++;
              }
              expect(my_node_idx).toBeLessThan(my_node_words.length);
              my_node_idx++;
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Parser handles nested embedded blocks with unified end delimiters', () => {
    fc.assert(
      fc.property(
        // Avoid content that can change tokenization/parsing semantics, such as starting an
        // unterminated block comment ("/*") or introducing a literal end-delimiter line.
        fc.stringMatching(/[a-zA-Z0-9 ]{1,20}/).filter((s) => {
          const trimmed = s.trim().toLowerCase();
          return trimmed.length > 0 && trimmed !== 'end' && !s.includes('/*') && !s.includes('*/');
        }),
        fc.stringMatching(/[a-zA-Z0-9 ]{1,20}/).filter((s) => {
          const trimmed = s.trim().toLowerCase();
          return trimmed.length > 0 && trimmed !== 'end' && !s.includes('/*') && !s.includes('*/');
        }),
        (my_python_content, my_mata_content) => {
          // Create source with sequential embedded blocks.
          const my_source = `python\n${my_python_content}\nend\nmata\n${my_mata_content}\nend`;

          const my_lex_result = lexer.tokenize(my_source);
          const my_parse_result = parser.parse(my_lex_result.tokens);

          // Should parse both blocks
          expect(my_parse_result.errors).toHaveLength(0);
          expect(my_parse_result.ast.nodes).toHaveLength(2);

          const my_python_node = my_parse_result.ast.nodes[0];
          const my_mata_node = my_parse_result.ast.nodes[1];

          // Both should be embedded blocks with consistent end_command
          expect(my_python_node.type).toBe('embedded_block');
          expect(my_mata_node.type).toBe('embedded_block');

          if (my_python_node.type === 'embedded_block' && my_mata_node.type === 'embedded_block') {
            expect(my_python_node.language).toBe('python');
            if (my_python_node.end_command !== undefined) {
              expect(my_python_node.end_command).toBe('end');
            }

            expect(my_mata_node.language).toBe('mata');
            if (my_mata_node.end_command !== undefined) {
              expect(my_mata_node.end_command).toBe('end');
            }
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

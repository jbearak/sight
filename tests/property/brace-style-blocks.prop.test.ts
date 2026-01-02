import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { ContextTracker } from '../../src/context-tracker';
import { StataLexer } from '../../src/lexer';
import { LanguageContext, ContextErrorCode } from '../../src/context-tracker/types';

/**
 * Property-based tests for brace-style embedded blocks (mata { ... } and python { ... })
 * Feature: mata-brace-blocks-context-tracker
 */
describe('Brace-Style Blocks Property Tests', () => {
  let context_tracker: ContextTracker;
  let lexer: StataLexer;

  beforeEach(() => {
    context_tracker = new ContextTracker();
    lexer = new StataLexer();
  });

  /**
   * Property 1: Brace-style block closure
   * For any brace-style embedded block (mata or python) where the opening `{` appears
   * on the same line as the keyword and a matching `}` exists, the Context_Tracker
   * SHALL recognize the block as properly closed and NOT emit an "Unclosed block" diagnostic.
   * 
   * **Validates: Requirements 1.1, 1.2, 1.3**
   */
  it('should recognize brace-style blocks as properly closed', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.stringOf(fc.constantFrom('a', 'b', 'c', '1', '2', '3', ' ', '+', '-', '='), { minLength: 1, maxLength: 20 }),
        (block_type, content) => {
          // Create a brace-style block: mata { content } or python { content }
          const my_document = `${block_type} { ${content} }`;

          // Tokenize and initialize from tokens
          const my_lex_result = lexer.tokenize(my_document);
          context_tracker.initialize_from_tokens(my_lex_result.tokens);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one block
          expect(my_ranges.length).toBe(1);

          // Should be the correct context type
          const my_expected_context = block_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
          expect(my_ranges[0].context).toBe(my_expected_context);

          // Should be closed by '}'
          expect(my_ranges[0].end_delimiter?.command).toBe('}');

          // Should NOT emit unclosed block diagnostic
          const my_diagnostics = context_tracker.validate_context_structure();
          const my_unclosed_errors = my_diagnostics.filter(
            (d) => d.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                   d.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK
          );
          expect(my_unclosed_errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Traditional block closure
   * For any traditional embedded block (mata or python) that is closed with an `end` command,
   * the Context_Tracker SHALL continue to recognize the block as properly closed.
   * 
   * **Validates: Requirements 1.4**
   */
  it('should recognize traditional blocks as properly closed', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.array(fc.stringOf(fc.constantFrom('a', 'b', 'c', '1', '2', '3', ' '), { minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 3 }),
        (block_type, content_lines) => {
          // Create a traditional block: mata\ncontent\nend
          let my_document = `${block_type}\n`;
          for (const my_line of content_lines) {
            my_document += `${my_line}\n`;
          }
          my_document += 'end';

          // Tokenize and initialize from tokens
          const my_lex_result = lexer.tokenize(my_document);
          context_tracker.initialize_from_tokens(my_lex_result.tokens);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one block
          expect(my_ranges.length).toBe(1);

          // Should be the correct context type
          const my_expected_context = block_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
          expect(my_ranges[0].context).toBe(my_expected_context);

          // Should be closed by 'end'
          expect(my_ranges[0].end_delimiter?.command).toBe('end');

          // Should NOT emit unclosed block diagnostic
          const my_diagnostics = context_tracker.validate_context_structure();
          const my_unclosed_errors = my_diagnostics.filter(
            (d) => d.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                   d.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK
          );
          expect(my_unclosed_errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });


  /**
   * Property 3: Nested brace handling
   * For any brace-style embedded block containing nested braces, the Context_Tracker
   * SHALL correctly identify the outermost closing brace (when brace depth returns to 0)
   * as the block terminator.
   * 
   * **Validates: Requirements 2.1**
   */
  it('should correctly handle nested braces in brace-style blocks', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.integer({ min: 1, max: 3 }),
        (block_type, nesting_depth) => {
          // Create a brace-style block with nested braces
          // e.g., mata { { { content } } }
          let my_opening_braces = '';
          let my_closing_braces = '';
          for (let my_i = 0; my_i < nesting_depth; my_i++) {
            my_opening_braces += '{ ';
            my_closing_braces = ' }' + my_closing_braces;
          }
          const my_document = `${block_type} { ${my_opening_braces}content${my_closing_braces} }`;

          // Tokenize and initialize from tokens
          const my_lex_result = lexer.tokenize(my_document);
          context_tracker.initialize_from_tokens(my_lex_result.tokens);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one block
          expect(my_ranges.length).toBe(1);

          // Should be the correct context type
          const my_expected_context = block_type === 'mata' ? LanguageContext.MATA : LanguageContext.PYTHON;
          expect(my_ranges[0].context).toBe(my_expected_context);

          // Should be closed by the outermost '}'
          expect(my_ranges[0].end_delimiter?.command).toBe('}');

          // Should NOT emit unclosed block diagnostic
          const my_diagnostics = context_tracker.validate_context_structure();
          const my_unclosed_errors = my_diagnostics.filter(
            (d) => d.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                   d.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK
          );
          expect(my_unclosed_errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Brace-style vs traditional detection
   * For any embedded block, IF the keyword is followed by `{` on the same line
   * THEN it SHALL be treated as brace-style (closed by `}`),
   * ELSE it SHALL be treated as traditional (closed by `end`).
   * 
   * **Validates: Requirements 3.1, 3.2**
   */
  it('should distinguish brace-style from traditional blocks', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.boolean(),
        (block_type, is_brace_style) => {
          let my_document: string;
          let my_expected_end_delimiter: string;

          if (is_brace_style) {
            // Brace-style: keyword { content }
            my_document = `${block_type} { content }`;
            my_expected_end_delimiter = '}';
          } else {
            // Traditional: keyword\ncontent\nend
            my_document = `${block_type}\ncontent\nend`;
            my_expected_end_delimiter = 'end';
          }

          // Tokenize and initialize from tokens
          const my_lex_result = lexer.tokenize(my_document);
          context_tracker.initialize_from_tokens(my_lex_result.tokens);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one block
          expect(my_ranges.length).toBe(1);

          // Should be closed by the expected delimiter
          expect(my_ranges[0].end_delimiter?.command).toBe(my_expected_end_delimiter);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Unclosed traditional block detection
   * For any traditional embedded block that is missing its `end` command,
   * the Context_Tracker SHALL emit an "Unclosed mata/python block" diagnostic.
   * 
   * **Validates: Requirements 3.3**
   */
  it('should detect unclosed traditional blocks', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.array(fc.stringOf(fc.constantFrom('a', 'b', 'c', '1', '2', '3', ' '), { minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 3 }),
        (block_type, content_lines) => {
          // Create a traditional block WITHOUT end: mata\ncontent (no end)
          let my_document = `${block_type}\n`;
          for (const my_line of content_lines) {
            my_document += `${my_line}\n`;
          }
          // Intentionally omit 'end'

          // Tokenize and initialize from tokens
          const my_lex_result = lexer.tokenize(my_document);
          context_tracker.initialize_from_tokens(my_lex_result.tokens);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one block
          expect(my_ranges.length).toBe(1);

          // Should NOT have an end delimiter
          expect(my_ranges[0].end_delimiter).toBeUndefined();

          // Should emit unclosed block diagnostic
          const my_diagnostics = context_tracker.validate_context_structure();
          const my_expected_error_code = block_type === 'mata' 
            ? ContextErrorCode.UNCLOSED_MATA_BLOCK 
            : ContextErrorCode.UNCLOSED_PYTHON_BLOCK;
          const my_unclosed_errors = my_diagnostics.filter(
            (d) => d.code === my_expected_error_code
          );
          expect(my_unclosed_errors.length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Brace-style blocks inside programs
   * For any program definition containing a brace-style mata block,
   * the Context_Tracker SHALL correctly identify the mata block as closed by `}`
   * and the program as closed by `end`, emitting no unclosed block diagnostics.
   * 
   * **Validates: Requirements 4.1, 4.2**
   */
  it('should handle brace-style blocks inside programs', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), { minLength: 3, maxLength: 10 }),
        fc.stringOf(fc.constantFrom('a', 'b', 'c', '1', '2', '3', ' ', '+', '-'), { minLength: 1, maxLength: 15 }),
        (program_name, mata_content) => {
          // Create a program with a brace-style mata block inside
          const my_document = `program define ${program_name}
mata { ${mata_content} }
end`;

          // Tokenize and initialize from tokens
          const my_lex_result = lexer.tokenize(my_document);
          context_tracker.initialize_from_tokens(my_lex_result.tokens, my_document);

          // Get context ranges
          const my_ranges = context_tracker.get_all_context_ranges();

          // Should have exactly one mata block
          expect(my_ranges.length).toBe(1);
          expect(my_ranges[0].context).toBe(LanguageContext.MATA);

          // Mata block should be closed by '}'
          expect(my_ranges[0].end_delimiter?.command).toBe('}');

          // Should NOT emit unclosed block diagnostic
          const my_diagnostics = context_tracker.validate_context_structure();
          const my_unclosed_errors = my_diagnostics.filter(
            (d) => d.code === ContextErrorCode.UNCLOSED_MATA_BLOCK ||
                   d.code === ContextErrorCode.UNCLOSED_PYTHON_BLOCK
          );
          expect(my_unclosed_errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

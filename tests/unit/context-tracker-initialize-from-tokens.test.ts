import { describe, it, expect, beforeEach } from 'bun:test';
import { ContextTracker } from '../../src/context-tracker';
import { StataLexer } from '../../src/lexer';
import { LanguageContext } from '../../src/types';

describe('ContextTracker.initialize_from_tokens', () => {
  let tracker: ContextTracker;
  let lexer: StataLexer;

  beforeEach(() => {
    tracker = new ContextTracker();
    lexer = new StataLexer();
  });

  /**
   * Test that initialize_from_tokens correctly extracts context ranges from tokens
   * without re-scanning the document content.
   */
  it('should initialize context ranges from tokens', () => {
    const my_content = `mata
matrix A = (1, 2)
end
generate x = 1`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one mata block
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    expect(my_ranges[0].start_delimiter.command).toBe('mata');
    expect(my_ranges[0].end_delimiter?.command).toBe('end');
  });

  /**
   * Test that ranges are sorted by (start.line, start.character)
   */
  it('should return sorted context ranges', () => {
    const my_content = `mata
matrix A = (1, 2)
end
python
x = 5
end python
mata
matrix B = (3, 4)
end`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have three blocks
    expect(my_ranges).toHaveLength(3);

    // Verify ranges are sorted
    for (let my_i = 1; my_i < my_ranges.length; my_i++) {
      const my_prev = my_ranges[my_i - 1];
      const my_curr = my_ranges[my_i];

      const my_prev_line = my_prev.range.start.line;
      const my_prev_char = my_prev.range.start.character;
      const my_curr_line = my_curr.range.start.line;
      const my_curr_char = my_curr.range.start.character;

      if (my_prev_line === my_curr_line) {
        expect(my_prev_char).toBeLessThanOrEqual(my_curr_char);
      } else {
        expect(my_prev_line).toBeLessThan(my_curr_line);
      }
    }
  });

  /**
   * Test that position lookups work correctly after initialize_from_tokens
   */
  it('should enable correct position lookups after initialization', () => {
    const my_content = `generate x = 1
mata
matrix A = (1, 2)
end
generate y = 2`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Test position lookups
    expect(tracker.get_context_at_position({ line: 0, character: 0 })).toBe(
      LanguageContext.STATA
    );
    expect(tracker.get_context_at_position({ line: 2, character: 0 })).toBe(
      LanguageContext.MATA
    );
    expect(tracker.get_context_at_position({ line: 4, character: 0 })).toBe(
      LanguageContext.STATA
    );
  });

  /**
   * Test that single-line contexts are handled correctly
   */
  it('should handle single-line mata contexts', () => {
    const my_content = `mata: matrix A = (1, 2)
generate x = 1`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one single-line mata block
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    expect(my_ranges[0].is_single_line).toBe(true);
  });

  /**
   * Test that single-line python contexts are handled correctly
   */
  it('should handle single-line python contexts', () => {
    const my_content = `python: x = 5
generate y = 1`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one single-line python block
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.PYTHON);
    expect(my_ranges[0].is_single_line).toBe(true);
  });

  /**
   * Test that nested contexts are handled correctly
   */
  it('should handle nested contexts', () => {
    const my_content = `mata
python
x = 5
end python
end`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have two blocks (mata and nested python)
    expect(my_ranges.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Test that unclosed blocks are handled
   */
  it('should handle unclosed blocks', () => {
    const my_content = `mata
matrix A = (1, 2)`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one unclosed mata block
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    expect(my_ranges[0].end_delimiter).toBeUndefined();
  });

  /**
   * Test that empty documents are handled
   */
  it('should handle empty documents', () => {
    const my_content = '';

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have no ranges
    expect(my_ranges).toHaveLength(0);
  });

  /**
   * Test that documents with only Stata code are handled
   */
  it('should handle documents with only stata code', () => {
    const my_content = `generate x = 1
generate y = 2`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have no ranges
    expect(my_ranges).toHaveLength(0);

    // All positions should be in Stata context
    expect(tracker.get_context_at_position({ line: 0, character: 0 })).toBe(
      LanguageContext.STATA
    );
    expect(tracker.get_context_at_position({ line: 1, character: 0 })).toBe(
      LanguageContext.STATA
    );
  });

  /**
   * Test that brace-style mata blocks are recognized as properly closed
   */
  it('should handle brace-style mata blocks', () => {
    const my_content = `mata { 1234 }`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one mata block
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    expect(my_ranges[0].end_delimiter?.command).toBe('}');
    
    // Should not emit unclosed block diagnostic
    const my_diagnostics = tracker.validate_context_structure();
    expect(my_diagnostics).toHaveLength(0);
  });

  /**
   * Test that brace-style python blocks are recognized as properly closed
   */
  it('should handle brace-style python blocks', () => {
    const my_content = `python { print("hello") }`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one python block
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.PYTHON);
    expect(my_ranges[0].end_delimiter?.command).toBe('}');
    
    // Should not emit unclosed block diagnostic
    const my_diagnostics = tracker.validate_context_structure();
    expect(my_diagnostics).toHaveLength(0);
  });

  /**
   * Test that nested braces in brace-style blocks are handled correctly
   */
  it('should handle nested braces in brace-style blocks', () => {
    const my_content = `mata { for (i=1; i<=10; i++) { x[i] = i } }`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one mata block
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    expect(my_ranges[0].end_delimiter?.command).toBe('}');
    
    // Should not emit unclosed block diagnostic
    const my_diagnostics = tracker.validate_context_structure();
    expect(my_diagnostics).toHaveLength(0);
  });

  /**
   * Test that brace on next line is treated as traditional block
   */
  it('should treat brace on next line as traditional block', () => {
    const my_content = `mata
{
1234
}
end`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one mata block closed by 'end', not '}'
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    expect(my_ranges[0].end_delimiter?.command).toBe('end');
    
    // Should not emit unclosed block diagnostic
    const my_diagnostics = tracker.validate_context_structure();
    expect(my_diagnostics).toHaveLength(0);
  });

  /**
   * Test that brace-style mata blocks inside programs work correctly
   */
  it('should handle brace-style mata blocks inside programs', () => {
    const my_content = `program define my_prog
mata { 1234 }
end`;

    // Tokenize the content
    const my_lex_result = lexer.tokenize(my_content);

    // Initialize from tokens
    tracker.initialize_from_tokens(my_lex_result.tokens, my_content);

    // Get context ranges
    const my_ranges = tracker.get_all_context_ranges();

    // Should have one mata block closed by '}'
    expect(my_ranges).toHaveLength(1);
    expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    expect(my_ranges[0].end_delimiter?.command).toBe('}');
    
    // Should not emit unclosed block diagnostic
    const my_diagnostics = tracker.validate_context_structure();
    expect(my_diagnostics).toHaveLength(0);
  });
});

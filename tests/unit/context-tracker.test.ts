import { ContextTracker } from '../../src/context-tracker';
import { init_tracker_from_source } from '../test-context-helper';
import { LanguageContext, ContextErrorCode } from '../../src/types';

describe('ContextTracker', () => {
  let tracker: ContextTracker;

  beforeEach(() => {
    tracker = new ContextTracker();
  });

  describe('basic context detection', () => {
    test('should detect mata block', () => {
      const my_source = `mata
      matrix A = (1, 2 \\ 3, 4)
      end`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].context).toBe(LanguageContext.MATA);
      expect(my_ranges[0].start_delimiter.command).toBe('mata');
      expect(my_ranges[0].end_delimiter?.command).toBe('end');
      expect(my_ranges[0].is_single_line).toBe(false);
    });

    test('should detect python block', () => {
      const my_source = `python
      import numpy as np
      end`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].context).toBe(LanguageContext.PYTHON);
      expect(my_ranges[0].start_delimiter.command).toBe('python');
      expect(my_ranges[0].end_delimiter?.command).toBe('end');
      expect(my_ranges[0].is_single_line).toBe(false);
    });

    test('should detect single-line mata context', () => {
      const my_source = `mata: matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].context).toBe(LanguageContext.MATA);
      expect(my_ranges[0].start_delimiter.command).toBe('mata:');
      expect(my_ranges[0].is_single_line).toBe(true);
    });

    test('should detect single-line python context', () => {
      const my_source = `python: x = 5`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].context).toBe(LanguageContext.PYTHON);
      expect(my_ranges[0].start_delimiter.command).toBe('python:');
      expect(my_ranges[0].is_single_line).toBe(true);
    });
  });

  describe('context position queries', () => {
    test('should return correct context at position', () => {
      const my_source = `generate x = 1
mata
matrix A = (1, 2)
end
generate y = 2`;

      init_tracker_from_source(tracker, my_source);

      // Line 0: Stata context
      expect(tracker.get_context_at_position({ line: 0, character: 0 })).toBe(
        LanguageContext.STATA
      );

      // Line 2: Mata context
      expect(tracker.get_context_at_position({ line: 2, character: 0 })).toBe(
        LanguageContext.MATA
      );

      // Line 4: Stata context
      expect(tracker.get_context_at_position({ line: 4, character: 0 })).toBe(
        LanguageContext.STATA
      );
    });

    test('should identify embedded language positions', () => {
      const my_source = `generate x = 1
mata
matrix A = (1, 2)
end
generate y = 2`;

      init_tracker_from_source(tracker, my_source);

      expect(tracker.is_in_embedded_language({ line: 0, character: 0 })).toBe(
        false
      );
      expect(tracker.is_in_embedded_language({ line: 2, character: 0 })).toBe(
        true
      );
      expect(tracker.is_in_embedded_language({ line: 4, character: 0 })).toBe(
        false
      );
    });

    test('should get context range at position', () => {
      const my_source = `mata
matrix A = (1, 2)
end`;

      init_tracker_from_source(tracker, my_source);
      const my_range = tracker.get_context_range_at_position({
        line: 1,
        character: 0,
      });

      expect(my_range).toBeDefined();
      expect(my_range?.context).toBe(LanguageContext.MATA);
      expect(my_range?.start_delimiter.command).toBe('mata');
    });
  });

  describe('nested blocks', () => {
    test('should handle nested mata blocks', () => {
      const my_source = `mata
matrix A = (1, 2)
mata
matrix B = (3, 4)
end
end`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      // Should detect both blocks
      expect(my_ranges.length).toBeGreaterThanOrEqual(1);
      expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    });
  });

  describe('error detection', () => {
    test('should detect unclosed mata block', () => {
      const my_source = `mata
matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(1);
      expect(my_diagnostics[0].code).toBe(
        ContextErrorCode.UNCLOSED_MATA_BLOCK
      );
      expect(my_diagnostics[0].severity).toBe('error');
    });

    test('should detect unclosed python block', () => {
      const my_source = `python
import numpy as np`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(1);
      expect(my_diagnostics[0].code).toBe(
        ContextErrorCode.UNCLOSED_PYTHON_BLOCK
      );
      expect(my_diagnostics[0].severity).toBe('error');
    });

    test('should not report error for single-line contexts', () => {
      const my_source = `mata: matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    test('should ignore mata in comments', () => {
      const my_source = `* This is a mata comment
generate x = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
    });

    test('should handle multiple blocks', () => {
      const my_source = `mata
matrix A = (1, 2)
end
python
x = 5
end
mata
matrix B = (3, 4)
end`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(3);
      expect(my_ranges[0].context).toBe(LanguageContext.MATA);
      expect(my_ranges[1].context).toBe(LanguageContext.PYTHON);
      expect(my_ranges[2].context).toBe(LanguageContext.MATA);
    });

    test('should handle empty document', () => {
      init_tracker_from_source(tracker, '');
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
    });

    test('should handle document with only stata code', () => {
      const my_source = `generate x = 1
generate y = 2`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
      expect(tracker.get_context_at_position({ line: 0, character: 0 })).toBe(
        LanguageContext.STATA
      );
    });
  });

  describe('incremental updates', () => {
    test('should update context after content change', () => {
      let my_source = `generate x = 1`;
      init_tracker_from_source(tracker, my_source);

      expect(tracker.get_all_context_ranges()).toHaveLength(0);

      my_source = `mata
matrix A = (1, 2)
end`;
      init_tracker_from_source(tracker, my_source);

      expect(tracker.get_all_context_ranges()).toHaveLength(1);
      expect(tracker.get_all_context_ranges()[0].context).toBe(
        LanguageContext.MATA
      );
    });

    test('should clear diagnostics on update', () => {
      let my_source = `mata
matrix A = (1, 2)`;
      init_tracker_from_source(tracker, my_source);

      let my_diagnostics = tracker.validate_context_structure();
      expect(my_diagnostics).toHaveLength(1);

      my_source = `mata
matrix A = (1, 2)
end`;
      init_tracker_from_source(tracker, my_source);

      my_diagnostics = tracker.validate_context_structure();
      expect(my_diagnostics).toHaveLength(0);
    });
  });

  describe('case sensitivity', () => {
    test('should NOT detect mata block with uppercase MATA', () => {
      const my_source = `MATA
matrix A = (1, 2)
END`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      // MATA is not a valid keyword - only lowercase 'mata' works
      expect(my_ranges).toHaveLength(0);
    });

    test('should NOT detect python block with uppercase PYTHON', () => {
      const my_source = `PYTHON
x = 5
END`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      // PYTHON is not a valid keyword - only lowercase 'python' works
      expect(my_ranges).toHaveLength(0);
    });

    test('should detect mata block with lowercase mata', () => {
      const my_source = `mata
matrix A = (1, 2)
end`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    });
  });

  describe('edge case handling - delimiters in strings and comments', () => {
    test('should ignore mata in string literal', () => {
      const my_source = `local x = "mata"
generate y = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
      expect(tracker.get_context_at_position({ line: 0, character: 0 })).toBe(
        LanguageContext.STATA
      );
    });

    test('should ignore python in string literal', () => {
      const my_source = `local x = "python"
generate y = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
    });

    test('should ignore mata in line comment', () => {
      const my_source = `// This is a mata comment
generate x = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
    });

    test('should ignore python in line comment', () => {
      const my_source = `// This is a python comment
generate x = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
    });

    test('should ignore mata in block comment', () => {
      const my_source = `/* This is a mata comment */
generate x = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(0);
    });

    test('should handle mata with inline comment', () => {
      const my_source = `mata // start mata block
matrix A = (1, 2)
end`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].context).toBe(LanguageContext.MATA);
    });

    test('should handle end with inline comment', () => {
      const my_source = `mata
matrix A = (1, 2)
end // close mata block`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].end_delimiter?.command).toBe('end');
    });

    test('should not flag an orphan end inside a block comment', () => {
      const my_source = `/* outer
end
*/
display "live"`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics.some(
        my_d => my_d.code === ContextErrorCode.UNEXPECTED_END
      )).toBe(false);
    });

    test('should not flag an orphan end inside a nested block comment', () => {
      const my_source = `/* outer
/* inner */
end
*/
display "live"`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics.some(
        my_d => my_d.code === ContextErrorCode.UNEXPECTED_END
      )).toBe(false);
    });

    test('should still flag a live orphan end after a block comment', () => {
      const my_source = `/* program foo
end
*/
end`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      const my_orphan = my_diagnostics.find(
        my_d => my_d.code === ContextErrorCode.UNEXPECTED_END
      );
      expect(my_orphan).toBeDefined();
      expect(my_orphan?.range.start.line).toBe(3);
    });

    test('should treat a commented program on the closing comment line as not live', () => {
      // `program define foo */` is the line that closes the block
      // comment, so the program definition is commented out. The
      // terminator after `*/` starts on this line, so it must not make
      // the line look live; the following `end` is then a real orphan
      // and must be flagged.
      const my_source = `/*
program define foo */
end`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      const my_orphan = my_diagnostics.find(
        my_d => my_d.code === ContextErrorCode.UNEXPECTED_END
      );
      expect(my_orphan).toBeDefined();
      expect(my_orphan?.range.start.line).toBe(2);
    });

    test('should not flag "end mata"/"end python" inside a block comment', () => {
      const my_source = `/* outer
end mata
end python
*/`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(0);
    });
  });

  describe('edge case handling - malformed blocks', () => {
    test('should detect malformed end command (end mata)', () => {
      const my_source = `mata
matrix A = (1, 2)
end mata`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      // Should have error for malformed end command
      const my_malformed_error = my_diagnostics.find(
        (d) => d.code === ContextErrorCode.INVALID_DELIMITER_POSITION
      );
      expect(my_malformed_error).toBeDefined();
    });

    test('should detect end python outside python context', () => {
      const my_source = `generate x = 1
end python`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(1);
      expect(my_diagnostics[0].code).toBe(
        ContextErrorCode.MISMATCHED_END_PYTHON
      );
      expect(my_diagnostics[0].severity).toBe('error');
    });

    test('should handle incomplete mata block at EOF', () => {
      const my_source = `mata
matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(1);
      expect(my_diagnostics[0].code).toBe(
        ContextErrorCode.UNCLOSED_MATA_BLOCK
      );
    });

    test('should handle incomplete python block at EOF', () => {
      const my_source = `python
x = 5`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(1);
      expect(my_diagnostics[0].code).toBe(
        ContextErrorCode.UNCLOSED_PYTHON_BLOCK
      );
    });
  });

  describe('error recovery suggestions', () => {
    test('should provide suggestions for unclosed mata block', () => {
      const my_source = `mata
matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();
      const my_suggestions = tracker.get_error_recovery_suggestions(
        my_diagnostics[0]
      );

      expect(my_suggestions.length).toBeGreaterThan(0);
      expect(my_suggestions[0]).toContain('end');
    });

    test('should provide suggestions for unexpected end', () => {
      const my_source = `generate x = 1
end mata`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();
      
      // Should have diagnostic for invalid syntax
      expect(my_diagnostics.length).toBeGreaterThan(0);
      
      const my_suggestions = tracker.get_error_recovery_suggestions(
        my_diagnostics[0]
      );

      expect(my_suggestions.length).toBeGreaterThan(0);
      expect(my_suggestions[0]).toContain('end');
    });

    test('should provide suggestions for misplaced end python', () => {
      const my_source = `generate x = 1
end python`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();
      const my_suggestions = tracker.get_error_recovery_suggestions(
        my_diagnostics[0]
      );

      expect(my_suggestions.length).toBeGreaterThan(0);
      expect(my_suggestions[0]).toContain('end');
    });
  });

  describe('error recovery capability', () => {
    test('should indicate recovery is possible with few errors', () => {
      const my_source = `mata
matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      expect(tracker.can_recover_from_errors()).toBe(true);
    });

    test('should handle recovery after fixing errors', () => {
      let my_source = `mata
matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      let my_diagnostics = tracker.validate_context_structure();
      expect(my_diagnostics).toHaveLength(1);

      // Fix the error
      my_source = `mata
matrix A = (1, 2)
end`;
      init_tracker_from_source(tracker, my_source);
      my_diagnostics = tracker.validate_context_structure();

      expect(my_diagnostics).toHaveLength(0);
    });
  });

  describe('statement boundary detection', () => {
    test('should only match end at statement boundary', () => {
      const my_source = `mata
matrix A = (1, 2)
end
generate x = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].end_delimiter?.command).toBe('end');
    });

    test('should not match end if followed by other code', () => {
      const my_source = `mata
matrix A = (1, 2)
end generate x = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      // Should not close the block because 'end' is not at statement boundary
      expect(my_ranges[0].end_delimiter).toBeUndefined();
    });

    test('should handle single-line mata with statement terminator', () => {
      const my_source = `mata: matrix A = (1, 2)
generate x = 1`;

      init_tracker_from_source(tracker, my_source);
      const my_ranges = tracker.get_all_context_ranges();

      expect(my_ranges).toHaveLength(1);
      expect(my_ranges[0].is_single_line).toBe(true);
    });
  });

  describe('error recovery strategies', () => {
    test('should attempt recovery from unclosed mata block', () => {
      const my_source = `mata
matrix A = (1, 2)
end`;

      init_tracker_from_source(tracker, my_source);
      const my_recovery_line = tracker.attempt_recovery_from_unclosed_block(
        0,
        'mata'
      );

      expect(my_recovery_line).toBe(2);
    });

    test('should attempt recovery from unclosed python block', () => {
      const my_source = `python
x = 5
end`;

      init_tracker_from_source(tracker, my_source);
      const my_recovery_line = tracker.attempt_recovery_from_unclosed_block(
        0,
        'python'
      );

      expect(my_recovery_line).toBe(2);
    });

    test('should return null if no recovery possible', () => {
      const my_source = `mata
matrix A = (1, 2)`;

      init_tracker_from_source(tracker, my_source);
      const my_recovery_line = tracker.attempt_recovery_from_unclosed_block(
        0,
        'mata'
      );

      expect(my_recovery_line).toBeNull();
    });

    test('should stop recovery at another block start', () => {
      const my_source = `mata
matrix A = (1, 2)
python
x = 5
end`;

      init_tracker_from_source(tracker, my_source);
      const my_recovery_line = tracker.attempt_recovery_from_unclosed_block(
        0,
        'mata'
      );

      // Should return null because another block started before finding 'end'
      expect(my_recovery_line).toBeNull();
    });

    test('should provide common mistakes list', () => {
      init_tracker_from_source(tracker, '');
      const my_mistakes = tracker.get_common_mistakes();

      expect(my_mistakes.length).toBeGreaterThan(0);
      expect(my_mistakes[0]).toHaveProperty('mistake');
      expect(my_mistakes[0]).toHaveProperty('fix');
      expect(my_mistakes[0]).toHaveProperty('example');
    });

    test('should include end mata mistake', () => {
      init_tracker_from_source(tracker, '');
      const my_mistakes = tracker.get_common_mistakes();

      const my_end_mata_mistake = my_mistakes.find((m) =>
        m.mistake.includes('end mata')
      );
      expect(my_end_mata_mistake).toBeDefined();
    });

    test('should include nested block mistake', () => {
      init_tracker_from_source(tracker, '');
      const my_mistakes = tracker.get_common_mistakes();

      const my_nested_mistake = my_mistakes.find((m) =>
        m.mistake.includes('nested')
      );
      expect(my_nested_mistake).toBeDefined();
    });
  });

  describe('program block end recognition', () => {
    test('should not flag end in program define blocks', () => {
      const my_source = `program define my_program
  display "hello"
end`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      // Should NOT have any "Unexpected end" errors for program blocks
      const my_unexpected_end = my_diagnostics.find(
        (d) => d.message.includes('Unexpected "end"')
      );
      expect(my_unexpected_end).toBeUndefined();
    });

    test('should not flag end in program blocks with abbreviated define', () => {
      const my_source = `program def my_program
  display "hello"
end`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      // Should NOT have any "Unexpected end" errors
      const my_unexpected_end = my_diagnostics.find(
        (d) => d.message.includes('Unexpected "end"')
      );
      expect(my_unexpected_end).toBeUndefined();
    });

    test('should not flag end in multiple program blocks', () => {
      const my_source = `program define prog1
  display "one"
end

program define prog2
  display "two"
end`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      // Should NOT have any "Unexpected end" errors
      const my_unexpected_end_errors = my_diagnostics.filter(
        (d) => d.message.includes('Unexpected "end"')
      );
      expect(my_unexpected_end_errors.length).toBe(0);
    });

    test('should flag standalone end outside any block', () => {
      const my_source = `display "hello"
end`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      // Should have an "Unexpected end" error for orphan end commands
      const my_unexpected_end = my_diagnostics.find(
        (d) => d.message.includes('Unexpected "end"')
      );
      expect(my_unexpected_end).toBeDefined();
    });

    test('should handle program blocks with Stata code before and after', () => {
      const my_source = `display "before"

program define my_program
  display "inside"
end

display "after"`;

      init_tracker_from_source(tracker, my_source);
      const my_diagnostics = tracker.validate_context_structure();

      // Should NOT have any "Unexpected end" errors
      const my_unexpected_end = my_diagnostics.find(
        (d) => d.message.includes('Unexpected "end"')
      );
      expect(my_unexpected_end).toBeUndefined();
    });
  });
});

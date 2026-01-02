import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Load the TextMate grammar
const grammar_path = path.join(import.meta.dir, '../../client/syntaxes/stata.tmLanguage.json');
const grammar = JSON.parse(fs.readFileSync(grammar_path, 'utf8'));

// Test regex patterns directly
function test_pattern(pattern: any, text: string) {
  if (pattern.match) {
    const regex = new RegExp(pattern.match);
    const match = text.match(regex);
    return match ? { matched: true, captures: match } : { matched: false };
  }
  return { matched: false };
}

describe('TextMate Grammar - Macro Definition Highlighting Edge Cases', () => {
  const the_patterns = grammar.repository['commands-macro'].patterns;
  const local_with_name = the_patterns[0];  // local + macro name
  const global_with_name = the_patterns[1]; // global + macro name
  const temp_with_name = the_patterns[2];   // tempvar/tempname/tempfile + macro name
  const local_global_fallback = the_patterns[3]; // local/global keyword only
  const temp_fallback = the_patterns[4];    // temp keyword only

  it('should highlight keyword only for command without macro name', () => {
    // The pattern with macro name capture should NOT match
    expect(test_pattern(local_with_name, 'local').matched).toBe(false);
    expect(test_pattern(global_with_name, 'global').matched).toBe(false);
    // The fallback pattern should match
    expect(test_pattern(local_global_fallback, 'local').matched).toBe(true);
    expect(test_pattern(local_global_fallback, 'global').matched).toBe(true);
  });

  it('should highlight keyword and macro name with assignment operator', () => {
    // Pattern should match the keyword and macro name before =
    const result = test_pattern(local_with_name, 'local num = 4');
    expect(result.matched).toBe(true);
    expect(result.captures![4]).toBe('num');

    const result2 = test_pattern(global_with_name, 'global count = 10');
    expect(result2.matched).toBe(true);
    expect(result2.captures![6]).toBe('count');
  });

  it('should highlight keyword but not invalid macro names starting with number', () => {
    // Pattern with name capture should NOT match invalid names
    expect(test_pattern(local_with_name, 'local 123invalid').matched).toBe(false);
    expect(test_pattern(global_with_name, 'global 456bad').matched).toBe(false);
    // Fallback should still match the keyword
    expect(test_pattern(local_global_fallback, 'local 123invalid').matched).toBe(true);
    expect(test_pattern(local_global_fallback, 'global 456bad').matched).toBe(true);
  });

  it('should highlight keyword and underscore-prefixed names', () => {
    const result = test_pattern(local_with_name, 'local _valid');
    expect(result.matched).toBe(true);
    expect(result.captures![4]).toBe('_valid');

    const result2 = test_pattern(global_with_name, 'global _another');
    expect(result2.matched).toBe(true);
    expect(result2.captures![6]).toBe('_another');
  });

  it('should highlight keyword and first name for temp commands with multiple names', () => {
    const result = test_pattern(temp_with_name, 'tempvar x y z');
    expect(result.matched).toBe(true);
    expect(result.captures![2]).toBe('x'); // Only first name captured

    const result2 = test_pattern(temp_with_name, 'tempname a b c');
    expect(result2.matched).toBe(true);
    expect(result2.captures![2]).toBe('a');

    const result3 = test_pattern(temp_with_name, 'tempfile f1 f2 f3');
    expect(result3.matched).toBe(true);
    expect(result3.captures![2]).toBe('f1');
  });
});

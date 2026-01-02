import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Load the TextMate grammar
const grammar_path = path.join(import.meta.dir, '../../client/syntaxes/stata.tmLanguage.json');
const grammar = JSON.parse(fs.readFileSync(grammar_path, 'utf8'));

// Simple tokenizer for testing patterns
function test_pattern(pattern: any, text: string) {
  if (pattern.match) {
    const regex = new RegExp(pattern.match);
    return regex.test(text);
  }
  if (pattern.begin && pattern.end) {
    const begin_regex = new RegExp(pattern.begin);
    const end_regex = new RegExp(pattern.end);
    return { begin: begin_regex.test(text), end: end_regex.test(text) };
  }
  return false;
}

describe('TextMate Grammar - Mata Block Detection', () => {
  it('should have mata-inline pattern before mata-block in patterns array', () => {
    const the_patterns = grammar.patterns;
    const mata_inline_index = the_patterns.findIndex((my_p: any) => my_p.include === '#mata-inline');
    const mata_block_index = the_patterns.findIndex((my_p: any) => my_p.include === '#mata-block');
    
    expect(mata_inline_index).toBeGreaterThan(-1);
    expect(mata_block_index).toBeGreaterThan(-1);
    expect(mata_inline_index).toBeLessThan(mata_block_index);
  });

  it('should match inline Mata with colon and code', () => {
    const mata_inline = grammar.repository['mata-inline'];
    const result = test_pattern(mata_inline, 'mata: x = 1');
    expect(result).toBe(true);
  });

  it('should match inline Mata without colon', () => {
    const mata_inline = grammar.repository['mata-inline'];
    const result = test_pattern(mata_inline, 'mata x = 1');
    expect(result).toBe(true);
  });

  it('should not match mata at end of line for inline pattern', () => {
    const mata_inline = grammar.repository['mata-inline'];
    const result = test_pattern(mata_inline, 'mata:');
    expect(result).toBe(false);
  });

  it('should match multi-line Mata block begin pattern', () => {
    const mata_block = grammar.repository['mata-block'];
    const result = test_pattern(mata_block, 'mata:') as { begin: boolean; end: boolean };
    expect(result.begin).toBe(true);
  });

  it('should match multi-line Mata block end pattern', () => {
    const mata_block = grammar.repository['mata-block'];
    const result = test_pattern(mata_block, 'end') as { begin: boolean; end: boolean };
    expect(result.end).toBe(true);
  });

  it('should not match inline code for multi-line block begin', () => {
    const mata_block = grammar.repository['mata-block'];
    const result = test_pattern(mata_block, 'mata: x = 1') as { begin: boolean; end: boolean };
    expect(result.begin).toBe(false);
  });
});
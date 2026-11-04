/**
 * Deterministic checks on generators that claim to produce valid
 * commands. A fixed seed and a large sample make a rare bad value show
 * up on every run instead of as an occasional property-test flake.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import {
  arbitrary_command_name,
  arbitrary_embedded_block_line,
  PREFIX_COMMANDS,
  RESERVED_QUALIFIER_KEYWORDS,
  could_end_embedded_block,
} from './generators/primitives';

const SAMPLE_SIZE = 50000;

describe('arbitrary_command_name', () => {
  it('never generates a prefix, qualifier, or structural keyword', () => {
    const the_rejected = new Set([
      ...PREFIX_COMMANDS,
      ...RESERVED_QUALIFIER_KEYWORDS,
      'end', 'while', 'program', 'mata', 'python', 'unab', 'syntax',
    ]);
    const the_names = fc.sample(arbitrary_command_name(), {
      numRuns: SAMPLE_SIZE,
      seed: 1,
    });
    const the_hits = [...new Set(the_names.filter((my_name) => the_rejected.has(my_name)))];
    expect(the_hits).toEqual([]);
  });
});

describe('arbitrary_embedded_block_line', () => {
  // Lines that close or open a block. `end` and `#end` are the
  // counterexamples from valid-block-terminators (CI seed 37415869).
  const BOUNDARY_LINES = [
    'end', '  end', 'end // note', 'mata', 'python', 'program define x',
    'input x', '#end', 'x end', 'a=end',
  ];

  it('recognizes every block boundary line', () => {
    for (const my_line of BOUNDARY_LINES) {
      expect(could_end_embedded_block(my_line)).toBe(true);
    }
    expect(could_end_embedded_block('display 1')).toBe(false);
    expect(could_end_embedded_block('End')).toBe(false);
    expect(could_end_embedded_block('#mata')).toBe(false);
  });

  it('never generates a block boundary line or a comment opener', () => {
    const the_lines = fc.sample(arbitrary_embedded_block_line(20), {
      numRuns: SAMPLE_SIZE,
      seed: 1,
    });
    const the_hits = [...new Set(the_lines.filter(
      (my_line) => could_end_embedded_block(my_line) || my_line.includes('/*')
    ))];
    expect(the_hits).toEqual([]);
  });
});

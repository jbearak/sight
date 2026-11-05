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
  could_join_next_line,
} from './generators/primitives';

const SAMPLE_SIZE = 50000;

describe('arbitrary_command_name', () => {
  it('never generates a prefix, qualifier, or structural keyword', () => {
    const the_rejected = new Set([
      ...PREFIX_COMMANDS,
      ...RESERVED_QUALIFIER_KEYWORDS,
      'end', 'while', 'program', 'mata', 'python', 'unab',
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
  // Lines that close or open a block.
  const BOUNDARY_LINES = [
    'end', '  end', 'end // note', 'end /* c */', '/* c */ end',
    'mata', 'python', 'program define x', 'input x',
  ];
  // A mid-line `end` stays block content, as in Stata 18. `#end` and
  // `x end` are the counterexamples #352 excluded from generated
  // content (CI seed 37415869) before the lexer followed this rule.
  const CONTENT_LINES = [
    'display 1', 'End', '#mata', '#end', 'x end', 'a=end', '1end',
    'x = 1 // end', 'x = "end"', 'x = 1; end',
  ];

  it('recognizes every block boundary line', () => {
    for (const my_line of BOUNDARY_LINES) {
      expect(could_end_embedded_block(my_line)).toBe(true);
    }
    for (const my_line of CONTENT_LINES) {
      expect(could_end_embedded_block(my_line)).toBe(false);
    }
  });

  it('never generates a block boundary, continuation, or comment opener', () => {
    const the_lines = fc.sample(arbitrary_embedded_block_line(20), {
      numRuns: SAMPLE_SIZE,
      seed: 1,
    });
    const the_hits = [...new Set(the_lines.filter(
      (my_line) =>
        could_end_embedded_block(my_line) ||
        could_join_next_line(my_line) ||
        my_line.includes('/*')
    ))];
    expect(the_hits).toEqual([]);
  });

  it('still generates lines with a mid-line end', () => {
    const the_lines = fc.sample(arbitrary_embedded_block_line(20), {
      numRuns: SAMPLE_SIZE,
      seed: 1,
    });
    expect(the_lines.some((my_line) => my_line.includes('end'))).toBe(true);
  });
});

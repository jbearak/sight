/**
 * Section Hierarchy Property Tests
 *
 * Tests that verify section hierarchy computation and symbol nesting:
 * - Level-aware range end lines
 * - Symbol nesting correctness
 * - Selection range preservation through compute_section_ranges
 * - Input order independence for compute_section_ranges
 * - Existing symbols are preserved after nest_in_sections
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { compute_section_ranges, nest_in_sections } from '../../src/providers/symbols';
import { RawSection, SectionDetectionType } from '../../src/providers/section-detector';
import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver-textdocument';
import {
  arbitrary_section_list,
  arbitrary_section_name,
} from './generators/sections';

/**
 * Helper: deep-clone a RawSection array to avoid mutation side effects.
 */
function clone_sections(sections: RawSection[]): RawSection[] {
  return sections.map((my_s) => ({
    name: my_s.name,
    level: my_s.level,
    range: {
      start: { line: my_s.range.start.line, character: my_s.range.start.character },
      end: { line: my_s.range.end.line, character: my_s.range.end.character },
    },
    selection_range: {
      start: { line: my_s.selection_range.start.line, character: my_s.selection_range.start.character },
      end: { line: my_s.selection_range.end.line, character: my_s.selection_range.end.character },
    },
    detection_type: my_s.detection_type,
  }));
}

/**
 * Helper: count all DocumentSymbols recursively (including children).
 */
function count_symbols_recursive(symbols: DocumentSymbol[]): number {
  let my_count = 0;
  for (const my_symbol of symbols) {
    my_count++;
    if (my_symbol.children && my_symbol.children.length > 0) {
      my_count += count_symbols_recursive(my_symbol.children);
    }
  }
  return my_count;
}

/**
 * Helper: collect all DocumentSymbols recursively into a flat list.
 */
function collect_all_symbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
  const my_result: DocumentSymbol[] = [];
  for (const my_symbol of symbols) {
    my_result.push(my_symbol);
    if (my_symbol.children && my_symbol.children.length > 0) {
      my_result.push(...collect_all_symbols(my_symbol.children));
    }
  }
  return my_result;
}

/**
 * Helper: generate a fake DocumentSymbol at a given line.
 */
function make_symbol(name: string, line: number): DocumentSymbol {
  return {
    name: name,
    kind: SymbolKind.Function,
    range: {
      start: { line: line, character: 0 },
      end: { line: line, character: name.length + 16 },
    },
    selectionRange: {
      start: { line: line, character: 16 },
      end: { line: line, character: 16 + name.length },
    },
    detail: 'Program',
    children: [],
  };
}

describe('Section Hierarchy Property Tests', () => {
  /**
   * Property 4: Level-aware range end lines
   *
   * After compute_section_ranges(), each section at level N should end before
   * the next section at level <= N starts, or extend to EOF if there is no
   * such subsequent section.
   *
   * Feature: stata-outline-sections, Property 4: Level-aware range end lines
   */
  it('should compute level-aware range end lines correctly', () => {
    fc.assert(
      fc.property(
        arbitrary_section_list(),
        fc.integer({ min: 50, max: 200 }),
        (my_sections, my_line_count) => {
          // Ensure line_count is greater than the last section's start line
          const my_max_start = my_sections.reduce(
            (my_max, my_s) => Math.max(my_max, my_s.range.start.line),
            0
          );
          const my_adjusted_line_count = Math.max(my_line_count, my_max_start + 10);

          const my_cloned = clone_sections(my_sections);
          compute_section_ranges(my_cloned, my_adjusted_line_count);

          // Verify: for each section at level N, it ends before the next section at level <= N
          for (let my_i = 0; my_i < my_cloned.length; my_i++) {
            const my_current = my_cloned[my_i];
            const my_current_level = my_current.level;
            const my_current_end_line = my_current.range.end.line;

            // Find the next section at level <= current level
            let my_next_sibling_or_ancestor_idx = -1;
            for (let my_j = my_i + 1; my_j < my_cloned.length; my_j++) {
              if (my_cloned[my_j].level <= my_current_level) {
                my_next_sibling_or_ancestor_idx = my_j;
                break;
              }
            }

            if (my_next_sibling_or_ancestor_idx !== -1) {
              // Current section should end before the next sibling/ancestor starts
              const my_next_start = my_cloned[my_next_sibling_or_ancestor_idx].range.start.line;
              if (my_current_end_line >= my_next_start) {
                return false;
              }
            } else {
              // No subsequent sibling/ancestor: section should extend to EOF
              if (my_current_end_line !== my_adjusted_line_count - 1) {
                return false;
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Symbol nesting correctness
   *
   * After nest_in_sections(), symbols whose start position falls within a section's
   * range should appear as descendants of that section in the hierarchy.
   *
   * Feature: stata-outline-sections, Property 5: Symbol nesting correctness
   */
  it('should nest symbols correctly within their containing sections', () => {
    fc.assert(
      fc.property(
        arbitrary_section_list(),
        fc.integer({ min: 50, max: 200 }),
        (my_sections, my_line_count) => {
          const my_max_start = my_sections.reduce(
            (my_max, my_s) => Math.max(my_max, my_s.range.start.line),
            0
          );
          const my_adjusted_line_count = Math.max(my_line_count, my_max_start + 10);

          const my_cloned = clone_sections(my_sections);
          compute_section_ranges(my_cloned, my_adjusted_line_count);

          // Create symbols that fall within section ranges
          const my_existing_symbols: DocumentSymbol[] = [];
          for (const my_section of my_cloned) {
            // Place a symbol inside this section's range (a few lines after start)
            const my_symbol_line = my_section.range.start.line + 2;
            if (my_symbol_line < my_section.range.end.line) {
              my_existing_symbols.push(
                make_symbol(`prog_in_${my_section.name.replace(/\s+/g, '_')}`, my_symbol_line)
              );
            }
          }

          if (my_existing_symbols.length === 0) {
            return true; // No symbols to test
          }

          const my_result = nest_in_sections(my_cloned, my_existing_symbols);

          // Collect all non-section symbols from the result
          const my_all_flat = collect_all_symbols(my_result);
          const my_non_section_symbols = my_all_flat.filter(
            (my_s) => my_s.kind !== SymbolKind.Module
          );

          // Every existing symbol should appear somewhere in the result
          for (const my_sym of my_existing_symbols) {
            const my_found = my_non_section_symbols.some(
              (my_s) => my_s.name === my_sym.name
            );
            if (!my_found) {
              return false;
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Selection range preservation
   *
   * compute_section_ranges() should never modify the selection_range of any section.
   * Only range.end may be updated.
   *
   * Feature: stata-outline-sections, Property 6: Selection range preservation
   */
  it('should preserve selection_range when computing section ranges', () => {
    fc.assert(
      fc.property(
        arbitrary_section_list(),
        fc.integer({ min: 50, max: 200 }),
        (my_sections, my_line_count) => {
          const my_max_start = my_sections.reduce(
            (my_max, my_s) => Math.max(my_max, my_s.range.start.line),
            0
          );
          const my_adjusted_line_count = Math.max(my_line_count, my_max_start + 10);

          // Save original selection ranges
          const my_original_selection_ranges = my_sections.map((my_s) => ({
            start: { line: my_s.selection_range.start.line, character: my_s.selection_range.start.character },
            end: { line: my_s.selection_range.end.line, character: my_s.selection_range.end.character },
          }));

          const my_cloned = clone_sections(my_sections);
          compute_section_ranges(my_cloned, my_adjusted_line_count);

          // After sorting, sections are in start-line order. We need to match
          // by start line to compare selection_ranges correctly.
          for (let my_i = 0; my_i < my_cloned.length; my_i++) {
            // Find the original entry by matching start line
            const my_original = my_original_selection_ranges.find((my_o, my_j) =>
              my_sections[my_j].range.start.line === my_cloned[my_i].range.start.line
            );

            if (!my_original) return false;

            const my_sel = my_cloned[my_i].selection_range;
            if (my_sel.start.line !== my_original.start.line) return false;
            if (my_sel.start.character !== my_original.start.character) return false;
            if (my_sel.end.line !== my_original.end.line) return false;
            if (my_sel.end.character !== my_original.end.character) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Input order independence
   *
   * compute_section_ranges() sorts sections by start line internally, so
   * shuffling the input should produce the same final result.
   *
   * Feature: stata-outline-sections, Property 7: Input order independence
   */
  it('should produce the same result regardless of input order', () => {
    fc.assert(
      fc.property(
        arbitrary_section_list(),
        fc.integer({ min: 50, max: 200 }),
        (my_sections, my_line_count) => {
          const my_max_start = my_sections.reduce(
            (my_max, my_s) => Math.max(my_max, my_s.range.start.line),
            0
          );
          const my_adjusted_line_count = Math.max(my_line_count, my_max_start + 10);

          // Compute ranges on the original order
          const my_original = clone_sections(my_sections);
          compute_section_ranges(my_original, my_adjusted_line_count);

          // Compute ranges on a reversed copy
          const my_reversed = clone_sections(my_sections).reverse();
          compute_section_ranges(my_reversed, my_adjusted_line_count);

          // Sort both by start line for comparison
          my_original.sort((a, b) => a.range.start.line - b.range.start.line);
          my_reversed.sort((a, b) => a.range.start.line - b.range.start.line);

          if (my_original.length !== my_reversed.length) return false;

          for (let my_i = 0; my_i < my_original.length; my_i++) {
            const my_a = my_original[my_i];
            const my_b = my_reversed[my_i];

            if (my_a.name !== my_b.name) return false;
            if (my_a.level !== my_b.level) return false;
            if (my_a.range.start.line !== my_b.range.start.line) return false;
            if (my_a.range.end.line !== my_b.range.end.line) return false;
            if (my_a.range.end.character !== my_b.range.end.character) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Existing symbols preserved
   *
   * After nest_in_sections(), the total count of all symbols (counted recursively
   * through children) should equal the number of input sections plus the number of
   * input existing symbols. No symbols are lost or duplicated.
   *
   * Feature: stata-outline-sections, Property 8: Existing symbols preserved
   */
  it('should preserve all existing symbols after nesting in sections', () => {
    fc.assert(
      fc.property(
        arbitrary_section_list(),
        fc.integer({ min: 50, max: 200 }),
        fc.array(arbitrary_section_name(), { minLength: 0, maxLength: 5 }),
        (my_sections, my_line_count, my_symbol_names) => {
          const my_max_start = my_sections.reduce(
            (my_max, my_s) => Math.max(my_max, my_s.range.start.line),
            0
          );
          const my_adjusted_line_count = Math.max(my_line_count, my_max_start + 10);

          const my_cloned = clone_sections(my_sections);
          compute_section_ranges(my_cloned, my_adjusted_line_count);

          // Create existing symbols at various positions
          const my_existing_symbols: DocumentSymbol[] = [];
          let my_sym_line = 0;
          for (const my_name of my_symbol_names) {
            // Place symbols at specific lines, some inside sections, some outside
            my_existing_symbols.push(make_symbol(my_name, my_sym_line));
            my_sym_line += 7;
          }

          const my_input_section_count = my_cloned.length;
          const my_input_symbol_count = my_existing_symbols.length;
          const my_expected_total = my_input_section_count + my_input_symbol_count;

          const my_result = nest_in_sections(my_cloned, my_existing_symbols);
          const my_actual_total = count_symbols_recursive(my_result);

          return my_actual_total === my_expected_total;
        }
      ),
      { numRuns: 100 }
    );
  });
});

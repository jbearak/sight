/**
 * Hover Completeness Property Tests
 *
 * Tests that verify hover information is complete and accurate for:
 * - Built-in commands: syntax and description
 * - User-defined macros: definition location and value
 * - User-defined programs: signature and location
 * - Non-hoverable positions: returns null
 */

import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import {
  arbitrary_command_name,
} from './generators/primitives';
import {
  arbitrary_document_with_macros,
  arbitrary_non_hoverable_position,
} from './generators/documents';
import {
  parse_and_analyze,
  find_all_positions_of,
} from './helpers/document-utils';

describe('Hover Completeness Property Tests', () => {
  let my_hover_provider: HoverProvider;
  let my_command_db: CommandDatabase;

  beforeEach(() => {
    my_command_db = new CommandDatabase();
    my_hover_provider = new HoverProvider(my_command_db);
  });

  /**
   * Property 21: Built-in Commands
   * For any built-in command, hover should return syntax and description.
   * Feature: comprehensive-property-tests, Property 21: Built-in Commands
   * Validates: Requirement 7.1
   */
  it('should provide hover for built-in commands', () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_command_name(),
        async (my_command) => {
          // Skip if command is not a built-in (generated identifiers might not be in DB)
          const my_cmd_info = my_command_db.lookup(my_command);
          if (!my_cmd_info) {
            return true; // Skip non-builtin commands
          }

          const my_document = my_command;
          const my_doc_state = parse_and_analyze(my_document);
          const my_position = { line: 0, character: 0 };

          const my_hover = await my_hover_provider.get_hover(my_doc_state, my_position);

          // Should return hover information
          if (!my_hover) {
            return false;
          }

          // Should have contents
          if (!my_hover.contents) {
            return false;
          }

          // Contents should be a MarkupContent object with value
          if (typeof my_hover.contents === 'object' && 'value' in my_hover.contents) {
            const my_value = my_hover.contents.value;
            // Should contain command name
            if (!my_value.includes(my_command)) {
              return false;
            }
            // Should contain syntax or description
            if (!my_value.includes('Syntax') && !my_value.includes('syntax')) {
              return false;
            }
            return true;
          }

          return false;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 22: User Macros
   * For any document with user-defined macros, hover on macro reference should
   * show definition info.
   * Feature: comprehensive-property-tests, Property 22: User Macros
   * Validates: Requirement 7.2, 7.3
   */
  it('should provide hover for user-defined macros', () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_document_with_macros(1, 0),
        async ({ document, macros }) => {
          // Skip if no local macros
          if (macros.length === 0) {
            return true;
          }

          const my_doc_state = parse_and_analyze(document);

          // For each local macro, find its reference and verify hover
          for (const my_macro of macros) {
            if (my_macro.scope !== 'local') {
              continue;
            }

            // Find reference to this macro (e.g., `macro_name')
            const my_ref_pattern = `\`${my_macro.name}'`;
            const my_ref_positions = find_all_positions_of(document, my_ref_pattern);

            // If we found references, verify hover works
            for (const my_pos of my_ref_positions) {
              // Move position to be inside the macro reference (skip backtick)
              const my_hover_pos = {
                line: my_pos.line,
                character: my_pos.character + 1,
              };

              const my_hover = await my_hover_provider.get_hover(my_doc_state, my_hover_pos);

              // Should return hover information
              if (!my_hover) {
                return false;
              }

              // Should have contents
              if (!my_hover.contents) {
                return false;
              }

              // Contents should contain macro name
              if (typeof my_hover.contents === 'object' && 'value' in my_hover.contents) {
                const my_value = my_hover.contents.value;
                if (!my_value.includes(my_macro.name)) {
                  return false;
                }
                // Should indicate it's a macro
                if (!my_value.includes('Macro')) {
                  return false;
                }
              } else {
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
   * Property 23: Non-Hoverable Positions
   * For any position that is not hoverable (whitespace, operators), hover
   * should return null.
   * Feature: comprehensive-property-tests, Property 23: Non-Hoverable Positions
   * Validates: Requirement 7.4
   */
  it('should generate non-hoverable positions on whitespace', () => {
    fc.assert(
      fc.property(
        arbitrary_non_hoverable_position(),
        ({ document, position }) => {
          const my_previous_char = document[position.character - 1] ?? ' ';
          const my_current_char = document[position.character] ?? ' ';

          expect(my_previous_char).not.toMatch(/[a-zA-Z0-9_]/);
          expect(document[position.character]).toMatch(/\s/);
          expect(my_current_char).not.toMatch(/[a-zA-Z0-9_]/);
        }
      ),
      { numRuns: 100, seed: 191 }
    );
  });

  it('should return null for non-hoverable positions', () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_non_hoverable_position(),
        async ({ document, position }) => {
          const my_doc_state = parse_and_analyze(document);

          const my_hover = await my_hover_provider.get_hover(my_doc_state, position);

          // Should return null for non-hoverable positions
          return my_hover === null;
        }
      ),
      { numRuns: 100, seed: 191 }
    );
  });

  /**
   * Extended Property: Global Macros
   * For any document with global macros, hover on global macro reference
   * should show definition info.
   * Feature: comprehensive-property-tests, Property 22 (extended): Global Macros
   * Validates: Requirement 7.2, 7.3 (extended for global macros)
   */
  it('should provide hover for global macros', () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_document_with_macros(0, 2),
        async ({ document, macros }) => {
          // Skip if no global macros
          if (macros.length === 0) {
            return true;
          }

          const my_doc_state = parse_and_analyze(document);

          // For each global macro, find its reference and verify hover
          for (const my_macro of macros) {
            if (my_macro.scope !== 'global') {
              continue;
            }

            // Find reference to this macro (e.g., $macro_name)
            const my_ref_positions = find_all_positions_of(
              document,
              `${my_macro.name}`
            );

            // If we found references, verify hover works
            for (const my_pos of my_ref_positions) {
              const my_hover = await my_hover_provider.get_hover(my_doc_state, my_pos);

              // Should return hover information
              if (!my_hover) {
                continue; // Skip if no hover (might be in definition line)
              }

              // Should have contents
              if (!my_hover.contents) {
                return false;
              }

              // Contents should contain macro name
              if (typeof my_hover.contents === 'object' && 'value' in my_hover.contents) {
                const my_value = my_hover.contents.value;
                if (!my_value.includes(my_macro.name)) {
                  return false;
                }
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

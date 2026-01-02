/**
 * Go-to-Definition Property Tests
 *
 * Tests that verify go-to-definition navigation works correctly for defined
 * and undefined symbols. Ensures that navigation returns correct locations
 * for macros and programs, and returns empty for undefined references.
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DefinitionProvider } from '../../src/providers/definition';
import {
  arbitrary_document_with_definitions,
  arbitrary_document_with_undefined_refs,
  arbitrary_document_with_macros,
} from './generators/documents';
import {
  parse_and_analyze,
} from './helpers/document-utils';
import {
  location_matches,
} from './helpers/position-utils';

describe('Go-to-Definition Property Tests', () => {
  let my_definition_provider: DefinitionProvider;

  beforeEach(() => {
    my_definition_provider = new DefinitionProvider();
  });

  /**
   * Property 19: Defined Symbols
   * For any document with defined symbols, go-to-definition should return
   * the definition location.
   * Feature: comprehensive-property-tests, Property 19: Defined Symbols
   * Validates: Requirement 6.1
   */
  it('should return correct definition location for defined symbols', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_document_with_definitions(),
        async ({ document, definitions }) => {
          const my_doc_state = parse_and_analyze(document);

          // For each definition, verify go-to-definition returns a result
          for (const my_def of definitions) {
            const my_ref_position = my_def.reference_position;
            const my_result = await my_definition_provider.get_definition(
              my_doc_state,
              my_ref_position
            );

            // Result should not be null for defined symbols
            if (!my_result) {
              return false;
            }

            // Result should be in the same document
            if (my_result.uri !== my_doc_state.uri) {
              return false;
            }

            // Result range should be on the definition line
            if (my_result.range.start.line !== my_def.definition_location.line) {
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
   * Property 20: Undefined Symbols
   * For any reference to an undefined symbol, go-to-definition should return
   * empty (not error).
   * Feature: comprehensive-property-tests, Property 20: Undefined Symbols
   * Validates: Requirement 6.2
   */
  it('should return empty for undefined symbol references', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_document_with_undefined_refs(),
        async ({ document, undefined_positions }) => {
          const my_doc_state = parse_and_analyze(document);

          // For each undefined reference position, verify go-to-definition returns empty
          for (const my_position of undefined_positions) {
            const my_result = await my_definition_provider.get_definition(
              my_doc_state,
              my_position
            );

            // Result should be null or undefined (not an error)
            if (my_result !== null && my_result !== undefined) {
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
   * Cross-file test for global macros
   * For any global macro defined in one document, go-to-definition should
   * find it when referenced from another document (via workspace symbols).
   * Feature: comprehensive-property-tests, Property 20 (extended): Cross-file Global Macros
   * Validates: Requirement 6.1 (extended for workspace)
   */
  it('should resolve global macros across files via workspace symbols', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_document_with_macros(0, 1),
        async ({ document: my_global_doc, macros: my_global_macros }) => {
          // Skip if no global macros
          if (my_global_macros.length === 0) {
            return true;
          }

          // Parse the document with global macros
          const my_global_doc_state = parse_and_analyze(my_global_doc);

          // Create a second document that references the global macros
          const my_ref_lines = my_global_macros
            .map((my_macro) => `display $${my_macro.name}`)
            .join('\n');
          const my_ref_doc_state = parse_and_analyze(my_ref_lines);

          // For each reference, verify go-to-definition finds it in workspace symbols
          for (let my_i = 0; my_i < my_global_macros.length; my_i++) {
            const my_position = { line: my_i, character: 10 };
            const my_result = await my_definition_provider.get_definition(
              my_ref_doc_state,
              my_position,
              my_global_doc_state.symbols
            );

            // Should find the definition in workspace symbols
            if (!my_result) {
              return false;
            }

            // Should point to the global document
            if (my_result.uri !== my_global_doc_state.uri) {
              return false;
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Non-Nested Invalid Character Detection Property Tests
 *
 * Tests that verify macro references with invalid characters (dots, spaces, etc.)
 * that do NOT contain nested macro syntax correctly produce INVALID_MACRO_CHAR
 * diagnostics.
 *
 * Feature: nested-macro-invalid-char-false-positive
 * Property 4: Non-Nested Invalid Character Detection
 * Validates: Requirements 3.1
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_identifier } from './generators';

describe('Non-Nested Invalid Character Detection Property Tests', () => {
  let my_diagnostics_provider: DiagnosticsProvider;
  let my_config: StataLSPConfig;

  // Invalid characters that are NOT part of nested macro syntax
  // Excludes: ` ' $ { } which are used in nested macro patterns
  const the_invalid_chars = ['.', ' ', '@', '#', '!', '%', '^', '&', '*', '(', ')', '-', '+', '=', '[', ']', ':', ';', '<', '>', ',', '?', '/', '\\', '|', '~'];

  beforeEach(() => {
    // Create a mock connection for diagnostics provider
    const my_mock_connection = {
      sendDiagnostics: () => {},
    } as any;

    my_diagnostics_provider = new DiagnosticsProvider(my_mock_connection);

    // Create default config with diagnostics enabled
    my_config = {
      diagnostics: {
        enabled: true,
        severity: {
          styleWarnings: 'warning',
          undefinedMacro: 'warning',
          undefinedVariable: 'warning',
        },
        undefinedVariableEnabled: true,
      },
      adoPaths: [],
      completion: {
        cacheSize: 100,
        prefixMaxItems: 50,
      },
      formatting: {
        indentSize: 4,
        indentStyle: 'spaces',
        lineWidth: 80,
        preferredCommentStyle: '//',
        normalizeCommentStyle: false,
        commentLineWidth: 72,
      },
      indexing: {
        maxFileSizeBytes: 1000000,
      },
      indexWorkspace: false,
      cross_file: {
        index_workspace: false,
        max_indexed_files: 100,
        assume_call_site: 'end',
        max_backward_depth: 10,
        max_forward_depth: 10,
        max_chain_depth: 20,
        diagnostics: {
          undefined_symbol: 'warning',
          out_of_scope: 'warning',
          missing_file: 'warning',
          max_depth: 'warning',
        },
      },
    } as StataLSPConfig;
  });

  /**
   * Generator for invalid macro names that contain invalid characters
   * but do NOT contain nested macro syntax.
   * 
   * Generates patterns like:
   * - foo.bar (dot)
   * - my var (space)
   * - test@name (at sign)
   */
  function arbitrary_invalid_non_nested_macro_name(): fc.Arbitrary<string> {
    return fc
      .tuple(
        arbitrary_identifier(),
        fc.constantFrom(...the_invalid_chars),
        arbitrary_identifier()
      )
      .map(([my_prefix, my_invalid_char, my_suffix]) => {
        return `${my_prefix}${my_invalid_char}${my_suffix}`;
      })
      // Filter out anything that looks like nested macro syntax
      .filter((my_name) => {
        // No backticks (nested local macro start)
        if (my_name.includes('`')) return false;
        // No apostrophes (nested local macro end)
        if (my_name.includes("'")) return false;
        // No ${ (nested braced global start)
        if (my_name.includes('${')) return false;
        // No $identifier pattern (nested unbraced global)
        if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(my_name)) return false;
        // No stored result patterns
        if (/^[recs]\(.*\)(\[.*\])?$/.test(my_name)) return false;
        return true;
      });
  }

  /**
   * Property 4: Non-Nested Invalid Character Detection
   *
   * For any macro reference that does NOT contain nested macro syntax and
   * contains characters outside [A-Za-z0-9_], the Analyzer SHALL produce
   * an "Invalid character in macro name" diagnostic.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 4: Non-Nested Invalid Character Detection
   * Validates: Requirements 3.1
   */
  it('should flag non-nested macros with invalid characters', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_invalid_non_nested_macro_name(), async (my_invalid_name) => {
        // Create a local macro reference with invalid characters: `foo.bar'
        const my_invalid_ref = `\`${my_invalid_name}'`;

        // Create a Stata document using the reference
        const my_document = `display ${my_invalid_ref}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should have at least one INVALID_MACRO_CHAR diagnostic
        return my_invalid_char_diagnostics.length > 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4b: Non-Nested Invalid Character Detection for Braced Globals
   *
   * For any braced global macro reference that does NOT contain nested macro
   * syntax and contains characters outside [A-Za-z0-9_], the Analyzer SHALL
   * produce an "Invalid character in macro name" diagnostic.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 4: Non-Nested Invalid Character Detection
   * Validates: Requirements 3.1
   */
  it('should flag non-nested braced globals with invalid characters', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_invalid_non_nested_macro_name(), async (my_invalid_name) => {
        // Create a braced global macro reference with invalid characters: ${foo.bar}
        const my_invalid_ref = `\${${my_invalid_name}}`;

        // Create a Stata document using the reference
        const my_document = `display ${my_invalid_ref}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should have at least one INVALID_MACRO_CHAR diagnostic
        return my_invalid_char_diagnostics.length > 0;
      }),
      { numRuns: 100 }
    );
  });
});

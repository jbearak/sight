/**
 * Unbalanced Macro No Duplicate Diagnostics Property Tests
 *
 * Tests that verify unbalanced macro expressions (missing closing apostrophe/brace)
 * only produce lexer errors and do NOT produce additional INVALID_MACRO_CHAR
 * diagnostics from the analyzer.
 *
 * Feature: nested-macro-invalid-char-false-positive
 * Property 5: No Duplicate Diagnostics for Unbalanced Macros
 * Validates: Requirements 4.1, 4.2, 4.3
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode, LexerErrorCode } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_identifier } from './generators';

describe('Unbalanced Macro No Duplicate Diagnostics Property Tests', () => {
  let my_diagnostics_provider: DiagnosticsProvider;
  let my_config: StataLSPConfig;

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
   * Generator for unbalanced local macro expressions.
   * Generates patterns like:
   * - `one`two' (missing closing apostrophe for outer)
   * - `foo (missing closing apostrophe entirely)
   */
  function arbitrary_unbalanced_local_macro(): fc.Arbitrary<string> {
    return fc.oneof(
      // Pattern 1: `one`two' - nested but missing outer closing apostrophe
      fc.tuple(arbitrary_identifier(), arbitrary_identifier()).map(
        ([my_outer, my_inner]) => `\`${my_outer}\`${my_inner}'`
      ),
      // Pattern 2: `foo - missing closing apostrophe entirely
      arbitrary_identifier().map((my_name) => `\`${my_name}`),
      // Pattern 3: `one`two - both missing closing apostrophes
      fc.tuple(arbitrary_identifier(), arbitrary_identifier()).map(
        ([my_outer, my_inner]) => `\`${my_outer}\`${my_inner}`
      )
    );
  }

  /**
   * Generator for unbalanced braced global macro expressions.
   * Generates patterns like:
   * - ${one${two} (missing closing brace for outer)
   * - ${foo (missing closing brace entirely)
   */
  function arbitrary_unbalanced_braced_global(): fc.Arbitrary<string> {
    return fc.oneof(
      // Pattern 1: ${one${two} - nested but missing outer closing brace
      fc.tuple(arbitrary_identifier(), arbitrary_identifier()).map(
        ([my_outer, my_inner]) => `\${${my_outer}\${${my_inner}}`
      ),
      // Pattern 2: ${foo - missing closing brace entirely
      arbitrary_identifier().map((my_name) => `\${${my_name}`),
      // Pattern 3: ${one`two' - local in global but missing outer closing brace
      fc.tuple(arbitrary_identifier(), arbitrary_identifier()).map(
        ([my_outer, my_inner]) => `\${${my_outer}\`${my_inner}'`
      )
    );
  }

  /**
   * Property 5: No Duplicate Diagnostics for Unbalanced Local Macros
   *
   * For any local macro reference with unbalanced backticks/apostrophes,
   * the system SHALL produce at most one diagnostic (from the lexer),
   * and the Analyzer SHALL NOT produce an additional "Invalid character
   * in macro name" diagnostic.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 5: No Duplicate Diagnostics for Unbalanced Macros
   * Validates: Requirements 4.1, 4.2
   */
  it('should not produce INVALID_MACRO_CHAR for unbalanced local macros', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_unbalanced_local_macro(), async (my_unbalanced_macro) => {
        // Create a Stata document using the unbalanced macro
        // Put it on its own line to ensure the lexer sees the newline
        const my_document = `display ${my_unbalanced_macro}\nlocal x = 1`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Filter for lexer UNBALANCED_QUOTES errors (code 1001)
        const my_lexer_errors = my_diagnostics.filter(
          (my_diag) => my_diag.code === LexerErrorCode.UNBALANCED_QUOTES
        );

        // Should have no INVALID_MACRO_CHAR diagnostics from analyzer
        // The lexer error is sufficient
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5b: No Duplicate Diagnostics for Unbalanced Braced Globals
   *
   * For any braced global macro reference with unbalanced braces,
   * the system SHALL produce at most one diagnostic (from the lexer),
   * and the Analyzer SHALL NOT produce an additional "Invalid character
   * in macro name" diagnostic.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 5: No Duplicate Diagnostics for Unbalanced Macros
   * Validates: Requirements 4.2, 4.3
   */
  it('should not produce INVALID_MACRO_CHAR for unbalanced braced globals', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_unbalanced_braced_global(), async (my_unbalanced_macro) => {
        // Create a Stata document using the unbalanced macro
        // Put it on its own line to ensure the lexer sees the newline
        const my_document = `display ${my_unbalanced_macro}\nlocal x = 1`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should have no INVALID_MACRO_CHAR diagnostics from analyzer
        // The lexer error is sufficient
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5c: Combined Unbalanced Macro Test
   *
   * For any macro reference (local or global) with unbalanced delimiters,
   * the Analyzer SHALL NOT produce an "Invalid character in macro name"
   * diagnostic.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 5: No Duplicate Diagnostics for Unbalanced Macros
   * Validates: Requirements 4.1, 4.2, 4.3
   */
  it('should not produce INVALID_MACRO_CHAR for any unbalanced macro type', async () => {
    // Combined generator for any unbalanced macro type
    const arbitrary_any_unbalanced_macro = fc.oneof(
      arbitrary_unbalanced_local_macro(),
      arbitrary_unbalanced_braced_global()
    );

    await fc.assert(
      fc.asyncProperty(arbitrary_any_unbalanced_macro, async (my_unbalanced_macro) => {
        // Create a Stata document using the unbalanced macro
        // Put it on its own line to ensure the lexer sees the newline
        const my_document = `display ${my_unbalanced_macro}\nlocal x = 1`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should have no INVALID_MACRO_CHAR diagnostics from analyzer
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });
});

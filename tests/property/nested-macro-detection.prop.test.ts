/**
 * Nested Macro Detection Property Tests
 *
 * Tests that verify nested macro references like `one`two'' or ${one${two}}
 * are correctly recognized and do not produce false positive INVALID_MACRO_CHAR
 * diagnostics.
 *
 * Feature: nested-macro-invalid-char-false-positive
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_identifier } from './generators';

describe('Nested Macro Detection Property Tests', () => {
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
   * Generator for nested local macros at various depths.
   * Generates patterns like:
   * - depth 1: `a`b''
   * - depth 2: `a`b`c'''
   * - depth 3: `a`b`c`d''''
   */
  function arbitrary_nested_local_macro(my_depth: number): fc.Arbitrary<string> {
    if (my_depth <= 0) {
      return arbitrary_identifier().map((my_name) => `\`${my_name}'`);
    }

    return fc
      .tuple(arbitrary_identifier(), arbitrary_nested_local_macro(my_depth - 1))
      .map(([my_outer, my_inner]) => {
        // Remove outer backtick and apostrophe from inner, then wrap
        const my_inner_content = my_inner.slice(1, -1);
        return `\`${my_outer}\`${my_inner_content}''`;
      });
  }

  /**
   * Property 1: Nested Local Macro Detection
   *
   * For any local macro reference containing balanced backtick-apostrophe pairs
   * at any nesting depth (1 to 6 levels), no INVALID_MACRO_CHAR diagnostic
   * should be produced.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 1: Nested Local Macro Detection
   * Validates: Requirements 1.1, 1.2, 1.3
   */
  it('should not flag nested local macros as invalid macro characters', async () => {
    // Test depths 1-6
    const arbitrary_depth = fc.integer({ min: 1, max: 6 });

    await fc.assert(
      fc.asyncProperty(arbitrary_depth, async (my_depth) => {
        // Generate a nested local macro at the specified depth
        const my_nested_macro = fc.sample(arbitrary_nested_local_macro(my_depth), 1)[0];

        // Create a Stata document using the nested macro
        const my_document = `display ${my_nested_macro}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should have no INVALID_MACRO_CHAR diagnostics
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Generator for nested braced global macros.
   * Generates patterns like ${one${two}}
   */
  function arbitrary_nested_braced_global(): fc.Arbitrary<string> {
    return fc
      .tuple(arbitrary_identifier(), arbitrary_identifier())
      .map(([my_outer, my_inner]) => `\${${my_outer}\${${my_inner}}}`);
  }

  /**
   * Generator for local macro inside braced global.
   * Generates patterns like ${one`two'}
   */
  function arbitrary_local_in_global(): fc.Arbitrary<string> {
    return fc
      .tuple(arbitrary_identifier(), arbitrary_identifier())
      .map(([my_outer, my_inner]) => `\${${my_outer}\`${my_inner}'}`);
  }

  /**
   * Generator for mixed nesting patterns.
   * Generates patterns like ${one`two'$three}
   */
  function arbitrary_mixed_nested_global(): fc.Arbitrary<string> {
    return fc
      .tuple(arbitrary_identifier(), arbitrary_identifier(), arbitrary_identifier())
      .map(([my_outer, my_local, my_global]) => `\${${my_outer}\`${my_local}'$${my_global}}`);
  }

  /**
   * Property 2: Nested Global Macro Detection
   *
   * For any braced global macro reference containing nested macro syntax
   * (inner braced globals ${...}, local macros `...', or unbraced globals $name),
   * no INVALID_MACRO_CHAR diagnostic should be produced.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 2: Nested Global Macro Detection
   * Validates: Requirements 2.1, 2.2, 2.3
   */
  it('should not flag nested global macros as invalid macro characters', async () => {
    // Generator for various nested global patterns
    const arbitrary_nested_global = fc.oneof(
      arbitrary_nested_braced_global(),
      arbitrary_local_in_global(),
      arbitrary_mixed_nested_global()
    );

    await fc.assert(
      fc.asyncProperty(arbitrary_nested_global, async (my_nested_macro) => {
        // Create a Stata document using the nested macro
        const my_document = `display ${my_nested_macro}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should have no INVALID_MACRO_CHAR diagnostics
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Nested Macro Diagnostic Suppression
   *
   * For any macro reference (local or global) that contains nested macro syntax,
   * the Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic.
   *
   * This property combines both local and global nested macros in a single test
   * to verify the diagnostic suppression works correctly across all nested macro types.
   *
   * Feature: nested-macro-invalid-char-false-positive, Property 3: Nested Macro Diagnostic Suppression
   * Validates: Requirements 1.4, 2.4
   */
  it('should suppress INVALID_MACRO_CHAR diagnostic for all nested macro types', async () => {
    // Generator for nested local macros at depth 1-3
    const arbitrary_nested_local = fc.integer({ min: 1, max: 3 }).chain((my_depth) =>
      arbitrary_nested_local_macro(my_depth)
    );

    // Generator for all nested global patterns
    const arbitrary_nested_global = fc.oneof(
      arbitrary_nested_braced_global(),
      arbitrary_local_in_global(),
      arbitrary_mixed_nested_global()
    );

    // Combined generator for any nested macro type
    const arbitrary_any_nested_macro = fc.oneof(
      arbitrary_nested_local,
      arbitrary_nested_global
    );

    await fc.assert(
      fc.asyncProperty(arbitrary_any_nested_macro, async (my_nested_macro) => {
        // Create a Stata document using the nested macro
        const my_document = `display ${my_nested_macro}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics (code 3010)
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should have no INVALID_MACRO_CHAR diagnostics for any nested macro
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });
});

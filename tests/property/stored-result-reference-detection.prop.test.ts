/**
 * Stored Result Reference Detection Property Tests
 *
 * Tests that verify stored result references (r(), e(), c(), s()) wrapped in
 * backtick-apostrophe syntax are correctly recognized and do not produce
 * false positive INVALID_MACRO_CHAR diagnostics.
 *
 * Feature: stored-result-reference-false-positive
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_identifier } from './generators';

describe('Stored Result Reference Detection Property Tests', () => {
  let my_diagnostics_provider: DiagnosticsProvider;
  let my_config: StataLSPConfig;

  // Stored result prefixes
  const the_stored_result_prefixes = ['r', 'e', 'c', 's'];

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
   * Property 1: Stored Result References Are Not Flagged
   *
   * For any valid identifier combined with a stored result prefix (r, e, c, s),
   * when wrapped in backtick-apostrophe syntax, no INVALID_MACRO_CHAR diagnostic
   * should be produced.
   *
   * Feature: stored-result-reference-false-positive, Property 1: Stored Result References Are Not Flagged
   * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
   */
  it('should not flag stored result references as invalid macro characters', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrary_identifier(),
        fc.constantFrom(...the_stored_result_prefixes),
        async (my_identifier, my_prefix) => {
          // Create a stored result reference: `r(identifier)'
          const my_stored_result_ref = `\`${my_prefix}(${my_identifier})'`;

          // Create a Stata document using the reference
          const my_document = `display ${my_stored_result_ref}`;

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
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Non-Stored-Result Invalid Characters Are Flagged
   *
   * For any string containing invalid characters (dots, spaces, special chars)
   * that does not match a stored result pattern, when wrapped in backtick-apostrophe
   * syntax, an INVALID_MACRO_CHAR diagnostic should be produced.
   *
   * Feature: stored-result-reference-false-positive, Property 2: Non-Stored-Result Invalid Characters Are Flagged
   * Validates: Requirements 2.1, 2.2, 2.3
   */
  it('should flag non-stored-result invalid characters', async () => {
    // Generator for invalid macro names that are NOT stored result patterns
    const arbitrary_invalid_macro_name = fc
      .tuple(
        arbitrary_identifier(),
        fc.constantFrom('.', ' ', '@', '#', '!', '%', '^', '&'),
        arbitrary_identifier()
      )
      .map(([my_prefix, my_invalid_char, my_suffix]) => {
        return `${my_prefix}${my_invalid_char}${my_suffix}`;
      })
      // Filter out anything that looks like a stored result pattern
      .filter((my_name) => {
        return !/^[recs]\(.*\)(\[.*\])?$/.test(my_name);
      });

    await fc.assert(
      fc.asyncProperty(arbitrary_invalid_macro_name, async (my_invalid_name) => {
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
   * Property 3: Nested Macros in Stored Results Are Not Flagged
   *
   * For stored result references containing nested macro patterns like
   * `r(`varname')' or `r(mean_`i')', no INVALID_MACRO_CHAR diagnostic
   * should be produced.
   *
   * Feature: stored-result-reference-false-positive, Property 3: Nested Macros in Stored Results Are Not Flagged
   * Validates: Requirements 3.1, 3.2
   */
  it('should not flag nested macros in stored results', async () => {
    // Generator for nested macro patterns within stored results
    const arbitrary_nested_stored_result = fc
      .tuple(
        fc.constantFrom(...the_stored_result_prefixes),
        fc.oneof(
          // Pattern 1: `r(`varname')' - nested macro as entire identifier
          arbitrary_identifier().map((my_name) => `\`${my_name}'`),
          // Pattern 2: `r(mean_`i')' - nested macro as suffix
          fc
            .tuple(arbitrary_identifier(), arbitrary_identifier())
            .map(([my_prefix, my_nested]) => `${my_prefix}_\`${my_nested}'`),
          // Pattern 3: `r(`prefix'_var)' - nested macro as prefix
          fc
            .tuple(arbitrary_identifier(), arbitrary_identifier())
            .map(([my_nested, my_suffix]) => `\`${my_nested}'_${my_suffix}`)
        )
      )
      .map(([my_prefix, my_inner]) => `\`${my_prefix}(${my_inner})'`);

    await fc.assert(
      fc.asyncProperty(arbitrary_nested_stored_result, async (my_nested_ref) => {
        // Create a Stata document using the nested reference
        const my_document = `display ${my_nested_ref}`;

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
   * Property 4: Matrix Subscripts in Stored Results Are Not Flagged
   *
   * For stored result references with matrix subscripts like `r(table)[1,1]'
   * or `e(b)[1,`i']', no INVALID_MACRO_CHAR diagnostic should be produced.
   *
   * Feature: stored-result-reference-false-positive, Property 4: Matrix Subscripts in Stored Results Are Not Flagged
   * Validates: Requirements 4.1, 4.2
   */
  it('should not flag matrix subscripts in stored results', async () => {
    // Generator for matrix subscript patterns
    const arbitrary_subscript = fc.oneof(
      // Numeric subscripts: [1,1], [2,3]
      fc
        .tuple(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 1, max: 100 })
        )
        .map(([my_row, my_col]) => `[${my_row},${my_col}]`),
      // Variable subscripts with macros: [1,`i'], [`j',1]
      fc
        .tuple(
          fc.oneof(
            fc.integer({ min: 1, max: 100 }).map((my_n) => my_n.toString()),
            arbitrary_identifier().map((my_name) => `\`${my_name}'`)
          ),
          fc.oneof(
            fc.integer({ min: 1, max: 100 }).map((my_n) => my_n.toString()),
            arbitrary_identifier().map((my_name) => `\`${my_name}'`)
          )
        )
        .map(([my_row, my_col]) => `[${my_row},${my_col}]`)
    );

    // Generator for stored results with matrix subscripts
    const arbitrary_matrix_stored_result = fc
      .tuple(
        fc.constantFrom(...the_stored_result_prefixes),
        arbitrary_identifier(),
        arbitrary_subscript
      )
      .map(
        ([my_prefix, my_identifier, my_subscript]) =>
          `\`${my_prefix}(${my_identifier})${my_subscript}'`
      );

    await fc.assert(
      fc.asyncProperty(
        arbitrary_matrix_stored_result,
        async (my_matrix_ref) => {
          // Create a Stata document using the matrix reference
          const my_document = `display ${my_matrix_ref}`;

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
        }
      ),
      { numRuns: 100 }
    );
  });
});

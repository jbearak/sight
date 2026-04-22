/**
 * Expression Macro False Positive Property Tests
 *
 * Tests that verify expression evaluation macro syntax (`=expr') is correctly
 * recognized and does NOT produce "Invalid character in macro name" diagnostics.
 *
 * Feature: expression-macro-false-positive
 * Property 1: Expression Evaluation Macros Are Not Flagged
 * Property 2: Non-Expression Invalid Characters Are Flagged
 * Validates: Requirements 1.1-1.5, 2.1-2.3, 3.1-3.4
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_identifier } from './generators';

describe('Expression Macro False Positive Property Tests', () => {
  let my_diagnostics_provider: DiagnosticsProvider;
  let my_config: StataLSPConfig;

  beforeEach(() => {
    const my_mock_connection = {
      sendDiagnostics: () => {},
    } as any;

    my_diagnostics_provider = new DiagnosticsProvider(my_mock_connection);

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
          missing_file: 'warning',
          max_depth: 'warning',
        },
      },
    } as StataLSPConfig;
  });

  /**
   * Generator for simple Stata expressions (arithmetic, function calls).
   * Generates expressions that would appear after = in `=expr' syntax.
   */
  function arbitrary_simple_expression(): fc.Arbitrary<string> {
    return fc.oneof(
      // Arithmetic expressions: 1+2, 3*4, etc.
      fc.tuple(
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom('+', '-', '*', '/'),
        fc.integer({ min: 1, max: 100 })
      ).map(([a, op, b]) => `${a}${op}${b}`),
      // Function calls: uchar(65533), string(x), etc.
      fc.tuple(
        fc.constantFrom('uchar', 'string', 'substr', 'strlen', 'real', 'int', 'round', 'abs', 'sqrt'),
        fc.oneof(
          fc.integer({ min: 1, max: 99999 }).map(n => n.toString()),
          arbitrary_identifier()
        )
      ).map(([fn, arg]) => `${fn}(${arg})`),
      // Simple numbers
      fc.integer({ min: 1, max: 99999 }).map(n => n.toString()),
      // Simple identifiers (variable references)
      arbitrary_identifier()
    );
  }

  /**
   * Generator for complex Stata expressions with nested macros.
   */
  function arbitrary_complex_expression(): fc.Arbitrary<string> {
    return fc.oneof(
      // Expression with nested local macro: `a' + `b'
      fc.tuple(arbitrary_identifier(), arbitrary_identifier())
        .map(([a, b]) => `\`${a}' + \`${b}'`),
      // Function with nested macro: substr("`str'", 1, 5)
      fc.tuple(
        fc.constantFrom('substr', 'strpos', 'strlen'),
        arbitrary_identifier()
      ).map(([fn, name]) => `${fn}("\`${name}'", 1, 5)`),
      // Matrix subscript: r(table)[1,1]
      fc.constantFrom('r', 'e', 'c', 's')
        .chain(prefix => fc.tuple(
          fc.constant(prefix),
          fc.constantFrom('table', 'N', 'mean', 'sd', 'values')
        ))
        .map(([prefix, name]) => `${prefix}(${name})[1,1]`)
    );
  }

  /**
   * Property 1: Expression Evaluation Macros Are Not Flagged
   *
   * For any local macro reference whose content starts with `=` (expression
   * evaluation syntax), the Analyzer SHALL NOT produce an "Invalid character
   * in macro name" diagnostic.
   *
   * Feature: expression-macro-false-positive, Property 1: Expression Evaluation Macros Are Not Flagged
   * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4
   */
  it('should NOT flag expression evaluation macros with simple expressions', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_simple_expression(), async (my_expr) => {
        // Create expression evaluation macro: `=expr'
        const my_expr_macro = `\`=${my_expr}'`;
        const my_document = `display ${my_expr_macro}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should NOT have any INVALID_MACRO_CHAR diagnostic
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1b: Expression Evaluation Macros with Complex Expressions
   *
   * Feature: expression-macro-false-positive, Property 1: Expression Evaluation Macros Are Not Flagged
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4
   */
  it('should NOT flag expression evaluation macros with complex expressions', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_complex_expression(), async (my_expr) => {
        // Create expression evaluation macro: `=expr'
        const my_expr_macro = `\`=${my_expr}'`;
        const my_document = `display ${my_expr_macro}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics
        const my_invalid_char_diagnostics = my_diagnostics.filter(
          (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
        );

        // Should NOT have any INVALID_MACRO_CHAR diagnostic
        return my_invalid_char_diagnostics.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  // Invalid characters that are NOT part of nested macro syntax or expression evaluation
  // Excludes: ` ' $ { } = which have special meanings
  const the_invalid_chars = ['.', ' ', '@', '#', '!', '%', '^', '&', '*', '(', ')', '-', '[', ']', ':', ';', '<', '>', ',', '?', '/', '\\', '|', '~'];

  /**
   * Generator for invalid macro names that do NOT start with = and contain
   * invalid characters.
   */
  function arbitrary_invalid_non_expression_macro_name(): fc.Arbitrary<string> {
    return fc
      .tuple(
        arbitrary_identifier(),
        fc.constantFrom(...the_invalid_chars),
        arbitrary_identifier()
      )
      .map(([my_prefix, my_invalid_char, my_suffix]) => {
        return `${my_prefix}${my_invalid_char}${my_suffix}`;
      })
      // Filter out anything that looks like nested macro syntax or expression evaluation
      .filter((my_name) => {
        // No expression evaluation (starts with =)
        if (my_name.startsWith('=')) return false;
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
   * Property 2: Non-Expression Invalid Characters Are Flagged
   *
   * For any local macro reference that does NOT start with `=` and contains
   * characters outside [A-Za-z0-9_] (excluding stored results, nested macros,
   * and unbalanced macros), the Analyzer SHALL produce an "Invalid character
   * in macro name" diagnostic.
   *
   * Feature: expression-macro-false-positive, Property 2: Non-Expression Invalid Characters Are Flagged
   * Validates: Requirements 2.1, 2.2, 2.3
   */
  it('should flag non-expression macros with invalid characters', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_invalid_non_expression_macro_name(), async (my_invalid_name) => {
        // Create a local macro reference with invalid characters: `foo.bar'
        const my_invalid_ref = `\`${my_invalid_name}'`;
        const my_document = `display ${my_invalid_ref}`;

        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for INVALID_MACRO_CHAR diagnostics
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

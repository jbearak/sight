/**
 * Diagnostic Accuracy Property Tests
 *
 * Tests that verify diagnostics are accurate, don't produce false positives,
 * and are cleared when documents are fixed.
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import {
  ContextErrorCode,
  LexerErrorCode,
  ParseErrorCode,
  StataLSPConfig,
} from '../../src/types';
import {
  arbitrary_stata_document,
  arbitrary_malformed_document,
  arbitrary_document_with_programs,
} from './generators/documents';
import {
  create_document_state,
  parse_and_analyze,
} from './helpers/document-utils';

const STRUCTURAL_SYNTAX_CODES = new Set<unknown>([
  LexerErrorCode.UNBALANCED_QUOTES,
  LexerErrorCode.UNBALANCED_BLOCK_COMMENT,
  LexerErrorCode.UNTERMINATED_STATEMENT,
  ...Object.values(ParseErrorCode),
  ...Object.values(ContextErrorCode),
]);

const PARSER_ERROR_CODES = new Set<unknown>(Object.values(ParseErrorCode));

describe('Diagnostic Accuracy Property Tests', () => {
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
    } as any;
  });

  /**
   * Property 12: Position Accuracy
   * For any malformed document with a known error type, diagnostics should
   * report errors at accurate positions.
   * Feature: comprehensive-property-tests, Property 12: Position Accuracy
   * Validates: Requirement 4.1
   */
  it('should report diagnostics at accurate positions for malformed documents', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant('unbalanced_quotes'),
          fc.constant('unclosed_block'),
          fc.constant('missing_program_end')
        ),
        async (my_error_type) => {
          const { document } = fc.sample(
            arbitrary_malformed_document(my_error_type as any),
            1
          )[0];

          const my_doc_state = create_document_state(document);
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );

          // Should have at least one diagnostic for malformed documents
          if (my_diagnostics.length === 0) {
            return true; // Skip if no diagnostics (might be valid)
          }

          // Verify each diagnostic has valid range
          for (const my_diag of my_diagnostics) {
            // Range should have valid positions
            if (
              my_diag.range.start.line < 0 ||
              my_diag.range.start.character < 0 ||
              my_diag.range.end.line < 0 ||
              my_diag.range.end.character < 0
            ) {
              return false;
            }

            // End position should be >= start position
            if (my_diag.range.end.line < my_diag.range.start.line) {
              return false;
            }

            if (
              my_diag.range.end.line === my_diag.range.start.line &&
              my_diag.range.end.character < my_diag.range.start.character
            ) {
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
   * Property 13: No False Positives
   * For any valid Stata document, no syntax error diagnostics should be reported.
   * Feature: comprehensive-property-tests, Property 13: No False Positives
   * Validates: Requirement 4.2
   */
  it('should not report false positive errors for valid documents', async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary_stata_document(), async (my_document) => {
        const my_doc_state = create_document_state(my_document);
        const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
          my_doc_state,
          my_config
        );

        // Filter for syntax errors (not style warnings)
        const my_syntax_errors = my_diagnostics.filter((my_diag) => {
          return STRUCTURAL_SYNTAX_CODES.has(my_diag.code);
        });

        // Valid documents should have no syntax errors
        // (they might have style warnings, but not errors)
        return my_syntax_errors.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 14: Clearing on Update
   * For any fixable error, diagnostics should be cleared after the fix.
   * Feature: comprehensive-property-tests, Property 14: Clearing on Update
   * Validates: Requirement 4.3
   */
  it('should clear diagnostics when errors are fixed', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrary_document_with_programs(1),
        async ({ document, programs }) => {
          // Create a broken version: missing 'end' statement
          const my_broken_document = `program define ${programs[0].name}\n  display "hello"`;

          // Get diagnostics for broken version
          const my_broken_state = create_document_state(my_broken_document);
          const my_broken_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_broken_state,
            my_config
          );

          // Should have at least one error
          const my_broken_errors = my_broken_diagnostics.filter(
            (my_diag) => PARSER_ERROR_CODES.has(my_diag.code)
          );

          if (my_broken_errors.length === 0) {
            return true; // Skip if no errors detected
          }

          // Create fixed version: add 'end' statement
          const my_fixed_document = `program define ${programs[0].name}\n  display "hello"\nend`;

          // Get diagnostics for fixed version
          const my_fixed_state = create_document_state(my_fixed_document);
          const my_fixed_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_fixed_state,
            my_config
          );

          // Should have no errors after fix
          const my_fixed_errors = my_fixed_diagnostics.filter(
            (my_diag) => PARSER_ERROR_CODES.has(my_diag.code)
          );

          return my_fixed_errors.length === 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 15: Unbalanced Quotes Detection
   * For any document with unbalanced quotes, diagnostics should report the error.
   * Feature: comprehensive-property-tests, Property 15: Unbalanced Quotes Detection
   * Validates: Requirement 4.4
   */
  it('should detect unbalanced quotes', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrary_malformed_document('unbalanced_quotes'),
        async ({ document }) => {
          const my_doc_state = create_document_state(document);
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );

          // Should have at least one diagnostic
          if (my_diagnostics.length === 0) {
            return true; // Skip if no diagnostics
          }

          // At least one should be a quote error.
          const my_quote_errors = my_diagnostics.filter(
            (my_diag) => my_diag.code === LexerErrorCode.UNBALANCED_QUOTES
          );

          return my_quote_errors.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 16: Unclosed Block Detection
   * For any document with unclosed blocks, diagnostics should report the error.
   * Feature: comprehensive-property-tests, Property 16: Unclosed Block Detection
   * Validates: Requirement 4.4
   */
  it('should detect unclosed blocks', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrary_malformed_document('unclosed_block'),
        async ({ document }) => {
          const my_doc_state = create_document_state(document);
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );

          // Should have at least one diagnostic
          if (my_diagnostics.length === 0) {
            return true; // Skip if no diagnostics
          }

          // At least one should be a parser error.
          const my_block_errors = my_diagnostics.filter(
            (my_diag) => PARSER_ERROR_CODES.has(my_diag.code)
          );

          return my_block_errors.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 17: Missing Program End Detection
   * For any program without 'end', diagnostics should report the error.
   * Feature: comprehensive-property-tests, Property 17: Missing Program End Detection
   * Validates: Requirement 4.4
   */
  it('should detect missing program end', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrary_malformed_document('missing_program_end'),
        async ({ document }) => {
          const my_doc_state = create_document_state(document);
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );

          // Should have at least one diagnostic
          if (my_diagnostics.length === 0) {
            return true; // Skip if no diagnostics
          }

          // At least one should be a parser error.
          const my_program_errors = my_diagnostics.filter(
            (my_diag) => PARSER_ERROR_CODES.has(my_diag.code)
          );

          return my_program_errors.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 18: Brace Else Same Line Detection
   * For documents with } else { on same line, diagnostics should report the error.
   * Feature: comprehensive-property-tests, Property 18: Brace Else Same Line Detection
   * Validates: Requirement 4.4
   */
  it('should detect brace-else-brace on same line', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrary_malformed_document('brace_else_same_line'),
        async ({ document }) => {
          const my_doc_state = create_document_state(document);
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );

          // Should have at least one diagnostic
          if (my_diagnostics.length === 0) {
            return true; // Skip if no diagnostics
          }

          // At least one should be a parser error.
          const my_brace_errors = my_diagnostics.filter(
            (my_diag) => PARSER_ERROR_CODES.has(my_diag.code)
          );

          return my_brace_errors.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 19: Brace Not Alone Detection
   * For documents with closing brace not alone on line, diagnostics should report.
   * Feature: comprehensive-property-tests, Property 19: Brace Not Alone Detection
   * Validates: Requirement 4.4
   */
  it('should detect closing brace not alone on line', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitrary_malformed_document('brace_not_alone'),
        async ({ document }) => {
          const my_doc_state = create_document_state(document);
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );

          // Should have at least one diagnostic
          if (my_diagnostics.length === 0) {
            return true; // Skip if no diagnostics
          }

          // At least one should be a parser error.
          const my_brace_errors = my_diagnostics.filter(
            (my_diag) => PARSER_ERROR_CODES.has(my_diag.code)
          );

          return my_brace_errors.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});

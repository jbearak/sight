/**
 * Invalid Macro Character Detection Unit Tests
 *
 * Tests that verify specific invalid character examples produce
 * INVALID_MACRO_CHAR diagnostics.
 *
 * Feature: nested-macro-invalid-char-false-positive
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig, StataDiagnosticCode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';

describe('Invalid Macro Character Detection Unit Tests', () => {
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
          missing_file: 'warning',
          max_depth: 'warning',
        },
      },
    } as StataLSPConfig;
  });

  describe('Local macro references with invalid characters', () => {
    /**
     * Test `foo.bar' produces diagnostic
     * Validates: Requirements 3.2
     */
    test('should flag `foo.bar\' as invalid macro character', async () => {
      const my_document = 'display `foo.bar\'';

      const my_doc_state = create_document_state(my_document);
      const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
        my_doc_state,
        my_config
      );

      // Filter for INVALID_MACRO_CHAR diagnostics
      const my_invalid_char_diagnostics = my_diagnostics.filter(
        (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
      );

      expect(my_invalid_char_diagnostics.length).toBeGreaterThan(0);
      expect(my_invalid_char_diagnostics[0].message).toBe('Invalid character in macro name');
    });

    /**
     * Test `my var' produces diagnostic
     * Validates: Requirements 3.3
     */
    test('should flag `my var\' as invalid macro character', async () => {
      const my_document = 'display `my var\'';

      const my_doc_state = create_document_state(my_document);
      const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
        my_doc_state,
        my_config
      );

      // Filter for INVALID_MACRO_CHAR diagnostics
      const my_invalid_char_diagnostics = my_diagnostics.filter(
        (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
      );

      expect(my_invalid_char_diagnostics.length).toBeGreaterThan(0);
      expect(my_invalid_char_diagnostics[0].message).toBe('Invalid character in macro name');
    });
  });

  describe('Braced global macro references with invalid characters', () => {
    /**
     * Test ${foo.bar} produces diagnostic
     * Validates: Requirements 3.4
     */
    test('should flag ${foo.bar} as invalid macro character', async () => {
      const my_document = 'display ${foo.bar}';

      const my_doc_state = create_document_state(my_document);
      const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
        my_doc_state,
        my_config
      );

      // Filter for INVALID_MACRO_CHAR diagnostics
      const my_invalid_char_diagnostics = my_diagnostics.filter(
        (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
      );

      expect(my_invalid_char_diagnostics.length).toBeGreaterThan(0);
      expect(my_invalid_char_diagnostics[0].message).toBe('Invalid character in macro name');
    });

    /**
     * Test ${my var} produces diagnostic
     * Validates: Requirements 3.5
     */
    test('should flag ${my var} as invalid macro character', async () => {
      const my_document = 'display ${my var}';

      const my_doc_state = create_document_state(my_document);
      const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
        my_doc_state,
        my_config
      );

      // Filter for INVALID_MACRO_CHAR diagnostics
      const my_invalid_char_diagnostics = my_diagnostics.filter(
        (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
      );

      expect(my_invalid_char_diagnostics.length).toBeGreaterThan(0);
      expect(my_invalid_char_diagnostics[0].message).toBe('Invalid character in macro name');
    });
  });

  describe('Nested macros should NOT produce invalid character diagnostics', () => {
    /**
     * Regression test: nested local macros should not be flagged
     */
    test('should NOT flag `one`two\'\' as invalid macro character', async () => {
      const my_document = 'display `one`two\'\'';

      const my_doc_state = create_document_state(my_document);
      const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
        my_doc_state,
        my_config
      );

      // Filter for INVALID_MACRO_CHAR diagnostics
      const my_invalid_char_diagnostics = my_diagnostics.filter(
        (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
      );

      expect(my_invalid_char_diagnostics.length).toBe(0);
    });

    /**
     * Regression test: nested braced globals should not be flagged
     */
    test('should NOT flag ${one${two}} as invalid macro character', async () => {
      const my_document = 'display ${one${two}}';

      const my_doc_state = create_document_state(my_document);
      const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
        my_doc_state,
        my_config
      );

      // Filter for INVALID_MACRO_CHAR diagnostics
      const my_invalid_char_diagnostics = my_diagnostics.filter(
        (my_diag) => my_diag.code === StataDiagnosticCode.INVALID_MACRO_CHAR
      );

      expect(my_invalid_char_diagnostics.length).toBe(0);
    });
  });
});

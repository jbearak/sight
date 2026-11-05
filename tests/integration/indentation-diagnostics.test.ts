import { describe, test, expect } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { Connection } from 'vscode-languageserver';
import { create_real_document_state } from '../test-context-helper';

describe('Indentation Diagnostics Integration', () => {
  test('should detect unnecessary indentation after comment', async () => {
    const content = `* This is a comment
    display "unnecessarily indented"`;
    
    const document = create_real_document_state(content);

    const config: StataLSPConfig = {
      ...DEFAULT_SETTINGS,
      diagnostics: {
        ...DEFAULT_SETTINGS.diagnostics,
        enabled: true,
        indentation: true,
      },
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    await expect(diagnostics).resolves.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.UNNECESSARY_INDENTATION,
        range: expect.objectContaining({
          start: expect.objectContaining({ line: 1 })
        }),
        message: expect.stringContaining('unnecessarily indented')
      })
    );
  });

  test('should detect missing indentation inside brace block', async () => {
    const content = `if condition {
display "should be indented"
}`;
    
    const document = create_real_document_state(content);

    const config: StataLSPConfig = {
      ...DEFAULT_SETTINGS,
      diagnostics: {
        ...DEFAULT_SETTINGS.diagnostics,
        enabled: true,
        indentation: true,
      },
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    await expect(diagnostics).resolves.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.MISSING_INDENTATION,
        range: expect.objectContaining({
          start: expect.objectContaining({ line: 1 })
        }),
        message: expect.stringContaining('under-indented')
      })
    );
  });

  test('should not emit indentation diagnostics when disabled', async () => {
    const content = `* This is a comment
    display "unnecessarily indented"`;
    
    const document = create_real_document_state(content);

    const config: StataLSPConfig = {
      ...DEFAULT_SETTINGS,
      diagnostics: {
        ...DEFAULT_SETTINGS.diagnostics,
        enabled: true,
        indentation: false, // Disabled
      },
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    await expect(diagnostics).resolves.not.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.UNNECESSARY_INDENTATION
      })
    );
  });

  /**
   * Regression test for block comment indentation false positive.
   * When a line inside a block comment doesn't start with '*', the analyzer
   * should NOT flag it as "unnecessarily indented after comment".
   * Requirements: 1.1, 1.3
   */
  test('should not emit diagnostics for lines inside block comments', async () => {
    // This is the reproduction case: a block comment where some lines
    // don't start with '*' - these should NOT trigger false positives
    const content = `/*
* This line starts with asterisk
This line does NOT start with asterisk
    This line is indented but inside block comment
*/
display "code after block comment"`;
    
    const document = create_real_document_state(content);

    const config: StataLSPConfig = {
      ...DEFAULT_SETTINGS,
      diagnostics: {
        ...DEFAULT_SETTINGS.diagnostics,
        enabled: true,
        indentation: true,
      },
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    // Should NOT produce any indentation diagnostics for lines inside block comment
    await expect(diagnostics).resolves.not.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.UNNECESSARY_INDENTATION
      })
    );
    await expect(diagnostics).resolves.not.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.MISSING_INDENTATION
      })
    );
  });

  /**
   * Test that block comment with varying indentation doesn't trigger diagnostics.
   * Requirements: 1.1, 1.2, 1.3
   */
  test('should not emit diagnostics for block comment with varying indentation', async () => {
    const content = `/* Start of block comment
    Indented line inside block comment
        More indented line
No indentation line
*/`;
    
    const document = create_real_document_state(content);

    const config: StataLSPConfig = {
      ...DEFAULT_SETTINGS,
      diagnostics: {
        ...DEFAULT_SETTINGS.diagnostics,
        enabled: true,
        indentation: true,
      },
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    // Should NOT produce any indentation diagnostics for lines inside block comment
    await expect(diagnostics).resolves.not.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.UNNECESSARY_INDENTATION
      })
    );
    await expect(diagnostics).resolves.not.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.MISSING_INDENTATION
      })
    );
  });
});

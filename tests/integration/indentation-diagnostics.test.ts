import { describe, test, expect } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentState } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { Connection } from 'vscode-languageserver';

describe('Indentation Diagnostics Integration', () => {
  test('should detect unnecessary indentation after comment', () => {
    const content = `* This is a comment
    display "unnecessarily indented"`;
    
    const document: DocumentState = {
      uri: 'file:///test.do',
      version: 1,
      content,
      tokens: [],
      ast: null,
      symbols: { localMacros: new Map(), globalMacros: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Set() },
      diagnostics: [],
      context_tracker: new ContextTracker(),
      line_offsets: [0, content.indexOf('\n') + 1]
    };

    const config: StataLSPConfig = {
      diagnostics: {
        enabled: true,
        indentation: true,
        severity: {
          undefinedMacro: 'warning',
          undefinedVariable: 'information',
          styleWarnings: 'hint'
        },
        undefinedVariableEnabled: false
      },
      adoPaths: [],
      cross_file: {}
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    expect(diagnostics).resolves.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.UNNECESSARY_INDENTATION,
        message: expect.stringContaining('unnecessarily indented')
      })
    );
  });

  test('should detect missing indentation inside brace block', () => {
    const content = `if condition {
display "should be indented"
}`;
    
    const document: DocumentState = {
      uri: 'file:///test.do',
      version: 1,
      content,
      tokens: [],
      ast: null,
      symbols: { localMacros: new Map(), globalMacros: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Set() },
      diagnostics: [],
      context_tracker: new ContextTracker(),
      line_offsets: [0, content.indexOf('\n') + 1, content.lastIndexOf('\n') + 1]
    };

    const config: StataLSPConfig = {
      diagnostics: {
        enabled: true,
        indentation: true,
        severity: {
          undefinedMacro: 'warning',
          undefinedVariable: 'information',
          styleWarnings: 'hint'
        },
        undefinedVariableEnabled: false
      },
      adoPaths: [],
      cross_file: {}
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    expect(diagnostics).resolves.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.MISSING_INDENTATION,
        message: expect.stringContaining('should be indented')
      })
    );
  });

  test('should not emit indentation diagnostics when disabled', () => {
    const content = `* This is a comment
    display "unnecessarily indented"`;
    
    const document: DocumentState = {
      uri: 'file:///test.do',
      version: 1,
      content,
      tokens: [],
      ast: null,
      symbols: { localMacros: new Map(), globalMacros: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Set() },
      diagnostics: [],
      context_tracker: new ContextTracker(),
      line_offsets: [0, content.indexOf('\n') + 1]
    };

    const config: StataLSPConfig = {
      diagnostics: {
        enabled: true,
        indentation: false, // Disabled
        severity: {
          undefinedMacro: 'warning',
          undefinedVariable: 'information',
          styleWarnings: 'hint'
        },
        undefinedVariableEnabled: false
      },
      adoPaths: [],
      cross_file: {}
    };

    const mockConnection = {} as Connection;
    const provider = new DiagnosticsProvider(mockConnection);
    
    const diagnostics = provider.get_diagnostics(document, config);
    
    expect(diagnostics).resolves.not.toContainEqual(
      expect.objectContaining({
        code: StataDiagnosticCode.UNNECESSARY_INDENTATION
      })
    );
  });
});

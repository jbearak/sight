import { describe, test, expect } from 'bun:test';
import { IndentationDiagnosticAnalyzer } from '../src/providers/indentation-diagnostics';
import { DocumentState } from '../src/document-store';
import { ContextTracker } from '../src/context-tracker';
import { StataDiagnosticCode, StataLSPConfig } from '../src/types';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';

/**
 * Regression test for false positive UNNECESSARY_INDENTATION diagnostic
 * on continuation lines inside a block.
 * 
 * Bug: When a statement inside a block has continuation lines (///),
 * the continuation lines are flagged as unnecessarily indented even though
 * they should be skipped from the check.
 */
describe('Continuation Line False Positive - UNNECESSARY_INDENTATION', () => {
  const create_document = (content: string): DocumentState => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const lex_result = lexer.tokenize(content);
    const parse_result = parser.parse(lex_result.tokens);
    return {
      uri: 'file:///test.do',
      version: 1,
      content,
      tokens: lex_result.tokens,
      ast: parse_result.ast,
      symbols: { localMacros: new Map(), globalMacros: new Map(), programs: new Map(), scalars: new Map(), matrices: new Map(), variables: new Map() },
      diagnostics: [],
      context_tracker: new ContextTracker(),
      line_offsets: []
    };
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

  test('should NOT flag continuation lines inside block as unnecessarily indented (spaces)', () => {
    // This is the exact pattern from the user's file but with spaces
    const content = `if survey_year == 2009 {
    replace marital_status = 0 if p9_1 == 8  // never married
    replace marital_status = 1 if p9_1 == 1 | p9_1 == 7 // currently married
    replace marital_status = 2 if (p9_1 == 0 | p9_1 == 2 | ///
                                   p9_1 == 3 | p9_1 == 4 | ///
                                   p9_1 == 5 | p9_1 == 6)
}`;

    const analyzer = new IndentationDiagnosticAnalyzer();
    const doc = create_document(content);
    const diagnostics = analyzer.analyze(doc, config);

    // Lines 4 and 5 (0-indexed) are continuation lines - should NOT be flagged
    const continuation_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
           (d.range.start.line === 4 || d.range.start.line === 5)
    );

    expect(continuation_diagnostics).toHaveLength(0);
  });

  test('should NOT flag continuation lines inside block as unnecessarily indented (TABS)', () => {
    // This is the EXACT content from the user's file with TABS
    // The user's file uses tabs for indentation
    const content = `if survey_year == 2009 {
\treplace marital_status = 0 if p9_1 == 8  // never married
\treplace marital_status = 1 if p9_1 == 1 | p9_1 == 7 // currently married
\treplace marital_status = 2 if (p9_1 == 0 | p9_1 == 2 | /// Formerly married
\t\t\t\t\t\t\t\t   p9_1 == 3 | p9_1 == 4 | ///
\t\t\t\t\t\t\t\t\t   p9_1 == 5 | p9_1 == 6)
}`;

    const analyzer = new IndentationDiagnosticAnalyzer();
    const doc = create_document(content);
    const diagnostics = analyzer.analyze(doc, config);



    // Lines 4 and 5 (0-indexed) are continuation lines - should NOT be flagged
    const continuation_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
           (d.range.start.line === 4 || d.range.start.line === 5)
    );

    expect(continuation_diagnostics).toHaveLength(0);
  });

  test('should NOT flag any continuation line as unnecessarily indented', () => {
    // Simpler case with just one continuation
    const content = `if x == 1 {
    gen y = a + b + ///
            c + d
}`;

    const analyzer = new IndentationDiagnosticAnalyzer();
    const doc = create_document(content);
    const diagnostics = analyzer.analyze(doc, config);

    // Line 2 (0-indexed) is a continuation line - should NOT be flagged
    const continuation_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
           d.range.start.line === 2
    );

    expect(continuation_diagnostics).toHaveLength(0);
  });
});

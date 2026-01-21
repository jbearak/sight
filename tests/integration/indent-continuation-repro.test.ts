import { describe, test, expect } from 'bun:test';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { DocumentState } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

/**
 * Regression test for false positive indentation diagnostics when opening brace
 * is on a continuation line with different indentation than the statement body.
 * 
 * Bug: When an if statement spans multiple lines with /// continuation, and the
 * continuation line containing { has more indentation than the body lines,
 * the diagnostic incorrectly flagged the body lines as needing indentation.
 * 
 * Fix: Trace back through continuation lines to find the original statement's
 * indentation when determining the expected indentation for block contents.
 */
describe('Indentation Diagnostics - Continuation Line Regression', () => {
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
    },
    adoPaths: [],
    cross_file: {}
  };

  test('should use original statement indentation when brace is on indented continuation line', () => {
    // The continuation line with { has 16 spaces, but body lines have 4 spaces
    // Should NOT flag body lines since they're indented relative to the original if (indent=0)
    const content = `if ("\`country_name'" == "Moldova" & "\`survey_year'" == "2005" | ///
                "\`country_name'" == "Rwanda" & "\`survey_year'" == "2008" ) {
    replace using_emerg_contraception = 0 if v307_17 == 0   //
    replace using_emerg_contraception = 1 if v307_17 == 1   //
    replace using_emerg_contraception = . if v307_17 == .
    label values using_emerg_contraception using_emerg_contraception
}`;

    const analyzer = new IndentationDiagnosticAnalyzer();
    const diagnostics = analyzer.analyze(create_document(content), config);

    const missing_indent_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.MISSING_INDENTATION
    );
    
    expect(missing_indent_diagnostics).toHaveLength(0);
  });

  test('should still detect missing indentation when body is not indented', () => {
    // Body lines have 0 indentation - should be flagged
    const content = `if ("\`country_name'" == "Moldova") {
replace x = 1
}`;

    const analyzer = new IndentationDiagnosticAnalyzer();
    const diagnostics = analyzer.analyze(create_document(content), config);

    const missing_indent_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.MISSING_INDENTATION
    );
    
    expect(missing_indent_diagnostics).toHaveLength(1);
  });

  test('should handle multiple continuation lines before brace', () => {
    // Multiple /// continuations before the {
    const content = `if ("\`a'" == "1" | ///
    "\`b'" == "2" | ///
    "\`c'" == "3") {
    display "indented"
}`;

    const analyzer = new IndentationDiagnosticAnalyzer();
    const diagnostics = analyzer.analyze(create_document(content), config);

    const missing_indent_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.MISSING_INDENTATION
    );
    
    expect(missing_indent_diagnostics).toHaveLength(0);
  });

  test('should handle indented if statement with continuation', () => {
    // The if itself is indented, continuation has more indent, body matches if indent + 4
    const content = `    if ("\`a'" == "1" | ///
            "\`b'" == "2") {
        display "indented"
    }`;

    const analyzer = new IndentationDiagnosticAnalyzer();
    const diagnostics = analyzer.analyze(create_document(content), config);

    const missing_indent_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.MISSING_INDENTATION
    );
    
    expect(missing_indent_diagnostics).toHaveLength(0);
  });
});

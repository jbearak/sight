import { describe, it, expect } from 'bun:test';
import { IndentationDiagnosticAnalyzer } from '../src/providers/indentation-diagnostics';
import { DocumentState } from '../src/document-store';
import { ContextTracker } from '../src/context-tracker';
import { StataDiagnosticCode, StataLSPConfig } from '../src/types';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';

describe('Capture Block Indentation - False Positive', () => {
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

  it('should NOT flag indented lines inside capture block as unnecessarily indented', () => {
    const content = `capture {
    confirm variable bh_cmc
    count if !missing(bh_cmc)
    assert r(N) > 0
}`;

    const doc = create_document(content);
    const analyzer = new IndentationDiagnosticAnalyzer();
    const diagnostics = analyzer.analyze(doc, config);

    console.log('Content lines:');
    content.split('\n').forEach((line, i) => {
      console.log(`  Line ${i}: "${line}"`);
    });

    console.log('\nDiagnostics:');
    for (const d of diagnostics) {
      console.log(`  Line ${d.range.start.line}: ${d.code} - ${d.message}`);
    }

    // Filter for UNNECESSARY_INDENTATION diagnostics
    const unnecessary_indentation_diagnostics = diagnostics.filter(
      d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
    );

    // Lines 1, 2, 3 are inside the capture block and should NOT be flagged
    for (const d of unnecessary_indentation_diagnostics) {
      const line_num = d.range.start.line;
      // Lines 1-3 are inside the block - they should NOT have unnecessary indentation warnings
      expect(line_num).not.toBe(1);
      expect(line_num).not.toBe(2);
      expect(line_num).not.toBe(3);
    }

    // There should be no unnecessary indentation diagnostics for this valid code
    expect(unnecessary_indentation_diagnostics.length).toBe(0);
  });
});

import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

describe('Undefined Macro Detection in Strings', () => {
  let lexer: StataLexer;
  let parser: StataParser;
  let analyzer: SemanticAnalyzer;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
    analyzer = new SemanticAnalyzer();
  });

  test('should detect undefined macros in simple quoted strings', () => {
    const source = `di "\`apple'"
local apple
di "\`apple'"
di "\`orange'"`;

    const lexResult = lexer.tokenize(source);
    expect(lexResult.errors).toHaveLength(0);

    // Debug logging is intentionally gated to avoid noisy CI output.
    if (process.env.SIGHT_TEST_LOG) {
      const macroTokens = lexResult.tokens.filter(t =>
        t.type === 'MACRO_REF_LOCAL' || t.type === 'MACRO_REF_GLOBAL'
      );
      console.log(
        'Macro tokens found:',
        macroTokens.map(t => ({
          type: t.type,
          value: t.value,
          line: t.range.start.line,
        }))
      );
    }

    const parseResult = parser.parse(lexResult.tokens);
    expect(parseResult.errors).toHaveLength(0);

    // Use correct analyze method signature with config parameter
    const analyzeResult = analyzer.analyze(
      parseResult.ast, 
      'test://file.do', 
      undefined, // workspace_symbols
      { undefined_macro_enabled: true }, // config
      lexResult.tokens // tokens
    );
    
    // Debug logging is intentionally gated to avoid noisy CI output.
    if (process.env.SIGHT_TEST_LOG) {
      console.log(
        'All diagnostics:',
        analyzeResult.diagnostics.map(d => ({
          message: d.message,
          line: d.range.start.line,
        }))
      );
    }
    
    // Should have 2 undefined macro diagnostics:
    // 1. `apple' on line 1 (used before definition)
    // 2. `orange' on line 4 (never defined)
    const undefinedMacroDiagnostics = analyzeResult.diagnostics.filter(
      d => d.message.includes('Undefined local macro')
    );
    
    expect(undefinedMacroDiagnostics).toHaveLength(2);
    
    // Check first diagnostic (apple used before definition)
    const appleDiagnostic = undefinedMacroDiagnostics.find(d => d.message.includes('apple'));
    expect(appleDiagnostic).toBeDefined();
    expect(appleDiagnostic?.range.start.line).toBe(0); // First line
    
    // Check second diagnostic (orange never defined)
    const orangeDiagnostic = undefinedMacroDiagnostics.find(d => d.message.includes('orange'));
    expect(orangeDiagnostic).toBeDefined();
    expect(orangeDiagnostic?.range.start.line).toBe(3); // Fourth line
  });

  test('should detect undefined global macros in simple quoted strings', () => {
    const source = `di "$undefined_global"`;

    const lexResult = lexer.tokenize(source);
    expect(lexResult.errors).toHaveLength(0);

    const parseResult = parser.parse(lexResult.tokens);
    expect(parseResult.errors).toHaveLength(0);

    const analyzeResult = analyzer.analyze(
      parseResult.ast, 
      'test://file.do', 
      undefined, // workspace_symbols
      { undefined_macro_enabled: true }, // config
      lexResult.tokens // tokens
    );
    
    const undefinedMacroDiagnostics = analyzeResult.diagnostics.filter(
      d => d.message.includes('Undefined global macro')
    );
    
    expect(undefinedMacroDiagnostics).toHaveLength(1);
    expect(undefinedMacroDiagnostics[0].message).toContain('undefined_global');
  });
});

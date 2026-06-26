import fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { SyntaxNode, StataDiagnosticCode } from '../../src/types';

describe('Feature: namelist-argument-type', () => {
  let lexer: StataLexer;
  let parser: StataParser;
  let analyzer: SemanticAnalyzer;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
    analyzer = new SemanticAnalyzer();
  });

  test('Property 1: Namelist Argument Parsing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'syntax namelist',
          'syntax namelist(min=1)',
          'syntax namelist(max=5)',
          'syntax namelist(min=1 max=3)',
          'syntax [namelist]',
          'syntax [namelist(min=1)]'
        ),
        (syntaxLine) => {
          const code = `program define test\n${syntaxLine}\nend`;
          const tokens = lexer.tokenize(code).tokens;
          const result = parser.parse(tokens);
          
          const programNode = result.ast.nodes.find(n => n.type === 'program');
          expect(programNode).toBeDefined();
          
          if (programNode?.type === 'program') {
            const syntaxNode = programNode.body.find(n => n.type === 'syntax') as SyntaxNode | undefined;
            expect(syntaxNode).toBeDefined();
            
            const namelistArg = syntaxNode!.signature.arguments.find(arg => arg.type === 'namelist');
            expect(namelistArg).toBeDefined();
            expect(namelistArg!.type).toBe('namelist');
            expect(namelistArg!.isOptional).toBe(syntaxLine.includes('['));
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 2: Implicit Local Registration', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'syntax namelist',
          'syntax namelist(min=1)',
          'syntax [namelist]'
        ),
        (syntaxLine) => {
          const code = `program define test\n${syntaxLine}\nend`;
          const tokens = lexer.tokenize(code).tokens;
          const result = parser.parse(tokens);
          const analysis = analyzer.analyze(result.ast, 'test://file.do', undefined, undefined, tokens);
          
          const namelistLocal = analysis.symbols.localMacros.get('namelist');
          expect(namelistLocal).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 3: Diagnostic Suppression', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'syntax namelist\ndisplay "`namelist\'"',
          'syntax namelist(min=1)\nforeach var of local namelist {\n}',
          'syntax [namelist]\nif "`namelist\'" != "" {\n}'
        ),
        (codeBody) => {
          const code = `program define test\n${codeBody}\nend`;
          const tokens = lexer.tokenize(code).tokens;
          const result = parser.parse(tokens);
          const analysis = analyzer.analyze(result.ast, 'test://file.do', undefined, { undefined_macro_enabled: true }, tokens);
          
          const namelistDiagnostics = analysis.diagnostics.filter(d =>
            d.code === StataDiagnosticCode.UNDEFINED_MACRO
            && d.symbol_name === 'namelist'
          );
          expect(namelistDiagnostics).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
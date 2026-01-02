import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';

describe('Feature: syntax-command-simplification, Property 1: No Syntax Command Diagnostics', () => {
  const argTypeArb = fc.oneof(
    fc.constant('varlist'),
    fc.constant('varname'),
    fc.constant('namelist'),
    fc.constant('anything'),
    fc.constant('string'),
    fc.constant('integer'),
    fc.constant('real'),
    fc.constant('numlist')
  );

  const optionArb = fc.record({
    name: fc.stringOf(fc.char().filter(c => /[a-zA-Z_]/.test(c)), { minLength: 1, maxLength: 8 }),
    hasArg: fc.boolean(),
    argType: fc.option(argTypeArb)
  });

  const syntaxCommandArb = fc.record({
    inProgram: fc.boolean(),
    programName: fc.stringOf(fc.char().filter(c => /[a-zA-Z_]/.test(c)), { minLength: 1, maxLength: 8 }),
    args: fc.array(argTypeArb, { maxLength: 3 }),
    options: fc.array(optionArb, { maxLength: 5 })
  });

  const generateSyntaxCommand = (spec: any): string => {
    const { inProgram, programName, args, options } = spec;
    
    let code = '';
    
    if (inProgram) {
      code += `program define ${programName}\n`;
    }
    
    code += 'syntax';
    
    if (args.length > 0) {
      code += ' ' + args.join(' ');
    }
    
    if (options.length > 0) {
      const optStrs = options.map((opt: any) => {
        let str = opt.name;
        if (opt.hasArg && opt.argType) {
          str += `(${opt.argType})`;
        }
        return str;
      });
      code += ' [, ' + optStrs.join(' ') + ']';
    }
    
    code += '\n';
    
    if (inProgram) {
      code += 'end\n';
    }
    
    return code;
  };

  it('should emit zero diagnostics for any valid syntax command', () => {
    fc.assert(
      fc.property(syntaxCommandArb, (spec) => {
        const code = generateSyntaxCommand(spec);
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();
        
        const lexResult = lexer.tokenize(code);
        const parseResult = parser.parse(lexResult.tokens);
        const analysis = analyzer.analyze(parseResult.ast, lexResult.tokens);
        
        expect(analysis.diagnostics).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
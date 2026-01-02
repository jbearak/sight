import { describe, it, expect, beforeEach } from 'bun:test';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

describe('Program Drop Bug Fix', () => {
  let parser: StataParser;
  let lexer: StataLexer;

  beforeEach(() => {
    parser = new StataParser();
    lexer = new StataLexer();
  });

  function parseCode(source: string) {
    const lexResult = lexer.tokenize(source);
    return parser.parse(lexResult.tokens);
  }

  it('should parse "program drop" as a command, not a program definition', () => {
    const source = 'program drop _aww_datasig';
    const result = parseCode(source);
    
    expect(result.errors).toHaveLength(0);
    expect(result.ast.nodes).toHaveLength(1);
    expect(result.ast.nodes[0].type).toBe('command');
    expect((result.ast.nodes[0] as any).name).toBe('program');
  });

  it('should parse "capture program drop" as a prefixed command', () => {
    const source = 'capture program drop _aww_datasig';
    const result = parseCode(source);
    
    expect(result.errors).toHaveLength(0);
    expect(result.ast.nodes).toHaveLength(1);
    expect(result.ast.nodes[0].type).toBe('command');
    expect((result.ast.nodes[0] as any).name).toBe('program');
    expect((result.ast.nodes[0] as any).prefix).toBeDefined();
  });

  it('should still parse "program define" as a program definition', () => {
    const source = `program define test_prog
end`;
    const result = parseCode(source);
    
    expect(result.errors).toHaveLength(0);
    expect(result.ast.nodes).toHaveLength(1);
    expect(result.ast.nodes[0].type).toBe('program');
    expect((result.ast.nodes[0] as any).name).toBe('test_prog');
  });

  it('should parse program drop followed by program define', () => {
    const source = `capture program drop _aww_datasig
program define _aww_datasig
    syntax , survey(string) program(string) file(string)
end`;
    
    const result = parseCode(source);
    
    expect(result.errors).toHaveLength(0);
    expect(result.ast.nodes).toHaveLength(2);
    expect(result.ast.nodes[0].type).toBe('command'); // program drop
    expect(result.ast.nodes[1].type).toBe('program'); // program define
  });
});

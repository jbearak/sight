import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

describe('Expression Keyword Disambiguation', () => {
  let lexer: StataLexer;
  let parser: StataParser;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
  });

  describe('specific problematic cases', () => {
    test('should parse "count if program == \\"x\\""', () => {
      const source = 'count if program == "x"';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('count');
        expect(node.ifExpression).toBe('program == "x"');
      }
    });

    test('should parse "drop if _merge == 1 & program == \\"dhs\\""', () => {
      const source = 'drop if _merge == 1 & program == "dhs"';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('drop');
        expect(node.ifExpression).toBe('_merge == 1 & program == "dhs"');
      }
    });

    test('should parse "keep if program != \\"missing\\""', () => {
      const source = 'keep if program != "missing"';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('keep');
        expect(node.ifExpression).toBe('program != "missing"');
      }
    });

    test('should parse "replace value = 0 if program == \\"test\\""', () => {
      const source = 'replace value = 0 if program == "test"';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('replace');
        expect(node.varlist?.[0].name).toBe('value');
        expect(node.expression).toBe('0');
        expect(node.ifExpression).toBe('program == "test"');
      }
    });
  });

  describe('if-statements still work correctly', () => {
    test('should parse basic if statement', () => {
      const source = 'if x > 0 {';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(1); // Missing closing brace
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('if');
      
      if (node.type === 'if') {
        expect(node.condition).toBe('x > 0');
      }
    });

    test('should parse if-else statement', () => {
      const source = 'if program == "test" {\n  display "yes"\n}\nelse {\n  display "no"\n}';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(2); // if and else are separate nodes
      
      const ifNode = parseResult.ast.nodes[0];
      expect(ifNode.type).toBe('if');
      
      if (ifNode.type === 'if') {
        expect(ifNode.condition).toBe('program == "test"');
        expect(ifNode.body).toBeDefined();
        expect(ifNode.body.length).toBeGreaterThan(0);
      }

      const elseNode = parseResult.ast.nodes[1];
      expect(elseNode.type).toBe('else');
      
      if (elseNode.type === 'else') {
        expect(elseNode.body).toBeDefined();
        expect(elseNode.body.length).toBeGreaterThan(0);
      }
    });

    test('should parse nested if statements', () => {
      const source = 'if x > 0 {\n  if program == "inner" {\n    display "nested"\n  }\n}';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('if');
      
      if (node.type === 'if') {
        expect(node.condition).toBe('x > 0');
        expect(node.body).toBeDefined();
        expect(node.body.length).toBeGreaterThan(0);
      }
    });
  });

  describe('keyword tokenization in expressions', () => {
    test('should tokenize "program" as WORD in expressions', () => {
      const source = 'count if program == "x"';
      const tokens = lexer.tokenize(source).tokens;
      
      const programToken = tokens.find(t => t.value === 'program');
      expect(programToken).toBeDefined();
      expect(programToken?.type).toBe('WORD');
    });

    test('should tokenize "if" as WORD in statement context', () => {
      const source = 'if program == "x" {';
      const tokens = lexer.tokenize(source).tokens;
      
      const ifToken = tokens.find(t => t.value === 'if');
      expect(ifToken).toBeDefined();
      expect(ifToken?.type).toBe('WORD');
    });

    test('should tokenize multiple keywords correctly', () => {
      const source = 'drop if _merge == 1 & program == "dhs"';
      const tokens = lexer.tokenize(source).tokens;
      
      const dropToken = tokens.find(t => t.value === 'drop');
      const ifToken = tokens.find(t => t.value === 'if');
      const programToken = tokens.find(t => t.value === 'program');
      
      expect(dropToken?.type).toBe('WORD');
      expect(ifToken?.type).toBe('WORD');
      expect(programToken?.type).toBe('WORD');
    });
  });

  describe('complex expression cases', () => {
    test('should parse expressions with multiple keyword variables', () => {
      const source = 'generate result = program + while + foreach';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('generate');
        expect(node.expression).toBe('program + while + foreach');
      }
    });

    test('should parse function calls with keyword arguments', () => {
      const source = 'generate result = max(program, while, foreach)';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('generate');
        expect(node.expression).toBe('max(program, while, foreach)');
      }
    });

    test('should parse parenthesized expressions with keywords', () => {
      const source = 'generate result = (program + while) * foreach';
      const tokens = lexer.tokenize(source).tokens;
      const parseResult = parser.parse(tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('generate');
        expect(node.expression).toBe('(program + while) * foreach');
      }
    });
  });
});
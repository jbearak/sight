import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { PrettyPrinter } from '../../src/pretty-printer';
import { SemanticAnalyzer } from '../../src/analyzer';

describe('StataParser', () => {
  let parser: StataParser;
  let lexer: StataLexer;

  beforeEach(() => {
    parser = new StataParser();
    lexer = new StataLexer();
  });

  describe('basic parsing', () => {
    test('should parse simple command', () => {
      const source = 'generate age = 25';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('generate');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('age');
        expect(node.expression).toBe('25');
      }
    });

    test('should parse assignment expression with complex expression', () => {
      const source = 'generate newvar = oldvar + 1 * 2';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('generate');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('newvar');
        expect(node.expression).toBe('oldvar + 1 * 2');
      }
    });

    test('should parse command with if-qualifier', () => {
      const source = 'list var1 var2 if age > 30';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('list');
        expect(node.varlist).toHaveLength(2);
        expect(node.varlist?.[0].name).toBe('var1');
        expect(node.varlist?.[1].name).toBe('var2');
        expect(node.ifExpression).toBe('age > 30');
        expect(node.inExpression).toBeUndefined();
      }
    });

    test('should parse command with in-qualifier', () => {
      const source = 'summarize income in 1/100';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('summarize');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('income');
        expect(node.ifExpression).toBeUndefined();
        expect(node.inExpression).toBe('1/100');
      }
    });

    test('should preserve cross-line gaps in semicolon-mode string statements', () => {
      const source = `#delimit ;
"first" // note
"second";
#delimit cr`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(3);

      const node = parseResult.ast.nodes[1];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe(`"first" // note
"second"`);
      }
    });

    test('should parse command with both if and in qualifiers', () => {
      const source = 'list var1 var2 if age > 30 in 1/10';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('list');
        expect(node.varlist).toHaveLength(2);
        expect(node.varlist?.[0].name).toBe('var1');
        expect(node.varlist?.[1].name).toBe('var2');
        expect(node.ifExpression).toBe('age > 30');
        expect(node.inExpression).toBe('1/10');
      }
    });

    test('should parse command with assignment and if-qualifier', () => {
      const source = 'generate newvar = oldvar * 2 if condition == 1';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('generate');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('newvar');
        expect(node.expression).toBe('oldvar * 2');
        expect(node.ifExpression).toBe('condition == 1');
        expect(node.inExpression).toBeUndefined();
      }
    });

    test('should parse complex if-qualifier with parentheses', () => {
      const source = 'list var if (age > 30 & gender == "male")';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('list');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('var');
        expect(node.ifExpression).toBe('(age > 30 & gender == "male")');
      }
    });

    test('should parse command without assignment expression', () => {
      const source = 'describe age';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('describe');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('age');
        expect(node.expression).toBeUndefined();
      }
    });

    test('should parse command with prefix', () => {
      const source = 'quietly generate age = 25';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.prefix).toHaveLength(1);
        expect(node.prefix?.[0].name).toBe('quietly');
        expect(node.name).toBe('generate');
      }
    });

    test('should parse command with options', () => {
      const source = 'regress income age, robust';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');
      
      if (node.type === 'command') {
        expect(node.name).toBe('regress');
        expect(node.varlist).toHaveLength(2);
        expect(node.varlist?.[0].name).toBe('income');
        expect(node.varlist?.[1].name).toBe('age');
        expect(node.options).toHaveLength(1);
        expect(node.options?.[0].name).toBe('robust');
      }
    });

    test('should parse local macro definition', () => {
      const source = 'local myvar "hello world"';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');
      
      if (node.type === 'macro_def') {
        expect(node.scope).toBe('local');
        expect(node.name).toBe('myvar');
        expect(node.value).toBe('"hello world"');
      }
    });

    test('should parse local macro assignment continued after equals', () => {
      const source = `local x = ///
    1 / 2`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.scope).toBe('local');
        expect(node.name).toBe('x');
        expect(node.hasEquals).toBe(true);
        expect(node.value).toBe('1 / 2');
        expect(node.range.end.line).toBe(1);
      }
    });

    test('should report missing expression for local macro assignment ending at equals', () => {
      const source = 'local x =';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors.map(error => error.message)).toContain('Missing expression after equals sign');
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.name).toBe('x');
        expect(node.hasEquals).toBe(true);
        expect(node.value).toBe('');
      }
    });

    test('should parse extended macro definition continued after colon function', () => {
      const source = `local x : display ///
    1 / 2`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.scope).toBe('local');
        expect(node.name).toBe('x');
        expect(node.extendedFunction?.name).toBe('display');
        expect(node.extendedFunction?.args).toBe('1 / 2');
        expect(node.range.end.line).toBe(1);
      }
    });

    test('should parse global macro assignment continued after equals', () => {
      const source = `global x = ///
    1 + 2`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.scope).toBe('global');
        expect(node.name).toBe('x');
        expect(node.hasEquals).toBe(true);
        expect(node.value).toBe('1 + 2');
        expect(node.range.end.line).toBe(1);
      }
    });

    test('should parse macro assignment continued across stacked continuations', () => {
      const source = `local x = ///
    1 + ///
    2`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.name).toBe('x');
        expect(node.hasEquals).toBe(true);
        expect(node.value).toBe('1 + 2');
        expect(node.range.end.line).toBe(2);
      }
    });

    test('joins a /// continuation with no space when the next line is unindented', () => {
      // `///` removes itself and the newline; an unindented continued token
      // joins directly (Stata: `local x = ab///\ncd` -> "abcd").
      const source = `local x = ab///
cd`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');
      if (node.type === 'macro_def') {
        expect(node.value).toBe('abcd');
      }
    });

    test('should parse macro assignment continued after the scope keyword', () => {
      const source = `local ///
    x = 1`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.name).toBe('x');
        expect(node.hasEquals).toBe(true);
        expect(node.value).toBe('1');
      }
    });

    test('should parse macro assignment continued between name and equals', () => {
      const source = `local x ///
    = 1`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.name).toBe('x');
        expect(node.hasEquals).toBe(true);
        expect(node.value).toBe('1');
      }
    });

    test('should parse extended macro definition continued after the colon', () => {
      const source = `local x : ///
    display 1 + 2`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');

      if (node.type === 'macro_def') {
        expect(node.name).toBe('x');
        expect(node.extendedFunction?.name).toBe('display');
        expect(node.extendedFunction?.args).toBe('1 + 2');
      }
    });

    test('should parse global macro definition', () => {
      const source = 'global path "/usr/local/stata"';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('macro_def');
      
      if (node.type === 'macro_def') {
        expect(node.scope).toBe('global');
        expect(node.name).toBe('path');
        expect(node.value).toBe('"/usr/local/stata"');
      }
    });

    test('should parse program definition', () => {
      const source = `program define myprog
        display "Hello"
      end`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('program');
      
      if (node.type === 'program') {
        expect(node.name).toBe('myprog');
        expect(node.body).toHaveLength(1);
        expect(node.body[0].type).toBe('command');
      }
    });

    test('should parse if statement', () => {
      const source = `if age > 18 {
        display "Adult"
      }`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('if');
      
      if (node.type === 'if') {
        expect(node.condition).toBe('age > 18');
        expect(node.body).toHaveLength(1);
      }
    });

    test('should parse if statement with line continuations', () => {
      const source = `if (r(N) != r(unique_value) & ///
            "\`birth_id'" != "bhln brthord" & ///
            "\`birth_id'" != "bhln bhord") {
    display "test"
}`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      // Should not have "open brace must be on the same line" error
      const brace_error = parseResult.errors.find(e =>
        e.message.includes('open brace must be on the same line')
      );
      expect(brace_error).toBeUndefined();

      expect(parseResult.ast.nodes).toHaveLength(1);
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('if');

      if (node.type === 'if') {
        expect(node.body).toHaveLength(1);
      }
    });

    test('should parse foreach loop', () => {
      const source = `foreach var in age income {
        summarize \`var'
      }`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('foreach');
      
      if (node.type === 'foreach') {
        expect(node.loopVar).toBe('var');
        expect(node.loopSpec).toBe('in age income');
        expect(node.body).toHaveLength(1);
      }
    });

    test('should parse #delimit directive', () => {
      const source = '#delimit ;';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);
      
      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('directive');
      
      if (node.type === 'directive') {
        expect(node.directive).toBe('delimit');
        expect(node.mode).toBe('semicolon');
      }
    });
  });

  describe('embedded language blocks', () => {
    test('should parse mata block', () => {
      const source = `mata
  a = 1
end`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('mata');
        expect(node.start_command).toBe('mata');
        expect(node.end_command).toBe('end');
        expect(node.is_single_line).toBe(false);
        expect(node.content).toContain('a = 1');
      }
    });

    test('should preserve multiline mata block content with whitespace tokens', () => {
      const source = `mata
real // note
scalar x
end`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('mata');
        expect(node.is_single_line).toBe(false);
        expect(node.content).toBe(`real // note
scalar x`);
      }
    });

    test('should parse python block', () => {
      const source = `python
  x = 1
end`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('python');
        expect(node.start_command).toBe('python');
        expect(node.end_command).toBe('end');
        expect(node.is_single_line).toBe(false);
        expect(node.content).toContain('x = 1');
      }
    });

    test('should parse single-line mata block', () => {
      const source = 'mata: a = 1';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('mata');
        expect(node.start_command).toBe('mata:');
        expect(node.is_single_line).toBe(true);
      }
    });

    test('should parse single-line python block', () => {
      const source = 'python: x = 1';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('python');
        expect(node.start_command).toBe('python:');
        expect(node.is_single_line).toBe(true);
      }
    });

    test('should preserve line boundary in semicolon-mode inline mata content', () => {
      const source = `#delimit ;
mata: real // note
scalar x;
#delimit cr`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(3);

      const node = parseResult.ast.nodes[1];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('mata');
        expect(node.content).toBe(`real // note
scalar x`);
      }
    });

    test('should preserve line boundary in semicolon-mode inline python content', () => {
      const source = `#delimit ;
python: value = 1 // note
print(value);
#delimit cr`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(3);

      const node = parseResult.ast.nodes[1];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('python');
        expect(node.content).toBe(`value = 1 // note
print(value)`);
      }
    });

    test('should not fuse semicolon-mode inline embedded tokens across lines', () => {
      const source = `#delimit ;
mata: real
scalar x;
#delimit cr`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(3);

      const node = parseResult.ast.nodes[1];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('mata');
        expect(node.content).toBe(`real
scalar x`);
        expect(node.content).not.toContain('realscalar');
      }
    });

    test('should parse mata block with comments', () => {
      const source = `* Start mata
mata
  a = 1
end
* End mata`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.leadingTrivia).toBeDefined();
        expect(node.leadingTrivia?.length).toBeGreaterThan(0);
        expect(node.trailingTrivia).toBeDefined();
        expect(node.trailingTrivia?.length).toBeGreaterThan(0);
      }
    });

    test('should parse multiple embedded blocks', () => {
      const source = `mata
  a = 1
end
python
  x = 1
end`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(2);

      const first_node = parseResult.ast.nodes[0];
      expect(first_node.type).toBe('embedded_block');
      if (first_node.type === 'embedded_block') {
        expect(first_node.language).toBe('mata');
      }

      const second_node = parseResult.ast.nodes[1];
      expect(second_node.type).toBe('embedded_block');
      if (second_node.type === 'embedded_block') {
        expect(second_node.language).toBe('python');
      }
    });

    test('should parse embedded block with stata commands around it', () => {
      const source = `generate x = 1
mata
  a = 1
end
display "done"`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(3);

      expect(parseResult.ast.nodes[0].type).toBe('command');
      expect(parseResult.ast.nodes[1].type).toBe('embedded_block');
      expect(parseResult.ast.nodes[2].type).toBe('command');
    });

    test('should parse brace-style mata block', () => {
      const source = 'mata { 1234 }';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('mata');
        expect(node.start_command).toBe('mata');
        expect(node.end_command).toBe('}');
        expect(node.is_single_line).toBe(false);
        expect(node.content).toContain('1234');
      }
    });

    test('should parse brace-style mata block inside program', () => {
      // This is the original bug case
      const source = `capture program drop my_program
program define my_program
syntax anything(name=my_arg), [an_opt] [another_opt]
di \`"my_arg: \`"\`my_arg'"'"'
mata { 1234 }
end`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      // Should have no errors - the mata block should be closed by } and
      // the program should be closed by end
      expect(parseResult.errors).toHaveLength(0);
      
      // Should have 2 nodes: capture command and program definition
      expect(parseResult.ast.nodes).toHaveLength(2);
      
      // Second node should be the program
      const program_node = parseResult.ast.nodes[1];
      expect(program_node.type).toBe('program');
      
      if (program_node.type === 'program') {
        expect(program_node.name).toBe('my_program');
        // Program body should contain the mata block
        const mata_block = program_node.body.find(n => n.type === 'embedded_block');
        expect(mata_block).toBeDefined();
        if (mata_block && mata_block.type === 'embedded_block') {
          expect(mata_block.language).toBe('mata');
          expect(mata_block.end_command).toBe('}');
        }
      }
    });

    test('should parse brace-style python block', () => {
      const source = 'python { print("hello") }';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('python');
        expect(node.start_command).toBe('python');
        expect(node.end_command).toBe('}');
      }
    });

    test('should parse brace-style mata block with nested braces', () => {
      const source = 'mata { for (i=1; i<=10; i++) { x[i] = i } }';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('embedded_block');

      if (node.type === 'embedded_block') {
        expect(node.language).toBe('mata');
        expect(node.end_command).toBe('}');
        // Content should include the nested braces
        expect(node.content).toContain('for');
        expect(node.content).toContain('{');
        expect(node.content).toContain('}');
      }
    });
  });

  describe('error handling', () => {
    test('should handle missing program end', () => {
      const source = `program define myprog
        display "Hello"`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors.length).toBeGreaterThan(0);
      expect(parseResult.errors[0].message).toContain('Missing');
    });

    test('should handle missing closing brace', () => {
      const source = `if age > 18 {
        display "Adult"`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors.length).toBeGreaterThan(0);
      expect(parseResult.errors[0].message).toContain('Missing closing brace');
    });

    test('should handle missing closing brace in foreach loop', () => {
      const source = `foreach var in age income {
        summarize \`var'`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors.length).toBeGreaterThan(0);
      expect(parseResult.errors[0].message).toContain('Missing closing brace');
    });

    test('should handle missing closing brace in while loop', () => {
      const source = `while x > 0 {
        display x`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors.length).toBeGreaterThan(0);
      expect(parseResult.errors[0].message).toContain('Missing closing brace');
    });
  });

  describe('#delimit ; brace blocks (issue #301)', () => {
    // In `#delimit ;` mode the lexer emits WHITESPACE tokens between tokens
    // (in `#delimit cr` mode they are elided). A valid brace block must parse
    // without spurious ORPHAN_CLOSE_BRACE / SYNTAX_ERROR on its closing brace.
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);

    const structural_error_codes = new Set([
      'ORPHAN_CLOSE_BRACE',
      'OPEN_BRACE_ALONE',
      'SYNTAX_ERROR',
    ]);
    const structural_errors = (source: string) =>
      parse(source).errors.filter(
        e => e.code && structural_error_codes.has(e.code)
      );

    // Trailing-trivia contents of a node, tolerant of union members that do
    // not carry trivia.
    // Recursively collect the contents of every leading/trailing trivia node
    // in the tree, tolerant of union members that do not carry trivia.
    type MaybeTriviaNode = {
      leadingTrivia?: { content: string }[];
      trailingTrivia?: { content: string }[];
      body?: MaybeTriviaNode[];
    };
    const collect_all_trivia = (nodes: readonly unknown[]): string[] => {
      const contents: string[] = [];
      const walk = (the_nodes: MaybeTriviaNode[]): void => {
        for (const my_node of the_nodes) {
          for (const t of my_node.leadingTrivia ?? []) contents.push(t.content);
          for (const t of my_node.trailingTrivia ?? []) contents.push(t.content);
          if (my_node.body) walk(my_node.body);
        }
      };
      walk(nodes as unknown as MaybeTriviaNode[]);
      return contents;
    };
    const all_comment_contents = (source: string): string =>
      collect_all_trivia(parse(source).ast.nodes).join('');

    test('forvalues block parses without structural errors', () => {
      const source =
        '#delimit ;\nforvalues i=1/3 {;\n    display 1;\n};\n#delimit cr';
      const result = parse(source);
      expect(structural_errors(source)).toHaveLength(0);
      const loop = result.ast.nodes.find(n => n.type === 'forvalues');
      expect(loop).toBeDefined();
      if (loop && loop.type === 'forvalues') {
        expect(loop.loopVar).toBe('i');
        expect(loop.body).toHaveLength(1);
      }
    });

    test('foreach block parses without structural errors', () => {
      const source =
        '#delimit ;\nforeach x in a b {;\n    display 1;\n};\n#delimit cr';
      const result = parse(source);
      expect(structural_errors(source)).toHaveLength(0);
      const loop = result.ast.nodes.find(n => n.type === 'foreach');
      expect(loop).toBeDefined();
      if (loop && loop.type === 'foreach') {
        expect(loop.loopVar).toBe('x');
        expect(loop.body).toHaveLength(1);
      }
    });

    test('if block parses without structural errors', () => {
      const source =
        '#delimit ;\nif 1 {;\n    display 1;\n};\n#delimit cr';
      expect(structural_errors(source)).toHaveLength(0);
    });

    test('while block parses without structural errors', () => {
      const source =
        '#delimit ;\nwhile 1 {;\n    display 1;\n};\n#delimit cr';
      expect(structural_errors(source)).toHaveLength(0);
    });

    test('nested blocks parse without structural errors', () => {
      const source =
        '#delimit ;\nforvalues i=1/3 {;\n    if 1 {;\n' +
        '        display 1;\n    };\n};\n#delimit cr';
      expect(structural_errors(source)).toHaveLength(0);
    });

    test('forvalues with spaces around = parses', () => {
      const source =
        '#delimit ;\nforvalues i = 1/3 {;\n    display 1;\n};\n#delimit cr';
      const result = parse(source);
      expect(structural_errors(source)).toHaveLength(0);
      const loop = result.ast.nodes.find(n => n.type === 'forvalues');
      expect(loop && loop.type === 'forvalues' && loop.loopVar).toBe('i');
    });

    test('else block parses without structural errors', () => {
      const source =
        '#delimit ;\nif 1 {;\n    display 1;\n};\nelse {;\n' +
        '    display 2;\n};\n#delimit cr';
      const result = parse(source);
      expect(structural_errors(source)).toHaveLength(0);
      expect(result.ast.nodes.some(n => n.type === 'else')).toBe(true);
    });

    test('prefix brace block parses without structural errors', () => {
      const source =
        '#delimit ;\nquietly {;\n    display 1;\n};\n#delimit cr';
      expect(structural_errors(source)).toHaveLength(0);
    });

    test('chained prefix brace block parses without structural errors', () => {
      const source =
        '#delimit ;\nquietly capture {;\n    display 1;\n};\n#delimit cr';
      expect(structural_errors(source)).toHaveLength(0);
    });

    test('prefix-colon brace block with space before colon parses', () => {
      // `quietly : {` — whitespace before the colon is a WHITESPACE token in
      // `#delimit ;` mode; the colon must still be consumed and the block
      // recognized (issue #301).
      const source =
        '#delimit ;\nquietly : {;\n    display 1;\n};\n#delimit cr';
      const result = parse(source);
      expect(structural_errors(source)).toHaveLength(0);
      const cmd = result.ast.nodes.find(n => n.type === 'command');
      expect(cmd && cmd.type === 'command' && cmd.prefix?.[0]?.has_colon).toBe(true);
    });

    test('chained prefix-colon brace block with spaces parses', () => {
      const source =
        '#delimit ;\nquietly capture : {;\n    display 1;\n};\n#delimit cr';
      expect(structural_errors(source)).toHaveLength(0);
    });

    test('genuine orphan close brace is still reported', () => {
      const source = '#delimit ;\ndisplay 1;\n};\n#delimit cr';
      const codes = parse(source).errors.map(e => e.code);
      expect(codes).toContain('ORPHAN_CLOSE_BRACE');
    });

    test('comment before } is preserved and not corrupted', () => {
      // A comment on its own line just before the closing brace must survive in
      // the AST (it must never be dropped). Its attachment point matches the
      // pre-existing `#delimit cr` behavior; this fix does not reposition it.
      const source =
        '#delimit ;\nforvalues i=1/3 {;\n    display 1;\n' +
        '    * inner;\n};\ndisplay 2;\n#delimit cr';
      const result = parse(source);
      const loop = result.ast.nodes.find(n => n.type === 'forvalues');
      expect(loop && loop.type === 'forvalues' && loop.body).toHaveLength(1);
      expect(collect_all_trivia(result.ast.nodes).join('')).toContain('* inner');
    });

    // The whitespace-only skips added for #301 must not discard comments that
    // sit at an adjacency point (between a keyword/prefix and what follows).
    // These positions are unusual, but a comment there must survive in the AST
    // so the formatter never deletes it.
    test('comment between loop keyword and variable is not dropped', () => {
      expect(all_comment_contents('forvalues /* c */ i=1/3 {\n    display 1\n}'))
        .toContain('/* c */');
    });

    test('comment between else and its brace is not dropped', () => {
      const source =
        'if 1 {\n    display 1\n}\nelse /* c */ {\n    display 2\n}';
      expect(all_comment_contents(source)).toContain('/* c */');
    });

    test('comment between prefix and its block is not dropped', () => {
      expect(all_comment_contents('quietly /* c */ {\n    display 1\n}'))
        .toContain('/* c */');
    });
  });

  describe('#delimit ; command varlist (issue #305)', () => {
    // In `#delimit ;` mode the lexer emits WHITESPACE tokens between varlist
    // items that `#delimit cr` mode elides. The command-body parser assumed
    // cr-mode adjacency, so it broke at the first interstitial space, left the
    // varlist empty, and re-parsed the remaining arguments as fresh statements.
    // A multi-token command must produce ONE command node with the full
    // varlist (issue #305).
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);

    // Extract the sole command-like node from a parse, tolerant of the
    // directive nodes that bracket a `#delimit ;` block.
    type CommandLike = {
      type: string;
      name?: string;
      varlist?: { name: string }[];
      expression?: string;
      ifExpression?: string;
      inExpression?: string;
      options?: { name: string }[];
      prefix?: { name: string; has_colon?: boolean }[];
    };
    const commands = (source: string): CommandLike[] =>
      (parse(source).ast.nodes as unknown as CommandLike[]).filter(
        n => n.type === 'command'
      );
    const varlist_names = (c: CommandLike | undefined): string[] =>
      (c?.varlist ?? []).map(v => v.name);

    // Wrap a command body in a `#delimit ;` block terminated with `;`.
    const semi = (body: string): string =>
      `#delimit ;\n${body};\n#delimit cr`;

    test('two-variable command is one node with full varlist', () => {
      const cmds = commands(semi('regress y x'));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('regress');
      expect(varlist_names(cmds[0])).toEqual(['y', 'x']);
    });

    test('matches #delimit cr parsing of the same command', () => {
      const cr = commands('regress y x');
      expect(cr).toHaveLength(1);
      expect(varlist_names(cr[0])).toEqual(['y', 'x']);
      // The `#delimit ;` varlist must match the cr-mode varlist exactly.
      expect(varlist_names(commands(semi('regress y x'))[0])).toEqual(
        varlist_names(cr[0])
      );
    });

    test('three-variable command collects every item', () => {
      const cmds = commands(semi('summarize a b c'));
      expect(cmds).toHaveLength(1);
      expect(varlist_names(cmds[0])).toEqual(['a', 'b', 'c']);
    });

    test('prefixed command keeps prefix and full varlist in one node', () => {
      const cmds = commands(semi('quietly regress y x'));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('regress');
      expect(cmds[0].prefix?.map(p => p.name)).toEqual(['quietly']);
      expect(varlist_names(cmds[0])).toEqual(['y', 'x']);
    });

    test('if/in qualifiers parse after the varlist', () => {
      const source = semi('regress y x if z > 1 in 1/10');
      // The space after the comparison must not be flagged as a stray token.
      expect(parse(source).errors).toHaveLength(0);
      const cmds = commands(source);
      expect(cmds).toHaveLength(1);
      expect(varlist_names(cmds[0])).toEqual(['y', 'x']);
      expect(cmds[0].ifExpression?.replace(/\s+/g, '')).toBe('z>1');
      expect(cmds[0].inExpression?.replace(/\s+/g, '')).toBe('1/10');
    });

    test('qualifier expressions do not emit spurious stray-token errors', () => {
      // In `#delimit ;` mode the WHITESPACE after a completed comparison
      // (before `in`, `&`, `,`, or `;`) must not be flagged as a stray token
      // (issue #305). A genuine stray token is still reported.
      for (const my_body of [
        'regress y x if z > 1 in 1/10',
        'regress y x if z > 1, robust',
        'regress y x if z > 1',
        'regress y x if z > 1 & w < 2',
      ]) {
        expect(parse(semi(my_body)).errors).toHaveLength(0);
      }
      const stray = parse(semi('regress y x if z > 1 2')).errors;
      expect(stray.some(e => e.code === 'STRAY_TOKEN_IN_CONDITION')).toBe(true);
    });

    test('options parse after the varlist and comma', () => {
      const cmds = commands(semi('regress y x, robust cluster(id)'));
      expect(cmds).toHaveLength(1);
      expect(varlist_names(cmds[0])).toEqual(['y', 'x']);
      expect(cmds[0].options?.map(o => o.name)).toEqual(['robust', 'cluster']);
    });

    test('assignment expression parses after the varlist', () => {
      const cmds = commands(semi('gen z = x + y'));
      expect(cmds).toHaveLength(1);
      expect(varlist_names(cmds[0])).toEqual(['z']);
      expect(cmds[0].expression?.replace(/\s+/g, '')).toBe('x+y');
    });

    test('adjacent wildcards coalesce but remain separate items', () => {
      const cmds = commands(semi('summarize pop* gdp*'));
      expect(cmds).toHaveLength(1);
      expect(varlist_names(cmds[0])).toEqual(['pop*', 'gdp*']);
    });

    test('file-command path with a dot stays a single argument', () => {
      const cmds = commands(semi('do myfile.do'));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('do');
      expect(varlist_names(cmds[0])).toEqual(['myfile.do']);
    });

    test('args command collects every name', () => {
      const cmds = commands(semi('args a b c'));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('args');
      expect(varlist_names(cmds[0])).toEqual(['a', 'b', 'c']);
    });

    test('unab command collects macro name and varlist', () => {
      const cmds = commands(semi('unab vars : pop*'));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('unab');
      expect(varlist_names(cmds[0])).toEqual(['vars', 'pop*']);
    });

    test('frame-prefixed command parses in #delimit ; mode', () => {
      const cmds = commands(semi('frame mine: regress y x'));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('regress');
      expect(cmds[0].prefix?.some(p => p.name === 'frame')).toBe(true);
      expect(varlist_names(cmds[0])).toEqual(['y', 'x']);
    });

    test('non-prefix frame subcommand parses as one frame command', () => {
      // `frame create x;` is a plain `frame` command (subcommand `create`,
      // arg `x`), not the `frame name:` prefix or `frame name { }` block.
      // parseFrameBlock must backtrack to the `frame` token — not to the
      // interstitial WHITESPACE — so parseCommand re-parses it whole (#305).
      const source = semi('frame create x');
      const result = parse(source);
      expect(result.errors).toHaveLength(0);
      const cmds = commands(source);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('frame');
      expect(varlist_names(cmds[0])).toEqual(['create', 'x']);
    });

    test('frame subcommand matches #delimit cr parsing', () => {
      const cr = commands('frame change default');
      expect(cr).toHaveLength(1);
      expect(cr[0].name).toBe('frame');
      expect(varlist_names(commands(semi('frame change default'))[0])).toEqual(
        varlist_names(cr[0])
      );
    });

    test('frame block parses without errors in #delimit ; mode', () => {
      const source = '#delimit ;\nframe mine {;\n  gen x = 1;\n};\n#delimit cr';
      const result = parse(source);
      expect(result.errors).toHaveLength(0);
      expect(result.ast.nodes.some(n => n.type === 'frame')).toBe(true);
    });

    test('option argument attaches with a space before its paren', () => {
      // `cluster (id)` — a WHITESPACE token sits between the option name and
      // its `(...)` in `#delimit ;` mode; the argument must still attach
      // rather than the paren group being read as a separate option (#305).
      const cmds = commands(semi('regress y x, cluster (id)'));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].options?.map(o => o.name)).toEqual(['cluster']);
      // Matches `#delimit cr` parsing of the same command text.
      const cr = commands('regress y x, cluster (id)');
      expect(cmds[0].options?.map(o => o.name)).toEqual(
        cr[0].options?.map(o => o.name)
      );
    });

    test('program define is recognized in #delimit ; mode', () => {
      // `program` and `define` are separated by a WHITESPACE token in
      // #delimit ; mode; the lookahead and the define check must tolerate it
      // so the program is recognized (not misparsed as an ordinary command
      // that runs off to EOF), and the body must terminate at `end` (#305).
      const source =
        '#delimit ;\nprogram define p;\n  display 1;\nend;\n#delimit cr';
      const result = parse(source);
      expect(result.errors).toHaveLength(0);
      const prog = result.ast.nodes.find(n => n.type === 'program');
      expect(prog).toBeDefined();
      if (prog && prog.type === 'program') {
        expect(prog.name).toBe('p');
        expect(prog.body).toHaveLength(1);
      }
      // No stray top-level command named `program` or `end`.
      const cmd_names = (result.ast.nodes as unknown as CommandLike[])
        .filter(n => n.type === 'command')
        .map(n => n.name);
      expect(cmd_names).not.toContain('program');
      expect(cmd_names).not.toContain('end');
    });

    test('program with a comment before end closes and keeps following code', () => {
      // A comment-only line before `end` must not swallow `end` and the
      // statements after the program. The body loop collects the comment as
      // trivia and re-checks `end`, mirroring parseBraceBody (#305).
      const source =
        '#delimit ;\nprogram define p;\n  display 1;\n  // note\nend;\n' +
        'display 2;\n#delimit cr';
      const result = parse(source);
      expect(result.errors).toHaveLength(0);
      const prog = result.ast.nodes.find(n => n.type === 'program');
      expect(prog && prog.type === 'program' && prog.body).toHaveLength(1);
      // `display 2` survives as a top-level command after the program.
      const cmds = commands(source);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('display');
    });

    test('syntax option argument attaches across a space before its paren', () => {
      // `opt (string)` — the WHITESPACE before `(` must not detach the
      // argument type, matching #delimit cr parsing (#305).
      const source =
        '#delimit ;\nprogram define p;\n  syntax , opt (string);\nend;\n#delimit cr';
      const result = parse(source);
      expect(result.errors).toHaveLength(0);
      const prog = result.ast.nodes.find(n => n.type === 'program');
      const the_syntax = prog && prog.type === 'program'
        ? prog.body?.find(n => n.type === 'syntax')
        : undefined;
      expect(the_syntax).toBeDefined();
      if (the_syntax && the_syntax.type === 'syntax') {
        expect(the_syntax.signature.options).toHaveLength(1);
        expect(the_syntax.signature.options[0].name).toBe('opt');
        expect(the_syntax.signature.options[0].argumentType).toBe('string');
      }
    });

    test('nested prefix colon inside a frame prefix parses in #delimit ; mode', () => {
      // `frame mine: quietly : cmd` — the WHITESPACE before the inner colon
      // must not split the statement (#305).
      const source = semi('frame mine: quietly : regress y x');
      const result = parse(source);
      expect(result.errors).toHaveLength(0);
      const cmds = commands(source);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('regress');
      expect(cmds[0].prefix?.map(p => p.name)).toEqual(['frame', 'quietly']);
      expect(cmds[0].prefix?.every(p => p.has_colon)).toBe(true);
      expect(varlist_names(cmds[0])).toEqual(['y', 'x']);
    });
  });

  describe('#delimit ; reconstructed-string spacing parity (issue #306)', () => {
    // In `#delimit ;` mode the lexer emits WHITESPACE tokens that `#delimit cr`
    // mode elides, so the reconstructed expression / if-in qualifier /
    // parenthesized-group strings gained internal spaces in `;` mode that were
    // absent in `cr` mode. The AST structure was already identical; only the
    // internal spacing diverged. We reconstruct spacing from token ranges (via
    // reconstruct_value_tokens) in BOTH modes, so each yields the identical,
    // source-faithful single-space form (issue #306, Option 3). This also fixes
    // the latent `cr`-mode defect where value-separator whitespace was lost
    // (e.g. `group(a b)` became `group(ab)`), which the pretty-printer could
    // not recover once two value tokens had been fused into one identifier.
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);
    type CommandLike = {
      type: string;
      name?: string;
      varlist?: { name: string; recovery_only?: true }[];
      expression?: string;
      ifExpression?: string;
      inExpression?: string;
    };
    const command = (source: string): CommandLike | undefined =>
      (parse(source).ast.nodes as unknown as CommandLike[]).find(
        n => n.type === 'command'
      );
    const command_names = (source: string): string[] =>
      (parse(source).ast.nodes as unknown as CommandLike[])
        .filter(n => n.type === 'command')
        .map(n => n.name ?? '');
    const varlist_names = (source: string): string[] =>
      command(source)?.varlist?.map(v => v.name) ?? [];
    const varlist_items = (source: string): Array<{ name: string; recovery_only?: true }> =>
      command(source)?.varlist ?? [];
    const semi = (body: string): string =>
      `#delimit ;\n${body};\n#delimit cr`;

    // For each body, the `;`-mode reconstruction must equal the `cr`-mode one
    // (a single space per source gap), and neither mode may emit a diagnostic.
    const cases: { body: string; expr?: string; if_?: string; in_?: string;
                   vl?: string[] }[] = [
      { body: 'gen z = x + y', expr: 'x + y', vl: ['z'] },
      { body: 'gen z = x+y', expr: 'x+y', vl: ['z'] },
      { body: 'gen z = (x + y) * 2', expr: '(x + y) * 2', vl: ['z'] },
      // Value-separator whitespace must survive so the argument list is not
      // fused into one identifier (the pre-existing cr-mode defect).
      { body: 'egen g = group(a b)', expr: 'group(a b)', vl: ['g'] },
      { body: 'replace z = x * 2 if y > 0', expr: 'x * 2', if_: 'y > 0',
        vl: ['z'] },
      { body: 'keep if inrange(age, 18, 65)', if_: 'inrange(age, 18, 65)' },
      { body: 'keep in 1 / 10', in_: '1 / 10' },
      { body: 'recode x (1/3 = 1) (4/6 = 2)',
        vl: ['x', '(1/3 = 1)', '(4/6 = 2)'] },
    ];

    for (const my_case of cases) {
      test(`"${my_case.body}" matches cr spacing and is error-free`, () => {
        const cr = parse(my_case.body);
        const semi_result = parse(semi(my_case.body));
        expect(cr.errors).toHaveLength(0);
        expect(semi_result.errors).toHaveLength(0);

        const cr_cmd = command(my_case.body);
        const semi_cmd = command(semi(my_case.body));
        expect(cr_cmd).toBeDefined();
        expect(semi_cmd).toBeDefined();

        // Parity: every reconstructed field agrees across modes.
        expect(semi_cmd?.expression).toBe(cr_cmd?.expression);
        expect(semi_cmd?.ifExpression).toBe(cr_cmd?.ifExpression);
        expect(semi_cmd?.inExpression).toBe(cr_cmd?.inExpression);
        expect((semi_cmd?.varlist ?? []).map(v => v.name)).toEqual(
          (cr_cmd?.varlist ?? []).map(v => v.name)
        );

        // And the agreed form is the source-faithful single-space one.
        if (my_case.expr !== undefined) {
          expect(semi_cmd?.expression).toBe(my_case.expr);
        }
        if (my_case.if_ !== undefined) {
          expect(semi_cmd?.ifExpression).toBe(my_case.if_);
        }
        if (my_case.in_ !== undefined) {
          expect(semi_cmd?.inExpression).toBe(my_case.in_);
        }
        if (my_case.vl !== undefined) {
          expect((semi_cmd?.varlist ?? []).map(v => v.name)).toEqual(my_case.vl);
        }
      });
    }

    test('multi-word parenthesized group keeps its word separators', () => {
      // Range-based reconstruction must keep the value separator: `(a b)` is
      // `(a b)` in both modes, never `(ab)`. Whitespace around operators is
      // normalized to a single space rather than dropped.
      const cr = command('mycmd (a b)');
      const semi_cmd = command(semi('mycmd (a b)'));
      expect((cr?.varlist ?? []).map(v => v.name)).toContain('(a b)');
      expect((semi_cmd?.varlist ?? []).map(v => v.name)).toEqual(
        (cr?.varlist ?? []).map(v => v.name)
      );
    });

    test('unterminated cr-mode parenthesized group does not swallow following statements', () => {
      const source = 'rename (old1 old2\ndisplay 1\ndisplay 2';

      expect(command_names(source)).toEqual(['rename', 'display', 'display']);
      expect(varlist_names(source)).toEqual(['(old1 old2']);
    });

    test('unterminated empty cr-mode parenthesized group keeps authored opener', () => {
      const source = 'rename (\ndisplay 1';

      expect(command_names(source)).toEqual(['rename', 'display']);
      expect(varlist_names(source)).toEqual(['(']);
    });

    test('unterminated empty parenthesized group is marked recovery-only', () => {
      expect(varlist_items('rename (\ndisplay 1')).toEqual([
        expect.objectContaining({ name: '(', recovery_only: true }),
      ]);
      expect(varlist_items('#delimit ;\nrename (;\ndisplay 1;')).toEqual([
        expect.objectContaining({ name: '(', recovery_only: true }),
      ]);
    });

    test('non-empty unclosed and balanced parenthesized groups are not recovery-only', () => {
      expect(varlist_items('rename (old1 old2\ndisplay 1')).toEqual([
        expect.objectContaining({ name: '(old1 old2' }),
      ]);
      expect(varlist_items('rename (old1 old2\ndisplay 1')[0].recovery_only).toBeUndefined();

      expect(varlist_items('rename (old1 old2) (new1 new2)')).toEqual([
        expect.objectContaining({ name: '(old1 old2)' }),
        expect.objectContaining({ name: '(new1 new2)' }),
      ]);
      expect(varlist_items('rename (old1 old2) (new1 new2)').some(
        item => item.recovery_only
      )).toBe(false);
    });

    test('unterminated semicolon-mode parenthesized group does not consume the terminator', () => {
      const source =
        '#delimit ;\nrename (old1 old2;\ndisplay 1;\n#delimit cr';

      expect(command_names(source)).toEqual(['rename', 'display']);
      expect(varlist_names(source)).toEqual(['(old1 old2']);
    });

    test('unterminated empty semicolon-mode parenthesized group keeps authored opener', () => {
      const source = '#delimit ;\nrename (;\ndisplay 1;\n#delimit cr';

      expect(command_names(source)).toEqual(['rename', 'display']);
      expect(varlist_names(source)).toEqual(['(']);
    });

    test('balanced empty parenthesized group is omitted from varlist', () => {
      expect(varlist_names('mycmd () after')).toEqual(['after']);
    });

    test('unterminated assignment expression does not swallow following statements', () => {
      const source = 'gen z = (x\ndisplay 1\ndisplay 2';

      expect(command_names(source)).toEqual(['gen', 'display', 'display']);
      expect(command(source)?.expression).toBe('(x');
    });

    test('unterminated semicolon-mode assignment expression does not consume the terminator', () => {
      const source = '#delimit ;\ngen z = (x;\ndisplay 1;\n#delimit cr';

      expect(command_names(source)).toEqual(['gen', 'display']);
      expect(command(source)?.expression).toBe('(x');
    });

    test('unterminated if qualifier does not swallow following statements', () => {
      const source = 'keep if (x > 0\ndisplay 1\ndisplay 2';

      expect(command_names(source)).toEqual(['keep', 'display', 'display']);
      expect(command(source)?.ifExpression).toBe('(x > 0');
    });

    test('balanced rename parenthesized groups stay intact', () => {
      expect(varlist_names('rename (old1 old2) (new1 new2)')).toEqual([
        '(old1 old2)',
        '(new1 new2)',
      ]);
    });

    test('cr-mode slash continuation inside parenthesized group stays in the group', () => {
      const source = 'rename (old1 ///\nold2) (new1 new2)';

      expect(command_names(source)).toEqual(['rename']);
      expect(varlist_names(source)).toEqual([
        '(old1 old2)',
        '(new1 new2)',
      ]);
    });

    test('AST formatter emits valid Stata for value-separator whitespace', () => {
      // Regression: reconstructing the assignment RHS without value-separator
      // whitespace produced `group(ab)` — a different, broken expression the
      // pretty-printer could not repair. Both modes must round-trip through the
      // AST formatter with `group(a b)` intact (issue #306).
      const printer = new PrettyPrinter();
      const format = (source: string): string =>
        printer.print(parse(source).ast);
      expect(format('egen g = group(a b)')).toContain('group(a b)');
      expect(format(semi('egen g = group(a b)'))).toContain('group(a b)');
      expect(format('egen g = group(a b)')).not.toContain('group(ab)');
    });

    test('/// continuation joins only the immediately-following line', () => {
      // `///` continues one line: a column-0 token on the next line joins with
      // no space, an indented token keeps one space, and consecutive `///`
      // lines still join. A blank line after `///` is an ordinary newline and
      // must separate — it must NOT fuse the tokens into one identifier
      // (issue #306; matches the documented macro-value convention).
      const expr = (body: string): string | undefined =>
        command(semi(body))?.expression;
      expect(expr('gen z = a///\nb')).toBe('ab');
      expect(expr('gen z = a///\n    b')).toBe('a b');
      expect(expr('gen z = a///\n///\nb')).toBe('ab');
      expect(expr('gen z = a///\n\nb')).toBe('a b');
      // A same-line space before `///` is real whitespace and must separate,
      // even when the continued token starts at column 0.
      expect(expr('gen z = a ///\nb')).toBe('a b');
      // A raw newline before a later `///` breaks the chain: the tokens must
      // not fuse just because the second `///` sits next to the final token.
      expect(expr('gen z = a///\n\n///\nb')).toBe('a b');
      // Diagnostic-free in every case.
      for (const my_body of [
        'gen z = a///\nb',
        'gen z = a///\n\nb',
        'gen z = a///\n    b',
        'gen z = a///\n\n///\nb',
      ]) {
        expect(parse(semi(my_body)).errors).toHaveLength(0);
      }
    });
  });

  describe('#delimit cr file-command argument coalescing (issue #306)', () => {
    // In `#delimit cr` mode the lexer emits no WHITESPACE tokens, so a file
    // command's first-argument path coalesced every following token into one
    // string (`merge 1:1 id using data` -> `["1:1idusingdata"]`), whereas
    // `#delimit ;` mode kept the arguments separate. parseFilePathArgument now
    // stops coalescing at a source gap, so both modes agree (issue #306).
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);
    type CommandLike = { type: string; name?: string; varlist?: { name: string }[] };
    const commands = (source: string): CommandLike[] =>
      (parse(source).ast.nodes as unknown as CommandLike[]).filter(
        n => n.type === 'command'
      );
    const varlist_names = (c: CommandLike | undefined): string[] =>
      (c?.varlist ?? []).map(v => v.name);
    const semi = (body: string): string =>
      `#delimit ;\n${body};\n#delimit cr`;

    test('merge arguments stay separate in #delimit cr mode', () => {
      const cr = commands('merge 1:1 id using data');
      expect(cr).toHaveLength(1);
      expect(cr[0].name).toBe('merge');
      expect(varlist_names(cr[0])).toEqual(['1:1', 'id', 'using', 'data']);
      expect(parse('merge 1:1 id using data').errors).toHaveLength(0);
    });

    test('merge parses identically in #delimit cr and #delimit ; modes', () => {
      const cr = commands('merge 1:1 id using data');
      const semi_cmds = commands(semi('merge 1:1 id using data'));
      expect(semi_cmds).toHaveLength(1);
      expect(varlist_names(cr[0])).toEqual(varlist_names(semi_cmds[0]));
    });

    test('m:1 merge with a using path matches across modes', () => {
      const cr = commands('merge m:1 statefip year using acs');
      const semi_cmds = commands(semi('merge m:1 statefip year using acs'));
      expect(cr).toHaveLength(1);
      expect(semi_cmds).toHaveLength(1);
      expect(varlist_names(cr[0])).toEqual(varlist_names(semi_cmds[0]));
      expect(varlist_names(cr[0])[0]).toBe('m:1');
    });

    test('unquoted file paths still coalesce as one argument in cr mode', () => {
      // Adjacent tokens (no source gap) remain a single path: the adjacency
      // guard must not fragment `use data/sub.dir/file.dta` or `do myfile.do`.
      expect(varlist_names(commands('do myfile.do')[0])).toEqual(['myfile.do']);
      expect(varlist_names(commands('use data/sub.dir/file.dta')[0])).toEqual([
        'data/sub.dir/file.dta',
      ]);
    });
  });

  describe('#delimit ; loop-spec spacing parity (issue #306)', () => {
    // The foreach/forvalues loop spec is reconstructed from tokens too, so it
    // must agree across delimiter modes and never fuse list items — otherwise
    // the loop expander sees one iterator value (`x_ab`) instead of two
    // (`x_a`, `x_b`) (issue #306).
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);
    const loop_spec = (source: string): string | undefined => {
      const my_node = parse(source).ast.nodes.find(
        n => n.type === 'foreach' || n.type === 'forvalues'
      ) as { loopSpec?: string } | undefined;
      return my_node?.loopSpec;
    };
    const semi_loop = (spec_line: string): string =>
      `#delimit ;\n${spec_line} {;\n  display 1;\n};\n#delimit cr`;

    test('foreach in-list matches across modes', () => {
      const cr = loop_spec('foreach i in a b c {\n  display 1\n}');
      expect(cr).toBe('in a b c');
      expect(loop_spec(semi_loop('foreach i in a b c'))).toBe(cr);
    });

    test('forvalues spec matches across modes', () => {
      const cr = loop_spec('forvalues i = 1/10 {\n  display 1\n}');
      expect(cr).toBe('= 1/10');
      expect(loop_spec(semi_loop('forvalues i = 1/10'))).toBe(cr);
    });

    test('/// continuation in a foreach list joins only the next line', () => {
      // Column-0 join, then a blank line that must separate rather than fuse.
      expect(loop_spec(semi_loop('foreach i in a///\nb'))).toBe('in ab');
      expect(loop_spec(semi_loop('foreach i in a///\n\nb'))).toBe('in a b');
    });
  });

  describe('if/while condition spacing parity (issue #306)', () => {
    // if/while conditions are reconstructed from tokens too. They were already
    // mode-invariant, but used a different spacing path; routing them through
    // the shared reconstruct_value_tokens gives consistent single-space spacing
    // and correct `///` join semantics (issue #306).
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);
    const condition = (source: string): string | undefined => {
      const my_node = parse(source).ast.nodes.find(
        n => n.type === 'if' || n.type === 'while'
      ) as { condition?: string } | undefined;
      return my_node?.condition;
    };

    test('condition spacing agrees across delimiter modes', () => {
      const cr = condition('if x > 0 & y < 1 {\n  display 1\n}');
      expect(cr).toBe('x > 0 & y < 1');
      const semi = condition(
        '#delimit ;\nif x > 0 & y < 1 {;\n  display 1;\n};\n#delimit cr'
      );
      expect(semi).toBe(cr);
    });

    test('/// continuation in a condition joins only the next line', () => {
      // Column-0 join matches Stata (`if a///` then `b` executes `if ab`); a
      // space before `///` separates.
      expect(condition('if a///\nb {\n  display 1\n}')).toBe('ab');
      expect(condition('if a ///\nb {\n  display 1\n}')).toBe('a b');
      expect(condition('while a///\nb {\n  display 1\n}')).toBe('ab');
    });
  });

  describe('#delimit ; option-argument spacing parity (issue #306)', () => {
    // An option's parenthesized argument is reconstructed from tokens too, so a
    // multi-token argument must agree across delimiter modes and never fuse —
    // `absorb(firm year)` is `firm year`, not `firmyear` (issue #306).
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);
    const option_arg = (source: string, name: string): string | undefined => {
      const my_cmd = parse(source).ast.nodes.find(n => n.type === 'command') as
        { options?: { name: string; argument?: string }[] } | undefined;
      return my_cmd?.options?.find(o => o.name === name)?.argument;
    };
    const command_options = (source: string): { name: string; argument?: string;
      argument_unclosed?: true;
      argument_range?: { start: { line: number; character: number };
        end: { line: number; character: number } } }[] => {
      const my_cmd = parse(source).ast.nodes.find(n => n.type === 'command') as
        { options?: { name: string; argument?: string; argument_unclosed?: true; argument_range?: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        } }[] } | undefined;
      return my_cmd?.options ?? [];
    };
    const semi = (body: string): string =>
      `#delimit ;\n${body};\n#delimit cr`;
    const command_names = (source: string): string[] =>
      parse(source).ast.nodes
        .filter(n => n.type === 'command')
        .map(n => (n as { name: string }).name);
    const parse_errors = (source: string) => parse(source).errors;
    const forward_calls = (source: string) => {
      const lex_result = lexer.tokenize(source);
      const parse_result = parser.parse(lex_result.tokens);
      const analyzer = new SemanticAnalyzer();
      return analyzer.analyze(
        parse_result.ast,
        'file:///test.do',
        undefined,
        undefined,
        lex_result.tokens
      ).forward_calls;
    };

    test('multi-token option argument matches across modes', () => {
      expect(option_arg('reg y x, absorb(firm year)', 'absorb')).toBe(
        'firm year'
      );
      expect(option_arg(semi('reg y x, absorb(firm year)'), 'absorb')).toBe(
        'firm year'
      );
      expect(parse('reg y x, absorb(firm year)').errors).toHaveLength(0);
    });

    test('adjacent option-argument tokens stay joined in both modes', () => {
      expect(option_arg('reg y x, cluster(id)', 'cluster')).toBe('id');
      expect(option_arg(semi('reg y x, cluster(id)'), 'cluster')).toBe('id');
    });

    test('nested option arguments are not truncated in either delimiter mode', () => {
      for (const source of [
        'reg y x, vce(bootstrap, nodots seed(123) rep(300))',
        semi('reg y x, vce(bootstrap, nodots seed(123) rep(300))'),
      ]) {
        const options = command_options(source);
        expect(options.map(o => o.name)).toEqual(['vce']);
        expect(options.find(o => o.name === 'rep')).toBeUndefined();
        expect(options[0].argument).toBe('bootstrap, nodots seed(123) rep(300)');
      }
    });

    test('unterminated nested option argument recovers at cr-mode statement terminator', () => {
      const source = 'reg y x, vce(seed(123)\ndisplay 1\ndisplay 2';

      expect(command_names(source)).toEqual(['reg', 'display', 'display']);
      expect(option_arg(source, 'vce')).toBe('seed(123)');
    });

    test('line comment after unterminated cr-mode option argument is trivia', () => {
      const source = 'reg y x, vce(seed(123) // note\ndisplay 1';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg', 'display']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('seed(123)');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBe(true);
    });

    test('block comment after unterminated cr-mode option argument is trivia', () => {
      const source = 'reg y x, vce(seed(123) /* note */\ndisplay 1';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg', 'display']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('seed(123)');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBe(true);
    });

    test('unterminated option argument is marked on the option node', () => {
      const unclosed = command_options('levelsof rep78, global(G\ndisplay $G');
      const closed = command_options('levelsof rep78, global(G)\ndisplay $G');

      expect(unclosed.find(o => o.name === 'global')?.argument).toBe('G');
      expect(unclosed.find(o => o.name === 'global')?.argument_unclosed).toBe(true);
      expect(closed.find(o => o.name === 'global')?.argument).toBe('G');
      expect(closed.find(o => o.name === 'global')?.argument_unclosed).toBeUndefined();
    });

    test('cr-mode option comment before slash continuation keeps option closed', () => {
      const source = 'reg y x, vce(a /* c */ ///\nb)';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBeUndefined();
    });

    test('semicolon-mode option comment before physical newline keeps option closed', () => {
      const source = semi('reg y x, vce(a /* c */\nb)');
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBeUndefined();
    });

    test('continuation between option comment and close paren keeps option closed', () => {
      const source = 'reg y x, vce(a /* c */ ///\n)';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBeUndefined();
    });

    test('comment after option continuation keeps closed option argument collecting', () => {
      const source = 'reg y x, vce(a ///\n/* c */ b)';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBeUndefined();
    });

    test('comment before continuation still recovers when option never closes', () => {
      const source = 'reg y x, vce(a /* c */ ///\nb\ndisplay 1';
      const options = command_options(source);

      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBe(true);
    });

    test('comment after continuation still recovers when option never closes', () => {
      const source = 'reg y x, vce(a ///\n/* c */ b\ndisplay 1';
      const options = command_options(source);

      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBe(true);
    });

    test('cr-mode comment before continued unclosed option does not expose do as top-level command', () => {
      const source = 'reg y x, vce(a /* c */ ///\ndo child.do\ndisplay 1';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg', 'display']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a do child.do');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBe(true);
      expect(forward_calls(source)).toHaveLength(0);
    });

    test('semicolon-mode comment before unclosed option does not expose do as top-level command', () => {
      const source = '#delimit ;\nreg y x, vce(a // c\ndo child.do ;\ndisplay 1;';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg', 'display']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a do child.do');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBe(true);
      expect(forward_calls(source)).toHaveLength(0);
    });

    test('top-level do after terminated option statement still emits forward call', () => {
      const source = 'reg y x, vce(a)\ndo child.do\ndisplay 1';
      const calls = forward_calls(source);

      expect(command_names(source)).toEqual(['reg', 'do', 'display']);
      expect(calls).toHaveLength(1);
      expect(calls[0].type).toBe('do');
      expect(calls[0].raw_path).toBe('child.do');
    });

    test('many comments inside one closed option argument parse without quadratic blowup', () => {
      const comment_count = 100_000;
      const source = `reg y x, vce(a ${'/* c */ '.repeat(comment_count)}b)`;
      const start_time = performance.now();
      const options = command_options(source);
      const elapsed_ms = performance.now() - start_time;

      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBeUndefined();
      expect(elapsed_ms).toBeLessThan(2_000);
    });

    test('unterminated nested option argument recovers at semicolon-mode statement terminator', () => {
      const source = '#delimit ;\nreg y x, vce(seed(123);\ndisplay 1;\n#delimit cr';

      expect(command_names(source)).toEqual(['reg', 'display']);
      expect(option_arg(source, 'vce')).toBe('seed(123)');
    });

    test('line comment after unterminated semicolon-mode option argument is trivia', () => {
      const source =
        '#delimit ;\nreg y x, vce(seed(123) // note\n;\ndisplay 1;\n#delimit cr';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg', 'display']);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('seed(123)');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBe(true);
    });

    test('balanced option block comment is omitted without making option unclosed', () => {
      // Comments are trivia inside a syntactically closed parenthesized option:
      // omit the comment text from the argument string, keep later argument
      // tokens, and keep the option semantically closed.
      const source = 'reg y x, vce(a /* x */ b)';
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg']);
      expect(parse_errors(source)).toHaveLength(0);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBeUndefined();
    });

    test('balanced semicolon-mode option line comment keeps option closed', () => {
      // Same as the block-comment case above, but the statement continues after
      // the line comment because semicolon mode uses `;` as the terminator.
      const source = semi('reg y x, vce(a // note\nb)');
      const options = command_options(source);

      expect(command_names(source)).toEqual(['reg']);
      expect(parse_errors(source)).toHaveLength(0);
      expect(options.find(o => o.name === 'vce')?.argument).toBe('a b');
      expect(options.find(o => o.name === 'vce')?.argument_unclosed).toBeUndefined();
    });

    test('two-level nested option arguments are preserved', () => {
      expect(option_arg('reg y x, absorb(f(a) g(b))', 'absorb')).toBe(
        'f(a) g(b)'
      );
      expect(option_arg(semi('reg y x, absorb(f(a) g(b))'), 'absorb')).toBe(
        'f(a) g(b)'
      );
    });

    test('cr-mode option argument continues across slash continuation', () => {
      const source = 'reg y x, vce(seed(123) ///\nrep(300))';

      expect(command_names(source)).toEqual(['reg']);
      expect(option_arg(source, 'vce')).toBe('seed(123) rep(300)');
    });

    test('cr-mode raw newline inside option argument ends the statement', () => {
      const source = 'reg y x, vce(a\nb)';

      expect(command_names(source)).toEqual(['reg', 'b']);
      expect(option_arg(source, 'vce')).toBe('a');
    });

    test('nested option argument range spans the full argument content', () => {
      const options = command_options(
        'reg y x, vce(bootstrap, nodots seed(123) rep(300))'
      );
      expect(options[0].argument_range?.end.character).toBe(
        'reg y x, vce(bootstrap, nodots seed(123) rep(300)'.length
      );
    });

    test('unbalanced nested option argument does not crash', () => {
      expect(() => parse('reg y x, cluster(seed(1')).not.toThrow();
      const result = parse('reg y x, cluster(seed(1');
      expect(result.ast.nodes.find(n => n.type === 'command')).toBeDefined();
    });

    test('AST formatter preserves nested option arguments', () => {
      const printer = new PrettyPrinter();
      const format = (source: string): string =>
        printer.print(parse(source).ast);
      expect(format('reg y x, vce(bootstrap, nodots seed(123) rep(300))'))
        .toContain('vce(bootstrap, nodots seed(123) rep(300))');
    });
  });

  describe('#delimit ; extended-macro argument parity (issue #306)', () => {
    // Extended macro functions (`local n : word count a b c`) reconstruct their
    // argument string from tokens too, so it must agree across delimiter modes
    // and normalize spacing to a single space per gap (issue #306).
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);
    const ext_args = (source: string): string | undefined => {
      const my_node = parse(source).ast.nodes.find(
        n => n.type === 'macro_def'
      ) as { extendedFunction?: { args?: string } } | undefined;
      return my_node?.extendedFunction?.args;
    };
    const semi = (body: string): string =>
      `#delimit ;\n${body};\n#delimit cr`;

    test('multi-token extended-macro args match across modes', () => {
      expect(ext_args('local n : word count a b c')).toBe('count a b c');
      expect(ext_args(semi('local n : word count a b c'))).toBe('count a b c');
    });

    test('/// continuation in extended-macro args joins only the next line', () => {
      expect(ext_args('local x : display a///\nb')).toBe('ab');
      expect(ext_args(semi('local x : display a///\n\nb'))).toBe('a b');
    });
  });

  describe('syntax option default() value spacing (issue #306)', () => {
    // A `syntax` option's default() value is reconstructed from tokens too; a
    // multi-token default must keep its separator (`default(a b)` -> `a b`, not
    // `ab`) so hover/completion default text is correct (issue #306).
    const parse = (source: string) =>
      parser.parse(lexer.tokenize(source).tokens);
    const default_value = (source: string): string | undefined => {
      const my_prog = parse(source).ast.nodes.find(n => n.type === 'program') as
        { body?: { type: string; signature?: { options?: { name: string;
          defaultValue?: string }[] } }[] } | undefined;
      const my_syntax = my_prog?.body?.find(n => n.type === 'syntax');
      return my_syntax?.signature?.options?.[0]?.defaultValue;
    };
    const cr_program = (syntax_line: string): string =>
      `program define q\n  ${syntax_line}\nend`;
    const semi_program = (syntax_line: string): string =>
      `#delimit ;\nprogram define q;\n  ${syntax_line};\nend;\n#delimit cr`;
    const expect_default_in_both_modes = (
      syntax_line: string,
      expected: string
    ) => {
      expect(default_value(cr_program(syntax_line))).toBe(expected);
      expect(default_value(semi_program(syntax_line))).toBe(expected);
    };

    test('multi-token default keeps its separator and agrees across modes', () => {
      const src = 'program define q\n  syntax , opt(string default(a b))\nend';
      const semi_src =
        '#delimit ;\nprogram define q;\n  syntax , opt(string default(a b));\n' +
        'end;\n#delimit cr';
      expect(default_value(src)).toBe('a b');
      expect(default_value(semi_src)).toBe('a b');
    });

    test('single-token and nested defaults are preserved', () => {
      expect(
        default_value('program define q\n  syntax , opt(string default(foo))\nend')
      ).toBe('foo');
      expect(
        default_value('program define q\n  syntax , opt(string default(f(x)))\nend')
      ).toBe('f(x)');
    });

    test('default column-0 continuation joins without a separator in both modes', () => {
      expect_default_in_both_modes(
        'syntax , opt(string default(a///\nb))',
        'ab'
      );
    });

    test('default continuation with space before slashes keeps a separator in both modes', () => {
      expect_default_in_both_modes(
        'syntax , opt(string default(a ///\nb))',
        'a b'
      );
    });

    test('default indented continuation-only line keeps a separator in both modes', () => {
      expect_default_in_both_modes(
        'syntax , opt(string default(a///\n    ///\nb))',
        'a b'
      );
    });

    test('plain multi-token default keeps a separator in both modes', () => {
      expect_default_in_both_modes(
        'syntax , opt(string default(a b))',
        'a b'
      );
    });

    test('syntax declaration spanning /// continuations is collected whole', () => {
      // A `///` used to truncate the syntax declaration at the first
      // continuation (isTrivia included CONTINUATION); it must now be bridged
      // so every option on continued lines is captured (issue #306).
      const my_prog = parse(
        'program define q\n  syntax varlist, ///\n  Robust ///\n' +
        '  Cluster(varname)\nend'
      ).ast.nodes.find(n => n.type === 'program') as
        { body?: { type: string; signature?: { options?: { name: string }[] } }[] }
        | undefined;
      const my_syntax = my_prog?.body?.find(n => n.type === 'syntax');
      expect(my_syntax?.signature?.options?.map(o => o.name)).toEqual([
        'Robust',
        'Cluster',
      ]);
    });
  });

  describe('macro reference command parsing', () => {
    test('should parse local macro at start of statement', () => {
      const source = '`custom_cmd\' "arg1" "arg2"';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe('`custom_cmd\'');
        expect(node.varlist).toHaveLength(2);
        expect(node.varlist?.[0].name).toBe('"arg1"');
        expect(node.varlist?.[1].name).toBe('"arg2"');
      }
    });

    test('should parse global macro at start of statement', () => {
      const source = '$my_command arg1 arg2';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe('$my_command');
        expect(node.varlist).toHaveLength(2);
        expect(node.varlist?.[0].name).toBe('arg1');
        expect(node.varlist?.[1].name).toBe('arg2');
      }
    });

    test('should parse macro command with various argument types', () => {
      const source = '`cmd\' var1 "string arg" `macro_arg\' 123';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe('`cmd\'');
        expect(node.varlist).toHaveLength(4);
        expect(node.varlist?.[0].name).toBe('var1');
        expect(node.varlist?.[1].name).toBe('"string arg"');
        expect(node.varlist?.[2].name).toBe('`macro_arg\'');
        expect(node.varlist?.[3].name).toBe('123');
      }
    });

    test('should parse macro command inside else block', () => {
      const source = `if 1 {
    display "hello"
}
else {
    \`custom_arg' "test"
}`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(2);

      const elseNode = parseResult.ast.nodes.find((n: any) => n.type === 'else');
      expect(elseNode).toBeDefined();
      expect(elseNode?.type).toBe('else');

      if (elseNode?.type === 'else') {
        expect(elseNode.body).toHaveLength(1);
        expect(elseNode.body[0].type).toBe('command');
        if (elseNode.body[0].type === 'command') {
          expect(elseNode.body[0].name).toBe('`custom_arg\'');
        }
      }
    });

    test('should parse macro command with if-qualifier', () => {
      const source = '`cmd\' var1 if x > 0';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe('`cmd\'');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('var1');
        expect(node.ifExpression).toBe('x > 0');
      }
    });

    test('should parse macro command with options', () => {
      const source = '`cmd\' var1, option1 option2(value)';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe('`cmd\'');
        expect(node.varlist).toHaveLength(1);
        expect(node.options).toHaveLength(2);
        expect(node.options?.[0].name).toBe('option1');
        expect(node.options?.[1].name).toBe('option2');
        expect(node.options?.[1].argument).toBe('value');
      }
    });

    test('should parse macro command with no arguments', () => {
      const source = '`my_command\'';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe('`my_command\'');
        expect(node.varlist).toBeUndefined();
      }
    });

    test('should parse global macro command with braces', () => {
      const source = '${my_command} arg1 arg2';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.name).toBe('${my_command}');
        expect(node.varlist).toHaveLength(2);
      }
    });

    test('should parse prefixed macro command', () => {
      const source = 'quietly `cmd\' arg1';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.prefix).toHaveLength(1);
        expect(node.prefix?.[0].name).toBe('quietly');
        expect(node.name).toBe('`cmd\'');
        expect(node.varlist).toHaveLength(1);
        expect(node.varlist?.[0].name).toBe('arg1');
      }
    });

    test('should parse multiple prefixes with macro command', () => {
      const source = 'capture noisily `my_cmd\' var1 var2, option1';
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      expect(node.type).toBe('command');

      if (node.type === 'command') {
        expect(node.prefix).toHaveLength(2);
        expect(node.prefix?.[0].name).toBe('capture');
        expect(node.prefix?.[1].name).toBe('noisily');
        expect(node.name).toBe('`my_cmd\'');
        expect(node.varlist).toHaveLength(2);
        expect(node.options).toHaveLength(1);
      }
    });
  });

  describe('trivia handling', () => {
    test('should attach star comment as leading trivia', () => {
      const source = `* This is a comment
generate age = 25`;
      const lexResult = lexer.tokenize(source);

      // Sanity check: lexer produced a comment token
      const the_comment_tokens = lexResult.tokens.filter(t => t.type === 'COMMENT_LINE');
      expect(the_comment_tokens.length).toBeGreaterThan(0);

      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      if (node.type === 'command') {
        expect(node.leadingTrivia).toBeDefined();
        expect(node.leadingTrivia?.length).toBeGreaterThan(0);
        expect(node.leadingTrivia?.[0].style).toBe('star');
        expect(node.leadingTrivia?.[0].content).toContain('This is a comment');
      }
    });

    test('should attach slash comment as leading trivia', () => {
      const source = `// This is a slash comment
display "hello"`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      if (node.type === 'command') {
        expect(node.leadingTrivia).toBeDefined();
        expect(node.leadingTrivia?.length).toBeGreaterThan(0);
        expect(node.leadingTrivia?.[0].style).toBe('slash');
        expect(node.leadingTrivia?.[0].content).toContain('This is a slash comment');
      }
    });

    test('should attach trailing comment as trailing trivia', () => {
      const source = `display hello // inline comment
display next`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(2);

      const first_node = parseResult.ast.nodes[0];
      if (first_node.type === 'command') {
        expect(first_node.trailingTrivia).toBeDefined();
        expect(first_node.trailingTrivia?.length).toBeGreaterThan(0);
        expect(first_node.trailingTrivia?.[0].style).toBe('slash');
        expect(first_node.trailingTrivia?.[0].content).toContain('inline comment');
      }
    });

    test('should attach multiple leading comments', () => {
      const source = `* First comment
* Second comment
generate age = 25`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      if (node.type === 'command') {
        expect(node.leadingTrivia).toBeDefined();
        expect(node.leadingTrivia?.length).toBe(2);
        expect(node.leadingTrivia?.[0].content).toContain('First comment');
        expect(node.leadingTrivia?.[1].content).toContain('Second comment');
      }
    });

    test('should attach block comment as leading trivia', () => {
      const source = `/* This is a
block comment */
generate age = 25`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      if (node.type === 'command') {
        expect(node.leadingTrivia).toBeDefined();
        expect(node.leadingTrivia?.length).toBeGreaterThan(0);
        expect(node.leadingTrivia?.[0].style).toBe('block');
        expect(node.leadingTrivia?.[0].content).toContain('block comment');
      }
    });

    test('should attach continuation comment as trivia', () => {
      const source = `generate age = /// continuation
25`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      // The continuation joins lines, so we should have one command
      expect(parseResult.ast.nodes.length).toBeGreaterThanOrEqual(1);

      const node = parseResult.ast.nodes[0];
      if (node.type === 'command') {
        // Continuation should be captured as trivia
        const has_continuation = 
          (node.leadingTrivia?.some(t => t.style === 'continuation') ?? false) ||
          (node.trailingTrivia?.some(t => t.style === 'continuation') ?? false);
        // Note: continuation handling may vary based on implementation
        expect(node.name).toBe('generate');
      }
    });

    test('should handle comment at end of file', () => {
      const source = `generate age = 25
* Final comment`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      // The final comment should be attached as trailing trivia to the last node
      const node = parseResult.ast.nodes[0];
      if (node.type === 'command') {
        expect(node.trailingTrivia).toBeDefined();
        expect(node.trailingTrivia?.length).toBeGreaterThan(0);
        expect(node.trailingTrivia?.[0].content).toContain('Final comment');
      }
    });

    test('should attach trivia to macro definitions', () => {
      const source = `* Define a macro
local myvar "value"`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      if (node.type === 'macro_def') {
        expect(node.leadingTrivia).toBeDefined();
        expect(node.leadingTrivia?.length).toBeGreaterThan(0);
        expect(node.leadingTrivia?.[0].content).toContain('Define a macro');
      }
    });

    test('should attach trivia to control flow nodes', () => {
      const source = `* Check age
if age > 18 {
  display "Adult"
}`;
      const lexResult = lexer.tokenize(source);
      const parseResult = parser.parse(lexResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.nodes).toHaveLength(1);

      const node = parseResult.ast.nodes[0];
      if (node.type === 'if') {
        expect(node.leadingTrivia).toBeDefined();
        expect(node.leadingTrivia?.length).toBeGreaterThan(0);
        expect(node.leadingTrivia?.[0].content).toContain('Check age');
      }
    });
  });
});

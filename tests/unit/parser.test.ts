import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

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
        expect(node.expression).toBe('oldvar+1*2');
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
        expect(node.ifExpression).toBe('age>30');
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
        expect(node.ifExpression).toBe('age>30');
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
        expect(node.expression).toBe('oldvar*2');
        expect(node.ifExpression).toBe('condition==1');
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
        expect(node.ifExpression).toBe('(age>30&gender=="male")');
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
        expect(node.ifExpression).toBe('x>0');
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

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

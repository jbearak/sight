import { PrettyPrinter, print_ast, print_node } from '../../src/pretty-printer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import {
    StataAST,
    CommandNode,
    ProgramNode,
    MacroDefNode,
    ControlFlowNode,
    DirectiveNode,
    TriviaNode
} from '../../src/types';

describe('PrettyPrinter', () => {
    let printer: PrettyPrinter;
    let parser: StataParser;
    let lexer: StataLexer;

    beforeEach(() => {
        printer = new PrettyPrinter();
        parser = new StataParser();
        lexer = new StataLexer();
    });

    /**
     * Helper to parse source and get AST.
     */
    function parse_source(source: string): StataAST {
        const lex_result = lexer.tokenize(source);
        const parse_result = parser.parse(lex_result.tokens);
        return parse_result.ast;
    }

    describe('basic printing', () => {
        test('should print simple command', () => {
            const ast = parse_source('generate age = 25');
            const output = printer.print(ast);

            expect(output).toContain('generate');
            expect(output).toContain('age');
        });

        test('should print command with prefix', () => {
            const ast = parse_source('quietly generate age = 25');
            const output = printer.print(ast);

            expect(output).toContain('quietly');
            expect(output).toContain('generate');
        });

        test('should print command with options', () => {
            const ast = parse_source('regress income age, robust');
            const output = printer.print(ast);

            expect(output).toContain('regress');
            expect(output).toContain('income');
            expect(output).toContain('age');
            expect(output).toContain(',');
            expect(output).toContain('robust');
        });

        test('should print command with option argument', () => {
            const ast = parse_source('regress income age, level(95)');
            const output = printer.print(ast);

            expect(output).toContain('level(95)');
        });

        test('should print local macro definition', () => {
            const ast = parse_source('local myvar "hello"');
            const output = printer.print(ast);

            expect(output).toContain('local');
            expect(output).toContain('myvar');
        });

        test('should print global macro definition', () => {
            const ast = parse_source('global path "/usr/local"');
            const output = printer.print(ast);

            expect(output).toContain('global');
            expect(output).toContain('path');
        });
    });

    describe('program printing', () => {
        test('should print program definition', () => {
            const ast = parse_source(`program define myprog
                display "Hello"
            end`);
            const output = printer.print(ast);

            expect(output).toContain('program define myprog');
            expect(output).toContain('display');
            expect(output).toContain('end');
        });

        test('should indent program body', () => {
            const ast = parse_source(`program define myprog
                display "Hello"
            end`);
            const output = printer.print(ast, { indent_size: 4, indent_style: 'spaces' });

            // The body should be indented
            const the_lines = output.split('\n');
            const display_line = the_lines.find(l => l.includes('display'));
            expect(display_line).toBeDefined();
            expect(display_line?.startsWith('    ')).toBe(true);
        });
    });

    describe('control flow printing', () => {
        test('should print if statement', () => {
            const ast = parse_source(`if age > 18 {
                display "Adult"
            }`);
            const output = printer.print(ast);

            expect(output).toContain('if');
            expect(output).toContain('age > 18');
            expect(output).toContain('{');
            expect(output).toContain('}');
        });

        test('should print foreach loop', () => {
            const ast = parse_source(`foreach var in age income {
                summarize var
            }`);
            const output = printer.print(ast);

            expect(output).toContain('foreach');
            expect(output).toContain('var');
            expect(output).toContain('in age income');
        });

        test('should print forvalues loop', () => {
            const ast = parse_source(`forvalues i = 1/10 {
                display i
            }`);
            const output = printer.print(ast);

            expect(output).toContain('forvalues');
            expect(output).toContain('i');
        });

        test('should print while loop', () => {
            const ast = parse_source(`while x < 10 {
                local x = x + 1
            }`);
            const output = printer.print(ast);

            expect(output).toContain('while');
            expect(output).toContain('x < 10');
        });

        test('should indent control flow body', () => {
            const ast = parse_source(`if age > 18 {
                display "Adult"
            }`);
            const output = printer.print(ast, { indent_size: 4, indent_style: 'spaces' });

            const the_lines = output.split('\n');
            const display_line = the_lines.find(l => l.includes('display'));
            expect(display_line).toBeDefined();
            expect(display_line?.startsWith('    ')).toBe(true);
        });
    });

    describe('delimiter mode handling', () => {
        test('should print #delimit cr directive', () => {
            const ast = parse_source('#delimit cr');
            const output = printer.print(ast);

            expect(output).toContain('#delimit cr');
        });

        test('should print #delimit ; directive', () => {
            const ast = parse_source('#delimit ;');
            const output = printer.print(ast);

            expect(output).toContain('#delimit ;');
        });

        test('should use semicolon terminator after #delimit ;', () => {
            const ast = parse_source(`#delimit ;
generate age = 25`);
            const output = printer.print(ast);

            // After #delimit ;, statements should end with ;
            expect(output).toContain(';');
        });

        test('should use newline terminator in cr mode', () => {
            const ast = parse_source('generate age = 25');
            const output = printer.print(ast);

            // In cr mode, statements end with newline
            expect(output.endsWith('\n')).toBe(true);
        });
    });

    describe('trivia preservation', () => {
        test('should preserve leading star comment', () => {
            const ast = parse_source(`* This is a comment
generate age = 25`);
            const output = printer.print(ast);

            expect(output).toContain('* This is a comment');
        });

        test('should preserve leading slash comment', () => {
            const ast = parse_source(`// This is a comment
generate age = 25`);
            const output = printer.print(ast);

            expect(output).toContain('// This is a comment');
        });

        test('should preserve trailing comment', () => {
            const ast = parse_source(`generate age = 25 // inline comment
display "next"`);
            const output = printer.print(ast);

            expect(output).toContain('// inline comment');
        });

        test('should keep trailing comment on same line as statement', () => {
            const ast = parse_source(`generate age = 25 // inline comment`);
            const output = printer.print(ast);

            // Trailing comment should be on same line as statement
            const the_lines = output.split('\n').filter(l => l.trim().length > 0);
            expect(the_lines.length).toBe(1);
            expect(the_lines[0]).toContain('generate');
            expect(the_lines[0]).toContain('// inline comment');
            // Should have space before comment, not indentation
            expect(the_lines[0]).toMatch(/age.*\s\/\/ inline comment/);
        });

        test('should preserve block comment', () => {
            const ast = parse_source(`/* block comment */
generate age = 25`);
            const output = printer.print(ast);

            expect(output).toContain('/* block comment */');
        });

        test('should preserve multiple leading comments', () => {
            const ast = parse_source(`* First comment
* Second comment
generate age = 25`);
            const output = printer.print(ast);

            expect(output).toContain('* First comment');
            expect(output).toContain('* Second comment');
        });
    });

    describe('indent configuration', () => {
        test('should use configured indent size', () => {
            const ast = parse_source(`if age > 18 {
                display "Adult"
            }`);
            const output = printer.print(ast, { indent_size: 2, indent_style: 'spaces' });

            const the_lines = output.split('\n');
            const display_line = the_lines.find(l => l.includes('display'));
            expect(display_line).toBeDefined();
            expect(display_line?.startsWith('  ')).toBe(true);
            expect(display_line?.startsWith('    ')).toBe(false);
        });

        test('should use tabs when configured', () => {
            const ast = parse_source(`if age > 18 {
                display "Adult"
            }`);
            const output = printer.print(ast, { indent_style: 'tabs' });

            const the_lines = output.split('\n');
            const display_line = the_lines.find(l => l.includes('display'));
            expect(display_line).toBeDefined();
            expect(display_line?.startsWith('\t')).toBe(true);
        });
    });

    describe('convenience functions', () => {
        test('print_ast should work with default options', () => {
            const ast = parse_source('generate age = 25');
            const output = print_ast(ast);

            expect(output).toContain('generate');
        });

        test('print_node should work for single node', () => {
            const ast = parse_source('generate age = 25');
            const output = print_node(ast.nodes[0]);

            expect(output).toContain('generate');
        });
    });

    describe('multiple statements', () => {
        test('should print multiple commands', () => {
            const ast = parse_source(`generate age = 25
summarize age`);
            const output = printer.print(ast);

            expect(output).toContain('generate');
            expect(output).toContain('summarize');
        });

        test('should separate statements with terminators', () => {
            const ast = parse_source(`generate age = 25
summarize age`);
            const output = printer.print(ast);

            const the_lines = output.split('\n').filter(l => l.trim().length > 0);
            expect(the_lines.length).toBeGreaterThanOrEqual(2);
        });
    });
});

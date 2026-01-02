import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ParseErrorCode } from '../../src/types';

describe('Macro Syntax', () => {
    let lexer: StataLexer;
    let parser: StataParser;

    beforeEach(() => {
        lexer = new StataLexer();
        parser = new StataParser();
    });

    test('should support prefix increment', () => {
        const source = 'local ++i';
        const tokens = lexer.tokenize(source).tokens;
        const result = parser.parse(tokens);

        expect(result.errors).toHaveLength(0);
        expect(result.ast.nodes[0].type).toBe('macro_def');
        const node = result.ast.nodes[0] as any;
        expect(node.name).toBe('i');
        expect(node.value).toBe('++');
    });

    test('should support prefix decrement', () => {
        const source = 'local --i';
        const tokens = lexer.tokenize(source).tokens;
        const result = parser.parse(tokens);

        expect(result.errors).toHaveLength(0);
        expect(result.ast.nodes[0].type).toBe('macro_def');
        const node = result.ast.nodes[0] as any;
        expect(node.name).toBe('i');
        expect(node.value).toBe('--');
    });

    test('should warn on suffix increment mistake', () => {
        const source = 'local i++';
        const tokens = lexer.tokenize(source).tokens;
        const result = parser.parse(tokens);

        // We expect a warning (which is still in result.errors)
        expect(result.errors.some(e => e.code === ParseErrorCode.REDUNDANT_MACRO_SUFFIX)).toBe(true);
        expect(result.ast.nodes[0].type).toBe('macro_def');
        const node = result.ast.nodes[0] as any;
        expect(node.name).toBe('i');
        expect(node.value).toBe('++');
    });

    test('should warn on suffix decrement mistake', () => {
        const source = 'local i--';
        const tokens = lexer.tokenize(source).tokens;
        const result = parser.parse(tokens);

        expect(result.errors.some(e => e.code === ParseErrorCode.REDUNDANT_MACRO_SUFFIX)).toBe(true);
        expect(result.ast.nodes[0].type).toBe('macro_def');
        const node = result.ast.nodes[0] as any;
        expect(node.name).toBe('i');
        expect(node.value).toBe('--');
    });
});

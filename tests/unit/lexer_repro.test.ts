import { StataLexer } from '../../src/lexer';
import { LexerErrorCode } from '../../src/types';

describe('StataLexer Repro', () => {
    let lexer: StataLexer;

    beforeEach(() => {
        lexer = new StataLexer();
    });

    test('should not consume newline in unclosed string and report error', () => {
        const source = 'di "unclosed string\nlocal x = 1';
        const result = lexer.tokenize(source);

        // Check that we have tokens after the string
        const localToken = result.tokens.find(t => t.type === 'WORD' && t.value === 'local');

        // With the fix, 'local' should be tokenized as a WORD on the next line
        expect(localToken).toBeDefined();

        // Check the string content
        const stringToken = result.tokens.find(t => t.type === 'STRING');
        expect(stringToken).toBeDefined();
        expect(stringToken?.value).not.toContain('\n');
        expect(stringToken?.value).toBe('"unclosed string');

        // Check for error
        const error = result.errors.find(e => e.code === LexerErrorCode.UNBALANCED_QUOTES);
        expect(error).toBeDefined();
        expect(error?.range.start.line).toBe(0);
    });

    test('should not consume newline in unclosed compound string and report error', () => {
        const source = 'di `"unclosed string\nlocal x = 1';
        const result = lexer.tokenize(source);

        // Check that we have tokens after the string
        const localToken = result.tokens.find(t => t.type === 'WORD' && t.value === 'local');

        // With the fix, 'local' should be tokenized as a WORD on the next line
        expect(localToken).toBeDefined();

        // Check the string content
        const stringToken = result.tokens.find(t => t.type === 'STRING');
        expect(stringToken).toBeDefined();
        expect(stringToken?.value).not.toContain('\n');
        expect(stringToken?.value).toBe('`"unclosed string');

        // Check for error
        const error = result.errors.find(e => e.code === LexerErrorCode.UNBALANCED_QUOTES);
        expect(error).toBeDefined();
        expect(error?.range.start.line).toBe(0);
    });
});

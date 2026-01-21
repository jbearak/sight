/**
 * Unit tests for extended macro context detection in DefinitionProvider
 */

import { Position } from 'vscode-languageserver';
import { DefinitionProvider } from '../../src/providers/definition';
import { DocumentState } from '../../src/document-store';

describe('DefinitionProvider - Extended Macro Context Detection', () => {
    let provider: DefinitionProvider;
    
    beforeEach(() => {
        provider = new DefinitionProvider();
    });

    const create_test_document = (content: string): DocumentState => {
        return {
            uri: 'file:///test.do',
            content,
            version: 1,
            symbols: {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map(),
                scalars: new Map(),
                matrices: new Map(),
                variables: new Map(),
            },
            ast: null,
            tokens: [],
            line_offsets: [],
        };
    };

    const test_context_detection = (
        content: string,
        line: number,
        character: number,
        expected: boolean
    ) => {
        const document = create_test_document(content);
        const position: Position = { line, character };
        
        // Access private method using bracket notation
        const result = (provider as any).is_in_extended_macro_context(document, position);
        
        expect(result).toBe(expected);
    };

    describe('Positive cases - should detect extended macro context', () => {
        test('local macro with list function', () => {
            test_context_detection('local x : list a', 0, 14, true);
        });

        test('local macro with list function and pipe operator', () => {
            test_context_detection('local x : list a | b', 0, 16, true);
        });

        test('global macro with list function', () => {
            test_context_detection('global y : list c', 0, 16, true);
        });

        test('local macro with word function', () => {
            test_context_detection('local x : word 1 of a', 0, 20, true);
        });

        test('global macro with word function', () => {
            test_context_detection('global y : word 2 of b', 0, 21, true);
        });

        test('local macro with piece function', () => {
            test_context_detection('local x : piece 1 3 of a', 0, 23, true);
        });

        test('global macro with piece function', () => {
            test_context_detection('global y : piece 2 4 of b', 0, 24, true);
        });

        test('with leading whitespace', () => {
            test_context_detection('    local x : list a', 0, 18, true);
        });

        test('with extra spaces around colon', () => {
            test_context_detection('local x  :  list a', 0, 17, true);
        });
    });

    describe('Negative cases - should not detect extended macro context', () => {
        test('regular local assignment', () => {
            test_context_detection('local x = 5', 0, 10, false);
        });

        test('tab command with variable', () => {
            test_context_detection('tab varname', 0, 4, false);
        });

        test('display command', () => {
            test_context_detection('display "hello"', 0, 8, false);
        });

        test('local without colon syntax', () => {
            test_context_detection('local myvar something', 0, 12, false);
        });

        test('non-list extended function', () => {
            test_context_detection('local x : display "test"', 0, 18, false);
        });

        test('comment line', () => {
            test_context_detection('* local x : list a', 0, 17, false);
        });

        test('position before list keyword', () => {
            test_context_detection('local x : list a', 0, 8, false);
        });
    });

    describe('Edge cases', () => {
        test('empty line', () => {
            test_context_detection('', 0, 0, false);
        });

        test('position at end of line', () => {
            test_context_detection('local x : list a', 0, 15, true);
        });

        test('uppercase keywords should NOT match (Stata is case-sensitive)', () => {
            test_context_detection('LOCAL x : LIST a', 0, 15, false);
        });
    });
});


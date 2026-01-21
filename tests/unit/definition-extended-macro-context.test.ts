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
            tokens: null,
            line_offsets: null,
        };
    };

    const test_context_detection = (
        content: string,
        line: number,
        character: number,
        expected: boolean,
        description: string
    ) => {
        const document = create_test_document(content);
        const position: Position = { line, character };
        
        // Access private method using bracket notation
        const result = (provider as any).is_in_extended_macro_context(document, position);
        
        expect(result).toBe(expected);
    };

    describe('Positive cases - should detect extended macro context', () => {
        test('local macro with list function', () => {
            test_context_detection(
                'local x : list a',
                0, 14, // position at 'a'
                true,
                'local x : list a'
            );
        });

        test('local macro with list function and pipe operator', () => {
            test_context_detection(
                'local x : list a | b',
                0, 16, // position at 'a'
                true,
                'local x : list a | b'
            );
        });

        test('global macro with list function', () => {
            test_context_detection(
                'global y : list c',
                0, 16, // position at 'c'
                true,
                'global y : list c'
            );
        });

        test('with leading whitespace', () => {
            test_context_detection(
                '    local x : list a',
                0, 18, // position at 'a'
                true,
                'with leading whitespace'
            );
        });

        test('with extra spaces around colon', () => {
            test_context_detection(
                'local x  :  list a',
                0, 17, // position at 'a'
                true,
                'with extra spaces around colon'
            );
        });
    });

    describe('Negative cases - should not detect extended macro context', () => {
        test('regular local assignment', () => {
            test_context_detection(
                'local x = 5',
                0, 10, // position at '5'
                false,
                'local x = 5'
            );
        });

        test('tab command with variable', () => {
            test_context_detection(
                'tab varname',
                0, 4, // position at 'varname'
                false,
                'tab varname'
            );
        });

        test('display command', () => {
            test_context_detection(
                'display "hello"',
                0, 8, // position at '"hello"'
                false,
                'display "hello"'
            );
        });

        test('local without colon syntax', () => {
            test_context_detection(
                'local myvar something',
                0, 12, // position at 'something'
                false,
                'local myvar something'
            );
        });

        test('non-list extended function', () => {
            test_context_detection(
                'local x : display "test"',
                0, 18, // position at '"test"'
                false,
                'local x : display "test"'
            );
        });

        test('comment line', () => {
            test_context_detection(
                '* local x : list a',
                0, 17, // position at 'a'
                false,
                'comment line'
            );
        });

        test('position before list keyword', () => {
            test_context_detection(
                'local x : list a',
                0, 8, // position at ':'
                false,
                'position before list keyword'
            );
        });
    });

    describe('Edge cases', () => {
        test('empty line', () => {
            test_context_detection(
                '',
                0, 0,
                false,
                'empty line'
            );
        });

        test('position at end of line', () => {
            test_context_detection(
                'local x : list a',
                0, 15, // position at end
                true,
                'position at end of line'
            );
        });

        test('uppercase keywords should NOT match (Stata is case-sensitive)', () => {
            test_context_detection(
                'LOCAL x : LIST a',
                0, 15, // position at 'a'
                false,
                'uppercase keywords should not match'
            );
        });
    });
});
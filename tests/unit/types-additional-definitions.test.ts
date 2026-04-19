import { describe, it, expect } from 'bun:test';
import type { ProgramSymbol, ScalarSymbol, MatrixSymbol } from '../../src/types';

describe('additional_definitions type field exists on non-macro symbols', () => {
    it('ProgramSymbol accepts additional_definitions', () => {
        const program_symbol: ProgramSymbol = {
            name: 'foo',
            location: {
                uri: 'file:///a.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            },
            sourceUri: 'file:///a.do',
            additional_definitions: [
                {
                    index: 5,
                    line: 10,
                    location: {
                        uri: 'file:///a.do',
                        range: {
                            start: { line: 10, character: 0 },
                            end: { line: 10, character: 10 },
                        },
                    },
                },
            ],
        };
        expect(program_symbol.additional_definitions?.length).toBe(1);
    });

    it('ScalarSymbol accepts additional_definitions', () => {
        const scalar_symbol: ScalarSymbol = {
            name: 's',
            location: {
                uri: 'file:///a.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            },
            sourceUri: 'file:///a.do',
            additional_definitions: [
                {
                    index: 2,
                    line: 3,
                    location: {
                        uri: 'file:///a.do',
                        range: {
                            start: { line: 3, character: 0 },
                            end: { line: 3, character: 10 },
                        },
                    },
                },
            ],
        };
        expect(scalar_symbol.additional_definitions?.length).toBe(1);
    });

    it('MatrixSymbol accepts additional_definitions', () => {
        const matrix_symbol: MatrixSymbol = {
            name: 'm',
            location: {
                uri: 'file:///a.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            },
            sourceUri: 'file:///a.do',
            additional_definitions: [
                {
                    index: 4,
                    line: 7,
                    location: {
                        uri: 'file:///a.do',
                        range: {
                            start: { line: 7, character: 0 },
                            end: { line: 7, character: 10 },
                        },
                    },
                },
            ],
        };
        expect(matrix_symbol.additional_definitions?.length).toBe(1);
    });
});

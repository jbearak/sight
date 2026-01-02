import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ForwardCall } from '../../src/types';

describe('ForwardScopeResolver.filter_calls_before_line()', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
    });

    /**
     * Helper to create a ForwardCall with minimal required fields
     */
    function create_forward_call(line: number, path_str: string = 'test.do'): ForwardCall {
        return {
            type: 'do',
            raw_path: path_str,
            path: `/test/${path_str}`,
            call_site_line: line,
            is_static: true,
            range: {
                start: { line, character: 0 },
                end: { line, character: 10 },
            },
        };
    }

    describe('empty array', () => {
        it('should return empty array when given empty array', () => {
            const result = forward_resolver.filter_calls_before_line([], 10);
            expect(result).toEqual([]);
        });

        it('should return empty array when given empty array with line 0', () => {
            const result = forward_resolver.filter_calls_before_line([], 0);
            expect(result).toEqual([]);
        });
    });

    describe('all calls before line', () => {
        it('should return all calls when all are before the line', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(5, 'a.do'),
                create_forward_call(10, 'b.do'),
                create_forward_call(15, 'c.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 20);

            expect(result.length).toBe(3);
            expect(result[0].raw_path).toBe('a.do');
            expect(result[1].raw_path).toBe('b.do');
            expect(result[2].raw_path).toBe('c.do');
        });

        it('should sort calls by call_site_line ascending', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(15, 'c.do'),
                create_forward_call(5, 'a.do'),
                create_forward_call(10, 'b.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 20);

            expect(result.length).toBe(3);
            expect(result[0].call_site_line).toBe(5);
            expect(result[1].call_site_line).toBe(10);
            expect(result[2].call_site_line).toBe(15);
        });
    });

    describe('all calls after line', () => {
        it('should return empty array when all calls are after the line', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(25, 'a.do'),
                create_forward_call(30, 'b.do'),
                create_forward_call(35, 'c.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 20);

            expect(result).toEqual([]);
        });

        it('should return empty array when all calls are at or after the line', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(20, 'a.do'),
                create_forward_call(25, 'b.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 20);

            expect(result).toEqual([]);
        });
    });

    describe('mixed calls', () => {
        it('should filter and sort mixed calls correctly', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(25, 'after1.do'),
                create_forward_call(5, 'before1.do'),
                create_forward_call(30, 'after2.do'),
                create_forward_call(15, 'before2.do'),
                create_forward_call(20, 'at_line.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 20);

            expect(result.length).toBe(2);
            expect(result[0].raw_path).toBe('before1.do');
            expect(result[0].call_site_line).toBe(5);
            expect(result[1].raw_path).toBe('before2.do');
            expect(result[1].call_site_line).toBe(15);
        });

        it('should exclude calls exactly at the line', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(10, 'before.do'),
                create_forward_call(20, 'at_line.do'),
                create_forward_call(30, 'after.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 20);

            expect(result.length).toBe(1);
            expect(result[0].raw_path).toBe('before.do');
        });
    });

    describe('edge cases', () => {
        it('should handle line 0 correctly', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(0, 'at_zero.do'),
                create_forward_call(5, 'after.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 0);

            expect(result).toEqual([]);
        });

        it('should handle single call before line', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(5, 'single.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 10);

            expect(result.length).toBe(1);
            expect(result[0].raw_path).toBe('single.do');
        });

        it('should handle single call after line', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(15, 'single.do'),
            ];

            const result = forward_resolver.filter_calls_before_line(the_calls, 10);

            expect(result).toEqual([]);
        });

        it('should not modify the original array', () => {
            const the_calls: ForwardCall[] = [
                create_forward_call(15, 'c.do'),
                create_forward_call(5, 'a.do'),
                create_forward_call(10, 'b.do'),
            ];

            forward_resolver.filter_calls_before_line(the_calls, 20);

            // Original array should be unchanged
            expect(the_calls[0].raw_path).toBe('c.do');
            expect(the_calls[1].raw_path).toBe('a.do');
            expect(the_calls[2].raw_path).toBe('b.do');
        });
    });
});

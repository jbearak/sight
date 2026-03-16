import { describe, it, expect } from 'bun:test';
import { build_scope_resolver_config } from '../../src/scope-resolver';

describe('build_scope_resolver_config', () => {
    it('returns empty object for undefined input', () => {
        expect(build_scope_resolver_config(undefined)).toEqual({});
    });

    it('returns empty object for empty input', () => {
        expect(build_scope_resolver_config({})).toEqual({});
    });

    it('filters out undefined top-level keys', () => {
        const my_result = build_scope_resolver_config({
            assume_call_site: undefined,
            max_forward_depth: 5,
        });
        expect(my_result).toEqual({ max_forward_depth: 5 });
        expect('assume_call_site' in my_result).toBe(false);
    });

    it('preserves all defined top-level keys', () => {
        const my_result = build_scope_resolver_config({
            assume_call_site: 'start',
            backward_dependencies: 'auto',
            max_backward_depth: 3,
            max_forward_depth: 7,
            max_chain_depth: 15,
        });
        expect(my_result).toEqual({
            assume_call_site: 'start',
            backward_dependencies: 'auto',
            max_backward_depth: 3,
            max_forward_depth: 7,
            max_chain_depth: 15,
        });
    });

    it('filters undefined values from nested diagnostics object', () => {
        const my_result = build_scope_resolver_config({
            diagnostics: {
                max_depth: 'warning',
                call_site_identification: undefined,
            },
        });
        expect(my_result).toEqual({
            diagnostics: { max_depth: 'warning' },
        });
        expect('call_site_identification' in (my_result.diagnostics ?? {}))
            .toBe(false);
    });

    it('omits diagnostics entirely when all nested values are undefined', () => {
        const my_result = build_scope_resolver_config({
            diagnostics: {
                max_depth: undefined,
                call_site_identification: undefined,
            },
        });
        expect(my_result).toEqual({});
        expect('diagnostics' in my_result).toBe(false);
    });

    it('preserves all defined diagnostics keys', () => {
        const my_result = build_scope_resolver_config({
            diagnostics: {
                max_depth: 'error',
                call_site_identification: 'information',
            },
        });
        expect(my_result).toEqual({
            diagnostics: {
                max_depth: 'error',
                call_site_identification: 'information',
            },
        });
    });

    it('handles mixed top-level and nested diagnostics', () => {
        const my_result = build_scope_resolver_config({
            assume_call_site: 'end',
            max_forward_depth: undefined,
            backward_dependencies: 'explicit',
            diagnostics: {
                max_depth: 'warning',
            },
        });
        expect(my_result).toEqual({
            assume_call_site: 'end',
            backward_dependencies: 'explicit',
            diagnostics: { max_depth: 'warning' },
        });
    });
});

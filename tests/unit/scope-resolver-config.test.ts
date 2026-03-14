import { describe, expect, it } from 'bun:test';
import { build_scope_resolver_config } from '../../src/scope-resolver';

describe('build_scope_resolver_config', () => {
    it('omits undefined top-level keys', () => {
        const my_config = build_scope_resolver_config({
            max_forward_depth: 7,
            backward_dependencies: undefined,
        });

        expect(my_config).toEqual({
            max_forward_depth: 7,
        });
        expect('backward_dependencies' in my_config).toBe(false);
    });

    it('omits empty diagnostics objects', () => {
        const my_config = build_scope_resolver_config({
            diagnostics: {
                max_depth: undefined,
                call_site_identification: undefined,
            },
        });

        expect(my_config).toEqual({});
        expect('diagnostics' in my_config).toBe(false);
    });

    it('preserves explicitly provided backward dependency mode', () => {
        const my_config = build_scope_resolver_config({
            backward_dependencies: 'explicit',
            diagnostics: {
                max_depth: 'warning',
            },
        });

        expect(my_config).toEqual({
            backward_dependencies: 'explicit',
            diagnostics: {
                max_depth: 'warning',
            },
        });
    });
});

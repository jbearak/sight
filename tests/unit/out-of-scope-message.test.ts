import { describe, expect, it } from 'bun:test';
import { format_out_of_scope_message } from '../../src/utils/out-of-scope-message';

describe('format_out_of_scope_message', () => {
    it('formats local after-call-site messages', () => {
        expect(
            format_out_of_scope_message('foo', 'local', {
                kind: 'after_call_site',
                call_site_line_0: 0,
                source_file: 'parent.do',
            })
        ).toBe("`foo' is defined in parent.do but after the call site (line 1)");
    });

    it('formats local inheritance-excludes-locals messages', () => {
        expect(
            format_out_of_scope_message('foo', 'local', {
                kind: 'inheritance_excludes_locals',
                source_file: 'parent.do',
            })
        ).toBe(
            "`foo' is defined in parent.do but local macros are not inherited via do/run (use include or @lsp-included-by)"
        );
    });

    it('formats local same-file-forward messages', () => {
        expect(
            format_out_of_scope_message('foo', 'local', {
                kind: 'same_file_forward',
                defined_line_0: 10,
            })
        ).toBe("`foo' is used before it is defined (line 11)");
    });

    it('formats global after-call-site messages', () => {
        expect(
            format_out_of_scope_message('foo', 'global', {
                kind: 'after_call_site',
                call_site_line_0: 4,
                source_file: 'globals.do',
            })
        ).toBe('$foo is defined in globals.do but after the call site (line 5)');
    });

    it('formats global same-file-forward messages', () => {
        expect(
            format_out_of_scope_message('foo', 'global', {
                kind: 'same_file_forward',
                defined_line_0: 1,
            })
        ).toBe('$foo is used before it is defined (line 2)');
    });

    it('formats variable after-call-site messages', () => {
        expect(
            format_out_of_scope_message('foo', 'variable', {
                kind: 'after_call_site',
                call_site_line_0: 8,
                source_file: 'data.do',
            })
        ).toBe('foo is defined in data.do but after the call site (line 9)');
    });
});

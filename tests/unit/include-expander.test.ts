/**
 * Tests for the INCLUDE directive expander.
 */
import { describe, it, expect } from 'bun:test';
import {
    expand_includes,
    is_safe_include_name,
} from '../../src/utils/include-expander';

// Stub resolver: returns content from a map, null for missing files
function make_resolver(
    files: Record<string, string>
): (name: string) => Promise<{ path: string; content: string } | null> {
    return async (name: string) => {
        const my_content = files[name];
        if (my_content === undefined) return null;
        return { path: `/fake/${name}.ihlp`, content: my_content };
    };
}

describe('expand_includes', () => {
    it('expands a single INCLUDE directive', async () => {
        const my_resolver = make_resolver({
            'shortdes-coeflegend': '{pstd}Coefficient legend content',
        });
        const result = await expand_includes(
            'line1\nINCLUDE help shortdes-coeflegend\nline3',
            my_resolver
        );
        expect(result).toBe(
            'line1\n{pstd}Coefficient legend content\nline3'
        );
    });

    it('expands multiple INCLUDE directives', async () => {
        const my_resolver = make_resolver({
            'file_a': 'content A',
            'file_b': 'content B',
        });
        const result = await expand_includes(
            'INCLUDE help file_a\nmiddle\nINCLUDE help file_b',
            my_resolver
        );
        expect(result).toBe('content A\nmiddle\ncontent B');
    });

    it('handles recursive includes', async () => {
        const my_resolver = make_resolver({
            'outer': 'before\nINCLUDE help inner\nafter',
            'inner': 'INNER CONTENT',
        });
        const result = await expand_includes(
            'INCLUDE help outer',
            my_resolver
        );
        expect(result).toBe('before\nINNER CONTENT\nafter');
    });

    it('detects cycles and stops', async () => {
        const my_resolver = make_resolver({
            'cycle_a': 'A\nINCLUDE help cycle_b',
            'cycle_b': 'B\nINCLUDE help cycle_a',
        });
        const result = await expand_includes(
            'INCLUDE help cycle_a',
            my_resolver
        );
        // cycle_a expands, cycle_b expands, cycle_a is skipped (visited)
        expect(result).toBe('A\nB\n');
    });

    it('respects depth limit', async () => {
        // Build a chain: d0 includes d1, d1 includes d2, ..., d11 includes d12
        const the_files: Record<string, string> = {};
        for (let i = 0; i < 13; i++) {
            the_files[`d${i}`] = i < 12
                ? `level${i}\nINCLUDE help d${i + 1}`
                : `level${i}`;
        }
        const my_resolver = make_resolver(the_files);
        const result = await expand_includes(
            'INCLUDE help d0',
            my_resolver,
            { max_depth: 10 }
        );
        // Depth 10 means levels 0-9 expand, d10's INCLUDE line is removed
        expect(result).toContain('level0');
        expect(result).toContain('level9');
        expect(result).toContain('level10');
        expect(result).not.toContain('level11');
    });

    it('removes INCLUDE line when file is missing', async () => {
        const my_resolver = make_resolver({});
        const result = await expand_includes(
            'line1\nINCLUDE help missing_file\nline3',
            my_resolver
        );
        expect(result).toBe('line1\n\nline3');
    });

    it('tolerates leading whitespace in INCLUDE directive', async () => {
        const my_resolver = make_resolver({
            'indented': 'INDENTED CONTENT',
        });
        const result = await expand_includes(
            '  INCLUDE help indented',
            my_resolver
        );
        expect(result).toBe('INDENTED CONTENT');
    });

    it('tolerates extra spacing between tokens', async () => {
        const my_resolver = make_resolver({
            'spaced': 'SPACED CONTENT',
        });
        const result = await expand_includes(
            'INCLUDE  help  spaced',
            my_resolver
        );
        expect(result).toBe('SPACED CONTENT');
    });

    it('preserves non-INCLUDE lines unchanged', async () => {
        const my_resolver = make_resolver({});
        const my_input = '{title:Syntax}\n{cmd:regress} {depvar} {indepvars}';
        const result = await expand_includes(my_input, my_resolver);
        expect(result).toBe(my_input);
    });

    it('treats path-traversal include name as missing', async () => {
        const the_warnings: string[] = [];
        let resolver_called = false;
        const my_resolver = async (_name: string) => {
            resolver_called = true;
            return null;
        };
        const result = await expand_includes(
            'before\nINCLUDE help ../escape\nafter',
            my_resolver,
            { on_missing: (name) => the_warnings.push(name) }
        );
        expect(result).toBe('before\n\nafter');
        expect(resolver_called).toBe(false);
        expect(the_warnings).toEqual(['../escape']);
    });

    it('logs missing includes (deduplicated)', async () => {
        const the_warnings: string[] = [];
        const my_resolver = make_resolver({});
        await expand_includes(
            'INCLUDE help missing\nINCLUDE help missing\nINCLUDE help other',
            my_resolver,
            { on_missing: (name) => the_warnings.push(name) }
        );
        // "missing" logged once (deduplicated), "other" logged once
        expect(the_warnings).toEqual(['missing', 'other']);
    });
});

describe('is_safe_include_name', () => {
    it('accepts ordinary names', () => {
        expect(is_safe_include_name('foo')).toBe(true);
        expect(is_safe_include_name('foo_bar')).toBe(true);
        expect(is_safe_include_name('foo.ihlp')).toBe(true);
        expect(is_safe_include_name('_foo')).toBe(true);
        expect(is_safe_include_name('foo-bar')).toBe(true);
    });

    it('rejects path separators', () => {
        expect(is_safe_include_name('foo/bar')).toBe(false);
        expect(is_safe_include_name('foo\\bar')).toBe(false);
    });

    it('rejects parent-directory components', () => {
        expect(is_safe_include_name('..')).toBe(false);
        expect(is_safe_include_name('../etc/passwd')).toBe(false);
    });

    it('rejects absolute paths', () => {
        expect(is_safe_include_name('/abs/path')).toBe(false);
        expect(is_safe_include_name('\\abs\\path')).toBe(false);
        expect(is_safe_include_name('C:\\windows')).toBe(false);
    });

    it('rejects empty/whitespace names', () => {
        expect(is_safe_include_name('')).toBe(false);
        expect(is_safe_include_name('   ')).toBe(false);
    });
});

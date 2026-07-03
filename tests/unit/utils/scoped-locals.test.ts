import { describe, it, expect } from 'bun:test';
import {
    get_visible_local_scopes,
    collect_visible_local_macros,
    lookup_scoped_local_macro,
    enumerate_scoped_local_macros,
} from '../../../src/utils/scoped-locals';
import {
    create_document_state,
    find_position_of,
} from '../../property/helpers/document-utils';

const SIBLING_PROGRAMS = `
program define prog_a
    local shared 1
end
program define prog_b
    local shared 2
    display \`shared'
end
local top_only 9
`;

describe('get_visible_local_scopes', () => {
    it('returns [] for empty scopes (degenerate states)', () => {
        expect(
            get_visible_local_scopes([], { line: 0, character: 0 })
        ).toEqual([]);
    });

    it('top-level position sees only the do-file scope', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, 'local top_only')!;
        const the_visible = get_visible_local_scopes(doc.scopes, position);
        expect(the_visible).toHaveLength(1);
        expect(the_visible[0].type).toBe('dofile');
    });

    it('program-body position sees its program scope then the do-file scope', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, "display `shared'")!;
        const the_visible = get_visible_local_scopes(doc.scopes, position);
        expect(the_visible).toHaveLength(2);
        expect(the_visible[0].type).toBe('program');
        expect(the_visible[0].program_name).toBe('prog_b');
        expect(the_visible[1].type).toBe('dofile');
    });

    it('a program header line resolves to the enclosing frame (#273)', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, 'define prog_b')!;
        const the_visible = get_visible_local_scopes(doc.scopes, position);
        expect(the_visible).toHaveLength(1);
        expect(the_visible[0].type).toBe('dofile');
    });

    it('a nested program body sees the innermost scope, not the middle one', () => {
        const source = `
program define outer
    local x outer_val
    program define inner
        local y inner_val
        display \`y'
    end
end
`;
        const doc = create_document_state(source);
        const position = find_position_of(source, "display `y'")!;
        const the_visible = get_visible_local_scopes(doc.scopes, position);
        expect(the_visible).toHaveLength(2);
        expect(the_visible[0].program_name).toBe('inner');
        expect(the_visible[1].type).toBe('dofile');
    });
});

describe('collect_visible_local_macros', () => {
    it('shadows the do-file symbol with the enclosing program symbol', () => {
        const source = `
local x top
program define p
    local x body
    display \`x'
end
`;
        const doc = create_document_state(source);
        const position = find_position_of(source, "display `x'")!;
        const the_macros = collect_visible_local_macros(doc.scopes, position);
        expect(the_macros.resolved.get('x')?.value).toBe('body');
        expect(the_macros.resolved.get('x')?.containingScope).toBe('program');
    });

    it('includes do-file locals not shadowed by the program', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, "display `shared'")!;
        const the_macros = collect_visible_local_macros(doc.scopes, position);
        // top_only is declared AFTER the cursor in the fixture, so it
        // is visible only as a forward identity target.
        expect(the_macros.forward.get('top_only')).toBeDefined();
        expect(the_macros.resolved.get('shared')?.value).toBe('2');
    });

    it('never includes sibling-program locals', () => {
        const source = `
program define prog_a
    local only_a 1
end
program define prog_b
    display \`only_a'
end
`;
        const doc = create_document_state(source);
        const position = find_position_of(source, "display `only_a'")!;
        const the_macros = collect_visible_local_macros(doc.scopes, position);
        expect(the_macros.resolved.has('only_a')).toBe(false);
        expect(the_macros.forward.has('only_a')).toBe(false);
    });
});

describe('lookup_scoped_local_macro', () => {
    it('no opinion on empty scopes', () => {
        const result = lookup_scoped_local_macro(
            [], { line: 0, character: 0 }, 'x'
        );
        expect(result).toEqual({
            symbol: undefined, forward_only: false, out_of_scope: false,
        });
    });

    it('resolves the enclosing program symbol over the flat winner', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, "display `shared'")!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'shared');
        expect(result.out_of_scope).toBe(false);
        expect(result.symbol?.value).toBe('2');
        expect(result.symbol?.containing_program_name).toBe('prog_b');
    });

    it('flags a sibling-only name as out_of_scope', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, 'local top_only')!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'shared');
        expect(result.symbol).toBeUndefined();
        expect(result.out_of_scope).toBe(true);
    });

    it('program-body lookup still sees do-file locals (permissive)', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, "display `shared'")!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'top_only');
        expect(result.symbol?.value).toBe('9');
        expect(result.out_of_scope).toBe(false);
    });

    it('no opinion on a name untracked anywhere in the file', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const position = find_position_of(SIBLING_PROGRAMS, "display `shared'")!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'ghost');
        expect(result).toEqual({
            symbol: undefined, forward_only: false, out_of_scope: false,
        });
    });

    it('no opinion on positional argument names', () => {
        const source = `
program define p
    display \`1'
end
`;
        const doc = create_document_state(source);
        const position = find_position_of(source, "display `1'")!;
        const result = lookup_scoped_local_macro(doc.scopes, position, '1');
        expect(result).toEqual({
            symbol: undefined, forward_only: false, out_of_scope: false,
        });
    });

    it('redeclared bodies resolve to their own body symbol', () => {
        const source = `
program define foo
    local x first
end
program define foo
    local x second
    display \`x'
end
`;
        const doc = create_document_state(source);
        const position = find_position_of(source, "display `x'")!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'x');
        expect(result.symbol?.value).toBe('second');
    });
});

describe('enumerate_scoped_local_macros', () => {
    it('yields one entry per owning scope for a shared name', () => {
        const doc = create_document_state(SIBLING_PROGRAMS);
        const the_entries = enumerate_scoped_local_macros(
            doc.scopes, doc.symbols.localMacros
        );
        const the_shared_values = the_entries
            .filter(([my_name]) => my_name === 'shared')
            .map(([, my_symbol]) => my_symbol.value)
            .sort();
        expect(the_shared_values).toEqual(['1', '2']);
        expect(
            the_entries.some(([my_name]) => my_name === 'top_only')
        ).toBe(true);
    });

    it('falls back to the flat map when scopes are empty', () => {
        const doc = create_document_state('local x 1');
        const the_entries = enumerate_scoped_local_macros(
            [], doc.symbols.localMacros
        );
        expect(the_entries.map(([my_name]) => my_name)).toEqual(['x']);
    });
});

// Round-1 gate regression: resolution must honor definition order —
// a not-yet-defined program local must not shadow an already-defined
// do-file local (mirrors the analyzer's macro_resolves_at_reference).
describe('position-aware resolution (forward order)', () => {
    const FORWARD_SHADOW = `
local x top
program define p
    di "\`x'"
    local x body
end
`;

    it('reference before the program definition resolves to the do-file symbol', () => {
        const doc = create_document_state(FORWARD_SHADOW);
        const position = find_position_of(FORWARD_SHADOW, 'di "`x')!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'x');
        expect(result.symbol?.value).toBe('top');
        expect(result.symbol?.containingScope).toBe('dofile');
    });

    it('reference after the program definition resolves to the program symbol', () => {
        const source = `
local x top
program define p
    local x body
    di "\`x'"
end
`;
        const doc = create_document_state(source);
        const position = find_position_of(source, 'di "`x')!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'x');
        expect(result.symbol?.value).toBe('body');
    });

    it('forward-only same-scope reference keeps the program symbol as identity target', () => {
        const source = `
program define p
    di "\`x'"
    local x body
end
`;
        const doc = create_document_state(source);
        const position = find_position_of(source, 'di "`x')!;
        const result = lookup_scoped_local_macro(doc.scopes, position, 'x');
        expect(result.symbol?.value).toBe('body');
        expect(result.forward_only).toBe(true);
        expect(result.out_of_scope).toBe(false);
    });

    it('collect_visible_local_macros prefers the resolved do-file symbol', () => {
        const doc = create_document_state(FORWARD_SHADOW);
        const position = find_position_of(FORWARD_SHADOW, 'di "`x')!;
        const the_macros = collect_visible_local_macros(doc.scopes, position);
        expect(the_macros.resolved.get('x')?.value).toBe('top');
        expect(the_macros.forward.has('x')).toBe(false);
    });
});

import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataDiagnosticCode } from '../../src/types';

function analyze_code(code: string) {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();
    const lexer_result = lexer.tokenize(code);
    const parse_result = parser.parse(lexer_result.tokens);
    return analyzer.analyze(
        parse_result.ast,
        'file:///test.do',
        undefined,
        { undefined_macro_enabled: true },
        lexer_result.tokens
    );
}

function undefined_macro_diagnostics(
    result: ReturnType<typeof analyze_code>,
    name: string
) {
    return result.diagnostics.filter(d =>
        d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
        d.message.includes(`\`${name}'`)
    );
}

// Issue #261: program-scoped locals must not suppress undefined-macro
// warnings outside their defining program body.
describe('scoped local macro identity (#261)', () => {
    it('sanity: local defined and used inside the same program does not warn', () => {
        const result = analyze_code(`
program define myprog
    local inside_x 1
    display \`inside_x'
end
`);
        expect(undefined_macro_diagnostics(result, 'inside_x')).toHaveLength(0);
    });

    it('forward: top-level reference before top-level definition still warns', () => {
        const result = analyze_code(`
display \`later'
local later 1
`);
        expect(undefined_macro_diagnostics(result, 'later')).toHaveLength(1);
    });

    it('forward: in-program reference before same-program definition still warns', () => {
        const result = analyze_code(`
program define myprog
    display \`inner'
    local inner 1
end
`);
        expect(undefined_macro_diagnostics(result, 'inner')).toHaveLength(1);
    });

    it('program-to-top-level: reference after the program warns', () => {
        const result = analyze_code(`
program define myprog
    local inside_x 1
end
display \`inside_x'
`);
        expect(undefined_macro_diagnostics(result, 'inside_x')).toHaveLength(1);
    });

    it('program-to-top-level: reference before the program warns', () => {
        const result = analyze_code(`
display \`inside_x'
program define myprog
    local inside_x 1
end
`);
        expect(undefined_macro_diagnostics(result, 'inside_x')).toHaveLength(1);
    });

    it('cross-program: reference in a sibling program warns', () => {
        const result = analyze_code(`
program define prog_a
    local from_a 1
end
program define prog_b
    display \`from_a'
end
`);
        expect(undefined_macro_diagnostics(result, 'from_a')).toHaveLength(1);
    });

    it('cross-program: sibling with its own same-named local does not warn', () => {
        const result = analyze_code(`
program define prog_a
    local shared 1
end
program define prog_b
    local shared 2
    display \`shared'
end
`);
        expect(undefined_macro_diagnostics(result, 'shared')).toHaveLength(0);
    });

    it('program reference still sees dofile-scope locals (permissive)', () => {
        const result = analyze_code(`
local top_x 1
program define myprog
    display \`top_x'
end
`);
        expect(undefined_macro_diagnostics(result, 'top_x')).toHaveLength(0);
    });

    it('out-of-scope program-local diagnostics carry the defining program name', () => {
        const result = analyze_code(`
program define myprog
    local inside_x 1
end
display \`inside_x'
`);
        const the_diagnostics = undefined_macro_diagnostics(result, 'inside_x');
        expect(the_diagnostics).toHaveLength(1);
        expect(the_diagnostics[0].scope_isolation).toEqual({
            defined_in_programs: ['myprog'],
        });
    });
});

// Identity split: same-named locals in different scopes are distinct
// symbols with no cross-scope additional_definitions chains.
describe('scoped local macro identity split', () => {
    it('program-then-top-level: dofile definition owns the flat slot cleanly', () => {
        const result = analyze_code(`
program define myprog
    local x 1
end
local x 2
`);
        const flat_x = result.symbols.localMacros.get('x');
        expect(flat_x).toBeDefined();
        expect(flat_x!.containingScope).toBe('dofile');
        expect(flat_x!.additional_definitions ?? []).toHaveLength(0);
    });

    it('same-scope redefinitions still chain additional_definitions', () => {
        const result = analyze_code(`
local x 1
local x 2
`);
        const flat_x = result.symbols.localMacros.get('x');
        expect(flat_x).toBeDefined();
        expect(flat_x!.containingScope).toBe('dofile');
        expect(flat_x!.additional_definitions).toHaveLength(1);
    });

    it('cross-program same-named locals are distinct symbols', () => {
        const result = analyze_code(`
program define prog_a
    local shared 1
end
program define prog_b
    local shared 2
end
`);
        const the_program_scopes = result.scopes.filter(s => s.type === 'program');
        expect(the_program_scopes).toHaveLength(2);
        const symbol_a = the_program_scopes[0].localMacros.get('shared');
        const symbol_b = the_program_scopes[1].localMacros.get('shared');
        expect(symbol_a).toBeDefined();
        expect(symbol_b).toBeDefined();
        expect(symbol_a).not.toBe(symbol_b);
        expect(symbol_a!.additional_definitions ?? []).toHaveLength(0);
        expect(symbol_b!.additional_definitions ?? []).toHaveLength(0);
    });
});

// Flat-slot ownership must be deterministic by earliest definition even
// when the earlier contender is a loop-expanded macro (whose symbol is
// synthesized by inject_expanded_macro rather than register_local_macro).
describe('flat view ownership with loop-expanded macros', () => {
    it('an earlier loop-expanded local keeps the flat slot', () => {
        const result = analyze_code(`
program define prog_b
    local helper 1
    foreach v in 1 2 3 {
        local x_\`v' \`helper'
    }
end
program define prog_a
    local x_2 99
end
`);
        const flat_x2 = result.symbols.localMacros.get('x_2');
        expect(flat_x2).toBeDefined();
        expect(flat_x2!.containing_program_name).toBe('prog_b');
    });
});

describe('flat view ownership with Mata setters', () => {
    it('an earlier Mata st_local program-local keeps the flat slot', () => {
        const result = analyze_code(`
program define prog_a
    mata: st_local("x", "1")
end
program define prog_b
    local x 2
end
`);
        const flat_x = result.symbols.localMacros.get('x');
        expect(flat_x).toBeDefined();
        expect(flat_x!.containing_program_name).toBe('prog_a');
    });
});

// Issue #263 limitation 6: an unrelated program-scoped local of the same
// name must not poison static loop-macro expansion at the top level.
describe('loop expansion unaffected by cross-scope collisions (#263)', () => {
    it('top-level fold works despite same-named program-body local', () => {
        const result = analyze_code(`
program define helper
    local list z
end
local list a b
foreach v of local list {
    local seen_\`v' 1
}
display \`seen_a'
`);
        expect(undefined_macro_diagnostics(result, 'seen_a')).toHaveLength(0);
    });
});

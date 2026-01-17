import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer, create_empty_symbol_table, merge_symbol_tables } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

describe('SemanticAnalyzer', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    function analyze(source: string, config?: { undefined_macro_enabled?: boolean; undefined_variable_enabled?: boolean }, workspace_symbols?: SymbolTable) {
        const { tokens } = lexer.tokenize(source);
        const { ast } = parser.parse(tokens);
        return analyzer.analyze(ast, 'test://file.do', workspace_symbols, config, tokens);
    }

    describe('symbol table building', () => {
        it('should extract local macro definitions', () => {
            const result = analyze('local myvar = 42');
            
            expect(result.symbols.localMacros.has('myvar')).toBe(true);
            const macro = result.symbols.localMacros.get('myvar');
            expect(macro?.name).toBe('myvar');
            expect(macro?.scope).toBe('local');
            expect(macro?.value).toBe('42');
        });

        it('should extract global macro definitions', () => {
            const result = analyze('global myglob = "hello"');
            
            expect(result.symbols.globalMacros.has('myglob')).toBe(true);
            const macro = result.symbols.globalMacros.get('myglob');
            expect(macro?.name).toBe('myglob');
            expect(macro?.scope).toBe('global');
        });

        it('should extract program definitions (case-sensitive)', () => {
            const result = analyze(`
program define MyProgram
    display "hello"
end
`);
            
            // Programs are stored with original case
            expect(result.symbols.programs.has('MyProgram')).toBe(true);
            const program = result.symbols.programs.get('MyProgram');
            expect(program?.name).toBe('MyProgram');
        });

        it('should extract macro-creating option patterns from programs', () => {
            // Test with regular c_local
            const simple_source = `program define test_program
    c_local regular_macro "regular value"
end`;
            
            const simple_result = analyze(simple_source);
            
            expect(simple_result.symbols.programs.has('test_program')).toBe(true);
            const simple_program = simple_result.symbols.programs.get('test_program');
            expect(simple_program?.c_locals).toEqual(['regular_macro']);
            
            // Test the extraction logic directly by creating mock AST nodes
            // (The parser can't handle `c_local `macro'` syntax, so we test the logic directly)
            const mockCommandNode = {
                type: 'command' as const,
                fullName: 'c_local',
                varlist: [
                    { name: '`local_opt\'', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } }
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
            };
            
            const mockGlobalNode = {
                type: 'command' as const,
                fullName: 'global',
                varlist: [
                    { name: '`global_opt\'', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } } }
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
            };
            
            // Test the extraction method directly
            const analyzer = new SemanticAnalyzer();
            // Include option names in syntax_option_names to simulate syntax declaration
            const syntax_option_names = new Set(['local_opt', 'global_opt']);
            const result = (analyzer as any).extract_macro_creating_option_patterns([mockCommandNode, mockGlobalNode], syntax_option_names);
            
            expect(result.local_options).toEqual(['local_opt']);
            expect(result.global_options).toEqual(['global_opt']);
        });

        it('should exclude macro refs from c_locals but include in macro_creating_local_options', () => {
            // Test that c_local `local' populates macro_creating_local_options but NOT c_locals
            const analyzer = new SemanticAnalyzer();
            
            // Mock node for c_local `local' (macro ref pattern)
            const mockMacroRefNode = {
                type: 'command' as const,
                fullName: 'c_local',
                varlist: [
                    { name: '`local\'', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } } }
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }
            };
            
            // Mock node for c_local regular_name (literal identifier)
            const mockLiteralNode = {
                type: 'command' as const,
                fullName: 'c_local',
                varlist: [
                    { name: 'regular_name', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } } }
                ],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 25 } }
            };
            
            // Test extract_c_locals: should only include literal identifier
            const c_locals = (analyzer as any).extract_c_locals([mockMacroRefNode, mockLiteralNode]);
            expect(c_locals).toEqual(['regular_name']);
            expect(c_locals).not.toContain('`local\'');
            
            // Test extract_macro_creating_option_patterns: should include the macro ref pattern
            const syntax_option_names = new Set(['local']);
            const result = (analyzer as any).extract_macro_creating_option_patterns([mockMacroRefNode], syntax_option_names);
            expect(result.local_options).toEqual(['local']);
        });

        it('should detect global `global\' pattern in program body via parsing', () => {
            // Test end-to-end: parser should now parse `global `global'` as a CommandNode
            const source = `program define my_program
    syntax, global(name)
    global \`global' = "value"
end`;
            
            const result = analyze(source);
            
            expect(result.symbols.programs.has('my_program')).toBe(true);
            const program = result.symbols.programs.get('my_program');
            expect(program?.macro_creating_global_options).toContain('global');
        });

        it('should fall back to command range when option argument_range is undefined', () => {
            // Per spec requirements 3.3 and 4.3: definition location should use
            // option argument span, and if unavailable fall back to command span
            const analyzer = new SemanticAnalyzer();
            const command_range = { start: { line: 5, character: 0 }, end: { line: 5, character: 30 } };
            const option_range = { start: { line: 5, character: 20 }, end: { line: 5, character: 28 } };
            
            const mock_command_node = {
                type: 'command' as const,
                name: 'levelsof',
                fullName: 'levelsof',
                options: [{
                    type: 'option' as const,
                    name: 'local',
                    fullName: 'local',
                    argument: 'mylevels',
                    argument_range: undefined, // intentionally undefined
                    range: option_range,
                }],
                range: command_range,
            };
            
            const { symbols } = analyzer.analyze(
                { nodes: [mock_command_node] },
                'test://file.do'
            );
            
            expect(symbols.localMacros.has('mylevels')).toBe(true);
            const macro = symbols.localMacros.get('mylevels')!;
            // Should fall back to command range, not option range
            expect(macro.location.range).toEqual(command_range);
        });

        it('should extract variables from gen command', () => {
            const result = analyze('gen newvar = 1');
            
            expect(result.symbols.variables.has('newvar')).toBe(true);
            const variable = result.symbols.variables.get('newvar');
            expect(variable?.source).toBe('gen');
        });

        it('should NOT register local macro references as variables in gen', () => {
            const result = analyze('gen `my_var\' = 1');
            
            expect(result.symbols.variables.has('`my_var\'')).toBe(false);
        });

        it('should NOT register global macro references as variables in gen', () => {
            const result = analyze('gen $my_var = 1');
            
            expect(result.symbols.variables.has('$my_var')).toBe(false);
        });

        it('should extract variables from egen command', () => {
            const result = analyze('egen total = sum(x)');
            
            expect(result.symbols.variables.has('total')).toBe(true);
            const variable = result.symbols.variables.get('total');
            expect(variable?.source).toBe('egen');
        });

        it('should NOT register local macro references as variables in egen', () => {
            const result = analyze('egen `my_var\' = mean(x)');
            
            expect(result.symbols.variables.has('`my_var\'')).toBe(false);
        });

        it('should NOT register global macro references as variables in egen', () => {
            const result = analyze('egen $my_var = mean(x)');
            
            expect(result.symbols.variables.has('$my_var')).toBe(false);
        });

        it('should extract variables from input command', () => {
            const result = analyze('input var1 var2 var3');
            
            expect(result.symbols.variables.has('var1')).toBe(true);
            expect(result.symbols.variables.has('var2')).toBe(true);
            expect(result.symbols.variables.has('var3')).toBe(true);
        });

        it('should NOT register local macro references as variables in input', () => {
            const result = analyze('input `my_var\'');
            
            expect(result.symbols.variables.has('`my_var\'')).toBe(false);
        });

        it('should NOT register global macro references as variables in input', () => {
            const result = analyze('input $my_var');
            
            expect(result.symbols.variables.has('$my_var')).toBe(false);
        });

        it('should extract variables from grouped rename command', () => {
            const result = analyze('rename (old1 old2) (new1 new2)');

            expect(result.symbols.variables.has('new1')).toBe(true);
            expect(result.symbols.variables.has('new2')).toBe(true);

            expect(result.symbols.variables.get('new1')?.source).toBe('rename');
            expect(result.symbols.variables.get('new2')?.source).toBe('rename');
        });

        it('should NOT register local macro references as variables in confirm variable', () => {
            const result = analyze('capture confirm variable `my_var\'');
            
            expect(result.symbols.variables.has('`my_var\'')).toBe(false);
        });

        it('should NOT register global macro references as variables in confirm variable', () => {
            const result = analyze('capture confirm variable $my_var');
            
            expect(result.symbols.variables.has('$my_var')).toBe(false);
        });

        it('should NOT extract variables from grouped rename with wildcard patterns', () => {
            const result = analyze('rename (old1 old2) (* new2)');

            for (const [_name, variable] of result.symbols.variables) {
                expect(variable.source).not.toBe('rename');
            }
        });

        it('should NOT register local macro references as variables in simple rename', () => {
            const result = analyze('rename old `my_var\'');
            
            expect(result.symbols.variables.has('`my_var\'')).toBe(false);
        });

        it('should NOT register global macro references as variables in simple rename', () => {
            const result = analyze('rename old $my_var');
            
            expect(result.symbols.variables.has('$my_var')).toBe(false);
        });

        it('should NOT register macro references as variables in grouped rename', () => {
            const result = analyze('rename (old1 old2) (`new1\' $new2)');
            
            expect(result.symbols.variables.has('`new1\'')).toBe(false);
            expect(result.symbols.variables.has('$new2')).toBe(false);
        });

        it('should NOT extract variables from simple wildcard/stub rename forms', () => {
            const the_sources = [
                'rename * , lower',
                'rename old* new*',
                'rename old* new',
                'rename old new*',
                'rename old? new?',
                'rename old? new',
                'rename old new?',
            ];

            for (const my_source of the_sources) {
                const result = analyze(my_source);

                for (const [_name, variable] of result.symbols.variables) {
                    expect(variable.source).not.toBe('rename');
                }
            }
        });

        it('should treat tempvar as local macro, not variable', () => {
            const result = analyze('tempvar tmp');
            
            // tempvar creates a local macro, not a variable
            expect(result.symbols.localMacros.has('tmp')).toBe(true);
            expect(result.symbols.variables.has('tmp')).toBe(false);
        });

        it('should treat tempfile as local macro', () => {
            const result = analyze('tempfile births');
            
            // tempfile creates a local macro containing a filename
            expect(result.symbols.localMacros.has('births')).toBe(true);
        });

        it('should treat tempname as local macro', () => {
            const result = analyze('tempname mymat');
            
            // tempname creates a local macro containing a temp name
            expect(result.symbols.localMacros.has('mymat')).toBe(true);
        });

        it('should extract loop variables from foreach', () => {
            const result = analyze(`
foreach x in a b c {
    display \`x'
}
`);
            
            expect(result.symbols.localMacros.has('x')).toBe(true);
        });

        it('should extract loop variables from forvalues', () => {
            const result = analyze(`
forvalues i = 1/10 {
    display \`i'
}
`);
            
            expect(result.symbols.localMacros.has('i')).toBe(true);
        });
    });

    describe('scoping rules', () => {
        it('should create separate scope for program body', () => {
            const result = analyze(`
local outer = 1
program define myprog
    local inner = 2
end
`);
            
            // Should have at least 2 scopes: dofile and program
            expect(result.scopes.length).toBeGreaterThanOrEqual(2);
            expect(result.scopes[0].type).toBe('dofile');
            expect(result.scopes[1].type).toBe('program');
        });

        it('should not create new scope for if blocks', () => {
            const result = analyze(`
local x = 1
if 1 {
    local y = 2
}
`);
            
            // Both macros should be in the same scope
            expect(result.symbols.localMacros.has('x')).toBe(true);
            expect(result.symbols.localMacros.has('y')).toBe(true);
        });
    });

    describe('semantic diagnostics', () => {
        it('should detect undefined local macro references', () => {
            const result = analyze('display `undefined_macro\'', { undefined_macro_enabled: true });
            
            expect(result.diagnostics.length).toBeGreaterThan(0);
            const diag = result.diagnostics.find(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO);
            expect(diag).toBeDefined();
            expect(diag?.message).toContain('undefined_macro');
        });

        it('should detect undefined global macro references', () => {
            const result = analyze('display $undefined_global', { undefined_macro_enabled: true });
            
            expect(result.diagnostics.length).toBeGreaterThan(0);
            const diag = result.diagnostics.find(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO);
            expect(diag).toBeDefined();
            expect(diag?.message).toContain('undefined_global');
        });

        it('should not report defined local macros as undefined', () => {
            const result = analyze(`
local myvar = 42
display \`myvar'
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('myvar')
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should not report defined global macros as undefined', () => {
            const result = analyze(`
global myglob = "test"
display $myglob
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('myglob')
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should detect undefined variables when enabled', () => {
            const result = analyze('summarize undefined_var', { undefined_variable_enabled: true });
            
            expect(result.diagnostics.length).toBeGreaterThan(0);
            const diag = result.diagnostics.find(d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE);
            expect(diag).toBeDefined();
        });

        it('should not report undefined variables by default', () => {
            const result = analyze('summarize undefined_var');
            
            const var_diags = result.diagnostics.filter(d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE);
            expect(var_diags.length).toBe(0);
        });
    });

    describe('comment directives', () => {
        it('should suppress diagnostics with @lsp-ignore-next', () => {
            const result = analyze(`
// @lsp-ignore-next
display \`undefined_macro'
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should suppress diagnostics with @lsp-ignore on same line', () => {
            const result = analyze(`
display \`undefined_macro' // @lsp-ignore
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should declare variables with @lsp-variables', () => {
            const result = analyze(`
// @lsp-variables age income status
summarize age income
`, { undefined_variable_enabled: true });
            
            // Should not report age or income as undefined
            const var_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_VARIABLE &&
                     (d.message.includes('age') || d.message.includes('income'))
            );
            expect(var_diags.length).toBe(0);
        });
    });

    describe('token macro forward reference detection', () => {
        it('should warn on token reference before definition', () => {
            const result = analyze(`
display \`undefined_macro'
local undefined_macro = "value"
`, { undefined_macro_enabled: true });
            
            const diag = result.diagnostics.find(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO);
            expect(diag).toBeDefined();
            expect(diag?.message).toContain('undefined_macro');
        });

        it('should not warn on token reference after definition', () => {
            const result = analyze(`
local defined_macro = "value"
display \`defined_macro'
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('defined_macro')
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should warn on token reference to workspace global (workspace_symbols do NOT suppress)', () => {
            // workspace_symbols parameter does NOT suppress undefined macro warnings.
            // Only cross-file directives provide scope resolution.
            const workspace_symbols = create_empty_symbol_table();
            workspace_symbols.globalMacros.set('workspace_global', {
                name: 'workspace_global',
                scope: 'global',
                location: { uri: 'test://other.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                sourceUri: 'test://other.do',
                containingScope: 'dofile',
                definition_line: 0,
            });

            const result = analyze('display $workspace_global', { undefined_macro_enabled: true }, workspace_symbols);
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('workspace_global')
            );
            // Should warn because workspace_symbols do NOT suppress warnings
            expect(undefined_diags.length).toBe(1);
        });

        it('should handle multiple definitions with first definition wins', () => {
            const result = analyze(`
display \`my_macro'
local my_macro = "first"
local my_macro = "second"
display \`my_macro'
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('my_macro')
            );
            // Should warn only for the first reference before any definition
            expect(undefined_diags.length).toBe(1);
        });

        it('should not warn for token and definition on same line', () => {
            const result = analyze(`
local same_line = "value"; display \`same_line'
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('same_line')
            );
            expect(undefined_diags.length).toBe(0);
        });
    });

    describe('args command macro scope', () => {
        it('should register local macros from args command', () => {
            const result = analyze('args x y z');
            
            expect(result.symbols.localMacros.has('x')).toBe(true);
            expect(result.symbols.localMacros.has('y')).toBe(true);
            expect(result.symbols.localMacros.has('z')).toBe(true);
            
            const macro_x = result.symbols.localMacros.get('x');
            expect(macro_x?.name).toBe('x');
            expect(macro_x?.scope).toBe('local');
        });

        it('should not warn on reference before args command', () => {
            const result = analyze(`
display \`x'
args x y z
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('x')
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should still warn on undefined macros not in args', () => {
            const result = analyze(`
display \`undefined_macro'
args x y z
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('undefined_macro')
            );
            expect(undefined_diags.length).toBe(1);
        });

        it('should handle args macros in program blocks', () => {
            const result = analyze(`
program define myprogram
    display \`arg1'
    args arg1 arg2
    display \`arg2'
end
`, { undefined_macro_enabled: true });
            
            // Should not warn for arg1 or arg2 since they are defined by args
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     (d.message.includes('arg1') || d.message.includes('arg2'))
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should set definition_index to 0 for args macros', () => {
            const result = analyze('args x y z');
            
            const macro_x = result.symbols.localMacros.get('x');
            const macro_y = result.symbols.localMacros.get('y');
            const macro_z = result.symbols.localMacros.get('z');
            
            // Args macros should have definition_index: 0 to be valid from start of scope
            expect(macro_x?.definition_index).toBe(0);
            expect(macro_y?.definition_index).toBe(0);
            expect(macro_z?.definition_index).toBe(0);
        });

        it('should handle multiple references before args command', () => {
            const result = analyze(`
display \`x'
display \`y'
display \`z'
args x y z
`, { undefined_macro_enabled: true });
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     (d.message.includes('x') || d.message.includes('y') || d.message.includes('z'))
            );
            expect(undefined_diags.length).toBe(0);
        });

        it('should handle args with single argument', () => {
            const result = analyze(`
display \`single_arg'
args single_arg
`, { undefined_macro_enabled: true });
            
            expect(result.symbols.localMacros.has('single_arg')).toBe(true);
            
            const undefined_diags = result.diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO && d.message.includes('single_arg')
            );
            expect(undefined_diags.length).toBe(0);
        });
    });

    describe('forward call macro path detection', () => {
        it('should mark path with local macro reference as non-static', () => {
            const result = analyze('do "`macro\'"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
            expect(result.forward_calls[0].raw_path).toBe('`macro\'');
        });

        it('should mark path with global macro reference as non-static', () => {
            const result = analyze('do "$macro"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
            expect(result.forward_calls[0].raw_path).toBe('$macro');
        });

        it('should mark static path as static', () => {
            const result = analyze('do "static.do"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(true);
            expect(result.forward_calls[0].raw_path).toBe('static.do');
        });

        it('should mark path with embedded local macro as non-static', () => {
            const result = analyze('do "path/`subdir\'/file.do"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
        });

        it('should mark path with embedded global macro as non-static', () => {
            const result = analyze('do "path/$subdir/file.do"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
        });

        it('should mark run command with macro path as non-static', () => {
            const result = analyze('run "`script\'"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
            expect(result.forward_calls[0].type).toBe('run');
        });

        it('should mark include command with macro path as non-static', () => {
            const result = analyze('include "$header"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
            expect(result.forward_calls[0].type).toBe('include');
        });

        it('should have empty resolved path for non-static calls', () => {
            const result = analyze('do "`macro\'"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
            // Non-static calls should have empty resolved path
            expect(result.forward_calls[0].path).toBe('');
        });

        it('should handle braced global macro syntax as non-static', () => {
            const result = analyze('do "${macro}"');
            
            expect(result.forward_calls.length).toBe(1);
            expect(result.forward_calls[0].is_static).toBe(false);
        });
    });

    describe('helper functions', () => {
        it('should create empty symbol table', () => {
            const table = create_empty_symbol_table();
            
            expect(table.programs.size).toBe(0);
            expect(table.localMacros.size).toBe(0);
            expect(table.globalMacros.size).toBe(0);
            expect(table.variables.size).toBe(0);
        });

        it('should merge symbol tables', () => {
            const base = create_empty_symbol_table();
            base.programs.set('prog1', {
                name: 'prog1',
                location: { uri: 'test://a.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                sourceUri: 'test://a.do',
            });

            const overlay = create_empty_symbol_table();
            overlay.programs.set('prog2', {
                name: 'prog2',
                location: { uri: 'test://b.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
                sourceUri: 'test://b.do',
            });

            const merged = merge_symbol_tables(base, overlay);
            
            expect(merged.programs.has('prog1')).toBe(true);
            expect(merged.programs.has('prog2')).toBe(true);
        });
    });
});

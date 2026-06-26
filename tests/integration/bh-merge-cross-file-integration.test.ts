import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { SemanticAnalyzer, create_empty_symbol_table } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

const DEFAULT_CONFIG = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning' as const,
            undefinedVariable: 'information' as const,
            styleWarnings: 'hint' as const,
        },
    },
    completion: {},
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces' as const,
    },
    adoPaths: [],
    indexWorkspace: true,
};

describe('BH Merge Cross-File Integration', () => {
    const test_temp_dir = join(process.cwd(), 'temp_bh_merge_test');
    let document_store: DocumentStore;
    let diagnostic_provider: DiagnosticsProvider;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        document_store = new DocumentStore();
        diagnostic_provider = new DiagnosticsProvider();
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    describe('c_locals feature validation', () => {
        /**
         * Test that calling a program with c_locals registers those macros in the caller's scope.
         * This validates the core c_locals feature: when workspace_symbols contains a program
         * with c_locals, calling that program should suppress undefined macro warnings for
         * those c_local names.
         */
        it('should suppress undefined warnings for c_local macros when program is in workspace_symbols', () => {
            const lexer = new StataLexer();
            const parser = new StataParser();
            const analyzer = new SemanticAnalyzer();

            // Create workspace symbols with a program that has c_locals
            const workspace_symbols: SymbolTable = {
                programs: new Map([
                    ['bh_merge', {
                        name: 'bh_merge',
                        location: { 
                            uri: 'file:///bh_merge.do', 
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } 
                        },
                        sourceUri: 'file:///bh_merge.do',
                        c_locals: ['bh_merge_bh_vars_renamed', 'bh_merge_bh_vars_final'],
                    }]
                ]),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            };

            // Caller code that uses bh_merge and references the c_local macros
            const caller_code = `* Call the program
bh_merge caseid v001, bh(bh)

* Use the returned locals from bh_merge - should NOT produce warnings
local renamed_vars \`bh_merge_bh_vars_renamed'
local final_vars \`bh_merge_bh_vars_final'

di "Renamed: \`renamed_vars'"
di "Final: \`final_vars'"`;

            const lexer_result = lexer.tokenize(caller_code);
            const parse_result = parser.parse(lexer_result.tokens);
            const analysis_result = analyzer.analyze(
                parse_result.ast,
                'file:///caller.do',
                workspace_symbols,
                { undefined_macro_enabled: true },
                lexer_result.tokens
            );

            // Filter for undefined macro warnings about the c_local macros
            const c_local_warnings = analysis_result.diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                (d.symbol_name === 'bh_merge_bh_vars_renamed' ||
                 d.symbol_name === 'bh_merge_bh_vars_final')
            );

            // c_local macros should be registered when calling the program,
            // so there should be NO undefined warnings for them
            expect(c_local_warnings).toHaveLength(0);
        });

        /**
         * Test that c_local macros are only available AFTER the program call.
         * References before the call should still produce warnings.
         */
        it('should warn for c_local references BEFORE the program call', () => {
            const lexer = new StataLexer();
            const parser = new StataParser();
            const analyzer = new SemanticAnalyzer();

            const workspace_symbols: SymbolTable = {
                programs: new Map([
                    ['test_prog', {
                        name: 'test_prog',
                        location: { 
                            uri: 'file:///test_prog.do', 
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } 
                        },
                        sourceUri: 'file:///test_prog.do',
                        c_locals: ['result_macro'],
                    }]
                ]),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            };

            // Reference c_local BEFORE calling the program
            const caller_code = `* Reference before call - should warn
di \`result_macro'

* Call the program
test_prog

* Reference after call - should NOT warn
di \`result_macro'`;

            const lexer_result = lexer.tokenize(caller_code);
            const parse_result = parser.parse(lexer_result.tokens);
            const analysis_result = analyzer.analyze(
                parse_result.ast,
                'file:///caller.do',
                workspace_symbols,
                { undefined_macro_enabled: true },
                lexer_result.tokens
            );

            const result_warnings = analysis_result.diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                d.symbol_name === 'result_macro'
            );

            // Should have exactly 1 warning for the reference BEFORE the call
            expect(result_warnings).toHaveLength(1);
            // The warning should be on line 1 (the first reference)
            expect(result_warnings[0].range.start.line).toBe(1);
        });

        /**
         * Test that programs without c_locals don't affect macro resolution.
         */
        it('should not affect macro resolution for programs without c_locals', () => {
            const lexer = new StataLexer();
            const parser = new StataParser();
            const analyzer = new SemanticAnalyzer();

            const workspace_symbols: SymbolTable = {
                programs: new Map([
                    ['simple_prog', {
                        name: 'simple_prog',
                        location: { 
                            uri: 'file:///simple_prog.do', 
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } 
                        },
                        sourceUri: 'file:///simple_prog.do',
                        // No c_locals
                    }]
                ]),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            };

            const caller_code = `simple_prog
di \`undefined_macro'`;

            const lexer_result = lexer.tokenize(caller_code);
            const parse_result = parser.parse(lexer_result.tokens);
            const analysis_result = analyzer.analyze(
                parse_result.ast,
                'file:///caller.do',
                workspace_symbols,
                { undefined_macro_enabled: true },
                lexer_result.tokens
            );

            const undefined_warnings = analysis_result.diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );

            // Should warn for undefined_macro since simple_prog has no c_locals
            expect(undefined_warnings).toHaveLength(1);
        });

        /**
         * Test real-world bh_merge scenario with file-based setup.
         */
        it('should validate end-to-end functionality with bh_merge program and caller', async () => {
            // Create the bh_merge program file
            const bh_merge_path = join(test_temp_dir, 'bh_merge.do');
            const bh_merge_content = `program define bh_merge
    version 18
    syntax varlist, [bh(name)] [nogen]

    * Return information to caller about BH vars after collision renaming
    c_local bh_merge_bh_vars_renamed "oldvar1 oldvar2"
    c_local bh_merge_bh_vars_final "var1 var2 var3"
end`;
            writeFileSync(bh_merge_path, bh_merge_content);

            // Create the caller file
            const caller_path = join(test_temp_dir, 'survey.do');
            const caller_content = `* Setup merge variables
local merge_vars "caseid v001 v002 v003"

* Perform the merge using bh_merge
bh_merge \`merge_vars', bh(bh)

* Use the returned local from bh_merge - this should NOT produce a warning
local raw_vars_bh \`bh_merge_bh_vars_final'

* Display the variables for verification
di "BH variables after merge: \`raw_vars_bh'"`;
            writeFileSync(caller_path, caller_content);

            // First, parse the bh_merge file to extract its symbols (including c_locals)
            const bh_merge_uri = URI.file(bh_merge_path);
            await document_store.open(bh_merge_uri.toString(), bh_merge_content, 1);
            const bh_merge_doc = document_store.get(bh_merge_uri.toString())!;

            // Build workspace_symbols from the bh_merge document
            const workspace_symbols = create_empty_symbol_table();
            for (const [name, program] of bh_merge_doc.symbols.programs) {
                workspace_symbols.programs.set(name, program);
            }

            // Now open the caller file with workspace_symbols
            const caller_uri = URI.file(caller_path);
            await document_store.open(caller_uri.toString(), caller_content, 1, workspace_symbols);

            // Get diagnostics for the caller file
            const caller_document = document_store.get(caller_uri.toString())!;
            const diagnostics = await diagnostic_provider.get_diagnostics(
                caller_document,
                DEFAULT_CONFIG
            );

            // Filter for undefined macro warnings about bh_merge_bh_vars_final
            const bh_vars_final_warnings = diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'bh_merge_bh_vars_final'
            );

            // c_local macros should be registered when calling bh_merge,
            // so there should be NO undefined warnings
            expect(bh_vars_final_warnings).toHaveLength(0);
        });

        /**
         * Test multiple c_local returns from a program.
         */
        it('should handle multiple c_local returns from bh_merge', async () => {
            const bh_merge_path = join(test_temp_dir, 'bh_merge.do');
            const bh_merge_content = `program define bh_merge
    syntax varlist, [bh(name)] [nogen]
    
    * Return multiple locals to caller
    c_local bh_merge_bh_vars_renamed "oldvar1 oldvar2"
    c_local bh_merge_bh_vars_final "var1 var2 var3"
end`;
            writeFileSync(bh_merge_path, bh_merge_content);

            const caller_path = join(test_temp_dir, 'caller.do');
            const caller_content = `bh_merge caseid v001, bh(bh)

* Both of these should be resolved without warnings
local renamed_vars \`bh_merge_bh_vars_renamed'
local final_vars \`bh_merge_bh_vars_final'

di "Renamed: \`renamed_vars'"
di "Final: \`final_vars'"`;
            writeFileSync(caller_path, caller_content);

            const bh_merge_uri = URI.file(bh_merge_path);
            await document_store.open(bh_merge_uri.toString(), bh_merge_content, 1);
            const bh_merge_doc = document_store.get(bh_merge_uri.toString())!;

            const workspace_symbols = create_empty_symbol_table();
            for (const [name, program] of bh_merge_doc.symbols.programs) {
                workspace_symbols.programs.set(name, program);
            }

            const caller_uri = URI.file(caller_path);
            await document_store.open(caller_uri.toString(), caller_content, 1, workspace_symbols);

            const caller_document = document_store.get(caller_uri.toString())!;
            const diagnostics = await diagnostic_provider.get_diagnostics(
                caller_document,
                DEFAULT_CONFIG
            );

            const undefined_warnings = diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                ((d.data as { symbol_name?: string } | undefined)?.symbol_name === 'bh_merge_bh_vars_renamed' ||
                 (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'bh_merge_bh_vars_final')
            );

            // Both c_local macros should be resolved without warnings
            expect(undefined_warnings).toHaveLength(0);
        });
    });
});

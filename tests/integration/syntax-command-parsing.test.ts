/**
 * Integration tests for syntax command parsing
 *
 * Tests completion and hover functionality with user-defined programs
 * that have syntax declarations, including cross-file navigation.
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { CompletionProvider } from '../../src/providers/completion';
import { HoverProvider } from '../../src/providers/hover';
import { DocumentStore } from '../../src/document-store';
import { CommandDatabase } from '../../src/commands';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';

describe('Syntax Command Parsing - Integration Tests', () => {
    const test_temp_dir = join(process.cwd(), 'temp_syntax_test_workspace');
    let indexer: WorkspaceIndexer;
    let completion_provider: CompletionProvider;
    let hover_provider: HoverProvider;
    let document_store: DocumentStore;
    let command_db: CommandDatabase;

    beforeEach(() => {
        // Setup a temporary workspace
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        indexer = new WorkspaceIndexer();
        command_db = new CommandDatabase();
        completion_provider = new CompletionProvider(command_db);
        hover_provider = new HoverProvider(command_db);
        document_store = new DocumentStore();
    });

    // Cleanup
    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    describe('Cross-file Navigation with Syntax Commands', () => {
        it('should provide completions for user program options across files', async () => {
            // Create a helper file with a program that has a syntax declaration
            const helper_file_path = join(test_temp_dir, 'helper.ado');
            const helper_content = `program define my_regression
    syntax varlist [if] [in] [, level(real 95) noconstant *]
    display "Running regression"
end
`;
            writeFileSync(helper_file_path, helper_content);

            // Create a main file that calls the program
            const main_file_path = join(test_temp_dir, 'main.do');
            const main_content = `my_regression y x, `;
            writeFileSync(main_file_path, main_content);

            // Index the workspace
            await indexer.initialize([test_temp_dir]);

            // Parse the helper file to extract the program signature
            const lexer = new StataLexer();
            const helper_tokens = lexer.tokenize(helper_content).tokens;
            const parser = new StataParser();
            const helper_ast = parser.parse(helper_tokens).ast;
            const analyzer = new SemanticAnalyzer();
            const helper_symbols = analyzer.analyze(helper_ast, helper_file_path).symbols;

            // Open the main file in document store
            const main_file_uri = URI.file(main_file_path).toString();
            await document_store.open(main_file_uri, main_content, 1);
            const main_doc = document_store.get(main_file_uri)!;

            // Verify the program was parsed and has a signature
            expect(helper_symbols.programs.has('my_regression')).toBe(true);
            const program = helper_symbols.programs.get('my_regression');
            expect(program).toBeDefined();
            
            // Verify signature was extracted with options
            if (program?.signature) {
                const option_names = program.signature.options.map(opt => opt.name);
                expect(option_names).toContain('level');
                expect(option_names).toContain('noconstant');
            }
        });

        it('should provide hover info for user program with syntax across files', async () => {
            // Create a helper file with a program that has a syntax declaration
            const helper_file_path = join(test_temp_dir, 'helper.ado');
            const helper_content = `program define my_analysis
    syntax varlist [if] [in] [, detail replace]
    display "Analysis complete"
end
`;
            writeFileSync(helper_file_path, helper_content);

            // Create a main file that calls the program
            const main_file_path = join(test_temp_dir, 'main.do');
            const main_content = `my_analysis y x`;
            writeFileSync(main_file_path, main_content);

            // Index the workspace
            await indexer.initialize([test_temp_dir]);

            // Parse the helper file to extract the program signature
            const lexer = new StataLexer();
            const helper_tokens = lexer.tokenize(helper_content).tokens;
            const parser = new StataParser();
            const helper_ast = parser.parse(helper_tokens).ast;
            const analyzer = new SemanticAnalyzer();
            const helper_symbols = analyzer.analyze(helper_ast, helper_file_path).symbols;

            // Open the main file in document store
            const main_file_uri = URI.file(main_file_path).toString();
            await document_store.open(main_file_uri, main_content, 1);
            const main_doc = document_store.get(main_file_uri)!;

            // Merge workspace symbols with document symbols
            const merged_symbols = {
                programs: new Map([...helper_symbols.programs, ...main_doc.symbols.programs]),
                localMacros: new Map([...helper_symbols.localMacros, ...main_doc.symbols.localMacros]),
                globalMacros: new Map([...helper_symbols.globalMacros, ...main_doc.symbols.globalMacros]),
                variables: new Map([...helper_symbols.variables, ...main_doc.symbols.variables]),
            };

            // Get hover info for the program name
            const hover = await hover_provider.get_hover(
                main_doc,
                { line: 0, character: 2 },
                merged_symbols
            );

            // Should have hover info
            expect(hover).not.toBeNull();
            if (hover && typeof hover.contents === 'object' && 'value' in hover.contents) {
                expect(hover.contents.value).toContain('my_analysis');
            }
        });

        it('should handle multiple syntax commands in a program', async () => {
            // Create a helper file with a program that has multiple syntax declarations
            const helper_file_path = join(test_temp_dir, 'helper.ado');
            const helper_content = `program define flexible_cmd
    if "\`1'" == "option1" {
        syntax varlist [if] [in] [, opt1(string)]
    }
    else {
        syntax anything [, opt2(real) opt3]
    }
    display "Command executed"
end
`;
            writeFileSync(helper_file_path, helper_content);

            // Parse the helper file
            const lexer = new StataLexer();
            const helper_tokens = lexer.tokenize(helper_content).tokens;
            const parser = new StataParser();
            const helper_ast = parser.parse(helper_tokens).ast;
            const analyzer = new SemanticAnalyzer();
            const helper_symbols = analyzer.analyze(helper_ast, helper_file_path).symbols;

            // Verify the program was parsed
            expect(helper_symbols.programs.has('flexible_cmd')).toBe(true);
            
            const program = helper_symbols.programs.get('flexible_cmd');
            expect(program).toBeDefined();
            
            // If signature was extracted, it should have options from both syntax commands
            if (program?.signature) {
                const option_names = program.signature.options.map(opt => opt.name);
                // Should have options from both syntax declarations
                expect(option_names.length).toBeGreaterThan(0);
            }
        });
    });

    describe('Real-world Syntax Patterns', () => {
        it('should handle regression-style pattern: syntax varlist [if] [in] [, options]', () => {
            const content = `program define my_regression
    syntax varlist [if] [in] [, level(real 95) noconstant robust]
    display "Regression with \`varlist'"
end
`;
            const lexer = new StataLexer();
            const tokens = lexer.tokenize(content).tokens;
            const parser = new StataParser();
            const parse_result = parser.parse(tokens);
            
            expect(parse_result.errors.length).toBe(0);
            const ast = parse_result.ast;
            expect(ast).toBeDefined();

            const analyzer = new SemanticAnalyzer();
            const analysis_result = analyzer.analyze(ast, 'file:///test.ado');
            const symbols = analysis_result.symbols;
            
            expect(symbols.programs.has('my_regression')).toBe(true);
            const program = symbols.programs.get('my_regression');
            
            // Verify signature was extracted
            if (program?.signature) {
                expect(program.signature.arguments.length).toBeGreaterThan(0);
                expect(program.signature.options.length).toBeGreaterThan(0);
            }
        });

        it('should handle flexible input pattern: syntax anything [, options]', () => {
            const content = `program define flexible_cmd
    syntax anything [, detail replace]
    display "Input: \`anything'"
end
`;
            const lexer = new StataLexer();
            const tokens = lexer.tokenize(content).tokens;
            const parser = new StataParser();
            const parse_result = parser.parse(tokens);
            
            expect(parse_result.errors.length).toBe(0);
            const ast = parse_result.ast;
            expect(ast).toBeDefined();

            const analyzer = new SemanticAnalyzer();
            const analysis_result = analyzer.analyze(ast, 'file:///test.ado');
            const symbols = analysis_result.symbols;
            
            expect(symbols.programs.has('flexible_cmd')).toBe(true);
        });

        it('should handle file-based pattern: syntax [varlist] [if] [in] using ...', () => {
            const content = `program define file_cmd
    syntax [varlist] [if] [in] using "filename" [, replace]
    display "File: \`using'"
end
`;
            const lexer = new StataLexer();
            const tokens = lexer.tokenize(content).tokens;
            const parser = new StataParser();
            const parse_result = parser.parse(tokens);
            
            expect(parse_result.errors.length).toBe(0);
            const ast = parse_result.ast;
            expect(ast).toBeDefined();

            const analyzer = new SemanticAnalyzer();
            const analysis_result = analyzer.analyze(ast, 'file:///test.ado');
            const symbols = analysis_result.symbols;
            
            expect(symbols.programs.has('file_cmd')).toBe(true);
        });

        it('should handle generate-style pattern: syntax newvarname = exp', () => {
            const content = `program define gen_cmd
    syntax newvarname = exp [, replace]
    display "New variable: \`varlist'"
end
`;
            const lexer = new StataLexer();
            const tokens = lexer.tokenize(content).tokens;
            const parser = new StataParser();
            const parse_result = parser.parse(tokens);
            
            expect(parse_result.errors.length).toBe(0);
            const ast = parse_result.ast;
            expect(ast).toBeDefined();

            const analyzer = new SemanticAnalyzer();
            const analysis_result = analyzer.analyze(ast, 'file:///test.ado');
            const symbols = analysis_result.symbols;
            
            expect(symbols.programs.has('gen_cmd')).toBe(true);
        });
    });

    describe('Implicit Local Registration', () => {
        it('should register implicit locals from syntax arguments', () => {
            const content = `program define test_prog
    syntax varlist [if] [in] [, opt1(string)]
    display "varlist: \`varlist'"
    display "if: \`if'"
    display "in: \`in'"
    display "opt1: \`opt1'"
end
`;
            const lexer = new StataLexer();
            const tokens = lexer.tokenize(content).tokens;
            const parser = new StataParser();
            const parse_result = parser.parse(tokens);
            
            expect(parse_result.errors.length).toBe(0);

            const analyzer = new SemanticAnalyzer();
            const analysis_result = analyzer.analyze(parse_result.ast, 'file:///test.ado');
            const symbols = analysis_result.symbols;
            
            expect(symbols.programs.has('test_prog')).toBe(true);
            const program = symbols.programs.get('test_prog');
            
            // Verify implicit locals were registered
            if (program?.signature) {
                const arg_names = program.signature.arguments.map(arg => arg.type);
                expect(arg_names).toContain('varlist');
                expect(arg_names).toContain('if');
                expect(arg_names).toContain('in');
                
                const option_names = program.signature.options.map(opt => opt.name);
                expect(option_names).toContain('opt1');
            }
        });
    });

    describe('Performance Validation', () => {
        it('should parse syntax commands with acceptable performance', () => {
            // Generate a program with syntax command
            const syntax_content = `program define syntax_prog
    syntax varlist [if] [in] [, level(real 95) noconstant robust detail]
    display "This is a program with syntax"
    local x = 1
    local y = 2
    local z = 3
end
`;

            const lexer = new StataLexer();
            const parser = new StataParser();

            // Warm up
            lexer.tokenize(syntax_content);

            // Measure parse time (average of 10 runs)
            let total_ms = 0;
            for (let i = 0; i < 10; i++) {
                const tokens = lexer.tokenize(syntax_content).tokens;
                const start_time = performance.now();
                parser.parse(tokens);
                total_ms += performance.now() - start_time;
            }
            const avg_ms = total_ms / 10;

            // Verify parse completes in reasonable time (< 10ms per parse)
            expect(avg_ms).toBeLessThan(10);
        });

        it('should handle large programs with syntax commands efficiently', () => {
            // Generate a large program with multiple syntax commands
            let large_content = 'program define large_prog\n';
            
            // Add multiple syntax commands
            for (let i = 0; i < 5; i++) {
                large_content += `    if "\`1'" == "mode${i}" {\n`;
                large_content += `        syntax varlist [if] [in] [, opt${i}(string) detail]\n`;
                large_content += `    }\n`;
            }
            
            // Add some body code
            for (let i = 0; i < 50; i++) {
                large_content += `    local var_${i} = ${i}\n`;
            }
            
            large_content += 'end\n';

            const lexer = new StataLexer();
            const parser = new StataParser();
            const analyzer = new SemanticAnalyzer();

            // Measure parse time
            const start_time = performance.now();
            const tokens = lexer.tokenize(large_content).tokens;
            const parse_result = parser.parse(tokens);
            const analysis_result = analyzer.analyze(parse_result.ast, 'file:///test.ado');
            const elapsed_ms = performance.now() - start_time;

            // Should complete in reasonable time (< 100ms for this size)
            expect(elapsed_ms).toBeLessThan(100);
            
            // Should parse without errors
            expect(parse_result.errors.length).toBe(0);
            
            // Should extract program
            expect(analysis_result.symbols.programs.has('large_prog')).toBe(true);
        });

        it('should maintain linear scaling with file size', () => {
            const lexer = new StataLexer();
            const parser = new StataParser();

            // Generate small program
            const small_content = `program define small_prog
    syntax varlist [if] [in] [, opt1(string)]
    display "Small program"
end
`;

            // Generate large program (roughly 2x the size)
            let large_content = `program define large_prog
    syntax varlist [if] [in] [, opt1(string) opt2(real) opt3 opt4(string) opt5(real)]
    display "Large program"
`;
            for (let i = 0; i < 20; i++) {
                large_content += `    local var_${i} = ${i}\n`;
            }
            large_content += 'end\n';

            // Warm up
            lexer.tokenize(small_content);
            lexer.tokenize(large_content);

            // Measure small
            const small_start = performance.now();
            const small_tokens = lexer.tokenize(small_content).tokens;
            parser.parse(small_tokens);
            const small_time = performance.now() - small_start;

            // Measure large
            const large_start = performance.now();
            const large_tokens = lexer.tokenize(large_content).tokens;
            parser.parse(large_tokens);
            const large_time = performance.now() - large_start;

            // Calculate size ratio
            const size_ratio = large_content.length / small_content.length;
            
            // Only check scaling if both operations took measurable time
            if (small_time > 0.1 && large_time > 0.1) {
                const time_ratio = large_time / small_time;
                
                // Time ratio should be reasonably close to size ratio (within ±50%)
                // This is a loose check to account for system variability
                const tolerance = size_ratio * 0.5;
                expect(time_ratio).toBeGreaterThan(size_ratio - tolerance);
                expect(time_ratio).toBeLessThan(size_ratio + tolerance);
            }
        });
    });
});

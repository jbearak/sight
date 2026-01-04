import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';
import { ContextTracker } from '../src/context-tracker';
import { IndentationDiagnosticAnalyzer } from '../src/providers/indentation-diagnostics';
import { DocumentState } from '../src/document-store';
import { CodeFormatter } from '../src/providers/formatter';
import { init_tracker_from_source } from './test-context-helper';
import { for_each_formatter_mode, create_formatter_config } from './property/helpers/formatter-test-utils';

describe('Mata block indentation bug reproduction', () => {
    it('should not flag end statement as unnecessarily indented', () => {
        const source = `local is_default 1
if \`is_default' == 1 {
    // Append all the DHS datasets that were just processed:
    clear
    mata
    stata(sprintf(\`"use \\"\`"%s"'\\""', recoded_files_dhs[1]))
    for (i=2; i <= rows(recoded_files_dhs); i++) {
        stata(sprintf(\`"append using \\"\`"%s"'\\"', force"', recoded_files_dhs[i]))
    }
    end
    saveold "output/dhs.dta", replace version(12)
}`;

        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(source);

        console.log("=== TOKENS ===");
        for (const token of lex_result.tokens) {
            if (token.type !== 'WHITESPACE') {
                console.log(`Line ${token.range.start.line}: ${token.type} = "${token.value}"`);
            }
        }

        const context_tracker = new ContextTracker();
        init_tracker_from_source(context_tracker, source);

        console.log("\n=== CONTEXT RANGES ===");
        const context_ranges = context_tracker.get_all_context_ranges();
        for (const range of context_ranges) {
            console.log(`Context: ${range.context}, Lines: ${range.range.start.line}-${range.range.end.line}`);
        }

        const parser = new StataParser();
        const parse_result = parser.parse(lex_result.tokens, context_tracker);

        console.log("\n=== AST NODES ===");
        function printNode(node: any, indent: string = "") {
            console.log(`${indent}${node.type}: lines ${node.range.start.line}-${node.range.end.line}`);
            if (node.body) {
                for (const child of node.body) {
                    printNode(child, indent + "  ");
                }
            }
        }
        for (const node of parse_result.ast.nodes) {
            printNode(node);
        }

        // Create document state
        const document: DocumentState = {
            uri: 'test://test.do',
            content: source,
            version: 1,
            tokens: lex_result.tokens,
            ast: parse_result.ast,
            symbols: { localMacros: new Map(), globalMacros: new Map(), programs: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
            diagnostics: [],
            context_tracker: context_tracker,
            context_ranges: context_ranges,
            line_offsets: lex_result.line_offsets,
        };

        const analyzer = new IndentationDiagnosticAnalyzer();
        const config = {
            diagnostics: { indentation: true },
            formatting: { indentSize: 4 }
        };

        console.log("\n=== EXPECTED DEPTHS ===");
        const expected_depths = analyzer.compute_expected_depths(document, { start: 0, end: 15 });
        for (const [line, depth] of expected_depths) {
            console.log(`Line ${line}: depth ${depth}`);
        }

        console.log("\n=== DIAGNOSTICS ===");
        const diagnostics = analyzer.analyze(document, config as any);
        for (const diag of diagnostics) {
            console.log(`Line ${diag.range.start.line}: ${diag.message}`);
        }

        // The "end" statement on line 10 should NOT be flagged as unnecessarily indented
        // It's correctly indented at the same level as "mata" (both inside the if block)
        const end_line_diagnostics = diagnostics.filter(d => d.range.start.line === 10);
        expect(end_line_diagnostics.length).toBe(0);
    });

    for_each_formatter_mode('should not delete code after mata block when formatting', (mode) => {
        const source = `local is_default 1
if \`is_default' == 1 {
    // Append all the DHS datasets that were just processed:
    clear
    mata
    stata(sprintf(\`"use \\"\`"%s"'\\""', recoded_files_dhs[1]))
    for (i=2; i <= rows(recoded_files_dhs); i++) {
        stata(sprintf(\`"append using \\"\`"%s"'\\"', force"', recoded_files_dhs[i]))
    }
    end
    saveold "output/dhs.dta", replace version(12)
}`;

        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(source);

        const context_tracker = new ContextTracker();
        init_tracker_from_source(context_tracker, source);

        const parser = new StataParser();
        const parse_result = parser.parse(lex_result.tokens, context_tracker);

        // Create document state
        const document: DocumentState = {
            uri: 'test://test.do',
            content: source,
            version: 1,
            tokens: lex_result.tokens,
            ast: parse_result.ast,
            symbols: { localMacros: new Map(), globalMacros: new Map(), programs: new Map(), variables: new Map(), scalars: new Map(), matrices: new Map() },
            diagnostics: [],
            context_tracker: context_tracker,
            context_ranges: context_tracker.get_all_context_ranges(),
            line_offsets: lex_result.line_offsets,
        };

        const config = create_formatter_config(mode);
        const formatter = new CodeFormatter(config);
        const edits = formatter.format(document, { tabSize: 4, insertSpaces: true });

        console.log(`\n=== FORMATTED OUTPUT [${mode}] ===`);
        if (edits.length > 0) {
            console.log(edits[0].newText);
        }

        // The formatted output should contain:
        // 1. The "end" statement
        // 2. The "saveold" command after the mata block
        // 3. The closing brace of the if block
        expect(edits.length).toBe(1);
        const formatted = edits[0].newText;
        expect(formatted).toContain('end');
        expect(formatted).toContain('saveold');
        expect(formatted.trim().endsWith('}')).toBe(true);
    });
});

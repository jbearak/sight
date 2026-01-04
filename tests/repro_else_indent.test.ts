import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';
import { IndentationDiagnosticAnalyzer } from '../src/providers/indentation-diagnostics';
import { DocumentState } from '../src/document-store';
import { ContextTracker } from '../src/context-tracker';

/**
 * Reproduction tests for else block indentation false positive bug.
 * 
 * The bug: When an else block contains a statement starting with a macro reference
 * (e.g., `custom_arg' "test"), the parser previously didn't recognize it as a command,
 * resulting in:
 * 1. else.body being empty
 * 2. No expected depth computed for lines inside the else block
 * 3. False positive "unnecessarily indented" diagnostics
 * 
 * The fix: Parser now recognizes MACRO_REF_LOCAL and MACRO_REF_GLOBAL tokens
 * as valid command names via parseMacroCommand().
 * 
 * Requirements validated:
 * - 1.1: Parser recognizes local macro at start of statement
 * - 1.3: Else block body includes macro-reference statements
 * - 2.1: Indentation analyzer computes correct depth for else block content
 * - 2.2: No false positive diagnostics for correctly-indented code
 * - 2.3: AST-based depth computation walks else block body nodes
 */
describe('else block indentation bug', () => {
    it('should not flag correctly indented else block content', () => {
        // This is the original bug reproduction case
        const code = `capture program drop _loop_execute_survey
program define _loop_execute_survey
    args custom_arg is_script country_name survey_year
    if \`is_script' == 1 {
        do "\`custom_arg'" "\`country_name'" "\`survey_year'"
    }
    else {
        \`custom_arg' "\`country_name'" "\`survey_year'"
    }
end`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        const parser = new StataParser();
        const { ast, errors } = parser.parse(tokens);
        
        // Verify no parse errors (Requirements 1.1, 1.2)
        expect(errors.length).toBe(0);
        
        // Verify else block has body content (Requirement 1.3)
        const program_node = ast.nodes.find((n: any) => n.type === 'program');
        expect(program_node).toBeDefined();
        const else_node = program_node?.body?.find((n: any) => n.type === 'else');
        expect(else_node).toBeDefined();
        expect(else_node?.body?.length).toBe(1); // The macro command should be in the body
        
        // Create document state
        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(tokens);
        
        const document: DocumentState = {
            uri: 'test://test.do',
            content: code,
            version: 1,
            tokens,
            ast,
            symbols: { programs: [], macros: [], variables: [], scalars: [], matrices: [] },
            diagnostics: [],
            context_tracker,
            line_offsets: [],
        };
        
        const analyzer = new IndentationDiagnosticAnalyzer();
        const config = {
            diagnostics: { indentation: true },
            formatting: { indentSize: 4 }
        } as any;
        
        const diagnostics = analyzer.analyze(document, config);
        
        // Line 8 (0-indexed: 7) should NOT have an unnecessary indentation diagnostic
        // This is the key assertion - the bug caused a false positive here
        const line8_diags = diagnostics.filter(d => d.range.start.line === 7);
        expect(line8_diags.length).toBe(0);
        
        // Verify no unnecessary indentation diagnostics at all for this correctly-indented code
        const unnecessary_diags = diagnostics.filter(d => 
            d.message.includes('unnecessarily indented')
        );
        expect(unnecessary_diags.length).toBe(0);
    });
    
    it('should compute correct expected depths for else blocks', () => {
        // Test that expected depths are correctly computed for all lines
        // Requirements: 2.1, 2.3, 2.4, 2.5
        const code = `capture program drop _loop_execute_survey
program define _loop_execute_survey
    args custom_arg is_script country_name survey_year
    if \`is_script' == 1 {
        do "\`custom_arg'" "\`country_name'" "\`survey_year'"
    }
    else {
        \`custom_arg' "\`country_name'" "\`survey_year'"
    }
end`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        const parser = new StataParser();
        const { ast } = parser.parse(tokens);
        
        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(tokens);
        
        const document: DocumentState = {
            uri: 'test://test.do',
            content: code,
            version: 1,
            tokens,
            ast,
            symbols: { programs: [], macros: [], variables: [], scalars: [], matrices: [] },
            diagnostics: [],
            context_tracker,
            line_offsets: [],
        };
        
        const analyzer = new IndentationDiagnosticAnalyzer();
        const expected_depths = analyzer.compute_expected_depths(document, { start: 0, end: 10 });
        
        // Verify expected depths for each line:
        // Line 0 (capture...): depth 0 (top-level)
        expect(expected_depths.get(0)).toBe(0);
        
        // Line 1 (program define...): depth 0 (program definition line)
        expect(expected_depths.get(1)).toBe(0);
        
        // Line 2 (args...): depth 1 (inside program)
        expect(expected_depths.get(2)).toBe(1);
        
        // Line 3 (if...): depth 1 (inside program)
        expect(expected_depths.get(3)).toBe(1);
        
        // Line 4 (do...): depth 2 (inside program > inside if)
        expect(expected_depths.get(4)).toBe(2);
        
        // Line 5 (}): depth 1 (closing brace of if)
        expect(expected_depths.get(5)).toBe(1);
        
        // Line 6 (else {): depth 1 (inside program)
        expect(expected_depths.get(6)).toBe(1);
        
        // Line 7 (`custom_arg'...): depth 2 (inside program > inside else)
        // This is the KEY assertion - the bug caused this to be undefined or 0
        expect(expected_depths.get(7)).toBe(2);
        
        // Line 8 (}): depth 1 (closing brace of else)
        expect(expected_depths.get(8)).toBe(1);
        
        // Line 9 (end): depth 0 (closing of program)
        expect(expected_depths.get(9)).toBe(0);
    });
    
    it('should parse else block with macro expansion command', () => {
        // Simpler test case - just the else block content
        // Requirements: 1.1, 1.3
        const code = `if 1 {
    display "hello"
}
else {
    \`custom_arg' "test"
}`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        
        const parser = new StataParser();
        const { ast, errors } = parser.parse(tokens);
        
        // Verify no parse errors
        expect(errors.length).toBe(0);
        
        // The else block should have 1 body element (the macro command)
        const else_node = ast.nodes.find((n: any) => n.type === 'else');
        expect(else_node).toBeDefined();
        expect(else_node?.body?.length).toBe(1);
        
        // Verify the body element is a command node with the macro reference as name
        const body_node = else_node?.body?.[0];
        expect(body_node?.type).toBe('command');
        expect(body_node?.name).toBe("`custom_arg'");
    });
    
    it('should handle global macro reference as command name', () => {
        // Test global macro reference at start of statement
        // Requirements: 1.2, 1.3
        const code = `if 1 {
    display "hello"
}
else {
    \${global_cmd} "arg1" "arg2"
}`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        
        const parser = new StataParser();
        const { ast, errors } = parser.parse(tokens);
        
        // Verify no parse errors
        expect(errors.length).toBe(0);
        
        // The else block should have 1 body element
        const else_node = ast.nodes.find((n: any) => n.type === 'else');
        expect(else_node).toBeDefined();
        expect(else_node?.body?.length).toBe(1);
        
        // Verify the body element is a command node with the global macro reference
        const body_node = else_node?.body?.[0];
        expect(body_node?.type).toBe('command');
        expect(body_node?.name).toBe('${global_cmd}');
    });
    
    it('should compute correct depths for nested else blocks', () => {
        // Test nested if/else structures
        // Requirements: 2.5
        const code = `program define test
    if 1 {
        if 2 {
            display "nested"
        }
        else {
            \`cmd' "arg"
        }
    }
    else {
        \`outer_cmd' "arg"
    }
end`;

        const lexer = new StataLexer();
        const { tokens } = lexer.tokenize(code);
        const parser = new StataParser();
        const { ast } = parser.parse(tokens);
        
        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(tokens);
        
        const document: DocumentState = {
            uri: 'test://test.do',
            content: code,
            version: 1,
            tokens,
            ast,
            symbols: { programs: [], macros: [], variables: [], scalars: [], matrices: [] },
            diagnostics: [],
            context_tracker,
            line_offsets: [],
        };
        
        const analyzer = new IndentationDiagnosticAnalyzer();
        const expected_depths = analyzer.compute_expected_depths(document, { start: 0, end: 15 });
        
        // Line 6 (`cmd' "arg"): depth 3 (program > if > else)
        expect(expected_depths.get(6)).toBe(3);
        
        // Line 10 (`outer_cmd' "arg"): depth 2 (program > else)
        expect(expected_depths.get(10)).toBe(2);
    });
});

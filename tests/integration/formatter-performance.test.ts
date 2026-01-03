import { describe, it, expect } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ContextTracker } from '../../src/context-tracker';
import type { DocumentState } from '../../src/document-store';

describe('Formatter Performance Tests', () => {
    const formatter = new CodeFormatter();

    function create_document_state(content: string): DocumentState {
        const lexer = new StataLexer();
        const lex_result = lexer.tokenize(content);
        const parser = new StataParser();
        const parse_result = parser.parse(lex_result.tokens);
        
        return {
            uri: 'file:///test.do',
            version: 1,
            content,
            tokens: lex_result.tokens,
            ast: parse_result.ast,
            symbols: {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            diagnostics: [],
            line_offsets: lex_result.line_offsets,
        };
    }

    function generate_large_file(num_lines: number): string {
        const lines: string[] = [];
        for (let i = 0; i < num_lines; i++) {
            if (i % 20 === 0) {
                lines.push(`if condition_${i} {`);
            } else if (i % 20 === 19) {
                lines.push('}');
            } else {
                lines.push(`    local var_${i} = ${i} // line ${i}`);
            }
        }
        return lines.join('\n');
    }

    function generate_file_with_embedded_blocks(num_blocks: number): string {
        const lines: string[] = [];
        for (let i = 0; i < num_blocks; i++) {
            lines.push(`local pre_${i} = ${i}`);
            lines.push('mata:');
            lines.push(`    real scalar x_${i}`);
            lines.push(`    x_${i} = ${i}`);
            lines.push('end');
            lines.push(`local post_${i} = ${i}`);
        }
        return lines.join('\n');
    }

    describe('Large File Performance', () => {
        it('should format 1000 lines in under 30ms', () => {
            const content = generate_large_file(1000);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(30);
        });

        it('should format 5000 lines in under 50ms', () => {
            const content = generate_large_file(5000);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(50);
        });
    });

    describe('Many Embedded Blocks Performance', () => {
        it('should handle 100 embedded blocks in under 10ms', () => {
            const content = generate_file_with_embedded_blocks(100);
            const doc = create_document_state(content);
            
            // Get context ranges for embedded blocks
            const tracker = new ContextTracker();
            tracker.initialize_from_tokens(doc.tokens!);
            doc.context_ranges = tracker.get_all_context_ranges();
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(10);
        });

        it('should handle 500 embedded blocks in under 30ms', () => {
            const content = generate_file_with_embedded_blocks(500);
            const doc = create_document_state(content);
            
            const tracker = new ContextTracker();
            tracker.initialize_from_tokens(doc.tokens!);
            doc.context_ranges = tracker.get_all_context_ranges();
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(30);
        });

        it('should respect MAX_EMBEDDED_BLOCKS limit (1000)', () => {
            // Generate more than 1000 embedded blocks
            const content = generate_file_with_embedded_blocks(1100);
            const doc = create_document_state(content);
            
            const tracker = new ContextTracker();
            tracker.initialize_from_tokens(doc.tokens!);
            doc.context_ranges = tracker.get_all_context_ranges();
            
            // Should not throw or hang
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            // Should complete quickly due to limit
            expect(elapsed_ms).toBeLessThan(50);
        });
    });

    describe('Block Comment Detection Performance', () => {
        function generate_file_with_block_comments(num_comments: number): string {
            const lines: string[] = [];
            for (let i = 0; i < num_comments; i++) {
                lines.push(`local var_${i} = ${i}`);
                lines.push('/*');
                lines.push(`  This is block comment ${i}`);
                lines.push('*/');
            }
            return lines.join('\n');
        }

        it('should handle 500 block comments in under 10ms', () => {
            const content = generate_file_with_block_comments(500);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(10);
        });
    });

    describe('Negative Delta Application Performance', () => {
        function generate_over_indented_file(num_lines: number): string {
            const lines: string[] = [];
            // Create deeply nested structure with excessive indentation
            lines.push('if condition {');
            for (let i = 0; i < num_lines; i++) {
                // Over-indent by 8 spaces (should be 4)
                lines.push(`        local var_${i} = ${i}`);
            }
            lines.push('}');
            return lines.join('\n');
        }

        it('should handle negative delta on 1000 lines in under 10ms', () => {
            const content = generate_over_indented_file(1000);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(10);
        });
    });
});

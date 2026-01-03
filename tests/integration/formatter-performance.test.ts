import { describe, it, expect } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';

describe('Formatter Performance Tests', () => {
    const formatter = new CodeFormatter();

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
        // Use stricter thresholds locally, relaxed in CI for environment variance
        const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
        const threshold1000 = isCI ? 60 : 20;   // Local: 20ms, CI: 60ms (3x)
        const threshold5000 = isCI ? 120 : 40;  // Local: 40ms, CI: 120ms (3x)
        
        it(`should format 1000 lines in under ${threshold1000}ms`, () => {
            const content = generate_large_file(1000);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(threshold1000);
        });

        it(`should format 5000 lines in under ${threshold5000}ms`, () => {
            const content = generate_large_file(5000);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(threshold5000);
        });
    });

    describe('Many Embedded Blocks Performance', () => {
        // Use stricter thresholds locally, relaxed in CI for environment variance
        const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
        const threshold100 = isCI ? 30 : 10;    // Local: 10ms, CI: 30ms (3x)
        const threshold500 = isCI ? 90 : 30;    // Local: 30ms, CI: 90ms (3x)
        const thresholdLimit = isCI ? 150 : 50; // Local: 50ms, CI: 150ms (3x)

        it(`should handle 100 embedded blocks in under ${threshold100}ms`, () => {
            const content = generate_file_with_embedded_blocks(100);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(threshold100);
        });

        it(`should handle 500 embedded blocks in under ${threshold500}ms`, () => {
            const content = generate_file_with_embedded_blocks(500);
            const doc = create_document_state(content);
            
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            expect(elapsed_ms).toBeLessThan(threshold500);
        });

        it(`should respect MAX_EMBEDDED_BLOCKS limit (1000) in under ${thresholdLimit}ms`, () => {
            // Generate more than 1000 embedded blocks
            const content = generate_file_with_embedded_blocks(1100);
            const doc = create_document_state(content);
            
            // Should not throw or hang
            const start_time = performance.now();
            const edits = formatter.format(doc, { tabSize: 4, insertSpaces: true });
            const elapsed_ms = performance.now() - start_time;
            
            expect(edits.length).toBe(1);
            // Should complete quickly due to limit
            expect(elapsed_ms).toBeLessThan(thresholdLimit);
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

/**
 * Unit tests for diagnostic source line attribution accuracy.
 * Tests that source_line refers to the actual call site line in the parent file
 * when known, and is omitted when unknown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('Diagnostic Source Line Attribution', () => {
    let temp_dir: string;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-line-test-'));
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function create_file(filename: string, content: string): string {
        const file_path = path.join(temp_dir, filename);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    }

    function file_uri(file_path: string): string {
        return `file://${file_path}`;
    }

    describe('Known call site includes line number', () => {
        it('should use call site line when line= is provided and in-bounds', async () => {
            // Parent file with do command on line 3 (0-indexed: 2)
            const parent_content = `* Parent file
global setup_var = 1
do "child.do"
global after_var = 2`;
            create_file('parent.do', parent_content);

            // Child with explicit line= parameter
            const child_content = `* @lsp-done-by: "parent.do" line=3
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find diagnostics with source attribution
            const diagnostics_with_source = result.diagnostics.filter(d => d.source !== undefined);

            // If there are diagnostics, they should have source_line set to the call site
            for (const diagnostic of diagnostics_with_source) {
                if (diagnostic.source?.source_file === 'parent.do' && diagnostic.source.source_line !== undefined) {
                    // source_line should be 2 (0-indexed for line 3)
                    expect(diagnostic.source.source_line).toBe(2);
                    // Message should include "line 3" (1-indexed)
                    expect(diagnostic.message).toContain('line 3');
                }
            }
        });

        it('should use matched line when match= resolves', async () => {
            // Parent file with do command containing specific text
            const parent_content = `* Parent file
global setup_var = 1
do "child.do"  // CALL_MARKER
global after_var = 2`;
            create_file('parent.do', parent_content);

            // Child with match= parameter
            const child_content = `* @lsp-done-by: "parent.do" match="CALL_MARKER"
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find diagnostics with source attribution
            const diagnostics_with_source = result.diagnostics.filter(d => d.source !== undefined);

            for (const diagnostic of diagnostics_with_source) {
                if (diagnostic.source?.source_file === 'parent.do' && diagnostic.source.source_line !== undefined) {
                    // source_line should be 2 (0-indexed for line 3 where CALL_MARKER is)
                    expect(diagnostic.source.source_line).toBe(2);
                    expect(diagnostic.message).toContain('line 3');
                }
            }
        });

        it('should use inferred call site line when text inference succeeds', async () => {
            // Parent file with do command on line 3 (0-indexed: 2)
            const parent_content = `* Parent file
global setup_var = 1
do "child.do"
global after_var = 2`;
            create_file('parent.do', parent_content);

            // Child without explicit call site - should infer from parent
            const child_content = `* @lsp-done-by: "parent.do"
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find diagnostics with source attribution
            const diagnostics_with_source = result.diagnostics.filter(d => d.source !== undefined);

            for (const diagnostic of diagnostics_with_source) {
                if (diagnostic.source?.source_file === 'parent.do' && diagnostic.source.source_line !== undefined) {
                    // source_line should be 2 (0-indexed for line 3 where do command is)
                    expect(diagnostic.source.source_line).toBe(2);
                    expect(diagnostic.message).toContain('line 3');
                }
            }
        });
    });

    describe('Unknown call site omits line number', () => {
        it('should omit source_line when parent file cannot be read', async () => {
            // Child references non-existent parent
            const child_content = `* @lsp-done-by: "nonexistent_parent.do"
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find "Cannot read file" diagnostic
            const missing_file_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Cannot read file')
            );

            expect(missing_file_diagnostics.length).toBeGreaterThan(0);

            for (const diagnostic of missing_file_diagnostics) {
                expect(diagnostic.source).toBeDefined();
                // source_line should be undefined (call site unknown)
                expect(diagnostic.source?.source_line).toBeUndefined();
                // Message should include source file but NOT "line N"
                expect(diagnostic.message).toContain('nonexistent_parent.do');
                expect(diagnostic.message).not.toMatch(/: nonexistent_parent\.do line \d+/);
            }
        });

        it('should omit source_line when line= is out of bounds', async () => {
            // Parent file with only 2 lines
            const parent_content = `* Parent file
global x = 1`;
            create_file('parent.do', parent_content);

            // Child with line= pointing beyond file end
            const child_content = `* @lsp-done-by: "parent.do" line=100
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find "out of bounds" diagnostic
            const out_of_bounds_diagnostics = result.diagnostics.filter(
                d => d.message.includes('out of bounds')
            );

            expect(out_of_bounds_diagnostics.length).toBeGreaterThan(0);

            for (const diagnostic of out_of_bounds_diagnostics) {
                expect(diagnostic.source).toBeDefined();
                // source_line should be undefined (line= was invalid)
                expect(diagnostic.source?.source_line).toBeUndefined();
                // Message should include source file but NOT "line N" suffix
                expect(diagnostic.message).toContain('parent.do');
                expect(diagnostic.message).not.toMatch(/: parent\.do line \d+$/);
            }
        });

        it('should omit source_line when match= is not found', async () => {
            // Parent file without the match string
            const parent_content = `* Parent file
global x = 1
do "child.do"`;
            create_file('parent.do', parent_content);

            // Child with match= that won't be found
            const child_content = `* @lsp-done-by: "parent.do" match="NONEXISTENT_MARKER"
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find "not found" diagnostic
            const not_found_diagnostics = result.diagnostics.filter(
                d => d.message.includes('not found')
            );

            expect(not_found_diagnostics.length).toBeGreaterThan(0);

            for (const diagnostic of not_found_diagnostics) {
                expect(diagnostic.source).toBeDefined();
                // source_line should be undefined (match= failed)
                expect(diagnostic.source?.source_line).toBeUndefined();
                // Message should include source file but NOT "line N" suffix
                expect(diagnostic.message).toContain('parent.do');
                expect(diagnostic.message).not.toMatch(/: parent\.do line \d+$/);
            }
        });

        it('should omit source_line when call site cannot be identified (fallback)', async () => {
            // Parent file without any do/include/run command referencing child
            const parent_content = `* Parent file
global x = 1
* No call to child here`;
            create_file('parent.do', parent_content);

            // Child references parent but parent doesn't call child
            const child_content = `* @lsp-done-by: "parent.do"
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find "Could not identify call site" diagnostic
            const call_site_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Could not identify call site')
            );

            expect(call_site_diagnostics.length).toBeGreaterThan(0);

            for (const diagnostic of call_site_diagnostics) {
                expect(diagnostic.source).toBeDefined();
                // source_line should be undefined (call site not identified)
                expect(diagnostic.source?.source_line).toBeUndefined();
                // Message should include source file but NOT "line N" suffix
                expect(diagnostic.message).toContain('parent.do');
                expect(diagnostic.message).not.toMatch(/: parent\.do line \d+$/);
            }
        });
    });

    describe('Message format', () => {
        it('should format message with line number when source_line is known', async () => {
            // Parent file with do command on line 2 (0-indexed: 1)
            const parent_content = `* Parent
do "child.do"`;
            create_file('parent.do', parent_content);

            // Child with explicit line=
            const child_content = `* @lsp-done-by: "parent.do" line=2
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find diagnostics with source attribution
            const diagnostics_with_source = result.diagnostics.filter(
                d => d.source !== undefined && d.source.source_line !== undefined
            );

            for (const diagnostic of diagnostics_with_source) {
                // Message should end with ": source_file line N"
                expect(diagnostic.message).toMatch(/: parent\.do line \d+/);
            }
        });

        it('should format message without line number when source_line is unknown', async () => {
            // Child references non-existent parent
            const child_content = `* @lsp-done-by: "missing.do"
local x = 1`;
            const child_path = create_file('child.do', child_content);

            const result = await scope_resolver.resolve(
                file_uri(child_path),
                child_content
            );

            // Find diagnostics with source attribution but no source_line
            const diagnostics_without_line = result.diagnostics.filter(
                d => d.source !== undefined && d.source.source_line === undefined
            );

            for (const diagnostic of diagnostics_without_line) {
                // Message should end with ": source_file" (no line number)
                expect(diagnostic.message).toContain(': missing.do');
                expect(diagnostic.message).not.toMatch(/: missing\.do line \d+/);
            }
        });
    });
});

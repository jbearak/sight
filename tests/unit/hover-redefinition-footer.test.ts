/**
 * Unit tests for hover redefinition footer (issue #135).
 *
 * When a symbol has additional_definitions — either same-file redeclarations,
 * cross-file redeclarations, or both — the hover card appends a compact
 * footer summarizing where the other declarations live.
 */

import { describe, it, expect } from 'bun:test';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { DocumentStore } from '../../src/document-store';
import type { MarkupContent } from 'vscode-languageserver';

async function hover_at(
    source: string,
    line: number,
    character: number,
): Promise<MarkupContent | null> {
    const document_store = new DocumentStore();
    const uri = 'file:///test.do';
    await document_store.open(uri, source, 1);
    const document_state = document_store.get(uri)!;
    const hover_provider = new HoverProvider(new CommandDatabase());
    const result = await hover_provider.get_hover(
        document_state,
        { line, character },
    );
    return result?.contents as MarkupContent | null;
}

describe('Hover redefinition footer - same-file only', () => {
    it('shows redefined-at footer for redeclared local macro', async () => {
        const source = [
            'local fruit apple',      // line 0 (primary)
            'di "`fruit\'"',          // line 1
            'local fruit banana',     // line 2
            'di "`fruit\'"',          // line 3
            'local fruit cherry',     // line 4
        ].join('\n');
        // Cursor on `fruit' at line 1.
        const content = await hover_at(source, 1, 6);
        expect(content).not.toBeNull();
        const text = content!.value;
        // Primary definition info.
        expect(text).toContain('Local Macro');
        // Footer: 1-indexed lines for redefinitions.
        expect(text).toContain('Redefined at lines 3, 5');
        // No file-count text for same-file-only case.
        expect(text).not.toContain('other files');
    });

    it('shows redefined-at footer for redeclared global macro', async () => {
        const source = [
            'global fruit = "apple"',   // line 0 (primary)
            'di "$fruit"',              // line 1
            'global fruit = "banana"',  // line 2
        ].join('\n');
        // Cursor on $fruit at line 1.
        const content = await hover_at(source, 1, 6);
        expect(content).not.toBeNull();
        const text = content!.value;
        expect(text).toContain('Global Macro');
        expect(text).toContain('Redefined at lines 3');
        expect(text).not.toContain('other files');
    });

    it('shows redefined-at footer for redeclared program', async () => {
        // `program define` syntax is required for the parser to recognize
        // program blocks (bare `program` without `define` is not treated as
        // a definition node by the current parser).
        const source = [
            'program define MyProg',        // line 0 (primary)
            '    display "v1"',             // line 1
            'end',                          // line 2
            'program define MyProg',        // line 3 (redecl)
            '    display "v2"',             // line 4
            'end',                          // line 5
            'MyProg',                       // line 6 (call site)
        ].join('\n');
        // Cursor on MyProg call at line 6, char 2.
        const content = await hover_at(source, 6, 2);
        expect(content).not.toBeNull();
        const text = content!.value;
        expect(text).toContain('Program');
        // Primary is line 1 (1-indexed); redeclaration is line 4 (1-indexed).
        expect(text).toContain('Redefined at lines 4');
        expect(text).not.toContain('other files');
    });

    it('shows redefined-at footer for redeclared scalar', async () => {
        const source = [
            'scalar s = 1',   // line 0
            'scalar s = 2',   // line 1
            'di s',            // line 2
        ].join('\n');
        // Cursor on s at line 2.
        const content = await hover_at(source, 2, 3);
        expect(content).not.toBeNull();
        const text = content!.value;
        expect(text).toContain('Scalar');
        expect(text).toContain('Redefined at lines 2');
        expect(text).not.toContain('other files');
    });

    it('shows redefined-at footer for redeclared matrix', async () => {
        const source = [
            'matrix m = (1, 2)',   // line 0
            'matrix m = (3, 4)',   // line 1
            'matrix list m',        // line 2
        ].join('\n');
        // Cursor on m at line 2.
        const content = await hover_at(source, 2, 12);
        expect(content).not.toBeNull();
        const text = content!.value;
        expect(text).toContain('Matrix');
        expect(text).toContain('Redefined at lines 2');
        expect(text).not.toContain('other files');
    });

    it('omits footer when symbol has a single definition', async () => {
        const source = [
            'local fruit apple',
            'di "`fruit\'"',
        ].join('\n');
        const content = await hover_at(source, 1, 6);
        expect(content).not.toBeNull();
        const text = content!.value;
        expect(text).toContain('Local Macro');
        expect(text).not.toContain('Redefined');
    });
});

import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';

describe('Hover redefinition footer - cross-file variants', () => {
    it('shows "N other files" footer when all redefinitions are cross-file', async () => {
        const test_temp_dir = mkdtempSync(join(tmpdir(), 'hover-cross-'));
        try {
            // Three files: a central lib.do, and two callers that each
            // redeclare `global data`.
            const lib_path = join(test_temp_dir, 'lib.do');
            const lib_content = 'global data = "lib"\n';
            writeFileSync(lib_path, lib_content);
            const a_path = join(test_temp_dir, 'a.do');
            writeFileSync(a_path, 'include "lib.do"\nglobal data = "a"\ndi "$data"\n');
            const b_path = join(test_temp_dir, 'b.do');
            writeFileSync(b_path, 'include "lib.do"\nglobal data = "b"\n');

            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(new DependencyGraph());
            await indexer.initialize([test_temp_dir]);

            const document_store = new DocumentStore();
            const lib_uri = URI.file(lib_path).toString();
            await document_store.open(lib_uri, lib_content, 1);
            const document_state = document_store.get(lib_uri)!;

            const provider = new HoverProvider(new CommandDatabase());
            const result = await provider.get_hover(
                document_state,
                { line: 0, character: 9 },  // on `data`
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                indexer,
            );
            const content = result?.contents as MarkupContent | null;
            expect(content).not.toBeNull();
            const text = content!.value;
            expect(text).toMatch(/Redefined in \d+ other files?/);
        } finally {
            if (existsSync(test_temp_dir)) rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('shows mixed footer when redefinitions are in same file and other files', async () => {
        const test_temp_dir = mkdtempSync(join(tmpdir(), 'hover-mixed-'));
        try {
            const lib_path = join(test_temp_dir, 'lib.do');
            const lib_content = [
                'global data = "lib1"',   // line 0 (primary)
                'global data = "lib2"',   // line 1 (same-file redecl)
            ].join('\n') + '\n';
            writeFileSync(lib_path, lib_content);
            const a_path = join(test_temp_dir, 'a.do');
            writeFileSync(a_path, 'include "lib.do"\nglobal data = "a"\n');

            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(new DependencyGraph());
            await indexer.initialize([test_temp_dir]);

            const document_store = new DocumentStore();
            const lib_uri = URI.file(lib_path).toString();
            await document_store.open(lib_uri, lib_content, 1);
            const document_state = document_store.get(lib_uri)!;

            const provider = new HoverProvider(new CommandDatabase());
            const result = await provider.get_hover(
                document_state,
                { line: 0, character: 9 },  // on `data`
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                indexer,
            );
            const content = result?.contents as MarkupContent | null;
            expect(content).not.toBeNull();
            const text = content!.value;
            expect(text).toMatch(/Redefined at lines 2 and in \d+ other files?/);
        } finally {
            if (existsSync(test_temp_dir)) rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });
});

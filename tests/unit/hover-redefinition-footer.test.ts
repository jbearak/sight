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

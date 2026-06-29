import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';

import { ScopeResolver } from '../../src/scope-resolver';

// Issue #240: the scope-resolver's call-site validation must apply the same
// validation/comment-awareness as the directive parser, so a call site is never
// resolved to a line the parser would reject or treat as inert.
describe('Issue #240: call-site validation honors malformed / block-commented lines', () => {
    let temp_dir: string;
    let resolver: ScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-issue240-'));
        resolver = new ScopeResolver();
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function create_file(filename: string, content: string): string {
        const file_path = path.join(temp_dir, filename);
        fs.mkdirSync(path.dirname(file_path), { recursive: true });
        fs.writeFileSync(file_path, content, 'utf8');
        return file_path;
    }

    it('(a) a malformed forward directive at an explicit line= does not flip included-by to do', async () => {
        // parent.do:
        //   line 1: local p_local 1        (defined before the call site)
        //   line 2: // sight: do line=5    (malformed forward directive: no path)
        const parent_content = ['local p_local 1', '// sight: do line=5'].join('\n');
        create_file('parent.do', parent_content);

        // child requests included-by with the call site at parent line 2.
        const child_content = [
            '// @lsp-included-by: "parent.do" line=2',
            "display `p_local'",
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        const result = await resolver.resolve(
            URI.file(child_path).toString(),
            child_content
        );

        // Include semantics preserved: the parent local is inherited. Under the
        // pre-fix behavior, line 2 was mis-read as a `do` call, flipping to
        // done-by and dropping all parent locals.
        expect(result.symbols.localMacros.has('p_local')).toBe(true);

        // The malformed line is reported as not containing a call statement.
        const warning = result.diagnostics.find(
            (d) =>
                d.severity === 'warning' &&
                d.message.includes('does not contain a do/run/include command')
        );
        expect(warning).toBeDefined();
    });

    it('(a2) an explicit line= pointing inside a block comment does not flip included-by to do', async () => {
        // parent.do (1-indexed lines):
        //   1: local p_local 1
        //   2: /*                 (block comment opener)
        //   3: do "child.do"      (inside the block comment -> inert)
        //   4: */
        const parent_content = [
            'local p_local 1',
            '/*',
            'do "child.do"',
            '*/',
        ].join('\n');
        create_file('parent.do', parent_content);

        // child points the call site at line 3, which is block-commented.
        const child_content = [
            '// @lsp-included-by: "parent.do" line=3',
            "display `p_local'",
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        const result = await resolver.resolve(
            URI.file(child_path).toString(),
            child_content
        );

        // The block-commented line is inert: validation returns undefined, so
        // include semantics are preserved and the parent local is inherited.
        // Pre-fix, line 3 was read as a `do` call and flipped to done-by.
        expect(result.symbols.localMacros.has('p_local')).toBe(true);
        const warning = result.diagnostics.find(
            (d) =>
                d.severity === 'warning' &&
                d.message.includes('does not contain a do/run/include command')
        );
        expect(warning).toBeDefined();
    });

    it('(b) match= skips a block-commented call and resolves to the real one', async () => {
        // parent.do: the first textual occurrence of the do command is inside a
        // /* ... */ block comment and must be skipped; the real call is later.
        const parent_content = [
            '/*',
            'do "child.do"', // line 1: inert (block comment)
            '*/',
            'global mid 1', // line 3: between bogus and real call
            'do "child.do"', // line 4: the real call
            'global after 1', // line 5: after the real call site
        ].join('\n');
        create_file('parent.do', parent_content);

        const child_content = [
            '// @lsp-done-by: "parent.do" match="do \\"child.do\\""',
            "display `=1'",
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        const result = await resolver.resolve(
            URI.file(child_path).toString(),
            child_content
        );

        // The match resolved to a real call site (the block-commented one on
        // line 1 was skipped), so there is no "match not found" fallback.
        const not_found = result.diagnostics.find((d) =>
            d.message.includes('not found in parent file')
        );
        expect(not_found).toBeUndefined();

        // The real call site is line 4 (0-indexed): $mid (line 3) is on/before
        // it and in scope; $after (line 5) is after it and out of scope. Had the
        // match fallen back to the end-of-file assumption, $after would wrongly
        // be in scope too — so this pins the call site to line 4, not the end.
        expect(result.symbols.globalMacros.has('mid')).toBe(true);
        expect(result.symbols.globalMacros.has('after')).toBe(false);
        const mid_out_of_scope = result.out_of_scope_symbols.find(
            (s) => s.name === 'mid'
        );
        expect(mid_out_of_scope).toBeUndefined();
    });

    it('(b2) match= skips an occurrence inside a trailing inline block comment', async () => {
        // The match text appears inside an inline /* ... */ on an otherwise-active
        // line (line 1); the real call is on line 3. Span-aware find_match_line
        // must pick line 3, not the inline-commented occurrence on line 1.
        const parent_content = [
            'display 1 /* do "child.do" */', // line 0: match text is inert (inline)
            'global mid 1', // line 1
            'do "child.do"', // line 2: the real call
            'global after 1', // line 3: after the real call
        ].join('\n');
        create_file('parent.do', parent_content);

        const child_content = [
            '// @lsp-done-by: "parent.do" match="do \\"child.do\\""',
            "display `=1'",
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        const result = await resolver.resolve(
            URI.file(child_path).toString(),
            child_content
        );

        const not_found = result.diagnostics.find((d) =>
            d.message.includes('not found in parent file')
        );
        expect(not_found).toBeUndefined();

        // Call site pinned to line 2: $mid (line 1) in scope, $after (line 3) out.
        expect(result.symbols.globalMacros.has('mid')).toBe(true);
        expect(result.symbols.globalMacros.has('after')).toBe(false);
    });
});

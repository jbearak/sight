/**
 * Regression suite for issue #209 (ported Raven jbearak/raven#471, #477).
 *
 * Raven had a dense cross-file graph bug: an earlier-sourced sibling's symbol
 * disappeared from a later sibling because the backward-walk `visited` set and
 * parent forward-call resolution shared ONE visited map. Sight does NOT share
 * them — `ScopeResolver.resolve_parent_forward_calls` seeds the forward resolver
 * with a *copy* `recursion_stack = new Set(visited)` and a *fresh*
 * `visited: new Map()`, and the parent is deleted from `visited` before its
 * forward calls resolve. So every URI in `recursion_stack` is the current file
 * or a file already on the active backward chain — never an independent earlier
 * sibling — and the suppression cannot occur.
 *
 * These tests LOCK that invariant: an earlier sibling's symbol must stay visible
 * in a later sibling across hub-heavy / diamond / dedup topologies. They have
 * teeth — dropping the earliest forward static call turns every case red.
 *
 * See docs/cross-file.md ("Forward-closure caching semantics") and the issue.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'node:url';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('issue #209 — hub-heavy sibling visibility (regression)', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-heavy-209-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file_path, content);
        return file_path;
    };
    const to_uri = (file_path: string): string =>
        pathToFileURL(file_path).toString();

    // T1: baseline dense sibling. P does A (global S) then does B. B done-by P.
    it('T1 baseline: earlier sibling global visible in later sibling', async () => {
        const a_path = create_file('A.do', `global S_from_a 1\n`);
        const p_path = create_file('P.do', `run "${a_path}"\ndo "B.do"\n`);
        const b_content = `// @lsp-done-by: "${p_path}" match="B.do"\n` +
            `display "\${S_from_a}"\n`;
        create_file('B.do', b_content);
        const result = await scope_resolver.resolve(
            to_uri(path.join(temp_dir, 'B.do')), b_content);
        expect(result.symbols.globalMacros.has('S_from_a')).toBe(true);
    });

    // T2: hub grandparent on the backward chain. B done-by A; A done-by P.
    // P runs C (global U) then does A. C is an earlier sibling of A inside P.
    // Exercises recursion_stack = {B, A} when P's forward calls resolve.
    it('T2 hub: grandparent earlier sibling visible through done-by chain', async () => {
        const c_path = create_file('C.do', `global U_from_c 1\n`);
        const a_path = create_file('A.do', '');
        const p_path = create_file('P.do', `run "${c_path}"\ndo "${a_path}"\n`);
        fs.writeFileSync(a_path,
            `// @lsp-done-by: "${p_path}" match="A.do"\n` + `do "B.do"\n`);
        const b_content = `// @lsp-done-by: "${a_path}" match="B.do"\n` +
            `display "\${U_from_c}"\n`;
        create_file('B.do', b_content);
        const result = await scope_resolver.resolve(
            to_uri(path.join(temp_dir, 'B.do')), b_content);
        expect(result.symbols.globalMacros.has('U_from_c')).toBe(true);
    });

    // T3: diamond — sibling is also a backward ancestor; local carried by the
    // parent include. P includes A (line0) then includes B (line1). A defines a
    // local; included-by keeps locals; A runs before B under P.
    it('T3 diamond: sibling-also-ancestor local carried by parent include', async () => {
        const a_path = create_file('A.do', '');
        const p_path = create_file('P.do',
            `include "${a_path}"\ninclude "B.do"\n`);
        fs.writeFileSync(a_path,
            `// @lsp-included-by: "${p_path}" match="A.do"\n` +
            `local la_macro = 1\n`);
        const b_content = `// @lsp-included-by: "${p_path}" match="B.do"\n` +
            `display "\`la_macro'"\n`;
        create_file('B.do', b_content);
        const result = await scope_resolver.resolve(
            to_uri(path.join(temp_dir, 'B.do')), b_content);
        expect(result.symbols.localMacros.has('la_macro')).toBe(true);
    });

    // T4: shared hub via an earlier sibling. P does A then does B. A does HUB
    // (global T). B references T transitively through the earlier sibling A.
    it('T4 shared hub: transitive global through earlier sibling visible', async () => {
        const hub_path = create_file('HUB.do', `global T_from_hub 1\n`);
        const a_path = create_file('A.do',
            `run "${hub_path}"\nglobal S_from_a 1\n`);
        const p_path = create_file('P.do', `run "${a_path}"\ndo "B.do"\n`);
        const b_content = `// @lsp-done-by: "${p_path}" match="B.do"\n` +
            `display "\${S_from_a} \${T_from_hub}"\n`;
        create_file('B.do', b_content);
        const result = await scope_resolver.resolve(
            to_uri(path.join(temp_dir, 'B.do')), b_content);
        expect(result.symbols.globalMacros.has('S_from_a')).toBe(true);
        expect(result.symbols.globalMacros.has('T_from_hub')).toBe(true);
    });

    // T5: two earlier siblings share the same hub (forward dedup). P does A
    // (does HUB), does D (does HUB again), does B. B references the hub global.
    it('T5 dedup: hub sourced by multiple earlier siblings stays visible', async () => {
        const hub_path = create_file('HUB.do', `global T_from_hub 1\n`);
        const a_path = create_file('A.do', `run "${hub_path}"\n`);
        const d_path = create_file('D.do', `run "${hub_path}"\n`);
        const p_path = create_file('P.do',
            `run "${a_path}"\nrun "${d_path}"\ndo "B.do"\n`);
        const b_content = `// @lsp-done-by: "${p_path}" match="B.do"\n` +
            `display "\${T_from_hub}"\n`;
        create_file('B.do', b_content);
        const result = await scope_resolver.resolve(
            to_uri(path.join(temp_dir, 'B.do')), b_content);
        expect(result.symbols.globalMacros.has('T_from_hub')).toBe(true);
    });

    // T6: double-hub fan-out (codex counterexample shape). P does A then does D;
    // both do HUB. Dedup of HUB across two earlier siblings must not suppress
    // the later sibling's view of the hub global.
    it('T6 double-hub: dedup across two earlier siblings keeps hub visible', async () => {
        const hub_path = create_file('HUB.do', `global H_from_hub 1\n`);
        const a_path = create_file('A.do', `do "${hub_path}"\n`);
        const d_path = create_file('D.do', `do "${hub_path}"\n`);
        const p_path = create_file('P.do',
            `do "${a_path}"\ndo "${d_path}"\ndo "B.do"\n`);
        const b_content = `// @lsp-done-by: "${p_path}" match="B.do"\n` +
            `display "\${H_from_hub}"\n`;
        create_file('B.do', b_content);
        const result = await scope_resolver.resolve(
            to_uri(path.join(temp_dir, 'B.do')), b_content);
        expect(result.symbols.globalMacros.has('H_from_hub')).toBe(true);
    });

    // T7: working-directory inheritance feeds forward path resolution. Parent
    // sets @lsp-cd subdir and runs a helper there before the child; the child
    // (in subdir) sees the helper's global only because the parent's inherited
    // WD resolved the sibling's relative path. Guards the #208 decision that the
    // forward closure depends on the WD input.
    it('T7 wd-inheritance: sibling resolved via inherited working directory', async () => {
        create_file('subdir/helper.do', `global wd_helper_global 1\n`);
        const loop_path = create_file('subdir/loop.do',
            `// @lsp-cd ../subdir\n` +
            `run "helper.do"\ndo "survey.do"\n`);
        const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"\n` +
            `display "\${wd_helper_global}"\n`;
        create_file('subdir/survey.do', survey_content);
        const result = await scope_resolver.resolve(
            to_uri(path.join(temp_dir, 'subdir/survey.do')), survey_content);
        expect(result.symbols.globalMacros.has('wd_helper_global')).toBe(true);
    });
});

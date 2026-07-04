/**
 * Issue #209 / #208 — forward-closure memo correctness gate.
 *
 * Two guarantees:
 *  (1) CALLER-INDEPENDENCE (the assumption #208 relies on): a file's forward-call
 *      closure is identical regardless of which caller triggered it, given the
 *      same keyed inputs (effective call type, working directory, depth, content).
 *      This is the contract the memo cache exploits (#234).
 *  (2) MEMO ON/OFF EQUIVALENCE: flipping the (default-ON) memo toggle must not
 *      change any caller-observable output. With the store/serve write-path
 *      live (#234), this is the regression gate it must keep green.
 *
 * See docs/cross-file.md "Forward-closure caching semantics".
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'node:url';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import type {
    ResolvedScope, SymbolTable, ForwardResolvedScope,
} from '../../src/types';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('issue #209/#208 — forward-closure memo gate', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-gate-209-'));
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

    // Build a fresh resolver pair so two caller-independence runs cannot share
    // cache state (with the memo store/serve live, a shared instance could
    // serve caller 2 from caller 1's cached closure and mask a
    // caller-DEPENDENT closure).
    const make_resolver = (): {
        scope: ScopeResolver; forward: ForwardScopeResolver;
    } => {
        const scope = new ScopeResolver(create_test_scope_resolver_logger());
        const forward = new ForwardScopeResolver(scope);
        scope.set_forward_scope_resolver(forward);
        return { scope, forward };
    };

    // Full caller-observable surface of a FORWARD resolution (symbols, call
    // sites incl. effective_type + excluded_locals, and diagnostics) — so the
    // caller-independence gate regresses if a future memo varies any of them by
    // caller, not just symbol names + callee URIs.
    const forward_surface = (r: ForwardResolvedScope) => ({
        symbols: symbol_names(r.symbols),
        call_sites: r.call_sites.map(s => ({
            uri: s.callee_uri,
            line: s.call_line,
            type: s.effective_type,
            excluded: [...(s.excluded_locals?.keys() ?? [])].sort(),
        })),
        diagnostics: r.diagnostics.map(d => ({
            message: d.message, severity: d.severity, code: d.code,
        })),
    });

    const symbol_names = (t: SymbolTable) => ({
        programs: [...t.programs.keys()].sort(),
        localMacros: [...t.localMacros.keys()].sort(),
        globalMacros: [...t.globalMacros.keys()].sort(),
        variables: [...t.variables.keys()].sort(),
        scalars: [...t.scalars.keys()].sort(),
        matrices: [...t.matrices.keys()].sort(),
    });

    // The full caller-observable surface a forward-closure memo could corrupt
    // (codex R4): symbols, call sites (incl. excluded_locals), out-of-scope
    // records, diagnostics, inherited WD, and the chain forward-call sites.
    const surface = (r: ResolvedScope) => ({
        symbols: symbol_names(r.symbols),
        diagnostics: r.diagnostics.map(d => ({
            message: d.message, severity: d.severity, code: d.code,
        })),
        out_of_scope: (r.out_of_scope_symbols ?? [])
            .map(o => o.name).sort(),
        inherited_wd: r.inherited_working_directory ?? null,
        chain: r.chain.map(c => ({
            uri: c.uri,
            forward: (c.forward_call_sites ?? []).map(s => ({
                uri: s.callee_uri, line: s.call_line, type: s.effective_type,
                excluded: [...(s.excluded_locals?.keys() ?? [])].sort(),
            })),
            all_forward: (c.all_forward_call_sites ?? []).map(s => ({
                uri: s.callee_uri, line: s.call_line, type: s.effective_type,
            })),
        })),
    });

    it('(1) caller-independence: same callee closure across two disjoint callers', async () => {
        // hub.do runs helper.do; the hub's forward closure must be identical
        // whether reached from caller C1 or C2 (disjoint recursion stacks).
        const helper = create_file('helper.do', `global helper_g 1\n`);
        const hub = create_file('hub.do', `run "${helper}"\nglobal hub_g 1\n`);
        const hub_uri = to_uri(hub);

        // Each caller gets its OWN resolver instance (separate cache), so
        // the gate stays honest with the memo store/serve live.
        const resolve_from = async (caller_uri: string) => {
            const { scope, forward } = make_resolver();
            const parsed = await scope.get_parsed_file(hub_uri, hub);
            if ('error' in parsed) throw new Error(parsed.error);
            return forward.resolve(
                hub_uri,
                parsed.forward_calls,
                'do',
                {
                    visited: new Map(),
                    effective_call_type: 'do',
                    depth: 0,
                    diagnostics: [],
                    working_directory: undefined,
                    call_chain: [],
                },
                new Set([caller_uri]),
            );
        };

        const r1 = await resolve_from('file:///callers/c1.do');
        const r2 = await resolve_from('file:///callers/c2.do');

        // Compare the FULL forward surface, not just symbols + callee URIs.
        expect(forward_surface(r1)).toEqual(forward_surface(r2));
        expect(r1.symbols.globalMacros.has('helper_g')).toBe(true);
    });

    it('(2) memo on/off equivalence across a hub-heavy battery', async () => {
        // A small dense graph: parent runs two siblings before the child; each
        // sibling shares a hub; the child inherits via @lsp-done-by.
        const hub = create_file('hub.do', `global hub_g 1\n`);
        const a = create_file('a.do', `run "${hub}"\nglobal a_g 1\n`);
        const d = create_file('d.do', `run "${hub}"\nglobal d_g 1\n`);
        const parent = create_file('parent.do',
            `run "${a}"\nrun "${d}"\ndo "child.do"\n`);
        const child_content =
            `// @lsp-done-by: "${parent}" match="child.do"\n` +
            `display "\${a_g} \${d_g} \${hub_g}"\n`;
        create_file('child.do', child_content);
        const child_uri = to_uri(path.join(temp_dir, 'child.do'));

        forward_resolver.set_forward_closure_memo_enabled(false);
        const off = await scope_resolver.resolve(child_uri, child_content);
        const off_surface = surface(off);

        // Fresh resolver state so the comparison isn't a cache-warm artifact.
        scope_resolver.clear_cache();
        forward_resolver.set_forward_closure_memo_enabled(true);
        const on = await scope_resolver.resolve(child_uri, child_content);

        expect(surface(on)).toEqual(off_surface);
        // sanity: the battery actually exercises forward inheritance
        expect(on.symbols.globalMacros.has('hub_g')).toBe(true);
    });

    it('(3) a standalone callee stays caller-independent (issue #208)', async () => {
        // The standalone marker changes only already-keyed closure inputs
        // (inherited WD, effective call type) — never caller identity. A
        // hub marked `sight: standalone` (with a backward parent that
        // would otherwise supply scope) must produce byte-identical
        // forward closures across two disjoint callers.
        const grand = create_file('grand.do',
            `global grand_g 1\ndo "hub.do"\n`);
        const helper = create_file('helper.do', `global helper_g 1\n`);
        const hub = create_file('hub.do',
            `// sight: standalone\n` +
            `// sight: done-by: "${grand}"\n` +
            `run "${helper}"\nglobal hub_g 1\n`);
        const hub_uri = to_uri(hub);

        const resolve_from = async (caller_uri: string) => {
            const { scope, forward } = make_resolver();
            const parsed = await scope.get_parsed_file(hub_uri, hub);
            if ('error' in parsed) throw new Error(parsed.error);
            return forward.resolve(
                hub_uri,
                parsed.forward_calls,
                'do',
                {
                    visited: new Map(),
                    effective_call_type: 'do',
                    depth: 0,
                    diagnostics: [],
                    working_directory: undefined,
                    call_chain: [],
                },
                new Set([caller_uri]),
            );
        };

        const r1 = await resolve_from('file:///callers/c1.do');
        const r2 = await resolve_from('file:///callers/c2.do');

        expect(forward_surface(r1)).toEqual(forward_surface(r2));
        expect(r1.symbols.globalMacros.has('helper_g')).toBe(true);
    });
});

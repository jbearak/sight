/**
 * Oracle-backed property tests for the forward-call OUT_OF_SCOPE_SYMBOL
 * rewrite path.
 *
 * The {@link StataExecutionOracle} is the ground truth: it executes a
 * generated graph under Stata's real do/run semantics (fresh scope) and
 * its counter-factual "all-include" semantics (locals propagate). Three
 * properties compare that ground truth against what
 * `DiagnosticsProvider` emits on the same graph:
 *
 *   1. Visibility soundness — if the oracle says the reference is
 *      actually visible, no warning must fire.
 *   2. Rewrite attribution — if the reference is blocked by some
 *      do/run boundary but would have been bound under include, the LSP
 *      must emit exactly one OUT_OF_SCOPE_SYMBOL naming the file whose
 *      local is the effective (last-def-wins) definition.
 *   3. Generic-warning completeness — if no ancestor defines the name at
 *      all, fall back to UNDEFINED_MACRO (no rewrite).
 *
 * A `regression: pinned scenarios from code review` block below locks
 * the specific bugs this feature's history has hit, so the next Codex
 * review of a fix sees them still intact.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { Connection } from 'vscode-languageserver';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import {
    arbitrary_forward_call_graph,
    render_file,
    ForwardCallGraph,
    FileSpec,
} from './generators/forward-call-graphs';
import { StataExecutionOracle } from './helpers/stata-execution-oracle';

const MIN_CONFIG: StataLSPConfig = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning',
            undefinedVariable: 'information',
            styleWarnings: 'hint',
        },
    },
    adoPaths: [],
    cross_file: {
        assume_call_site: 'end',
        max_forward_depth: 10,
    },
} as unknown as StataLSPConfig;

interface Harness {
    document_store: DocumentStore;
    scope_resolver: ScopeResolver;
    forward_scope_resolver: ForwardScopeResolver;
    diagnostics_provider: DiagnosticsProvider;
    temp_dir: string;
}

function create_harness(): Harness {
    const mock_connection: Connection = { sendDiagnostics: () => {} } as unknown as Connection;
    const document_store = new DocumentStore();
    const scope_resolver = new ScopeResolver();
    const forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
        max_forward_depth: 10,
    });
    scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    const diagnostics_provider = new DiagnosticsProvider(mock_connection);
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-call-oracle-'));
    return { document_store, scope_resolver, forward_scope_resolver, diagnostics_provider, temp_dir };
}

function destroy_harness(h: Harness): void {
    if (fs.existsSync(h.temp_dir)) {
        fs.rmSync(h.temp_dir, { recursive: true, force: true });
    }
}

function write_files(h: Harness, files: FileSpec[]): void {
    for (const my_file of files) {
        fs.writeFileSync(path.join(h.temp_dir, my_file.filename), render_file(my_file));
    }
}

interface DiagnosticOutcome {
    has_undefined_macro: boolean;
    out_of_scope_count: number;
    out_of_scope_messages: string[];
}

async function diagnose_reference(
    h: Harness,
    graph: ForwardCallGraph,
    config: StataLSPConfig = MIN_CONFIG,
): Promise<DiagnosticOutcome> {
    write_files(h, graph.files);
    const root = graph.files[0];
    const root_path = path.join(h.temp_dir, root.filename);
    const root_uri = URI.file(root_path).toString();
    const content = render_file(root);
    await h.document_store.open(root_uri, content, 1);
    const document_state = h.document_store.get(root_uri)!;
    const diagnostics = await h.diagnostics_provider.get_diagnostics(
        document_state,
        config,
        undefined,
        h.scope_resolver,
    );
    const ref_line = graph.reference_event_index;
    const ref_line_diags = diagnostics.filter(d => d.range.start.line === ref_line);
    // Only count diagnostics that concern the referenced name — a shared
    // line may carry unrelated symbol warnings when the generator places
    // other expressions nearby.
    const for_this_name = ref_line_diags.filter(d =>
        d.message.includes(`\`${graph.reference_name}'`) ||
        d.message.includes(`'${graph.reference_name}'`),
    );
    return {
        has_undefined_macro: for_this_name.some(
            d => d.code === StataDiagnosticCode.UNDEFINED_MACRO,
        ),
        out_of_scope_count: for_this_name.filter(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL,
        ).length,
        out_of_scope_messages: for_this_name
            .filter(d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL)
            .map(d => d.message),
    };
}

describe('Forward-call OUT_OF_SCOPE_SYMBOL — oracle properties', () => {
    test('1. Visibility soundness: visible locals emit no warning', async () => {
        await fc.assert(
            fc.asyncProperty(arbitrary_forward_call_graph(), async graph => {
                const oracle = new StataExecutionOracle(graph);
                if (!oracle.is_visible_at()) return;
                const h = create_harness();
                try {
                    const outcome = await diagnose_reference(h, graph);
                    expect(outcome.has_undefined_macro).toBe(false);
                    expect(outcome.out_of_scope_count).toBe(0);
                } finally {
                    destroy_harness(h);
                }
            }),
            { numRuns: 200 },
        );
    });

    test('2. Rewrite attribution: blocked references name the blame file', async () => {
        await fc.assert(
            fc.asyncProperty(arbitrary_forward_call_graph(), async graph => {
                const oracle = new StataExecutionOracle(graph);
                if (oracle.is_visible_at()) return;
                const blame = oracle.blame_target_for();
                if (blame === null) return;
                // When the name is also defined somewhere in root — even
                // *after* the reference — the LSP intentionally preserves
                // the analyzer's UNDEFINED_MACRO (same-file forward
                // reference) rather than rewriting. The rewrite-attribution
                // property doesn't apply in that case; see issue #145.
                if (oracle.is_defined_in_root()) return;
                const h = create_harness();
                try {
                    const outcome = await diagnose_reference(h, graph);
                    // Exactly one OUT_OF_SCOPE rewrite; the plain UNDEFINED is
                    // suppressed in favor of the informative message.
                    expect(outcome.out_of_scope_count).toBe(1);
                    expect(outcome.has_undefined_macro).toBe(false);
                    const expected_file = oracle.get_file_name(blame);
                    expect(outcome.out_of_scope_messages[0]).toContain(expected_file);
                } finally {
                    destroy_harness(h);
                }
            }),
            { numRuns: 200 },
        );
    });

    test('3. Generic-warning completeness: unreachable names emit UNDEFINED only', async () => {
        await fc.assert(
            fc.asyncProperty(arbitrary_forward_call_graph(), async graph => {
                const oracle = new StataExecutionOracle(graph);
                if (oracle.is_visible_at()) return;
                if (oracle.blame_target_for() !== null) return;
                const h = create_harness();
                try {
                    const outcome = await diagnose_reference(h, graph);
                    expect(outcome.has_undefined_macro).toBe(true);
                    expect(outcome.out_of_scope_count).toBe(0);
                } finally {
                    destroy_harness(h);
                }
            }),
            { numRuns: 200 },
        );
    });
});

// Deeper graphs stress the recursive resolve + dedup + filter paths that
// the default 1-4-file generator under-exercises. Chain depth scales with
// the DAG size (file i can only call j > i), so pinning the minimum file
// count above 3 forces chains of length 3-6.
describe('Forward-call OUT_OF_SCOPE_SYMBOL — oracle properties (deep graphs, depth 3-6)', () => {
    const deep_graph = () =>
        arbitrary_forward_call_graph({
            min_files: 4,
            max_files: 7,
            max_events_per_file: 5,
        });

    test('1. Visibility soundness (deep): visible locals emit no warning', async () => {
        await fc.assert(
            fc.asyncProperty(deep_graph(), async graph => {
                const oracle = new StataExecutionOracle(graph);
                if (!oracle.is_visible_at()) return;
                const h = create_harness();
                try {
                    const outcome = await diagnose_reference(h, graph);
                    expect(outcome.has_undefined_macro).toBe(false);
                    expect(outcome.out_of_scope_count).toBe(0);
                } finally {
                    destroy_harness(h);
                }
            }),
            { numRuns: 200 },
        );
    });

    test('2. Rewrite attribution (deep): blocked references name the blame file', async () => {
        await fc.assert(
            fc.asyncProperty(deep_graph(), async graph => {
                const oracle = new StataExecutionOracle(graph);
                if (oracle.is_visible_at()) return;
                const blame = oracle.blame_target_for();
                if (blame === null) return;
                if (oracle.is_defined_in_root()) return;
                const h = create_harness();
                try {
                    const outcome = await diagnose_reference(h, graph);
                    expect(outcome.out_of_scope_count).toBe(1);
                    expect(outcome.has_undefined_macro).toBe(false);
                    const expected_file = oracle.get_file_name(blame);
                    expect(outcome.out_of_scope_messages[0]).toContain(expected_file);
                } finally {
                    destroy_harness(h);
                }
            }),
            { numRuns: 200 },
        );
    });

    test('3. Generic-warning completeness (deep): unreachable names emit UNDEFINED only', async () => {
        await fc.assert(
            fc.asyncProperty(deep_graph(), async graph => {
                const oracle = new StataExecutionOracle(graph);
                if (oracle.is_visible_at()) return;
                if (oracle.blame_target_for() !== null) return;
                const h = create_harness();
                try {
                    const outcome = await diagnose_reference(h, graph);
                    expect(outcome.has_undefined_macro).toBe(true);
                    expect(outcome.out_of_scope_count).toBe(0);
                } finally {
                    destroy_harness(h);
                }
            }),
            { numRuns: 200 },
        );
    });
});

describe('Forward-call OUT_OF_SCOPE_SYMBOL — regression: pinned scenarios from code review', () => {
    let h: Harness;

    beforeEach(() => {
        h = create_harness();
    });

    afterEach(() => {
        destroy_harness(h);
    });

    // Bug A (this branch): redefinitions hidden in `additional_definitions`.
    // child.do has `local veggie` before an include and then again after it;
    // the late redefinition must be the blame target.
    test('Bug A: redefinition after include wins (blames child)', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'defs.do'), 'local veggie beet');
        fs.writeFileSync(
            path.join(h.temp_dir, 'child.do'),
            ['local veggie carrot', 'include "defs.do"', 'local veggie spinach'].join('\n'),
        );
        const root_content = ['do "child.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            MIN_CONFIG,
            undefined,
            h.scope_resolver,
        );
        const informative = diags.find(
            d =>
                d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL &&
                d.message.includes('veggie'),
        );
        expect(informative).toBeDefined();
        expect(informative!.message).toContain('child.do');
        expect(informative!.message).not.toContain('defs.do');
    });

    // Bug B (this branch): nested do under an include chain used to be
    // forcibly blamed. Under single-boundary semantics the rewrite no longer
    // fires here — there is no root-level `do`/`run` whose promotion would
    // expose the deep binding — so the analyzer's generic UNDEFINED_MACRO
    // stands. Kept as a pin so we don't accidentally regress back to the
    // all-promotion rewrite.
    test('Bug B: nested do under include falls back to generic UNDEFINED_MACRO', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'grandchild.do'), 'local veggie beet');
        fs.writeFileSync(path.join(h.temp_dir, 'child.do'), 'do "grandchild.do"');
        const root_content = ['include "child.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            MIN_CONFIG,
            undefined,
            h.scope_resolver,
        );
        const ref_line_diags = diags.filter(d => d.range.start.line === 1);
        const rewrite = ref_line_diags.find(
            d =>
                d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL &&
                d.message.includes('veggie'),
        );
        const generic = ref_line_diags.find(
            d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                d.message.includes('veggie'),
        );
        expect(rewrite).toBeUndefined();
        expect(generic).toBeDefined();
    });

    // Commit a813cca: highest-precedence callee for shadowed locals.
    // child has `local veggie` then an include that also binds veggie;
    // the include's definition is the last one in execution order.
    test('a813cca: highest-precedence shadow is the include', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'defs.do'), 'local veggie beet');
        fs.writeFileSync(
            path.join(h.temp_dir, 'child.do'),
            ['local veggie carrot', 'include "defs.do"'].join('\n'),
        );
        const root_content = ['do "child.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            MIN_CONFIG,
            undefined,
            h.scope_resolver,
        );
        const informative = diags.find(
            d =>
                d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL &&
                d.message.includes('veggie'),
        );
        expect(informative).toBeDefined();
        expect(informative!.message).toContain('defs.do');
        expect(informative!.message).not.toContain('child.do');
    });

    // Commit e8bebbb: respect undefinedMacro=off when emitting rewrite.
    test('e8bebbb: undefinedMacro=off suppresses the rewrite too', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'child.do'), 'local veggie beet');
        const root_content = ['do "child.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const off_config: StataLSPConfig = {
            ...MIN_CONFIG,
            diagnostics: {
                ...MIN_CONFIG.diagnostics,
                severity: {
                    ...MIN_CONFIG.diagnostics.severity,
                    undefinedMacro: 'off',
                },
            },
        };
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            off_config,
            undefined,
            h.scope_resolver,
        );
        expect(
            diags.some(d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL),
        ).toBe(false);
        expect(
            diags.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO),
        ).toBe(false);
    });

    // Commit 180e56e: suppress OUT_OF_SCOPE_SYMBOL when base diagnostic off.
    // Same scenario as e8bebbb; covered by the config path — kept separate
    // as a narrative marker for the commit.
    test('180e56e: base diagnostic off suppresses rewrite', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'child.do'), 'local veggie beet');
        const root_content = ['do "child.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const off_config: StataLSPConfig = {
            ...MIN_CONFIG,
            diagnostics: {
                ...MIN_CONFIG.diagnostics,
                severity: {
                    ...MIN_CONFIG.diagnostics.severity,
                    undefinedMacro: 'off',
                },
            },
        };
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            off_config,
            undefined,
            h.scope_resolver,
        );
        expect(
            diags.some(d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL),
        ).toBe(false);
    });

    // Codex audit (2026-04): under single-boundary semantics, promoting
    // root's `do child` to `include child` makes child run in main's scope.
    // child's include-only end-state binds x from defs1 (reached through
    // include); mid's `do grandchild` is opaque and contributes nothing.
    // The diagnostic must name defs1, not grandchild.
    test('codex audit: single-boundary walk names defs1 (nested do stays opaque)', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'defs1.do'), 'local x defs1');
        fs.writeFileSync(path.join(h.temp_dir, 'grandchild.do'), 'local x grand');
        fs.writeFileSync(path.join(h.temp_dir, 'mid.do'), 'do "grandchild.do"');
        fs.writeFileSync(
            path.join(h.temp_dir, 'child.do'),
            ['include "defs1.do"', 'include "mid.do"'].join('\n'),
        );
        const root_content = ['do "child.do"', 'di `x\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            MIN_CONFIG,
            undefined,
            h.scope_resolver,
        );
        const informative = diags.find(
            d =>
                d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL &&
                d.message.includes("'x'"),
        );
        expect(informative).toBeDefined();
        expect(informative!.message).toContain('defs1.do');
        expect(informative!.message).not.toContain('grandchild.do');
    });

    // Commit 62c5703: preserve undefined macro fallback when
    // cross_file.diagnostics.out_of_scope = off.
    test('62c5703: out_of_scope=off keeps plain UNDEFINED_MACRO', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'child.do'), 'local veggie beet');
        const root_content = ['do "child.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const rewrite_off: StataLSPConfig = {
            ...MIN_CONFIG,
            cross_file: {
                ...MIN_CONFIG.cross_file,
                diagnostics: {
                    out_of_scope: 'off',
                },
            },
        } as unknown as StataLSPConfig;
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            rewrite_off,
            undefined,
            h.scope_resolver,
        );
        const ref_line = diags.filter(d => d.range.start.line === 1);
        expect(
            ref_line.some(d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL),
        ).toBe(false);
        expect(
            ref_line.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO),
        ).toBe(true);
    });

    // Codex Gap 5 (run-vs-do asymmetry): `run` should behave like `do` for
    // local-macro propagation — neither propagates locals to caller — so
    // the blame rewrite should fire identically.
    test('codex gap 5 (run vs do): run and do produce the same blame', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'callee_run.do'), 'local veggie beet');
        fs.writeFileSync(path.join(h.temp_dir, 'callee_do.do'), 'local veggie beet');
        const root_content_run = ['run "callee_run.do"', 'di `veggie\''].join('\n');
        const root_content_do = ['do "callee_do.do"', 'di `veggie\''].join('\n');

        fs.writeFileSync(path.join(h.temp_dir, 'main_run.do'), root_content_run);
        const run_uri = URI.file(path.join(h.temp_dir, 'main_run.do')).toString();
        await h.document_store.open(run_uri, root_content_run, 1);
        const run_diags = await h.diagnostics_provider.get_diagnostics(
            h.document_store.get(run_uri)!,
            MIN_CONFIG,
            undefined,
            h.scope_resolver,
        );
        const run_info = run_diags.find(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL && d.message.includes('veggie'),
        );
        expect(run_info).toBeDefined();
        expect(run_info!.message).toContain('callee_run.do');

        fs.writeFileSync(path.join(h.temp_dir, 'main_do.do'), root_content_do);
        const do_uri = URI.file(path.join(h.temp_dir, 'main_do.do')).toString();
        await h.document_store.open(do_uri, root_content_do, 1);
        const do_diags = await h.diagnostics_provider.get_diagnostics(
            h.document_store.get(do_uri)!,
            MIN_CONFIG,
            undefined,
            h.scope_resolver,
        );
        const do_info = do_diags.find(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL && d.message.includes('veggie'),
        );
        expect(do_info).toBeDefined();
        expect(do_info!.message).toContain('callee_do.do');
    });

    // Codex Gap 5 (cycle safety): mutual-include cycles must not throw or
    // hang. When the referenced local is defined somewhere in the cycle
    // reachable through `include`, the rewrite should still fire; when it
    // is not defined anywhere, plain UNDEFINED_MACRO is preserved.
    test('codex gap 5 (cycle): mutual includes terminate safely', async () => {
        fs.writeFileSync(
            path.join(h.temp_dir, 'cycle_a.do'),
            ['include "cycle_b.do"', 'local veggie beet'].join('\n'),
        );
        fs.writeFileSync(
            path.join(h.temp_dir, 'cycle_b.do'),
            'include "cycle_a.do"',
        );
        const root_content = ['do "cycle_a.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            MIN_CONFIG,
            undefined,
            h.scope_resolver,
        );
        const informative = diags.find(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL && d.message.includes('veggie'),
        );
        // Either the rewrite fires naming the defining file, or no
        // spurious exception. Must not throw or hang.
        expect(informative).toBeDefined();
        expect(informative!.message).toContain('cycle_a.do');
    });

    // Codex Gap 5 (out_of_scope severity passthrough): lowering
    // cross_file.diagnostics.out_of_scope from warning to information
    // must preserve the rewrite presence and message; only severity
    // changes.
    test('codex gap 5 (severity): out_of_scope severity change preserves presence and text', async () => {
        fs.writeFileSync(path.join(h.temp_dir, 'severity_child.do'), 'local veggie beet');
        const root_content = ['do "severity_child.do"', 'di `veggie\''].join('\n');
        const root_path = path.join(h.temp_dir, 'main.do');
        fs.writeFileSync(root_path, root_content);
        const root_uri = URI.file(root_path).toString();
        await h.document_store.open(root_uri, root_content, 1);
        const doc = h.document_store.get(root_uri)!;
        const warning_config: StataLSPConfig = {
            ...MIN_CONFIG,
            cross_file: {
                ...MIN_CONFIG.cross_file,
                diagnostics: { out_of_scope: 'warning' },
            },
        } as unknown as StataLSPConfig;
        const info_config: StataLSPConfig = {
            ...MIN_CONFIG,
            cross_file: {
                ...MIN_CONFIG.cross_file,
                diagnostics: { out_of_scope: 'information' },
            },
        } as unknown as StataLSPConfig;
        const warn_diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            warning_config,
            undefined,
            h.scope_resolver,
        );
        const info_diags = await h.diagnostics_provider.get_diagnostics(
            doc,
            info_config,
            undefined,
            h.scope_resolver,
        );
        const warn_rewrite = warn_diags.find(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL && d.message.includes('veggie'),
        );
        const info_rewrite = info_diags.find(
            d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL && d.message.includes('veggie'),
        );
        expect(warn_rewrite).toBeDefined();
        expect(info_rewrite).toBeDefined();
        // Message unchanged; only severity differs.
        expect(info_rewrite!.message).toBe(warn_rewrite!.message);
        expect(info_rewrite!.severity).not.toBe(warn_rewrite!.severity);
    });
});

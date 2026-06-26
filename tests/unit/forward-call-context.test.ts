/**
 * Tests for ForwardCall resolution-context fields (Task 5 of issue #205).
 *
 * Each ForwardCall produced by analyzer / scope-resolver / indexer /
 * document-store must carry:
 *   - caller_uri  : URI of the file containing the call (non-empty string)
 *   - working_directory : effective WD at call site (string | undefined,
 *                         where undefined means "script-relative")
 *
 * These fields are the prerequisite for Tasks 6 & 7 (case-only path
 * resolution) so that every consumer can replay the correct path join
 * without guessing which base directory to use.
 *
 * Stamping is observed through production consumers rather than removed
 * test-only accessors:
 *   - Indexer: via a spy DependencyGraph injected with
 *     `indexer.set_dependency_graph()`, capturing `update_caller` args.
 *   - ScopeResolver: via `reverse_deps.last_forward_calls` — the internal
 *     map populated by `register_forward_call_relationships_from_cache`
 *     (accessed as `(scope_resolver as any).reverse_deps.last_forward_calls`
 *     to avoid adding a public accessor for a private field).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';

import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { WorkspaceIndexer } from '../../src/indexer';
import { ScopeResolver } from '../../src/scope-resolver';
import {
    DependencyGraph,
    type GraphUpdateResult,
} from '../../src/dependency-graph';
import type { ForwardCall } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let temp_dir: string;

function setup_temp_dir(): void {
    temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-fwdctx-'));
}

function tear_down_temp_dir(): void {
    fs.rmSync(temp_dir, { recursive: true, force: true });
}

function write_file(rel_path: string, content: string): string {
    const abs_path = path.join(temp_dir, rel_path);
    fs.mkdirSync(path.dirname(abs_path), { recursive: true });
    fs.writeFileSync(abs_path, content);
    return abs_path;
}

/**
 * A DependencyGraph subclass that captures `update_caller` calls so tests
 * can inspect the ForwardCall objects passed by the production indexer path.
 * No test-only accessor is needed on WorkspaceIndexer itself.
 */
class SpyDependencyGraph extends DependencyGraph {
    // Recorded arguments: caller_uri -> last forward_calls array
    readonly recorded_calls: Map<string, ForwardCall[]> = new Map();

    override update_caller(
        caller_uri: string,
        forward_calls: ForwardCall[],
    ): GraphUpdateResult {
        this.recorded_calls.set(caller_uri, [...forward_calls]);
        return super.update_caller(caller_uri, forward_calls);
    }
}

// ---------------------------------------------------------------------------
// 1. Analyzer producer
// ---------------------------------------------------------------------------

describe('ForwardCall context — analyzer producer', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;

    beforeEach(() => {
        setup_temp_dir();
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
    });

    afterEach(() => {
        tear_down_temp_dir();
    });

    it('carries non-empty caller_uri on a "do sub/clean" command call', () => {
        // Write a caller file so the path resolution does not depend on
        // the file actually existing (raw_path is what we care about).
        const caller_path = write_file('main.do', 'do sub/clean\n');
        const caller_uri = URI.file(caller_path).toString();

        const my_lex = lexer.tokenize('do sub/clean\n');
        const my_parse = parser.parse(my_lex.tokens);
        const my_result = analyzer.analyze(
            my_parse.ast,
            caller_uri,
            undefined,
            {},
        );

        const the_calls = my_result.forward_calls;
        expect(the_calls.length).toBeGreaterThanOrEqual(1);

        const my_call = the_calls[0];
        expect(my_call.raw_path).toBe('sub/clean');
        expect(my_call.caller_uri).toBeTruthy();
        expect(my_call.caller_uri).toBe(caller_uri);
    });

    it('caller_uri is set on include command calls', () => {
        const caller_path = write_file('parent.do', 'include helpers.do\n');
        const caller_uri = URI.file(caller_path).toString();

        const my_lex = lexer.tokenize('include helpers.do\n');
        const my_parse = parser.parse(my_lex.tokens);
        const my_result = analyzer.analyze(
            my_parse.ast,
            caller_uri,
            undefined,
            {},
        );

        const my_call = my_result.forward_calls[0];
        expect(my_call.raw_path).toBe('helpers.do');
        expect(my_call.caller_uri).toBe(caller_uri);
    });

    it('working_directory is undefined when no WD is configured', () => {
        const caller_path = write_file('main.do', 'do sub/clean\n');
        const caller_uri = URI.file(caller_path).toString();

        const my_lex = lexer.tokenize('do sub/clean\n');
        const my_parse = parser.parse(my_lex.tokens);
        const my_result = analyzer.analyze(
            my_parse.ast,
            caller_uri,
            undefined,
            {},  // no working_directory
        );

        const my_call = my_result.forward_calls[0];
        // undefined means script-relative — must be explicitly set (not absent)
        expect(Object.prototype.hasOwnProperty.call(my_call, 'working_directory'))
            .toBe(true);
        expect(my_call.working_directory).toBeUndefined();
    });

    it('working_directory is stamped when config provides one', () => {
        const wd_path = path.join(temp_dir, 'wd');
        fs.mkdirSync(wd_path);
        const caller_path = write_file('main.do', 'do sub/clean\n');
        const caller_uri = URI.file(caller_path).toString();

        const my_lex = lexer.tokenize('do sub/clean\n');
        const my_parse = parser.parse(my_lex.tokens);
        const my_result = analyzer.analyze(
            my_parse.ast,
            caller_uri,
            undefined,
            { working_directory: wd_path },
        );

        const my_call = my_result.forward_calls[0];
        expect(my_call.working_directory).toBe(wd_path);
    });
});

// ---------------------------------------------------------------------------
// 2. Indexer producer — stamping caller_uri and working_directory
//
// Observed via a SpyDependencyGraph injected into the indexer via
// `set_dependency_graph()`.  The indexer's production path calls
// `dependency_graph.update_caller(file_uri, all_forward_calls)` after
// stamping; we record those forward_calls directly from the spy.
// ---------------------------------------------------------------------------

describe('ForwardCall context — indexer producer', () => {
    let indexer: WorkspaceIndexer;
    let spy_graph: SpyDependencyGraph;

    beforeEach(async () => {
        setup_temp_dir();
        indexer = new WorkspaceIndexer();
        spy_graph = new SpyDependencyGraph();
        spy_graph.set_workspace_roots([temp_dir]);
        indexer.set_dependency_graph(spy_graph);
        // initialize() sets workspace_roots; we pass an empty ado_paths list
        // and let it scan (temp_dir is empty at this point so it is fast).
        await indexer.initialize([temp_dir]);
    });

    afterEach(() => {
        tear_down_temp_dir();
    });

    it('stamps caller_uri on command-detected ForwardCalls after indexing', async () => {
        const caller_path = write_file('runner.do', 'do sub/work\n');
        const caller_uri = URI.file(caller_path).toString();

        await indexer.index_file(caller_path);

        const the_calls = spy_graph.recorded_calls.get(caller_uri);
        expect(the_calls).toBeDefined();
        expect(the_calls!.length).toBeGreaterThanOrEqual(1);
        const my_call = the_calls![0];
        expect(my_call.caller_uri).toBe(caller_uri);
    });

    it('stamps working_directory from @lsp-cd directive', async () => {
        // Use a workspace-relative path (/data) so the directive parser
        // resolves it against temp_dir (the workspace root set via initialize).
        const wd_path = path.join(temp_dir, 'data');
        fs.mkdirSync(wd_path);
        // @lsp-cd /data  → workspace-relative, resolved to temp_dir/data
        const caller_content = '// @lsp-cd /data\ndo sub/work\n';
        const caller_path = write_file('runner.do', caller_content);
        const caller_uri = URI.file(caller_path).toString();

        await indexer.index_file(caller_path);

        const the_calls = spy_graph.recorded_calls.get(caller_uri);
        expect(the_calls).toBeDefined();
        expect(the_calls!.length).toBeGreaterThanOrEqual(1);
        const my_call = the_calls![0];
        expect(my_call.working_directory).toBe(wd_path);
    });

    it('working_directory is undefined when file has no @lsp-cd directive', async () => {
        const caller_path = write_file('runner.do', 'do sub/work\n');
        const caller_uri = URI.file(caller_path).toString();

        await indexer.index_file(caller_path);

        const the_calls = spy_graph.recorded_calls.get(caller_uri);
        expect(the_calls).toBeDefined();
        const my_call = the_calls![0];
        expect(Object.prototype.hasOwnProperty.call(my_call, 'working_directory'))
            .toBe(true);
        expect(my_call.working_directory).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// 3. ScopeResolver.parse_content producer
//
// Observed via `(scope_resolver as any).reverse_deps.last_forward_calls`,
// the internal Map populated by `register_forward_call_relationships_from_cache`
// immediately after `parse_content` runs.  This avoids adding a public
// accessor; the cast is a deliberate test-seam read on a private field.
// ---------------------------------------------------------------------------

describe('ForwardCall context — scope-resolver parse_content producer', () => {
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        setup_temp_dir();
        scope_resolver = new ScopeResolver();
        scope_resolver.set_workspace_roots([temp_dir]);
    });

    afterEach(() => {
        tear_down_temp_dir();
    });

    /**
     * Retrieve the forward calls stored in the scope-resolver's file_cache
     * for a given URI.  The file_cache is the production store populated by
     * both `parse_file` (in-memory/inline path, used by `resolve()`) and
     * `_read_and_parse_uri_from_disk` (disk path).  We read it via a
     * deliberate `as any` cast rather than adding a public accessor.
     *
     * The cache key is "uri" or "uri|working_directory"; we match any key
     * that starts with the bare URI so working-directory variants are found.
     */
    function get_file_cache_forward_calls(
        sr: ScopeResolver,
        uri: string,
    ): ForwardCall[] | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const the_cache: Map<string, { forward_calls: ForwardCall[] }> =
            (sr as any).file_cache;
        for (const [my_key, my_entry] of the_cache) {
            if (my_key === uri || my_key.startsWith(`${uri}|`)) {
                return my_entry.forward_calls;
            }
        }
        return undefined;
    }

    it('stamps caller_uri and working_directory on forward calls', async () => {
        write_file('sub/work.do', 'global g = 1\n');
        // Use workspace-relative @lsp-cd /data — resolved against temp_dir.
        const wd_path = path.join(temp_dir, 'data');
        fs.mkdirSync(wd_path, { recursive: true });
        const caller_content = '// @lsp-cd /data\ndo sub/work\n';
        const caller_path = write_file('runner.do', caller_content);
        const caller_uri = URI.file(caller_path).toString();

        // resolve() drives parse_content internally
        const the_resolved = await scope_resolver.resolve(
            caller_uri,
            caller_content,
        );

        // The resolve() itself must not throw
        expect(the_resolved).toBeDefined();

        // Verify stamping via the production internal store populated by
        // register_forward_call_relationships_from_cache.
        const the_calls = get_file_cache_forward_calls(scope_resolver, caller_uri);
        expect(the_calls).toBeDefined();
        expect(the_calls!.length).toBeGreaterThanOrEqual(1);
        const my_call = the_calls![0];
        expect(my_call.caller_uri).toBe(caller_uri);
        // WD should equal the resolved wd_path (workspace_root + 'data')
        expect(my_call.working_directory).toBe(wd_path);
    });

    it('working_directory is undefined when no @lsp-cd directive', async () => {
        const caller_content = 'do sub/work\n';
        const caller_path = write_file('runner2.do', caller_content);
        const caller_uri = URI.file(caller_path).toString();

        await scope_resolver.resolve(caller_uri, caller_content);

        const the_calls = get_file_cache_forward_calls(scope_resolver, caller_uri);
        expect(the_calls).toBeDefined();
        expect(the_calls!.length).toBeGreaterThanOrEqual(1);
        const my_call = the_calls![0];
        expect(my_call.caller_uri).toBe(caller_uri);
        expect(Object.prototype.hasOwnProperty.call(my_call, 'working_directory'))
            .toBe(true);
        expect(my_call.working_directory).toBeUndefined();
    });
});

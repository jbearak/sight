/**
 * Handler-level integration tests for document lifecycle wiring: onDidClose
 * disk re-sync (#287) and editor diagnostic ownership (#602).
 *
 * All prior coverage of `resync_backward_directive_dependencies_from_disk`
 * is at the ScopeResolver unit level; nothing drove the REAL
 * `documents.onDidClose` handler registered in `create_server`
 * (src/server-factory.ts), so a wiring mistake — wrong URI variable,
 * wrong config source (global instead of the URI-scoped settings
 * captured before the `document_settings` delete), a broken
 * reopen-aware guard against TextDocuments, or a dropped dependent
 * revalidation — would not be caught.
 *
 * This test starts the real server via `create_server` with an injected
 * stub connection (the test-only `ServerOptions.connection` seam),
 * drives the captured LSP notification handlers exactly as a client
 * would (initialize / initialized / didOpen / didClose), and asserts
 * on the live ScopeResolver instance:
 *   1. closing a document whose buffer header disagrees with disk
 *      converges the backward-directive edges to DISK state, and the
 *      re-sync receives the closed document's URI and its URI-scoped
 *      settings (a scoped `crossFile.backwardDependencies` override,
 *      not the global default);
 *   2. a quick close -> reopen makes the reopen guard veto the re-sync
 *      (the reopened buffer's commit owns registration), leaving the
 *      buffer-time edges intact;
 *   3. when the re-sync applies, open files that depend on the closed
 *      file via backward directives — including transitively, two hops
 *      away — are revalidated (diagnostics are republished for them);
 *   4. the DOCUMENT-STORE half of the should_apply guard vetoes on its
 *      own (a store entry recreated while the re-sync is held at entry,
 *      with TextDocuments still empty), and a vetoed re-sync does NOT
 *      revalidate open dependents. (The resolver-internal contract that
 *      the guard is consulted AFTER the disk read is unit-tested in
 *      tests/unit/document-store-commit-time-cross-file-effects.test.ts.);
 *   5. hidden LSP-open models remain in DocumentStore while tab removal clears
 *      their diagnostics and re-addition republishes without another didOpen.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import type {
    Connection,
    InitializeParams,
    DidOpenTextDocumentParams,
    DidCloseTextDocumentParams,
    PublishDiagnosticsParams,
    CancellationToken,
    DidChangeConfigurationParams,
    DidChangeWatchedFilesParams,
    DidChangeWatchedFilesRegistrationOptions,
    FileSystemWatcher,
} from 'vscode-languageserver/node';
import { FileChangeType } from 'vscode-languageserver/node';
import { create_server } from '../../src/server-factory';
import { ScopeResolver } from '../../src/scope-resolver';
import { DocumentStore } from '../../src/document-store';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { Logger } from '../../src/utils/logger';
import type { ScopeResolverConfig } from '../../src/types';
import { wait_until } from '../wait-until';

// ---------------------------------------------------------------------------
// ScopeResolver instrumentation: the resolver is created inside
// create_server's onInitialized closure, so capture the instance (and spy
// on the close-time re-sync) via prototype wrapping, restored after each
// test.
// ---------------------------------------------------------------------------

interface ResyncCall {
    uri: string;
    config: Partial<ScopeResolverConfig> | undefined;
    result: Promise<boolean>;
}

let captured_resolver: ScopeResolver | undefined;
let captured_document_store: DocumentStore | undefined;
let captured_indexer: WorkspaceIndexer | undefined;
let captured_graph: DependencyGraph | undefined;
let the_indexing_runs: Promise<void>[] = [];
let the_resync_calls: ResyncCall[] = [];
let workspace_roots_seen: string[] = [];
let scope_resolution_gate: Promise<void> | undefined;
let captured_scope_cancellation_token: CancellationToken | undefined;
// When set, the spied re-sync records its call, then holds before running
// the real method until this promise resolves — letting a test create
// race conditions deterministically (test 4). Undefined = no hold.
let resync_gate: Promise<void> | undefined;

const original_set_dependency_graph =
    ScopeResolver.prototype.set_dependency_graph;
const original_set_workspace_roots =
    ScopeResolver.prototype.set_workspace_roots;
const original_resync =
    ScopeResolver.prototype.resync_backward_directive_dependencies_from_disk;
const original_directory_probe =
    ScopeResolver.prototype.resolve_document_working_directory;
const original_set_scope_resolver =
    DocumentStore.prototype.set_scope_resolver;
const original_initialize_indexer = WorkspaceIndexer.prototype.initialize;

function install_resolver_spies(): void {
    captured_resolver = undefined;
    captured_document_store = undefined;
    captured_indexer = undefined;
    captured_graph = undefined;
    the_indexing_runs = [];
    the_resync_calls = [];
    workspace_roots_seen = [];
    resync_gate = undefined;
    scope_resolution_gate = undefined;
    captured_scope_cancellation_token = undefined;
    ScopeResolver.prototype.set_dependency_graph = function (
        ...args: Parameters<typeof original_set_dependency_graph>
    ) {
        captured_resolver = this;
        captured_graph = args[0];
        return original_set_dependency_graph.apply(this, args);
    };
    ScopeResolver.prototype.set_workspace_roots = function (
        ...args: Parameters<typeof original_set_workspace_roots>
    ) {
        workspace_roots_seen.push(...args[0]);
        return original_set_workspace_roots.apply(this, args);
    };
    ScopeResolver.prototype.resync_backward_directive_dependencies_from_disk =
        function (...args: Parameters<typeof original_resync>) {
            const gate = resync_gate;
            const result = (async () => {
                if (gate) {
                    await gate;
                }
                return original_resync.apply(this, args);
            })();
            the_resync_calls.push({
                uri: args[0],
                config: args[1],
                result,
            });
            return result;
        };
    ScopeResolver.prototype.resolve_document_working_directory = async function (
        ...args: Parameters<typeof original_directory_probe>
    ) {
        const gate = scope_resolution_gate;
        if (gate) {
            captured_scope_cancellation_token = args[3];
            await gate;
        }
        return original_directory_probe.apply(this, args);
    };
    DocumentStore.prototype.set_scope_resolver = function (
        ...args: Parameters<typeof original_set_scope_resolver>
    ) {
        captured_document_store = this;
        return original_set_scope_resolver.apply(this, args);
    };
    WorkspaceIndexer.prototype.initialize = function (
        ...args: Parameters<typeof original_initialize_indexer>
    ) {
        captured_indexer = this;
        const result = original_initialize_indexer.apply(this, args);
        the_indexing_runs.push(result);
        return result;
    };
}

function restore_resolver_spies(): void {
    ScopeResolver.prototype.set_dependency_graph =
        original_set_dependency_graph;
    ScopeResolver.prototype.set_workspace_roots =
        original_set_workspace_roots;
    ScopeResolver.prototype.resync_backward_directive_dependencies_from_disk =
        original_resync;
    ScopeResolver.prototype.resolve_document_working_directory =
        original_directory_probe;
    DocumentStore.prototype.set_scope_resolver =
        original_set_scope_resolver;
    WorkspaceIndexer.prototype.initialize = original_initialize_indexer;
}

// ---------------------------------------------------------------------------
// Stub connection: captures the handlers create_server registers so the
// test can invoke them directly, and records published diagnostics.
// ---------------------------------------------------------------------------

interface CapturedHandlers {
    initialize?: (params: InitializeParams) => unknown;
    initialized?: () => void;
    did_open?: (params: DidOpenTextDocumentParams) => void;
    did_close?: (params: DidCloseTextDocumentParams) => void;
    did_change_configuration?: (params: DidChangeConfigurationParams) => void;
    did_change_watched_files?: (params: DidChangeWatchedFilesParams) => void;
    diagnostic_resources?: (params: unknown) => void;
    shutdown?: () => unknown;
}

interface StubConnectionOptions {
    workspace_folder_uri: string;
    /** Returns the public `sight` config subtree for a scope URI. */
    get_scoped_config: (scope_uri: string | undefined) => unknown;
    published_uris: string[];
}

function noop_disposable(): { dispose: () => void } {
    return { dispose: () => { } };
}

function make_stub_connection(options: StubConnectionOptions): {
    connection: Connection;
    handlers: CapturedHandlers;
} {
    const handlers: CapturedHandlers = {};
    const capture_nothing = () => noop_disposable();
    const connection_stub = {
        console: {
            log: () => { },
            warn: () => { },
            error: () => { },
            info: () => { },
        },
        onInitialize: (handler: CapturedHandlers['initialize']) => {
            handlers.initialize = handler;
        },
        onInitialized: (handler: CapturedHandlers['initialized']) => {
            handlers.initialized = handler;
        },
        onDidChangeConfiguration: (
            handler: CapturedHandlers['did_change_configuration']
        ) => {
            handlers.did_change_configuration = handler;
            return noop_disposable();
        },
        onDidChangeWatchedFiles: (
            handler: CapturedHandlers['did_change_watched_files']
        ) => {
            handlers.did_change_watched_files = handler;
            return noop_disposable();
        },
        onNotification: (
            method: string,
            handler: CapturedHandlers['diagnostic_resources']
        ) => {
            if (method === 'sight/diagnosticResourcesChanged') {
                handlers.diagnostic_resources = handler;
            }
            return noop_disposable();
        },
        onCompletion: capture_nothing,
        onCompletionResolve: capture_nothing,
        onHover: capture_nothing,
        onDefinition: capture_nothing,
        onReferences: capture_nothing,
        onDocumentSymbol: capture_nothing,
        onWorkspaceSymbol: capture_nothing,
        onDocumentFormatting: capture_nothing,
        onDocumentRangeFormatting: capture_nothing,
        onExecuteCommand: capture_nothing,
        onShutdown: (handler: CapturedHandlers['shutdown']) => {
            handlers.shutdown = handler;
        },
        onExit: capture_nothing,
        onRequest: capture_nothing,
        sendDiagnostics: (params: PublishDiagnosticsParams) => {
            options.published_uris.push(params.uri);
            published_diagnostics.push(params);
        },
        // Surface used by TextDocuments.listen(connection):
        onDidOpenTextDocument: (
            handler: CapturedHandlers['did_open']
        ) => {
            handlers.did_open = handler;
            return noop_disposable();
        },
        onDidChangeTextDocument: capture_nothing,
        onDidCloseTextDocument: (
            handler: CapturedHandlers['did_close']
        ) => {
            handlers.did_close = handler;
            return noop_disposable();
        },
        onWillSaveTextDocument: capture_nothing,
        onWillSaveTextDocumentWaitUntil: capture_nothing,
        onDidSaveTextDocument: capture_nothing,
        client: {
            register: (
                _method: unknown,
                registration?: DidChangeWatchedFilesRegistrationOptions
            ) => {
                if (!registration?.watchers) {
                    return Promise.resolve(noop_disposable());
                }
                const record = {
                    watchers: registration.watchers,
                    disposed: false,
                };
                the_watch_registrations.push(record);
                return Promise.resolve({
                    dispose: () => { record.disposed = true; },
                });
            },
        },
        workspace: {
            getConfiguration: (item?: { scopeUri?: string }) =>
                Promise.resolve(options.get_scoped_config(item?.scopeUri)),
            getWorkspaceFolders: () => Promise.resolve([
                { uri: options.workspace_folder_uri, name: 'test-ws' },
            ]),
            onDidChangeWorkspaceFolders: capture_nothing,
        },
        listen: () => { },
    };
    return {
        connection: connection_stub as unknown as Connection,
        handlers,
    };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

// Every wait in this file must stay below TEST_TIMEOUT_MS so wait_until's
// descriptive error surfaces instead of bun's generic test timeout; each
// it() below passes TEST_TIMEOUT_MS explicitly because the default 5000ms
// budget is too tight for the chained waits on slow CI.
const TEST_TIMEOUT_MS = 30000;
const WAIT_TIMEOUT_MS = 10000;

let tmp_dir: string;
let published_uris: string[] = [];
let published_diagnostics: PublishDiagnosticsParams[] = [];
let active_handlers: CapturedHandlers | undefined;
let the_watch_registrations: Array<{
    watchers: FileSystemWatcher[];
    disposed: boolean;
}> = [];

// Disable workspace indexing so no scan-time dependency-graph edges or
// timers interfere; only explicit @lsp-done-by directives are in play.
const GLOBAL_PUBLIC_CONFIG = { crossFile: { indexWorkspace: false } };

async function start_test_server(
    get_scoped_config: (scope_uri: string | undefined) => unknown,
    initialization_options?: unknown,
    options: {
        workspace_root?: string;
        dynamic_watchers?: boolean;
    } = {}
): Promise<CapturedHandlers> {
    const workspace_root = options.workspace_root ?? tmp_dir;
    const workspace_folder_uri = URI.file(workspace_root).toString();
    const { connection, handlers } = make_stub_connection({
        workspace_folder_uri,
        get_scoped_config,
        published_uris,
    });
    await create_server({ transport: 'stdio', quiet: true, connection });
    // Assign before any wait/assertion can fail, so afterEach still runs
    // the shutdown handler and no server timers outlive a failing test.
    active_handlers = handlers;
    expect(handlers.initialize).toBeDefined();
    expect(handlers.initialized).toBeDefined();
    expect(handlers.did_open).toBeDefined();
    expect(handlers.did_close).toBeDefined();
    handlers.initialize!({
        processId: null,
        rootUri: workspace_folder_uri,
        capabilities: {
            workspace: {
                configuration: true,
                didChangeWatchedFiles: {
                    dynamicRegistration: options.dynamic_watchers ?? false,
                },
            },
        },
        workspaceFolders: null,
        initializationOptions: initialization_options,
    } as InitializeParams);
    handlers.initialized!();
    // onInitialized creates the providers synchronously, then finishes
    // workspace setup asynchronously (getWorkspaceFolders -> settings ->
    // configure). Wait for both before opening documents.
    await wait_until(
        () => captured_resolver !== undefined &&
            workspace_roots_seen.includes(workspace_root),
        'server initialization to reach the workspace-roots refresh',
        WAIT_TIMEOUT_MS
    );
    return handlers;
}

function write_workspace_files(): void {
    fs.writeFileSync(
        path.join(tmp_dir, 'parent_disk.do'),
        'display "parent disk"\n'
    );
    fs.writeFileSync(
        path.join(tmp_dir, 'parent_buffer.do'),
        'display "parent buffer"\n'
    );
    fs.writeFileSync(
        path.join(tmp_dir, 'child.do'),
        '// @lsp-done-by: "parent_disk.do"\ndisplay "child"\n'
    );
    fs.writeFileSync(
        path.join(tmp_dir, 'grandchild.do'),
        '// @lsp-done-by: "child.do"\ndisplay "grandchild"\n'
    );
    fs.writeFileSync(
        path.join(tmp_dir, 'greatgrandchild.do'),
        '// @lsp-done-by: "grandchild.do"\ndisplay "greatgrandchild"\n'
    );
}

function file_uri(name: string): string {
    return URI.file(path.join(tmp_dir, name)).toString();
}

function open_document(
    handlers: CapturedHandlers,
    uri: string,
    text: string,
    version = 1
): void {
    handlers.did_open!({
        textDocument: { uri, languageId: 'stata', version, text },
    });
}

const CHILD_BUFFER_TEXT =
    '// @lsp-done-by: "parent_buffer.do"\ndisplay "child"\n';

/**
 * Wait until no diagnostic publish lands for three consecutive 150ms
 * samples (~450ms of silence, several times the 100ms debounce window),
 * so nothing scheduled earlier is still in flight. The counter resets on
 * every new publish, so the window is measured from the LAST publish.
 */
async function wait_for_publish_quiescence(): Promise<void> {
    let stable_samples = 0;
    let last_count = published_uris.length;
    await wait_until(() => {
        const current_count = published_uris.length;
        if (current_count === last_count) {
            stable_samples++;
        } else {
            stable_samples = 0;
            last_count = current_count;
        }
        return stable_samples >= 3;
    }, 'diagnostic publishes to go quiescent', WAIT_TIMEOUT_MS, 150);
}

const DISCOVERED_CALLER_TEXT = [
    'program define discovered_program',
    'end',
    'global discovered_value 1',
    'do "analysis.do"',
    '',
].join('\n');
const DISCOVERED_CALLEE_TEXT = 'display "$discovered_value"\n';

function write_discovery_files(root = tmp_dir): void {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'caller.do'), DISCOVERED_CALLER_TEXT);
    fs.writeFileSync(path.join(root, 'analysis.do'), DISCOVERED_CALLEE_TEXT);
}

async function wait_for_index_run(previous_count: number): Promise<void> {
    await wait_until(
        () => the_indexing_runs.length > previous_count,
        'a new workspace indexing run',
        WAIT_TIMEOUT_MS
    );
    await the_indexing_runs.at(-1);
    expect(captured_graph?.is_scan_complete()).toBe(true);
}

function notify_disk_change(
    handlers: CapturedHandlers,
    uri: string,
    type: FileChangeType
): void {
    expect(handlers.did_change_watched_files).toBeDefined();
    handlers.did_change_watched_files!({ changes: [{ uri, type }] });
}

function expect_discovered_caller(included: boolean, root = tmp_dir): void {
    const caller_uri = URI.file(path.join(root, 'caller.do')).toString();
    const callee_uri = URI.file(path.join(root, 'analysis.do')).toString();
    expect(captured_indexer?.has_indexed_file(caller_uri)).toBe(included);
    expect(captured_indexer?.get_all_symbols().programs.has(
        'discovered_program'
    )).toBe(included);
    expect(captured_graph?.get_callees(caller_uri).has(callee_uri))
        .toBe(included);
}

async function wait_for_macro_diagnostic(
    uri: string,
    undefined_macro: boolean
): Promise<void> {
    await wait_until(() => {
        const latest = published_diagnostics
            .filter(params => params.uri === uri).at(-1);
        if (!latest) return false;
        const has_undefined = latest.diagnostics.some(diagnostic =>
            diagnostic.code === 'UNDEFINED_MACRO' &&
            diagnostic.message.includes('discovered_value')
        );
        return has_undefined === undefined_macro;
    }, `macro diagnostics to be ${undefined_macro ? 'present' : 'clear'}`,
    WAIT_TIMEOUT_MS);
}

describe('server document lifecycle wiring', () => {
    beforeEach(() => {
        install_resolver_spies();
        published_uris = [];
        published_diagnostics = [];
        active_handlers = undefined;
        the_watch_registrations = [];
        tmp_dir = fs.realpathSync(
            fs.mkdtempSync(path.join(os.tmpdir(), 'close-resync-wiring-'))
        );
        write_workspace_files();
    });

    afterEach(async () => {
        try {
            await active_handlers?.shutdown?.();
        } finally {
            restore_resolver_spies();
            // create_server({ quiet: true }) silences the process-wide
            // Logger singleton; restore its defaults (info verbosity,
            // console.debug fallback channel) so later tests in this
            // process see the out-of-the-box behavior.
            Logger.initialize({
                verbosity: 'info',
                channel: (message: string) => console.debug(message),
            });
            // Guarded so a beforeEach failure before tmp_dir is assigned
            // reports itself instead of an rmSync TypeError.
            if (tmp_dir) {
                fs.rmSync(tmp_dir, { recursive: true, force: true });
            }
        }
    });

    it('does not let validation awaiting settings reopen a closed document', async () => {
        const child_uri = file_uri('child.do');
        let release_settings: (() => void) | undefined;
        let settings_requested: (() => void) | undefined;
        const settings_started = new Promise<void>(resolve => {
            settings_requested = resolve;
        });
        const settings_gate = new Promise<void>(resolve => {
            release_settings = resolve;
        });

        const handlers = await start_test_server((scope_uri) => {
            if (scope_uri !== child_uri) {
                return GLOBAL_PUBLIC_CONFIG;
            }
            settings_requested?.();
            return settings_gate.then(() => GLOBAL_PUBLIC_CONFIG);
        });

        open_document(handlers, child_uri, CHILD_BUFFER_TEXT);
        await settings_started;

        handlers.did_close!({ textDocument: { uri: child_uri } });
        const publishes_after_close = published_uris.length;
        expect(publishes_after_close).toBeGreaterThan(0);

        release_settings?.();
        await wait_for_publish_quiescence();

        expect(captured_document_store!.get(child_uri)).toBeUndefined();
        expect(published_uris).toHaveLength(publishes_after_close);
    }, TEST_TIMEOUT_MS);

    it('converges backward edges to disk on close, passing the closed ' +
        "document's URI and its URI-scoped settings", async () => {
        const child_uri = file_uri('child.do');
        const parent_disk_uri = file_uri('parent_disk.do');
        const parent_buffer_uri = file_uri('parent_buffer.do');
        // The child's scope carries a backwardDependencies override that
        // the global scope does not: the re-sync must run under the
        // scoped mode, not the global default ('auto').
        const handlers = await start_test_server((scope_uri) =>
            scope_uri === child_uri
                ? {
                    crossFile: {
                        indexWorkspace: false,
                        backwardDependencies: 'explicit',
                    },
                }
                : GLOBAL_PUBLIC_CONFIG
        );

        // Open the child with a buffer header that points at a DIFFERENT
        // parent than the on-disk header.
        open_document(handlers, child_uri, CHILD_BUFFER_TEXT);
        await wait_until(
            () => captured_resolver!
                .get_backward_directive_children(parent_buffer_uri)
                .has(child_uri),
            'buffer-based registration of child under parent_buffer',
            WAIT_TIMEOUT_MS
        );

        handlers.did_close!({ textDocument: { uri: child_uri } });

        // The close-time re-sync reads DISK content and re-registers the
        // on-disk parent, clearing the buffer-time edge.
        await wait_until(
            () => captured_resolver!
                .get_backward_directive_children(parent_disk_uri)
                .has(child_uri),
            'disk re-sync to register child under parent_disk',
            WAIT_TIMEOUT_MS
        );
        expect(
            captured_resolver!
                .get_backward_directive_children(parent_buffer_uri)
                .has(child_uri)
        ).toBe(false);

        expect(the_resync_calls).toHaveLength(1);
        expect(the_resync_calls[0].uri).toBe(child_uri);
        // Wrong-config-source guard: global settings say 'auto'; only the
        // child's URI-scoped settings say 'explicit'.
        expect(the_resync_calls[0].config?.backward_dependencies)
            .toBe('explicit');
        expect(await the_resync_calls[0].result).toBe(true);
    }, TEST_TIMEOUT_MS);

    it('vetoes the re-sync when the document is reopened while the disk ' +
        'read is in flight (reopen guard)', async () => {
        const child_uri = file_uri('child.do');
        const parent_disk_uri = file_uri('parent_disk.do');
        const parent_buffer_uri = file_uri('parent_buffer.do');
        const handlers = await start_test_server(
            () => GLOBAL_PUBLIC_CONFIG
        );

        open_document(handlers, child_uri, CHILD_BUFFER_TEXT);
        await wait_until(
            () => captured_resolver!
                .get_backward_directive_children(parent_buffer_uri)
                .has(child_uri),
            'buffer-based registration of child under parent_buffer',
            WAIT_TIMEOUT_MS
        );

        // Close, then reopen synchronously — before the close handler's
        // async settings fetch and disk read resume. TextDocuments is
        // repopulated immediately, so the should_apply guard must veto
        // the re-sync: the reopened buffer's commit owns registration.
        handlers.did_close!({ textDocument: { uri: child_uri } });
        open_document(handlers, child_uri, CHILD_BUFFER_TEXT, 2);

        // The re-sync is invoked inside the close handler's async block
        // (after the settings fetch), so wait for the spied call.
        await wait_until(
            () => the_resync_calls.length === 1,
            'the close handler to invoke the disk re-sync',
            WAIT_TIMEOUT_MS
        );
        expect(await the_resync_calls[0].result).toBe(false);

        // Buffer-time edges survive; the disk parent was never applied.
        expect(
            captured_resolver!
                .get_backward_directive_children(parent_buffer_uri)
                .has(child_uri)
        ).toBe(true);
        expect(
            captured_resolver!
                .get_backward_directive_children(parent_disk_uri)
                .has(child_uri)
        ).toBe(false);
    }, TEST_TIMEOUT_MS);

    it('revalidates open backward-directive dependents (including ' +
        'two-hop transitive ones) after the re-sync applies', async () => {
        const child_uri = file_uri('child.do');
        const grandchild_uri = file_uri('grandchild.do');
        const greatgrandchild_uri = file_uri('greatgrandchild.do');
        const parent_buffer_uri = file_uri('parent_buffer.do');
        const handlers = await start_test_server(
            () => GLOBAL_PUBLIC_CONFIG
        );

        // Open the dependent chain (greatgrandchild -> grandchild ->
        // child via @lsp-done-by; the two-hop greatgrandchild
        // distinguishes the handler's TRANSITIVE dependent lookup from a
        // direct-children one) and the child itself (buffer header
        // disagrees with disk so the close-time re-sync APPLIES a
        // change).
        open_document(
            handlers,
            grandchild_uri,
            fs.readFileSync(
                path.join(tmp_dir, 'grandchild.do'), 'utf8'
            )
        );
        open_document(
            handlers,
            greatgrandchild_uri,
            fs.readFileSync(
                path.join(tmp_dir, 'greatgrandchild.do'), 'utf8'
            )
        );
        open_document(handlers, child_uri, CHILD_BUFFER_TEXT);
        await wait_until(
            () => captured_resolver!
                .get_backward_directive_children(child_uri)
                .has(grandchild_uri) &&
                captured_resolver!
                    .get_backward_directive_children(grandchild_uri)
                    .has(greatgrandchild_uri) &&
                captured_resolver!
                    .get_backward_directive_children(parent_buffer_uri)
                    .has(child_uri),
            'all open buffers to commit their backward registrations',
            WAIT_TIMEOUT_MS
        );

        // Barrier against a false pass: any new dependent publish after
        // did_close below must be attributable to the CLOSE-path
        // revalidation, not a straggler from the open-time validation
        // cascade. Two conditions: (1) every document's initial
        // validation cycle has published (registration above happens
        // BEFORE the publish within the same debounced cycle, so wait
        // for the publishes too), and (2) no publish at all for three
        // consecutive 150ms samples (~450ms of silence, several times
        // the 100ms debounce window), so no revalidation scheduled
        // pre-close is still in flight.
        await wait_until(
            () => published_uris.includes(grandchild_uri) &&
                published_uris.includes(greatgrandchild_uri) &&
                published_uris.includes(child_uri),
            'initial validation publishes for all open documents',
            WAIT_TIMEOUT_MS
        );
        await wait_for_publish_quiescence();

        const grandchild_publishes_before = published_uris
            .filter((my_uri) => my_uri === grandchild_uri).length;
        const greatgrandchild_publishes_before = published_uris
            .filter((my_uri) => my_uri === greatgrandchild_uri).length;

        handlers.did_close!({ textDocument: { uri: child_uri } });

        await wait_until(
            () => the_resync_calls.length === 1,
            'the close handler to invoke the disk re-sync',
            WAIT_TIMEOUT_MS
        );
        expect(await the_resync_calls[0].result).toBe(true);

        // The applied re-sync must fan out to open dependents THROUGH the
        // closed file: both the direct grandchild and the two-hop
        // greatgrandchild get revalidated and republished.
        await wait_until(
            () => published_uris
                .filter((my_uri) => my_uri === grandchild_uri).length >
                grandchild_publishes_before,
            'grandchild diagnostics republish after close re-sync',
            WAIT_TIMEOUT_MS
        );
        await wait_until(
            () => published_uris
                .filter((my_uri) => my_uri === greatgrandchild_uri)
                .length > greatgrandchild_publishes_before,
            'greatgrandchild diagnostics republish after close re-sync',
            WAIT_TIMEOUT_MS
        );
    }, TEST_TIMEOUT_MS);

    it('vetoes via the document-store guard clause alone and does not ' +
        'revalidate dependents on a vetoed re-sync', async () => {
        const child_uri = file_uri('child.do');
        const grandchild_uri = file_uri('grandchild.do');
        const parent_disk_uri = file_uri('parent_disk.do');
        const parent_buffer_uri = file_uri('parent_buffer.do');
        const handlers = await start_test_server(
            () => GLOBAL_PUBLIC_CONFIG
        );

        // An open dependent, so the vetoed branch has a live dependent it
        // must NOT revalidate.
        open_document(
            handlers,
            grandchild_uri,
            fs.readFileSync(
                path.join(tmp_dir, 'grandchild.do'), 'utf8'
            )
        );
        open_document(handlers, child_uri, CHILD_BUFFER_TEXT);
        await wait_until(
            () => captured_resolver!
                .get_backward_directive_children(child_uri)
                .has(grandchild_uri) &&
                captured_resolver!
                    .get_backward_directive_children(parent_buffer_uri)
                    .has(child_uri),
            'both open buffers to commit their backward registrations',
            WAIT_TIMEOUT_MS
        );
        await wait_until(
            () => published_uris.includes(grandchild_uri) &&
                published_uris.includes(child_uri),
            'initial validation publishes for both open documents',
            WAIT_TIMEOUT_MS
        );
        await wait_for_publish_quiescence();

        const grandchild_publishes_before = published_uris
            .filter((my_uri) => my_uri === grandchild_uri).length;

        // Hold the re-sync at its ENTRY (before its disk read) so the
        // race is deterministic: while it is held, recreate the
        // document-store entry (as a commit racing the close would)
        // WITHOUT reopening the document in TextDocuments. When
        // released, should_apply must veto on the store clause alone —
        // TextDocuments says closed, the store says a buffer commit owns
        // registration. This pins the HANDLER's guard wiring; the
        // resolver-internal ordering (guard consulted after the read, so
        // a mid-read reopen still vetoes) is pinned by the deferred-read
        // unit test in
        // tests/unit/document-store-commit-time-cross-file-effects.test.ts.
        let release_gate: (() => void) | undefined;
        resync_gate = new Promise((resolve) => {
            release_gate = resolve;
        });

        handlers.did_close!({ textDocument: { uri: child_uri } });
        await wait_until(
            () => the_resync_calls.length === 1,
            'the close handler to invoke the disk re-sync',
            WAIT_TIMEOUT_MS
        );
        await captured_document_store!.open(
            child_uri, CHILD_BUFFER_TEXT, 3
        );
        release_gate!();

        expect(await the_resync_calls[0].result).toBe(false);

        // Vetoed: buffer-time edges survive, the disk parent was never
        // applied.
        expect(
            captured_resolver!
                .get_backward_directive_children(parent_buffer_uri)
                .has(child_uri)
        ).toBe(true);
        expect(
            captured_resolver!
                .get_backward_directive_children(parent_disk_uri)
                .has(child_uri)
        ).toBe(false);

        // A vetoed re-sync must NOT fan out revalidation: after a settle
        // window several times the debounce, the open dependent has no
        // new publish.
        await wait_for_publish_quiescence();
        expect(
            published_uris
                .filter((my_uri) => my_uri === grandchild_uri).length
        ).toBe(grandchild_publishes_before);
    }, TEST_TIMEOUT_MS);

    it('retains hidden LSP models while tab ownership clears and ' +
        'restores diagnostics without another didOpen (#602)', async () => {
        const child_uri = file_uri('child.do');
        const source = 'display "unterminated\n';
        const handlers = await start_test_server(
            () => GLOBAL_PUBLIC_CONFIG,
            { sight: {}, diagnosticUris: [] }
        );
        expect(handlers.diagnostic_resources).toBeDefined();

        open_document(handlers, child_uri, source);
        await wait_until(
            () => captured_document_store?.get(child_uri)?.version === 1,
            'hidden document to commit into DocumentStore',
            WAIT_TIMEOUT_MS
        );
        await wait_for_publish_quiescence();
        expect(
            published_diagnostics.filter(
                params => params.uri === child_uri
            )
        ).toHaveLength(0);

        // Adding a tab starts a lifecycle and explicitly validates the
        // already-open model; vscode-languageclient sends no second didOpen.
        handlers.diagnostic_resources!({ diagnosticUris: [child_uri] });
        await wait_until(
            () => published_diagnostics.some(
                params => params.uri === child_uri &&
                    params.diagnostics.length > 0
            ),
            'newly owned document to publish diagnostics',
            WAIT_TIMEOUT_MS
        );

        handlers.diagnostic_resources!({ diagnosticUris: [] });
        const child_publications_after_remove = published_diagnostics
            .filter(params => params.uri === child_uri);
        expect(child_publications_after_remove.at(-1)?.diagnostics)
            .toEqual([]);
        // Removal is a diagnostic lifecycle transition, not didClose.
        expect(captured_document_store?.get(child_uri)).toBeDefined();

        const nonempty_before_readd = child_publications_after_remove
            .filter(params => params.diagnostics.length > 0).length;
        handlers.diagnostic_resources!({ diagnosticUris: [child_uri] });
        await wait_until(
            () => published_diagnostics.filter(
                params => params.uri === child_uri &&
                    params.diagnostics.length > 0
            ).length > nonempty_before_readd,
            're-added document to republish at the same version',
            WAIT_TIMEOUT_MS
        );
        expect(captured_document_store?.get(child_uri)?.version).toBe(1);
    }, TEST_TIMEOUT_MS);

    it('refreshes Gitignore symbols, callers, and diagnostics on create, ' +
        'change, and delete', async () => {
        write_discovery_files();
        const handlers = await start_test_server(() => ({}));
        await wait_for_index_run(0);
        expect_discovered_caller(true);
        const callee_uri = file_uri('analysis.do');
        open_document(handlers, callee_uri, DISCOVERED_CALLEE_TEXT);
        await wait_for_macro_diagnostic(callee_uri, false);

        const ignore_path = path.join(tmp_dir, '.gitignore');
        const the_changes = [
            { type: FileChangeType.Created, text: 'caller.do\n', included: false },
            { type: FileChangeType.Changed, text: 'other.do\n', included: true },
            { type: FileChangeType.Changed, text: 'caller.do\n', included: false },
            { type: FileChangeType.Deleted, text: undefined, included: true },
        ];
        for (const my_change of the_changes) {
            const previous_runs = the_indexing_runs.length;
            if (my_change.text === undefined) {
                fs.unlinkSync(ignore_path);
            } else {
                fs.writeFileSync(ignore_path, my_change.text);
            }
            notify_disk_change(handlers, file_uri('.gitignore'), my_change.type);
            await wait_for_index_run(previous_runs);
            expect_discovered_caller(my_change.included);
            await wait_for_macro_diagnostic(callee_uri, !my_change.included);
        }
    }, TEST_TIMEOUT_MS);

    it('refreshes Gitignore discovery for runtime and TOML setting changes',
        async () => {
        write_discovery_files();
        fs.writeFileSync(path.join(tmp_dir, '.gitignore'), 'caller.do\n');
        let respect_gitignore = true;
        const handlers = await start_test_server(() => ({
            workspace: { respectGitignore: respect_gitignore },
        }));
        await wait_for_index_run(0);
        expect_discovered_caller(false);
        const callee_uri = file_uri('analysis.do');
        open_document(handlers, callee_uri, DISCOVERED_CALLEE_TEXT);
        await wait_for_macro_diagnostic(callee_uri, true);

        let previous_runs = the_indexing_runs.length;
        respect_gitignore = false;
        handlers.did_change_configuration!({ settings: {} });
        await wait_for_index_run(previous_runs);
        expect_discovered_caller(true);
        await wait_for_macro_diagnostic(callee_uri, false);

        // Project policy wins over the still-disabled editor setting.
        previous_runs = the_indexing_runs.length;
        fs.writeFileSync(
            path.join(tmp_dir, 'sight.toml'),
            '[workspace]\nrespectGitignore = true\n'
        );
        notify_disk_change(handlers, file_uri('sight.toml'), FileChangeType.Created);
        await wait_for_index_run(previous_runs);
        expect_discovered_caller(false);
        await wait_for_macro_diagnostic(callee_uri, true);

        previous_runs = the_indexing_runs.length;
        fs.writeFileSync(
            path.join(tmp_dir, 'sight.toml'),
            '[workspace]\nrespect_gitignore = false\n'
        );
        notify_disk_change(handlers, file_uri('sight.toml'), FileChangeType.Changed);
        await wait_for_index_run(previous_runs);
        expect_discovered_caller(true);
        await wait_for_macro_diagnostic(callee_uri, false);

        respect_gitignore = true;
        handlers.did_change_configuration!({ settings: {} });
        await wait_for_publish_quiescence();
        expect_discovered_caller(true);

        previous_runs = the_indexing_runs.length;
        fs.unlinkSync(path.join(tmp_dir, 'sight.toml'));
        notify_disk_change(handlers, file_uri('sight.toml'), FileChangeType.Deleted);
        await wait_for_index_run(previous_runs);
        expect_discovered_caller(false);
        await wait_for_macro_diagnostic(callee_uri, true);
    }, TEST_TIMEOUT_MS);

    it('preserves a Gitignore-excluded open caller across watched changes, ' +
        'removes its edges on close, and restores them on reopen', async () => {
        write_discovery_files();
        fs.writeFileSync(path.join(tmp_dir, '.gitignore'), 'caller.do\n');
        const handlers = await start_test_server(() => ({}));
        await wait_for_index_run(0);
        expect_discovered_caller(false);
        const caller_uri = file_uri('caller.do');
        const callee_uri = file_uri('analysis.do');
        open_document(handlers, callee_uri, DISCOVERED_CALLEE_TEXT);
        open_document(handlers, caller_uri, DISCOVERED_CALLER_TEXT);
        await wait_until(
            () => captured_graph!.get_callees(caller_uri).has(callee_uri),
            'an explicitly opened ignored caller to register its callee',
            WAIT_TIMEOUT_MS
        );
        await wait_for_macro_diagnostic(callee_uri, false);

        notify_disk_change(handlers, caller_uri, FileChangeType.Changed);
        expect(captured_graph!.get_callees(caller_uri).has(callee_uri)).toBe(true);
        expect(captured_indexer!.has_indexed_file(caller_uri)).toBe(false);

        const previous_runs = the_indexing_runs.length;
        fs.writeFileSync(
            path.join(tmp_dir, '.gitignore'), 'caller.do\n# Saved again\n'
        );
        notify_disk_change(handlers, file_uri('.gitignore'), FileChangeType.Changed);
        await wait_for_index_run(previous_runs);
        await wait_until(
            () => captured_graph!.get_callees(caller_uri).has(callee_uri),
            'the ignored open caller to register after the workspace refresh',
            WAIT_TIMEOUT_MS
        );
        await wait_for_macro_diagnostic(callee_uri, false);

        handlers.did_close!({ textDocument: { uri: caller_uri } });
        expect(captured_graph!.get_callees(caller_uri).size).toBe(0);
        await wait_for_macro_diagnostic(callee_uri, true);
        expect(captured_graph!.get_callees(caller_uri).size).toBe(0);

        open_document(handlers, caller_uri, DISCOVERED_CALLER_TEXT, 2);
        await wait_until(
            () => captured_graph!.get_callees(caller_uri).has(callee_uri),
            'reopening the ignored caller to restore its graph edges',
            WAIT_TIMEOUT_MS
        );
        await wait_for_macro_diagnostic(callee_uri, false);

        let release_resync: (() => void) | undefined;
        resync_gate = new Promise<void>(resolve => { release_resync = resolve; });
        try {
            handlers.did_close!({ textDocument: { uri: caller_uri } });
            open_document(handlers, caller_uri, DISCOVERED_CALLER_TEXT, 3);
            await wait_until(
                () => captured_document_store!.get(caller_uri)?.version === 3 &&
                    captured_graph!.get_callees(caller_uri).has(callee_uri),
                'a quick reopen to restore the ignored caller',
                WAIT_TIMEOUT_MS
            );
            release_resync?.();
            await Promise.all(the_resync_calls.map(my_call => my_call.result));
            await wait_for_publish_quiescence();
            expect(captured_graph!.get_callees(caller_uri).has(callee_uri))
                .toBe(true);
            expect(captured_indexer!.has_indexed_file(caller_uri)).toBe(false);
        } finally {
            release_resync?.();
        }
    }, TEST_TIMEOUT_MS);

    it('does not let delayed settings restore a caller after newer Gitignore ' +
        'and settings events', async () => {
        write_discovery_files();
        let delayed_settings: Promise<unknown> | undefined;
        let delayed_fetch_started = false;
        const handlers = await start_test_server(scope_uri => {
            if (scope_uri === undefined && delayed_settings) {
                delayed_fetch_started = true;
                return delayed_settings;
            }
            return { workspace: { respectGitignore: true } };
        });
        await wait_for_index_run(0);
        expect_discovered_caller(true);

        let release_settings: (() => void) | undefined;
        delayed_settings = new Promise<void>(resolve => {
            release_settings = resolve;
        }).then(() => ({ workspace: { respectGitignore: false } }));
        try {
            handlers.did_change_configuration!({ settings: {} });
            await wait_until(
                () => delayed_fetch_started,
                'the old runtime settings fetch to reach its gate',
                WAIT_TIMEOUT_MS
            );

            fs.writeFileSync(path.join(tmp_dir, '.gitignore'), 'caller.do\n');
            const previous_runs = the_indexing_runs.length;
            notify_disk_change(
                handlers, file_uri('.gitignore'), FileChangeType.Created
            );
            delayed_settings = undefined;
            handlers.did_change_configuration!({ settings: {} });
            await wait_for_index_run(previous_runs);
            expect_discovered_caller(false);

            const runs_before_release = the_indexing_runs.length;
            release_settings?.();
            await wait_for_publish_quiescence();
            expect_discovered_caller(false);
            expect(the_indexing_runs).toHaveLength(runs_before_release);
        } finally {
            release_settings?.();
        }
    }, TEST_TIMEOUT_MS);

    it('registers Gitignore ancestor watchers and refreshes when an absent ' +
        'ancestor ignore file appears', async () => {
        fs.mkdirSync(path.join(tmp_dir, '.git'));
        const workspace_root = path.join(tmp_dir, 'project', 'stata');
        write_discovery_files(workspace_root);
        const handlers = await start_test_server(
            () => ({}), undefined,
            { workspace_root, dynamic_watchers: true }
        );
        await wait_for_index_run(0);
        expect_discovered_caller(true, workspace_root);

        const active_watchers = the_watch_registrations
            .filter(my_registration => !my_registration.disposed)
            .flatMap(my_registration => my_registration.watchers);
        for (const my_directory of [tmp_dir, path.join(tmp_dir, 'project')]) {
            expect(active_watchers).toContainEqual({
                globPattern: {
                    baseUri: URI.file(my_directory).toString(),
                    pattern: '.gitignore',
                },
                kind: 7,
            });
        }
        expect(active_watchers).toContainEqual({
            globPattern: {
                baseUri: URI.file(workspace_root).toString(),
                pattern: '**/.gitignore',
            },
            kind: 7,
        });

        let previous_runs = the_indexing_runs.length;
        fs.writeFileSync(
            path.join(tmp_dir, '.gitignore'), 'project/stata/caller.do\n'
        );
        notify_disk_change(handlers, file_uri('.gitignore'), FileChangeType.Created);
        await wait_for_index_run(previous_runs);
        expect_discovered_caller(false, workspace_root);

        previous_runs = the_indexing_runs.length;
        fs.unlinkSync(path.join(tmp_dir, '.gitignore'));
        notify_disk_change(handlers, file_uri('.gitignore'), FileChangeType.Deleted);
        await wait_for_index_run(previous_runs);
        expect_discovered_caller(true, workspace_root);
    }, TEST_TIMEOUT_MS);

    it('cancels hidden analysis that is in flight during shutdown', async () => {
        const child_uri = file_uri('child.do');
        const handlers = await start_test_server(
            () => GLOBAL_PUBLIC_CONFIG,
            { sight: {}, diagnosticUris: [] }
        );
        let release_scope: (() => void) | undefined;
        scope_resolution_gate = new Promise<void>(resolve => {
            release_scope = resolve;
        });

        try {
            open_document(handlers, child_uri, 'display 1\n');
            await wait_until(
                () => captured_scope_cancellation_token !== undefined,
                'hidden analysis to enter the working-directory probe',
                WAIT_TIMEOUT_MS
            );

            const shutdown = Promise.resolve(handlers.shutdown?.());
            expect(captured_scope_cancellation_token?.isCancellationRequested)
                .toBe(true);
            release_scope?.();
            await shutdown;
            active_handlers = undefined;
        } finally {
            release_scope?.();
        }
    }, TEST_TIMEOUT_MS);
});

/**
 * Handler-level integration test for the onDidClose disk re-sync wiring
 * (issue #287, deferred from #184's review).
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
 *      file via backward directives are revalidated (diagnostics are
 *      republished for them).
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
} from 'vscode-languageserver/node';
import { create_server } from '../../src/server-factory';
import { ScopeResolver } from '../../src/scope-resolver';
import type { ScopeResolverConfig } from '../../src/types';

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
let the_resync_calls: ResyncCall[] = [];
let workspace_roots_seen: string[] = [];

const original_set_dependency_graph =
    ScopeResolver.prototype.set_dependency_graph;
const original_set_workspace_roots =
    ScopeResolver.prototype.set_workspace_roots;
const original_resync =
    ScopeResolver.prototype.resync_backward_directive_dependencies_from_disk;

function install_resolver_spies(): void {
    captured_resolver = undefined;
    the_resync_calls = [];
    workspace_roots_seen = [];
    ScopeResolver.prototype.set_dependency_graph = function (
        ...args: Parameters<typeof original_set_dependency_graph>
    ) {
        captured_resolver = this;
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
            const result = original_resync.apply(this, args);
            the_resync_calls.push({
                uri: args[0],
                config: args[1],
                result,
            });
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
        onDidChangeConfiguration: capture_nothing,
        onDidChangeWatchedFiles: capture_nothing,
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
            register: () => Promise.resolve(noop_disposable()),
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

async function wait_until(
    predicate: () => boolean,
    description: string,
    timeout_ms = 5000,
    interval_ms = 20
): Promise<void> {
    const deadline_ms = Date.now() + timeout_ms;
    while (!predicate()) {
        if (Date.now() > deadline_ms) {
            throw new Error(`Timed out waiting for: ${description}`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval_ms));
    }
}

let tmp_dir: string;
let published_uris: string[] = [];
let active_handlers: CapturedHandlers | undefined;

// Disable workspace indexing so no scan-time dependency-graph edges or
// timers interfere; only explicit @lsp-done-by directives are in play.
const GLOBAL_PUBLIC_CONFIG = { crossFile: { indexWorkspace: false } };

async function start_test_server(
    get_scoped_config: (scope_uri: string | undefined) => unknown
): Promise<CapturedHandlers> {
    const workspace_folder_uri = URI.file(tmp_dir).toString();
    const { connection, handlers } = make_stub_connection({
        workspace_folder_uri,
        get_scoped_config,
        published_uris,
    });
    await create_server({ transport: 'stdio', quiet: true, connection });
    expect(handlers.initialize).toBeDefined();
    expect(handlers.initialized).toBeDefined();
    expect(handlers.did_open).toBeDefined();
    expect(handlers.did_close).toBeDefined();
    handlers.initialize!({
        processId: null,
        rootUri: workspace_folder_uri,
        capabilities: { workspace: { configuration: true } },
        workspaceFolders: null,
    } as InitializeParams);
    handlers.initialized!();
    // onInitialized creates the providers synchronously, then finishes
    // workspace setup asynchronously (getWorkspaceFolders -> settings ->
    // configure). Wait for both before opening documents.
    await wait_until(
        () => captured_resolver !== undefined &&
            workspace_roots_seen.includes(tmp_dir),
        'server initialization to reach the workspace-roots refresh'
    );
    active_handlers = handlers;
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

describe('server onDidClose disk re-sync wiring (#287)', () => {
    beforeEach(() => {
        install_resolver_spies();
        published_uris = [];
        active_handlers = undefined;
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
            fs.rmSync(tmp_dir, { recursive: true, force: true });
        }
    });

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
            'buffer-based registration of child under parent_buffer'
        );

        handlers.did_close!({ textDocument: { uri: child_uri } });

        // The close-time re-sync reads DISK content and re-registers the
        // on-disk parent, clearing the buffer-time edge.
        await wait_until(
            () => captured_resolver!
                .get_backward_directive_children(parent_disk_uri)
                .has(child_uri),
            'disk re-sync to register child under parent_disk'
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
    });

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
            'buffer-based registration of child under parent_buffer'
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
            'the close handler to invoke the disk re-sync'
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
    });

    it('revalidates open backward-directive dependents after the re-sync ' +
        'applies', async () => {
        const child_uri = file_uri('child.do');
        const grandchild_uri = file_uri('grandchild.do');
        const parent_buffer_uri = file_uri('parent_buffer.do');
        const handlers = await start_test_server(
            () => GLOBAL_PUBLIC_CONFIG
        );

        // Open the grandchild (depends on child.do via @lsp-done-by) and
        // the child (buffer header disagrees with disk so the close-time
        // re-sync APPLIES a change).
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
            'both open buffers to commit their backward registrations'
        );

        // Let in-flight validation publishes settle so any new grandchild
        // publish below is attributable to the close-path revalidation.
        let last_count = -1;
        await wait_until(() => {
            const current_count = published_uris.length;
            const stable = current_count === last_count;
            last_count = current_count;
            return stable;
        }, 'diagnostic publishes to go quiescent', 5000, 150);

        const grandchild_publishes_before = published_uris
            .filter((my_uri) => my_uri === grandchild_uri).length;

        handlers.did_close!({ textDocument: { uri: child_uri } });

        await wait_until(
            () => the_resync_calls.length === 1,
            'the close handler to invoke the disk re-sync'
        );
        expect(await the_resync_calls[0].result).toBe(true);

        // The applied re-sync must fan out to open dependents THROUGH the
        // closed file: grandchild gets revalidated and republished.
        await wait_until(
            () => published_uris
                .filter((my_uri) => my_uri === grandchild_uri).length >
                grandchild_publishes_before,
            'grandchild diagnostics republish after close re-sync'
        );
    });
});

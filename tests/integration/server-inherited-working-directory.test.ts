/**
 * The language server does not settle inherited working directories in
 * the background (only `sight check` and `sight graph` settle them), so
 * opening a file whose callers disagree on its directory publishes its
 * diagnostics and then stays quiet.
 *
 * Layout, after the review that found a settle-and-revalidate loop: in
 * both w1/ and w2/, a.do runs b.do. w1/b.do runs b.do and w2/b.do runs
 * a.do. z1.do sets `sight: cd w1` and runs ../w2/b.do; z2.do sets
 * `sight: cd w2` and runs a.do. Which b.do w2/a.do reaches depends on
 * the directory it inherits, which depends on which b.do calls it.
 *
 * The real server runs behind a stub connection that captures its
 * handlers and the diagnostics it publishes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import type {
    Connection,
    InitializeParams,
    DidOpenTextDocumentParams,
    PublishDiagnosticsParams,
} from 'vscode-languageserver/node';
import { create_server } from '../../src/server-factory';
import { WorkspaceIndexer } from '../../src/indexer';
import { Logger } from '../../src/utils/logger';
import { wait_until } from '../wait-until';

const TEST_TIMEOUT_MS = 30000;
const WAIT_TIMEOUT_MS = 10000;

/** Longer than every debounce between a change and its publication. */
const QUIET_PERIOD_MS = 2000;

interface CapturedHandlers {
    initialize?: (params: InitializeParams) => unknown;
    initialized?: () => void;
    did_open?: (params: DidOpenTextDocumentParams) => void;
    shutdown?: () => unknown;
}

let tmp_dir: string;
let handlers: CapturedHandlers;
let published: PublishDiagnosticsParams[] = [];
let the_indexing_runs: Promise<void>[] = [];

const original_initialize = WorkspaceIndexer.prototype.initialize;

function noop_disposable(): { dispose: () => void } {
    return { dispose: () => { } };
}

/** A connection that records handlers and published diagnostics. */
function make_stub_connection(workspace_uri: string): Connection {
    const capture_nothing = () => noop_disposable();
    const stub = {
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
        onNotification: capture_nothing,
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
            published.push(params);
        },
        onDidOpenTextDocument: (handler: CapturedHandlers['did_open']) => {
            handlers.did_open = handler;
            return noop_disposable();
        },
        onDidChangeTextDocument: capture_nothing,
        onDidCloseTextDocument: capture_nothing,
        onWillSaveTextDocument: capture_nothing,
        onWillSaveTextDocumentWaitUntil: capture_nothing,
        onDidSaveTextDocument: capture_nothing,
        client: {
            register: () => Promise.resolve(noop_disposable()),
        },
        workspace: {
            getConfiguration: () => Promise.resolve({}),
            getWorkspaceFolders: () => Promise.resolve([
                { uri: workspace_uri, name: 'test-ws' },
            ]),
            onDidChangeWorkspaceFolders: capture_nothing,
        },
        listen: () => { },
    };
    return stub as unknown as Connection;
}

function file_uri(name: string): string {
    return URI.file(path.join(tmp_dir, name)).toString();
}

function write_file(name: string, text: string): void {
    const my_path = path.join(tmp_dir, name);
    fs.mkdirSync(path.dirname(my_path), { recursive: true });
    fs.writeFileSync(my_path, text);
}

/** Start the server and wait for its workspace scan to finish. */
async function start_server(): Promise<void> {
    const workspace_uri = URI.file(tmp_dir).toString();
    await create_server({
        transport: 'stdio',
        quiet: true,
        connection: make_stub_connection(workspace_uri),
    });
    handlers.initialize!({
        processId: null,
        rootUri: workspace_uri,
        capabilities: { workspace: { configuration: true } },
        workspaceFolders: null,
    } as InitializeParams);
    handlers.initialized!();
    await wait_until(
        () => the_indexing_runs.length > 0,
        'the workspace scan to start',
        WAIT_TIMEOUT_MS
    );
    await the_indexing_runs.at(-1);
}

function open_document(name: string): void {
    const uri = file_uri(name);
    handlers.did_open!({
        textDocument: {
            uri,
            languageId: 'stata',
            version: 1,
            text: fs.readFileSync(URI.parse(uri).fsPath, 'utf8'),
        },
    });
}

describe('server — working directory inherited through do-chains', () => {
    beforeEach(() => {
        handlers = {};
        published = [];
        the_indexing_runs = [];
        WorkspaceIndexer.prototype.initialize = function (
            ...args: Parameters<typeof original_initialize>
        ) {
            const result = original_initialize.apply(this, args);
            the_indexing_runs.push(result);
            return result;
        };
        tmp_dir = fs.realpathSync(fs.mkdtempSync(
            path.join(os.tmpdir(), 'server-inherit-wd-')));
        write_file('w1/a.do', 'do b.do\n');
        write_file('w2/a.do', 'do b.do\n');
        write_file('w1/b.do', 'do b.do\n');
        write_file('w2/b.do', 'do a.do\n');
        write_file('z1.do', '// sight: cd w1\ndo ../w2/b.do\n');
        write_file('z2.do', '// sight: cd w2\ndo a.do\n');
    });

    afterEach(async () => {
        try {
            await handlers.shutdown?.();
        } finally {
            WorkspaceIndexer.prototype.initialize = original_initialize;
            Logger.initialize({
                verbosity: 'info',
                channel: (message: string) => console.debug(message),
            });
            fs.rmSync(tmp_dir, { recursive: true, force: true });
        }
    });

    it('publishes for a file in a cycle across directories, then stops', async () => {
        await start_server();
        open_document('w2/a.do');
        await wait_until(
            () => published.some(my_params =>
                my_params.uri === file_uri('w2/a.do')),
            'w2/a.do to be published',
            WAIT_TIMEOUT_MS,
        );
        // Let any follow-up work run, then require silence.
        await Bun.sleep(QUIET_PERIOD_MS);
        const count = published.length;
        await Bun.sleep(QUIET_PERIOD_MS);
        expect(published.length).toBe(count);
        expect(count).toBeLessThanOrEqual(2);
    }, TEST_TIMEOUT_MS);
});

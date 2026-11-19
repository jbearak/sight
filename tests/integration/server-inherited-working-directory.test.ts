/**
 * The language server gives a closed file's callees the working
 * directory inherited through any number of `do` levels, and refreshes
 * an open grandchild's diagnostics when the top file's `sight: cd`
 * changes, whether in an open buffer or on disk.
 *
 * Layout: main.do sets `sight: cd "work"` and runs jobs/a.do, which
 * runs jobs/b.do, which runs c.do. Run from main.do, every call
 * resolves in work/ and c.do is work/c.do. With `cd "other"`, main.do
 * reaches no a.do, so b.do has no caller and c.do is missing.
 *
 * The real server runs behind a stub connection that captures its
 * handlers and the diagnostics it publishes.
 */

import { describe, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import type {
    Connection,
    InitializeParams,
    DidOpenTextDocumentParams,
    DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams,
    PublishDiagnosticsParams,
} from 'vscode-languageserver/node';
import { FileChangeType } from 'vscode-languageserver/node';
import { create_server } from '../../src/server-factory';
import { WorkspaceIndexer } from '../../src/indexer';
import { Logger } from '../../src/utils/logger';
import { wait_until } from '../wait-until';

const TEST_TIMEOUT_MS = 30000;
const WAIT_TIMEOUT_MS = 10000;

const MAIN_IN_WORK = '// sight: cd "work"\ndo jobs/a.do\n';
const MAIN_IN_OTHER = '// sight: cd "other"\ndo jobs/a.do\n';

interface CapturedHandlers {
    initialize?: (params: InitializeParams) => unknown;
    initialized?: () => void;
    did_open?: (params: DidOpenTextDocumentParams) => void;
    did_change?: (params: DidChangeTextDocumentParams) => void;
    did_change_watched_files?: (params: DidChangeWatchedFilesParams) => void;
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
        onDidChangeWatchedFiles: (
            handler: CapturedHandlers['did_change_watched_files']
        ) => {
            handlers.did_change_watched_files = handler;
            return noop_disposable();
        },
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
        onDidChangeTextDocument: (
            handler: CapturedHandlers['did_change']
        ) => {
            handlers.did_change = handler;
            return noop_disposable();
        },
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

/** Wait until b.do's latest diagnostics do or do not miss c.do. */
async function wait_for_missing_c(missing: boolean): Promise<void> {
    const b_uri = file_uri('work/jobs/b.do');
    await wait_until(() => {
        const latest = published.filter(my_params =>
            my_params.uri === b_uri).at(-1);
        if (!latest) return false;
        const has_missing = latest.diagnostics.some(my_diagnostic =>
            my_diagnostic.code === 'CROSS_FILE_MISSING_FILE' &&
            my_diagnostic.message.includes('c.do'));
        return has_missing === missing;
    }, `b.do to ${missing ? 'miss' : 'find'} c.do`, WAIT_TIMEOUT_MS);
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
        write_file('main.do', MAIN_IN_WORK);
        write_file('work/jobs/a.do', 'do jobs/b.do\n');
        write_file('work/jobs/b.do', 'do c.do\n');
        write_file('work/c.do', '');
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

    it('refreshes the grandchild when an open top file changes its cd', async () => {
        await start_server();
        open_document('main.do');
        open_document('work/jobs/b.do');
        // a.do stays closed: its calls come from the workspace index.
        await wait_for_missing_c(false);

        handlers.did_change!({
            textDocument: { uri: file_uri('main.do'), version: 2 },
            contentChanges: [{ text: MAIN_IN_OTHER }],
        });
        await wait_for_missing_c(true);

        handlers.did_change!({
            textDocument: { uri: file_uri('main.do'), version: 3 },
            contentChanges: [{ text: MAIN_IN_WORK }],
        });
        await wait_for_missing_c(false);
    }, TEST_TIMEOUT_MS);

    it('settles closed files for an unsaved cd in an open buffer', async () => {
        // On disk no file has a directory, so nothing inherits one.
        write_file('main.do', 'do jobs/a.do\n');
        await start_server();
        open_document('main.do');
        open_document('work/jobs/b.do');
        await wait_for_missing_c(true);

        handlers.did_change!({
            textDocument: { uri: file_uri('main.do'), version: 2 },
            contentChanges: [{ text: MAIN_IN_WORK }],
        });
        await wait_for_missing_c(false);
    }, TEST_TIMEOUT_MS);

    it('refreshes the grandchild when a closed top file changes on disk', async () => {
        await start_server();
        open_document('work/jobs/b.do');
        await wait_for_missing_c(false);

        write_file('main.do', MAIN_IN_OTHER);
        handlers.did_change_watched_files!({
            changes: [{ uri: file_uri('main.do'), type: FileChangeType.Changed }],
        });
        await wait_for_missing_c(true);

        write_file('main.do', MAIN_IN_WORK);
        handlers.did_change_watched_files!({
            changes: [{ uri: file_uri('main.do'), type: FileChangeType.Changed }],
        });
        await wait_for_missing_c(false);
    }, TEST_TIMEOUT_MS);
});

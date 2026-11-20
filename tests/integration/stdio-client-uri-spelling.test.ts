import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { URI } from 'vscode-uri';

/**
 * A client that spells `file:` URIs as Node's `pathToFileURL` does
 * (Neovim's form: a bare `+`, and `C:` on Windows) gets the same
 * diagnostics as one that spells them as VS Code does, under its own
 * spelling. Driven through the real stdio server, because the rewrite
 * sits in the transport.
 *
 * The fixture directory has a `+` in its name, which the two spellings
 * encode differently on every platform.
 */

const REPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '../..'
);
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'cli.ts');
const WAIT_MS = 20000;
const TEST_TIMEOUT_MS = 60000;
const STALE_MESSAGE = '$fromparent is not defined';

interface Published {
    uri: string;
    messages: string[];
}

interface Client {
    proc: ChildProcessWithoutNullStreams;
    published: Published[];
    send(message: unknown): void;
    /** The first publication from index `from` on that matches. */
    wait_for(
        from: number, matches: (my_published: Published) => boolean
    ): Promise<Published>;
    /** Send a request and wait for its result. */
    request(method: string, params?: unknown): Promise<unknown>;
    exit_code: Promise<number | null>;
}

function start_client(): Client {
    const proc = spawn(process.execPath, [CLI_ENTRY, '--stdio'], {
        cwd: REPO_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const published: Published[] = [];
    const the_waiters: Array<() => void> = [];
    const the_pending = new Map<number, (result: unknown) => void>();
    let next_id = 1;
    let buffer: Buffer = Buffer.alloc(0);

    const send = (message: unknown): void => {
        const body = JSON.stringify(message);
        proc.stdin.write(
            `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
        );
    };
    const handle = (message: Record<string, unknown>): void => {
        const params = message['params'] as Record<string, unknown>;
        if (message['method'] === 'textDocument/publishDiagnostics') {
            const diagnostics = params['diagnostics'] as
                Array<{ message: string }>;
            published.push({
                uri: params['uri'] as string,
                messages: diagnostics.map(my_item => my_item.message),
            });
            for (const my_waiter of the_waiters.splice(0)) {
                my_waiter();
            }
        } else if (
            message['id'] !== undefined
            && typeof message['method'] === 'string'
        ) {
            // A request from the server: answer with nothing set.
            const items = params?.['items'];
            send({
                jsonrpc: '2.0',
                id: message['id'],
                result: Array.isArray(items) ? items.map(() => null) : null,
            });
        } else if (typeof message['id'] === 'number') {
            the_pending.get(message['id'])?.(message['result']);
            the_pending.delete(message['id']);
        }
    };
    proc.stdout.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
            const header_end = buffer.indexOf('\r\n\r\n');
            if (header_end < 0) {
                return;
            }
            const header = buffer.subarray(0, header_end).toString('utf8');
            const length = Number(/Content-Length: (\d+)/.exec(header)?.[1]);
            const body_start = header_end + 4;
            if (buffer.length < body_start + length) {
                return;
            }
            const body = buffer.subarray(body_start, body_start + length);
            buffer = buffer.subarray(body_start + length);
            handle(JSON.parse(body.toString('utf8')));
        }
    });
    proc.stderr.resume();

    const wait_for = async (
        from: number, matches: (my_published: Published) => boolean
    ): Promise<Published> => {
        const deadline = Date.now() + WAIT_MS;
        for (;;) {
            const found = published.slice(from).find(matches);
            if (found) {
                return found;
            }
            const remaining_ms = deadline - Date.now();
            if (remaining_ms <= 0) {
                throw new Error(
                    'No matching publication. Got: '
                    + JSON.stringify(published.slice(from))
                );
            }
            await new Promise<void>(resolve => {
                const timer = setTimeout(resolve, remaining_ms);
                the_waiters.push(() => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
    };
    const request = (method: string, params?: unknown): Promise<unknown> => {
        const id = next_id++;
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`No reply to ${method}`)), WAIT_MS
            );
            the_pending.set(id, result => {
                clearTimeout(timer);
                resolve(result);
            });
            send({ jsonrpc: '2.0', id, method, params });
        });
    };
    const exit_code = new Promise<number | null>(resolve => {
        proc.on('exit', code => resolve(code));
    });
    return { proc, published, send, wait_for, request, exit_code };
}

describe('stdio server: a client\'s own file URI spelling', () => {
    let temp_dir: string;
    let client: Client | undefined;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(
            path.join(fs.realpathSync(os.tmpdir()), 'uri+spelling-')
        );
    });
    afterEach(() => {
        client?.proc.kill();
        client = undefined;
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const SPELLINGS: Array<[string, (file_path: string) => string]> = [
        ['VS Code', file_path => URI.file(file_path).toString()],
        ['Node pathToFileURL', file_path => pathToFileURL(file_path).href],
    ];

    for (const [my_name, to_uri] of SPELLINGS) {
        it(`refreshes a caller's callee and answers in the client's spelling (${my_name})`, async () => {
            const main_path = path.join(temp_dir, 'main.do');
            const child_path = path.join(temp_dir, 'child.do');
            const main_text = 'do child.do\n';
            const child_text = 'display "$fromparent"\n';
            fs.writeFileSync(main_path, main_text);
            fs.writeFileSync(child_path, child_text);
            const main_uri = to_uri(main_path);
            const child_uri = to_uri(child_path);
            const root_uri = to_uri(temp_dir);

            client = start_client();
            const my_client = client;
            await my_client.request('initialize', {
                processId: process.pid,
                rootUri: root_uri,
                workspaceFolders: [{ uri: root_uri, name: 'p' }],
                capabilities: {},
            });
            my_client.send({
                jsonrpc: '2.0', method: 'initialized', params: {},
            });
            my_client.send({
                jsonrpc: '2.0', method: 'textDocument/didOpen',
                params: { textDocument: {
                    uri: child_uri, languageId: 'stata', version: 1,
                    text: child_text,
                } },
            });
            const first = await my_client.wait_for(
                0, my_published => my_published.uri === child_uri
            );
            expect(first.messages).toContain(STALE_MESSAGE);

            my_client.send({
                jsonrpc: '2.0', method: 'textDocument/didOpen',
                params: { textDocument: {
                    uri: main_uri, languageId: 'stata', version: 1,
                    text: main_text,
                } },
            });
            await my_client.wait_for(
                0, my_published => my_published.uri === main_uri
            );
            const before_edit = my_client.published.length;
            my_client.send({
                jsonrpc: '2.0', method: 'textDocument/didChange',
                params: {
                    textDocument: { uri: main_uri, version: 2 },
                    contentChanges: [{
                        text: 'global fromparent 1\ndo child.do\n',
                    }],
                },
            });
            // The edit to the caller clears the callee's warning.
            const refreshed = await my_client.wait_for(
                before_edit,
                my_published => my_published.uri === child_uri
                    && !my_published.messages.includes(STALE_MESSAGE)
            );
            expect(refreshed.messages).not.toContain(STALE_MESSAGE);

            // A definition in a document the client has open comes
            // back under the client's spelling of it.
            const definition = await my_client.request(
                'textDocument/definition',
                {
                    textDocument: { uri: main_uri },
                    position: { line: 1, character: 5 },
                }
            );
            expect(JSON.stringify(definition))
                .toContain(JSON.stringify(child_uri));

            // The publish that clears a closed document's diagnostics
            // uses the spelling it was opened with.
            const before_close = my_client.published.length;
            my_client.send({
                jsonrpc: '2.0', method: 'textDocument/didClose',
                params: { textDocument: { uri: main_uri } },
            });
            const cleared = await my_client.wait_for(
                before_close,
                my_published => my_published.uri === main_uri
            );
            expect(cleared.messages).toEqual([]);

            // Every publication used a spelling the client sent.
            for (const my_published of my_client.published) {
                expect([main_uri, child_uri]).toContain(my_published.uri);
            }

            // Closing the input after a shutdown ends the server cleanly.
            await my_client.request('shutdown');
            my_client.proc.stdin.end();
            expect(await my_client.exit_code).toBe(0);
        }, TEST_TIMEOUT_MS);
    }
    it('exits with status 1 when the input closes without a shutdown', async () => {
        client = start_client();
        await client.request('initialize', {
            processId: process.pid, rootUri: null, capabilities: {},
        });
        client.proc.stdin.end();
        expect(await client.exit_code).toBe(1);
    }, TEST_TIMEOUT_MS);
});

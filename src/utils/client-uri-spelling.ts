/**
 * One spelling for the `file:` URIs a client sends.
 *
 * The same file has several valid URI strings: VS Code sends
 * `file:///c%3A/proj/a%2Bb/x.do`, while Neovim and anything built on
 * Node's `pathToFileURL` send `file:///C:/proj/a+b/x.do`. The server
 * keys its documents by the client's string and its dependency graph,
 * index and related-file lists by `URI.file(path).toString()` (VS
 * Code's spelling), so a client with another spelling got stale
 * diagnostics in files that depend on the one being edited.
 *
 * Every incoming message is rewritten here, before any handler sees
 * it, so the server only ever holds VS Code's spelling. Every outgoing
 * message is rewritten too: a URI the client spelled its own way when
 * it opened the document goes back in that spelling (diagnostics, a
 * definition in the open file, a configuration scope), for clients
 * that match URIs to buffers by string. A URI the client never named
 * keeps the server's spelling.
 *
 * Incoming, only the fields listed below are rewritten, never a string
 * that merely looks like a URI: document text and settings pass
 * through.
 */

import { URI } from 'vscode-uri';

const FILE_SCHEME_PATTERN = /^file:/i;
const LOCAL_HOST = 'localhost';

/**
 * `uri` in the spelling `URI.file(path).toString()` gives. `FILE:` and
 * a `localhost` authority name the same local file (RFC 8089).
 */
export function canonical_file_uri(uri: string): string {
    if (!FILE_SCHEME_PATTERN.test(uri)) {
        return uri;
    }
    try {
        const my_uri = URI.parse(uri);
        return my_uri.with({
            scheme: 'file',
            authority: my_uri.authority.toLowerCase() === LOCAL_HOST
                ? ''
                : my_uri.authority,
        }).toString();
    } catch {
        return uri;
    }
}

type JsonRecord = Record<string, unknown>;

function as_record(value: unknown): JsonRecord | undefined {
    return typeof value === 'object' && value !== null
        && !Array.isArray(value)
        ? value as JsonRecord
        : undefined;
}

function as_records(value: unknown): JsonRecord[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const the_records: JsonRecord[] = [];
    for (const my_item of value) {
        const my_record = as_record(my_item);
        if (my_record) {
            the_records.push(my_record);
        }
    }
    return the_records;
}

function rewrite_field(record: JsonRecord | undefined, key: string): void {
    const my_value = record?.[key];
    if (record && typeof my_value === 'string') {
        record[key] = canonical_file_uri(my_value);
    }
}

function rewrite_uri_list(record: JsonRecord | undefined, key: string): void {
    const my_list = record?.[key];
    if (!record || !Array.isArray(my_list)) {
        return;
    }
    record[key] = my_list.map((my_item: unknown) =>
        typeof my_item === 'string' ? canonical_file_uri(my_item) : my_item
    );
}

/**
 * Rewrite, in place, every URI field of a request's or notification's
 * `params` that the server reads:
 *
 * - `textDocument.uri` (document sync and every document request);
 * - `uri` (`sight/getWorkingDirectory`);
 * - `rootUri` and `workspaceFolders[].uri` (`initialize`);
 * - `event.added[].uri`, `event.removed[].uri` (workspace folders);
 * - `changes[].uri` (watched files);
 * - `diagnosticUris[]`, here and under `initializationOptions`.
 *
 * The one response that carries URIs, the client's answer to
 * `workspace/workspaceFolders`, is rewritten by `ClientUriSpelling`.
 */
export function canonicalise_params_uris(params: unknown): void {
    const my_params = as_record(params);
    if (!my_params) {
        return;
    }
    rewrite_field(as_record(my_params['textDocument']), 'uri');
    rewrite_field(my_params, 'uri');
    rewrite_field(my_params, 'rootUri');
    for (const my_folder of as_records(my_params['workspaceFolders'])) {
        rewrite_field(my_folder, 'uri');
    }
    const my_event = as_record(my_params['event']);
    for (const my_key of ['added', 'removed']) {
        for (const my_folder of as_records(my_event?.[my_key])) {
            rewrite_field(my_folder, 'uri');
        }
    }
    for (const my_change of as_records(my_params['changes'])) {
        rewrite_field(my_change, 'uri');
    }
    rewrite_uri_list(my_params, 'diagnosticUris');
    rewrite_uri_list(
        as_record(my_params['initializationOptions']), 'diagnosticUris'
    );
}

const DID_OPEN_METHOD = 'textDocument/didOpen';
const DID_CLOSE_METHOD = 'textDocument/didClose';
const WORKSPACE_FOLDERS_METHOD = 'workspace/workspaceFolders';
/** Outgoing fields that hold a URI, at any depth. */
const OUTGOING_URI_KEYS = new Set(['uri', 'targetUri', 'scopeUri']);
/**
 * An outgoing field whose contents are the server's own and come back
 * unchanged (a completion item's `data`); never rewritten.
 */
const OPAQUE_KEY = 'data';
/**
 * How many closed documents' spellings are kept. A document's last
 * diagnostics are cleared after it closes, so its spelling must
 * outlive the close.
 */
export const CLOSED_SPELLING_LIMIT = 1000;

/**
 * Rewrites incoming and outgoing messages and remembers the spelling
 * the client opened each document with, when that differs.
 */
export class ClientUriSpelling {
    /** Canonical URI -> the client's spelling, open documents. */
    private readonly the_open_spellings = new Map<string, string>();
    /** The same for closed documents, oldest close first. */
    private readonly the_closed_spellings = new Map<string, string>();
    /** Ids of the server's unanswered workspace-folder requests. */
    private readonly the_folder_request_ids = new Set<number | string>();

    /** Rewrite one incoming JSON-RPC message in place. */
    handle_incoming(message: unknown): void {
        const my_message = as_record(message);
        const my_method = my_message?.['method'];
        if (!my_message) {
            return;
        }
        if (typeof my_method !== 'string') {
            // A response to one of the server's own requests. Only
            // the workspace folders carry URIs.
            const my_id = my_message['id'];
            if (
                (typeof my_id === 'number' || typeof my_id === 'string')
                && this.the_folder_request_ids.delete(my_id)
            ) {
                for (const my_folder of as_records(my_message['result'])) {
                    rewrite_field(my_folder, 'uri');
                }
            }
            return;
        }
        const my_document = as_record(
            as_record(my_message['params'])?.['textDocument']
        );
        const my_sent_uri = my_document?.['uri'];
        canonicalise_params_uris(my_message['params']);
        const my_uri = my_document?.['uri'];
        if (typeof my_sent_uri !== 'string' || typeof my_uri !== 'string') {
            return;
        }
        if (my_method === DID_OPEN_METHOD) {
            this.the_closed_spellings.delete(my_uri);
            if (my_sent_uri === my_uri) {
                this.the_open_spellings.delete(my_uri);
            } else {
                this.the_open_spellings.set(my_uri, my_sent_uri);
            }
        } else if (my_method === DID_CLOSE_METHOD) {
            const my_spelling = this.the_open_spellings.get(my_uri);
            if (my_spelling === undefined) {
                return;
            }
            this.the_open_spellings.delete(my_uri);
            this.the_closed_spellings.set(my_uri, my_spelling);
            if (this.the_closed_spellings.size > CLOSED_SPELLING_LIMIT) {
                for (const my_oldest of this.the_closed_spellings.keys()) {
                    this.the_closed_spellings.delete(my_oldest);
                    break;
                }
            }
        }
    }

    /**
     * An outgoing JSON-RPC message with the client's spellings put
     * back, in the params of a request or notification or the result
     * of a response. The message is the server's own data (a cached
     * location, say), so it is never changed: what differs is copied.
     */
    handle_outgoing<T>(message: T): T {
        const my_sent = as_record(message);
        const my_sent_id = my_sent?.['id'];
        if (
            my_sent?.['method'] === WORKSPACE_FOLDERS_METHOD
            && (typeof my_sent_id === 'number'
                || typeof my_sent_id === 'string')
        ) {
            this.the_folder_request_ids.add(my_sent_id);
        }
        if (
            this.the_open_spellings.size === 0
            && this.the_closed_spellings.size === 0
        ) {
            return message;
        }
        const my_message = as_record(message);
        if (!my_message) {
            return message;
        }
        const my_params = this.restored(my_message['params']);
        const my_result = this.restored(my_message['result']);
        if (
            my_params === my_message['params']
            && my_result === my_message['result']
        ) {
            return message;
        }
        const my_copy: T = { ...message };
        const my_copy_record = as_record(my_copy);
        if (my_copy_record && 'params' in my_message) {
            my_copy_record['params'] = my_params;
        }
        if (my_copy_record && 'result' in my_message) {
            my_copy_record['result'] = my_result;
        }
        return my_copy;
    }

    /** The spelling the client used for `uri`, or `uri` itself. */
    for_client(uri: string): string {
        return this.the_open_spellings.get(uri)
            ?? this.the_closed_spellings.get(uri)
            ?? uri;
    }

    /** `value`, or a copy where a URI field's spelling differs. */
    private restored(value: unknown): unknown {
        if (Array.isArray(value)) {
            let my_copy: unknown[] | undefined;
            for (let i = 0; i < value.length; i++) {
                const my_item: unknown = value[i];
                const my_restored = this.restored(my_item);
                if (my_restored !== my_item) {
                    my_copy ??= [...value];
                    my_copy[i] = my_restored;
                }
            }
            return my_copy ?? value;
        }
        const my_record = as_record(value);
        if (!my_record) {
            return value;
        }
        let my_copy: JsonRecord | undefined;
        for (const [my_key, my_value] of Object.entries(my_record)) {
            if (my_key === OPAQUE_KEY) {
                continue;
            }
            const my_restored = typeof my_value === 'string'
                ? (OUTGOING_URI_KEYS.has(my_key)
                    ? this.for_client(my_value)
                    : my_value)
                : this.restored(my_value);
            if (my_restored !== my_value) {
                my_copy ??= { ...my_record };
                my_copy[my_key] = my_restored;
            }
        }
        return my_copy ?? value;
    }
}

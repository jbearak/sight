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
 * it, so the server only ever holds VS Code's spelling. Diagnostics
 * for a document the client has open are published under the spelling
 * the client opened it with, for clients that match that notification
 * to a buffer by string. Every other reply carries the server's
 * spelling, as replies about files the client never named always did.
 *
 * Only the fields listed below are rewritten, never a string that
 * merely looks like a URI: document text and settings pass through.
 */

import { URI } from 'vscode-uri';

const FILE_SCHEME_PREFIX = 'file:';

/** `uri` in the spelling `URI.file(path).toString()` gives. */
export function canonical_file_uri(uri: string): string {
    if (!uri.startsWith(FILE_SCHEME_PREFIX)) {
        return uri;
    }
    try {
        return URI.parse(uri).toString();
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

/**
 * Rewrites incoming messages and remembers, for each open document,
 * the spelling the client opened it with when that differs.
 */
export class ClientUriSpelling {
    /** Canonical URI -> the client's spelling, open documents only. */
    private readonly the_client_spellings = new Map<string, string>();

    /** Rewrite one incoming JSON-RPC message in place. */
    handle_incoming(message: unknown): void {
        const my_message = as_record(message);
        const my_method = my_message?.['method'];
        if (!my_message || typeof my_method !== 'string') {
            // A response to one of the server's own requests.
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
            if (my_sent_uri === my_uri) {
                this.the_client_spellings.delete(my_uri);
            } else {
                this.the_client_spellings.set(my_uri, my_sent_uri);
            }
        } else if (my_method === DID_CLOSE_METHOD) {
            this.the_client_spellings.delete(my_uri);
        }
    }

    /** The spelling to publish `uri` under. */
    for_client(uri: string): string {
        return this.the_client_spellings.get(uri) ?? uri;
    }
}

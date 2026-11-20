import { describe, expect, it } from 'bun:test';
import { URI } from 'vscode-uri';
import {
    ClientUriSpelling,
    canonical_file_uri,
    canonicalise_params_uris,
} from '../../../src/utils/client-uri-spelling';

describe('canonical_file_uri', () => {
    it('gives the spelling URI.file() gives for a Windows drive path', () => {
        expect(canonical_file_uri('file:///C:/proj/main.do'))
            .toBe('file:///c%3A/proj/main.do');
        expect(canonical_file_uri('file:///C:/proj/main.do'))
            .toBe(URI.parse('file:///c%3A/proj/main.do').toString());
    });

    it('encodes what Node\'s pathToFileURL leaves bare', () => {
        expect(canonical_file_uri('file:///tmp/a+b/(x).do'))
            .toBe(URI.file('/tmp/a+b/(x).do').toString());
    });

    it('leaves VS Code\'s spelling byte-identical', () => {
        for (const my_path of [
            '/tmp/a+b/(x).do', '/tmp/sp ace/é.do', '/tmp/a%b#c?d.do',
        ]) {
            const my_uri = URI.file(my_path).toString();
            expect(canonical_file_uri(my_uri)).toBe(my_uri);
        }
        expect(canonical_file_uri('file:///c%3A/proj/main.do'))
            .toBe('file:///c%3A/proj/main.do');
    });

    it('is idempotent', () => {
        const once = canonical_file_uri('file:///C:/a+b/x%20y.do');
        expect(canonical_file_uri(once)).toBe(once);
    });

    it('leaves other schemes and non-URIs alone', () => {
        expect(canonical_file_uri('untitled:Untitled-1'))
            .toBe('untitled:Untitled-1');
        expect(canonical_file_uri('C:/proj/main.do'))
            .toBe('C:/proj/main.do');
    });
});

describe('canonicalise_params_uris', () => {
    const SENT = 'file:///C:/proj/a+b/main.do';
    const WANT = 'file:///c%3A/proj/a%2Bb/main.do';

    it('rewrites every URI field the server reads', () => {
        const params = {
            textDocument: { uri: SENT },
            uri: SENT,
            rootUri: SENT,
            workspaceFolders: [{ uri: SENT, name: 'p' }],
            event: { added: [{ uri: SENT }], removed: [{ uri: SENT }] },
            changes: [{ uri: SENT, type: 2 }],
            diagnosticUris: [SENT],
            initializationOptions: { diagnosticUris: [SENT] },
        };
        canonicalise_params_uris(params);
        expect(params).toEqual({
            textDocument: { uri: WANT },
            uri: WANT,
            rootUri: WANT,
            workspaceFolders: [{ uri: WANT, name: 'p' }],
            event: { added: [{ uri: WANT }], removed: [{ uri: WANT }] },
            changes: [{ uri: WANT, type: 2 }],
            diagnosticUris: [WANT],
            initializationOptions: { diagnosticUris: [WANT] },
        });
    });

    it('leaves document text and settings that look like a URI', () => {
        const params = {
            textDocument: { uri: SENT, text: SENT },
            contentChanges: [{ text: SENT }],
            settings: { sight: { path: SENT } },
            arguments: [SENT],
        };
        canonicalise_params_uris(params);
        expect(params.textDocument.text).toBe(SENT);
        expect(params.contentChanges[0]?.text).toBe(SENT);
        expect(params.settings.sight.path).toBe(SENT);
        expect(params.arguments[0]).toBe(SENT);
    });

    it('accepts params of any shape', () => {
        for (const my_params of [undefined, null, 1, 'x', [SENT]]) {
            expect(() => canonicalise_params_uris(my_params)).not.toThrow();
        }
        const params = { rootUri: null, workspaceFolders: null };
        canonicalise_params_uris(params);
        expect(params).toEqual({ rootUri: null, workspaceFolders: null });
    });
});

describe('ClientUriSpelling', () => {
    const SENT = 'file:///C:/proj/main.do';
    const WANT = 'file:///c%3A/proj/main.do';
    const notify = (method: string, uri: string) => ({
        jsonrpc: '2.0', method, params: { textDocument: { uri } },
    });

    it('publishes an open document under the spelling it was opened with', () => {
        const spelling = new ClientUriSpelling();
        const open = notify('textDocument/didOpen', SENT);
        spelling.handle_incoming(open);
        expect(open.params.textDocument.uri).toBe(WANT);
        expect(spelling.for_client(WANT)).toBe(SENT);
    });

    it('forgets the spelling when the document closes', () => {
        const spelling = new ClientUriSpelling();
        spelling.handle_incoming(notify('textDocument/didOpen', SENT));
        spelling.handle_incoming(notify('textDocument/didClose', SENT));
        expect(spelling.for_client(WANT)).toBe(WANT);
    });

    it('uses the newest spelling when a document is opened again', () => {
        const spelling = new ClientUriSpelling();
        spelling.handle_incoming(notify('textDocument/didOpen', SENT));
        spelling.handle_incoming(notify('textDocument/didOpen', WANT));
        expect(spelling.for_client(WANT)).toBe(WANT);
    });

    it('gives a URI the client never opened unchanged', () => {
        const spelling = new ClientUriSpelling();
        spelling.handle_incoming(notify('textDocument/hover', SENT));
        expect(spelling.for_client(WANT)).toBe(WANT);
    });

    it('leaves a response alone', () => {
        const spelling = new ClientUriSpelling();
        const response = { jsonrpc: '2.0', id: 1, result: { uri: SENT } };
        spelling.handle_incoming(response);
        expect(response.result.uri).toBe(SENT);
    });
});

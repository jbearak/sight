/**
 * LogTail and BridgeClient tests: reading Stata's log across partial
 * writes, and the bridge's request rules (polling replies discarded
 * after their timeout, connect and setup replies always consumed).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BridgeClient, is_server_gone, type BridgeTransport } from '../../../src/console/automation/bridge';
import { LogTail } from '../../../src/console/automation/log-tail';
import { BRIDGE_SCRIPT } from '../../../src/console/automation/bridge-script';

let tmp_dir: string;

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-log-tail-'));
});

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
});

describe('LogTail', () => {
    it('reads from the start offset and normalizes CRLF split across reads', () => {
        const file = path.join(tmp_dir, 'out.log');
        fs.writeFileSync(file, 'header\r\n');
        const tail = new LogTail(file, fs.statSync(file).size);
        fs.appendFileSync(file, '. display 1\r');
        expect(tail.poll().text).toBe('. display 1');
        fs.appendFileSync(file, '\n1\r\n');
        expect(tail.poll().text).toBe('\n1\n');
    });

    it('decodes UTF-8 split across reads', () => {
        const file = path.join(tmp_dir, 'out.log');
        fs.writeFileSync(file, '');
        const tail = new LogTail(file, 0);
        const bytes = Buffer.from('é東\r\n', 'utf8');
        fs.appendFileSync(file, bytes.subarray(0, 1));
        expect(tail.poll().text).toBe('');
        fs.appendFileSync(file, bytes.subarray(1));
        expect(tail.poll().text).toBe('é東\n');
    });

    it('reports a log that shrank or vanished', () => {
        const file = path.join(tmp_dir, 'out.log');
        fs.writeFileSync(file, 'abc\n');
        const tail = new LogTail(file, 4);
        fs.writeFileSync(file, 'a');
        expect(tail.poll().lost).toBe(true);
        fs.rmSync(file);
        expect(tail.poll().lost).toBe(true);
    });
});

class FakeTransport implements BridgeTransport {
    sent: Array<Record<string, unknown>> = [];
    private listener: (line: string) => void = () => undefined;
    private finish: (text: string) => void = () => undefined;
    readonly ended = new Promise<string>((resolve) => {
        this.finish = resolve;
    });
    send(line: string): void {
        this.sent.push(JSON.parse(line) as Record<string, unknown>);
    }
    on_line(callback: (line: string) => void): void {
        this.listener = callback;
    }
    reply(message: Record<string, unknown>): void {
        this.listener(JSON.stringify(message));
    }
    close(): void {}
    kill(): void {
        this.finish('killed');
    }
}

describe('BridgeClient', () => {
    it('matches replies by id and passes interim events', async () => {
        const transport = new FakeTransport();
        const client = new BridgeClient(transport);
        const events: unknown[] = [];
        const pending = client.request('list_stata', { strict: true }, { on_event: (event) => events.push(event) });
        expect(transport.sent[0]).toEqual({ id: 1, op: 'list_stata', strict: true });
        transport.reply({ id: 1, event: 'mutex_wait' });
        transport.reply({ id: 1, ok: true, processes: [] });
        expect(await pending).toEqual({ ok: true, value: { id: 1, ok: true, processes: [] } });
        expect(events.length).toBe(1);
    });

    it('discards a polling reply that arrives after its timeout', async () => {
        const transport = new FakeTransport();
        const client = new BridgeClient(transport);
        const reply = await client.request('is_free', {}, { timeout_ms: 5 });
        expect(reply).toEqual({ ok: false, timed_out: true });
        transport.reply({ id: 1, ok: true, free: true });
        const next = client.request('is_free', {}, { timeout_ms: 1000 });
        transport.reply({ id: 2, ok: true, free: false });
        expect(await next).toMatchObject({ ok: true, value: { free: false } });
    });

    it('waits for connect however long it takes, noting when it is slow', async () => {
        const transport = new FakeTransport();
        const client = new BridgeClient(transport);
        let slow = 0;
        const pending = client.request('connect', {}, { slow_ms: 5, on_slow: () => slow++ });
        await new Promise((resolve) => setTimeout(resolve, 20));
        transport.reply({ id: 1, ok: true, before: [], after: [] });
        expect(await pending).toMatchObject({ ok: true });
        expect(slow).toBe(1);
    });

    it('answers pending requests as bridge_gone when the helper ends', async () => {
        const transport = new FakeTransport();
        const client = new BridgeClient(transport);
        const pending = client.request('connect');
        transport.kill();
        expect(await pending).toEqual({ ok: false, bridge_gone: true });
    });

    it('carries an error reply\'s other fields in detail', async () => {
        const transport = new FakeTransport();
        const client = new BridgeClient(transport);
        const pending = client.request('check_registration');
        transport.reply({
            id: 1, ok: false, error: 'unsupported_registration', message: 'unsupported_registration',
            hresult: null, key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\AppID\\{X}', value: 'RunAs',
            stray_pid: 4242,
        });
        expect(await pending).toEqual({
            ok: false,
            failure: {
                error: 'unsupported_registration',
                hresult: undefined,
                message: 'unsupported_registration',
                detail: {
                    key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\AppID\\{X}', value: 'RunAs', stray_pid: 4242,
                },
            },
        });
    });

    it('passes a named error\'s hresult through as failure.hresult', async () => {
        const transport = new FakeTransport();
        const client = new BridgeClient(transport);
        const pending = client.request('connect');
        // What the bridge sends for a drain_failed error.
        transport.reply({ id: 1, ok: false, error: 'drain_failed', message: 'drain_failed', hresult: '0x80004005' });
        expect(await pending).toMatchObject({
            ok: false, failure: { error: 'drain_failed', hresult: '0x80004005', detail: {} },
        });
    });

    it('recognizes the COM errors that mean Stata is gone', () => {
        expect(is_server_gone({ ok: false, failure: { error: 'com', hresult: '0x800706BA', detail: {} } })).toBe(true);
        expect(is_server_gone({ ok: false, failure: { error: 'com', hresult: '0x80004005', detail: {} } })).toBe(false);
        expect(is_server_gone({ ok: false, timed_out: true })).toBe(false);
    });
});

describe('BRIDGE_SCRIPT', () => {
    it('starts with the Language Mode check and releases on stdin EOF', () => {
        expect(BRIDGE_SCRIPT).toContain('LanguageMode -ne \'FullLanguage\'');
        expect(BRIDGE_SCRIPT).toContain('FinalReleaseComObject');
        expect(BRIDGE_SCRIPT).not.toContain('`');
        expect(BRIDGE_SCRIPT).not.toContain('$' + '{');
    });

    it('is ASCII only (PowerShell 5.1 reads the file as ANSI)', () => {
        expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(BRIDGE_SCRIPT)).toBe(true);
    });

    it('drains open Statas\' factories and creates from the exact factory', () => {
        // No global activation, which would hand out an open Stata.
        expect(BRIDGE_SCRIPT).not.toContain('New-Object -ComObject stata.StataOLEApp');
        expect(BRIDGE_SCRIPT).toContain('$CONTEXT_DRAIN = 0x8004');
        expect(BRIDGE_SCRIPT).toContain('$CONTEXT_SESSION = 0x4');
        expect(BRIDGE_SCRIPT).toContain('$E_ACCESSDENIED = -2147024891');
        expect(BRIDGE_SCRIPT).toContain('PreserveSig = true');
        expect(BRIDGE_SCRIPT).toContain('Marshal.ReadIntPtr(vtable, 3 * IntPtr.Size)');
        expect(BRIDGE_SCRIPT).toMatch(/\} finally \{\s+foreach \(\$pointer in \$pointers\) \{ \[SightConsoleCom\]::Release\(\$pointer\) \}/);
        // The C# returns HRESULTs: PowerShell would wrap a thrown
        // exception's message, and the error names wouldn't match.
        expect(BRIDGE_SCRIPT).not.toContain('ThrowExceptionForHR');
    });

    it('returns the title window\'s start time with its pid', () => {
        expect(BRIDGE_SCRIPT).toContain('return @{ pid = $candidate.pid; start = $candidate.start }');
    });

    it('refuses registrations that could start Stata during the drain', () => {
        for (const my_value of ['RunAs', 'LocalService', 'ServiceParameters', 'RemoteServerName', 'ActivateAtStorage']) {
            expect(BRIDGE_SCRIPT).toContain(`'${my_value}'`);
        }
        expect(BRIDGE_SCRIPT).toContain("OpenBaseKey('LocalMachine', 'Registry64')");
        expect(BRIDGE_SCRIPT).toContain("OpenBaseKey('CurrentUser', 'Registry64')");
    });

    it('maps every error name it throws', () => {
        const declared = /\$NAMED_ERRORS = @\(([^)]*)\)/.exec(BRIDGE_SCRIPT);
        expect(declared).not.toBeNull();
        const the_named = new Set([...(declared?.[1] ?? '').matchAll(/'([a-z_]+)'/g)]
            .map((my_match) => my_match[1]));
        const the_thrown = [...BRIDGE_SCRIPT.matchAll(/throw '([a-z_]+)'/g)].map((my_match) => my_match[1]);
        expect(the_thrown.length).toBeGreaterThan(5);
        for (const my_name of the_thrown) {
            expect(the_named.has(my_name)).toBe(true);
        }
    });
});

/**
 * The COM bridge: a helper process that holds the console's one COM
 * reference to Stata and answers JSON-lines requests. This module is
 * the client side and the transport-independent request logic, so
 * tests can drive it with a fake helper.
 */

/** COM errors that mean Stata (the server) is gone. */
export const SERVER_GONE_HRESULTS: ReadonlySet<string> = new Set([
    '0x800706BA', // RPC_S_SERVER_UNAVAILABLE
    '0x800706BE', // RPC_S_CALL_FAILED
    '0x80010108', // RPC_E_DISCONNECTED
]);

export interface BridgeFailure {
    error: string;
    hresult?: string;
    message?: string;
}

export type BridgeReply =
    | { ok: true; value: Record<string, unknown> }
    | { ok: false; failure: BridgeFailure }
    | { ok: false; timed_out: true }
    | { ok: false; bridge_gone: true };

export interface RequestOptions {
    /**
     * Polling ops: give up after this long and discard a late reply.
     * Without it, the reply is always awaited (connect, setup).
     */
    timeout_ms?: number;
    /** Called once if a reply that is always awaited is slow. */
    slow_ms?: number;
    on_slow?: () => void;
    /** Interim `event` lines for this request. */
    on_event?: (event: Record<string, unknown>) => void;
}

export interface Bridge {
    request(op: string, params?: Record<string, unknown>, options?: RequestOptions): Promise<BridgeReply>;
    /** Resolves when the helper process has ended, with stderr text. */
    readonly ended: Promise<string>;
    /** Close stdin: the helper releases its reference and exits. */
    close(): void;
    /** Kill the helper outright (it may be stuck in a COM call). */
    kill(): void;
}

export function is_server_gone(reply: BridgeReply): boolean {
    if (reply.ok) {
        return false;
    }
    if ('failure' in reply) {
        return reply.failure.hresult !== undefined
            && SERVER_GONE_HRESULTS.has(reply.failure.hresult.toUpperCase().replace('0X', '0x'));
    }
    return false;
}

export function reply_text(reply: BridgeReply): string {
    if (reply.ok) {
        return 'ok';
    }
    if ('timed_out' in reply) {
        return 'timed out';
    }
    if ('bridge_gone' in reply) {
        return 'the helper process ended';
    }
    const failure = reply.failure;
    return failure.message ?? failure.error;
}

/** Line-oriented transport underneath a bridge (a process, or a fake). */
export interface BridgeTransport {
    send(line: string): void;
    on_line(callback: (line: string) => void): void;
    readonly ended: Promise<string>;
    close(): void;
    kill(): void;
}

interface Pending {
    resolve: (reply: BridgeReply) => void;
    options: RequestOptions;
    timer: ReturnType<typeof setTimeout> | null;
    slow_timer: ReturnType<typeof setTimeout> | null;
}

/** A bridge over a line transport: ids, timeouts, late replies. */
export class BridgeClient implements Bridge {
    private next_id = 1;
    private readonly pending = new Map<number, Pending>();
    private gone = false;
    readonly ended: Promise<string>;

    constructor(private readonly transport: BridgeTransport) {
        transport.on_line((line) => this.handle_line(line));
        this.ended = transport.ended.then((stderr) => {
            this.gone = true;
            for (const [my_id, my_pending] of this.pending) {
                this.pending.delete(my_id);
                this.clear(my_pending);
                my_pending.resolve({ ok: false, bridge_gone: true });
            }
            return stderr;
        });
    }

    request(op: string, params: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<BridgeReply> {
        if (this.gone) {
            return Promise.resolve({ ok: false, bridge_gone: true });
        }
        const id = this.next_id++;
        return new Promise<BridgeReply>((resolve) => {
            const entry: Pending = { resolve, options, timer: null, slow_timer: null };
            if (options.timeout_ms !== undefined) {
                entry.timer = setTimeout(() => {
                    // Discarded: a late reply finds no entry.
                    this.pending.delete(id);
                    this.clear(entry);
                    resolve({ ok: false, timed_out: true });
                }, options.timeout_ms);
            }
            if (options.slow_ms !== undefined && options.on_slow) {
                const on_slow = options.on_slow;
                entry.slow_timer = setTimeout(() => {
                    entry.slow_timer = null;
                    on_slow();
                }, options.slow_ms);
            }
            this.pending.set(id, entry);
            try {
                this.transport.send(JSON.stringify({ id, op, ...params }));
            } catch {
                this.pending.delete(id);
                this.clear(entry);
                resolve({ ok: false, bridge_gone: true });
            }
        });
    }

    close(): void {
        this.transport.close();
    }

    kill(): void {
        this.transport.kill();
    }

    private clear(entry: Pending): void {
        if (entry.timer !== null) {
            clearTimeout(entry.timer);
        }
        if (entry.slow_timer !== null) {
            clearTimeout(entry.slow_timer);
        }
    }

    private handle_line(line: string): void {
        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            return;
        }
        if (typeof message !== 'object' || message === null) {
            return;
        }
        const record = message as Record<string, unknown>;
        const id = typeof record.id === 'number' ? record.id : null;
        if (id === null) {
            return;
        }
        const entry = this.pending.get(id);
        if (!entry) {
            return;
        }
        if (typeof record.event === 'string') {
            entry.options.on_event?.(record);
            return;
        }
        this.pending.delete(id);
        this.clear(entry);
        if (record.ok === true) {
            entry.resolve({ ok: true, value: record });
            return;
        }
        entry.resolve({
            ok: false,
            failure: {
                error: typeof record.error === 'string' ? record.error : 'error',
                hresult: typeof record.hresult === 'string' ? record.hresult : undefined,
                message: typeof record.message === 'string' ? record.message : undefined,
            },
        });
    }
}

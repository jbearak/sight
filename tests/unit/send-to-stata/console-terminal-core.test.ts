import { describe, expect, test } from 'bun:test';
import {
    CONSOLE_EXIT_AUTOMATION_NOT_REGISTERED,
    CONSOLE_EXIT_BRIDGE_BLOCKED,
    CONSOLE_EXIT_SEND_FROM_EDITOR,
    CONSOLE_EXIT_SEVERAL_STATA_WINDOWS,
    CONSOLE_EXIT_STATA_HELD_ELSEWHERE,
    CONSOLE_EXIT_TAKE_OVER_DECLINED,
    CONSOLE_OFFER_REASONS,
    ConsoleExit,
    ConsoleQueueHost,
    ConsoleTerminalQueue,
    OFFER_CHOICE_ALWAYS,
    OFFER_CHOICE_CANCEL,
    OFFER_CHOICE_SESSION,
    OfferAnswer,
    PendingSend,
} from '../../../client/src/send-to-stata/console-terminal-core';
import { wait_until } from '../../wait-until';

interface FakeTerminal {
    id: string;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

function create_deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(the_resolve => {
        resolve = the_resolve;
    });
    return { promise, resolve };
}

/** Records every effect the queue has, in order. */
class FakeHost implements ConsoleQueueHost<FakeTerminal> {
    readonly the_events: string[] = [];
    readonly the_typed: string[] = [];
    readonly the_dispatched: string[] = [];
    readonly the_cleanups: string[] = [];
    readonly the_deleted: string[] = [];
    readonly the_offers: string[] = [];
    readonly the_notices: string[] = [];
    readonly the_errors: string[] = [];
    readonly the_counts: number[] = [];
    readonly the_offer_answers: Deferred<OfferAnswer>[] = [];
    readonly the_failing_paths = new Set<string>();
    readonly the_dispatch_gates = new Map<string, Promise<void>>();
    fallback_in_effect = false;
    override_set_count = 0;
    always_is_effective = true;
    always_write_count = 0;

    type_send(terminal: FakeTerminal, send: PendingSend): void {
        this.the_typed.push(`${terminal.id}:${send.temp_file_path}`);
        this.the_events.push(`type ${send.temp_file_path}`);
    }

    async dispatch_to_app(send: PendingSend): Promise<void> {
        this.the_events.push(`dispatch ${send.temp_file_path}`);
        await this.the_dispatch_gates.get(send.temp_file_path);
        if (this.the_failing_paths.has(send.temp_file_path)) {
            throw new Error(`helper failed for ${send.temp_file_path}`);
        }
        this.the_dispatched.push(send.temp_file_path);
    }

    show_offer(message: string): Promise<OfferAnswer> {
        this.the_offers.push(message);
        const answer = create_deferred<OfferAnswer>();
        this.the_offer_answers.push(answer);
        return answer.promise;
    }

    show_notice(message: string): void {
        this.the_notices.push(message);
    }

    show_error(message: string): void {
        this.the_errors.push(message);
    }

    schedule_cleanup(file_path: string): void {
        this.the_cleanups.push(file_path);
        this.the_events.push(`cleanup ${file_path}`);
    }

    delete_file(file_path: string): void {
        this.the_deleted.push(file_path);
    }

    is_fallback_in_effect(): boolean {
        return this.fallback_in_effect;
    }

    set_session_override(): void {
        this.override_set_count += 1;
        this.fallback_in_effect = true;
    }

    async write_always(): Promise<boolean> {
        this.always_write_count += 1;
        if (this.always_is_effective) {
            this.fallback_in_effect = true;
        }
        return this.always_is_effective;
    }

    on_pending_count_changed(count: number): void {
        this.the_counts.push(count);
    }

    /** Each temp file is resolved once: typed, dispatched or dropped. */
    resolutions_of(file_path: string): number {
        return this.the_typed.filter(t => t.endsWith(`:${file_path}`))
            .length
            + this.the_dispatched.filter(p => p === file_path).length
            + this.the_deleted.filter(p => p === file_path).length;
    }
}

const SHORT_MS = 2;

function create_queue(host: FakeHost, offer_timeout_ms = 60000) {
    return new ConsoleTerminalQueue<FakeTerminal>(host, {
        offer_timeout_ms,
    });
}

function send(file_path: string): PendingSend {
    return { command: 'do', temp_file_path: file_path };
}

function process_exit(code: number | undefined): ConsoleExit {
    return { reason: 'process', code };
}

function delay(time_ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time_ms));
}

describe('console terminal queue: readiness', () => {
    test('queues sends before readiness and types them in order', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);

        expect(queue.send(terminal, send('/a.do'))).toBe(true);
        expect(queue.send(terminal, send('/b.do'))).toBe(true);
        expect(queue.send(terminal, send('/c.do'))).toBe(true);
        expect(queue.pending_count()).toBe(3);
        await delay(SHORT_MS * 10);
        expect(host.the_typed).toEqual([]);
        // The queue owns the files: no cleanup before they are typed.
        expect(host.the_cleanups).toEqual([]);

        queue.mark_ready(terminal);
        expect(host.the_typed).toEqual([
            't1:/a.do', 't1:/b.do', 't1:/c.do',
        ]);
        expect(host.the_events).toEqual([
            'type /a.do', 'cleanup /a.do',
            'type /b.do', 'cleanup /b.do',
            'type /c.do', 'cleanup /c.do',
        ]);
        expect(queue.get_state(terminal)).toBe('ready');
        expect(queue.pending_count()).toBe(0);
        expect(host.the_counts.at(-1)).toBe(0);

        // Later sends are typed directly; the caller cleans up.
        expect(queue.send(terminal, send('/d.do'))).toBe(false);
        expect(host.the_typed.at(-1)).toBe('t1:/d.do');
    });

    test('waits for readiness however long it takes', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));

        // A long wait (the take-over question): still starting,
        // nothing lost.
        await delay(SHORT_MS * 50);
        expect(queue.get_state(terminal)).toBe('starting');
        expect(host.the_deleted).toEqual([]);
        expect(host.resolutions_of('/a.do')).toBe(0);

        queue.mark_ready(terminal);
        expect(host.the_typed).toEqual(['t1:/a.do']);
    });

    test('a close after readiness has nothing to dispatch', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.mark_ready(terminal);
        expect(queue.get_state(terminal)).toBe('ready');
        queue.send(terminal, send('/a.do'));

        await queue.handle_closed(terminal, process_exit(0));
        expect(host.the_events.filter(e => e.startsWith('dispatch')))
            .toEqual([]);
        expect(host.the_offers).toEqual([]);
        expect(host.the_notices).toEqual([]);
        expect(host.the_deleted).toEqual([]);
    });

    test('drops the rest if typing fails', async () => {
        const host = new FakeHost();
        host.type_send = (_terminal, my_send) => {
            if (my_send.temp_file_path === '/b.do') {
                throw new Error('terminal has exited');
            }
            host.the_typed.push(`t1:${my_send.temp_file_path}`);
        };
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));
        queue.send(terminal, send('/b.do'));
        queue.send(terminal, send('/c.do'));

        queue.mark_ready(terminal);
        expect(host.the_errors).toHaveLength(1);
        expect(host.the_typed).toEqual(['t1:/a.do']);
        expect(host.the_cleanups).toEqual(['/a.do']);
        expect(host.the_deleted).toEqual(['/b.do', '/c.do']);
        expect(host.the_errors[0]).toStartWith('Dropped 2 sends to Stata');
        for (const my_path of ['/a.do', '/b.do', '/c.do']) {
            expect(host.resolutions_of(my_path)).toBe(1);
        }
        expect(queue.pending_count()).toBe(0);
    });

    test('ignores readiness reported after the close', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));

        await queue.handle_closed(
            terminal,
            { reason: 'user', code: undefined }
        );
        queue.mark_ready(terminal);

        expect(host.the_typed).toEqual([]);
        expect(queue.is_tracked(terminal)).toBe(false);
        expect(() => queue.send(terminal, send('/b.do'))).toThrow();
    });
});

describe('console terminal queue: closes without an offer', () => {
    const NO_OFFER_CASES: Array<[string, ConsoleExit, boolean]> = [
        ['a user close', { reason: 'user', code: 1 }, false],
        ['exit code 0', process_exit(0), true],
        ['a missing exit code', process_exit(undefined), true],
        ['an unknown exit code', process_exit(1), true],
        ['a signal status', process_exit(130), true],
    ];

    for (const [my_name, my_exit, my_expects_notice] of NO_OFFER_CASES) {
        test(`${my_name} drops pending sends without an offer`, async () => {
            const host = new FakeHost();
            const queue = create_queue(host);
            const terminal = { id: 't1' };
            queue.track(terminal);
            queue.send(terminal, send('/a.do'));
            queue.send(terminal, send('/b.do'));

            await queue.handle_closed(terminal, my_exit);

            expect(host.the_offers).toEqual([]);
            expect(host.the_dispatched).toEqual([]);
            expect(host.the_deleted).toEqual([
                '/a.do', '/b.do',
            ]);
            expect(queue.pending_count()).toBe(0);
            if (my_expects_notice) {
                expect(host.the_notices).toHaveLength(1);
                expect(host.the_notices[0]).toStartWith(
                    'Dropped 2 sends to Stata: '
                );
            } else {
                expect(host.the_notices).toEqual([]);
            }
        });
    }

    test('says nothing when there was nothing to drop', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        await queue.handle_closed(terminal, process_exit(1));
        expect(host.the_notices).toEqual([]);
    });
});

describe('console terminal queue: the offer', () => {
    const OFFER_CODES = [
        CONSOLE_EXIT_SEVERAL_STATA_WINDOWS,
        CONSOLE_EXIT_TAKE_OVER_DECLINED,
        CONSOLE_EXIT_STATA_HELD_ELSEWHERE,
        CONSOLE_EXIT_AUTOMATION_NOT_REGISTERED,
        CONSOLE_EXIT_BRIDGE_BLOCKED,
    ];

    test('the exit codes are 80 to 85', () => {
        expect([...CONSOLE_OFFER_REASONS.keys()].sort()).toEqual(
            [80, 81, 82, 83, 84, 85]
        );
        expect(CONSOLE_EXIT_SEND_FROM_EDITOR).toBe(82);
    });

    for (const my_code of OFFER_CODES) {
        test(`code ${my_code} offers with its own reason`, async () => {
            const host = new FakeHost();
            const queue = create_queue(host);
            const terminal = { id: 't1' };
            queue.track(terminal);
            queue.send(terminal, send('/a.do'));

            const done = queue.handle_closed(
                terminal, process_exit(my_code)
            );
            expect(host.the_offers).toHaveLength(1);
            const reason = CONSOLE_OFFER_REASONS.get(my_code);
            expect(reason).toBeTruthy();
            expect(host.the_offers[0]).toBe(
                `sight console can't use Stata here: ${reason} `
                + 'Send code to the open Stata window instead?'
            );
            // Held sends count in the status bar.
            expect(queue.pending_count()).toBe(1);
            host.the_offer_answers[0].resolve(OFFER_CHOICE_CANCEL);
            await done;
        });
    }

    test('the reasons are distinct', () => {
        const the_reasons = OFFER_CODES.map(
            my_code => CONSOLE_OFFER_REASONS.get(my_code)
        );
        expect(new Set(the_reasons).size).toBe(OFFER_CODES.length);
    });

    test('This session sets the override and dispatches in order', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));
        queue.send(terminal, send('/b.do'));
        queue.send(terminal, send('/c.do'));

        const done = queue.handle_closed(terminal, process_exit(80));
        // Temp files stay intact while the offer shows.
        expect(host.the_deleted).toEqual([]);
        host.the_offer_answers[0].resolve(OFFER_CHOICE_SESSION);
        await done;

        expect(host.override_set_count).toBe(1);
        expect(host.the_dispatched).toEqual(['/a.do', '/b.do', '/c.do']);
        expect(host.the_cleanups).toEqual(['/a.do', '/b.do', '/c.do']);
        for (const my_path of ['/a.do', '/b.do', '/c.do']) {
            expect(host.resolutions_of(my_path)).toBe(1);
        }
        expect(queue.pending_count()).toBe(0);
        // A single terminal's offer needs no count report.
        expect(host.the_notices).toEqual([]);
    });

    test('Always writes the global setting and dispatches', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));

        const done = queue.handle_closed(terminal, process_exit(81));
        host.the_offer_answers[0].resolve(OFFER_CHOICE_ALWAYS);
        await done;

        expect(host.always_write_count).toBe(1);
        expect(host.override_set_count).toBe(0);
        expect(host.the_dispatched).toEqual(['/a.do']);
        expect(host.the_notices).toEqual([]);
    });

    test('Always with a workspace value still winning also sets the override', async () => {
        const host = new FakeHost();
        host.always_is_effective = false;
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));

        const done = queue.handle_closed(terminal, process_exit(81));
        host.the_offer_answers[0].resolve(OFFER_CHOICE_ALWAYS);
        await done;

        expect(host.always_write_count).toBe(1);
        expect(host.override_set_count).toBe(1);
        expect(host.the_notices).toHaveLength(1);
        expect(host.the_notices[0]).toContain('overrides it');
        expect(host.the_dispatched).toEqual(['/a.do']);
    });

    test('Cancel drops the sends, and the next close offers again', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const first = { id: 't1' };
        queue.track(first);
        queue.send(first, send('/a.do'));

        const done = queue.handle_closed(first, process_exit(80));
        host.the_offer_answers[0].resolve(OFFER_CHOICE_CANCEL);
        await done;

        expect(host.the_dispatched).toEqual([]);
        expect(host.the_deleted).toEqual(['/a.do']);
        expect(host.override_set_count).toBe(0);
        expect(host.the_notices).toEqual([]);

        // The next send starts a new console, which may now succeed or
        // ask again.
        const second = { id: 't2' };
        queue.track(second);
        queue.send(second, send('/b.do'));
        const second_done = queue.handle_closed(second, process_exit(80));
        expect(host.the_offers).toHaveLength(2);
        host.the_offer_answers[1].resolve(OFFER_CHOICE_SESSION);
        await second_done;
        expect(host.the_dispatched).toEqual(['/b.do']);
    });

    test('dismissing the offer counts as Cancel', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));

        const done = queue.handle_closed(terminal, process_exit(80));
        host.the_offer_answers[0].resolve(undefined);
        await done;

        expect(host.the_dispatched).toEqual([]);
        expect(host.resolutions_of('/a.do')).toBe(1);
    });

    test('an unanswered offer counts as Cancel after its timeout', async () => {
        const host = new FakeHost();
        const queue = create_queue(host, 20);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));

        await queue.handle_closed(terminal, process_exit(80));
        expect(host.the_dispatched).toEqual([]);
        expect(host.the_deleted).toContain('/a.do');
        expect(host.the_notices).toHaveLength(1);
        expect(host.the_notices[0]).toContain('unanswered');
        expect(queue.pending_count()).toBe(0);

        // A late answer changes nothing.
        host.the_offer_answers[0].resolve(OFFER_CHOICE_SESSION);
        await delay(5);
        expect(host.the_dispatched).toEqual([]);
        expect(host.override_set_count).toBe(0);
        expect(host.resolutions_of('/a.do')).toBe(1);
    });

    test('asks nothing when the override or external is in effect', async () => {
        const host = new FakeHost();
        host.fallback_in_effect = true;
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));

        await queue.handle_closed(terminal, process_exit(80));
        expect(host.the_offers).toEqual([]);
        expect(host.the_dispatched).toEqual(['/a.do']);
    });

    test('code 82 dispatches at once as This session', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));
        queue.send(terminal, send('/b.do'));

        await queue.handle_closed(
            terminal, process_exit(CONSOLE_EXIT_SEND_FROM_EDITOR)
        );
        expect(host.the_offers).toEqual([]);
        expect(host.override_set_count).toBe(1);
        expect(host.the_dispatched).toEqual(['/a.do', '/b.do']);
    });
});

describe('console terminal queue: overlapping closes', () => {
    const JOIN_ANSWERS: Array<[string, OfferAnswer | 'timeout', boolean]> = [
        ['This session', OFFER_CHOICE_SESSION, true],
        ['Always', OFFER_CHOICE_ALWAYS, true],
        ['Cancel', OFFER_CHOICE_CANCEL, false],
        ['a dismissal', undefined, false],
        ['a timeout', 'timeout', false],
    ];

    for (const [my_name, my_answer, my_dispatches] of JOIN_ANSWERS) {
        test(`a second close joins the showing offer (${my_name})`, async () => {
            const host = new FakeHost();
            const queue = create_queue(host, my_answer === 'timeout'
                ? 30 : 60000);
            const first = { id: 't1' };
            const second = { id: 't2' };
            queue.track(first);
            queue.track(second);
            queue.send(first, send('/a.do'));
            queue.send(first, send('/b.do'));
            queue.send(second, send('/c.do'));

            const first_done = queue.handle_closed(
                first, process_exit(80)
            );
            const second_done = queue.handle_closed(
                second, process_exit(83)
            );
            // One notification for both.
            expect(host.the_offers).toHaveLength(1);
            expect(queue.pending_count()).toBe(3);

            if (my_answer !== 'timeout') {
                host.the_offer_answers[0].resolve(my_answer);
            }
            await Promise.all([first_done, second_done]);

            const the_paths = ['/a.do', '/b.do', '/c.do'];
            for (const my_path of the_paths) {
                expect(host.resolutions_of(my_path)).toBe(1);
            }
            if (my_dispatches) {
                // In close order.
                expect(host.the_dispatched).toEqual(the_paths);
                expect(host.the_notices).toContain(
                    'Sent 3 sends to the Stata app.'
                );
            } else {
                expect(host.the_dispatched).toEqual([]);
            }
            expect(queue.pending_count()).toBe(0);
        });
    }

    test('a terminal closing without an offer code while an offer shows keeps its own outcome', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const first = { id: 't1' };
        const second = { id: 't2' };
        queue.track(first);
        queue.track(second);
        queue.send(first, send('/a.do'));
        queue.send(second, send('/b.do'));

        const first_done = queue.handle_closed(first, process_exit(80));
        await queue.handle_closed(second, { reason: 'user', code: 1 });
        expect(host.the_deleted).toContain('/b.do');
        expect(host.the_deleted).not.toContain('/a.do');

        host.the_offer_answers[0].resolve(OFFER_CHOICE_SESSION);
        await first_done;
        expect(host.the_dispatched).toEqual(['/a.do']);
    });

    test('code 82 while an offer shows does not wait on it', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const first = { id: 't1' };
        const second = { id: 't2' };
        queue.track(first);
        queue.track(second);
        queue.send(first, send('/a.do'));
        queue.send(second, send('/b.do'));

        const first_done = queue.handle_closed(first, process_exit(80));
        await queue.handle_closed(
            second, process_exit(CONSOLE_EXIT_SEND_FROM_EDITOR)
        );
        expect(host.the_dispatched).toEqual(['/b.do']);
        expect(host.override_set_count).toBe(1);
        // The showing offer keeps only its own sends.
        expect(queue.pending_count()).toBe(1);

        host.the_offer_answers[0].resolve(OFFER_CHOICE_CANCEL);
        await first_done;
        expect(host.the_dispatched).toEqual(['/b.do']);
        expect(host.resolutions_of('/a.do')).toBe(1);
    });

    test('two dispatches at once keep their own sends when one helper fails', async () => {
        const host = new FakeHost();
        const queue = create_queue(host);
        const first = { id: 't1' };
        const second = { id: 't2' };
        queue.track(first);
        queue.track(second);
        queue.send(first, send('/a1.do'));
        queue.send(first, send('/a2.do'));
        queue.send(first, send('/a3.do'));
        queue.send(second, send('/b1.do'));
        queue.send(second, send('/b2.do'));
        host.the_failing_paths.add('/a2.do');
        const gate = create_deferred<void>();
        host.the_dispatch_gates.set('/a1.do', gate.promise);
        host.the_dispatch_gates.set('/b1.do', gate.promise);

        const first_done = queue.handle_closed(first, process_exit(80));
        host.the_offer_answers[0].resolve(OFFER_CHOICE_SESSION);
        await wait_until(
            () => host.the_events.includes('dispatch /a1.do'),
            'the first dispatch to start',
            1000
        );
        const second_done = queue.handle_closed(
            second, process_exit(CONSOLE_EXIT_SEND_FROM_EDITOR)
        );
        await wait_until(
            () => host.the_events.includes('dispatch /b1.do'),
            'the second dispatch to start',
            1000
        );
        gate.resolve();
        await Promise.all([first_done, second_done]);

        expect(host.the_dispatched).toContain('/a1.do');
        expect(host.the_dispatched).not.toContain('/a3.do');
        expect(host.the_dispatched.filter(p => p.startsWith('/b')))
            .toEqual(['/b1.do', '/b2.do']);
        expect(host.the_errors).toEqual(['Error: helper failed for /a2.do']);
        expect(host.the_notices).toContain(
            'Dropped 1 send to Stata after the error.'
        );
        for (const my_path of [
            '/a1.do', '/a2.do', '/a3.do', '/b1.do', '/b2.do',
        ]) {
            expect(host.resolutions_of(my_path)).toBe(1);
        }
        expect(queue.pending_count()).toBe(0);
    });

    test('a helper failure drops the remaining sends with a note', async () => {
        const host = new FakeHost();
        host.the_failing_paths.add('/a.do');
        const queue = create_queue(host);
        const terminal = { id: 't1' };
        queue.track(terminal);
        queue.send(terminal, send('/a.do'));
        queue.send(terminal, send('/b.do'));
        queue.send(terminal, send('/c.do'));

        const done = queue.handle_closed(terminal, process_exit(80));
        host.the_offer_answers[0].resolve(OFFER_CHOICE_SESSION);
        await done;

        expect(host.the_dispatched).toEqual([]);
        expect(host.the_errors).toEqual(['Error: helper failed for /a.do']);
        expect(host.the_notices).toEqual([
            'Dropped 2 sends to Stata after the error.',
        ]);
        expect(host.the_deleted).toEqual([
            '/a.do', '/b.do', '/c.do',
        ]);
        expect(queue.pending_count()).toBe(0);
    });
});

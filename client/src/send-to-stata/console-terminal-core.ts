/**
 * The extension's side of `sight console` panes, without VS Code:
 * per-pane readiness, the queue of sends made before readiness, and,
 * on Windows, the offer to use send-to-stata (the Stata app) when the
 * console ends without taking Stata.
 *
 * Every pending send ends exactly once: typed into its ready terminal
 * (or, for one its command line carried, run there), dispatched to the
 * app, or dropped (its temp file deleted).
 */

import type { StataCommand } from './index.js';

// Codes from `sight console` when it didn't take Stata. These mirror
// src/console/automation/exit-codes.ts; keep them in sync. (Code 86,
// no raw terminal input, can't happen in the extension's own pane.)
export const CONSOLE_EXIT_SEVERAL_STATA_WINDOWS = 80;
export const CONSOLE_EXIT_TAKE_OVER_DECLINED = 81;
export const CONSOLE_EXIT_SEND_FROM_EDITOR = 82;
export const CONSOLE_EXIT_STATA_HELD_ELSEWHERE = 83;
export const CONSOLE_EXIT_AUTOMATION_NOT_REGISTERED = 84;
export const CONSOLE_EXIT_BRIDGE_BLOCKED = 85;

/**
 * Why the console couldn't use Stata, worded for what send-to-stata
 * will do instead. The console's own text is gone with its terminal.
 * Code 82 (the user answered `s`) has no reason: it never asks.
 */
export const CONSOLE_OFFER_REASONS: ReadonlyMap<number, string | null> =
    new Map<number, string | null>([
        [
            CONSOLE_EXIT_SEVERAL_STATA_WINDOWS,
            'several Stata windows are open. send-to-stata will send to '
            + 'one of them; to choose, close the others.',
        ],
        [
            CONSOLE_EXIT_TAKE_OVER_DECLINED,
            'you chose to keep your open Stata to yourself. '
            + 'send-to-stata sends to it without taking it over.',
        ],
        [CONSOLE_EXIT_SEND_FROM_EDITOR, null],
        [
            CONSOLE_EXIT_STATA_HELD_ELSEWHERE,
            'the open Stata is in use by another program (such as '
            + 'Jupyter). send-to-stata would type into that same window.',
        ],
        [
            CONSOLE_EXIT_AUTOMATION_NOT_REGISTERED,
            "Stata's Automation isn't registered (run Stata's .exe with "
            + '/Register as administrator to use the console). '
            + "send-to-stata doesn't need it.",
        ],
        [
            CONSOLE_EXIT_BRIDGE_BLOCKED,
            'PowerShell, which the console uses to reach Stata, is '
            + 'blocked here (by its language mode or a policy). '
            + "send-to-stata doesn't use PowerShell.",
        ],
    ]);

export const OFFER_CHOICE_SESSION = 'This session';
export const OFFER_CHOICE_ALWAYS = 'Always';
export const OFFER_CHOICE_CANCEL = 'Cancel';

export const DEFAULT_OFFER_TIMEOUT_MS = 60000;

export type ConsoleTerminalState = 'starting' | 'ready' | 'closed';

/**
 * How a console pane ended: the console finished on its own
 * (`process`, with its code), or the user closed the pane.
 */
export type ConsoleCloseReason = 'process' | 'user';

export interface ConsoleExit {
    reason: ConsoleCloseReason;
    code: number | undefined;
    /**
     * `pty` for console Stata on macOS and Linux, whose exit codes are
     * Stata's own: they never mean the Windows codes above, so no
     * offer. Absent means the Windows (Automation) console.
     */
    backend?: 'automation' | 'pty';
}

export interface PendingSend {
    command: StataCommand;
    temp_file_path: string;
}

/** Choice from the offer; `undefined` means it was dismissed. */
export type OfferAnswer =
    | typeof OFFER_CHOICE_SESSION
    | typeof OFFER_CHOICE_ALWAYS
    | typeof OFFER_CHOICE_CANCEL
    | undefined;

/** What the queue needs from VS Code and the file system. */
export interface ConsoleQueueHost<TTerminal> {
    type_send(terminal: TTerminal, send: PendingSend): void;
    /** Send to the Stata app (send-to-stata); rejects on failure. */
    dispatch_to_app(send: PendingSend): Promise<void>;
    show_offer(message: string): Promise<OfferAnswer>;
    show_notice(message: string): void;
    show_error(message: string): void;
    /** Delete a temp file after the normal cleanup delay. */
    schedule_cleanup(file_path: string): void;
    /** Delete a file now, ignoring errors. */
    delete_file(file_path: string): void;
    /** True if the session override or `external` is in effect. */
    is_fallback_in_effect(): boolean;
    set_session_override(): void;
    /**
     * Write `external` as the global target. Resolves to whether
     * `external` is now the effective value.
     */
    write_always(): Promise<boolean>;
    on_pending_count_changed(count: number): void;
}

export interface ConsoleQueueTimings {
    offer_timeout_ms: number;
}

interface ConsoleTerminalEntry {
    state: ConsoleTerminalState;
    /**
     * Sends handed to the console on its command line, which it runs
     * itself at its first prompt: not typed, but pending until then.
     */
    baked: PendingSend[];
    pending: PendingSend[];
}

interface ShowingOffer {
    pending: PendingSend[];
    terminal_count: number;
    done: Promise<void>;
}

const OFFER_TIMED_OUT = Symbol('offer timed out');

/** An entry's untyped sends, in order, leaving it none. */
function take_all(entry: ConsoleTerminalEntry): PendingSend[] {
    const the_sends = [...entry.baked, ...entry.pending];
    entry.baked = [];
    entry.pending = [];
    return the_sends;
}

function count_sends(count: number): string {
    return count === 1 ? '1 send' : `${count} sends`;
}

/** Why a close that makes no offer dropped its pending sends. */
function describe_drop(exit: ConsoleExit): string {
    if (exit.reason !== 'process') {
        return 'the Stata pane closed before it was ready';
    }
    if (exit.code === undefined) {
        return 'sight console ended before it was ready';
    }
    if (exit.code === 0) {
        return 'sight console exited before it was ready';
    }
    return `sight console exited with code ${exit.code} before it was `
        + 'ready';
}

export function format_offer_message(reason: string): string {
    return `sight console can't use Stata here: ${reason} `
        + 'Send code to the open Stata window instead?';
}

/**
 * Tracks `sight console` panes: each goes `starting` -> `ready` ->
 * `closed`, and `closed` is final.
 */
export class ConsoleTerminalQueue<TTerminal> {
    private readonly entries = new Map<TTerminal, ConsoleTerminalEntry>();
    private showing_offer: ShowingOffer | null = null;
    private dispatching_count = 0;
    private readonly timings: ConsoleQueueTimings;

    constructor(
        private readonly host: ConsoleQueueHost<TTerminal>,
        timings: Partial<ConsoleQueueTimings> = {}
    ) {
        this.timings = {
            offer_timeout_ms: timings.offer_timeout_ms
                ?? DEFAULT_OFFER_TIMEOUT_MS,
        };
    }

    /**
     * Start tracking a console pane, with the sends its command line
     * carries (`baked`), if any.
     */
    track(terminal: TTerminal, baked: PendingSend[] = []): void {
        if (this.entries.has(terminal)) {
            return;
        }
        this.entries.set(terminal, {
            state: 'starting', baked: [...baked], pending: [],
        });
        if (baked.length > 0) {
            this.report_pending_count();
        }
    }

    /**
     * The console showed its first prompt: type the queued sends, in
     * order. A pane that already closed stays closed.
     */
    mark_ready(terminal: TTerminal): void {
        const entry = this.entries.get(terminal);
        if (entry) {
            this.make_ready(terminal, entry);
        }
    }

    /**
     * A send the console's command line carries, for a console tracked
     * before its launch was known: pending until readiness, cleaned up
     * at once if it is ready already, dropped if it has closed.
     */
    carry(terminal: TTerminal, send: PendingSend): void {
        const entry = this.entries.get(terminal);
        if (!entry) {
            this.host.delete_file(send.temp_file_path);
            return;
        }
        if (entry.state === 'ready') {
            this.host.schedule_cleanup(send.temp_file_path);
            return;
        }
        entry.baked.push(send);
        this.report_pending_count();
    }

    is_tracked(terminal: TTerminal): boolean {
        return this.entries.has(terminal);
    }

    get_state(terminal: TTerminal): ConsoleTerminalState | undefined {
        return this.entries.get(terminal)?.state;
    }

    /**
     * Type `send` into a ready terminal, or queue it with its temp file
     * while the terminal starts. Returns true if it was queued: the
     * queue then owns the temp file.
     */
    send(terminal: TTerminal, send: PendingSend): boolean {
        const entry = this.entries.get(terminal);
        if (!entry) {
            throw new Error('Not a sight console terminal.');
        }
        if (entry.state === 'ready') {
            this.host.type_send(terminal, send);
            return false;
        }
        entry.pending.push(send);
        this.report_pending_count();
        return true;
    }

    /** Sends not yet typed, dispatched or dropped. */
    pending_count(): number {
        let count = this.dispatching_count;
        for (const my_entry of this.entries.values()) {
            count += my_entry.baked.length + my_entry.pending.length;
        }
        if (this.showing_offer) {
            count += this.showing_offer.pending.length;
        }
        return count;
    }

    /**
     * Handle a console terminal closing. Resolves when its pending
     * sends have been typed, dispatched or dropped (for an offer, when
     * the offer is answered and dispatch finishes).
     */
    handle_closed(terminal: TTerminal, exit: ConsoleExit): Promise<void> {
        const entry = this.entries.get(terminal);
        if (!entry) {
            return Promise.resolve();
        }
        this.entries.delete(terminal);
        entry.state = 'closed';

        const the_sends = take_all(entry);
        const reason = exit.code === undefined || exit.backend === 'pty'
            ? undefined
            : CONSOLE_OFFER_REASONS.get(exit.code);

        if (exit.reason !== 'process' || reason === undefined) {
            this.drop(the_sends);
            if (exit.reason !== 'user' && the_sends.length > 0) {
                this.host.show_notice(
                    `Dropped ${count_sends(the_sends.length)} to Stata: `
                    + `${describe_drop(exit)}.`
                );
            }
            this.report_pending_count();
            return Promise.resolve();
        }

        if (exit.code === CONSOLE_EXIT_SEND_FROM_EDITOR) {
            // The user chose to send from the editor: act as "This
            // session" without asking, and don't wait on a showing
            // offer.
            this.host.set_session_override();
            return this.dispatch(the_sends, 1);
        }
        if (this.host.is_fallback_in_effect()) {
            return this.dispatch(the_sends, 1);
        }
        if (this.showing_offer) {
            // The notification can't be updated in place; these sends
            // follow the showing offer's answer.
            this.showing_offer.pending.push(...the_sends);
            this.showing_offer.terminal_count += 1;
            this.report_pending_count();
            return this.showing_offer.done;
        }
        return this.make_offer(reason ?? '', the_sends);
    }

    /**
     * Stop tracking a pane that couldn't start, handing back its
     * pending sends (and their temp files) to send some other way.
     */
    take_pending(terminal: TTerminal): PendingSend[] {
        const entry = this.entries.get(terminal);
        if (!entry) {
            return [];
        }
        this.entries.delete(terminal);
        entry.state = 'closed';
        const the_sends = take_all(entry);
        this.report_pending_count();
        return the_sends;
    }

    /** Forget every pane (extension deactivation). */
    dispose(): void {
        this.entries.clear();
    }

    private make_offer(
        reason: string,
        the_sends: PendingSend[]
    ): Promise<void> {
        const offer: ShowingOffer = {
            pending: the_sends,
            terminal_count: 1,
            done: Promise.resolve(),
        };
        this.showing_offer = offer;
        this.report_pending_count();
        offer.done = this.run_offer(offer, format_offer_message(reason));
        return offer.done;
    }

    private async run_offer(
        offer: ShowingOffer,
        message: string
    ): Promise<void> {
        const answer = await this.ask_with_timeout(message);
        let use_app = false;
        if (answer === OFFER_CHOICE_SESSION) {
            this.host.set_session_override();
            use_app = true;
        } else if (answer === OFFER_CHOICE_ALWAYS) {
            await this.apply_always();
            use_app = true;
        }

        // Closes during the answer joined `offer.pending`; later ones
        // see the setting just applied or make a new offer.
        if (this.showing_offer === offer) {
            this.showing_offer = null;
        }
        const the_sends = offer.pending;
        offer.pending = [];

        if (use_app) {
            await this.dispatch(the_sends, offer.terminal_count);
            return;
        }
        this.drop(the_sends);
        if (answer === OFFER_TIMED_OUT && the_sends.length > 0) {
            this.host.show_notice(
                `Dropped ${count_sends(the_sends.length)} to Stata: the `
                + 'offer to use the Stata app went unanswered.'
            );
        }
        this.report_pending_count();
    }

    private async ask_with_timeout(
        message: string
    ): Promise<OfferAnswer | typeof OFFER_TIMED_OUT> {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<typeof OFFER_TIMED_OUT>(resolve => {
            timer = setTimeout(
                () => resolve(OFFER_TIMED_OUT),
                this.timings.offer_timeout_ms
            );
        });
        try {
            return await Promise.race([
                this.host.show_offer(message).catch(() => undefined),
                timeout,
            ]);
        } finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
    }

    private async apply_always(): Promise<void> {
        let is_effective = false;
        try {
            is_effective = await this.host.write_always();
        } catch (my_error) {
            this.host.show_error(
                'Could not save sight.sendToStata.target: '
                + `${my_error instanceof Error ? my_error.message : my_error}`
                + '. Using the Stata app for this session.'
            );
            this.host.set_session_override();
            return;
        }
        if (!is_effective) {
            this.host.set_session_override();
            this.host.show_notice(
                'Set sight.sendToStata.target to "external" in your user '
                + 'settings, but a workspace or folder setting overrides '
                + 'it. Using the Stata app for this session.'
            );
        }
    }

    /**
     * Send each pending send to the app, in order. On the first
     * failure the existing error shows and the rest are dropped.
     */
    private async dispatch(
        the_sends: PendingSend[],
        terminal_count: number
    ): Promise<void> {
        this.dispatching_count += the_sends.length;
        this.report_pending_count();
        let sent_count = 0;
        for (let i = 0; i < the_sends.length; i++) {
            const my_send = the_sends[i];
            this.dispatching_count -= 1;
            try {
                await this.host.dispatch_to_app(my_send);
                this.host.schedule_cleanup(my_send.temp_file_path);
                sent_count += 1;
            } catch (my_error) {
                this.host.delete_file(my_send.temp_file_path);
                this.host.show_error(
                    'Error: '
                    + `${my_error instanceof Error ? my_error.message : my_error}`
                );
                const the_rest = the_sends.slice(i + 1);
                this.dispatching_count -= the_rest.length;
                this.drop(the_rest);
                this.report_pending_count();
                if (the_rest.length > 0) {
                    this.host.show_notice(
                        `Dropped ${count_sends(the_rest.length)} to Stata `
                        + 'after the error.'
                    );
                }
                return;
            }
            this.report_pending_count();
        }
        if (terminal_count > 1) {
            this.host.show_notice(
                `Sent ${count_sends(sent_count)} to the Stata app.`
            );
        }
    }

    private drop(the_sends: PendingSend[]): void {
        for (const my_send of the_sends) {
            this.host.delete_file(my_send.temp_file_path);
        }
    }

    private make_ready(terminal: TTerminal, entry: ConsoleTerminalEntry) {
        if (entry.state !== 'starting') {
            return;
        }
        entry.state = 'ready';
        for (const my_send of entry.baked) {
            this.host.schedule_cleanup(my_send.temp_file_path);
        }
        entry.baked = [];
        const the_sends = entry.pending;
        entry.pending = [];
        for (let i = 0; i < the_sends.length; i++) {
            const my_send = the_sends[i];
            try {
                this.host.type_send(terminal, my_send);
            } catch (my_error) {
                // The terminal went away before its close event.
                const the_rest = the_sends.slice(i);
                this.drop(the_rest);
                this.host.show_error(
                    `Dropped ${count_sends(the_rest.length)} to Stata: `
                    + `${my_error instanceof Error ? my_error.message : my_error}`
                );
                break;
            }
            // The cleanup delay counts from when Stata is handed the
            // file, not from when the send was made.
            this.host.schedule_cleanup(my_send.temp_file_path);
        }
        this.report_pending_count();
    }

    private report_pending_count(): void {
        this.host.on_pending_count_changed(this.pending_count());
    }
}

/**
 * Perch (github.com/jbearak/perch) keeps terminal sessions alive
 * across closed windows and dropped connections. In a remote window
 * with Perch installed on the remote host, Sight runs its Stata console
 * in a Perch session; everywhere else nothing here runs.
 *
 * This is the VS Code-free part: finding Perch and keeping track of
 * Sight's sessions (as in the `connectPerch` sample of Perch's
 * docs/api.md), and building a session's launch. perch.ts adapts it to
 * VS Code; stata-terminal-manager.ts uses it.
 */

import type {
    PerchCreateOptions,
    PerchExports,
    PerchSessionInfo,
} from './perch-api.js';

export const PERCH_EXTENSION_ID = 'jbearak.perch';
/** Sight's extension ID: the owner of the sessions it creates. */
export const PERCH_CALLER_ID = 'jbearak.sight';
export const PERCH_API_VERSION = 1;
export const PERCH_SESSION_KIND = 'stata';

/** Which program a Sight session runs, as an annotation. */
export const PERCH_CONSOLE_ANNOTATION = 'sight.console';
/** The editor console (console-runtime/tty.js). */
export const PERCH_CONSOLE_EDITOR = 'editor';
/** The Stata CLI itself (sight.sendToStata.console off). */
export const PERCH_CONSOLE_STATA = 'stata';
export type PerchConsoleMode =
    | typeof PERCH_CONSOLE_EDITOR
    | typeof PERCH_CONSOLE_STATA;

/** Written by tty.js in the session directory at the first prompt. */
export const PERCH_READY_FILE = 'sight-console-ready';
/** Written by tty.js when the console ends on its own. */
export const PERCH_END_FILE = 'sight-console-end';

const LIVE_STATES: ReadonlySet<PerchSessionInfo['state']> = new Set([
    'starting', 'running', 'unresponsive',
]);

/**
 * Escape literal braces for `perch new`, which expands `{dir}` and
 * `{id}` in a session's command and env and rejects any other lone
 * brace. Every string that isn't Sight's own `{dir}` goes through this.
 */
export function escape_perch_braces(text: string): string {
    return text.replace(/[{}]/g, brace => brace + brace);
}

export function is_live_session(session: PerchSessionInfo): boolean {
    return LIVE_STATES.has(session.state);
}

export function console_mode_of(
    session: PerchSessionInfo
): PerchConsoleMode {
    return session.annotations[PERCH_CONSOLE_ANNOTATION]
        === PERCH_CONSOLE_EDITOR
        ? PERCH_CONSOLE_EDITOR
        : PERCH_CONSOLE_STATA;
}

// ---- Launch ----

export interface PerchFirstSend {
    command: string;
    /** The temp file's path, already quoted for Stata. */
    quoted_path: string;
}

export interface PerchLaunchSpec {
    mode: PerchConsoleMode;
    /** The Stata CLI (stata-mp, ...). */
    stata_path: string;
    working_directory?: string;
    /** Run by Stata (or typed by the console) once it starts. */
    first_send?: PerchFirstSend;
    /** Editor console only. */
    editor?: {
        /** The extension host's Node (process.execPath). */
        node_path: string;
        /** console-runtime/tty.js. */
        tty_script: string;
        /** The sight-pty helper. */
        helper_path: string;
    };
}

/**
 * The options for `createSession`: the editor console under the
 * extension host's Node, or the Stata CLI. The first send rides on the
 * command line, so a Stata still starting can't lose it.
 */
export function build_perch_launch(
    spec: PerchLaunchSpec
): PerchCreateOptions {
    const esc = escape_perch_braces;
    const options: PerchCreateOptions = {
        name: 'Stata',
        kind: PERCH_SESSION_KIND,
        command: [],
        annotations: { [PERCH_CONSOLE_ANNOTATION]: spec.mode },
    };
    if (spec.working_directory !== undefined) {
        // Not expanded by Perch.
        options.cwd = spec.working_directory;
    }
    const first = spec.first_send;
    if (spec.mode === PERCH_CONSOLE_STATA || !spec.editor) {
        options.command = [esc(spec.stata_path)];
        if (first) {
            options.command.push(esc(first.command), esc(first.quoted_path));
        }
        options.annotations = {
            [PERCH_CONSOLE_ANNOTATION]: PERCH_CONSOLE_STATA,
        };
        return options;
    }
    const editor = spec.editor;
    options.command = [
        esc(editor.node_path),
        esc(editor.tty_script),
        '--helper', esc(editor.helper_path),
        '--stata', esc(spec.stata_path),
        '--ready-file', `{dir}/${PERCH_READY_FILE}`,
        '--end-file', `{dir}/${PERCH_END_FILE}`,
    ];
    if (spec.working_directory !== undefined) {
        options.command.push('--cwd', esc(spec.working_directory));
    }
    if (first) {
        options.command.push(
            '--run', esc(`${first.command} ${first.quoted_path}`)
        );
    }
    // process.execPath is Electron in a local window; this makes it
    // Node (and is harmless for the VS Code server's node).
    options.env = { ELECTRON_RUN_AS_NODE: '1' };
    return options;
}

// ---- Finding Perch and tracking Sight's sessions ----

export interface Disposable {
    dispose(): unknown;
}

type EventLike<T> = (listener: (event: T) => unknown) => Disposable;

/** The part of Perch's API that tracking uses. */
export interface PerchTrackingApi<TTerminal> {
    available(): Promise<boolean>;
    terminals(): ReadonlyArray<{
        session: PerchSessionInfo;
        terminal: TTerminal;
    }>;
    listSessions(
        filter?: { owner?: string; kind?: string }
    ): Promise<PerchSessionInfo[]>;
    readonly onDidAttach: EventLike<{
        session: PerchSessionInfo;
        terminal: TTerminal;
    }>;
    readonly onDidEndSession: EventLike<PerchSessionInfo>;
}

export interface PerchExtensionLike {
    readonly isActive: boolean;
    readonly exports: unknown;
    activate(): PromiseLike<unknown>;
}

/** What Sight knows about its sessions after a lookup. */
export interface PerchTracked<TTerminal> {
    sessions: Map<string, PerchSessionInfo>;
    /** Sessions with a Perch terminal in this window. */
    terminals: Map<string, TTerminal>;
}

export interface PerchConnectionHost<TApi, TTerminal> {
    /**
     * The window is remote and Sight runs in the remote (workspace)
     * extension host, next to Perch.
     */
    is_remote_workspace(): boolean;
    find_extension(): PerchExtensionLike | undefined;
    /** Narrow `getApi`'s result; undefined if it isn't usable. */
    to_api(value: unknown): TApi | undefined;
    log(message: string): void;
    /** A lookup finished: this is now the API (if any) and state. */
    on_connected(api: TApi | undefined, tracked: PerchTracked<TTerminal>): void;
    /** After a lookup: a terminal of this window attached to a session. */
    on_attach(session: PerchSessionInfo, terminal: TTerminal): void;
    /** After a lookup: one of Sight's sessions ended. */
    on_end(session: PerchSessionInfo): void;
}

function empty_tracked<TTerminal>(): PerchTracked<TTerminal> {
    return { sessions: new Map(), terminals: new Map() };
}

function describe_error(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function has_get_api(value: unknown): value is PerchExports {
    return typeof value === 'object' && value !== null
        && typeof (value as { getApi?: unknown }).getApi === 'function';
}

/**
 * Finds Perch and keeps Sight's sessions. Each `connect()` builds the
 * state aside and swaps it in only when it is still the latest lookup,
 * so sessions don't vanish while it runs. It never rejects.
 */
export class PerchConnection<
    TApi extends PerchTrackingApi<TTerminal>,
    TTerminal,
> {
    private current_api: TApi | undefined;
    private current_tracked: PerchTracked<TTerminal> = empty_tracked();
    private events: Disposable | undefined;
    private generation = 0;
    private latest: Promise<void> | null = null;

    constructor(private readonly host: PerchConnectionHost<TApi, TTerminal>) {}

    get api(): TApi | undefined {
        return this.current_api;
    }

    get tracked(): PerchTracked<TTerminal> {
        return this.current_tracked;
    }

    /**
     * Perch might be in use for a new console: the synchronous checks
     * pass. Without Perch nothing else is awaited.
     */
    may_use_perch(): boolean {
        return this.host.is_remote_workspace()
            && this.host.find_extension() !== undefined;
    }

    /** Settles when the latest lookup has. */
    settled(): Promise<void> {
        return this.latest ?? Promise.resolve();
    }

    /** Look Perch up again (activation, `extensions.onDidChange`). */
    connect(): Promise<void> {
        const current = ++this.generation;
        this.latest = this.run(current);
        return this.latest;
    }

    /** Stop: later lookups' results and events are discarded. */
    dispose(): void {
        this.generation++;
        this.events?.dispose();
        this.events = undefined;
    }

    private async find_api(): Promise<TApi | undefined> {
        if (!this.host.is_remote_workspace()) {
            return undefined;
        }
        const extension = this.host.find_extension();
        if (extension === undefined) {
            return undefined;
        }
        const exports = extension.isActive
            ? extension.exports
            : await extension.activate();
        if (!has_get_api(exports)) {
            return undefined;
        }
        const api = this.host.to_api(
            exports.getApi(PERCH_API_VERSION, PERCH_CALLER_ID)
        );
        if (api === undefined || !(await api.available())) {
            return undefined;
        }
        return api;
    }

    private async run(current: number): Promise<void> {
        let events: Disposable | undefined;
        try {
            const api = await this.find_api();
            if (current !== this.generation) {
                return;
            }
            const next = empty_tracked<TTerminal>();
            if (api !== undefined) {
                // 1. Subscribe first. While the listing runs, note
                // which sessions events changed.
                let changed_by_events: Set<string> | undefined = new Set();
                const is_live = (): boolean => this.current_tracked === next;
                const attach = api.onDidAttach(({ session, terminal }) => {
                    changed_by_events?.add(session.id);
                    if (session.owner !== PERCH_CALLER_ID) {
                        return;
                    }
                    if (!is_live_session(session)) {
                        this.forget(next, session);
                        return;
                    }
                    next.sessions.set(session.id, session);
                    next.terminals.set(session.id, terminal);
                    if (is_live()) {
                        this.host.on_attach(session, terminal);
                    }
                });
                const end = api.onDidEndSession((session) => {
                    changed_by_events?.add(session.id);
                    if (session.owner !== undefined
                        && session.owner !== PERCH_CALLER_ID) {
                        return;
                    }
                    this.forget(next, session);
                });
                events = {
                    dispose: () => {
                        attach.dispose();
                        end.dispose();
                    },
                };
                // 2. Then the snapshots.
                for (const { session, terminal } of api.terminals()) {
                    if (session.owner === PERCH_CALLER_ID
                        && is_live_session(session)) {
                        next.sessions.set(session.id, session);
                        next.terminals.set(session.id, terminal);
                    }
                }
                const the_listed = await api.listSessions({
                    owner: PERCH_CALLER_ID,
                });
                if (current !== this.generation) {
                    return;
                }
                // 3. Events are newer than the listing.
                for (const my_session of the_listed) {
                    if (changed_by_events.has(my_session.id)) {
                        continue;
                    }
                    if (is_live_session(my_session)) {
                        next.sessions.set(my_session.id, my_session);
                    } else {
                        this.forget(next, my_session);
                    }
                }
                changed_by_events = undefined;
            }
            // 4. Swap in the new state.
            this.events?.dispose();
            this.events = events;
            this.current_api = api;
            this.current_tracked = next;
            this.host.on_connected(api, next);
        } catch (my_error) {
            // Perch failed: keep what we had.
            this.host.log(`Perch lookup failed: ${describe_error(my_error)}`);
        } finally {
            if (events !== this.events) {
                events?.dispose();
            }
        }
    }

    private forget(
        tracked: PerchTracked<TTerminal>,
        session: PerchSessionInfo
    ): void {
        tracked.sessions.delete(session.id);
        tracked.terminals.delete(session.id);
        if (this.current_tracked === tracked) {
            this.host.on_end(session);
        }
    }
}

/**
 * Sight's live sessions without a Perch terminal in this window, that
 * Sight isn't already using: the user may pick one, but none gets code
 * on its own.
 */
export function candidate_sessions<TTerminal>(
    tracked: PerchTracked<TTerminal>,
    is_in_use: (id: string) => boolean
): PerchSessionInfo[] {
    const the_candidates: PerchSessionInfo[] = [];
    for (const my_session of tracked.sessions.values()) {
        if (
            !tracked.terminals.has(my_session.id)
            && !is_in_use(my_session.id)
            && is_live_session(my_session)
        ) {
            the_candidates.push(my_session);
        }
    }
    return the_candidates;
}

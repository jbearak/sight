/**
 * The types of Perch's extension API, version 1, copied from Perch
 * (github.com/jbearak/perch, editors/vscode/src/vscode/api.ts and
 * docs/api.md). Perch is not a dependency: Sight finds it at run time
 * through `vscode.extensions.getExtension('jbearak.perch')`.
 */

import type * as vscode from 'vscode';

export interface PerchSessionInfo {
    /** 8 characters, [a-z0-9]. */
    id: string;
    name: string;
    /** 'r', 'stata', 'shell', ... */
    kind: string;
    /** The callerId that created it. */
    owner?: string;
    annotations: Record<string, string>;
    /** The session directory, `{dir}`. */
    dir: string;
    /** Problems the session has had, e.g. 'directory-recreated'. */
    degraded: string[];
    cwd: string;
    host: string;
    /** RFC 3339, UTC. */
    createdAt: string;
    state: 'starting' | 'running' | 'exited' | 'lost' | 'unresponsive';
    /** A terminal is attached, here or anywhere. */
    attached: boolean;
    /** Attached by a terminal of this window. */
    attachedHere: boolean;
    lastOutputAt?: string;
    memoryBytes?: number;
    exit?: { code?: number; signal?: string };
}

export interface PerchCreateOptions {
    /** The session's and the terminal's name. */
    name: string;
    kind: string;
    /** `{dir}` and `{id}` expand; `{{` and `}}` are literal braces. */
    command: string[];
    cwd?: string;
    /** `{dir}` and `{id}` expand in values. */
    env?: Record<string, string>;
    annotations?: Record<string, string>;
    terminal?: {
        location?: vscode.TerminalLocation;
        iconPath?: vscode.TerminalOptions['iconPath'];
        color?: vscode.ThemeColor;
    };
}

export interface PerchApiV1 {
    readonly version: 1;
    available(): Promise<boolean>;
    prepareLaunch(options: PerchCreateOptions): {
        id: string;
        options: vscode.TerminalOptions;
    };
    createSession(options: PerchCreateOptions & { show?: boolean }): Promise<{
        session: PerchSessionInfo;
        terminal: vscode.Terminal;
    }>;
    waitForSession(
        id: string, terminal: vscode.Terminal
    ): Promise<PerchSessionInfo>;
    listSessions(
        filter?: { owner?: string; kind?: string }
    ): Promise<PerchSessionInfo[]>;
    terminals(): ReadonlyArray<{
        session: PerchSessionInfo;
        terminal: vscode.Terminal;
    }>;
    attach(
        id: string, options?: { show?: boolean }
    ): Promise<vscode.Terminal>;
    sessionForTerminal(
        terminal: vscode.Terminal
    ): PerchSessionInfo | undefined;
    send(
        id: string,
        text: string,
        options?: { paste?: boolean; submit?: boolean }
    ): Promise<'queued'>;
    kill(id: string, options?: { force?: boolean }): Promise<void>;
    annotate(
        id: string, set: Record<string, string>, unset?: string[]
    ): Promise<void>;
    readonly onDidChangeSessions: vscode.Event<void>;
    readonly onDidAttach: vscode.Event<{
        session: PerchSessionInfo;
        terminal: vscode.Terminal;
    }>;
    readonly onDidEndSession: vscode.Event<PerchSessionInfo>;
}

/** What Perch's extension exports. */
export interface PerchExports {
    getApi(version: number, callerId: string): unknown;
}

/**
 * `PerchApiError.code` (check the code, not `instanceof`: the class
 * isn't exported).
 */
export type PerchApiErrorCode =
    | 'queue_full'
    | 'outcome_unknown'
    | 'no_session'
    | 'unavailable';

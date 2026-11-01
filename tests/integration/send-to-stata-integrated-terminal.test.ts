import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    mock,
    test,
} from 'bun:test';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { wait_until } from '../wait-until';
import { VSCODE_MOCK_SHARED_EXPORTS } from '../vscode-mock-shared-exports';

const SEND_TO_STATA_DIR = path.resolve(
    import.meta.dir,
    '../../client/src/send-to-stata'
);
const TERMINAL_MANAGER_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'stata-terminal-manager.ts')
).href;
const CLI_DETECTOR_MODULE_PATH = path.join(
    SEND_TO_STATA_DIR,
    'stata-cli-detector.ts'
);
const CLI_DETECTOR_MODULE_URL = pathToFileURL(
    CLI_DETECTOR_MODULE_PATH
).href;
const INDEX_MODULE_PATH = path.join(
    SEND_TO_STATA_DIR,
    'index.ts'
);
const INDEX_MODULE_URL = pathToFileURL(
    INDEX_MODULE_PATH
).href;
const TERMINAL_MODULE_PATH = path.join(
    SEND_TO_STATA_DIR,
    'terminal.ts'
);
const TERMINAL_MODULE_URL = pathToFileURL(
    TERMINAL_MODULE_PATH
).href;
const COMMANDS_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'commands.ts')
).href;
const TEMP_FILE_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'temp-file.ts')
).href;
const TARGET_CHOICE_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'target-choice.ts')
).href;
const WINDOWS_SENDER_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'windows-sender.ts')
).href;

/** A cancellation token that is never cancelled. */
const NO_CANCEL = { isCancellationRequested: false };
const TERMINAL_EXIT_REASON = VSCODE_MOCK_SHARED_EXPORTS.TerminalExitReason;
const CONFIGURATION_TARGET_GLOBAL =
    VSCODE_MOCK_SHARED_EXPORTS.ConfigurationTarget.Global;

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}

interface MockTerminal {
    name: string;
    processId: Promise<number | undefined>;
    show: (preserveFocus?: boolean) => void;
    sendText: (text: string) => void;
    // `reason` is absent on VS Code before 1.77.
    exitStatus?: { code: number | undefined; reason?: number };
    creationOptions?: CreateTerminalOptions;
}

interface CreateTerminalOptions {
    name?: string;
    shellPath?: string;
    shellArgs?: string[];
    env?: Record<string, string>;
    pty?: MockPty;
}

interface MockPty {
    onDidWrite: (listener: (text: string) => void) => { dispose(): void };
    onDidClose?: (listener: (code: number | void) => void) => {
        dispose(): void;
    };
    open(dimensions?: { columns: number; rows: number }): void;
    close(): void;
    handleInput?(data: string): void;
}

interface TargetSettingValues {
    globalValue?: string;
    workspaceValue?: string;
}

interface WarningCall {
    message: string;
    the_items: string[];
    modal?: boolean;
    answer: Deferred<string | undefined>;
}

interface VscodeMockState {
    create_terminal_calls: number;
    the_create_options: CreateTerminalOptions[];
    the_close_listeners: Array<(terminal: MockTerminal) => void>;
    the_open_listeners: Array<(terminal: MockTerminal) => void>;
    the_config_listeners: Array<(event: {
        affectsConfiguration: (section: string) => boolean;
    }) => void>;
    the_profile_providers: Map<string, {
        provideTerminalProfile: (token?: unknown) => unknown;
    }>;
    the_send_calls: string[];
    the_show_calls: boolean[];
    the_warning_calls: WarningCall[];
    the_info_messages: string[];
    /** Labels of each quick pick shown, and the label to answer. */
    the_quick_picks: string[][];
    quick_pick_answer?: string;
    the_error_messages: string[];
    the_update_calls: Array<[string, unknown, number]>;
    the_cleanups: string[];
    the_app_dispatches: string[];
    the_failing_app_paths: Set<string>;
    status_item: { text: string; is_shown: boolean } | null;
    target_setting: TargetSettingValues | null;
    /** sight.sendToStata.console, when set. */
    console_setting?: string;
    active_text_editor?: unknown;
    terminal: MockTerminal;
    /** When set, each createTerminal call makes a new terminal. */
    make_terminal?: (options: CreateTerminalOptions) => MockTerminal;
    /** vscode.env.remoteName ('' for a local window). */
    remote_name?: string;
    /** The installed jbearak.perch, if any. */
    perch_extension?: unknown;
    the_get_extension_ids: string[];
    the_extension_listeners: Array<() => void>;
    /** The first workspace folder's path, if any. */
    workspace_folder?: string;
    /** What the Stata CLI detector finds. */
    stata_cli?: string;
}

interface SharedVscodeTestState {
    registered_commands?: Map<string, (...args: unknown[]) => unknown>;
    error_messages?: string[];
    active_text_editor?: unknown;
    on_terminal_send_text?: (text: string) => void;
}

let current_vscode_state: VscodeMockState | null = null;
let registered_module_mocks = false;
const SHARED_VSCODE_TEST_STATE_KEY = '__sight_shared_vscode_test_state';

function get_shared_vscode_test_state():
    SharedVscodeTestState | null {
    return (globalThis as Record<string, SharedVscodeTestState | undefined>)[
        SHARED_VSCODE_TEST_STATE_KEY
    ] ?? null;
}

function create_deferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((the_resolve, the_reject) => {
        resolve = the_resolve;
        reject = the_reject;
    });
    return { promise, resolve, reject };
}

function create_vscode_mock_state(
    process_id_promise: Promise<number | undefined>
): VscodeMockState {
    const the_send_calls: string[] = [];
    const the_show_calls: boolean[] = [];
    const the_close_listeners: Array<(terminal: MockTerminal) => void> = [];

    const terminal: MockTerminal = {
        name: 'Stata',
        processId: process_id_promise,
        show: (preserve_focus = false) => {
            the_show_calls.push(preserve_focus);
        },
        sendText: (text: string) => {
            the_send_calls.push(text);
        },
    };

    return {
        create_terminal_calls: 0,
        the_create_options: [],
        the_close_listeners,
        the_open_listeners: [],
        the_config_listeners: [],
        the_profile_providers: new Map(),
        the_send_calls,
        the_show_calls,
        the_warning_calls: [],
        the_info_messages: [],
        the_quick_picks: [],
        the_error_messages: [],
        the_update_calls: [],
        the_cleanups: [],
        the_app_dispatches: [],
        the_failing_app_paths: new Set(),
        status_item: null,
        target_setting: null,
        terminal,
        the_get_extension_ids: [],
        the_extension_listeners: [],
    };
}

function get_effective_target(
    values: TargetSettingValues | null
): string | undefined {
    return values?.workspaceValue ?? values?.globalValue;
}

/** Register a disposable listener on a mock-state listener list. */
function add_listener<T>(the_listeners: T[], listener: T) {
    the_listeners.push(listener);
    return {
        dispose: () => {
            const idx = the_listeners.indexOf(listener);
            if (idx !== -1) {
                the_listeners.splice(idx, 1);
            }
        },
    };
}

// Shared polling helper (tests/wait-until.ts); these call sites keep the
// pre-extraction timing: a tight 200ms budget with 0ms yields.
function wait_for_condition(
    predicate: () => boolean,
    description: string
): Promise<void> {
    return wait_until(predicate, description, 200, 0);
}

async function import_terminal_manager_module(
    vscode_state: VscodeMockState
) {
    current_vscode_state = vscode_state;

    const terminal_manager = await import(
        `${TERMINAL_MANAGER_MODULE_URL}?test=${Date.now()}-${Math.random()}`
    );
    terminal_manager.reset_stata_terminal_manager_for_tests();
    return terminal_manager;
}

function register_module_mocks(): void {
    if (registered_module_mocks) {
        return;
    }
    registered_module_mocks = true;

    mock.module('vscode', () => ({
        ...VSCODE_MOCK_SHARED_EXPORTS,
        env: {
            get remoteName() {
                return current_vscode_state?.remote_name ?? '';
            },
        },
        extensions: {
            getExtension: (id: string) => {
                current_vscode_state?.the_get_extension_ids.push(id);
                return id === 'jbearak.perch'
                    ? current_vscode_state?.perch_extension
                    : undefined;
            },
            onDidChange: (listener: () => void) => {
                if (!current_vscode_state) {
                    return { dispose: () => {} };
                }
                return add_listener(
                    current_vscode_state.the_extension_listeners,
                    listener
                );
            },
            all: [],
        },
        workspace: {
            get workspaceFolders() {
                const folder = current_vscode_state?.workspace_folder;
                return folder ? [{ uri: { fsPath: folder } }] : undefined;
            },
            getConfiguration: (section?: string) => ({
                get: <T>(key: string, default_value?: T): T => {
                    const console_setting =
                        current_vscode_state?.console_setting;
                    if (
                        console_setting
                        && section === 'sight.sendToStata'
                        && key === 'console'
                    ) {
                        return console_setting as T;
                    }
                    const values = current_vscode_state?.target_setting;
                    if (
                        values
                        && section === 'sight.sendToStata'
                        && key === 'target'
                    ) {
                        return (get_effective_target(values)
                            ?? default_value) as T;
                    }
                    return default_value as T;
                },
                inspect: (key: string) => {
                    const values = current_vscode_state?.target_setting;
                    if (!values || key !== 'target') {
                        return undefined;
                    }
                    return { key, ...values };
                },
                update: async (
                    key: string,
                    value: unknown,
                    target: number
                ) => {
                    const state = current_vscode_state;
                    if (!state) {
                        return;
                    }
                    state.the_update_calls.push([key, value, target]);
                    state.target_setting = {
                        ...state.target_setting,
                        globalValue: value as string,
                    };
                    for (const my_listener of [
                        ...state.the_config_listeners,
                    ]) {
                        my_listener({
                            affectsConfiguration: (name: string) =>
                                name === 'sight.sendToStata.target',
                        });
                    }
                },
            }),
            getWorkspaceFolder: () => null,
            onDidChangeConfiguration: (
                listener: VscodeMockState['the_config_listeners'][number]
            ) => {
                if (!current_vscode_state) {
                    return { dispose: () => {} };
                }
                return add_listener(
                    current_vscode_state.the_config_listeners,
                    listener
                );
            },
        },
        window: {
            createTerminal: (options?: CreateTerminalOptions) => {
                if (current_vscode_state) {
                    current_vscode_state.create_terminal_calls += 1;
                    current_vscode_state.the_create_options.push(
                        options ?? {}
                    );
                    if (current_vscode_state.make_terminal) {
                        return current_vscode_state.make_terminal(
                            options ?? {}
                        );
                    }
                    return current_vscode_state.terminal;
                }
                const shared_state = get_shared_vscode_test_state();
                return {
                    name: 'Stata',
                    processId: Promise.resolve(1234),
                    show: () => {},
                    sendText: (text: string) => {
                        shared_state?.on_terminal_send_text?.(text);
                    },
                };
            },
            onDidCloseTerminal: (
                listener: (terminal: MockTerminal) => void
            ) => {
                if (!current_vscode_state) {
                    return { dispose: () => {} };
                }
                return add_listener(
                    current_vscode_state.the_close_listeners,
                    listener
                );
            },
            onDidOpenTerminal: (
                listener: (terminal: MockTerminal) => void
            ) => {
                if (!current_vscode_state) {
                    return { dispose: () => {} };
                }
                return add_listener(
                    current_vscode_state.the_open_listeners,
                    listener
                );
            },
            onDidChangeActiveTerminal: () => ({ dispose: () => {} }),
            registerTerminalProfileProvider: (
                id: string,
                provider: {
                    provideTerminalProfile: (token?: unknown) => unknown;
                }
            ) => {
                current_vscode_state?.the_profile_providers.set(
                    id, provider
                );
                return { dispose: () => {} };
            },
            createStatusBarItem: () => {
                const item = {
                    text: '',
                    tooltip: '',
                    is_shown: false,
                    show() {
                        item.is_shown = true;
                    },
                    hide() {
                        item.is_shown = false;
                    },
                    dispose() {},
                };
                if (current_vscode_state) {
                    current_vscode_state.status_item = item;
                }
                return item;
            },
            get activeTextEditor() {
                return current_vscode_state?.active_text_editor
                    ?? get_shared_vscode_test_state()?.active_text_editor;
            },
            showErrorMessage: (message: string) => {
                current_vscode_state?.the_error_messages.push(message);
                get_shared_vscode_test_state()
                    ?.error_messages
                    ?.push(message);
                return Promise.resolve(undefined);
            },
            showWarningMessage: (
                message: string,
                ...the_args: unknown[]
            ) => {
                if (!current_vscode_state) {
                    return Promise.resolve(undefined);
                }
                const answer = create_deferred<string | undefined>();
                const the_items = the_args.filter(
                    (my_arg): my_arg is string => typeof my_arg === 'string'
                );
                const modal = the_args.some(my_arg =>
                    typeof my_arg === 'object' && my_arg !== null
                    && (my_arg as { modal?: boolean }).modal === true
                );
                current_vscode_state.the_warning_calls.push({
                    message, the_items, answer, modal,
                });
                return answer.promise;
            },
            showInformationMessage: (message: string) => {
                current_vscode_state?.the_info_messages.push(message);
                return Promise.resolve(undefined);
            },
            showQuickPick: (the_items: Array<{ label: string }>) => {
                const state = current_vscode_state;
                if (!state) {
                    return Promise.resolve(undefined);
                }
                state.the_quick_picks.push(
                    the_items.map(my_item => my_item.label)
                );
                return Promise.resolve(the_items.find(
                    my_item => my_item.label === state.quick_pick_answer
                ));
            },
        },
        commands: {
            registerCommand: (
                name: string,
                handler: (...args: unknown[]) => unknown
            ) => {
                get_shared_vscode_test_state()
                    ?.registered_commands
                    ?.set(name, handler);
                return {
                    dispose: () => {
                        get_shared_vscode_test_state()
                            ?.registered_commands
                            ?.delete(name);
                    }
                };
            }
        },
        ThemeIcon: class ThemeIcon {
            constructor(public id: string) {}
        },
        Position: class Position {
            constructor(
                public line: number,
                public character: number
            ) {}
        },
        Selection: class Selection {
            constructor(
                public anchor: unknown,
                public active: unknown
            ) {}
        },
        Range: class Range {
            constructor(
                public start: unknown,
                public end: unknown
            ) {}
        },
    }));

    mock.module('vscode-languageclient/node', () => ({
        LanguageClient: class LanguageClient {},
    }));

    // Cleanups are recorded so a test can see when each temp file's
    // deletion was scheduled.
    mock.module(TEMP_FILE_MODULE_URL, () => ({
        DEFAULT_TEMP_FILE_CLEANUP_DELAY_MS: 30000,
        get_temp_dir: () => os.tmpdir(),
        schedule_temp_file_cleanup: (
            file_path: string,
            delay_ms = 30000
        ) => {
            current_vscode_state?.the_cleanups.push(file_path);
            // Delete like the real helper, since this mock outlives
            // the file (Bun keeps module mocks for later files).
            const my_timeout = setTimeout(() => {
                fs.promises.unlink(file_path).catch(() => {});
            }, delay_ms);
            my_timeout.unref?.();
            return my_timeout;
        },
        create_temp_file: async (content: string) => {
            const file_path = path.join(
                os.tmpdir(),
                `stata_send_${crypto.randomBytes(16).toString('hex')}.do`
            );
            await fs.promises.writeFile(file_path, content, 'utf8');
            return file_path;
        },
    }));

    mock.module(WINDOWS_SENDER_MODULE_URL, () => ({
        send_to_stata_windows: async (
            _command: string,
            temp_file_path: string
        ) => {
            const state = current_vscode_state;
            if (state?.the_failing_app_paths.has(temp_file_path)) {
                throw new Error('Executable not available');
            }
            state?.the_app_dispatches.push(temp_file_path);
        },
        ensure_executable: async () => null,
    }));

    mock.module(CLI_DETECTOR_MODULE_URL, () => ({
        detect_stata_cli: async () =>
            current_vscode_state?.stata_cli ?? '/usr/local/bin/stata-mp',
        clear_stata_cli_cache: () => {},
    }));

    mock.module(INDEX_MODULE_URL, () => ({
        VALID_COMMANDS: ['do', 'include'],
    }));

    mock.module(TERMINAL_MODULE_URL, () => ({
        wrap_path_for_stata_terminal: (my_path: string) => {
            return '`"' + my_path + `"'`;
        },
        send_to_terminal: async () => {},
    }));
}

describe.serial('Feature: integrated terminal first-send reliability', () => {
    beforeAll(register_module_mocks);

    beforeEach(() => {
        current_vscode_state = null;
    });

    afterAll(() => {
        current_vscode_state = null;
        mock.restore();
    });

    test('bakes the first command into shellArgs and does not type it', async () => {
        const process_id_deferred = create_deferred<number | undefined>();
        const vscode_state = create_vscode_mock_state(
            process_id_deferred.promise
        );
        const terminal_manager = await import_terminal_manager_module(
            vscode_state
        );

        const send_promise = terminal_manager.send_to_stata_terminal(
            'do',
            '/tmp/first.do'
        );

        await wait_for_condition(() => {
            return vscode_state.create_terminal_calls === 1;
        }, 'the send to create the Stata terminal');

        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_show_calls).toEqual([true]);
        // The first command runs via launch args, so Stata executes it
        // itself after init -- it is never typed into the racing REPL.
        expect(vscode_state.the_create_options[0].shellArgs).toEqual([
            'do',
            "`\"/tmp/first.do\"'",
        ]);
        expect(vscode_state.the_send_calls).toEqual([]);

        process_id_deferred.resolve(1234);
        await send_promise;

        // Still no sendText for the baked first command.
        expect(vscode_state.the_send_calls).toEqual([]);
    });

    test('reuses an existing managed terminal without another readiness wait', async () => {
        const process_id_deferred = create_deferred<number | undefined>();
        const vscode_state = create_vscode_mock_state(
            process_id_deferred.promise
        );
        const terminal_manager = await import_terminal_manager_module(
            vscode_state
        );

        const first_send = terminal_manager.send_to_stata_terminal(
            'do',
            '/tmp/first.do'
        );
        process_id_deferred.resolve(1234);
        await first_send;

        // First command was baked into shellArgs, not typed.
        expect(vscode_state.the_send_calls).toEqual([]);

        const second_send = terminal_manager.send_to_stata_terminal(
            'include',
            '/tmp/second.do'
        );
        await second_send;

        // Reused terminal: subsequent command IS typed (Stata is ready).
        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_create_options[0].shellArgs).toEqual([
            'do',
            "`\"/tmp/first.do\"'",
        ]);
        expect(vscode_state.the_send_calls).toEqual([
            "include `\"/tmp/second.do\"'",
        ]);
    });

    test('serializes concurrent sends while a new terminal is starting', async () => {
        const process_id_deferred = create_deferred<number | undefined>();
        const vscode_state = create_vscode_mock_state(
            process_id_deferred.promise
        );
        const terminal_manager = await import_terminal_manager_module(
            vscode_state
        );

        const first_send = terminal_manager.send_to_stata_terminal(
            'do',
            '/tmp/first.do'
        );
        const second_send = terminal_manager.send_to_stata_terminal(
            'include',
            '/tmp/second.do'
        );

        await wait_for_condition(() => {
            return vscode_state.create_terminal_calls === 1;
        }, 'the send to create the Stata terminal');

        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_send_calls).toEqual([]);

        process_id_deferred.resolve(1234);
        await Promise.all([first_send, second_send]);

        // One terminal: the initiating send is baked into shellArgs; the
        // send that joins the in-flight creation is typed after readiness.
        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_create_options[0].shellArgs).toEqual([
            'do',
            "`\"/tmp/first.do\"'",
        ]);
        expect(vscode_state.the_send_calls).toEqual([
            "include `\"/tmp/second.do\"'",
        ]);
    });

    test('rejects when the terminal closes before it becomes ready', async () => {
        const process_id_deferred = create_deferred<number | undefined>();
        const vscode_state = create_vscode_mock_state(
            process_id_deferred.promise
        );
        const terminal_manager = await import_terminal_manager_module(
            vscode_state
        );

        const send_promise = terminal_manager.send_to_stata_terminal(
            'do',
            '/tmp/first.do'
        );

        await wait_for_condition(() => {
            return vscode_state.create_terminal_calls === 1;
        }, 'the send to create the Stata terminal');

        for (const my_listener of vscode_state.the_close_listeners) {
            my_listener(vscode_state.terminal);
        }

        await expect(send_promise).rejects.toThrow(
            'closed before it was ready'
        );
        expect(vscode_state.the_send_calls).toEqual([]);
    });

    test('waits for readiness before the first send to a profile-opened terminal', async () => {
        const process_id_deferred = create_deferred<number | undefined>();
        const vscode_state = create_vscode_mock_state(
            process_id_deferred.promise
        );
        const terminal_manager = await import_terminal_manager_module(
            vscode_state
        );

        // Simulate the user opening a "Stata" terminal from the dropdown:
        // VS Code creates it and fires onDidOpenTerminal, which makes it
        // the active managed terminal. We did NOT create it, so its first
        // command cannot be baked into launch args -- it must be typed.
        terminal_manager.simulate_profile_terminal_opened_for_tests(
            vscode_state.terminal
        );

        // Send while Stata is still starting (processId unresolved).
        const send_promise = terminal_manager.send_to_stata_terminal(
            'do',
            '/tmp/first.do'
        );
        await wait_for_condition(() => {
            return vscode_state.the_show_calls.length === 1;
        }, 'the profile terminal to be revealed');

        // Must NOT type into the still-starting Stata yet.
        expect(vscode_state.the_send_calls).toEqual([]);

        process_id_deferred.resolve(1234);
        await send_promise;

        expect(vscode_state.the_send_calls).toEqual([
            "do `\"/tmp/first.do\"'",
        ]);
        // No new terminal was created; we reused the profile terminal.
        expect(vscode_state.create_terminal_calls).toBe(0);
    });

    test('rejects a send to a profile terminal that closes before ready', async () => {
        const process_id_deferred = create_deferred<number | undefined>();
        const vscode_state = create_vscode_mock_state(
            process_id_deferred.promise
        );
        const terminal_manager = await import_terminal_manager_module(
            vscode_state
        );

        terminal_manager.simulate_profile_terminal_opened_for_tests(
            vscode_state.terminal
        );

        const send_promise = terminal_manager.send_to_stata_terminal(
            'do',
            '/tmp/first.do'
        );

        // Terminal dies during startup, before processId resolves.
        for (const my_listener of vscode_state.the_close_listeners) {
            my_listener(vscode_state.terminal);
        }

        await expect(send_promise).rejects.toThrow(
            'closed before it was ready'
        );
        expect(vscode_state.the_send_calls).toEqual([]);
    });
});


const EXTENSION_PATH = path.join(os.tmpdir(), 'sight-test-extension');
const REAL_PLATFORM = process.platform;

interface ConsoleEndResult {
    code: number;
    took_stata: boolean;
    helper_failed?: boolean;
}

/** A fake of the console runtime's per-pane console. */
interface FakeConsole {
    the_inputs: string[];
    is_closed: boolean;
    ready: Deferred<boolean>;
    done: Deferred<ConsoleEndResult>;
    host: {
        write(text: string): void;
        ask(question: {
            kind: 'take_over' | 'keep';
            text: string;
            allow_send_instead: boolean;
        }): Promise<'yes' | 'no' | 'send'>;
        pty?: { helper_path: string; stata_path: string };
    };
}

interface ConsoleHarness {
    vscode_state: VscodeMockState;
    the_terminals: MockTerminal[];
    the_consoles: FakeConsole[];
    /** Codes each pane closed itself with (onDidClose), by terminal. */
    the_pane_closes: Map<MockTerminal, Array<number | void>>;
    the_pane_output: Map<MockTerminal, string[]>;
    terminal_manager: Record<string, (...args: never[]) => unknown> & {
        send_to_stata_terminal: (
            command: string,
            temp_file_path: string
        ) => Promise<boolean>;
        is_console_session_override_set: () => boolean;
    };
    commands_module: {
        resolve_effective_target: (
            target: 'app' | 'terminal'
        ) => Promise<string | null>;
        register_send_to_stata_commands: (context: unknown) => void;
    };
    context: { extensionPath: string; subscriptions: unknown[] };
}

function set_platform(platform: string): void {
    Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true,
    });
}

function create_fake_console_module(the_consoles: FakeConsole[]) {
    return {
        EDITOR_CONSOLE_API_VERSION: 2,
        start_editor_console: (host: FakeConsole['host']) => {
            const fake: FakeConsole = {
                the_inputs: [],
                is_closed: false,
                ready: create_deferred<boolean>(),
                done: create_deferred<ConsoleEndResult>(),
                host,
            };
            the_consoles.push(fake);
            return {
                handle_input: (text: string) => {
                    fake.the_inputs.push(text);
                },
                handle_resize: () => {},
                close: () => {
                    fake.is_closed = true;
                },
                ready: fake.ready.promise,
                done: fake.done.promise,
            };
        },
    };
}

/** A terminal for a pane; VS Code opens the pane after creating it. */
function create_pane_terminal(
    harness_state: {
        the_pane_closes: Map<MockTerminal, Array<number | void>>;
        the_pane_output: Map<MockTerminal, string[]>;
    },
    vscode_state: VscodeMockState,
    options: CreateTerminalOptions
): MockTerminal {
    const terminal: MockTerminal = {
        name: options.name ?? 'Stata',
        // A pane has no process; a plain Stata terminal does.
        processId: Promise.resolve(options.pty ? undefined : 4321),
        show: (preserve_focus = false) => {
            vscode_state.the_show_calls.push(preserve_focus);
        },
        sendText: (text: string) => {
            vscode_state.the_send_calls.push(text);
        },
        creationOptions: options,
    };
    const the_closes: Array<number | void> = [];
    const the_output: string[] = [];
    harness_state.the_pane_closes.set(terminal, the_closes);
    harness_state.the_pane_output.set(terminal, the_output);
    const pty = options.pty;
    if (pty) {
        pty.onDidClose?.(code => the_closes.push(code));
        pty.onDidWrite(text => the_output.push(text));
        setTimeout(() => pty.open({ columns: 80, rows: 24 }), 0);
    }
    return terminal;
}

async function create_console_harness(
    offer_timeout_ms = 60000,
    pty_helper_path?: string | null,
    setup?: (vscode_state: VscodeMockState) => {
        extension_kind?: number;
    }
): Promise<ConsoleHarness> {
    const vscode_state = create_vscode_mock_state(Promise.resolve(1));
    const extension_kind = setup?.(vscode_state).extension_kind;
    const the_terminals: MockTerminal[] = [];
    const the_consoles: FakeConsole[] = [];
    const harness_state = {
        the_pane_closes: new Map<MockTerminal, Array<number | void>>(),
        the_pane_output: new Map<MockTerminal, string[]>(),
    };
    vscode_state.make_terminal = options => {
        const terminal = create_pane_terminal(
            harness_state, vscode_state, options
        );
        the_terminals.push(terminal);
        return terminal;
    };
    current_vscode_state = vscode_state;

    // commands.ts imports the manager by its plain URL, so share that
    // instance (and its session override) with it.
    const terminal_manager = await import(TERMINAL_MANAGER_MODULE_URL);
    const commands_module = await import(
        `${COMMANDS_MODULE_URL}?test=${Date.now()}-${Math.random()}`
    );
    const context = {
        extensionPath: EXTENSION_PATH,
        subscriptions: [],
        extension: { extensionKind: extension_kind ?? 1 },
        extensionMode: 1,
    };
    terminal_manager.reset_stata_terminal_manager_for_tests({
        context,
        timings: { offer_timeout_ms },
        load_console_module: async () =>
            create_fake_console_module(the_consoles),
        pty_helper_path,
    });
    terminal_manager.register_stata_terminal(context);
    the_live_terminals.push(the_terminals);
    return {
        vscode_state,
        the_terminals,
        the_consoles,
        ...harness_state,
        terminal_manager,
        commands_module,
        context,
    };
}

/** Every harness's terminals, so each test's panes can be closed. */
const the_live_terminals: MockTerminal[][] = [];

/**
 * Close a test's panes, so one that is still opening can't start its
 * console against the next test's fake runtime.
 */
function close_live_panes(): void {
    for (const my_terminals of the_live_terminals.splice(0)) {
        for (const my_terminal of my_terminals) {
            my_terminal.creationOptions?.pty?.close();
        }
    }
}

async function console_started(
    harness: ConsoleHarness,
    count = 1
): Promise<FakeConsole> {
    await wait_until(
        () => harness.the_consoles.length >= count,
        'the pane to start its console',
        2000
    );
    return harness.the_consoles[count - 1];
}

/** The console ended on its own, without taking Stata. */
async function end_console(
    harness: ConsoleHarness,
    code: number,
    index = 0
): Promise<void> {
    const fake = await console_started(harness, index + 1);
    fake.done.resolve({ code, took_stata: false });
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function create_send_file(name: string): Promise<string> {
    const file_path = path.join(
        os.tmpdir(),
        `sight_console_test_${crypto.randomBytes(8).toString('hex')}_${name}`
    );
    await fs.promises.writeFile(file_path, `display "${name}"`, 'utf8');
    return file_path;
}

const the_created_files: string[] = [];

async function create_tracked_send_file(name: string): Promise<string> {
    const file_path = await create_send_file(name);
    the_created_files.push(file_path);
    return file_path;
}

function wrap(file_path: string): string {
    return '`"' + file_path + `"'`;
}

describe.serial('Feature: Stata pane running sight console on local Windows', () => {
    beforeAll(register_module_mocks);

    beforeEach(() => {
        current_vscode_state = null;
        set_platform('win32');
    });

    afterEach(async () => {
        close_live_panes();
        set_platform(REAL_PLATFORM);
        const terminal_manager = await import(TERMINAL_MANAGER_MODULE_URL);
        terminal_manager.reset_stata_terminal_manager_for_tests();
        current_vscode_state = null;
        for (const my_file of the_created_files.splice(0)) {
            await fs.promises.unlink(my_file).catch(() => {});
        }
    });

    test('the profile opens an extension terminal, not a program', async () => {
        const { vscode_state } = await create_console_harness();
        const provider = vscode_state.the_profile_providers.get(
            'sight.stataTerminal'
        );
        expect(provider).toBeDefined();

        const profile = await provider!.provideTerminalProfile(NO_CANCEL) as {
            options: CreateTerminalOptions;
        };
        expect(profile.options.name).toBe('Stata');
        expect(profile.options.pty).toBeDefined();
        expect(profile.options.shellPath).toBeUndefined();
        expect(profile.options.env).toBeUndefined();
        const second = await provider!.provideTerminalProfile(NO_CANCEL) as {
            options: CreateTerminalOptions;
        };
        expect(second.options.pty).not.toBe(profile.options.pty);
    });

    test('sends queue until the console is ready, then are typed in order', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const the_files = [
            await create_tracked_send_file('a.do'),
            await create_tracked_send_file('b.do'),
            await create_tracked_send_file('c.do'),
        ];

        const the_results = await Promise.all(the_files.map(
            my_file => terminal_manager.send_to_stata_terminal(
                'do', my_file
            )
        ));
        expect(the_results).toEqual([true, true, true]);
        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_create_options[0].pty).toBeDefined();
        // Shown with focus so the take-over question is seen.
        expect(vscode_state.the_show_calls).toContain(false);
        expect(vscode_state.the_cleanups).toEqual([]);
        expect(vscode_state.status_item?.text).toContain('3 sends');

        const fake = await console_started(harness);
        expect(fake.the_inputs).toEqual([]);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_inputs.length === 3,
            'queued sends to be typed',
            2000
        );
        expect(fake.the_inputs).toEqual(
            the_files.map(my_file => `do ${wrap(my_file)}\r`)
        );
        expect(vscode_state.the_cleanups).toEqual(the_files);
        expect(vscode_state.status_item?.is_shown).toBe(false);
        // Nothing goes through sendText: the pane types into the
        // console directly.
        expect(vscode_state.the_send_calls).toEqual([]);

        // Once ready, sends are typed directly.
        const later = await create_tracked_send_file('d.do');
        expect(
            await terminal_manager.send_to_stata_terminal('include', later)
        ).toBe(false);
        expect(fake.the_inputs.at(-1)).toBe(`include ${wrap(later)}\r`);
    });

    test('a profile-opened pane queues the same way', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const provider = vscode_state.the_profile_providers.get(
            'sight.stataTerminal'
        );
        const profile = await provider!.provideTerminalProfile(NO_CANCEL) as {
            options: CreateTerminalOptions;
        };
        const terminal = create_pane_terminal(
            harness, vscode_state, profile.options
        );
        for (const my_listener of vscode_state.the_open_listeners) {
            my_listener(terminal);
        }

        const my_file = await create_tracked_send_file('a.do');
        expect(
            await terminal_manager.send_to_stata_terminal('do', my_file)
        ).toBe(true);
        expect(vscode_state.create_terminal_calls).toBe(0);

        const fake = await console_started(harness);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_inputs.length === 1,
            'the queued send to be typed',
            2000
        );
        expect(fake.the_inputs).toEqual([`do ${wrap(my_file)}\r`]);
    });

    test('the console\'s questions are modal dialogs', async () => {
        const harness = await create_console_harness();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('a.do')
        );
        const fake = await console_started(harness);

        const take_over = fake.host.ask({
            kind: 'take_over',
            text: 'sight console will take over the open Stata.',
            allow_send_instead: true,
        });
        const call = harness.vscode_state.the_warning_calls[0];
        expect(call.modal).toBe(true);
        expect(call.the_items).toEqual([
            'Take over', 'Send code to it instead',
        ]);
        call.answer.resolve('Send code to it instead');
        expect(await take_over).toBe('send');

        const keep = fake.host.ask({
            kind: 'keep', text: 'Keep using it here?',
            allow_send_instead: false,
        });
        const keep_call = harness.vscode_state.the_warning_calls[1];
        expect(keep_call.the_items).toEqual(['Keep using it']);
        // Dismissing a modal (Cancel) counts as no.
        keep_call.answer.resolve(undefined);
        expect(await keep).toBe('no');
    });

    test('integrated resolves to the pane, with no warning', async () => {
        const { vscode_state, commands_module } =
            await create_console_harness();
        vscode_state.target_setting = { globalValue: 'integrated' };
        expect(await commands_module.resolve_effective_target('app'))
            .toBe('integrated');
        expect(vscode_state.the_warning_calls).toEqual([]);
        expect(vscode_state.the_quick_picks).toEqual([]);
    });

    test('ask (and auto) asks once, then keeps the choice this session', async () => {
        const { vscode_state, commands_module } =
            await create_console_harness();
        const target_choice = await import(TARGET_CHOICE_MODULE_URL);
        target_choice.reset_target_choice_for_tests();
        vscode_state.target_setting = { globalValue: 'auto' };
        // Dismissing the menu cancels the send.
        expect(await commands_module.resolve_effective_target('app'))
            .toBeNull();
        vscode_state.quick_pick_answer = '$(window) Stata app';
        expect(await commands_module.resolve_effective_target('app'))
            .toBe('app');
        vscode_state.target_setting = { globalValue: 'ask' };
        expect(await commands_module.resolve_effective_target('app'))
            .toBe('app');
        expect(vscode_state.the_quick_picks).toHaveLength(2);
        expect(vscode_state.the_quick_picks[0]).toContain(
            '$(terminal) Stata pane'
        );
        expect(vscode_state.the_update_calls).toEqual([]);
        target_choice.reset_target_choice_for_tests();
    });

    test('This session dispatches to the app until the setting changes', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager, commands_module } = harness;
        vscode_state.target_setting = { globalValue: 'integrated' };
        const the_files = [
            await create_tracked_send_file('a.do'),
            await create_tracked_send_file('b.do'),
        ];
        for (const my_file of the_files) {
            await terminal_manager.send_to_stata_terminal('do', my_file);
        }

        await end_console(harness, 80);
        expect(vscode_state.the_warning_calls).toHaveLength(1);
        const offer = vscode_state.the_warning_calls[0];
        expect(offer.message).toContain('several Stata windows are open');
        expect(offer.the_items).toEqual([
            'This session', 'Always', 'Cancel',
        ]);
        // Held sends still count, and their files are intact.
        expect(vscode_state.status_item?.text).toContain('2 sends');
        for (const my_file of the_files) {
            expect(fs.existsSync(my_file)).toBe(true);
        }

        offer.answer.resolve('This session');
        await wait_until(
            () => vscode_state.the_cleanups.length === 2,
            'the held sends to reach the app',
            2000
        );
        expect(vscode_state.the_app_dispatches).toEqual(the_files);
        expect(terminal_manager.is_console_session_override_set())
            .toBe(true);
        expect(await commands_module.resolve_effective_target('app'))
            .toBe('app');

        // Changing the target setting clears the override.
        vscode_state.target_setting = {
            globalValue: 'integrated',
            workspaceValue: 'integrated',
        };
        for (const my_listener of vscode_state.the_config_listeners) {
            my_listener({
                affectsConfiguration: (name: string) =>
                    name === 'sight.sendToStata.target',
            });
        }
        expect(terminal_manager.is_console_session_override_set())
            .toBe(false);
        expect(await commands_module.resolve_effective_target('app'))
            .toBe('integrated');
    });

    test('Always writes external globally', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager, commands_module } = harness;
        vscode_state.target_setting = { globalValue: 'integrated' };
        await terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('a.do')
        );

        await end_console(harness, 81);
        vscode_state.the_warning_calls[0].answer.resolve('Always');
        await wait_until(
            () => vscode_state.the_app_dispatches.length === 1,
            'the held send to reach the app',
            2000
        );
        expect(vscode_state.the_update_calls).toEqual([
            ['target', 'external', CONFIGURATION_TARGET_GLOBAL],
        ]);
        expect(terminal_manager.is_console_session_override_set())
            .toBe(false);
        expect(await commands_module.resolve_effective_target('app'))
            .toBe('app');
        expect(vscode_state.the_info_messages).toEqual([]);
    });

    test('Always with a workspace value still winning says so and sets the override', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager, commands_module } = harness;
        vscode_state.target_setting = { workspaceValue: 'integrated' };
        await terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('a.do')
        );

        await end_console(harness, 81);
        vscode_state.the_warning_calls[0].answer.resolve('Always');
        await wait_until(
            () => vscode_state.the_app_dispatches.length === 1,
            'the held send to reach the app',
            2000
        );
        expect(vscode_state.the_update_calls).toHaveLength(1);
        expect(vscode_state.the_info_messages).toHaveLength(1);
        expect(vscode_state.the_info_messages[0]).toContain('overrides');
        expect(terminal_manager.is_console_session_override_set())
            .toBe(true);
        expect(await commands_module.resolve_effective_target('app'))
            .toBe('app');
    });

    test('Cancel drops the sends and the next send opens a new pane', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);

        await end_console(harness, 80);
        vscode_state.the_warning_calls[0].answer.resolve('Cancel');
        await wait_until(
            () => !fs.existsSync(my_file),
            'the dropped temp file to be deleted',
            2000
        );
        expect(vscode_state.the_app_dispatches).toEqual([]);
        expect(terminal_manager.is_console_session_override_set())
            .toBe(false);

        const next = await create_tracked_send_file('b.do');
        expect(
            await terminal_manager.send_to_stata_terminal('do', next)
        ).toBe(true);
        expect(vscode_state.create_terminal_calls).toBe(2);
    });

    test('code 82 dispatches at once without asking', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        await terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('a.do')
        );

        await end_console(harness, 82);
        await wait_until(
            () => vscode_state.the_app_dispatches.length === 1,
            'the send to reach the app',
            2000
        );
        expect(vscode_state.the_warning_calls).toEqual([]);
        expect(terminal_manager.is_console_session_override_set())
            .toBe(true);
    });

    test('a helper failure during dispatch shows the error and drops the rest', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const first = await create_tracked_send_file('a.do');
        const second = await create_tracked_send_file('b.do');
        await terminal_manager.send_to_stata_terminal('do', first);
        await terminal_manager.send_to_stata_terminal('do', second);
        vscode_state.the_failing_app_paths.add(first);

        await end_console(harness, 82);
        await wait_until(
            () => !fs.existsSync(first) && !fs.existsSync(second),
            'both temp files to be deleted',
            2000
        );
        expect(vscode_state.the_app_dispatches).toEqual([]);
        expect(vscode_state.the_error_messages).toEqual([
            'Error: Executable not available',
        ]);
        expect(vscode_state.the_info_messages).toEqual([
            'Dropped 1 send to Stata after the error.',
        ]);
    });

    const NO_OFFER_CODES: Array<[string, number]> = [
        ['a normal end (0)', 0],
        ['an error (1)', 1],
        ['a cancelled start (130)', 130],
    ];

    for (const [my_name, my_code] of NO_OFFER_CODES) {
        test(`${my_name} makes no offer and deletes pending temp files`, async () => {
            const harness = await create_console_harness();
            const { vscode_state, terminal_manager } = harness;
            const my_file = await create_tracked_send_file('a.do');
            await terminal_manager.send_to_stata_terminal('do', my_file);

            await end_console(harness, my_code);
            await wait_until(
                () => !fs.existsSync(my_file),
                'the pending temp file to be deleted',
                2000
            );
            expect(vscode_state.the_warning_calls).toEqual([]);
            expect(vscode_state.the_app_dispatches).toEqual([]);
            expect(vscode_state.the_info_messages).toHaveLength(1);
            expect(vscode_state.the_info_messages[0]).toStartWith(
                'Dropped 1 send to Stata: '
            );
        });
    }

    test('closing the pane ends its console and drops sends quietly', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager, the_terminals } = harness;
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);
        const fake = await console_started(harness);

        the_terminals[0].creationOptions?.pty?.close();
        expect(fake.is_closed).toBe(true);
        await wait_until(
            () => !fs.existsSync(my_file),
            'the pending temp file to be deleted',
            2000
        );
        expect(vscode_state.the_info_messages).toEqual([]);
        expect(vscode_state.the_warning_calls).toEqual([]);

        // Readiness or an end reported after the close changes nothing.
        fake.ready.resolve(true);
        fake.done.resolve({ code: 81, took_stata: false });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(fake.the_inputs).toEqual([]);
        expect(vscode_state.the_warning_calls).toEqual([]);
    });

    test('a pane closes itself after a normal end, and waits for a key after an error', async () => {
        const harness = await create_console_harness();
        const { terminal_manager, the_terminals } = harness;
        await terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('a.do')
        );
        const fake = await console_started(harness);
        fake.ready.resolve(true);
        fake.done.resolve({ code: 0, took_stata: true });
        await wait_until(
            () => (harness.the_pane_closes.get(the_terminals[0]) ?? [])
                .length === 1,
            'the pane to close',
            2000
        );

        await terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('b.do')
        );
        const second = await console_started(harness, 2);
        second.done.resolve({ code: 1, took_stata: false });
        await wait_until(
            () => (harness.the_pane_output.get(the_terminals[1]) ?? [])
                .join('').includes('Press any key'),
            'the pane to wait for a key',
            2000
        );
        expect(harness.the_pane_closes.get(the_terminals[1])).toEqual([]);
        the_terminals[1].creationOptions?.pty?.handleInput?.('x');
        expect(harness.the_pane_closes.get(the_terminals[1])).toHaveLength(1);
    });

    test('Always that a workspace setting overrides wins this session', async () => {
        const target_choice = await import(TARGET_CHOICE_MODULE_URL);
        for (const [my_workspace, my_label, my_expected] of [
            ['integrated', '$(window) Always use the Stata app', 'app'],
            ['external', '$(terminal) Always use the Stata pane', 'integrated'],
        ]) {
            target_choice.reset_target_choice_for_tests();
            const harness = await create_console_harness();
            const { vscode_state, commands_module, context } = harness;
            vscode_state.target_setting = { workspaceValue: my_workspace };
            vscode_state.quick_pick_answer = my_label;
            const the_registered = new Map<
                string, (...args: unknown[]) => unknown
            >();
            (globalThis as Record<string, unknown>)[
                SHARED_VSCODE_TEST_STATE_KEY
            ] = { registered_commands: the_registered };
            try {
                commands_module.register_send_to_stata_commands(context);
                await the_registered.get('sight.chooseSendTarget')?.();
            } finally {
                delete (globalThis as Record<string, unknown>)[
                    SHARED_VSCODE_TEST_STATE_KEY
                ];
            }
            expect(vscode_state.the_quick_picks).toHaveLength(1);
            expect(vscode_state.the_info_messages[0]).toContain('overrides');
            expect(await commands_module.resolve_effective_target('app'))
                .toBe(my_expected);
        }
        target_choice.reset_target_choice_for_tests();
    });

    test('a send from the editor leaves a queued temp file to the queue', async () => {
        const harness = await create_console_harness();
        const { vscode_state, commands_module, context } = harness;
        vscode_state.target_setting = { globalValue: 'integrated' };
        const the_registered = new Map<
            string, (...args: unknown[]) => unknown
        >();
        (globalThis as Record<string, unknown>)[
            SHARED_VSCODE_TEST_STATE_KEY
        ] = { registered_commands: the_registered };
        vscode_state.active_text_editor = {
            document: {
                uri: {
                    fsPath: '/tmp/example.do',
                    toString: () => 'file:///tmp/example.do',
                },
                lineCount: 1,
                save: async () => true,
                getText: () => 'display "queued"',
            },
            selection: { isEmpty: false, active: { line: 0 } },
            revealRange: () => {},
        };
        try {
            commands_module.register_send_to_stata_commands(context);
            await the_registered.get('sight.doLineOrSelection')?.();
        } finally {
            delete (globalThis as Record<string, unknown>)[
                SHARED_VSCODE_TEST_STATE_KEY
            ];
        }

        expect(vscode_state.the_error_messages).toEqual([]);
        expect(vscode_state.create_terminal_calls).toBe(1);
        // However long the take-over question takes, the queued file
        // has no cleanup scheduled.
        expect(vscode_state.the_cleanups).toEqual([]);
        expect(vscode_state.status_item?.text).toContain('1 send');

        await end_console(harness, 82);
        await wait_until(
            () => vscode_state.the_cleanups.length === 1,
            'the dispatched send to be scheduled for cleanup',
            2000
        );
        const dispatched = vscode_state.the_app_dispatches[0];
        the_created_files.push(dispatched);
        expect(fs.readFileSync(dispatched, 'utf8'))
            .toBe('display "queued"');
    });
});

describe.serial('Feature: Stata pane running sight console on macOS and Linux', () => {
    const HELPER_PATH = '/extension/pty-helper/bin/darwin-arm64/sight-pty';

    beforeAll(register_module_mocks);

    beforeEach(() => {
        current_vscode_state = null;
        set_platform('darwin');
    });

    afterEach(async () => {
        close_live_panes();
        set_platform(REAL_PLATFORM);
        const terminal_manager = await import(TERMINAL_MANAGER_MODULE_URL);
        terminal_manager.reset_stata_terminal_manager_for_tests();
        current_vscode_state = null;
        for (const my_file of the_created_files.splice(0)) {
            await fs.promises.unlink(my_file).catch(() => {});
        }
    });

    for (const my_platform of ['darwin', 'linux']) {
        test(`on ${my_platform} the profile opens a pane running Stata through the helper`, async () => {
            set_platform(my_platform);
            const harness = await create_console_harness(60000, HELPER_PATH);
            const provider = harness.vscode_state.the_profile_providers.get(
                'sight.stataTerminal'
            );
            const profile = await provider!.provideTerminalProfile(NO_CANCEL) as {
                options: CreateTerminalOptions;
            };
            expect(profile.options.pty).toBeDefined();
            expect(profile.options.shellPath).toBeUndefined();
            const pane_terminal = create_pane_terminal(
                { the_pane_closes: new Map(), the_pane_output: new Map() },
                harness.vscode_state,
                profile.options
            );
            harness.the_terminals.push(pane_terminal);
            const fake = await console_started(harness);
            expect(fake.host.pty).toEqual({
                helper_path: HELPER_PATH,
                stata_path: '/usr/local/bin/stata-mp',
            });
        });
    }

    test('sends wait for the first prompt, then are typed in order', async () => {
        const harness = await create_console_harness(60000, HELPER_PATH);
        const first = await create_tracked_send_file('first');
        const second = await create_tracked_send_file('second');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(true);
        expect(await harness.terminal_manager.send_to_stata_terminal('do', second)).toBe(true);
        expect(harness.the_terminals).toHaveLength(1);
        const fake = await console_started(harness);
        expect(fake.the_inputs).toEqual([]);

        fake.ready.resolve(true);
        await wait_until(() => fake.the_inputs.length === 2, 'typed sends', 2000);
        expect(fake.the_inputs).toEqual([
            `do ${wrap(first)}\r`,
            `do ${wrap(second)}\r`,
        ]);
        expect(harness.vscode_state.the_send_calls).toEqual([]);

        const third = await create_tracked_send_file('third');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', third)).toBe(false);
        expect(fake.the_inputs.at(-1)).toBe(`do ${wrap(third)}\r`);
    });

    test('with the console setting off, Stata runs directly', async () => {
        const harness = await create_console_harness(60000, HELPER_PATH);
        harness.vscode_state.console_setting = 'off';
        const first = await create_tracked_send_file('first');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(false);
        const options = harness.vscode_state.the_create_options[0];
        expect(options.pty).toBeUndefined();
        expect(options.shellPath).toBe('/usr/local/bin/stata-mp');
        expect(options.shellArgs).toEqual(['do', wrap(first)]);
    });

    test('without a helper for this platform, Stata runs directly', async () => {
        const harness = await create_console_harness(60000, null);
        const first = await create_tracked_send_file('first');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        expect(harness.vscode_state.the_create_options[0].shellPath)
            .toBe('/usr/local/bin/stata-mp');
    });

    test("Stata's own exit codes never offer the Windows app", async () => {
        const harness = await create_console_harness(60000, HELPER_PATH);
        const first = await create_tracked_send_file('first');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        await end_console(harness, 81);
        await wait_until(
            () => harness.vscode_state.the_info_messages.length > 0,
            'the drop notice',
            2000
        );
        expect(harness.vscode_state.the_warning_calls).toEqual([]);
        expect(harness.vscode_state.the_app_dispatches).toEqual([]);
        expect(harness.vscode_state.the_info_messages[0]).toContain(
            'Dropped 1 send'
        );
    });

    test('a helper that fails before the first prompt hands its sends to plain Stata once', async () => {
        const harness = await create_console_harness(60000, HELPER_PATH);
        const first = await create_tracked_send_file('first');
        const second = await create_tracked_send_file('second');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        await harness.terminal_manager.send_to_stata_terminal('do', second);
        const fake = await console_started(harness);
        fake.done.resolve({ code: 137, took_stata: false, helper_failed: true });

        await wait_until(
            () => harness.vscode_state.the_send_calls.length === 1,
            'the second send typed into plain Stata',
            2000
        );
        const the_options = harness.vscode_state.the_create_options;
        expect(the_options).toHaveLength(2);
        expect(the_options[1].pty).toBeUndefined();
        expect(the_options[1].shellArgs).toEqual(['do', wrap(first)]);
        expect(harness.vscode_state.the_send_calls).toEqual([
            `do ${wrap(second)}`,
        ]);
        expect(harness.vscode_state.the_warning_calls.map(my_call => my_call.message))
            .toEqual([expect.stringContaining('Stata CLI directly')]);
        expect(harness.vscode_state.the_cleanups).toEqual([first, second]);

        // Later sends keep using plain Stata this session.
        const third = await create_tracked_send_file('third');
        await harness.terminal_manager.send_to_stata_terminal('do', third);
        expect(harness.vscode_state.the_create_options).toHaveLength(2);
        expect(harness.vscode_state.the_send_calls.at(-1)).toBe(`do ${wrap(third)}`);
    });
});

// ---- Perch ----

interface FakeSession {
    id: string;
    name: string;
    kind: string;
    owner?: string;
    annotations: Record<string, string>;
    dir: string;
    degraded: string[];
    cwd: string;
    host: string;
    createdAt: string;
    state: 'starting' | 'running' | 'exited' | 'lost' | 'unresponsive';
    attached: boolean;
    attachedHere: boolean;
    exit?: { code?: number };
}

interface FakePerchCreate {
    name: string;
    kind: string;
    command: string[];
    cwd?: string;
    env?: Record<string, string>;
    annotations?: Record<string, string>;
    show?: boolean;
}

interface FakePerch {
    extension: {
        isActive: boolean;
        exports: unknown;
        activate: () => Promise<unknown>;
    };
    activate_count: number;
    is_available: boolean;
    the_creates: FakePerchCreate[];
    the_prepared: FakePerchCreate[];
    the_sends: Array<{ id: string; text: string; options: unknown }>;
    the_attaches: string[];
    /** Makes a send fail with this error, once. */
    send_error: unknown;
    the_terminals: Array<{ session: FakeSession; terminal: MockTerminal }>;
    the_listed: FakeSession[];
    /** Holds listSessions until resolved. */
    list_gate: Deferred<void> | null;
    /** Fire onDidAttach before createSession resolves, as Perch can. */
    attach_before_create: boolean;
    fire_attach: (session: FakeSession, terminal: MockTerminal) => void;
    fire_end: (session: FakeSession) => void;
    make_session: (overrides?: Partial<FakeSession>) => FakeSession;
    make_terminal: (session: FakeSession) => MockTerminal;
}

const PERCH_HELPER_PATH = '/extension/pty-helper/bin/linux-x64/sight-pty';
const the_perch_dirs: string[] = [];
let perch_session_count = 0;

function create_fake_perch(vscode_state: VscodeMockState): FakePerch {
    const the_attach_listeners: Array<(event: unknown) => void> = [];
    const the_end_listeners: Array<(event: unknown) => void> = [];
    const make_session = (overrides: Partial<FakeSession> = {}) => {
        perch_session_count += 1;
        const id = `s${String(perch_session_count).padStart(7, '0')}`;
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-perch-'));
        the_perch_dirs.push(dir);
        return {
            id,
            name: 'Stata',
            kind: 'stata',
            owner: 'jbearak.sight',
            annotations: { 'sight.console': 'editor' },
            dir,
            degraded: [],
            cwd: '/work',
            host: 'remote',
            createdAt: '2026-11-01T12:00:00Z',
            state: 'running' as const,
            attached: true,
            attachedHere: true,
            ...overrides,
        };
    };
    const make_terminal = (session: FakeSession): MockTerminal => ({
        name: session.name,
        processId: Promise.resolve(99),
        show: (preserve_focus = false) => {
            vscode_state.the_show_calls.push(preserve_focus);
        },
        sendText: (text: string) => {
            vscode_state.the_send_calls.push(text);
        },
    });
    const perch: FakePerch = {
        activate_count: 0,
        is_available: true,
        the_creates: [],
        the_prepared: [],
        the_sends: [],
        the_attaches: [],
        send_error: null,
        the_terminals: [],
        the_listed: [],
        list_gate: null,
        attach_before_create: false,
        fire_attach: (session, terminal) => {
            for (const my_listener of [...the_attach_listeners]) {
                my_listener({ session, terminal });
            }
        },
        fire_end: (session) => {
            for (const my_listener of [...the_end_listeners]) {
                my_listener(session);
            }
        },
        make_session,
        make_terminal,
        extension: {
            isActive: false,
            exports: undefined,
            activate: async () => {
                perch.activate_count += 1;
                return perch.extension.exports;
            },
        },
    };
    const api = {
        version: 1,
        available: async () => perch.is_available,
        prepareLaunch: (options: FakePerchCreate) => {
            perch.the_prepared.push(options);
            return {
                id: 'prepared',
                options: { name: options.name, shellPath: '/perch/bin/perch' },
            };
        },
        createSession: async (options: FakePerchCreate) => {
            perch.the_creates.push(options);
            const session = make_session({
                annotations: { ...options.annotations },
                cwd: options.cwd ?? '',
            });
            const terminal = make_terminal(session);
            perch.the_listed.push(session);
            if (perch.attach_before_create) {
                perch.fire_attach(session, terminal);
            }
            return { session, terminal };
        },
        waitForSession: async () => make_session(),
        listSessions: async () => {
            await perch.list_gate?.promise;
            return [...perch.the_listed];
        },
        terminals: () => [...perch.the_terminals],
        attach: async (id: string) => {
            perch.the_attaches.push(id);
            const session = perch.the_listed.find(my_session => my_session.id === id);
            return make_terminal(session ?? make_session());
        },
        sessionForTerminal: () => undefined,
        send: async (id: string, text: string, options: unknown) => {
            const error = perch.send_error;
            if (error) {
                perch.send_error = null;
                throw error;
            }
            perch.the_sends.push({ id, text, options });
            return 'queued';
        },
        kill: async () => {},
        annotate: async () => {},
        onDidChangeSessions: () => ({ dispose: () => {} }),
        onDidAttach: (listener: (event: unknown) => void) =>
            add_listener(the_attach_listeners, listener),
        onDidEndSession: (listener: (event: unknown) => void) =>
            add_listener(the_end_listeners, listener),
    };
    perch.extension.exports = {
        getApi: (version: number, caller_id: string) =>
            version === 1 && caller_id === 'jbearak.sight' ? api : undefined,
    };
    return perch;
}

function perch_error(code: string): Error {
    return Object.assign(new Error(`perch: ${code}`), {
        name: 'PerchApiError', code,
    });
}

/** A harness for a remote window (by default) with `perch` installed. */
async function create_perch_harness(
    options: {
        remote_name?: string;
        extension_kind?: number;
        perch?: (vscode_state: VscodeMockState) => FakePerch | undefined;
        helper_path?: string | null;
    } = {}
): Promise<{ harness: ConsoleHarness; perch: FakePerch | undefined }> {
    let perch: FakePerch | undefined;
    const harness = await create_console_harness(
        60000,
        options.helper_path === undefined
            ? PERCH_HELPER_PATH
            : options.helper_path,
        vscode_state => {
            vscode_state.remote_name = options.remote_name ?? 'ssh-remote';
            perch = options.perch
                ? options.perch(vscode_state)
                : create_fake_perch(vscode_state);
            vscode_state.perch_extension = perch?.extension;
            return { extension_kind: options.extension_kind ?? 2 };
        }
    );
    return { harness, perch };
}

function write_ready_file(dir: string): void {
    fs.writeFileSync(path.join(dir, 'sight-console-ready'), '{"pid":1}');
}

/** The Perch terminals Sight sends through. */
function perch_terminals(harness: ConsoleHarness): MockTerminal[] {
    const manager = harness.terminal_manager as unknown as {
        perch_terminals_for_tests: () => MockTerminal[];
    };
    return manager.perch_terminals_for_tests();
}

function close_terminal(vscode_state: VscodeMockState, terminal: MockTerminal) {
    for (const my_listener of [...vscode_state.the_close_listeners]) {
        my_listener(terminal);
    }
}

describe.serial('Feature: Stata console in a Perch session (remote windows)', () => {
    beforeAll(register_module_mocks);

    beforeEach(() => {
        current_vscode_state = null;
        // A remote host runs Linux (or macOS).
        set_platform('linux');
    });

    afterEach(async () => {
        close_live_panes();
        set_platform(REAL_PLATFORM);
        const terminal_manager = await import(TERMINAL_MANAGER_MODULE_URL);
        terminal_manager.reset_stata_terminal_manager_for_tests();
        current_vscode_state = null;
        for (const my_file of the_created_files.splice(0)) {
            await fs.promises.unlink(my_file).catch(() => {});
        }
        for (const my_dir of the_perch_dirs.splice(0)) {
            fs.rmSync(my_dir, { recursive: true, force: true });
        }
    });

    test('a local window never looks for Perch and opens the pane', async () => {
        const { harness, perch } = await create_perch_harness({
            remote_name: '', extension_kind: 1,
        });
        const first = await create_tracked_send_file('first');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(true);
        expect(harness.the_terminals).toHaveLength(1);
        expect(harness.the_terminals[0].creationOptions?.pty).toBeDefined();
        expect(perch?.activate_count).toBe(0);
        expect(perch?.the_creates).toEqual([]);
        expect(harness.vscode_state.the_get_extension_ids).toEqual([]);
    });

    test('a remote window without Perch opens the pane', async () => {
        const { harness } = await create_perch_harness({ perch: () => undefined });
        const first = await create_tracked_send_file('first');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(true);
        expect(harness.the_terminals).toHaveLength(1);
        expect(harness.the_terminals[0].creationOptions?.pty).toBeDefined();
    });

    test('Sight running as a UI extension in a remote window opens the pane', async () => {
        const { harness, perch } = await create_perch_harness({ extension_kind: 1 });
        const first = await create_tracked_send_file('first');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        expect(harness.the_terminals).toHaveLength(1);
        expect(perch?.activate_count).toBe(0);
        expect(perch?.the_creates).toEqual([]);
    });

    test('Perch that is unavailable on the host leaves the pane', async () => {
        const { harness, perch } = await create_perch_harness({
            perch: vscode_state => {
                const fake = create_fake_perch(vscode_state);
                fake.is_available = false;
                return fake;
            },
        });
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        expect(harness.the_terminals).toHaveLength(1);
        expect(perch?.the_creates).toEqual([]);
    });

    test('a Perch whose activation rejects leaves the pane, with no unhandled rejection', async () => {
        const the_logged: string[] = [];
        const { harness, perch } = await create_perch_harness({
            perch: vscode_state => {
                const fake = create_fake_perch(vscode_state);
                fake.extension.activate = () => Promise.reject(new Error('boom'));
                return fake;
            },
        });
        const the_rejections: unknown[] = [];
        const on_rejection = (reason: unknown) => the_rejections.push(reason);
        process.on('unhandledRejection', on_rejection);
        try {
            // Look Perch up again with a log, as at activation.
            harness.terminal_manager.register_stata_terminal(
                harness.context as never,
                ((message: string) => the_logged.push(message)) as never
            );
            const first = await create_tracked_send_file('first');
            expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(true);
            await new Promise(resolve => setTimeout(resolve, 20));
        } finally {
            process.off('unhandledRejection', on_rejection);
        }
        expect(the_rejections).toEqual([]);
        expect(the_logged).toEqual([expect.stringContaining('boom')]);
        expect(harness.the_terminals).toHaveLength(1);
        expect(perch?.the_creates).toEqual([]);
    });

    test('with Perch, a new console runs tty.js in a session, with the first send on its command line', async () => {
        const { harness, perch } = await create_perch_harness();
        harness.vscode_state.workspace_folder = '/work/project';
        const first = await create_tracked_send_file('first');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(true);
        expect(harness.the_terminals).toEqual([]);
        expect(perch!.the_creates).toHaveLength(1);
        const created = perch!.the_creates[0];
        expect(created.kind).toBe('stata');
        expect(created.name).toBe('Stata');
        expect(created.cwd).toBe('/work/project');
        expect(created.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
        expect(created.annotations).toEqual({ 'sight.console': 'editor' });
        expect(created.show).toBe(false);
        expect(created.command).toEqual([
            process.execPath,
            path.join(EXTENSION_PATH, 'console-runtime', 'tty.js'),
            '--helper', PERCH_HELPER_PATH,
            '--stata', '/usr/local/bin/stata-mp',
            '--ready-file', '{dir}/sight-console-ready',
            '--end-file', '{dir}/sight-console-end',
            '--cwd', '/work/project',
            '--run', `do ${wrap(first)}`,
        ]);
    });

    test('sends wait for the ready file, then go through Perch in order, once each, never sendText', async () => {
        const { harness, perch } = await create_perch_harness();
        const first = await create_tracked_send_file('first');
        const second = await create_tracked_send_file('second');
        const third = await create_tracked_send_file('third');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(true);
        expect(await harness.terminal_manager.send_to_stata_terminal('do', second)).toBe(true);
        expect(await harness.terminal_manager.send_to_stata_terminal('include', third)).toBe(true);
        expect(perch!.the_sends).toEqual([]);
        expect(harness.vscode_state.status_item?.text).toContain('3 sends');

        const session = perch!.the_listed[0];
        write_ready_file(session.dir);
        await wait_until(() => perch!.the_sends.length === 2, 'the queued sends', 2000);
        expect(perch!.the_sends).toEqual([
            { id: session.id, text: `do ${wrap(second)}`, options: { submit: true } },
            { id: session.id, text: `include ${wrap(third)}`, options: { submit: true } },
        ]);
        // The first ran from the command line; all three are cleaned up.
        expect(harness.vscode_state.the_cleanups).toEqual([first, second, third]);

        const fourth = await create_tracked_send_file('fourth');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', fourth)).toBe(false);
        expect(perch!.the_sends).toHaveLength(3);
        expect(perch!.the_sends[2].text).toBe(`do ${wrap(fourth)}`);
        expect(perch!.the_creates).toHaveLength(1);
        expect(harness.vscode_state.the_send_calls).toEqual([]);
    });

    test('the first send is kept when onDidAttach comes before createSession resolves', async () => {
        const { harness, perch } = await create_perch_harness();
        perch!.attach_before_create = true;
        const first = await create_tracked_send_file('first');
        const second = await create_tracked_send_file('second');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        await harness.terminal_manager.send_to_stata_terminal('do', second);
        expect(harness.vscode_state.status_item?.text).toContain('2 sends');
        // A helper failure hands both to the Stata CLI, first included.
        fs.writeFileSync(
            path.join(perch!.the_listed[0].dir, 'sight-console-end'),
            JSON.stringify({ code: 1, took_stata: false, helper_failed: true })
        );
        await wait_until(() => perch!.the_creates.length === 2, 'the CLI session', 2000);
        expect(perch!.the_creates[1].command).toEqual([
            '/usr/local/bin/stata-mp', 'do', wrap(first),
        ]);
    });

    test('with onDidAttach first, the first send is still cleaned up at readiness', async () => {
        const { harness, perch } = await create_perch_harness();
        perch!.attach_before_create = true;
        const first = await create_tracked_send_file('first');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        write_ready_file(perch!.the_listed[0].dir);
        await wait_until(
            () => harness.vscode_state.the_cleanups.includes(first), 'cleanup', 2000
        );
    });

    test('literal braces in user strings are escaped; only Sight\'s {dir} stays raw', async () => {
        const brace_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a{dir}b}{-'));
        the_perch_dirs.push(brace_dir);
        const first = path.join(brace_dir, 'x{y}.do');
        fs.writeFileSync(first, 'display 1\n');
        the_created_files.push(first);
        const { harness, perch } = await create_perch_harness({
            helper_path: '/ext/{id}/sight-pty',
        });
        harness.vscode_state.stata_cli = '/opt/st{ata}/stata-mp';
        harness.vscode_state.workspace_folder = '/work/{dir}';
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        const created = perch!.the_creates[0];
        const escape = (text: string) => text.replace(/[{}]/g, brace => brace + brace);
        expect(created.command).toEqual([
            escape(process.execPath),
            escape(path.join(EXTENSION_PATH, 'console-runtime', 'tty.js')),
            '--helper', '/ext/{{id}}/sight-pty',
            '--stata', '/opt/st{{ata}}/stata-mp',
            '--ready-file', '{dir}/sight-console-ready',
            '--end-file', '{dir}/sight-console-end',
            '--cwd', '/work/{{dir}}',
            '--run', escape(`do ${wrap(first)}`),
        ]);
        // cwd is not expanded by Perch.
        expect(created.cwd).toBe('/work/{dir}');
        expect(created.command.at(-1)).toContain('a{{dir}}b}}{{-');
    });

    test('with the console setting off, the session runs the Stata CLI', async () => {
        const { harness, perch } = await create_perch_harness();
        harness.vscode_state.console_setting = 'off';
        harness.vscode_state.stata_cli = '/opt/{x}/stata-mp';
        const first = await create_tracked_send_file('first');
        const second = await create_tracked_send_file('second');
        expect(await harness.terminal_manager.send_to_stata_terminal('do', first)).toBe(true);
        expect(await harness.terminal_manager.send_to_stata_terminal('do', second)).toBe(true);
        const created = perch!.the_creates[0];
        expect(created.command).toEqual(['/opt/{{x}}/stata-mp', 'do', wrap(first)]);
        expect(created.annotations).toEqual({ 'sight.console': 'stata' });
        expect(created.env).toBeUndefined();
        await wait_until(() => perch!.the_sends.length === 1, 'the second send', 2000);
        expect(perch!.the_sends[0].text).toBe(`do ${wrap(second)}`);
        expect(harness.vscode_state.the_send_calls).toEqual([]);
    });

    test('closing the session\'s terminal is a detach: sends still go to it', async () => {
        const { harness, perch } = await create_perch_harness();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        const session = perch!.the_listed[0];
        write_ready_file(session.dir);
        const second = await create_tracked_send_file('second');
        await wait_until(() => harness.vscode_state.the_cleanups.length === 1, 'ready', 2000);

        // The terminal createSession returned is the one Sight tracks.
        const the_tracked = perch_terminals(harness);
        expect(the_tracked).toHaveLength(1);
        close_terminal(harness.vscode_state, the_tracked[0]);
        expect(perch_terminals(harness)).toEqual([]);

        expect(await harness.terminal_manager.send_to_stata_terminal('do', second)).toBe(false);
        expect(perch!.the_sends).toEqual([
            { id: session.id, text: `do ${wrap(second)}`, options: { submit: true } },
        ]);
        expect(perch!.the_creates).toHaveLength(1);
        expect(harness.the_terminals).toEqual([]);
    });

    test('onDidEndSession ends the console: waiting sends drop, the next send starts a new one', async () => {
        const { harness, perch } = await create_perch_harness();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('second')
        );
        const session = perch!.the_listed[0];
        perch!.fire_end({ ...session, state: 'exited', exit: { code: 1 } });
        await wait_until(
            () => harness.vscode_state.the_info_messages.length > 0,
            'the drop notice', 2000
        );
        expect(harness.vscode_state.the_info_messages[0]).toContain('Dropped 2 sends');

        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('third')
        );
        expect(perch!.the_creates).toHaveLength(2);
        expect(perch!.the_sends).toEqual([]);
    });

    test('after a reload, the session with a terminal here is the target again; others are not', async () => {
        const { harness, perch } = await create_perch_harness({
            perch: vscode_state => {
                const fake = create_fake_perch(vscode_state);
                const here = fake.make_session();
                write_ready_file(here.dir);
                const elsewhere = fake.make_session({
                    cwd: '/other/workspace', attachedHere: false,
                });
                fake.the_terminals.push({ session: here, terminal: fake.make_terminal(here) });
                fake.the_listed.push(here, elsewhere);
                return fake;
            },
        });
        const here = perch!.the_listed[0];
        const first = await create_tracked_send_file('first');
        await wait_until(
            () => perch_terminals(harness).length === 1, 'adoption', 2000
        );
        // Queued until the ready file is seen, then sent.
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        await wait_until(() => perch!.the_sends.length === 1, 'the send', 2000);
        expect(perch!.the_sends[0]).toEqual({
            id: here.id, text: `do ${wrap(first)}`, options: { submit: true },
        });
        expect(harness.vscode_state.the_quick_picks).toEqual([]);
        expect(perch!.the_creates).toEqual([]);
    });

    test('sessions only from other windows are offered, never sent to on their own', async () => {
        const { harness, perch } = await create_perch_harness({
            perch: vscode_state => {
                const fake = create_fake_perch(vscode_state);
                fake.the_listed.push(fake.make_session({
                    cwd: '/other/workspace', attachedHere: false,
                }));
                return fake;
            },
        });
        harness.vscode_state.quick_pick_answer = '$(add) Start a new Stata console';
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        expect(harness.vscode_state.the_quick_picks).toEqual([
            ['$(add) Start a new Stata console', '$(terminal) Stata'],
        ]);
        expect(perch!.the_creates).toHaveLength(1);
        expect(perch!.the_attaches).toEqual([]);
        expect(perch!.the_sends).toEqual([]);
    });

    test('picking a session from another window attaches it and sends there', async () => {
        const { harness, perch } = await create_perch_harness({
            perch: vscode_state => {
                const fake = create_fake_perch(vscode_state);
                const other = fake.make_session({
                    cwd: '/other/workspace', attachedHere: false,
                });
                write_ready_file(other.dir);
                fake.the_listed.push(other);
                return fake;
            },
        });
        const other = perch!.the_listed[0];
        harness.vscode_state.quick_pick_answer = '$(terminal) Stata';
        const first = await create_tracked_send_file('first');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        await wait_until(() => perch!.the_sends.length === 1, 'the send', 2000);
        expect(perch!.the_attaches).toEqual([other.id]);
        expect(perch!.the_sends[0]).toEqual({
            id: other.id, text: `do ${wrap(first)}`, options: { submit: true },
        });
        expect(perch!.the_creates).toEqual([]);
    });

    test('an end event during the listing wins over the listing', async () => {
        const { harness, perch } = await create_perch_harness({
            perch: vscode_state => {
                const fake = create_fake_perch(vscode_state);
                const restored = fake.make_session();
                write_ready_file(restored.dir);
                fake.the_terminals.push({
                    session: restored, terminal: fake.make_terminal(restored),
                });
                fake.the_listed.push(restored);
                fake.list_gate = create_deferred<void>();
                return fake;
            },
        });
        const restored = perch!.the_listed[0];
        // The session ends while the listing is in flight; the stale
        // listing still says running.
        await new Promise(resolve => setTimeout(resolve, 10));
        perch!.fire_end({ ...restored, state: 'exited' });
        perch!.list_gate!.resolve();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        expect(perch!.the_sends).toEqual([]);
        expect(perch!.the_creates).toHaveLength(1);
        expect(harness.vscode_state.the_quick_picks).toEqual([]);
    });

    test('outcome_unknown says the code may not have run, and never resends', async () => {
        const { harness, perch } = await create_perch_harness();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        write_ready_file(perch!.the_listed[0].dir);
        await wait_until(() => harness.vscode_state.the_cleanups.length === 1, 'ready', 2000);
        perch!.send_error = perch_error('outcome_unknown');
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('second')
        );
        expect(harness.vscode_state.the_warning_calls.map(my_call => my_call.message))
            .toEqual([expect.stringContaining('may not have run')]);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(perch!.the_sends).toEqual([]);
    });

    test('no_session ends the console, so the next send starts a new one', async () => {
        const { harness, perch } = await create_perch_harness();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        write_ready_file(perch!.the_listed[0].dir);
        await wait_until(() => harness.vscode_state.the_cleanups.length === 1, 'ready', 2000);
        perch!.send_error = perch_error('no_session');
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('second')
        );
        expect(harness.vscode_state.the_error_messages)
            .toEqual([expect.stringContaining('has ended')]);
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('third')
        );
        expect(perch!.the_creates).toHaveLength(2);
    });

    test('a console that ends before its first prompt drops its sends', async () => {
        const { harness, perch } = await create_perch_harness();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        fs.writeFileSync(
            path.join(perch!.the_listed[0].dir, 'sight-console-end'),
            JSON.stringify({ code: 127, took_stata: false, helper_failed: false })
        );
        await wait_until(
            () => harness.vscode_state.the_info_messages.length > 0,
            'the drop notice', 2000
        );
        expect(harness.vscode_state.the_info_messages[0])
            .toContain('Dropped 1 send to Stata: sight console exited with code 127');
    });

    test('a helper failure before the first prompt starts the Stata CLI in a new session', async () => {
        const { harness, perch } = await create_perch_harness();
        const first = await create_tracked_send_file('first');
        const second = await create_tracked_send_file('second');
        await harness.terminal_manager.send_to_stata_terminal('do', first);
        await harness.terminal_manager.send_to_stata_terminal('do', second);
        fs.writeFileSync(
            path.join(perch!.the_listed[0].dir, 'sight-console-end'),
            JSON.stringify({ code: 1, took_stata: false, helper_failed: true })
        );
        await wait_until(() => perch!.the_creates.length === 2, 'the CLI session', 2000);
        expect(perch!.the_creates[1].command).toEqual([
            '/usr/local/bin/stata-mp', 'do', wrap(first),
        ]);
        await wait_until(() => perch!.the_sends.length === 1, 'the second send', 2000);
        expect(perch!.the_sends[0].text).toBe(`do ${wrap(second)}`);
        expect(harness.vscode_state.the_warning_calls.map(my_call => my_call.message))
            .toEqual([expect.stringContaining('Stata CLI directly')]);
        // The new session's queue owns the files: one cleanup each.
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.vscode_state.the_cleanups).toEqual([first, second]);
    });

    test('the active-terminal commands send to a Perch terminal through Perch', async () => {
        const { harness, perch } = await create_perch_harness();
        await harness.terminal_manager.send_to_stata_terminal(
            'do', await create_tracked_send_file('first')
        );
        write_ready_file(perch!.the_listed[0].dir);
        await wait_until(() => harness.vscode_state.the_cleanups.length === 1, 'ready', 2000);
        const manager = harness.terminal_manager as unknown as {
            send_to_perch_terminal: (
                terminal: MockTerminal | undefined, command: string, file_path: string
            ) => Promise<boolean | null>;
        };
        const second = await create_tracked_send_file('second');
        expect(await manager.send_to_perch_terminal(perch_terminals(harness)[0], 'do', second))
            .toBe(false);
        expect(perch!.the_sends.map(my_send => my_send.text)).toEqual([`do ${wrap(second)}`]);
        expect(await manager.send_to_perch_terminal(harness.vscode_state.terminal, 'do', second))
            .toBeNull();
        expect(await manager.send_to_perch_terminal(undefined, 'do', second)).toBeNull();
        expect(harness.vscode_state.the_send_calls).toEqual([]);
    });

    test('the profile list\'s Stata terminal is a Perch session too', async () => {
        const { harness, perch } = await create_perch_harness();
        const provider = harness.vscode_state.the_profile_providers.get(
            'sight.stataTerminal'
        );
        const profile = await provider!.provideTerminalProfile(NO_CANCEL) as {
            options: { shellPath?: string };
        };
        expect(profile.options.shellPath).toBe('/perch/bin/perch');
        expect(perch!.the_prepared).toHaveLength(1);
        expect(perch!.the_prepared[0].command.slice(0, 2)).toEqual([
            process.execPath,
            path.join(EXTENSION_PATH, 'console-runtime', 'tty.js'),
        ]);
        expect(perch!.the_prepared[0].command).not.toContain('--run');
    });
});

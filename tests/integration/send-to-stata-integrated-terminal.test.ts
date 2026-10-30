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
const WINDOWS_SENDER_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'windows-sender.ts')
).href;

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
}

interface TargetSettingValues {
    globalValue?: string;
    workspaceValue?: string;
}

interface WarningCall {
    message: string;
    the_items: string[];
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
    the_error_messages: string[];
    the_update_calls: Array<[string, unknown, number]>;
    the_cleanups: string[];
    the_app_dispatches: string[];
    the_failing_app_paths: Set<string>;
    status_item: { text: string; is_shown: boolean } | null;
    target_setting: TargetSettingValues | null;
    active_text_editor?: unknown;
    terminal: MockTerminal;
    /** When set, each createTerminal call makes a new terminal. */
    make_terminal?: (options: CreateTerminalOptions) => MockTerminal;
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
        the_error_messages: [],
        the_update_calls: [],
        the_cleanups: [],
        the_app_dispatches: [],
        the_failing_app_paths: new Set(),
        status_item: null,
        target_setting: null,
        terminal,
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
            remoteName: '',
        },
        workspace: {
            getConfiguration: (section?: string) => ({
                get: <T>(key: string, default_value?: T): T => {
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
                ...the_items: string[]
            ) => {
                if (!current_vscode_state) {
                    return Promise.resolve(undefined);
                }
                const answer = create_deferred<string | undefined>();
                current_vscode_state.the_warning_calls.push({
                    message, the_items, answer,
                });
                return answer.promise;
            },
            showInformationMessage: (message: string) => {
                current_vscode_state?.the_info_messages.push(message);
                return Promise.resolve(undefined);
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
        detect_stata_cli: async () => '/usr/local/bin/stata-mp',
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
const READY_POLL_MS = 5;
const REAL_PLATFORM = process.platform;

interface ConsoleHarness {
    vscode_state: VscodeMockState;
    the_terminals: MockTerminal[];
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
        ) => string | null;
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

function create_console_terminal(
    vscode_state: VscodeMockState,
    options: CreateTerminalOptions
): MockTerminal {
    const terminal: MockTerminal = {
        name: options.name ?? 'Stata',
        // A console's process exists long before it is ready.
        processId: new Promise<number | undefined>(() => {}),
        show: (preserve_focus = false) => {
            vscode_state.the_show_calls.push(preserve_focus);
        },
        sendText: (text: string) => {
            vscode_state.the_send_calls.push(text);
        },
        creationOptions: options,
    };
    return terminal;
}

async function create_console_harness(
    offer_timeout_ms = 60000
): Promise<ConsoleHarness> {
    const vscode_state = create_vscode_mock_state(
        new Promise<number | undefined>(() => {})
    );
    const the_terminals: MockTerminal[] = [];
    vscode_state.make_terminal = options => {
        const terminal = create_console_terminal(vscode_state, options);
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
    const context = { extensionPath: EXTENSION_PATH, subscriptions: [] };
    terminal_manager.reset_stata_terminal_manager_for_tests({
        context,
        timings: {
            ready_poll_interval_ms: READY_POLL_MS,
            offer_timeout_ms,
        },
    });
    terminal_manager.register_stata_terminal(context);
    return {
        vscode_state,
        the_terminals,
        terminal_manager,
        commands_module,
        context,
    };
}

function get_ready_file_path(options: CreateTerminalOptions): string {
    const ready_file_path = options.env?.SIGHT_CONSOLE_READY_FILE;
    if (!ready_file_path) {
        throw new Error('The console terminal has no ready file.');
    }
    return ready_file_path;
}

function close_terminal(
    vscode_state: VscodeMockState,
    terminal: MockTerminal,
    reason: number,
    code: number | undefined
): void {
    terminal.exitStatus = { reason, code };
    for (const my_listener of [...vscode_state.the_close_listeners]) {
        my_listener(terminal);
    }
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

describe.serial('Feature: sight console terminal on local Windows', () => {
    beforeAll(register_module_mocks);

    beforeEach(() => {
        current_vscode_state = null;
        set_platform('win32');
    });

    afterEach(async () => {
        set_platform(REAL_PLATFORM);
        const terminal_manager = await import(TERMINAL_MANAGER_MODULE_URL);
        terminal_manager.reset_stata_terminal_manager_for_tests();
        current_vscode_state = null;
        for (const my_file of the_created_files.splice(0)) {
            await fs.promises.unlink(my_file).catch(() => {});
        }
    });

    test('the profile runs sight console under VS Code as Node', async () => {
        const { vscode_state } = await create_console_harness();
        const provider = vscode_state.the_profile_providers.get(
            'sight.stataTerminal'
        );
        expect(provider).toBeDefined();

        const profile = await provider!.provideTerminalProfile() as {
            options: CreateTerminalOptions;
        };
        expect(profile.options.shellPath).toBe(process.execPath);
        expect(profile.options.shellArgs).toEqual([
            path.join(EXTENSION_PATH, 'cli', 'cli.js'),
            'console',
        ]);
        expect(profile.options.env?.ELECTRON_RUN_AS_NODE).toBe('1');
        expect(profile.options.env?.SIGHT_CONSOLE_FROM_EDITOR).toBe('1');
        const ready_file_path = get_ready_file_path(profile.options);
        expect(path.dirname(ready_file_path)).toBe(
            path.join(os.tmpdir(), 'sight-console')
        );
        // Each terminal gets its own ready file.
        const second = await provider!.provideTerminalProfile() as {
            options: CreateTerminalOptions;
        };
        expect(get_ready_file_path(second.options)).not.toBe(
            ready_file_path
        );
    });

    test('sends queue until the ready file appears, then are typed in order', async () => {
        const { vscode_state, the_terminals, terminal_manager } =
            await create_console_harness();
        const the_files = [
            await create_tracked_send_file('a.do'),
            await create_tracked_send_file('b.do'),
            await create_tracked_send_file('c.do'),
        ];

        // processId never resolves and nothing waits on it: the sends
        // return queued at once, with no 5 s readiness timeout.
        const the_results = await Promise.all(the_files.map(
            my_file => terminal_manager.send_to_stata_terminal(
                'do', my_file
            )
        ));
        expect(the_results).toEqual([true, true, true]);
        expect(vscode_state.create_terminal_calls).toBe(1);
        const options = vscode_state.the_create_options[0];
        expect(options.shellPath).toBe(process.execPath);
        expect(options.shellArgs).toEqual([
            path.join(EXTENSION_PATH, 'cli', 'cli.js'),
            'console',
        ]);
        expect(options.env?.ELECTRON_RUN_AS_NODE).toBe('1');
        expect(options.env?.SIGHT_CONSOLE_FROM_EDITOR).toBe('1');
        // Shown with focus so the take-over question is seen.
        expect(vscode_state.the_show_calls).toContain(false);
        expect(vscode_state.the_send_calls).toEqual([]);
        expect(vscode_state.the_cleanups).toEqual([]);
        expect(vscode_state.status_item?.is_shown).toBe(true);
        expect(vscode_state.status_item?.text).toContain('3 sends');

        await fs.promises.writeFile(get_ready_file_path(options), '');
        the_created_files.push(get_ready_file_path(options));
        await wait_until(
            () => vscode_state.the_send_calls.length === 3,
            'queued sends to be typed',
            2000
        );
        expect(vscode_state.the_send_calls).toEqual(
            the_files.map(my_file => `do ${wrap(my_file)}`)
        );
        expect(vscode_state.the_cleanups).toEqual(the_files);
        expect(vscode_state.status_item?.is_shown).toBe(false);

        // Once ready, sends are typed directly.
        const later = await create_tracked_send_file('d.do');
        expect(
            await terminal_manager.send_to_stata_terminal('include', later)
        ).toBe(false);
        expect(vscode_state.the_send_calls.at(-1)).toBe(
            `include ${wrap(later)}`
        );
        expect(the_terminals).toHaveLength(1);
    });

    test('a profile-opened console terminal queues the same way', async () => {
        const { vscode_state, terminal_manager } =
            await create_console_harness();
        const provider = vscode_state.the_profile_providers.get(
            'sight.stataTerminal'
        );
        const profile = await provider!.provideTerminalProfile() as {
            options: CreateTerminalOptions;
        };
        const terminal = create_console_terminal(
            vscode_state, profile.options
        );
        for (const my_listener of vscode_state.the_open_listeners) {
            my_listener(terminal);
        }

        const my_file = await create_tracked_send_file('a.do');
        expect(
            await terminal_manager.send_to_stata_terminal('do', my_file)
        ).toBe(true);
        expect(vscode_state.create_terminal_calls).toBe(0);
        expect(vscode_state.the_send_calls).toEqual([]);

        const ready_file_path = get_ready_file_path(profile.options);
        await fs.promises.writeFile(ready_file_path, '');
        the_created_files.push(ready_file_path);
        await wait_until(
            () => vscode_state.the_send_calls.length === 1,
            'the queued send to be typed',
            2000
        );
        expect(vscode_state.the_send_calls).toEqual([
            `do ${wrap(my_file)}`,
        ]);
    });

    test('integrated resolves to the console, with no warning', async () => {
        const { vscode_state, commands_module } =
            await create_console_harness();
        vscode_state.target_setting = { globalValue: 'integrated' };
        expect(commands_module.resolve_effective_target('app'))
            .toBe('integrated');
        expect(vscode_state.the_warning_calls).toEqual([]);
        // auto still uses the app on local Windows.
        vscode_state.target_setting = { globalValue: 'auto' };
        expect(commands_module.resolve_effective_target('app'))
            .toBe('app');
    });

    test('This session dispatches to the app until the setting changes', async () => {
        const {
            vscode_state, the_terminals, terminal_manager, commands_module,
        } = await create_console_harness();
        vscode_state.target_setting = { globalValue: 'integrated' };
        const the_files = [
            await create_tracked_send_file('a.do'),
            await create_tracked_send_file('b.do'),
        ];
        for (const my_file of the_files) {
            await terminal_manager.send_to_stata_terminal('do', my_file);
        }

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.Process, 80
        );
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
        expect(vscode_state.the_cleanups).toEqual(the_files);
        expect(terminal_manager.is_console_session_override_set())
            .toBe(true);
        expect(commands_module.resolve_effective_target('app'))
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
        expect(commands_module.resolve_effective_target('app'))
            .toBe('integrated');
    });

    test('Always writes external globally', async () => {
        const {
            vscode_state, the_terminals, terminal_manager, commands_module,
        } = await create_console_harness();
        vscode_state.target_setting = { globalValue: 'integrated' };
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.Process, 81
        );
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
        expect(commands_module.resolve_effective_target('app'))
            .toBe('app');
        expect(vscode_state.the_info_messages).toEqual([]);
    });

    test('Always with a workspace value still winning says so and sets the override', async () => {
        const {
            vscode_state, the_terminals, terminal_manager, commands_module,
        } = await create_console_harness();
        vscode_state.target_setting = { workspaceValue: 'integrated' };
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.Process, 81
        );
        vscode_state.the_warning_calls[0].answer.resolve('Always');
        await wait_until(
            () => vscode_state.the_app_dispatches.length === 1,
            'the held send to reach the app',
            2000
        );
        expect(vscode_state.the_update_calls).toHaveLength(1);
        expect(vscode_state.the_info_messages).toHaveLength(1);
        expect(vscode_state.the_info_messages[0]).toContain('overrides');
        // The extension's own write didn't clear the override.
        expect(terminal_manager.is_console_session_override_set())
            .toBe(true);
        expect(commands_module.resolve_effective_target('app'))
            .toBe('app');
    });

    test('Cancel drops the sends and the next send starts a console again', async () => {
        const { vscode_state, the_terminals, terminal_manager } =
            await create_console_harness();
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.Process, 80
        );
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
        const { vscode_state, the_terminals, terminal_manager } =
            await create_console_harness();
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.Process, 82
        );
        await wait_until(
            () => vscode_state.the_app_dispatches.length === 1,
            'the send to reach the app',
            2000
        );
        expect(vscode_state.the_warning_calls).toEqual([]);
        expect(terminal_manager.is_console_session_override_set())
            .toBe(true);
    });

    test('a host with no exit reason still offers on an exit code', async () => {
        const { vscode_state, the_terminals, terminal_manager } =
            await create_console_harness();
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);

        // VS Code before 1.77 sets only the code.
        the_terminals[0].exitStatus = { code: 80 };
        for (const my_listener of [...vscode_state.the_close_listeners]) {
            my_listener(the_terminals[0]);
        }
        expect(vscode_state.the_warning_calls).toHaveLength(1);
        vscode_state.the_warning_calls[0].answer.resolve('Cancel');
    });

    test('a helper failure during dispatch shows the error and drops the rest', async () => {
        const { vscode_state, the_terminals, terminal_manager } =
            await create_console_harness();
        const first = await create_tracked_send_file('a.do');
        const second = await create_tracked_send_file('b.do');
        await terminal_manager.send_to_stata_terminal('do', first);
        await terminal_manager.send_to_stata_terminal('do', second);
        vscode_state.the_failing_app_paths.add(first);

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.Process, 82
        );
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

    const NO_OFFER_CLOSES: Array<[string, number, number | undefined]> = [
        ['a user close', TERMINAL_EXIT_REASON.User, undefined],
        ['a shutdown', TERMINAL_EXIT_REASON.Shutdown, 80],
        ['exit code 0', TERMINAL_EXIT_REASON.Process, 0],
        ['a missing code', TERMINAL_EXIT_REASON.Process, undefined],
        ['an unknown code', TERMINAL_EXIT_REASON.Process, 1],
    ];

    for (const [my_name, my_reason, my_code] of NO_OFFER_CLOSES) {
        test(`${my_name} makes no offer and deletes pending temp files`, async () => {
            const { vscode_state, the_terminals, terminal_manager } =
                await create_console_harness();
            const my_file = await create_tracked_send_file('a.do');
            await terminal_manager.send_to_stata_terminal('do', my_file);

            close_terminal(
                vscode_state, the_terminals[0], my_reason, my_code
            );
            await wait_until(
                () => !fs.existsSync(my_file),
                'the pending temp file to be deleted',
                2000
            );
            expect(vscode_state.the_warning_calls).toEqual([]);
            expect(vscode_state.the_app_dispatches).toEqual([]);
            if (my_reason === TERMINAL_EXIT_REASON.User) {
                expect(vscode_state.the_info_messages).toEqual([]);
            } else {
                expect(vscode_state.the_info_messages).toHaveLength(1);
                expect(vscode_state.the_info_messages[0]).toStartWith(
                    'Dropped 1 send to Stata: '
                );
            }
        });
    }

    test('a ready file that appears after the close is ignored', async () => {
        const { vscode_state, the_terminals, terminal_manager } =
            await create_console_harness();
        const my_file = await create_tracked_send_file('a.do');
        await terminal_manager.send_to_stata_terminal('do', my_file);
        const ready_file_path = get_ready_file_path(
            vscode_state.the_create_options[0]
        );

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.User, undefined
        );
        await fs.promises.writeFile(ready_file_path, '');
        the_created_files.push(ready_file_path);
        await new Promise(resolve => setTimeout(resolve, READY_POLL_MS * 6));
        expect(vscode_state.the_send_calls).toEqual([]);
    });

    test('a send from the editor leaves a queued temp file to the queue', async () => {
        const { vscode_state, the_terminals, commands_module, context } =
            await create_console_harness();
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

        close_terminal(
            vscode_state, the_terminals[0],
            TERMINAL_EXIT_REASON.Process, 82
        );
        await wait_until(
            () => vscode_state.the_cleanups.length === 1,
            'the dispatched send to be scheduled for cleanup',
            2000
        );
        const dispatched = vscode_state.the_app_dispatches[0];
        the_created_files.push(dispatched);
        expect(fs.readFileSync(dispatched, 'utf8'))
            .toBe('display "queued"');
        expect(vscode_state.the_cleanups).toEqual([dispatched]);
    });
});

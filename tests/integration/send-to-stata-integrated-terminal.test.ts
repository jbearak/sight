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
const CD_CONTEXT_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'cd-context.ts')
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
    /** Temp files a pane holds until its console gives them to Stata. */
    the_held_files: Set<string>;
    /** Files the active-terminal path typed with sendText. */
    the_terminal_sends: string[];
    active_terminal?: MockTerminal;
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
    /** The first workspace folder's path, if any. */
    workspace_folder?: string;
    /** What the Stata CLI detector finds (null: nothing). */
    stata_cli?: string | null;
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
        the_held_files: new Set(),
        the_terminal_sends: [],
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
            get activeTerminal() {
                return current_vscode_state?.active_terminal;
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
    // deletion was scheduled. Holds work as in the real module, which
    // later files may get this mock in place of.
    const the_mock_held_files = new Set<string>();
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
            const was_held = the_mock_held_files.has(file_path);
            const my_timeout = setTimeout(() => {
                if (!was_held && !the_mock_held_files.has(file_path)) {
                    fs.promises.unlink(file_path).catch(() => {});
                }
            }, delay_ms);
            my_timeout.unref?.();
            return my_timeout;
        },
        hold_temp_file: (file_path: string) => {
            the_mock_held_files.add(file_path);
            current_vscode_state?.the_held_files.add(file_path);
        },
        release_temp_file: (file_path: string) => {
            the_mock_held_files.delete(file_path);
            current_vscode_state?.the_held_files.delete(file_path);
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
        detect_stata_cli: async () => {
            const stata_cli = current_vscode_state?.stata_cli;
            return stata_cli === undefined
                ? '/usr/local/bin/stata-mp' : stata_cli;
        },
        clear_stata_cli_cache: () => {},
    }));

    mock.module(INDEX_MODULE_URL, () => ({
        VALID_COMMANDS: ['do', 'include'],
    }));

    mock.module(TERMINAL_MODULE_URL, () => ({
        wrap_path_for_stata_terminal: (my_path: string) => {
            return '`"' + my_path + `"'`;
        },
        send_to_terminal: async (
            _command: string,
            temp_file_path: string
        ) => {
            current_vscode_state?.the_terminal_sends.push(temp_file_path);
        },
    }));
}

describe.serial('Feature: integrated terminal first-send reliability', () => {
    beforeAll(register_module_mocks);

    // These cover the Stata CLI terminal. Local Windows opens the
    // console pane instead (its own block below), so the platform is
    // pinned for a Windows host.
    beforeEach(() => {
        current_vscode_state = null;
        set_platform('linux');
    });

    afterEach(() => {
        set_platform(REAL_PLATFORM);
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
    /** One per send_line, in order: resolve with whether it was sent. */
    the_line_reports: Array<Deferred<boolean>>;
    is_closed: boolean;
    ready: Deferred<boolean>;
    done: Deferred<ConsoleEndResult>;
    host: {
        write(text: string): void;
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
        EDITOR_CONSOLE_API_VERSION: 3,
        start_editor_console: (host: FakeConsole['host']) => {
            const fake: FakeConsole = {
                the_inputs: [],
                the_line_reports: [],
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
                send_line: (text: string) => {
                    fake.the_inputs.push(`${text}\r`);
                    const report = create_deferred<boolean>();
                    fake.the_line_reports.push(report);
                    return report.promise;
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
    pty_helper_path?: string | null
): Promise<ConsoleHarness> {
    const vscode_state = create_vscode_mock_state(Promise.resolve(1));
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
    const context = { extensionPath: EXTENSION_PATH, subscriptions: [] };
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

        await end_console(harness, 84);
        expect(vscode_state.the_warning_calls).toHaveLength(1);
        const offer = vscode_state.the_warning_calls[0];
        expect(offer.message).toContain("Automation isn't registered");
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

        await end_console(harness, 84);
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

        await end_console(harness, 84);
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

        await end_console(harness, 84);
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

    test('a helper failure during dispatch shows the error and drops the rest', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const first = await create_tracked_send_file('a.do');
        const second = await create_tracked_send_file('b.do');
        await terminal_manager.send_to_stata_terminal('do', first);
        await terminal_manager.send_to_stata_terminal('do', second);
        vscode_state.the_failing_app_paths.add(first);

        await end_console(harness, 84);
        vscode_state.the_warning_calls[0].answer.resolve('This session');
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
        fake.done.resolve({ code: 84, took_stata: false });
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
            selection: {
                isEmpty: false,
                active: { line: 0 },
                start: { line: 0, character: 0 },
            },
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
        // However long connecting takes, the queued file has no cleanup
        // scheduled.
        expect(vscode_state.the_cleanups).toEqual([]);
        expect(vscode_state.status_item?.text).toContain('1 send');

        await end_console(harness, 84);
        vscode_state.the_warning_calls[0].answer.resolve('This session');
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

    test('a ready pane keeps a send\'s temp file until it ends', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const first = await create_tracked_send_file('first.do');
        await terminal_manager.send_to_stata_terminal('do', first);
        const fake = await console_started(harness);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_inputs.length === 1, 'the send to be typed', 2000
        );
        // Ready: typed now, but Stata may run something long first.
        const second = await create_tracked_send_file('second.do');
        expect(
            await terminal_manager.send_to_stata_terminal('do', second)
        ).toBe(false);
        expect(fake.the_inputs.at(-1)).toBe(`do ${wrap(second)}\r`);
        expect(vscode_state.the_held_files).toEqual(new Set([first, second]));

        // Stata's Automation took the first. Stata may be busy with
        // a command typed into its own window and only have queued
        // it, so no delay starts while the pane is open.
        const cleanups_before = vscode_state.the_cleanups.length;
        fake.the_line_reports[0].resolve(true);
        await wait_until(
            () => !vscode_state.the_held_files.has(first),
            'the first file to be released',
            2000
        );
        expect(vscode_state.the_cleanups.slice(cleanups_before))
            .toEqual([]);
        expect(fs.existsSync(first)).toBe(true);

        // The pane closes before the console answers for the second and
        // a third. Either may be Stata's already (a Windows send whose
        // reply is due), so neither goes at once: each gets the usual
        // delay. So does the first, now that the pane has ended.
        const third = await create_tracked_send_file('third.do');
        await terminal_manager.send_to_stata_terminal('do', third);
        const cleanups_at_close = vscode_state.the_cleanups.length;
        harness.the_terminals[0].creationOptions?.pty?.close();
        expect(vscode_state.the_held_files.size).toBe(0);
        expect(vscode_state.the_cleanups.slice(cleanups_at_close))
            .toEqual([second, third, first]);
        expect(fs.existsSync(second)).toBe(true);
        expect(fs.existsSync(third)).toBe(true);

        // The console then says the second never reached Stata (it was
        // still queued): it goes at once.
        fake.the_line_reports[1].resolve(false);
        await wait_until(
            () => !fs.existsSync(second), 'the queued file to go', 2000
        );
        // Stata accepted the third: its file stays, with no second
        // cleanup.
        fake.the_line_reports[2].resolve(true);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(fs.existsSync(third)).toBe(true);
        expect(vscode_state.the_cleanups.slice(cleanups_at_close))
            .toEqual([second, third, first]);
    });

    test('a pane keeps its last 20 delivered files, and deletes an older one at once', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const the_files: string[] = [];
        const first = await create_tracked_send_file('kept-0.do');
        the_files.push(first);
        await terminal_manager.send_to_stata_terminal('do', first);
        const fake = await console_started(harness);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_line_reports.length === 1, 'the send', 2000
        );
        for (let i = 1; i <= 21; i++) {
            const my_file = await create_tracked_send_file(`kept-${i}.do`);
            the_files.push(my_file);
            await terminal_manager.send_to_stata_terminal('do', my_file);
        }
        await wait_until(
            () => fake.the_line_reports.length === 22, 'the sends', 2000
        );
        // (The queue's own cleanup of the first, scheduled while the
        // file was held, never deletes it.)
        const cleanups_before = vscode_state.the_cleanups.length;

        // Twenty delivered: all kept, with no delay started.
        for (let i = 0; i < 20; i++) {
            fake.the_line_reports[i].resolve(true);
        }
        await wait_until(
            () => vscode_state.the_held_files.size === 2,
            'twenty files to be released',
            2000
        );
        expect(the_files.slice(0, 20).every(
            my_file => fs.existsSync(my_file)
        )).toBe(true);

        // Two more: the two oldest go, and only they.
        fake.the_line_reports[20].resolve(true);
        fake.the_line_reports[21].resolve(true);
        await wait_until(
            () => !fs.existsSync(the_files[0])
                && !fs.existsSync(the_files[1]),
            'the two oldest files to go',
            2000
        );
        expect(the_files.slice(2).every(
            my_file => fs.existsSync(my_file)
        )).toBe(true);
        expect(vscode_state.the_cleanups.slice(cleanups_before))
            .toEqual([]);

        // The pane ends: the twenty left get the usual delay.
        harness.the_terminals[0].creationOptions?.pty?.close();
        expect(vscode_state.the_cleanups.slice(cleanups_before))
            .toEqual(the_files.slice(2));
    });

    test('a held file the console drops after the pane closed is deleted once', async () => {
        const harness = await create_console_harness();
        const { terminal_manager } = harness;
        const first = await create_tracked_send_file('first.do');
        await terminal_manager.send_to_stata_terminal('do', first);
        const fake = await console_started(harness);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_inputs.length === 1, 'the send to be typed', 2000
        );

        // Hold the 30-second cleanups, to fire them by hand.
        const the_timers: Array<{
            callback: () => void; is_cleared: boolean; unref: () => void;
        }> = [];
        const real_set_timeout = globalThis.setTimeout;
        const real_clear_timeout = globalThis.clearTimeout;
        globalThis.setTimeout = ((
            callback: (...args: unknown[]) => void,
            delay_ms?: number,
            ...args: unknown[]
        ) => {
            if (delay_ms !== 30000) {
                return real_set_timeout(callback, delay_ms, ...args);
            }
            const timer = {
                callback: () => callback(...args),
                is_cleared: false,
                unref: () => undefined,
            };
            the_timers.push(timer);
            return timer;
        }) as unknown as typeof setTimeout;
        globalThis.clearTimeout = ((handle: unknown) => {
            const timer = the_timers.find(my_timer => my_timer === handle);
            if (timer) {
                timer.is_cleared = true;
                return;
            }
            real_clear_timeout(handle as Parameters<typeof clearTimeout>[0]);
        }) as typeof clearTimeout;
        try {
            // The pane closes with the line unanswered for: its file
            // gets the usual delay. Then the console says it never
            // reached Stata: the file goes at once, and only then.
            harness.the_terminals[0].creationOptions?.pty?.close();
            fake.the_line_reports[0].resolve(false);
            await wait_until(
                () => !fs.existsSync(first), 'the dropped file to go', 2000
            );
            // A later file at the same path survives the delay.
            fs.writeFileSync(first, 'replacement');
            for (const my_timer of the_timers) {
                if (!my_timer.is_cleared) {
                    my_timer.callback();
                }
            }
            await new Promise(resolve => real_set_timeout(resolve, 20));
            expect(fs.existsSync(first)).toBe(true);
        } finally {
            globalThis.setTimeout = real_set_timeout;
            globalThis.clearTimeout = real_clear_timeout;
        }
    });

    test('a send the console drops is deleted at once', async () => {
        const harness = await create_console_harness();
        const { vscode_state, terminal_manager } = harness;
        const first = await create_tracked_send_file('first.do');
        await terminal_manager.send_to_stata_terminal('do', first);
        const fake = await console_started(harness);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_line_reports.length === 1, 'the send', 2000
        );
        fake.the_line_reports[0].resolve(false);
        await wait_until(
            () => !fs.existsSync(first), 'the dropped file to go', 2000
        );
        expect(vscode_state.the_held_files.size).toBe(0);
    });

    test('the active-terminal command queues for a pane that is still connecting', async () => {
        const harness = await create_console_harness();
        const { vscode_state, commands_module, context } = harness;
        const provider = vscode_state.the_profile_providers.get(
            'sight.stataTerminal'
        );
        const profile = await provider!.provideTerminalProfile(NO_CANCEL) as {
            options: CreateTerminalOptions;
        };
        const terminal = create_pane_terminal(
            harness, vscode_state, profile.options
        );
        harness.the_terminals.push(terminal);
        for (const my_listener of vscode_state.the_open_listeners) {
            my_listener(terminal);
        }
        vscode_state.active_terminal = terminal;

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
                getText: () => 'display "early"',
            },
            selection: {
                isEmpty: false,
                active: { line: 0 },
                start: { line: 0, character: 0 },
            },
            revealRange: () => {},
        };
        try {
            commands_module.register_send_to_stata_commands(context);
            await the_registered.get('sight.terminal.doLineOrSelection')?.();
        } finally {
            delete (globalThis as Record<string, unknown>)[
                SHARED_VSCODE_TEST_STATE_KEY
            ];
        }

        expect(vscode_state.the_error_messages).toEqual([]);
        expect(vscode_state.the_terminal_sends).toEqual([]);
        expect(vscode_state.the_send_calls).toEqual([]);
        expect(vscode_state.the_cleanups).toEqual([]);
        expect(vscode_state.status_item?.text).toContain('1 send');

        const fake = await console_started(harness);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_inputs.length === 1, 'the queued send', 2000
        );
        const typed = fake.the_inputs[0];
        expect(typed.startsWith('do `"')).toBe(true);
        const file_path = typed.slice('do `"'.length, -`"'\r`.length);
        the_created_files.push(file_path);
        expect(fs.readFileSync(file_path, 'utf8')).toBe('display "early"');
        // The pane is revealed, as for any terminal, keeping focus.
        expect(vscode_state.the_show_calls).toEqual([true]);
    });

    test('the active-terminal CD commands go through the pane\'s queue', async () => {
        const harness = await create_console_harness();
        const { vscode_state, context } = harness;
        const provider = vscode_state.the_profile_providers.get(
            'sight.stataTerminal'
        );
        const profile = await provider!.provideTerminalProfile(NO_CANCEL) as {
            options: CreateTerminalOptions;
        };
        const terminal = create_pane_terminal(
            harness, vscode_state, profile.options
        );
        harness.the_terminals.push(terminal);
        for (const my_listener of vscode_state.the_open_listeners) {
            my_listener(terminal);
        }
        vscode_state.active_terminal = terminal;
        vscode_state.active_text_editor = {
            document: {
                uri: {
                    fsPath: '/tmp/example.do',
                    toString: () => 'file:///tmp/example.do',
                },
                lineCount: 1,
                save: async () => true,
                getText: () => '',
            },
            selection: {
                isEmpty: true,
                active: { line: 0 },
                start: { line: 0, character: 0 },
            },
            revealRange: () => {},
        };
        const cd_module = await import(CD_CONTEXT_MODULE_URL);
        await cd_module.execute_cd_command('file', 'terminal', context);

        expect(vscode_state.the_error_messages).toEqual([]);
        // Not sendText, which a connecting pane drops.
        expect(vscode_state.the_terminal_sends).toEqual([]);
        expect(vscode_state.the_send_calls).toEqual([]);
        // The queue owns the file: no cleanup timer meanwhile.
        expect(vscode_state.the_cleanups).toEqual([]);
        expect(vscode_state.status_item?.text).toContain('1 send');
        expect(vscode_state.the_show_calls).toEqual([true]);

        const fake = await console_started(harness);
        fake.ready.resolve(true);
        await wait_until(
            () => fake.the_inputs.length === 1, 'the queued cd', 2000
        );
        const typed = fake.the_inputs[0];
        const file_path = typed.slice('do `"'.length, -`"'\r`.length);
        the_created_files.push(file_path);
        expect(fs.readFileSync(file_path, 'utf8')).toBe('cd "/tmp"');
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
        await end_console(harness, 84);
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

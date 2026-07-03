import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    mock,
    test,
} from 'bun:test';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { wait_until } from '../wait-until';

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
}

interface CreateTerminalOptions {
    name?: string;
    shellPath?: string;
    shellArgs?: string[];
}

interface VscodeMockState {
    create_terminal_calls: number;
    the_create_options: CreateTerminalOptions[];
    the_close_listeners: Array<(terminal: MockTerminal) => void>;
    the_send_calls: string[];
    the_show_calls: boolean[];
    terminal: MockTerminal;
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
        the_send_calls,
        the_show_calls,
        terminal,
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

describe.serial('Feature: integrated terminal first-send reliability', () => {
    beforeAll(() => {
        if (registered_module_mocks) {
            return;
        }
        registered_module_mocks = true;

        mock.module('vscode', () => ({
            env: {
                remoteName: '',
            },
            workspace: {
                getConfiguration: () => ({
                    get: <T>(_key: string, default_value?: T): T => {
                        return default_value as T;
                    }
                }),
                getWorkspaceFolder: () => null,
            },
            window: {
                createTerminal: (options?: CreateTerminalOptions) => {
                    if (current_vscode_state) {
                        current_vscode_state.create_terminal_calls += 1;
                        current_vscode_state.the_create_options.push(
                            options ?? {}
                        );
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
                        return {
                            dispose: () => {},
                        };
                    }
                    current_vscode_state.the_close_listeners.push(listener);
                    return {
                        dispose: () => {
                            if (!current_vscode_state) {
                                return;
                            }
                            const idx =
                                current_vscode_state.the_close_listeners.indexOf(
                                    listener
                                );
                            if (idx !== -1) {
                                current_vscode_state.the_close_listeners.splice(
                                    idx,
                                    1
                                );
                            }
                        }
                    };
                },
                activeTextEditor: get_shared_vscode_test_state()
                    ?.active_text_editor,
                showErrorMessage: (message: string) => {
                    get_shared_vscode_test_state()
                        ?.error_messages
                        ?.push(message);
                    return Promise.resolve(undefined);
                },
                showWarningMessage: () => Promise.resolve(undefined),
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
    });

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

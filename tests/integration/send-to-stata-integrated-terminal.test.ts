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

interface VscodeMockState {
    create_terminal_calls: number;
    the_close_listeners: Array<(terminal: MockTerminal) => void>;
    the_send_calls: string[];
    the_show_calls: boolean[];
    terminal: MockTerminal;
}

let current_vscode_state: VscodeMockState | null = null;
let registered_module_mocks = false;

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
        the_close_listeners,
        the_send_calls,
        the_show_calls,
        terminal,
    };
}

async function wait_for_condition(
    predicate: () => boolean,
    timeout_ms = 200
): Promise<void> {
    const start_time_ms = Date.now();
    while (!predicate()) {
        if (Date.now() - start_time_ms > timeout_ms) {
            throw new Error('Timed out waiting for test condition.');
        }
        await new Promise(resolve => {
            setTimeout(resolve, 0);
        });
    }
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
            window: {
                createTerminal: () => {
                    if (!current_vscode_state) {
                        throw new Error('Missing VS Code test state.');
                    }
                    current_vscode_state.create_terminal_calls += 1;
                    return current_vscode_state.terminal;
                },
                onDidCloseTerminal: (
                    listener: (terminal: MockTerminal) => void
                ) => {
                    if (!current_vscode_state) {
                        throw new Error('Missing VS Code test state.');
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
            },
            ThemeIcon: class ThemeIcon {
                constructor(public id: string) {}
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
        }));
    });

    beforeEach(() => {
        current_vscode_state = null;
    });

    afterAll(() => {
        current_vscode_state = null;
        mock.restore();
    });

    test('waits for a new terminal to become ready before sending', async () => {
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
        });

        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_show_calls).toEqual([true]);
        expect(vscode_state.the_send_calls).toEqual([]);

        process_id_deferred.resolve(1234);
        await send_promise;

        expect(vscode_state.the_send_calls).toEqual([
            "do `\"/tmp/first.do\"'",
        ]);
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

        const second_send = terminal_manager.send_to_stata_terminal(
            'include',
            '/tmp/second.do'
        );
        await second_send;

        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_send_calls).toEqual([
            "do `\"/tmp/first.do\"'",
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
        });

        expect(vscode_state.create_terminal_calls).toBe(1);
        expect(vscode_state.the_send_calls).toEqual([]);

        process_id_deferred.resolve(1234);
        await Promise.all([first_send, second_send]);

        expect(vscode_state.the_send_calls).toEqual([
            "do `\"/tmp/first.do\"'",
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
        });

        for (const my_listener of vscode_state.the_close_listeners) {
            my_listener(vscode_state.terminal);
        }

        await expect(send_promise).rejects.toThrow(
            'closed before it was ready'
        );
        expect(vscode_state.the_send_calls).toEqual([]);
    });
});

import {
    afterEach,
    afterAll,
    beforeAll,
    describe,
    expect,
    test,
    mock,
} from 'bun:test';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

const SEND_TO_STATA_DIR = path.resolve(
    import.meta.dir,
    '../../client/src/send-to-stata'
);

const COMMANDS_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'commands.ts')
).href;
const CD_CONTEXT_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'cd-context.ts')
).href;
const APPLESCRIPT_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'applescript.ts')
).href;
const STATA_DETECTOR_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'stata-detector.ts')
).href;
const STATA_TERMINAL_MANAGER_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'stata-terminal-manager.ts')
).href;
const STATEMENT_DETECTOR_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'statement-detector.ts')
).href;
const TEMP_FILE_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'temp-file.ts')
).href;
const TERMINAL_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'terminal.ts')
).href;
const WINDOWS_SENDER_MODULE_URL = pathToFileURL(
    path.join(SEND_TO_STATA_DIR, 'windows-sender.ts')
).href;

type RegisteredCommand = () => Promise<void> | void;

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}

const READ_ATTEMPT_TIMEOUT_MS = 2000;

function create_deferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((the_resolve, the_reject) => {
        resolve = the_resolve;
        reject = the_reject;
    });
    return { promise, resolve, reject };
}

async function expect_to_resolve_within<T>(
    promise: Promise<T>,
    timeout_ms: number,
    description: string
): Promise<T> {
    let my_timeout_handle: NodeJS.Timeout | null = null;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                my_timeout_handle = setTimeout(() => {
                    reject(
                        new Error(
                            `${description} timed out after `
                            + `${timeout_ms} ms`
                        )
                    );
                }, timeout_ms);
                my_timeout_handle.unref?.();
            }),
        ]);
    } finally {
        if (my_timeout_handle) {
            clearTimeout(my_timeout_handle);
        }
    }
}

const POLL_INTERVAL_MS = 25;
const DELETION_TIMEOUT_MS = 2000;

async function wait_for_file_deletion(
    file_path: string
): Promise<void> {
    const start_time_ms = Date.now();
    while (Date.now() - start_time_ms < DELETION_TIMEOUT_MS) {
        try {
            await fs.stat(file_path);
        } catch (my_error: unknown) {
            if (
                my_error instanceof Error
                && 'code' in my_error
                && (my_error as NodeJS.ErrnoException).code
                    === 'ENOENT'
            ) {
                return;
            }
            throw my_error;
        }
        await new Promise(resolve => {
            setTimeout(resolve, POLL_INTERVAL_MS);
        });
    }
    throw new Error(
        `File ${file_path} was not deleted within `
        + `${DELETION_TIMEOUT_MS} ms`
    );
}

describe('Feature: send-to-stata app temp file lifecycle', () => {
    const the_registered_commands = new Map<string, RegisteredCommand>();
    const the_error_messages: string[] = [];
    const the_temp_files = new Set<string>();
    const the_context_subscriptions: Array<{
        dispose: () => void;
    }> = [];
    let observed_temp_file_path: string | null = null;
    let observed_temp_file_content: string | null = null;
    let read_attempt_deferred = create_deferred<void>();

    function simulate_stata_read(
        temp_file_path: string
    ): void {
        observed_temp_file_path = temp_file_path;
        const my_timeout = setTimeout(async () => {
            try {
                observed_temp_file_content =
                    await fs.readFile(
                        temp_file_path,
                        'utf8'
                    );
                read_attempt_deferred.resolve();
            } catch (my_error) {
                read_attempt_deferred.reject(my_error);
            }
        }, 10);
        my_timeout.unref?.();
    }

    let commands_module: typeof import(
        '../../client/src/send-to-stata/commands'
    ) | null = null;
    let cd_context_module: typeof import(
        '../../client/src/send-to-stata/cd-context'
    ) | null = null;

    beforeAll(async () => {
        mock.module('vscode', () => ({
            env: {
                remoteName: '',
            },
            workspace: {
                getConfiguration: () => ({
                    get: <T>(key: string, default_value?: T): T => {
                        if (key === 'saveBeforeSend') {
                            return false as T;
                        }
                        if (key === 'workingDirectory') {
                            return 'none' as T;
                        }
                        if (key === 'focusStataWindow') {
                            return false as T;
                        }
                        if (key === 'target') {
                            return 'auto' as T;
                        }
                        return default_value as T;
                    }
                }),
                getWorkspaceFolder: () => null,
            },
            window: {
                activeTextEditor: {
                    document: {
                        uri: {
                            fsPath: '/tmp/example.do',
                            toString: () => 'file:///tmp/example.do',
                        },
                        lineCount: 1,
                        save: async () => true,
                        getText: () => 'display "hello from temp file"',
                    },
                    selection: {
                        isEmpty: false,
                        active: {
                            line: 0,
                        },
                    },
                    revealRange: () => {},
                },
                showErrorMessage: (message: string) => {
                    the_error_messages.push(message);
                    return Promise.resolve(undefined);
                },
                showWarningMessage: () => Promise.resolve(undefined),
            },
            commands: {
                registerCommand: (
                    name: string,
                    handler: RegisteredCommand
                ) => {
                    the_registered_commands.set(name, handler);
                    return {
                        dispose: () => {
                            the_registered_commands.delete(name);
                        }
                    };
                }
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

        mock.module(STATEMENT_DETECTOR_MODULE_URL, () => {
            return {
                detect_statement: () => ({ start_line: 0, end_line: 0 }),
                get_statement_text: () => 'display "hello from temp file"',
                get_upward_bounds: () => ({ start_line: 0, end_line: 0 }),
                get_downward_bounds: () => ({ start_line: 0, end_line: 0 }),
            };
        });

        mock.module(TEMP_FILE_MODULE_URL, () => {
            return {
                schedule_temp_file_cleanup: (
                    file_path: string,
                    delay_ms = 40
                ) => {
                    const my_timeout = setTimeout(() => {
                        fs.unlink(file_path).catch(() => {});
                    }, delay_ms);
                    my_timeout.unref?.();
                    return my_timeout;
                },
                create_temp_file: async (content: string) => {
                    const file_path = path.join(
                        os.tmpdir(),
                        `stata_send_test_${crypto.randomUUID()}.do`
                    );
                    await fs.writeFile(file_path, content, 'utf8');
                    the_temp_files.add(file_path);
                    return file_path;
                },
            };
        });

        mock.module(STATA_DETECTOR_MODULE_URL, () => ({
            detect_stata_app: async () => 'StataMP',
            clear_stata_cache: () => {},
        }));

        mock.module(APPLESCRIPT_MODULE_URL, () => ({
            send_to_stata_app: async (
                _stata_app: string,
                _command: string,
                temp_file_path: string,
                _focus_stata: boolean
            ) => {
                simulate_stata_read(temp_file_path);
            },
        }));

        mock.module(TERMINAL_MODULE_URL, () => ({
            send_to_terminal: async (
                _command: string,
                temp_file_path: string
            ) => {
                simulate_stata_read(temp_file_path);
            },
        }));

        mock.module(STATA_TERMINAL_MANAGER_MODULE_URL, () => ({
            send_to_stata_terminal: async (
                _command: string,
                temp_file_path: string
            ) => {
                simulate_stata_read(temp_file_path);
            },
        }));

        mock.module(WINDOWS_SENDER_MODULE_URL, () => ({
            send_to_stata_windows: async () => {},
            ensure_executable: async () => null,
        }));

        const my_import_suffix = `?test=${Date.now()}`;
        commands_module = await import(
            `${COMMANDS_MODULE_URL}${my_import_suffix}`
        );
        cd_context_module = await import(
            `${CD_CONTEXT_MODULE_URL}${my_import_suffix}`
        );
    });

    afterEach(() => {
        while (the_context_subscriptions.length > 0) {
            const my_subscription = the_context_subscriptions.pop();
            my_subscription?.dispose();
        }
        the_registered_commands.clear();
    });

    afterAll(async () => {
        for (const my_file_path of the_temp_files) {
            await fs.unlink(my_file_path).catch(() => {});
        }
    });

    test('app-mode send keeps the temp file available until Stata can read it', async () => {
        the_error_messages.length = 0;
        observed_temp_file_path = null;
        observed_temp_file_content = null;
        read_attempt_deferred = create_deferred<void>();

        const my_context = {
            subscriptions: the_context_subscriptions,
        };

        commands_module!.register_send_to_stata_commands(my_context);

        const my_handler = the_registered_commands.get(
            'sight.doLineOrSelection'
        );
        expect(my_handler).toBeDefined();

        await my_handler?.();
        await expect_to_resolve_within(
            read_attempt_deferred.promise,
            READ_ATTEMPT_TIMEOUT_MS,
            'temp file read attempt'
        );

        expect(the_error_messages).toEqual([]);
        expect(observed_temp_file_path).toBeTruthy();
        expect(observed_temp_file_content).toBe(
            'display "hello from temp file"'
        );

        await wait_for_file_deletion(
            observed_temp_file_path!
        );
    });

    test('app-mode cd send keeps the temp file available until Stata can read it', async () => {
        the_error_messages.length = 0;
        observed_temp_file_path = null;
        observed_temp_file_content = null;
        read_attempt_deferred = create_deferred<void>();

        const my_context = {
            subscriptions: the_context_subscriptions,
        };

        cd_context_module!.register_cd_commands(my_context);

        const my_handler = the_registered_commands.get(
            'sight.cdFile'
        );
        expect(my_handler).toBeDefined();

        await my_handler?.();
        await expect_to_resolve_within(
            read_attempt_deferred.promise,
            READ_ATTEMPT_TIMEOUT_MS,
            'temp file read attempt'
        );

        expect(the_error_messages).toEqual([]);
        expect(observed_temp_file_path).toBeTruthy();
        expect(observed_temp_file_content).toBe(
            'cd "/tmp"'
        );

        await wait_for_file_deletion(
            observed_temp_file_path!
        );
    });
});

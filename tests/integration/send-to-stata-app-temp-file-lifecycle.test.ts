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
const INDEX_MODULE_PATH = path.join(
    SEND_TO_STATA_DIR,
    'index.ts'
);
const WINDOWS_SENDER_MODULE_PATH = path.join(
    SEND_TO_STATA_DIR,
    'windows-sender.ts'
);

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

function set_process_platform(
    platform: NodeJS.Platform
): () => void {
    const original_descriptor = Object.getOwnPropertyDescriptor(
        process,
        'platform'
    );

    Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true,
    });

    return () => {
        if (original_descriptor) {
            Object.defineProperty(
                process,
                'platform',
                original_descriptor
            );
        }
    };
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
    let commands_module: typeof import('../../client/src/send-to-stata/commands') | null = null;
    let cd_context_module: typeof import('../../client/src/send-to-stata/cd-context') | null = null;

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

        mock.module(INDEX_MODULE_PATH, () => {
            return {
                VALID_COMMANDS: ['do', 'include'],
                detect_statement: () => ({ start_line: 0, end_line: 0 }),
                get_statement_text: () => 'display "hello from temp file"',
                get_upward_bounds: () => ({ start_line: 0, end_line: 0 }),
                get_downward_bounds: () => ({ start_line: 0, end_line: 0 }),
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
                detect_stata_app: async () => 'StataMP',
                clear_stata_cache: () => {},
                send_to_stata_app: async (
                    _stata_app: string,
                    _command: string,
                    temp_file_path: string,
                    _focus_stata: boolean
                ) => {
                    observed_temp_file_path = temp_file_path;
                    const my_timeout = setTimeout(async () => {
                        try {
                            observed_temp_file_content = await fs.readFile(
                                temp_file_path,
                                'utf8'
                            );
                            read_attempt_deferred.resolve();
                        } catch (my_error) {
                            read_attempt_deferred.reject(my_error);
                        }
                    }, 10);
                    my_timeout.unref?.();
                },
                send_to_terminal: async () => {},
                send_to_stata_terminal: async () => {},
            };
        });

        mock.module(WINDOWS_SENDER_MODULE_PATH, () => ({
            send_to_stata_windows: async () => {},
            ensure_executable: async () => null,
        }));

        commands_module = await import(COMMANDS_MODULE_URL);
        cd_context_module = await import(CD_CONTEXT_MODULE_URL);
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
        const restore_platform = set_process_platform('darwin');

        try {
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

            await new Promise(resolve => setTimeout(resolve, 80));

            await expect(
                fs.readFile(observed_temp_file_path!, 'utf8')
            ).rejects.toMatchObject({
                code: 'ENOENT'
            });
        } finally {
            restore_platform();
        }
    });

    test('app-mode cd send keeps the temp file available until Stata can read it', async () => {
        the_error_messages.length = 0;
        observed_temp_file_path = null;
        observed_temp_file_content = null;
        read_attempt_deferred = create_deferred<void>();
        const restore_platform = set_process_platform('darwin');

        try {
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

            await new Promise(resolve => setTimeout(resolve, 80));

            await expect(
                fs.readFile(observed_temp_file_path!, 'utf8')
            ).rejects.toMatchObject({
                code: 'ENOENT'
            });
        } finally {
            restore_platform();
        }
    });
});

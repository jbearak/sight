export interface ManagedLanguageClient {
    start(): Promise<void>;
    stop(): Promise<void>;
}

export interface LifecycleLogger {
    appendLine(message: string): void;
}

interface LifecycleHooks<TClient> {
    on_started?: (client: TClient) => void;
}

interface LifecycleOptions {
    startup_timeout_ms?: number;
    stop_timeout_ms?: number;
}

type LifecycleState =
    | 'idle'
    | 'starting'
    | 'started'
    | 'start_failed'
    | 'stopping'
    | 'stopped';

const DEFAULT_STARTUP_TIMEOUT_MS = 1000;
const DEFAULT_STOP_TIMEOUT_MS = 1000;

function sleep(my_timeout_ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, my_timeout_ms));
}

export class LanguageClientLifecycle<TClient extends ManagedLanguageClient> {
    private client: TClient | null = null;
    private state: LifecycleState = 'idle';
    private start_promise: Promise<void> | null = null;
    private stop_promise: Promise<void> | null = null;
    private deactivating = false;
    private startup_timeout_ms: number;
    private stop_timeout_ms: number;

    constructor(
        private logger: LifecycleLogger,
        private hooks: LifecycleHooks<TClient> = {},
        options: LifecycleOptions = {}
    ) {
        this.startup_timeout_ms =
            options.startup_timeout_ms ?? DEFAULT_STARTUP_TIMEOUT_MS;
        this.stop_timeout_ms =
            options.stop_timeout_ms ?? DEFAULT_STOP_TIMEOUT_MS;
    }

    start_client(the_client: TClient): Promise<void> {
        if (this.client === the_client && this.start_promise) {
            return this.start_promise;
        }
        if (this.stop_promise) {
            return this.stop_promise.then(() =>
                this.start_client(the_client)
            );
        }

        this.client = the_client;
        this.state = 'starting';

        this.start_promise = the_client.start()
            .then(() => {
                if (this.client !== the_client) {
                    return;
                }

                this.state = 'started';
                if (!this.deactivating) {
                    this.hooks.on_started?.(the_client);
                }
            })
            .catch((my_error) => {
                if (this.client === the_client) {
                    this.state = 'start_failed';
                }
                throw my_error;
            });

        return this.start_promise;
    }

    async deactivate(): Promise<void> {
        if (this.stop_promise) {
            await this.stop_promise;
            return;
        }

        this.deactivating = true;

        const the_client = this.client;
        if (!the_client) {
            this.deactivating = false;
            this.state = 'stopped';
            return;
        }

        this.stop_promise = this.stop_client(the_client);
        await this.stop_promise;
    }

    private async stop_client(the_client: TClient): Promise<void> {
        this.state = 'stopping';

        try {
            if (this.start_promise) {
                const my_started = await this.wait_for_startup(the_client);
                if (!my_started) {
                    return;
                }
            }

            await this.wait_for_stop(the_client);
        } finally {
            if (this.client === the_client) {
                this.client = null;
            }
            this.start_promise = null;
            this.stop_promise = null;
            this.deactivating = false;
            this.state = 'stopped';
        }
    }

    private async wait_for_startup(
        the_client: TClient
    ): Promise<boolean> {
        if (!this.start_promise) {
            return this.state === 'started';
        }

        const my_start_promise = this.start_promise;
        const my_success_result = Symbol('startup_success');
        const my_timeout_result = Symbol('startup_timeout');

        const my_result = await Promise.race([
            my_start_promise.then(
                () => my_success_result,
                my_error => my_error
            ),
            sleep(this.startup_timeout_ms).then(
                () => my_timeout_result
            ),
        ]);

        if (my_result === my_success_result) {
            return true;
        }

        if (my_result === my_timeout_result) {
            this.log(
                'Language client startup did not finish before shutdown timeout; ' +
                'will stop it after startup settles.'
            );

            void my_start_promise.then(
                () => this.wait_for_stop(the_client)
                    .catch((my_error) => {
                        this.log(
                            `Deferred language client stop failed: ${String(my_error)}`
                        );
                    }),
                my_error => {
                    this.log(
                        'Language client startup failed during shutdown: ' +
                        String(my_error)
                    );
                }
            );

            return false;
        }

        this.log(
            `Language client startup failed: ${String(my_result)}`
        );
        return false;
    }

    private async wait_for_stop(the_client: TClient): Promise<void> {
        const my_success_result = Symbol('stop_success');
        const my_timeout_result = Symbol('stop_timeout');
        const my_result = await Promise.race([
            the_client.stop().then(
                () => my_success_result,
                my_error => my_error
            ),
            sleep(this.stop_timeout_ms).then(
                () => my_timeout_result
            ),
        ]);

        if (my_result === my_success_result) {
            return;
        }

        if (my_result === my_timeout_result) {
            this.log(
                'Language client stop did not finish before shutdown timeout.'
            );
            return;
        }

        this.log(
            `Language client stop failed: ${String(my_result)}`
        );
    }

    private log(message: string): void {
        try {
            this.logger.appendLine(message);
        } catch {
            // Ignore logging failures during shutdown.
        }
    }
}

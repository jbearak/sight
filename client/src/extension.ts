import * as path from 'path';
import {
    workspace,
    ExtensionContext,
    OutputChannel,
    window,
    commands
} from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    State,
    TransportKind
} from 'vscode-languageclient/node.js';
import {
    configureDepthColors,
    disableDepthColors,
    resetDepthColors,
    registerThemeChangeHandler,
    registerDepthColorsConfigHandler,
    isDepthColorsEnabled
} from './depth-colors.js';
import { register_quote_auto_close } from './quote-auto-close.js';
import { ConflictDetector } from './conflict-detector.js';
import { register_send_to_stata_commands, initialize_cd_context, register_cd_commands, set_language_client, register_open_in_stata, register_stata_terminal } from './send-to-stata/index.js';
import { register_smcl_preview } from './smcl-preview/index.js';
import { register_data_browser } from './data-browser/index.js';
import {
    LanguageClientLifecycle,
    register_running_state_reconciliation,
} from './language-client-lifecycle.js';
import {
    current_diagnostic_resource_uris,
} from './diagnostic-resources.js';
import {
    clear_ineligible_diagnostics,
    diagnostics_for_resource,
    same_diagnostic_resource_uris,
} from './diagnostic-resources-core.js';
import {
    apply_language_configuration,
    read_line_comment_style,
} from './language-config.js';
import {
    trust_hover,
    trust_completion_item,
} from './help-link-middleware.js';

let client: LanguageClient | null = null;
let output_channel: OutputChannel | null = window.createOutputChannel(
    'Sight Extension'
);
const DEACTIVATE_TIMEOUT_MS = 200;
const DIAGNOSTIC_RESOURCES_CHANGED =
    'sight/diagnosticResourcesChanged';

function sleep(my_timeout_ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, my_timeout_ms));
}

const client_lifecycle = new LanguageClientLifecycle<LanguageClient>(
    {
        appendLine: (message) => {
            output_channel?.appendLine(message);
        },
    },
    {
        on_started: (the_client) => {
            output_channel?.appendLine('Language client started successfully');
            set_language_client(the_client);
        },
    }
);

export function activate(context: ExtensionContext): void {
    if (!output_channel) {
        output_channel = window.createOutputChannel(
            'Sight Extension'
        );
    }

    output_channel.appendLine('Sight extension activating...');

    // Initialize conflict detector
    const conflict_detector = new ConflictDetector(context, {
        appendLine: (msg) => output_channel?.appendLine(msg),
    });
    conflict_detector.checkAndNotify();
    context.subscriptions.push(conflict_detector);

    // Custom quote auto-close for complex Stata patterns (nested macros, compound strings)
    // VS Code's built-in autoClosingPairs handles basic ` → `' but not nested cases
    context.subscriptions.push(register_quote_auto_close());

    // Apply dynamic language configuration for line comment style
    let language_config_disposable = apply_language_configuration(
        read_line_comment_style()
    );
    context.subscriptions.push(language_config_disposable);

    // Re-apply language configuration when the setting changes.
    // Dispose the old config and push the new disposable so
    // VS Code cleans it up on deactivation.
    const config_change_listener = workspace.onDidChangeConfiguration(
        e => {
            if (e.affectsConfiguration('sight.lineCommentStyle')) {
                language_config_disposable.dispose();
                language_config_disposable =
                    apply_language_configuration(
                        read_line_comment_style()
                    );
                context.subscriptions.push(
                    language_config_disposable
                );
            }
        }
    );
    context.subscriptions.push(config_change_listener);

    // Register send-to-stata commands and Stata terminal profile
    register_send_to_stata_commands(context);
    register_stata_terminal(context);

    // Initialize CD context and register CD commands
    initialize_cd_context(context);
    register_cd_commands(context);
    
    // Register open-in-stata command for SMCL/sthlp files
    register_open_in_stata(context);

    // Register SMCL preview commands
    register_smcl_preview(context, () => client);

    // Register data browser
    register_data_browser(
        context,
        (msg) => output_channel?.appendLine(msg)
    );

    // Register the reset depth colors command
    const reset_command = commands.registerCommand('sight.resetDepthColors', async () => {
        output_channel?.appendLine('Reset depth colors command triggered');
        if (!isDepthColorsEnabled()) {
            output_channel?.appendLine('Depth colors disabled; reset command is a no-op');
            window.showInformationMessage(
                'Sight depth colors are disabled in sight.depthColors.enabled. Enable the setting to reset and reapply colors.'
            );
            return;
        }
        await resetDepthColors(context, output_channel ?? undefined);
        window.showInformationMessage('Sight depth colors have been reset and reapplied.');
    });
    context.subscriptions.push(reset_command);
    
    // Configure or clean up depth colors based on the current setting.
    // Handles the case where a user edits settings.json to disable the
    // feature while VS Code is closed: on next activation we clean up
    // the stale rules we wrote in a prior session.
    if (isDepthColorsEnabled()) {
        output_channel.appendLine('Calling configureDepthColors...');
        configureDepthColors(context, output_channel ?? undefined).catch((error) => {
            output_channel?.appendLine(`Failed to configureDepthColors: ${error}`);
        });
    } else {
        output_channel.appendLine('Depth colors disabled; cleaning up any stale rules...');
        disableDepthColors(context, output_channel ?? undefined).catch((error) => {
            output_channel?.appendLine(`Failed to disableDepthColors: ${error}`);
        });
    }
    
    // Register theme change handler to update colors when theme kind changes
    const theme_change_handler = registerThemeChangeHandler({
        appendLine: (msg) => output_channel?.appendLine(msg),
    });
    context.subscriptions.push(theme_change_handler);
    output_channel.appendLine('Registered theme change handler');

    // React to users flipping sight.depthColors.enabled at runtime
    const depth_colors_config_handler = registerDepthColorsConfigHandler(
        context,
        output_channel ?? undefined
    );
    context.subscriptions.push(depth_colors_config_handler);
    output_channel.appendLine('Registered depth colors config handler');

    // The server is bundled inside the extension at 'server/server.js'
    const serverModule = context.asAbsolutePath(
        path.join('server', 'server.js')
    );
    output_channel.appendLine(`Server module path: ${serverModule}`);

    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    const file_watcher = workspace.createFileSystemWatcher(
        '**/{*.do,*.ado,*.doh,*.mata,sight.toml,.sight.json}'
    );
    context.subscriptions.push(file_watcher);

    const clientOptions: LanguageClientOptions = {
        // Register the server for Stata documents
        documentSelector: [{ scheme: 'file', language: 'stata' }],
        synchronize: {
            // Notify the server about file changes to .do/.ado files in the workspace
            fileEvents: file_watcher,
            // Synchronize the 'sight' configuration section with the server
            configurationSection: 'sight'
        },
        // A function is required: vscode-languageclient reevaluates it on
        // automatic restart, before replaying already-open didOpen messages.
        initializationOptions: () => ({
            // Keep protocol metadata separate from the server's settings
            // mapper. An empty object survives JSON serialization; undefined
            // would be dropped and expose diagnosticUris as a config key.
            sight: {},
            diagnosticUris: current_diagnostic_resource_uris(),
        }),
        // Trust the `sight.openHelpTopic` command link that the server
        // emits in hover and completion markdown. VS Code strips
        // command URIs from LSP-provided markdown by default; this
        // middleware narrowly re-enables the single Sight command.
        middleware: {
            handleDiagnostics: (uri, diagnostics, next) => {
                const eligible = new Set(
                    current_diagnostic_resource_uris()
                );
                // Client-side final gate for a publication already in transit
                // when its tab disappeared.
                next(
                    uri,
                    diagnostics_for_resource(
                        uri.toString(), diagnostics, eligible
                    )
                );
            },
            provideHover: async (document, position, token, next) => {
                const my_hover = await next(document, position, token);
                if (!my_hover) {
                    return my_hover;
                }
                return trust_hover(my_hover);
            },
            provideCompletionItem: async (
                document, position, context, token, next
            ) => {
                const my_result = await next(
                    document, position, context, token
                );
                if (!my_result) {
                    return my_result;
                }
                if (Array.isArray(my_result)) {
                    for (const my_item of my_result) {
                        trust_completion_item(my_item);
                    }
                    return my_result;
                }
                for (const my_item of my_result.items) {
                    trust_completion_item(my_item);
                }
                return my_result;
            },
            resolveCompletionItem: async (item, token, next) => {
                const my_resolved = await next(item, token);
                if (!my_resolved) {
                    return my_resolved;
                }
                return trust_completion_item(my_resolved);
            },
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'sight',
        'Sight Language Server',
        serverOptions,
        clientOptions
    );

    const the_client = client;
    let last_notified_diagnostic_uris: string[] | undefined;
    const synchronize_diagnostic_resources = async (
        force_notification = false
    ): Promise<void> => {
        const diagnostic_uris = current_diagnostic_resource_uris();
        clear_ineligible_diagnostics(
            the_client.diagnostics,
            new Set(diagnostic_uris)
        );
        // Clearing retained client diagnostics is useful even while stopped;
        // only the wire notification requires a live connection.
        if (the_client.state !== State.Running) {
            return;
        }
        if (!force_notification && same_diagnostic_resource_uris(
            last_notified_diagnostic_uris,
            diagnostic_uris
        )) {
            return;
        }

        // Claim this snapshot before awaiting the transport so overlapping
        // editor events cannot enqueue duplicate full-set notifications.
        last_notified_diagnostic_uris = diagnostic_uris;
        try {
            await the_client.sendNotification(
                DIAGNOSTIC_RESOURCES_CHANGED,
                { diagnosticUris: diagnostic_uris }
            );
        } catch (error) {
            if (same_diagnostic_resource_uris(
                last_notified_diagnostic_uris,
                diagnostic_uris
            )) {
                last_notified_diagnostic_uris = undefined;
            }
            throw error;
        }
    };

    let activity_sync_scheduled = false;
    const schedule_diagnostic_resource_sync = (): void => {
        if (activity_sync_scheduled) {
            return;
        }
        activity_sync_scheduled = true;
        queueMicrotask(() => {
            activity_sync_scheduled = false;
            void synchronize_diagnostic_resources().catch((error) => {
                output_channel?.appendLine(
                    `Failed to synchronize diagnostic resources: ${error}`
                );
            });
        });
    };

    context.subscriptions.push(
        window.tabGroups.onDidChangeTabs(
            schedule_diagnostic_resource_sync
        ),
        window.onDidChangeVisibleTextEditors(
            schedule_diagnostic_resource_sync
        ),
        window.onDidChangeActiveTextEditor(
            schedule_diagnostic_resource_sync
        ),
        register_running_state_reconciliation(
            the_client,
            State.Running,
            () => synchronize_diagnostic_resources(true),
            (error) => output_channel?.appendLine(
                `Diagnostic restart reconciliation failed: ${error}`
            )
        )
    );

    // Start the client. This will also launch the server.
    client_lifecycle.start_client(client).catch((error) => {
        output_channel?.appendLine(`Failed to start language client: ${error}`);
    });
}

export async function deactivate(): Promise<void> {
    set_language_client(null);
    const deactivate_promise = client_lifecycle.deactivate();
    client = null;
    await Promise.race([
        deactivate_promise,
        sleep(DEACTIVATE_TIMEOUT_MS)
    ]);
    output_channel?.dispose();
    output_channel = null;
}

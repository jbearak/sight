import * as path from 'path';
import { workspace, ExtensionContext, window, commands } from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { configureDepthColors, resetDepthColors, registerThemeChangeHandler } from './depth-colors';
import { register_quote_auto_close } from './quote-auto-close';
import { ConflictDetector } from './conflict-detector';
import { register_send_to_stata_commands } from './send-to-stata';

let client: LanguageClient;
const outputChannel = window.createOutputChannel('Sight Language Server');

export function activate(context: ExtensionContext) {
    outputChannel.appendLine('Sight extension activating...');

    // Initialize conflict detector
    const conflictDetector = new ConflictDetector(context, outputChannel);
    conflictDetector.checkAndNotify();
    context.subscriptions.push(conflictDetector);

    // Custom quote auto-close for complex Stata patterns (nested macros, compound strings)
    // VS Code's built-in autoClosingPairs handles basic ` → `' but not nested cases
    context.subscriptions.push(register_quote_auto_close());
    
    // Register send-to-stata commands
    register_send_to_stata_commands(context);
    
    // Register the reset depth colors command
    const reset_command = commands.registerCommand('sight.resetDepthColors', async () => {
        outputChannel.appendLine('Reset depth colors command triggered');
        await resetDepthColors(context, outputChannel);
        window.showInformationMessage('Sight depth colors have been reset and reapplied.');
    });
    context.subscriptions.push(reset_command);
    
    // Configure depth colors for nested strings and macros on first activation
    outputChannel.appendLine('Calling configureDepthColors...');
    configureDepthColors(context, outputChannel).catch((error) => {
        outputChannel.appendLine(`Failed to configureDepthColors: ${error}`);
    });
    
    // Register theme change handler to update colors when theme kind changes
    const theme_change_handler = registerThemeChangeHandler(outputChannel);
    context.subscriptions.push(theme_change_handler);
    outputChannel.appendLine('Registered theme change handler');
    
    // The server is bundled inside the extension at 'server/server.js'
    const serverModule = context.asAbsolutePath(
        path.join('server', 'server.js')
    );
    outputChannel.appendLine(`Server module path: ${serverModule}`);

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
    const clientOptions: LanguageClientOptions = {
        // Register the server for Stata documents
        documentSelector: [{ scheme: 'file', language: 'stata' }],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/*.{do,ado}'),
            // Synchronize the 'sight' configuration section with the server
            configurationSection: 'sight'
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'sight',
        'Sight Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start().then(() => {
        outputChannel.appendLine('Language client started successfully');
    }).catch((error) => {
        outputChannel.appendLine(`Failed to start language client: ${error}`);
    });
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

/**
 * vscode enums and classes that every `mock.module('vscode', ...)` in
 * the suite spreads into its mock.
 *
 * Bun fixes a mocked module's export names at the first
 * mock.module() call in the process; later calls only update names
 * that already exist. Whichever test file mocks 'vscode' first
 * therefore decides which top-level names any later file can see, so
 * names a later file needs must be in every mock, whatever order the
 * files run in.
 */
export const VSCODE_MOCK_SHARED_EXPORTS = {
    TerminalExitReason: {
        Unknown: 0,
        Shutdown: 1,
        Process: 2,
        User: 3,
        Extension: 4,
    },
    ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3,
    },
    StatusBarAlignment: {
        Left: 1,
        Right: 2,
    },
    TerminalProfile: class TerminalProfile {
        constructor(public options: unknown) {}
    },
    EventEmitter: class EventEmitter<T> {
        private the_listeners: Array<(value: T) => void> = [];
        event = (listener: (value: T) => void) => {
            this.the_listeners.push(listener);
            return {
                dispose: () => {
                    this.the_listeners = this.the_listeners.filter(
                        my_listener => my_listener !== listener
                    );
                },
            };
        };
        fire(value: T): void {
            for (const my_listener of [...this.the_listeners]) {
                my_listener(value);
            }
        }
        dispose(): void {
            this.the_listeners = [];
        }
    },
};

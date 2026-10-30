/**
 * Minimal `vscode` module for running the data-browser host code
 * headless under Node. Only the members DataBrowserPanel touches are
 * provided; configuration reads return their defaults.
 */

export const workspace = {
    getConfiguration: () => ({
        get: <T>(_key: string, default_value: T): T => default_value,
    }),
};

export const window = {
    showErrorMessage: (msg: string) => {
        console.error(`[showErrorMessage] ${msg}`);
        return undefined;
    },
    showWarningMessage: (msg: string) => {
        console.error(`[showWarningMessage] ${msg}`);
        return undefined;
    },
};

export const env = {
    clipboard: {
        // The benchmark times Copy column by hooking the clipboard write.
        writeText: async (text: string) => {
            const my_hook = (globalThis as { __bench_clipboard?: (t: string) => void })
                .__bench_clipboard;
            my_hook?.(text);
        },
    },
};

export class Disposable {
    constructor(private readonly fn: () => void) {}
    dispose(): void {
        this.fn();
    }
}

export const ViewColumn = { Active: -1, One: 1, Two: 2 };

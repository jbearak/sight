# Send to Stata

The extension provides commands to send Stata code directly from VS Code to Stata for execution. It supports three execution targets: the Stata GUI application (macOS and Windows), an integrated Stata terminal inside VS Code, and arbitrary terminal sessions.

> **GUI vs. CLI:** "GUI" (graphical user interface) mode means sending code to the standalone Stata application — the windowed program you launch from the dock or Start menu. "CLI" (command-line interface) mode means sending code to Stata running inside a terminal (`stata-mp`, `stata-se`, etc.).

> **Implementation Note:** On macOS, GUI mode uses AppleScript to communicate with the Stata application. On Windows, it uses [send-to-stata](https://github.com/jbearak/send-to-stata), a small utility I wrote for this extension. It's downloaded on first use rather than bundled: it's a native binary (so bundling would mean shipping x86 and ARM64 builds to every user, including Mac users who need neither), and while the extension is under active development, the helper is essentially done and unlikely to change, so re-bundling it with every extension release would be wasteful.

## Execution Targets

The extension offers three ways to send code to Stata:

- **Stata GUI Application** (`external`): Sends code to the standalone Stata application via AppleScript (macOS) or COM automation (Windows).
- **Integrated Stata Terminal** (`integrated`): Opens and sends code to a dedicated Stata terminal inside VS Code. The extension registers a "Stata" terminal profile that launches the Stata CLI (`stata-mp`, `stata-se`, `stata-ic`, `stata-be`, or `stata`). This works on macOS, Linux, and remote sessions (SSH, WSL, Dev Containers, Tunnels). Not available on native Windows because Stata has no interactive CLI on that platform.
- **Active Terminal** (the `Terminal` submenu commands): Sends code to whatever terminal is currently active in VS Code, regardless of type. This is useful for sending commands to Stata running inside `tmux`, a Docker container, or any other terminal session that isn't the extension's built-in Stata terminal.

### Target Setting

The `sight.sendToStata.target` setting controls where the main send commands (`Cmd+Enter`, etc.) route code:

| Value | Behavior |
|-------|----------|
| **auto** (default) | Uses the Stata GUI when running locally on macOS/Windows. Uses the integrated Stata terminal in remote sessions and on Linux. |
| **integrated** | Always uses the integrated VS Code Stata terminal. On native Windows (where Stata has no interactive CLI), falls back to the GUI with a warning. |
| **external** | Always uses the external Stata GUI application. macOS and Windows only; not available in remote sessions or on Linux. |

When the integrated terminal is selected (directly or via auto-detection), the extension will automatically open a Stata terminal if one isn't already running. If multiple Stata terminals are open, commands are sent to the most recently activated one.

### Stata Terminal Profile

The extension adds a "Stata" terminal profile to VS Code's terminal dropdown (not shown on native Windows, where Stata has no interactive CLI). You can open a Stata terminal manually from the terminal profile picker at any time. The Stata CLI binary is detected automatically:

1. Checks your PATH for `stata-mp`, `stata-se`, `stata-ic`, `stata-be`, or `stata` (in priority order)
2. On macOS, falls back to checking inside `/Applications/Stata/*.app/Contents/MacOS/`
3. If `sight.sendToStata.stataApp` is set, that variant is checked first

## Keyboard Shortcuts

| Mac | Windows | Action |
|-----|---------|--------|
| `Cmd+Enter` | `Ctrl+Enter` | Send statement to Stata app |
| `Shift+Cmd+Enter` | `Shift+Ctrl+Enter` | Send file to Stata app |
| `Alt+Cmd+Enter` | `Alt+Ctrl+Enter` | Include statement (preserves locals) |
| `Alt+Shift+Cmd+Enter` | `Alt+Shift+Ctrl+Enter` | Include file (preserves locals) |
| `Alt+Enter` | `Alt+Enter` | Send statement to terminal |
| `Alt+Shift+Enter` | `Alt+Shift+Enter` | Send file to terminal |

> [!TIP]
> You can also access these commands via:
> - an editor toolbar menu (`▶` button)
> - the command palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows).

![Send to Stata Menu](../examples/send_to_stata_menu.png)

## Additional Commands

- **Send Upward Lines**: Sends all lines from start of file to current line
- **Send Downward Lines**: Sends all lines from current line to end of file
- **CD to File Folder**: Changes Stata's working directory to the current file's folder
- **CD to Workspace Folder**: Changes Stata's working directory to the workspace root

> [!TIP]
> The toolbar button (`▶`) lists all commands.

## Cursor Advancement

By default, the cursor advances to the next line when it sends a single statement (not a selection or entire file) to Stata.

**Configuration**: `sight.sendToStata.advanceCursorOnSend` (default: `true`)

## Working Directory Management

Control which directory Stata uses when executing your code:

| Option | Description | When to Use |
|--------|-------------|-------------|
| **lsp** (default) | Uses working directory from LSP directives | Recommended - leverages `@lsp-cd` or inherited from parent files |
| **none** | No directory change | When Stata's current directory is already correct |
| **file** | Changes to current file's directory | For standalone scripts |
| **workspace** | Changes to workspace root | For project-relative paths |

**Configuration**: `sight.sendToStata.workingDirectory`

The **lsp** option reads the working directory from:
- `@lsp-cd`, `@lsp-working-directory`, or `@lsp-wd` directives in your file
- Parent files via `@lsp-done-by` or `@lsp-included-by` directives (inherits working directory)
- Falls back to "none" if no LSP working directory is available

When set to "none", manual CD commands appear in the toolbar menu for quick directory changes.

## Statement Detection

The extension intelligently detects complete Stata statements:
- Handles multi-line statements with `///` continuation markers
- When cursor is on a continuation line, includes the entire statement from beginning
- When cursor is on a line with `///`, includes all continuation lines

## Editor Toolbar

A toolbar button (▶) appears in the editor title bar for Stata files, providing quick access to all send commands organized by category (Do, Include, Terminal, CD).

## Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sight.sendToStata.target` | enum | `"auto"` | Where to send commands: "auto", "integrated", or "external" |
| `sight.sendToStata.stataApp` | string | `""` | Override Stata variant (macOS only). Auto-detects if empty. |
| `sight.sendToStata.saveBeforeSend` | boolean | `true` | Automatically save file before sending |
| `sight.sendToStata.advanceCursorOnSend` | boolean | `true` | Advance cursor to next line after single-line send |
| `sight.sendToStata.workingDirectory` | enum | `"lsp"` | Working directory mode: "lsp", "none", "file", or "workspace" |
| `sight.sendToStata.focusStataWindow` | boolean | `false` | Switch focus to Stata after sending code |

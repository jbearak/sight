# Send to Stata

The extension provides commands to send Stata code directly from VS Code to Stata for execution, supporting both the Stata application (on Mac and Windows) and terminal sessions.

> **Implementation Note:** On macOS, the extension uses AppleScript to communicate with the Stata application. On Windows, it uses the [send-to-stata](https://github.com/jbearak/send-to-stata) utility, which is not bundled with the extension. On first use, you'll be prompted to download it.

## Execution Targets

- **Stata Application**: Send code to the Stata application
- **Terminal Sessions**: Sends code to VS Code's integrated terminal (works on Mac, Linux, Windows with WSL, and over SSH)

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
| `sight.sendToStata.stataApp` | string | `""` | Override Stata variant (macOS only). Auto-detects if empty. |
| `sight.sendToStata.saveBeforeSend` | boolean | `true` | Automatically save file before sending |
| `sight.sendToStata.advanceCursorOnSend` | boolean | `true` | Advance cursor to next line after single-line send |
| `sight.sendToStata.workingDirectory` | enum | `"lsp"` | Working directory mode: "lsp", "none", "file", or "workspace" |
| `sight.sendToStata.focusStataWindow` | boolean | `false` | Switch focus to Stata after sending code |

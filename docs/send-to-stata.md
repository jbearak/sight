# Send to Stata

The extension provides commands to send Stata code directly from VS Code to Stata for execution. It supports three execution targets: the Stata GUI application (macOS and Windows), an integrated Stata terminal inside VS Code, and the active VS Code terminal.

> **GUI vs. CLI:** "GUI" (graphical user interface) mode means sending code to the standalone Stata application — the windowed program you launch from the dock or Start menu. "CLI" (command-line interface) mode means sending code to Stata running inside a terminal (`stata-mp`, `stata-se`, etc.).

> **Implementation Note:** On macOS, GUI mode uses AppleScript to communicate with the Stata application. On Windows, it uses [send-to-stata](https://github.com/jbearak/send-to-stata), a small utility I wrote for this extension. The Windows helper is downloaded on first use rather than bundled because it is a native binary, and bundling it would mean shipping extra platform-specific builds with every extension release.

## Execution Targets

The extension offers three ways to send code to Stata:

- **Stata GUI Application** (`external`): Sends code to the standalone Stata application via AppleScript (macOS) or the send-to-stata helper, which pastes code into Stata's Command window (Windows).
- **Integrated Stata Terminal** (`integrated`): Opens and sends code to a dedicated Stata terminal inside VS Code. The extension registers a "Stata" terminal profile that launches the Stata CLI (`stata-mp`, `stata-se`, `stata-ic`, `stata-be`, or `stata`). This works on macOS, Linux, and remote sessions (SSH, WSL, Dev Containers, Tunnels). On native Windows, where Stata has no interactive CLI, the terminal runs [sight console](console.md) instead, which drives the Stata application; see [Windows: sight console](#windows-sight-console).
- **Active Terminal** (the `Terminal` submenu commands): Sends code to whatever terminal is currently active in VS Code, regardless of type. This is useful for sending commands to Stata running inside `tmux`, a Docker container, or any other terminal session that isn't the extension's built-in Stata terminal.

### Target Setting

The `sight.sendToStata.target` setting controls where the main send commands (`Cmd+Enter`, etc.) route code:

| Value | Behavior |
|-------|----------|
| **auto** (default) | Uses the Stata GUI when running locally on macOS/Windows (on Windows, `auto` doesn't use sight console). Uses the integrated Stata terminal in remote sessions and on Linux. |
| **integrated** | Always uses the integrated VS Code Stata terminal. On native Windows this runs sight console; if the console can't use Stata, the extension offers to send to the Stata GUI instead (see below). |
| **external** | Always uses the external Stata GUI application. macOS and Windows only; not available in remote sessions or on Linux. |

When the integrated terminal is selected (directly or via auto-detection), the extension automatically opens a Stata terminal if one is not already running. If multiple Stata terminals are open, commands are sent to the most recently activated one.

### Stata Terminal Profile

The extension adds a "Stata" terminal profile to VS Code's terminal dropdown. You can open a Stata terminal manually from the terminal profile picker at any time. On native Windows the profile runs sight console (see below). Elsewhere, the Stata CLI binary is detected automatically:

1. Checks your PATH for `stata-mp`, `stata-se`, `stata-be`, `stata-ic`, or `stata` (in priority order)
2. On macOS, falls back to checking inside `/Applications/Stata/*.app/Contents/MacOS/` and `/Applications/StataNow/*.app/Contents/MacOS/` (StataNow installs under `/Applications/StataNow/`)
3. If `sight.sendToStata.stataApp` is set, that variant is checked first

### Windows: sight console

On native Windows (not in a remote session), the `integrated` target and the "Stata" terminal profile run `sight console` from the extension. The console drives the Stata application through its Automation interface, so it needs Stata's Automation registered. See [console.md](console.md) for what the console does, including when it asks to take over a Stata that is already open.

Code you send while the console is starting waits in a queue, and the status bar shows how many sends are waiting. The queued sends are typed into the console, in order, once it shows its first prompt. The terminal opens with focus so you can answer the console's question; there's no time limit on answering.

The console doesn't take Stata when:

- several Stata windows are open;
- you decline the take-over question (**N**);
- the open Stata is in use by another program, such as Jupyter;
- Stata's Automation isn't registered;
- PowerShell, which the console uses to reach Stata, is blocked by its language mode or a policy;
- the terminal can't give the console raw keyboard input.

In each of these cases the console exits and the extension asks whether to send code to the open Stata window instead, using the same send-to-stata helper as the `external` target:

- **This session**: use the Stata GUI until VS Code reloads or `sight.sendToStata.target` changes.
- **Always**: set `sight.sendToStata.target` to `"external"` in your user settings. If a workspace or folder setting overrides it, the extension says so and uses the GUI for this session.
- **Cancel**: drop the waiting sends. The next send starts the console again, since the cause (for example, a second Stata window) may be gone by then.

Answering **s** at the console's take-over question sends code from the editor right away, the same as **This session**, without asking. With **This session** or **Always**, the waiting sends go to Stata in order. If you dismiss the question or leave it unanswered for 60 seconds, the waiting sends are dropped.

The send-to-stata helper doesn't take over Stata or use Automation: it pastes into the Stata window. With several Stata windows open it picks one itself (the first it finds); to choose, close the others. It is downloaded on first use.

If the console terminal closes for another reason before it is ready, its waiting sends are dropped, and a notice says how many (except when you closed the terminal yourself).

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

By default, the cursor advances to the next line when the extension sends a single statement, rather than a selection or entire file, to Stata.

**Configuration**: `sight.sendToStata.advanceCursorOnSend` (default: `true`)

## Working Directory Management

Control which directory Stata uses when executing your code:

| Option | Description | When to Use |
|--------|-------------|-------------|
| **lsp** (default) | Uses working directory from LSP directives | Recommended - leverages `sight: cd` or inherited from parent files |
| **none** | No directory change | When Stata's current directory is already correct |
| **file** | Changes to current file's directory | For standalone scripts |
| **workspace** | Changes to workspace root | For project-relative paths |

**Configuration**: `sight.sendToStata.workingDirectory`

The **lsp** option reads the working directory from:
- `sight: cd`, `sight: working-directory`, or `sight: wd` directives in your file (`@lsp-` forms remain aliases)
- Parent files via `sight: done-by` or `sight: included-by` directives (inherits working directory)
- Falls back to "none" if no LSP working directory is available

When set to "none", manual CD commands appear in the toolbar menu for quick directory changes.

## Statement Detection

The extension intelligently detects complete Stata statements:
- Handles multi-line statements with `///` continuation markers
- When the cursor is on a continuation line, includes the entire statement from the beginning
- When the cursor is on a line ending with `///`, includes all continuation lines

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

# Send to Stata

The extension provides commands to send Stata code directly from VS Code to Stata for execution. It supports three execution targets: the Stata GUI application (macOS and Windows), an integrated Stata terminal inside VS Code, and the active VS Code terminal.

> **GUI vs. CLI:** "GUI" (graphical user interface) mode means sending code to the standalone Stata application — the windowed program you launch from the dock or Start menu. "CLI" (command-line interface) mode means sending code to Stata running inside a terminal (`stata-mp`, `stata-se`, etc.).

> **Implementation Note:** On macOS, GUI mode uses AppleScript to communicate with the Stata application. On Windows, it uses [send-to-stata](https://github.com/jbearak/send-to-stata), a small utility I wrote for this extension. The Windows helper is downloaded on first use rather than bundled because it is a native binary, and bundling it would mean shipping extra platform-specific builds with every extension release.

## Execution Targets

The extension offers three ways to send code to Stata:

- **Stata GUI Application** (`external`): Sends code to the standalone Stata application via AppleScript (macOS) or the send-to-stata helper, which pastes code into Stata's Command window (Windows).
- **Integrated Stata Terminal** (`integrated`): Opens and sends code to a dedicated Stata terminal inside VS Code (the Stata pane), which runs [sight console](console.md): Stata with syntax highlighting, completion and colored output. On macOS and Linux, including remote sessions (SSH, WSL, Dev Containers, Tunnels), it runs console Stata (`stata-mp`, `stata-se`, `stata-ic`, `stata-be`, or `stata`); see [macOS and Linux: sight console](#macos-and-linux-sight-console). On native Windows, where Stata has no interactive CLI, it drives the Stata application; see [Windows: sight console](#windows-sight-console).
- **Active Terminal** (the `Terminal` submenu commands): Sends code to whatever terminal is currently active in VS Code, regardless of type. This is useful for sending commands to Stata running inside `tmux`, a Docker container, or any other terminal session that isn't the extension's built-in Stata terminal.

### Target Setting

The `sight.sendToStata.target` setting controls where the main send commands (`Cmd+Enter`, etc.) route code:

| Value | Behavior |
|-------|----------|
| **ask** (default) | The first send in a VS Code window asks where code should go (see [Choosing where code goes](#choosing-where-code-goes)). In remote sessions and on Linux, where only the integrated terminal works, it uses that without asking. `"auto"`, the older name, means the same. |
| **integrated** | Always uses the integrated VS Code Stata terminal (the Stata pane). On native Windows this runs sight console; if the console can't use Stata, the extension offers to send to the Stata GUI instead (see below). |
| **external** | Always uses the external Stata GUI application. macOS and Windows only; not available in remote sessions or on Linux. |

When the integrated terminal is selected, the extension automatically opens a Stata terminal if one is not already running. If multiple Stata terminals are open, commands are sent to the most recently activated one.

### Choosing where code goes

With `ask`, on macOS and Windows, the first send in a VS Code window shows a menu:

- **Stata pane** or **Stata app**, for this session: until VS Code reloads the window.
- **Always use the Stata pane** or **Always use the Stata app**: saves `integrated` or `external` in your user settings. If a workspace or folder setting overrides it, the extension says so and uses your choice for this session.
- **Read more…** opens this section.

Dismissing the menu (Escape) cancels that send; the next send asks again. Sends made while the menu is open wait for the one answer.

Which to pick:

- **The Stata pane** runs Stata in VS Code's terminal panel, beside your code, with output in VS Code, through [sight console](console.md). On macOS and Linux it runs console Stata (`stata-mp` and so on); there's no Data Editor or graph window, but `browse` opens Sight's [Data Browser](data-browser.md). On Windows the console drives the Stata app; see [Windows: sight console](#windows-sight-console).
- **The Stata app** sends code to the Stata application's window, as if you'd run it there: graphs, the Data Editor and Stata's own windows all work as usual.

To change your answer later, run **Sight: Choose Where to Send Code** from the Command Palette. When the setting is `integrated` or `external`, the same command can switch between them or go back to asking.

### Stata Terminal Profile

The extension adds a "Stata" terminal profile to VS Code's terminal dropdown. You can open a Stata terminal manually from the terminal profile picker at any time. It opens the same Stata pane as the `integrated` target. On macOS and Linux, the Stata CLI binary is detected automatically:

1. Checks your PATH for `stata-mp`, `stata-se`, `stata-be`, `stata-ic`, or `stata` (in priority order)
2. On macOS, falls back to checking inside `/Applications/Stata/*.app/Contents/MacOS/` and `/Applications/StataNow/*.app/Contents/MacOS/` (StataNow installs under `/Applications/StataNow/`)
3. If `sight.sendToStata.stataApp` is set, that variant is checked first

### macOS and Linux: sight console

On macOS and Linux the Stata pane runs [sight console](console.md) inside the extension, around console Stata. There's nothing separate to install: the extension carries a small helper, `sight-pty`, that gives Stata the terminal it needs (VS Code's extension runtime can't open one itself). Stata starts in your workspace folder.

Code you send while Stata is starting waits in a queue, and the status bar shows how many sends are waiting. The queued sends are typed into the console, in order, once Stata shows its first prompt. Later sends are typed directly.

Closing the pane ends Stata, as closing a terminal running console Stata does. When Stata ends normally (`exit`), the pane closes; after an error (for example, Stata couldn't start) it stays open until you press a key, so you can read why.

The pane runs console Stata directly, as before sight console, when:

- `sight.sendToStata.console` is `"off"`;
- the extension has no helper for your platform (it has them for macOS on Apple silicon and Intel, and for Linux on x64 and arm64);
- the helper fails to start (for example, the system blocks it). The extension says so once, sends what was waiting to plain Stata, and uses plain Stata until the window reloads.

The console has been tested with real Stata on macOS; on Linux it has been tested only with a stand-in for Stata.

### Remote windows with Perch

In a remote window (Remote-SSH, WSL, Dev Containers, Tunnels), if the [Perch](https://github.com/jbearak/perch) extension is installed on the remote host, the Stata pane runs in a Perch session. Stata then keeps running when you close the window or the connection drops, and the next send, or reopening the window, finds it again. There's no setting: installing Perch on the remote host turns this on, and without Perch nothing changes. Installing or removing Perch affects consoles started after that.

In any window, local or remote, Perch's **Perch: New Persistent Terminal...** list includes **Stata console** (from Sight), which starts a console in a Perch session and makes it the window's console. In a local window, that's the only way a console starts in Perch (along with Perch restoring its terminal when the window reloads); consoles Sight starts on its own still open in the ordinary pane.

What differs from the pane described above:

- Closing the Stata terminal detaches it; Stata keeps running. Sends still reach it, and the terminal reopens from Perch's Sessions view or when the window reloads. To end Stata, type `exit`, or end the session in Perch.
- Code goes only to Stata sessions with a terminal in this window, or ones this window started. If Sight finds Stata sessions it started from other windows when it needs a new console, it asks whether to send code to one of them or start a new one.
- A detached Stata waits at `--more--` until someone attaches and presses a key, since nothing answers it. Put `set more off` in your `profile.do`.
- A detached Stata may keep holding its license seat while it runs.
- If Perch can't confirm that a send reached Stata (the connection ended mid-send), Sight says the code may not have run and doesn't send it again.

### Windows: sight console

On native Windows (not in a remote session), the `integrated` target and the "Stata" terminal profile open a **Stata pane** in VS Code's terminal panel that runs [sight console](console.md) inside the extension. There's no separate program to install. The console drives the Stata application through its Automation interface, so it needs Stata's Automation registered. See [console.md](console.md) for what the console does.

If a Stata window is already open, the extension asks, in a dialog, whether sight console may take it over: it then belongs to the console and closes when the pane closes. Choose **Send code to it instead** to leave that Stata alone and use send-to-stata (below) for this session.

Code you send while the console is starting waits in a queue, and the status bar shows how many sends are waiting. The queued sends are typed into the console, in order, once it shows its first prompt; there's no time limit on answering the dialog.

The console doesn't take Stata when:

- several Stata windows are open;
- you decline the take-over;
- the open Stata is in use by another program, such as Jupyter;
- Stata's Automation isn't registered;
- PowerShell, which the console uses to reach Stata, is blocked by its language mode or a policy.

In each of these cases the extension asks whether to send code to the open Stata window instead, using the same send-to-stata helper as the `external` target:

- **This session**: use the Stata GUI until VS Code reloads or `sight.sendToStata.target` changes.
- **Always**: set `sight.sendToStata.target` to `"external"` in your user settings. If a workspace or folder setting overrides it, the extension says so and uses the GUI for this session.
- **Cancel**: drop the waiting sends. The next send opens a new pane, since the cause (for example, a second Stata window) may be gone by then.

Choosing **Send code to it instead** at the take-over dialog acts as **This session** without asking again. With **This session** or **Always**, the waiting sends go to Stata in order. If you dismiss the question or leave it unanswered for 60 seconds, the waiting sends are dropped.

The send-to-stata helper doesn't take over Stata or use Automation: it pastes into the Stata window. With several Stata windows open it picks one itself (the first it finds); to choose, close the others. It is downloaded on first use.

Closing the pane ends the console and closes its Stata, with any unsaved data. When the console ends normally (`exit`), the pane closes; after an error it stays open until you press a key, so you can read why. If the pane closes before the console is ready, its waiting sends are dropped, and a notice says how many (except when you closed the pane yourself).

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
- **Sight: Choose Where to Send Code**: Picks the Stata pane or the Stata app (see [Choosing where code goes](#choosing-where-code-goes))

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
| `sight.sendToStata.target` | enum | `"ask"` | Where to send commands: "ask", "integrated", or "external" |
| `sight.sendToStata.stataApp` | string | `""` | Override Stata variant (macOS only). Auto-detects if empty. |
| `sight.sendToStata.saveBeforeSend` | boolean | `true` | Automatically save file before sending |
| `sight.sendToStata.advanceCursorOnSend` | boolean | `true` | Advance cursor to next line after single-line send |
| `sight.sendToStata.workingDirectory` | enum | `"lsp"` | Working directory mode: "lsp", "none", "file", or "workspace" |
| `sight.sendToStata.focusStataWindow` | boolean | `false` | Switch focus to Stata after sending code |

# Design Document: Send to Stata

## Overview

This design specifies a TypeScript-based solution for sending Stata code from VS Code to Stata for execution. The implementation is entirely within the VS Code extension (`client/`), with no external shell scripts required.

The architecture supports two target modes:
- **Stata Application** (macOS): Uses AppleScript via `child_process.exec` to send code to the Stata GUI
- **Terminal Session** (cross-platform): Sends code to VS Code's active integrated terminal

Key design decisions:
- All logic implemented in TypeScript within the extension
- Temp files used for all code execution (ensures `///` continuations work in terminal mode)
- Statement detection ported from sight-zed's shell script to TypeScript
- VS Code commands registered for all operations with keybindings
- Editor toolbar button with submenu for discoverability

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                                │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐   │
│  │  Keybinding     │───▶│  Command Handler │───▶│  Auto-save        │   │
│  │  (cmd-enter)    │    │  (registered)    │    │  (if enabled)     │   │
│  └─────────────────┘    └──────────────────┘    └───────────────────┘   │
│                                │                                         │
│  ┌─────────────────┐           │                                         │
│  │  Toolbar Button │───────────┘                                         │
│  │  (submenu)      │                                                     │
│  └─────────────────┘                                                     │
│                                │                                         │
│                                ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Send-to-Stata Module                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │    │
│  │  │ Statement       │  │ Temp File       │  │ Code Sender     │  │    │
│  │  │ Detector        │  │ Manager         │  │ (App/Terminal)  │  │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                │                                         │
│         ┌──────────────────────┼──────────────────────┐                 │
│         ▼                                              ▼                 │
│  ┌─────────────────┐                          ┌─────────────────┐       │
│  │ AppleScript     │                          │ Terminal API    │       │
│  │ Executor        │                          │ (sendText)      │       │
│  │ (macOS only)    │                          │                 │       │
│  └─────────────────┘                          └─────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
         │                                              │
         ▼                                              ▼
┌─────────────────┐                          ┌─────────────────┐
│   Stata GUI     │                          │  Terminal       │
│   (macOS)       │                          │  (Stata CLI)    │
└─────────────────┘                          └─────────────────┘
```

## Components and Interfaces

### Component 1: Statement Detector (`send-to-stata/statement-detector.ts`)

Extracts the current statement at the cursor position, handling multi-line statements with `///` continuation markers.

**Interface:**
```typescript
interface StatementBounds {
    start_line: number;  // 0-indexed, inclusive
    end_line: number;    // 0-indexed, inclusive
}

/**
 * Detects the statement at the given cursor position.
 * Handles multi-line statements with continuation markers (///).
 */
function detect_statement(
    document: vscode.TextDocument,
    line: number
): StatementBounds;

/**
 * Extracts the text of a statement given its bounds.
 */
function get_statement_text(
    document: vscode.TextDocument,
    bounds: StatementBounds
): string;

/**
 * Checks if a line ends with the continuation marker (/// followed by optional whitespace).
 */
function ends_with_continuation(line: string): boolean;
```

**Algorithm:**
```
Input: document, cursor_line (0-indexed)
Output: StatementBounds

1. Search backwards from cursor_line to find statement start:
   - While previous line ends with ///, move start backwards
   
2. Search forwards from cursor_line to find statement end:
   - While current line ends with ///, move end forwards
   
3. Return { start_line, end_line }
```

### Component 2: Temp File Manager (`send-to-stata/temp-file.ts`)

Creates unique temporary `.do` files for Stata execution.

**Interface:**
```typescript
/**
 * Creates a temporary .do file with the given content.
 * Returns the absolute path to the created file.
 */
async function create_temp_file(content: string): Promise<string>;

/**
 * Gets the system temporary directory.
 */
function get_temp_dir(): string;
```

**Behavior:**
- Creates files in `os.tmpdir()` (cross-platform)
- Uses pattern: `stata_send_${random_hex}.do` (32 hex chars from cryptographically secure random bytes)
- Does NOT delete files (Stata needs time to read them)
- Files accumulate and require periodic manual cleanup

### Component 3: Stata App Detector (`send-to-stata/stata-detector.ts`)

Detects the installed Stata variant on macOS. Caches the result to avoid repeated filesystem checks.

**Interface:**
```typescript
type StataVariant = 'StataMP' | 'StataSE' | 'StataIC' | 'Stata';

// Module-level cache
let cached_stata_app: StataVariant | null | undefined = undefined;

/**
 * Detects the Stata application to use.
 * Priority:
 *   1. sight.sendToStata.stataApp setting (if configured)
 *   2. Cached detection result (if available)
 *   3. Auto-detect from /Applications/Stata/
 * Returns null if no Stata found and no setting configured.
 * Caches the result for subsequent calls.
 */
async function detect_stata_app(): Promise<StataVariant | null>;

/**
 * Clears the cached Stata detection result.
 * Call this when settings change or for testing.
 */
function clear_stata_cache(): void;
```

**Caching Behavior:**
- First call: checks setting, then filesystem, caches result
- Subsequent calls: returns cached result (unless setting is configured)
- Setting always takes precedence over cache
- Cache cleared on extension deactivation or explicit `clear_stata_cache()` call

**Detection Order:**
1. Check `sight.sendToStata.stataApp` setting (always, not cached)
2. Return cached result if available
3. Check `/Applications/Stata/StataMP.app`
4. Check `/Applications/Stata/StataSE.app`
5. Check `/Applications/Stata/StataIC.app`
6. Check `/Applications/Stata/Stata.app`
7. Cache and return result (or null if not found)

### Component 4: AppleScript Executor (`send-to-stata/applescript.ts`)

Sends commands to Stata GUI via AppleScript (macOS only).

**Interface:**
```typescript
type StataCommand = 'do' | 'include';

/**
 * Sends a command to Stata via AppleScript.
 * @param stata_app - The Stata application name (e.g., 'StataMP')
 * @param command - The Stata command ('do' or 'include')
 * @param temp_file_path - Path to the temp .do file
 */
async function send_to_stata_app(
    stata_app: StataVariant,
    command: StataCommand,
    temp_file_path: string
): Promise<void>;

/**
 * Escapes a path for use in AppleScript string.
 */
function escape_for_applescript(path: string): string;
```

**AppleScript Template:**
```applescript
tell application "{STATA_APP}" to DoCommandAsync "{COMMAND} \"{TEMP_FILE_PATH}\""
```

**Escaping Rules:**
- Backslashes: `\` → `\\`
- Double quotes: `"` → `\"`

### Component 5: Terminal Sender (`send-to-stata/terminal.ts`)

Sends commands to VS Code's active terminal.

**Interface:**
```typescript
/**
 * Sends a command to the active terminal.
 * @param command - The Stata command ('do' or 'include')
 * @param temp_file_path - Path to the temp .do file
 * @throws Error if no active terminal exists
 */
async function send_to_terminal(
    command: StataCommand,
    temp_file_path: string
): Promise<void>;
```

**Behavior:**
- Uses `vscode.window.activeTerminal`
- Calls `terminal.sendText()` with the command
- Throws error if no active terminal (user must open terminal with Stata)

### Component 6: Command Handlers (`send-to-stata/commands.ts`)

Registers VS Code commands and implements the send logic.

**Commands (Application Mode - macOS):**
| Command ID | Description |
|------------|-------------|
| `sight.doLineOrSelection` | Send current statement or selection via `do` |
| `sight.doUpwardLines` | Send lines from start to cursor via `do` |
| `sight.doDownwardLines` | Send lines from cursor to end via `do` |
| `sight.doFile` | Send entire file via `do` |
| `sight.includeLineOrSelection` | Send current statement or selection via `include` |
| `sight.includeFile` | Send entire file via `include` |

**Commands (Terminal Mode - cross-platform):**
| Command ID | Description |
|------------|-------------|
| `sight.terminal.doLineOrSelection` | Send to terminal via `do` |
| `sight.terminal.doUpwardLines` | Send upward lines to terminal via `do` |
| `sight.terminal.doDownwardLines` | Send downward lines to terminal via `do` |
| `sight.terminal.doFile` | Send file to terminal via `do` |
| `sight.terminal.includeLineOrSelection` | Send to terminal via `include` |
| `sight.terminal.includeFile` | Send file to terminal via `include` |

**Command Handler Flow:**
```typescript
async function handle_send_command(
    mode: 'statement' | 'upward' | 'downward' | 'file',
    command: StataCommand,
    target: 'app' | 'terminal'
): Promise<void> {
    // 1. Get active editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    // 2. Save file if configured
    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    if (config.get('saveBeforeSend', true)) {
        await editor.document.save();
    }
    
    // 3. Determine code to send
    let code: string;
    if (mode === 'statement') {
        if (editor.selection.isEmpty) {
            const bounds = detect_statement(editor.document, editor.selection.active.line);
            code = get_statement_text(editor.document, bounds);
        } else {
            code = editor.document.getText(editor.selection);
        }
    } else if (mode === 'upward') {
        const bounds = get_upward_bounds(editor.document, editor.selection.active.line);
        code = get_statement_text(editor.document, bounds);
    } else if (mode === 'downward') {
        const bounds = get_downward_bounds(editor.document, editor.selection.active.line);
        code = get_statement_text(editor.document, bounds);
    } else {
        code = editor.document.getText();
    }
    
    // 4. Create temp file
    const temp_path = await create_temp_file(code);
    
    // 5. Send to target
    if (target === 'app') {
        const stata_app = await detect_stata_app();
        if (!stata_app) {
            vscode.window.showErrorMessage(
                'Stata not found. Install Stata in /Applications/Stata/ or configure sight.sendToStata.stataApp setting.'
            );
            return;
        }
        await send_to_stata_app(stata_app, command, temp_path);
    } else {
        await send_to_terminal(command, temp_path);
    }
}
```

### Component 7: Keybindings (`package.json`)

Keybindings registered in the extension manifest:

```json
{
  "keybindings": [
    {
      "command": "sight.doLineOrSelection",
      "key": "cmd+enter",
      "mac": "cmd+enter",
      "win": "ctrl+enter",
      "linux": "ctrl+enter",
      "when": "editorTextFocus && editorLangId == stata"
    },
    {
      "command": "sight.doFile",
      "key": "shift+cmd+enter",
      "mac": "shift+cmd+enter",
      "win": "shift+ctrl+enter",
      "linux": "shift+ctrl+enter",
      "when": "editorTextFocus && editorLangId == stata"
    },
    {
      "command": "sight.includeLineOrSelection",
      "key": "alt+cmd+enter",
      "mac": "alt+cmd+enter",
      "win": "alt+ctrl+enter",
      "linux": "alt+ctrl+enter",
      "when": "editorTextFocus && editorLangId == stata"
    },
    {
      "command": "sight.includeFile",
      "key": "alt+shift+cmd+enter",
      "mac": "alt+shift+cmd+enter",
      "win": "alt+shift+ctrl+enter",
      "linux": "alt+shift+ctrl+enter",
      "when": "editorTextFocus && editorLangId == stata"
    },
    {
      "command": "sight.terminal.doLineOrSelection",
      "key": "alt+enter",
      "when": "editorTextFocus && editorLangId == stata"
    }
  ]
}
```

### Component 8: Toolbar Button (`package.json`)

Editor title menu contribution:

```json
{
  "menus": {
    "editor/title": [
      {
        "submenu": "sight.sendToStata",
        "when": "editorLangId == stata",
        "group": "navigation"
      }
    ],
    "sight.sendToStata": [
      { "command": "sight.doLineOrSelection", "group": "1_do@1", "when": "isMac" },
      { "command": "sight.doUpwardLines", "group": "1_do@2", "when": "isMac" },
      { "command": "sight.doDownwardLines", "group": "1_do@3", "when": "isMac" },
      { "command": "sight.doFile", "group": "1_do@4", "when": "isMac" },
      { "command": "sight.includeLineOrSelection", "group": "2_include@1", "when": "isMac" },
      { "command": "sight.includeFile", "group": "2_include@2", "when": "isMac" },
      { "submenu": "sight.sendToStata.terminal", "group": "3_terminal" }
    ],
    "sight.sendToStata.terminal": [
      { "command": "sight.terminal.doLineOrSelection", "group": "1_do@1" },
      { "command": "sight.terminal.doUpwardLines", "group": "1_do@2" },
      { "command": "sight.terminal.doDownwardLines", "group": "1_do@3" },
      { "command": "sight.terminal.doFile", "group": "1_do@4" },
      { "command": "sight.terminal.includeLineOrSelection", "group": "2_include@1" },
      { "command": "sight.terminal.includeFile", "group": "2_include@2" }
    ]
  },
  "submenus": [
    {
      "id": "sight.sendToStata",
      "label": "Send to Stata"
    },
    {
      "id": "sight.sendToStata.terminal",
      "label": "Terminal"
    }
  ]
}
```

## Data Models

### StatementBounds

```typescript
interface StatementBounds {
    start_line: number;  // 0-indexed, inclusive
    end_line: number;    // 0-indexed, inclusive
}
```

### SendMode

```typescript
type SendMode = 'statement' | 'upward' | 'downward' | 'file';
```

### StataCommand

```typescript
type StataCommand = 'do' | 'include';
```

### SendTarget

```typescript
type SendTarget = 'app' | 'terminal';
```

### Configuration Schema

```typescript
interface SendToStataConfig {
    stataApp?: string;           // Override Stata variant (macOS only)
    saveBeforeSend: boolean;     // Auto-save before sending (default: true)
    workingDirectory: 'none' | 'file' | 'workspace' | 'lsp';  // Working directory mode (default: 'lsp')
}
```

### Working Directory Handling

When `workingDirectory` is set to "file" or "workspace", the temp file content is prefixed with a `cd` command:

```typescript
function prepare_content_with_cd(
    content: string,
    document: vscode.TextDocument,
    config: SendToStataConfig
): string {
    if (config.workingDirectory === 'none') {
        return content;
    }
    
    let directory: string;
    if (config.workingDirectory === 'file') {
        directory = path.dirname(document.uri.fsPath);
    } else {
        // workspace
        const workspace_folder = vscode.workspace.getWorkspaceFolder(document.uri);
        directory = workspace_folder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    }
    
    // Escape quotes in path for Stata
    const escaped_dir = directory.replace(/"/g, '\\"');
    return `cd "${escaped_dir}"\n${content}`;
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Statement Detection with Continuations

*For any* Stata document and any cursor position within that document, the detected statement SHALL:
- Include the line at the cursor position
- Include all preceding lines that are part of the same statement (backward search for lines ending with `///`)
- Include all following lines that are continuations (forward search while current line ends with `///`)
- Handle chained continuations (multiple consecutive `///` lines) correctly

The statement bounds are correctly identified when starting from any line of a multi-line statement.

**Validates: Requirements 1.2, 1.3, 1.4, 8.1, 8.2, 8.3, 8.4**

### Property 2: Temp File Creation

*For any* code content string, creating a temp file SHALL:
- Create the file in the system temporary directory (`os.tmpdir()`)
- Use a unique filename that doesn't collide with concurrent executions
- Use the `.do` file extension
- Contain exactly the provided content

**Validates: Requirements 1.5, 12.1, 12.2, 12.4**

### Property 3: AppleScript Path Escaping

*For any* file path containing special characters (backslashes, double quotes, spaces, unicode), the escaped path SHALL be valid for use in an AppleScript string literal, where:
- Backslashes are escaped: `\` → `\\`
- Double quotes are escaped: `"` → `\"`

**Validates: Requirements 1.7**

### Property 4: AppleScript Command Generation

*For any* Stata variant, Stata command (`do` or `include`), and temp file path, the generated AppleScript command SHALL:
- Use the correct Stata application name in `tell application`
- Use the correct Stata command (`do` or `include`)
- Include the properly escaped temp file path
- Follow the format: `tell application "{APP}" to DoCommandAsync "{CMD} \"{PATH}\""`

**Validates: Requirements 1.6, 3.3**

### Property 5: Upward Line Extraction

*For any* Stata document and cursor position, extracting upward lines SHALL:
- Include all lines from line 0 to the cursor line (inclusive)
- If the cursor is on a continuation line, include the complete statement from its beginning (extend start backwards)

**Validates: Requirements 4.2, 4.4**

### Property 6: Downward Line Extraction

*For any* Stata document and cursor position, extracting downward lines SHALL:
- Include all lines from the cursor line to the end of the document
- If the cursor is on a continuation line, include the complete statement from its beginning (extend start backwards)

**Validates: Requirements 5.2, 5.4**

### Property 7: Stata Variant Detection Order

*For any* set of installed Stata variants in `/Applications/Stata/`, the detection SHALL:
- Return the configured `sight.sendToStata.stataApp` setting if present (always checked, not cached)
- Return cached result if available (after first detection)
- Otherwise, check variants in order: StataMP, StataSE, StataIC, Stata
- Return the first variant found
- Cache the result for subsequent calls
- Return null if no variant found and no setting configured

**Validates: Requirements 7.2, 7.3**

## Error Handling

### Error Categories

| Category | Condition | User Message |
|----------|-----------|--------------|
| No Editor | No active text editor | "No active editor" |
| No Stata | Stata not found (macOS) | "Stata not found. Install Stata in /Applications/Stata/ or configure sight.sendToStata.stataApp setting." |
| No Terminal | No active terminal | "No active terminal. Open a terminal and start Stata first." |
| AppleScript Failed | osascript returned error | "Failed to send to Stata: {error}" |
| Temp File Failed | Cannot create temp file | "Failed to create temporary file: {error}" |
| Save Failed | Cannot save document | "Failed to save file: {error}" |
| Not macOS | Application command on non-macOS | "Stata application mode is only available on macOS. Use terminal mode instead." |
| Windows Stub | Application command on Windows | "Windows support coming soon. Use terminal mode for now." |

### Error Handling Strategy

```typescript
async function handle_send_command(...): Promise<void> {
    try {
        // ... command logic
    } catch (error) {
        if (error instanceof StataNotFoundError) {
            vscode.window.showErrorMessage(error.message);
        } else if (error instanceof NoTerminalError) {
            vscode.window.showErrorMessage(error.message);
        } else if (error instanceof AppleScriptError) {
            vscode.window.showErrorMessage(`Failed to send to Stata: ${error.message}`);
        } else {
            vscode.window.showErrorMessage(`Unexpected error: ${error}`);
        }
    }
}
```

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Statement Detection**
   - Single-line statement
   - Multi-line statement with `///` (cursor on first line)
   - Multi-line statement with `///` (cursor on middle line)
   - Multi-line statement with `///` (cursor on last line)
   - Chained continuations (3+ lines)
   - `///` with trailing whitespace
   - Line without `///` (no continuation)

2. **Continuation Marker Detection**
   - `///` at end of line → true
   - `///` with trailing spaces → true
   - `///` with trailing tab → true
   - `/// comment` (not at end) → false
   - `//` (not continuation) → false
   - Empty line → false

3. **AppleScript Escaping**
   - Path with spaces
   - Path with backslash
   - Path with double quote
   - Path with unicode characters
   - Path with all special characters combined

4. **Upward/Downward Extraction**
   - Cursor at start of file
   - Cursor at end of file
   - Cursor on continuation line (upward)
   - Cursor on continuation line (downward)

5. **Stata Detection**
   - Setting configured → use setting
   - StataMP installed → return StataMP
   - Only StataSE installed → return StataSE
   - No Stata installed → return null

### Property-Based Tests

Property tests verify universal properties across generated inputs using fast-check.

**Test Configuration:**
- Minimum 100 iterations per property
- Each test tagged with: `Feature: send-to-stata, Property N: {description}`

**Generators:**
- `arbitrary_stata_document()`: Generates documents with random lines, some ending with `///`
- `arbitrary_cursor_position(doc)`: Generates valid cursor positions within a document
- `arbitrary_file_path()`: Generates paths with various special characters
- `arbitrary_stata_variant()`: Generates Stata variant names

### Test File Structure

```
client/src/send-to-stata/
├── statement-detector.ts
├── statement-detector.test.ts      # Unit tests
├── temp-file.ts
├── temp-file.test.ts               # Unit tests
├── applescript.ts
├── applescript.test.ts             # Unit tests
├── stata-detector.ts
├── stata-detector.test.ts          # Unit tests
├── terminal.ts
├── commands.ts
└── index.ts

tests/property/
└── send-to-stata.property.test.ts  # Property-based tests
```

### Integration Tests

Integration tests require manual verification:

1. **End-to-end macOS**: Verify command reaches Stata and executes
2. **Terminal mode**: Verify command appears in terminal

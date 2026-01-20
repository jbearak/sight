# Design Document

## Introduction

This document describes the technical design for adding Windows support to the VS Code extension's send-to-stata feature. The design leverages the existing C# executable from zed-stata, downloaded on-demand to keep the extension package small.

## Architecture Overview

The Windows implementation follows a hybrid architecture:
- **TypeScript layer**: Handles VS Code integration, user prompts, download management, and command orchestration
- **Native executable**: Handles Win32 API calls for window management, clipboard, and keystrokes

### Cross-Platform Code Reuse

The following existing code is shared between macOS and Windows (Requirement 10):
- **Statement detection** (`statement-detector.ts`): Multi-line statement parsing with `///` continuations
- **Temp file creation** (`temp-file.ts`): Creates temporary `.do` files
- **Terminal mode** (`terminal.ts`): Sends commands to VS Code integrated terminal
- **Cursor advancement** (`cursor-advance-core.ts`): Advances cursor after single-line sends
- **Path escaping** (`commands.ts`): `escape_path_for_stata()` handles Windows backslashes
- **Working directory resolution**: LSP integration for `@lsp-cd` directives

Only the GUI application interaction differs between platforms:
- macOS: AppleScript via `applescript.ts`
- Windows: Native executable via `windows-sender.ts`

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Extension (TypeScript)                │
├─────────────────────────────────────────────────────────────────┤
│  commands.ts                                                     │
│  ├── handle_send_command()                                       │
│  │   ├── [existing] statement detection, temp file, cd prefix   │
│  │   └── [new] platform dispatch                                │
│  │       ├── darwin → applescript.ts (existing)                 │
│  │       └── win32 → windows-sender.ts (new)                    │
├─────────────────────────────────────────────────────────────────┤
│  windows-sender.ts (new)                                         │
│  ├── ensure_executable() → exe-downloader.ts                    │
│  └── send_to_stata_windows() → spawns send-to-stata.exe         │
├─────────────────────────────────────────────────────────────────┤
│  exe-downloader.ts (new)                                         │
│  ├── check_executable_exists()                                   │
│  ├── prompt_download()                                           │
│  ├── download_executable() with progress                         │
│  └── verify_checksum()                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ spawn
┌─────────────────────────────────────────────────────────────────┐
│              send-to-stata.exe (from zed-stata)                  │
│  - Finds Stata window via process enumeration                    │
│  - Sets clipboard via Win32 API                                  │
│  - Activates window with Alt key trick                           │
│  - Sends keystrokes (Ctrl+1, Ctrl+V, Enter)                     │
│  - Returns focus to VS Code                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Approach Decision

### Option A: Bundle Native Executable (Not Chosen)
- **Pros**: Works offline, no download prompt, simpler code
- **Cons**: ~3.4MB added to extension (>10x size increase), all users download Windows binaries

### Option B: On-Demand Download (Chosen)
- **Pros**: Extension stays small (~317KB), only Windows users download, architecture-specific
- **Cons**: Requires network on first use, more complex code, needs version management

**Decision**: Option B - On-demand download from GitHub releases. The significant size increase is unacceptable for a feature only Windows users need.

## New Files

### 1. `client/src/send-to-stata/windows-sender.ts`

Orchestrates sending code to Stata on Windows by spawning the native executable.

```typescript
interface WindowsSendResult {
    success: boolean;
    error_message?: string;
}

/**
 * Sends code to Stata GUI on Windows using the native executable.
 * Validates: Requirements 1.1, 3.1-3.7
 */
export async function send_to_stata_windows(
    command: StataCommand,
    temp_file_path: string,
    context: vscode.ExtensionContext
): Promise<void>;

/**
 * Ensures the Windows executable is available, downloading if necessary.
 * Validates: Requirements 12.1-12.9
 */
export async function ensure_executable(
    context: vscode.ExtensionContext
): Promise<string | null>;
```

### 2. `client/src/send-to-stata/exe-downloader.ts`

Handles downloading, caching, and version management of the Windows executable.

```typescript
interface ExecutableInfo {
    path: string;
    version: string;
    architecture: 'x64' | 'arm64';
}

interface DownloadResult {
    success: boolean;
    path?: string;
    error?: string;
}

/**
 * Checks if the executable exists and returns its info.
 * Validates: Requirements 12.1, 13.1
 */
export async function get_executable_info(
    context: vscode.ExtensionContext
): Promise<ExecutableInfo | null>;

/**
 * Prompts user to download the executable.
 * Validates: Requirements 12.2, 12.9
 */
export async function prompt_download(): Promise<boolean>;

/**
 * Downloads the executable with progress indication.
 * Validates: Requirements 12.3-12.8
 */
export async function download_executable(
    context: vscode.ExtensionContext
): Promise<DownloadResult>;

/**
 * Checks if an update is available and prompts if needed.
 * Validates: Requirements 13.2-13.4
 */
export async function check_for_updates(
    context: vscode.ExtensionContext,
    current_version: string
): Promise<boolean>;
```

## Modified Files

### 1. `client/src/send-to-stata/commands.ts`

Add Windows platform dispatch in `handle_send_command()`:

```typescript
// Current code (to be modified):
if (target === 'app') {
    if (process.platform === 'win32') {
        vscode.window.showErrorMessage(
            'Windows support coming soon. Use terminal mode for now.');
        return;
    }
    // ... macOS code
}

// New code:
if (target === 'app') {
    if (process.platform === 'win32') {
        await send_to_stata_windows(command, my_temp_file, context);
        return;
    }
    if (process.platform === 'darwin') {
        // ... existing macOS code
    }
}
```

### 2. `client/src/send-to-stata/applescript.ts`

Add StataBE to valid Stata apps:

```typescript
// Current:
const VALID_STATA_APPS: readonly StataVariant[] = [
    'StataMP', 'StataSE', 'StataIC', 'Stata'
];

// New:
const VALID_STATA_APPS: readonly StataVariant[] = [
    'StataMP', 'StataSE', 'StataBE', 'StataIC', 'Stata'
];
```

### 3. `client/src/send-to-stata/index.ts`

Update StataVariant type and exports:

```typescript
// Update type:
export type StataVariant = 'StataMP' | 'StataSE' | 'StataBE' | 'StataIC' | 'Stata';

// Add exports:
export {
    send_to_stata_windows,
    ensure_executable
} from './windows-sender';
```

### 4. `client/package.json`

Update stataApp setting description and add focusStataWindow:

```json
"sight.sendToStata.stataApp": {
    "type": "string",
    "default": "",
    "description": "Override Stata application name (macOS only). Leave empty for auto-detection. Options: StataMP, StataSE, StataBE, StataIC, Stata"
},
"sight.sendToStata.focusStataWindow": {
    "type": "boolean",
    "default": false,
    "description": "Switch focus to Stata after sending code. When false (default), focus stays in VS Code."
}
```

## Download Infrastructure

### GitHub Raw URL Structure

The executable is downloaded from the zed-stata GitHub repository at tag v0.1.11:

```
https://raw.githubusercontent.com/jbearak/zed-stata/365ced02951833e43d4d7a5be73e61dbe73ab5f4/send-to-stata-{ARCH}.exe

URLs:
- x64:   https://raw.githubusercontent.com/jbearak/zed-stata/365ced02951833e43d4d7a5be73e61dbe73ab5f4/send-to-stata-x64.exe
- arm64: https://raw.githubusercontent.com/jbearak/zed-stata/365ced02951833e43d4d7a5be73e61dbe73ab5f4/send-to-stata-arm64.exe
```

### Checksum Verification

SHA-256 checksums are hardcoded in the extension (computed from tag v0.1.11):

```typescript
const CHECKSUMS: Record<string, string> = {
    'x64':   '2c7becace23c10f4f888f7f61eedfde8108f4e16ce21c1f8a8b625038a22c1d6',
    'arm64': 'aa1fd6dfd2e14bcc2fdb2d06b4ca950ef5ecd5891bd7de0a833b12dc46feb20a',
};

// File sizes for reference:
// x64:   1,803,264 bytes (~1.7 MB)
// arm64: 1,737,216 bytes (~1.7 MB)
```

### Architecture Detection

```typescript
function get_windows_architecture(): 'x64' | 'arm64' {
    // process.arch returns 'x64', 'arm64', 'ia32', etc.
    // On Windows ARM64, Node may report 'x64' if running under emulation
    // Check PROCESSOR_ARCHITECTURE environment variable for accuracy
    const env_arch = process.env.PROCESSOR_ARCHITECTURE;
    if (env_arch === 'ARM64') {
        return 'arm64';
    }
    return 'x64';
}
```

### Storage Location

```typescript
// VS Code provides persistent storage per extension
const storage_path = context.globalStorageUri.fsPath;
// e.g., C:\Users\{user}\AppData\Roaming\Code\User\globalStorage\{publisher}.sight

// Executable stored at:
// {storage_path}/send-to-stata/send-to-stata.exe

// Version info stored at:
// {storage_path}/send-to-stata/version.json
// Contents: { "version": "0.1.11", "architecture": "x64", "downloaded_at": "2024-..." }
```

## User Experience Flow

### First-Time Download

```
1. User presses Cmd+Enter on Windows
2. Extension checks: executable exists? NO
3. Show prompt:
   ┌─────────────────────────────────────────────────────────────┐
   │ Windows support for send-to-stata requires downloading a    │
   │ helper executable (~1.7 MB).                                │
   │                                                             │
   │ [Download]  [Cancel]                                        │
   └─────────────────────────────────────────────────────────────┘
4. User clicks "Download"
5. Show progress:
   ┌─────────────────────────────────────────────────────────────┐
   │ Downloading send-to-stata for Windows...                    │
   │ ████████████░░░░░░░░ 60%                                    │
   └─────────────────────────────────────────────────────────────┘
6. Verify checksum
7. Show success notification
8. Execute the original command
```

### Subsequent Uses

```
1. User presses Cmd+Enter on Windows
2. Extension checks: executable exists? YES, version OK? YES
3. Execute command immediately (no prompts)
```

### Update Available

```
1. User presses Cmd+Enter on Windows
2. Extension checks: executable exists? YES, version OK? NO (newer available)
3. Show prompt:
   ┌─────────────────────────────────────────────────────────────┐
   │ A newer version of send-to-stata is available.              │
   │                                                             │
   │ [Update]  [Skip]  [Don't ask again for this version]        │
   └─────────────────────────────────────────────────────────────┘
4. If "Skip": use existing executable
5. If "Update": download new version
```

## Send Mode Support

All four send modes are supported on Windows through the shared TypeScript infrastructure (Requirement 4):

| Mode | Description | Implementation |
|------|-------------|----------------|
| `statement` | Current statement or selection | `statement-detector.ts` finds boundaries, writes to temp file |
| `upward` | Line 1 to cursor | Extracts text range, writes to temp file |
| `downward` | Cursor to end of file | Extracts text range, writes to temp file |
| `file` | Entire file | Writes full content to temp file |

Both `do` and `include` commands are supported via the `-Include` flag passed to the executable.

## Executable Invocation

The TypeScript layer spawns the executable with arguments matching the zed-stata CLI:

```typescript
import { spawn } from 'child_process';
import * as vscode from 'vscode';

async function send_to_stata_windows(
    command: StataCommand,
    temp_file_path: string,
    context: vscode.ExtensionContext
): Promise<void> {
    const exe_path = await ensure_executable(context);
    if (!exe_path) {
        return; // User declined download
    }

    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const focus_stata = config.get<boolean>('focusStataWindow', false);

    const args = [
        '-FileMode',
        '-File', temp_file_path,
    ];
    
    if (command === 'include') {
        args.push('-Include');
    }
    
    // By default, the executable returns focus to the calling app (VS Code).
    // If focusStataWindow is true, pass -ActivateStata to keep focus on Stata.
    if (focus_stata) {
        args.push('-ActivateStata');
    }

    return new Promise((resolve, reject) => {
        const proc = spawn(exe_path, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(map_exit_code_to_message(code, stderr)));
            }
        });
    });
}

function map_exit_code_to_message(code: number, stderr: string): string {
    // Exit codes from SendToStata.cs
    switch (code) {
        case 1: return 'Invalid arguments';
        case 2: return 'File not found';
        case 3: return 'Failed to create temp file';
        case 4: return 'No running Stata instance found. Start Stata before sending code.';
        case 5: return 'Failed to send keystrokes. Ensure Stata is not running as Administrator.';
        default: return stderr || `Unknown error (exit code ${code})`;
    }
}
```

## Configuration

### New Setting: focusStataWindow

Add to `client/package.json` under `contributes.configuration.properties`:

```json
"sight.sendToStata.focusStataWindow": {
    "type": "boolean",
    "default": false,
    "description": "Switch focus to Stata after sending code. When false (default), focus stays in VS Code."
}
```

This setting applies to both Windows and macOS.

### macOS Implementation

On macOS, focus management is handled via AppleScript after the `DoCommandAsync` call:

```typescript
// In applescript.ts - updated send_to_stata_app function
export function send_to_stata_app(
    stata_app: StataVariant,
    command: StataCommand,
    temp_file_path: string,
    focus_stata: boolean
): Promise<void> {
    // ... validation ...
    
    return new Promise((resolve, reject) => {
        const escaped_path = escape_for_applescript(temp_file_path);
        let applescript_cmd = `tell application "${stata_app}" to ` +
            `DoCommandAsync "${command} \\"${escaped_path}\\""`;
        
        // If not focusing Stata, activate VS Code after sending
        if (!focus_stata) {
            applescript_cmd += `\ntell application "Visual Studio Code" to activate`;
        }
        
        const shell_safe_cmd = applescript_cmd.replace(/'/g, "'\\''");
        exec(`osascript -e '${shell_safe_cmd}'`, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}
```

## Version Management

### Version Compatibility

The extension stores a minimum required executable version:

```typescript
// In exe-downloader.ts
const CURRENT_EXE_VERSION = '0.1.11';

// Version comparison uses semver
function is_version_compatible(installed: string, minimum: string): boolean {
    // Simple semver comparison
    const parse = (v: string) => v.split('.').map(Number);
    const [iMaj, iMin, iPatch] = parse(installed);
    const [mMaj, mMin, mPatch] = parse(minimum);
    
    if (iMaj !== mMaj) return iMaj > mMaj;
    if (iMin !== mMin) return iMin > mMin;
    return iPatch >= mPatch;
}
```

### version.json Schema

```json
{
    "version": "0.1.11",
    "architecture": "x64",
    "downloaded_at": "2024-01-15T10:30:00Z",
    "checksum": "sha256:2c7becace23c10f4f888f7f61eedfde8108f4e16ce21c1f8a8b625038a22c1d6"
}
```

## Error Handling

### Download Errors

| Error | User Message | Recovery |
|-------|--------------|----------|
| Network unreachable | "Unable to download. Check your internet connection." | Retry button |
| 404 Not Found | "Download not available. The extension may need updating." | Link to releases |
| Checksum mismatch | "Download verification failed. Please try again." | Retry button |
| Write permission denied | "Cannot save to storage folder. Check permissions." | Manual instructions |

### Execution Errors

| Exit Code | User Message |
|-----------|--------------|
| 4 (STATA_NOT_FOUND) | "No running Stata instance found. Start Stata before sending code." |
| 5 (SENDKEYS_FAIL) | "Failed to activate Stata window. Ensure Stata is not running as Administrator." |

### Stata Automation Registration

If send-to-stata fails due to missing Automation registration, the extension displays:

```
Stata's Automation type library may need to be registered.

To register, run this command as Administrator:
"C:\Program Files\Stata18\StataSE-64.exe" /Register

[Copy Command]  [Dismiss]
```

The extension detects this by checking stderr for "Automation" or specific error patterns. Since we can't reliably detect Stata's install path, the message provides a template command that users must adjust for their installation.

```typescript
// In windows-sender.ts
function handle_execution_error(code: number, stderr: string): void {
    // Check for Automation registration error
    if (stderr.toLowerCase().includes('automation') || 
        stderr.includes('80040154') ||  // CLASS_NOT_REGISTERED
        stderr.includes('REGDB_E_CLASSNOTREG')) {
        
        const register_cmd = '"C:\\Program Files\\Stata18\\StataSE-64.exe" /Register';
        
        vscode.window.showErrorMessage(
            "Stata's Automation type library may need to be registered. " +
            "Run Stata with /Register as Administrator.",
            'Copy Command'
        ).then(selection => {
            if (selection === 'Copy Command') {
                vscode.env.clipboard.writeText(register_cmd);
                vscode.window.showInformationMessage(
                    'Command copied. Adjust the path for your Stata installation, ' +
                    'then run in an Administrator command prompt.'
                );
            }
        });
        return;
    }
    
    // Handle other errors via exit code
    vscode.window.showErrorMessage(map_exit_code_to_message(code, stderr));
}
```

## Testing Strategy

### Unit Tests

1. **Architecture detection**: Mock `process.arch` and `PROCESSOR_ARCHITECTURE`
2. **Version comparison**: Test semver logic
3. **URL construction**: Verify correct release URLs
4. **Exit code mapping**: Test all error code translations
5. **Automation error detection**: Test stderr patterns for registration errors

### Integration Tests

1. **Download flow**: Mock HTTP responses, verify file written correctly
2. **Checksum verification**: Test with valid/invalid checksums
3. **Executable invocation**: Mock spawn, verify correct arguments
4. **focusStataWindow setting**: Verify `-ActivateStata` flag passed correctly

### Manual Testing

1. Fresh install on Windows x64
2. Fresh install on Windows ARM64
3. Update from older version
4. Network failure during download
5. Stata not running
6. Stata running as Administrator
7. Stata Automation not registered
8. focusStataWindow=true on Windows
9. focusStataWindow=true on macOS
10. focusStataWindow=false (default) on both platforms

## Correctness Properties

### Property 1: Download Idempotency
**Validates: Requirement 12.5**

For any sequence of download attempts, if the first succeeds, subsequent checks should find the existing executable without re-downloading.

### Property 2: Architecture Consistency
**Validates: Requirement 12.4**

The downloaded executable architecture must match the detected Windows architecture.

### Property 3: Version Monotonicity
**Validates: Requirement 13.2**

The stored version should only increase (or stay same), never decrease after an update.

### Property 4: Checksum Integrity
**Validates: Requirement 12.6**

A downloaded file with mismatched checksum must never be saved to storage.

## Security Considerations

1. **HTTPS only**: All downloads use HTTPS
2. **Checksum verification**: SHA-256 checksums prevent tampering
3. **Trusted source**: Downloads only from official GitHub releases
4. **No code execution during download**: Executable only runs after user-initiated command

## Requirements Traceability

| Requirement | Design Section |
|-------------|----------------|
| 1. Windows Platform Detection | Architecture Overview, Modified Files (commands.ts) |
| 2. Stata Instance Detection | Executable Invocation, Error Handling |
| 3. Send Code to Stata GUI | Executable Invocation |
| 4. Support All Send Modes | Send Mode Support |
| 5. Focus Management | Configuration, Executable Invocation |
| 6. Path Escaping | Cross-Platform Code Reuse (existing code) |
| 7. Working Directory Support | Cross-Platform Code Reuse (existing code) |
| 8. Error Handling | Error Handling |
| 9. Implementation Approach | Implementation Approach Decision |
| 10. Cross-Platform Code Preservation | Cross-Platform Code Reuse |
| 11. Configuration Compatibility | Configuration |
| 12. On-Demand Download | Download Infrastructure, User Experience Flow |
| 13. Executable Updates | Version Management |
| 14. Focus Stata Window Setting | Configuration |
| 15. macOS StataBE Support | Modified Files (applescript.ts) |
| 16. Automation Registration | Error Handling (Stata Automation Registration) |

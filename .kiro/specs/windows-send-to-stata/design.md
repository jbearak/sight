# Design Document

## Introduction

This document describes the technical design for adding Windows support to the VS Code extension's send-to-stata feature. The design leverages the existing C# executable from zed-stata, downloaded on-demand to keep the extension package small.

## Architecture Overview

The Windows implementation follows a hybrid architecture:
- **TypeScript layer**: Handles VS Code integration, user prompts, download management, and command orchestration
- **Native executable**: Handles Win32 API calls for window management, clipboard, and keystrokes

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

### 2. `client/src/send-to-stata/index.ts`

Export new Windows-related functions:

```typescript
export {
    send_to_stata_windows,
    ensure_executable
} from './windows-sender';
```

## Download Infrastructure

### GitHub Release URL Structure

The executable will be downloaded from zed-stata GitHub releases:

```
https://github.com/jbearak/sight-zed/releases/download/send-to-stata-v{VERSION}/send-to-stata-{ARCH}.exe

Examples:
- https://github.com/jbearak/sight-zed/releases/download/send-to-stata-v1.0.0/send-to-stata-x64.exe
- https://github.com/jbearak/sight-zed/releases/download/send-to-stata-v1.0.0/send-to-stata-arm64.exe
```

### Checksum Verification

Each release includes a `checksums.txt` file:

```
https://github.com/jbearak/sight-zed/releases/download/send-to-stata-v{VERSION}/checksums.txt

Contents:
sha256:abc123... send-to-stata-x64.exe
sha256:def456... send-to-stata-arm64.exe
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
// Contents: { "version": "1.0.0", "architecture": "x64", "downloaded_at": "2024-..." }
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

## Executable Invocation

The TypeScript layer spawns the executable with arguments matching the zed-stata CLI:

```typescript
import { spawn } from 'child_process';

async function send_to_stata_windows(
    command: StataCommand,
    temp_file_path: string,
    context: vscode.ExtensionContext
): Promise<void> {
    const exe_path = await ensure_executable(context);
    if (!exe_path) {
        return; // User declined download
    }

    const args = [
        '-FileMode',
        '-File', temp_file_path,
    ];
    
    if (command === 'include') {
        args.push('-Include');
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

## Version Management

### Version Compatibility

The extension stores a minimum required executable version:

```typescript
// In exe-downloader.ts
const MINIMUM_EXE_VERSION = '1.0.0';
const CURRENT_EXE_VERSION = '1.0.0';

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
    "version": "1.0.0",
    "architecture": "x64",
    "downloaded_at": "2024-01-15T10:30:00Z",
    "checksum": "sha256:abc123..."
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

## Testing Strategy

### Unit Tests

1. **Architecture detection**: Mock `process.arch` and `PROCESSOR_ARCHITECTURE`
2. **Version comparison**: Test semver logic
3. **URL construction**: Verify correct release URLs
4. **Exit code mapping**: Test all error code translations

### Integration Tests

1. **Download flow**: Mock HTTP responses, verify file written correctly
2. **Checksum verification**: Test with valid/invalid checksums
3. **Executable invocation**: Mock spawn, verify correct arguments

### Manual Testing

1. Fresh install on Windows x64
2. Fresh install on Windows ARM64
3. Update from older version
4. Network failure during download
5. Stata not running
6. Stata running as Administrator

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

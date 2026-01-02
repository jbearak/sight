# Design Document: Binary Installation

## Overview

This design adds installation scripts and a portable LSP configuration for the Sight binary. The implementation provides `install` and `uninstall` commands that handle platform detection, binary copying, and PATH verification, plus updates `lsp.json` to use a PATH-based reference. The installed binary is named `sight-language-server` to avoid conflicts with other tools and follow the naming convention of other language servers.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Installation Flow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  bun run build:current                                          │
│       │                                                         │
│       ▼                                                         │
│  Detect platform/arch ──► Build bin/sight-{platform}-{arch}    │
│                                                                 │
│  bun run install                                                │
│       │                                                         │
│       ▼                                                         │
│  Detect platform/arch ──► Find bin/sight-{platform}-{arch}     │
│       │                                                         │
│       ▼                                                         │
│  Create ~/bin if needed ──► Copy to ~/bin/sight-language-server │
│       │                                                         │
│       ▼                                                         │
│  Check PATH ──► Display success + PATH instructions if needed  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Install Script (`scripts/install.ts`)

```typescript
interface InstallResult {
    success: boolean;
    message: string;
    path_in_path: boolean;
}

function get_platform_binary_name(): string;
function get_user_bin_path(): string;
function is_path_in_env(target_dir: string): boolean;
function get_path_instructions(shell: string): string;
async function install(): Promise<InstallResult>;
```

### Uninstall Script (`scripts/uninstall.ts`)

```typescript
interface UninstallResult {
    success: boolean;
    message: string;
}

async function uninstall(): Promise<UninstallResult>;
```

### Build Script Updates (`scripts/build-binary.ts`)

Add a `build_current()` function:

```typescript
async function build_current(): Promise<void>;
```

### Platform Detection (shared utility)

```typescript
type Platform = 'darwin' | 'linux' | 'windows';
type Arch = 'arm64' | 'x64';

interface PlatformInfo {
    platform: Platform;
    arch: Arch;
    binary_name: string;
}

function detect_platform(): PlatformInfo;
```

## Data Models

### Platform to Binary Mapping

| Platform | Arch | Binary Name |
|----------|------|-------------|
| darwin | arm64 | sight-darwin-arm64 |
| linux | x64 | sight-linux-x64 |
| linux | arm64 | sight-linux-arm64 |
| windows | x64 | sight-windows-x64.exe |
| windows | arm64 | sight-windows-arm64.exe |

### Shell Configuration Files

| Shell | Config File | Export Command |
|-------|-------------|----------------|
| bash | ~/.bashrc | `export PATH="$HOME/bin:$PATH"` |
| zsh | ~/.zshrc | `export PATH="$HOME/bin:$PATH"` |
| fish | ~/.config/fish/config.fish | `set -gx PATH $HOME/bin $PATH` |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Platform Binary Selection

*For any* valid platform (darwin, linux, windows) and architecture (arm64, x64) combination, the `detect_platform()` function SHALL return the correct binary name following the pattern `sight-{platform}-{arch}` (with `.exe` suffix for Windows).

**Validates: Requirements 1.2, 2.2**

### Property 2: PATH Detection

*For any* PATH environment string, the `is_path_in_env()` function SHALL correctly detect whether `~/bin` (expanded to the user's home directory) is present in the PATH, handling:
- Colon-separated paths (Unix)
- Semicolon-separated paths (Windows)
- Paths with trailing slashes
- Paths using `$HOME` or `~` notation

**Validates: Requirements 5.1**

## Error Handling

| Error Condition | Behavior | Exit Code |
|-----------------|----------|-----------|
| Binary not found | Display error with `bun run build:current` suggestion | 1 |
| Cannot create ~/bin | Display permission error | 1 |
| Cannot copy binary | Display copy error with details | 1 |
| Uninstall target missing | Display "nothing to uninstall" message | 0 |

### Installed Binary Name

The binary is installed as `sight-language-server` rather than `sight` to:
- Avoid conflicts with other tools that might use the name "sight"
- Make it clear this is a language server
- Follow the convention of other LSP binaries (e.g., `typescript-language-server`)

## Testing Strategy

### Unit Tests

- Platform detection for all supported platforms
- Binary name generation
- PATH parsing and detection
- Shell instruction generation

### Property-Based Tests

- Property 1: Generate random platform/arch combinations, verify correct binary name
- Property 2: Generate random PATH strings with various formats, verify detection accuracy

### Integration Tests

- Full install flow on current platform
- Uninstall removes the correct file
- build:current produces expected binary

## Implementation Notes

### Package.json Updates

```json
{
  "scripts": {
    "build:current": "bun scripts/build-binary.ts current",
    "install": "bun scripts/install.ts",
    "uninstall": "bun scripts/uninstall.ts"
  }
}
```

### Updated lsp.json

```json
{
  "$schema": "https://kiro.dev/schemas/lsp.json",
  "servers": {
    "sight": {
      "command": "sight-language-server",
      "args": ["--stdio"],
      "fileExtensions": [".do", ".ado", ".doh", ".mata"],
      "rootMarkers": [".sight.json", "package.json"],
      "initializationOptions": {
        "diagnostics": {
          "enabled": true
        },
        "crossFile": {
          "indexWorkspace": true
        }
      }
    },
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileExtensions": [".ts", ".tsx", ".js", ".jsx"],
      "rootMarkers": ["tsconfig.json", "package.json"]
    }
  }
}
```

### Home Directory Expansion

Use `os.homedir()` for cross-platform home directory resolution:

```typescript
import { homedir } from 'os';
import { join } from 'path';

const user_bin = join(homedir(), 'bin');
```

### Making Binary Executable

On Unix systems, ensure the copied binary has execute permissions:

```typescript
import { chmod } from 'fs/promises';

await chmod(target_path, 0o755);
```

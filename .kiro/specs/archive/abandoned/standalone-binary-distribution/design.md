# Design Document: Standalone Binary Distribution

## Overview

This design enables the Sight LSP server to be distributed as a standalone binary for use by coding agents, CI/CD pipelines, and non-VS Code editors. The implementation leverages Bun's compile feature to produce self-contained executables with embedded assets, while maintaining backward compatibility with the existing VS Code extension.

## Architecture

The solution adds a thin CLI layer on top of the existing server, with a build pipeline that produces multiple distribution artifacts:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Build Pipeline                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  src/server.ts ──► src/cli.ts ──► Bun Build ──► Artifacts      │
│                                                                 │
│  Artifacts:                                                     │
│  ├── dist/sight-server.js      (bundled JS for Node.js)        │
│  ├── bin/sight-darwin-arm64    (macOS ARM native binary)       │
│  ├── bin/sight-linux-x64       (Linux x64 native binary)       │
│  ├── bin/sight-linux-arm64     (Linux ARM native binary)       │
│  └── bin/sight-windows-x64.exe (Windows x64 native binary)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Transport Selection

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLI Entry Point                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  sight --stdio      ──► createConnection(stdio)                 │
│  sight --node-ipc   ──► createConnection(ProposedFeatures.all)  │
│  sight (default)    ──► createConnection(stdio)                 │
│  sight --quiet      ──► suppress startup messages               │
│  sight --help       ──► print usage, exit(0)                    │
│  sight --version    ──► print version, exit(0)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### CLI Module (`src/cli.ts`)

New entry point that wraps the server with CLI argument parsing:

```typescript
interface CLIOptions {
    transport: 'stdio' | 'node-ipc';
    help: boolean;
    version: boolean;
    quiet: boolean;
}

function parse_args(argv: string[]): CLIOptions;
function print_help(): void;
function print_version(): void;
function create_transport_connection(transport: 'stdio' | 'node-ipc'): Connection;
```

### Server Module Changes (`src/server.ts`)

Refactor to export a factory function that accepts transport configuration:

```typescript
interface ServerOptions {
    transport: 'stdio' | 'node-ipc';
    quiet?: boolean;
    log_channel?: (msg: string) => void;
}

export function create_server(options: ServerOptions): void;
```

### Build Script (`scripts/build-binary.ts`)

New build script using Bun's programmatic build API:

```typescript
interface BuildTarget {
    platform: 'darwin' | 'linux' | 'windows';
    arch: 'x64' | 'arm64';
    output_name: string;
}

const TARGETS: BuildTarget[] = [
    { platform: 'darwin', arch: 'arm64', output_name: 'sight-darwin-arm64' },
    { platform: 'linux', arch: 'x64', output_name: 'sight-linux-x64' },
    { platform: 'linux', arch: 'arm64', output_name: 'sight-linux-arm64' },
    { platform: 'windows', arch: 'x64', output_name: 'sight-windows-x64.exe' },
    { platform: 'windows', arch: 'arm64', output_name: 'sight-windows-arm64.exe' },
];

async function build_binary(target: BuildTarget): Promise<void>;
async function build_bundle(): Promise<void>;
async function build_all(): Promise<void>;
```

### Asset Embedding

The command database cache is embedded using Bun's file import with type attribute:

```typescript
// In cli.ts or a dedicated loader
import cache_path from './command-database/caches/v18.json' with { type: 'file' };

// At runtime, read the embedded file
const cache_data = await Bun.file(cache_path).text();
const cache = JSON.parse(cache_data);
command_database.load_cache(cache);
```

## Data Models

### CLI Arguments

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--stdio` | `-s` | Use stdio transport | Yes (when standalone) |
| `--node-ipc` | `-i` | Use Node IPC transport | No |
| `--help` | `-h` | Show help message | - |
| `--version` | `-v` | Show version | - |

### Build Artifacts

| Artifact | Size (est.) | Use Case |
|----------|-------------|----------|
| `sight-server.js` | ~2MB | Node.js users, debugging |
| `sight-darwin-arm64` | ~50MB | macOS Apple Silicon |
| `sight-linux-x64` | ~50MB | Linux servers, CI/CD |
| `sight-linux-arm64` | ~50MB | Linux ARM (Graviton, RPi) |
| `sight-windows-x64.exe` | ~50MB | Windows x64 |
| `sight-windows-arm64.exe` | ~50MB | Windows ARM |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Transport Selection Determinism

*For any* CLI argument array, the transport selection SHALL be deterministic:
- If `--stdio` is present, stdio transport is selected
- If `--node-ipc` is present, Node IPC transport is selected  
- If neither is present, stdio transport is selected (default)
- The selection is consistent across repeated invocations with the same arguments

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Unknown Flag Rejection

*For any* string argument that does not match a recognized flag pattern (`--stdio`, `--node-ipc`, `--help`, `--version`, `--quiet`, `-s`, `-i`, `-h`, `-v`, `-q`), the CLI parser SHALL return an error result indicating the unknown flag.

**Validates: Requirements 2.3**

### Property 3: Argument Parsing Round-Trip

*For any* valid CLIOptions object, serializing it to an argument array and parsing that array SHALL produce an equivalent CLIOptions object.

**Validates: Requirements 2.4**

### Property 4: Functional Equivalence

*For any* LSP initialize request with valid parameters, both the bundled JavaScript server and the native binary SHALL return structurally equivalent initialize responses (same capabilities, same server info).

**Validates: Requirements 3.4, 4.3**

## Error Handling

### CLI Errors

| Error Condition | Behavior | Exit Code |
|-----------------|----------|-----------|
| Unknown flag | Print error + usage hint to stderr | 1 |
| Conflicting flags (`--stdio` + `--node-ipc`) | Print error to stderr | 1 |
| Missing required argument | Print error + usage to stderr | 1 |

### Runtime Errors

| Error Condition | Behavior |
|-----------------|----------|
| Failed to load command cache | Log warning, continue with empty cache |
| Transport connection failure | Log error to stderr, exit(1) |
| Invalid LSP message | Return JSON-RPC error response |

### Build Errors

| Error Condition | Behavior |
|-----------------|----------|
| Missing source files | Exit with error message |
| Bun compile failure | Print Bun error, exit(1) |
| Missing cache file | Exit with error message |

## Testing Strategy

### Unit Tests

- CLI argument parsing (all flag combinations)
- Transport factory function
- Version string extraction

### Property-Based Tests

- Property 1: Generate random argument arrays, verify deterministic transport selection
- Property 2: Generate valid flags, verify successful parsing
- Property 3: Generate invalid flag strings, verify rejection
- Property 5: Compare embedded asset hash with source file hash

### Integration Tests

- Start binary with `--stdio`, send LSP initialize request, verify response
- Start binary with `--help`, verify output contains expected sections
- Start binary with `--version`, verify output matches package.json version

### Manual Verification

- Build binaries for all platforms
- Test on actual target platforms (macOS, Linux, Windows)
- Verify VS Code extension still works with `--node-ipc`

## Implementation Notes

### Stdio Transport in vscode-languageserver

The `vscode-languageserver` package supports stdio transport via:

```typescript
import { createConnection } from 'vscode-languageserver/node';

// For stdio
const connection = createConnection(process.stdin, process.stdout);

// For Node IPC (current behavior)
const connection = createConnection(ProposedFeatures.all);
```

### Logging with Stdio Transport

When using stdio transport, all logging must go to stderr to avoid corrupting the LSP protocol stream:

```typescript
// In Logger initialization for stdio mode
Logger.initialize({
    verbosity: 'info',
    channel: (msg) => process.stderr.write(msg + '\n'),
});
```

### Bun Compile Considerations

1. **Bytecode compilation**: Enable for faster startup (`--bytecode`)
2. **Minification**: Enable for smaller binaries (`--minify`)
3. **Sourcemaps**: Embed for debugging (`--sourcemap`)
4. **Asset naming**: Disable content hash for predictable paths

### Package.json Updates

```json
{
  "bin": {
    "sight": "dist/sight-server.js"
  },
  "scripts": {
    "build:bundle": "bun scripts/build-binary.ts bundle",
    "build:binary": "bun scripts/build-binary.ts binary",
    "build:all": "bun scripts/build-binary.ts all"
  }
}
```

### Kiro CLI LSP Configuration (`lsp.json`)

The `lsp.json` file configures language servers for Kiro CLI. Based on the MCP configuration pattern, the format is:

```json
{
  "servers": {
    "sight": {
      "command": "./bin/sight-darwin-arm64",
      "args": ["--stdio"],
      "fileExtensions": [".do", ".ado", ".doh", ".mata"],
      "rootMarkers": [".sight.json", "package.json"]
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

The configuration supports:
- **command**: Path to the LSP binary (relative or absolute)
- **args**: Command-line arguments (always include `--stdio`)
- **fileExtensions**: File types this server handles
- **rootMarkers**: Files that indicate project root for workspace detection

For cross-platform support, the `lsp.json` can use platform-specific paths or rely on a globally installed binary in PATH.

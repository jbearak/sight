# Requirements Document

## Introduction

This feature enables the Sight LSP server to be distributed and run as a standalone binary, making it usable by coding agents (like Kiro CLI), CI/CD pipelines, and editors other than VS Code. The current implementation only supports Node IPC transport and requires the full Node.js runtime with dependencies. This feature adds stdio transport support, single-file bundling, native binary compilation, and Kiro CLI configuration for automatic LSP loading.

## Glossary

- **LSP_Server**: The Sight Language Server Protocol implementation for Stata
- **Transport**: The communication mechanism between LSP client and server (stdio, IPC, socket)
- **Stdio_Transport**: Standard input/output streams for LSP communication, the standard for standalone LSP servers
- **Bundle**: A single JavaScript file containing all dependencies
- **Native_Binary**: A self-contained executable that doesn't require Node.js runtime
- **Kiro_CLI**: Amazon's AI-powered command-line tool that supports LSP integration via lsp.json
- **LSP_Config**: The lsp.json configuration file that tells Kiro CLI which language servers to use

## Requirements

### Requirement 1: Stdio Transport Support

**User Story:** As a developer integrating Sight with a coding agent or non-VS Code editor, I want the LSP server to communicate via stdio, so that I can use standard LSP client libraries.

#### Acceptance Criteria

1. WHEN the LSP_Server is started with `--stdio` flag, THE LSP_Server SHALL use stdio transport instead of Node IPC
2. WHEN the LSP_Server is started without any transport flag, THE LSP_Server SHALL default to stdio transport for standalone usage
3. WHEN the LSP_Server is started with `--node-ipc` flag, THE LSP_Server SHALL use Node IPC transport for VS Code compatibility
4. WHEN using stdio transport, THE LSP_Server SHALL read JSON-RPC messages from stdin and write responses to stdout
5. WHEN using stdio transport, THE LSP_Server SHALL write diagnostic/log messages to stderr to avoid corrupting the LSP protocol stream

### Requirement 2: CLI Interface

**User Story:** As a developer, I want clear command-line options for the LSP server, so that I can configure it appropriately for my use case.

#### Acceptance Criteria

1. WHEN the LSP_Server is started with `--help` flag, THE LSP_Server SHALL display usage information and available options
2. WHEN the LSP_Server is started with `--version` flag, THE LSP_Server SHALL display the current version number
3. WHEN the LSP_Server receives an unknown flag, THE LSP_Server SHALL display an error message and exit with non-zero status
4. THE LSP_Server SHALL support the following flags: `--stdio`, `--node-ipc`, `--quiet`, `--help`, `--version`

### Requirement 3: Single-File Bundle

**User Story:** As a developer distributing Sight, I want a single JavaScript file containing all dependencies, so that deployment is simple and doesn't require npm install.

#### Acceptance Criteria

1. WHEN the build script is run with bundle target, THE Build_System SHALL produce a single JavaScript file in `dist/sight-server.js`
2. THE Bundle SHALL include all runtime dependencies (vscode-languageserver, vscode-uri, etc.)
3. THE Bundle SHALL include the command database cache embedded or co-located
4. WHEN the Bundle is executed with Node.js, THE LSP_Server SHALL function identically to the unbundled version
5. THE Bundle SHALL be executable via `node dist/sight-server.js --stdio`

### Requirement 4: Native Binary Compilation

**User Story:** As a developer deploying to environments without Node.js, I want a native executable, so that I can run Sight without any runtime dependencies.

#### Acceptance Criteria

1. WHEN the build script is run with binary target, THE Build_System SHALL use Bun's compile feature to produce native executables
2. THE Native_Binary SHALL support macOS (arm64), Linux (x64, arm64), and Windows (x64, arm64) platforms
3. WHEN the Native_Binary is executed, THE LSP_Server SHALL function identically to the Node.js version
4. THE Native_Binary SHALL include the command database cache embedded as an asset
5. THE Native_Binary SHALL default to stdio transport
6. THE Build_System SHALL produce binaries for all supported platforms via cross-compilation

### Requirement 5: Distribution Channels

**User Story:** As a developer, I want multiple ways to obtain Sight binaries, so that I can choose the method that fits my workflow.

#### Acceptance Criteria

1. THE Build_System SHALL produce downloadable binaries for GitHub Releases
2. THE Native_Binary filenames SHALL follow the pattern `sight-{platform}-{arch}` (e.g., `sight-darwin-arm64`, `sight-linux-x64`)
3. WHEN a user downloads a binary, THE Native_Binary SHALL be immediately executable without additional setup
4. THE Build_System SHALL optionally support npm publishing for users who prefer that distribution method
5. THE Repository SHALL include documentation on how to obtain and use the standalone binary

### Requirement 6: Documentation Updates

**User Story:** As a developer or contributor, I want the project documentation to reflect the new binary distribution capabilities, so that I can understand how to build, use, and integrate the standalone LSP.

#### Acceptance Criteria

1. THE README.md SHALL document how to build and use the standalone binary
2. THE README.md SHALL document the available CLI flags (`--stdio`, `--node-ipc`, `--quiet`, `--help`, `--version`)
3. THE README.md SHALL document how to integrate Sight with Kiro CLI
4. THE AGENTS.md SHALL document the new build scripts (`build:bundle`, `build:binary`, `build:all`)
5. THE AGENTS.md SHALL document the CLI entry point and transport options

### Requirement 7: Kiro CLI LSP Configuration

**User Story:** As a developer using Kiro CLI with this project, I want the Stata and TypeScript LSPs to load automatically, so that I get code intelligence for both languages.

#### Acceptance Criteria

1. THE Repository SHALL include an `lsp.json` file in the project root that configures language servers for Kiro CLI
2. THE LSP_Config SHALL configure the Sight LSP server for Stata files (`.do`, `.ado`, `.doh`, `.mata` extensions)
3. THE LSP_Config SHALL configure the TypeScript language server for TypeScript files (`.ts`, `.tsx` extensions)
4. WHEN Kiro CLI initializes the workspace, THE LSP_Config SHALL cause both language servers to start via stdio transport
5. THE LSP_Config SHALL specify the Sight binary path relative to the project or use a globally installed binary
6. THE LSP_Config SHALL include appropriate initialization options for both language servers

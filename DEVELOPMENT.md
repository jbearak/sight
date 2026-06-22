# Development

## Prerequisites

- [Bun](https://bun.sh) (tested with v1.3.6) - strictly required for dependencies, testing, and packaging.

## Setup

1. Clone this repository
2. Install dependencies (root and client are separate packages):
   ```bash
   bun install
   bun install --cwd client
   ```
3. Press `F5` in VS Code to build and launch the extension in a debug window

## Running Tests

```bash
bun run test
```

This runs `bun run typecheck` first, then executes the test suite.

## Building a VSIX Package

To create a `.vsix` file for distribution or manual installation:

```bash
bun run package
```

This builds the project and creates a `sight-<version>.vsix` file in the
`client/` directory.

To install the VSIX manually in VS Code:
- Open VS Code → Extensions → `...` menu → "Install from VSIX..."
- Or run: `code --install-extension client/sight-<version>.vsix`

## Standalone Binary

The LSP server can be built as a standalone binary for use with coding agents (like Kiro CLI), CI/CD pipelines, and editors other than VS Code.

### CLI Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--stdio` | `-s` | Use stdio transport (default for standalone) |
| `--node-ipc` | `-i` | Use Node IPC transport (for VS Code) |
| `--quiet` | `-q` | Suppress startup messages |
| `--help` | `-h` | Show help message |
| `--version` | `-v` | Show version number |

### Building the Binary

```bash
# Build bundled JavaScript (for Node.js users)
bun run build:bundle

# Build native binary for current platform
bun run build:current

# Build native binaries for all platforms
bun run build:binary

# Build both bundle and all binaries
bun run build:all
```

Build outputs:
- `dist/sight-server.js` - Bundled JavaScript (runs with Node.js)
- `bin/sight-darwin-arm64` - macOS Apple Silicon
- `bin/sight-linux-x64` - Linux x64
- `bin/sight-linux-arm64` - Linux ARM64
- `bin/sight-windows-x64.exe` - Windows x64
- `bin/sight-windows-arm64.exe` - Windows ARM64

### Installing the Binary

After building, you can install the binary to `~/bin` for easy access from any project:

```bash
# Build for your current platform
bun run build:current

# Install to ~/bin/sight
bun run install:binary

# Uninstall when no longer needed
bun run uninstall:binary
```

If `~/bin` is not in your PATH, add it to your shell configuration:

**bash** (~/.bashrc):
```bash
export PATH="$HOME/bin:$PATH"
```

**zsh** (~/.zshrc):
```bash
export PATH="$HOME/bin:$PATH"
```

**fish** (~/.config/fish/config.fish):
```fish
set -gx PATH $HOME/bin $PATH
```

Then restart your shell or run `source ~/.bashrc` (or `~/.zshrc`).

## Versioning

To bump the version in both `package.json` and `client/package.json`:

```bash
# Bump version, commit, and tag (default)
bun scripts/bump-version.ts patch   # 0.1.0 → 0.1.1
bun scripts/bump-version.ts minor   # 0.1.0 → 0.2.0
bun scripts/bump-version.ts major   # 0.1.0 → 1.0.0

# Or specify an explicit version
bun scripts/bump-version.ts 0.1.19

# Only update version files, skip git operations
bun scripts/bump-version.ts 0.1.19 --no-git
```

Do not use `bump-version --push` for releases; use
`bun scripts/release.ts x.y.z` so the release workflow gates run.

## Releasing

### Via GitHub Actions (recommended)

```bash
bun scripts/release.ts x.y.z
```

This bumps versions, commits, creates a tag, and pushes. GitHub Actions then
builds all artifacts and dispatches the publish workflow. The publish workflow
always creates the GitHub Release, and publishes VS Code/OpenVSX artifacts only
when `RELEASE_PUBLISH_VSCODE=true`.

### Dry Run (build locally without publishing)

```bash
bun run build:npm
bun run build:current
bun run package
```

Do not push a test release tag for a dry run. Release tags dispatch the publish
workflow, which creates the GitHub Release after validating that the tag matches
`package.json`.

### Local Artifact Build (manual)

```bash
# Build everything
bun run build:bundle      # JS bundle
bun run build:binary      # Native binaries for all supported platforms
bun run build:current     # Native binary for the current platform only
bun run package           # VSIX
```

Use the GitHub Actions release path for publishing. Direct `vsce`, `ovsx`, or
`gh release create` commands bypass the release workflow gates and should be
reserved for emergency recovery only.

## Project Structure

- `src/`: Server source code.
  - `lexer/`: Stata lexer implementation.
  - `parser/`: Stata AST parser.
  - `analyzer/`: Semantic analysis and symbol table building.
  - `providers/`: LSP feature providers (completion, hover, etc.).
  - `directive-parser/`: Parses `@lsp-*` directives for cross-file awareness.
  - `scope-resolver/`: Cross-file symbol resolution via directive chains.
  - `indexer/`: Workspace-wide symbol indexing.
  - `context-tracker/`: Embedded language context detection and management.
  - `command-database/`: Stata command metadata and caching.
  - `comment-processor/`: Comment analysis, classification, and style normalization.
  - `pretty-printer/`: Code formatting logic.
  - `smcl-parser/`: Parser for Stata's SMCL help file format.
- `client/`: VS Code extension source code and configuration.
- `tests/`: Unit, integration, and property-based tests.

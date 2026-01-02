# Development

## Prerequisites

- [Bun](https://bun.sh) (tested with v1.1.35) - strictly required for dependencies, testing, and packaging.

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

This builds the project and creates a `sight-client-<version>.vsix` file in the `client/` directory.

To install the VSIX manually in VS Code:
- Open VS Code → Extensions → `...` menu → "Install from VSIX..."
- Or run: `code --install-extension client/sight-client-<version>.vsix`

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

# Install to ~/bin/sight-language-server
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
bun run version:patch   # 0.1.0 → 0.1.1
bun run version:minor   # 0.1.0 → 0.2.0
bun run version:major   # 0.1.0 → 1.0.0
```

## Releasing

### Via GitHub Actions (recommended)

```bash
bun scripts/release.ts x.y.z 
```

This bumps versions, commits, creates a tag, and pushes. GitHub Actions then builds all artifacts and you manually trigger the publish workflow.

### Dry Run (test CI without publishing)

```bash
# Create a test tag
git tag v0.0.0-test
git push origin v0.0.0-test

# This triggers release-build.yml (builds everything, doesn't publish)
# Check results at: https://github.com/jbearak/sight/actions

# Clean up after
git push origin --delete v0.0.0-test
git tag -d v0.0.0-test
```

### Local Release (manual)

```bash
# Build everything
bun run build:bundle      # JS bundle
bun run build:binary      # Native binaries (current platform only)
bun run package           # VSIX

# Publish VS Code extension
cd client
npx vsce publish --pat $VSCE_TOKEN
npx ovsx publish --pat $OVSX_TOKEN
cd ..

# Create GitHub release with binaries
gh release create vx.y.z \
  bin/sight-* \
  dist/sight-server.js \
  client/*.vsix
```

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

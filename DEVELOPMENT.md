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
- `zed-extension/`: Zed editor extension (Tree-sitter grammar, WASM extension, language config).

## Zed Extension Development

### Prerequisites

In addition to Bun (required for the main project), the Zed extension requires:

- **Rust** (stable toolchain): For compiling the extension to WASM
- **Cargo**: Rust package manager (included with Rust)
- **wasm32-wasip1 target**: Install with `rustup target add wasm32-wasip1`

> **Note:** The tree-sitter grammar is maintained in a [separate repository](https://github.com/jbearak/tree-sitter-stata) and fetched automatically by Zed. You only need `tree-sitter-cli` if you're contributing to the grammar itself.
### Extension Layout (Dev Mode)

When running as a dev extension, Zed executes the extension from:

- `~/Library/Application Support/Zed/extensions/work/<extension-id>`

But bundled assets (like the LSP binary) live under:

- `~/Library/Application Support/Zed/extensions/installed/<extension-id>`

The Sight extension therefore resolves the server binary from the work dir
first, then falls back to the installed dir. If Zed can't start the language
server, check that `extensions/installed/sight/server/sight-server` exists.

### Build Process

> **Note:** The tree-sitter grammar is now maintained in a separate repository and fetched automatically by Zed.

1. Build the WASM extension:
   ```bash
   cd zed-extension
   cargo build --release --target wasm32-wasip1
   cp target/wasm32-wasip1/release/sight_extension.wasm extension.wasm
   ```

2. Bundle the LSP server (creates a standalone binary):
   ```bash
   bun build --compile --outfile=zed-extension/server/sight-server ./src/server.ts
   ```

3. Copy command database caches:
   ```bash
   mkdir -p zed-extension/server/command-database/caches
   cp -r src/command-database/caches/* zed-extension/server/command-database/caches/
   ```
### Troubleshooting

If Zed reports **"failed to load language Stata"** or **"Sight server binary not found"**:

1. Ensure the dev extension is installed (Zed: Extensions → Install Dev Extension).
2. Verify the server binary exists at:
   - `~/Library/Application Support/Zed/extensions/installed/sight/server/sight-server`
3. If the grammar fails to fetch, clear cached checkouts and rebuild:
   ```bash
   rm -rf ~/Library/Application\ Support/Zed/extensions/installed/sight/grammars
   rm -rf ~/Library/Application\ Support/Zed/extensions/work/sight
   ```
4. Run **Extensions: Rebuild** and restart Zed.

### Testing Locally

Install as a dev extension by symlinking to Zed's extension directory:

**macOS/Linux:**
```bash
mkdir -p ~/.config/zed/extensions/installed
ln -s $(pwd)/zed-extension ~/.config/zed/extensions/installed/sight
```

After symlinking, restart Zed to load the extension. Open a `.do` file to verify syntax highlighting and LSP features are working.

### Zed Extension Structure

```
zed-extension/
├── extension.toml          # Extension manifest (id, name, version, grammar reference)
├── Cargo.toml              # Rust project config for WASM compilation
├── src/lib.rs              # Extension trait implementation
├── languages/stata/        # Language configuration
│   ├── config.toml         # File associations, comments, brackets
│   ├── highlights.scm      # Syntax highlighting queries
│   ├── brackets.scm        # Bracket matching queries
│   ├── indents.scm         # Auto-indentation queries
│   └── outline.scm         # Code outline queries
└── server/                 # Bundled LSP server (after build)
    ├── sight-server        # Compiled binary
    └── command-database/   # Command metadata caches
```

> **Note:** The tree-sitter grammar is fetched from the external [tree-sitter-stata](https://github.com/jbearak/tree-sitter-stata) repository during extension installation. See "Tree-Sitter Grammar Repository" below for details.

### Tree-Sitter Grammar Repository

The tree-sitter grammar for Stata is maintained in a **separate repository**: [tree-sitter-stata](https://github.com/jbearak/tree-sitter-stata).

This separation is required by Zed's architecture, which dynamically fetches tree-sitter grammars from external repositories during extension installation. The grammar cannot be bundled within the extension itself.

#### Repository Relationship

- **sight** (this repository): Contains the Zed extension configuration, language queries (highlights, brackets, indents, outline), and the LSP server
- **tree-sitter-stata**: Contains the tree-sitter grammar definition (`grammar.js`), external scanner (`scanner.c`), generated parser files, and Rust/Node.js bindings

#### Updating the Grammar Version

When the tree-sitter-stata grammar is updated, you need to update the Zed extension to reference the new version:

1. **Check the latest version** at [tree-sitter-stata releases](https://github.com/jbearak/tree-sitter-stata/releases)

2. **Update `extension.toml`** in the `zed-extension/` directory:
   ```toml
   [grammars.stata]
   repository = "https://github.com/jbearak/tree-sitter-stata"
   rev = "v0.1.8"  # Update this to the new version tag
   ```

3. **Test the extension** by installing it locally in Zed (see "Testing Locally" above)

4. **Commit and release** a new version of the sight extension

#### Contributing Grammar Changes

To contribute changes to the tree-sitter grammar itself:

1. Clone the [tree-sitter-stata](https://github.com/jbearak/tree-sitter-stata) repository
2. Make changes to `grammar.js` or `src/scanner.c`
3. Run `tree-sitter generate` to regenerate the parser
4. Run `tree-sitter test` to verify the grammar
5. Submit a pull request to tree-sitter-stata
6. After the PR is merged and a new version is tagged, update the sight extension as described above

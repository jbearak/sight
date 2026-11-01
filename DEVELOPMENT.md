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

## Data Browser Benchmarks

The data browser has a benchmark harness under
`scripts/bench-data-browser/`; the plan it measures against is
[specs/2026-10-30-data-browser-redesign.md](specs/2026-10-30-data-browser-redesign.md).

```bash
# Host-side benchmark: drives the real panel under Node with a fake
# webview. Generates 10M x 10 and 1M x 500 fixtures (~3 GB) on first run.
bun run bench:data-browser

# Smaller fixtures, fewer samples, report to a file
bun run bench:data-browser --scale 0.1 --samples 1 --out bench.md

# Cold page cache (Linux with passwordless sudo, as on CI)
bun run bench:data-browser --scale 0.1 --cold

# End to end in a real VS Code: open each fixture and time it to the
# first rows painted (10% fixtures by default; SIGHT_PERF_SCALE=1 for
# full size). VSCODE_EXECUTABLE points at an installed VS Code instead
# of downloading one.
cd client && bun run test:perf
```

The benchmark reports, per operation, the time to the host's reply, the
extension host's longest event-loop stall, the reply's JSON size and the
process's peak RSS. CI runs it at 10% scale on every PR as a
report-only job. In everyday use, `sight.dataBrowser.debugTiming` logs
the same open-to-paint marks to the Sight output channel.

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

For the published npm package:

```bash
npm install -g @jbearak/sight
sight --version
```

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

### Stable and pre-release channels

The VS Code Marketplace and Open VSX accept only plain `X.Y.Z` versions, so
the channel lives in the minor version: **even minor = stable, odd minor =
pre-release** (Microsoft's recommended scheme). Users opt in with **Switch to
Pre-Release Version** on the extension page and get the highest version
across both channels, so number a pre-release above the current stable
release. Every minor through 0.15 shipped as stable before this scheme, so
0.15.x stays stable; the first pre-release is 0.17.0.
`scripts/release-channel.ts` is the single classifier, shared by the release
scripts and workflows, and it rejects suffixed versions like `1.0.0-beta.1`.

For a pre-release tag, the release workflows:

- package the `.vsix` with `vsce package --pre-release` and check its
  manifest against the tag (`scripts/check-vsix-release.ts`);
- publish to npm under the `next` dist-tag, so `latest` stays stable;
- mark the GitHub Release as a prerelease, so `releases/latest` stays stable;
- skip the Homebrew formula bump.

The classifier is read from the tag, so re-dispatching `release-build.yml` or
`release-publish.yml` for a tag cut before it existed fails at the channel
step. `bump-homebrew.yml` reads it from its own revision instead, so
dispatch that one from `main`.

### Version bumps

To bump the version in both `package.json` and `client/package.json`:

```bash
# Bump version, commit, and tag (default)
bun scripts/bump-version.ts patch     # same channel: 0.18.0 → 0.18.1
bun scripts/bump-version.ts minor     # next stable: 0.17.2 → 0.18.0
bun scripts/bump-version.ts preview   # next pre-release: 0.18.1 → 0.19.0
bun scripts/bump-version.ts major     # 0.18.0 → 1.0.0

# Or specify an explicit version
bun scripts/bump-version.ts 0.1.19

# Print the next version and its channel without changing anything
bun scripts/bump-version.ts --dry-run preview

# Only update version files, skip git operations
bun scripts/bump-version.ts 0.1.19 --no-git
```

Do not use `bump-version --push` for releases; use
`bun scripts/release.ts x.y.z` so the release workflow gates run.

## Releasing

### Via GitHub Actions (recommended)

```bash
bun scripts/release.ts x.y.z
bun scripts/release.ts preview            # or patch, minor, major
bun scripts/release.ts --dry-run preview  # print version and channel only
```

This bumps versions, commits, creates a tag, and pushes. Before it changes
anything, it checks that the new version is above the current one and that
the tag does not exist locally or on `origin`; from a terminal, it then asks
you to confirm the version and channel. Because the version must go up, a
stable hotfix for an older line (say 0.15.2 after 0.17.0) has to be cut from
a branch that is still on that line. GitHub Actions then
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

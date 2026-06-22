# Standalone Installation

In addition to the VS Code extension, you can install the standalone tool to
use the LSP directly with other editors (e.g., vim, neovim, and emacs) or in
CI/CD. To do this, either download a release binary or
[build from source](#build-from-source).

## Release Binary

Download the appropriate `sight-*` binary from the
[GitHub releases page](https://github.com/jbearak/sight/releases), place it on
your `PATH`, and make it executable on Unix-like systems.

On macOS or Linux:

```bash
mkdir -p ~/bin
downloaded_binary=sight-linux-x64  # replace with your downloaded binary
case "$downloaded_binary" in
  sight-darwin-arm64|sight-linux-x64|sight-linux-arm64) ;;
  *)
    echo "Set downloaded_binary to a macOS/Linux binary, not a .vsix or JS bundle"
    exit 1
    ;;
esac
test -f "$downloaded_binary" || {
  echo "$downloaded_binary not found in the current directory"
  exit 1
}
test ! -e ~/bin/sight || {
  echo "~/bin/sight already exists; remove it first if it is safe to replace"
  exit 1
}
install -m 755 "$downloaded_binary" ~/bin/sight
chmod +x ~/bin/sight
sight --help
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\bin" | Out-Null
$downloadedBinary = "sight-windows-x64.exe"  # or sight-windows-arm64.exe
if (!(Test-Path $downloadedBinary)) {
    throw "$downloadedBinary not found in the current directory"
}
if (Test-Path "$HOME\bin\sight.exe") {
    throw "$HOME\bin\sight.exe already exists; remove it first if safe"
}
Copy-Item $downloadedBinary "$HOME\bin\sight.exe"
& "$HOME\bin\sight.exe" --help
```

If `sight` is not found after this, add `%USERPROFILE%\bin` to your user
`Path`.

Existing editor configs that still call `sight-language-server` should be
updated to `sight --stdio`. If you need temporary compatibility while updating
those configs on macOS or Linux, add a legacy alias:

```bash
test ! -e ~/bin/sight-language-server || {
  echo "~/bin/sight-language-server already exists; update configs to sight"
  exit 1
}
ln -s ~/bin/sight ~/bin/sight-language-server
```

On Windows, copy the executable instead:

```powershell
Copy-Item "$HOME\bin\sight.exe" "$HOME\bin\sight-language-server.exe"
```

After installation, the `sight` command should be available globally. Use it
with:
- **Other LSP clients**: Configure to run `sight --stdio`
- **AI agents**: See [Editor Integrations](editor-integrations.md)
- **Manual testing**: Run `sight --help` to verify installation

## Build from Source

If you're building from source, the `scripts/setup.sh` script handles
everything:

```bash
./scripts/setup.sh
```

This will:
1. Install dependencies (`bun install`)
2. Build and package the VSIX
3. Install the extension to all detected editors (VS Code, Kiro, Cursor, etc.)
4. Identify conflicting syntax highlighting extensions (`stata-enhanced`)
5. Build and install the standalone binary to `~/bin`

> **Note:** Ensure `~/bin` is on your `PATH` so that `sight` is discoverable.
> If it isn't, add `export PATH="$HOME/bin:$PATH"` to your shell profile
> (e.g., `~/.zshrc` or `~/.bashrc`).
> If setup.sh identifies conflicting syntax highlighting extensions, it will
> ask you what to do (disable/uninstall/do nothing).

Requires [Bun](https://bun.sh) (`brew install bun` or see https://bun.sh).

## CLI Options

```bash
sight [options]
```

| Option | Description |
|---|---|
| `--stdio` | Use stdio transport (default) |
| `--node-ipc` | Use Node IPC transport (for VS Code) |
| `--quiet` | Suppress startup messages |
| `--help` | Show help |
| `--version` | Show version |

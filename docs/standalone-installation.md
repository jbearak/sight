# Standalone Installation

In addition to the VS Code extension, you can install the standalone tool to use the LSP directly with other editors (e.g., vim, neovim, and emacs) or in CI/CD. To do this, either [build from source](#build-from-source) or use npm/npx.

## npm / npx

Run directly from GitHub without installing:
```bash
npx github:jbearak/sight --stdio
```

Or install globally from GitHub:

```bash
npm install -g github:jbearak/sight
```

After installation, the `sight-language-server` command will be available globally. Use it with:
- **Other LSP clients**: Configure to run `sight-language-server --stdio`
- **AI agents**: See [Editor Integrations](editor-integrations.md)
- **Manual testing**: Run `sight-language-server --help` to verify installation

## Build from Source

If you're building from source, the `setup.sh` script handles everything:

```bash
./setup.sh
```

This will:
1. Install dependencies (`bun install`)
2. Build and package the VSIX
3. Install the extension to all detected editors (VS Code, Kiro, Cursor, etc.)
4. Identify conflicting syntax highlighting extensions (`stata-enhanced`)
5. Build and install the standalone binary to `~/bin`

> **Note:** Ensure `~/bin` is on your `PATH` so that `sight-language-server` is discoverable. If it isn't, add `export PATH="$HOME/bin:$PATH"` to your shell profile (e.g., `~/.zshrc` or `~/.bashrc`).

> If setup.sh identifies conflicting syntax highlighting extensions, it will ask you what to do (disable/uninstall/do nothing).

Requires [Bun](https://bun.sh) (`brew install bun` or see https://bun.sh).

## CLI Options

```
sight-language-server [options]
```

| Option | Description |
|---|---|
| `--stdio` | Use stdio transport (default) |
| `--node-ipc` | Use Node IPC transport (for VS Code) |
| `--quiet` | Suppress startup messages |
| `--help` | Show help |
| `--version` | Show version |

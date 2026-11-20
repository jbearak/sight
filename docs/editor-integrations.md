# Editor Integrations

Sight's language server supports any editor with an LSP client. This page covers generic LSP setup and AI agent configurations.

For editor-specific guides:
- **VS Code / forks**: Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jbearak.sight), from the [OpenVSX Registry](https://open-vsx.org/extension/jbearak/sight), or from the [GitHub releases page](https://github.com/jbearak/sight/releases)
- **Neovim**: See [Neovim Setup](neovim-setup.md)
- **Zed**: See [jbearak/zed-stata](https://github.com/jbearak/zed-stata)

## Generic LSP Client

Any LSP client that supports stdio transport can use the Sight server:

```bash
sight --stdio
```

Configure your editor's LSP client to run this command for `.do`, `.ado`, and `.mata` files.

The server accepts any valid spelling of a `file:` URI, such as
`file:///C:/proj/main.do` or `file:///c%3A/proj/main.do`. Diagnostics for
a document the client has open are published under the URI the client
opened it with. Other replies, such as a definition in another file, use
the percent-encoded form with a lower-case drive letter.

See [Standalone Installation](standalone-installation.md) for installation
options.

## Agent Integration

Each tool below requires `sight` to be installed
globally and available on your `PATH`. The VS Code extension bundles
its own copy of the server that is only accessible to VS Code — it
does not make the binary available to other tools. Install it
separately from source or a release binary:

```bash
# From a Sight checkout
./scripts/setup.sh
```

See [Standalone Installation](standalone-installation.md) for
additional install options.

### Claude Code

Install the `sight-lsp` plugin from the
[`jbearak/claude-plugins`](https://github.com/jbearak/claude-plugins)
marketplace:

```text
/plugin marketplace add jbearak/claude-plugins
/plugin install sight-lsp@jbearak
```

The plugin configures Claude Code to launch Sight for Stata files
(`.do`, `.ado`, `.doh`, `.mata`).

### Kiro CLI

Create `lsp.json` in your project root:

```json
{
  "languages": {
    "stata": {
      "name": "sight",
      "command": "sight",
      "args": ["--stdio"],
      "file_extensions": ["do", "ado", "doh", "mata"],
      "project_patterns": ["sight.toml"]
    }
  }
}
```

### OpenCode

Create an `opencode.json` file in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "stata": {
      "command": ["sight", "--stdio"],
      "extensions": [".do", ".ado", ".doh", ".mata"]
    }
  }
}
```

### Crush

Create a `crush.json` file in your project root:

```json
{
  "$schema": "https://charm.land/crush.json",
  "lsp": {
    "stata": {
      "command": "sight",
      "args": ["--stdio"],
      "extensions": [".do", ".ado", ".doh", ".mata"]
    }
  }
}
```

## Troubleshooting

- **Server not found**: Ensure `sight` is on your PATH. See
  [Standalone Installation](standalone-installation.md) for install options.
- **No diagnostics**: Check that files have a `.do`, `.ado`, `.doh`, or `.mata` extension.
- **Logs**: Run with `SIGHT_TEST_LOG=1` environment variable for verbose output.

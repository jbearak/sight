# Sight - Language Server for Stata

An open source [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol) implementation for the Stata statistical programming language, with a corresponding extension for [VS Code](https://github.com/Microsoft/vscode).

> **tl;dr**: Sight brings **modern IDE superpowers** to Stata coding. It goes far beyond syntax highlighting, using **semantic analysis** to provide **workspace-wide symbol resolution** and **intelligent macro tracking**. With features like **Go-to-Definition**, **Autocomplete**, and **Real-time Diagnostics** that trace execution through `do` and `include` chains, Sight helps you catch errors *before* you run your code.
>
> **Development Status:** Sight is an early-stage implementation. While functional, it requires substantial testing and code review. Contributions and feedback are welcome!
>
> **Quick Start:** Download from the [releases page](https://github.com/jbearak/sight/releases), or clone the repo and run `./setup.sh` to build from source. See [Installation](#installation) for details.

Sight provides Stata language support for VS Code, its forks (Antigravity, Cursor, Kiro, Positron, and Windsurf), and Zed. This repository, [Sight](https://github.com/jbearak/sight), contains the language server, editor extension, and TextMate grammar. The corresponding Zed extension is in [zed-stata](https://github.com/jbearak/zed-stata), and the tree-sitter grammar is in [tree-sitter-stata](https://github.com/jbearak/tree-sitter-stata). Like the language server, the grammar can be used in any editor.

Sight's sister project [Raven](https://github.com/jbearak/raven) implements a language server for R. Together they bring cross-file navigation, error detection, and code intelligence to two languages widely used in social science research.

## Features

### Language Server:
- **Code Completion**: Context-aware completions for commands, options, macros, and variables
- **Diagnostics**: Real-time syntax error detection and undefined macro warnings
- **Go-to-Definition**: Jump to definitions of local/global macros and programs across the workspace
- **Workspace Symbols**: Search for symbols across the entire workspace
- **Cross-file awareness**: Symbol resolution across `do`/`include` chains with position-aware scope
- **Declaration directives**: Suppress diagnostics for dynamically-created symbols (`@lsp-local`, `@lsp-global`)

### Editor Extension:

The editor extension enables language server features and further provides:

- **Run Code**: Execute code in the Stata application or terminal with intelligent statement detection and working directory management
- **Syntax Highlighting**: Rich syntax highlighting with unique features like macro/string nesting depth coloring
- **Quote Auto-Close**: Intelligently handles Stata's unique conventions for nested macros and compound strings

> [!TIP]
> **VS Code:** To install the editor extension in VS Code or any of its forks, like Antigravity, Cursor, Kiro, Positron, and Windsurf:
>
> 1. Download the latest `.vsix` from the [releases page](https://github.com/jbearak/sight/releases)
> 2. In your editor:
>    - Extensions → `...` menu → "Install from VSIX..."
>    - Or via CLI: `code --install-extension sight-<version>.vsix`

> [!NOTE]
> **Zed:** For the Zed extension, see [jbearak/zed-stata](https://github.com/jbearak/zed-stata).

> [!NOTE]
> **Neovim**: See the [Neovim setup guide](docs/neovim-setup.md) for instructions on configuring the language server for diagnostics, the [tree-sitter-stata](https://github.com/jbearak/tree-sitter-stata) for syntax highlighting, and the send-to-stata module.


### Examples

#### Syntax error: else on same line as closing brace
<img width="683" height="390" src="examples/else_on_same_line_as_closing_brace.png"/>

#### Undefined local macro
Stata would evaluate ``"`froot'"`` to ``""`` because of the misspelling. In this example, it affects the displayed text. When combined with if-then-else statements, this leads to unexpected control flow.
<img width="683" height="390" src="examples/undefined_local.png"/>

#### Syntax highlighting
Sight colorizes nesting depth of compound strings and local macros.

<img width="581" height="386" src="examples/nested_locals_within_compound_strings_dark.png"/>
<img width="581" height="386" src="examples/nested_locals_within_compound_strings_light.png"/>

#### Completions

##### Command completion
<img width="615" height="420" src="examples/command_completion.png"/>

##### Option completion
<img width="615" height="420" src="examples/options_completion.png"/>

##### Macro completion
<img width="651" height="449" src="examples/macro_completion.png"/>

##### Variable completion
<img width="696" height="533" src="examples/variable_completion.png"/>

#### Hover
<img width="607" height="546" src="examples/variable_hover.png"/>

#### Go to Definition
Command+click (Mac) or Control+click (Windows) to see symbol definitions across files.
<img width="671" height="386" src="examples/command_click.png"/>

#### Execute Code in Stata
Execute code in Stata directly from the editor.
<img width="641" height="565" src="examples/send_to_stata_menu.png"/>



#### Missing indentation

> **Note:** Indentation diagnostics are disabled by default. See [Configuration > Diagnostics](docs/configuration.md#diagnostics) to enable them.

<img width="" height="345" src="examples/missing_indentation.png"/>



## Installation
### From VSIX

> [!TIP]
> This installation method will work with VS Code and any of its forks (e.g., Antigravity, Cursor, Kiro, Positron, and Windsurf).

1. Download the latest `.vsix` from the [releases page](https://github.com/jbearak/sight/releases)
2. In VS Code:
   - Extensions → `...` menu → "Install from VSIX..."
   - Or via CLI: `code --install-extension sight-client-<version>.vsix`

> **Note:** If you have other extensions installed that provide Stata syntax highlighting (e.g., `stata-enhanced` or `stata-language`), disable them to use Sight's syntax highlighting. Extensions like `stataRun` (which launches Stata from VS Code) can remain enabled.

<!--
### From External Marketplace

**VS Code:**
1. **From VS Code**: Extensions → Search for "jbearak.sight-language-server" → Install
2. **From command line**: `code --install-extension jbearak.sight-language-server`

**OpenVSX (VSCodium, Kiro, Cursor, etc.):**
1. **From editor**: Extensions → Search for "jbearak.sight-language-server" → Install
2. **From web**: Visit [open-vsx.org/extension/jbearak/sight-language-server](https://open-vsx.org/extension/jbearak/sight-language-server)

-->

### Standalone tool

In addition to the extension, you can install the standalone tool to use the LSP directly with other editors (e.g., vim, neovim, and emacs) or in CI/CD. To do this, either [build from source](#build-from-source) or use npm/npx:

Run directly from GitHub without installing:
```bash
npx github:jbearak/sight --stdio
```

Or install globally from GitHub:

```bash
npm install -g github:jbearak/sight
```

After installation, the `sight-language-server` command will be available globally. Use it with:
- **Kiro CLI, OpenCode, Crush**: See [CLI integration](#agent-integration) below
- **Other LSP clients**: Configure to run `sight-language-server --stdio`
- **Manual testing**: Run `sight-language-server --help` to verify installation

### Build from Source

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

> If setup.sh identifies conflicting syntax highlighting extensions, it will ask you what to do (disable/uninstall/do nothing).

Requires [Bun](https://bun.sh) (`brew install bun` or see https://bun.sh).

### Other Editors

Any LSP client that supports stdio transport can use the Sight server:

```bash
sight-language-server --stdio
```

Configure your editor's LSP client to run this command for `.do`, `.ado`, and `.mata` files.

### Agent Integration

#### Kiro CLI

Create `.kiro/settings/lsp.json` in your project:

```json
{
  "languages": {
    "stata": {
      "name": "sight-language-server",
      "command": "sight-language-server",
      "args": ["--stdio"],
      "file_extensions": ["do", "ado", "doh", "mata"],
      "project_patterns": [".sight.json"]
    }
  }
}
```

#### OpenCode

Create an `opencode.json` file in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "stata": {
      "command": ["sight-language-server", "--stdio"],
      "extensions": [".do", ".ado", ".doh", ".mata"]
    }
  }
}
```

#### Crush

Create a `crush.json` file in your project root:

```json
{
  "$schema": "https://charm.land/crush.json",
  "lsp": {
    "stata": {
      "command": "sight-language-server",
      "args": ["--stdio"],
      "extensions": [".do", ".ado", ".doh", ".mata"]
    }
  }
}
```

## Documentation

- [Cross-File Awareness](docs/cross-file.md) - Directives, `do`/`include` detection, scope resolution, working directory
- [Declaration Directives](docs/declaration-directives.md) - `@lsp-local`, `@lsp-global` for dynamically-created symbols
- [Syntax Highlighting](docs/syntax-highlighting.md) - TextMate scopes, nesting depth colors, customization
- [Send to Stata](docs/send-to-stata.md) - Execute code in Stata from VS Code or terminal
- [Quote Auto-Close](docs/quote-auto-close.md) - Intelligent auto-closing for Stata quoting conventions
- [Configuration](docs/configuration.md) - All settings and options
- [Formatting](docs/formatting.md) - Code formatting and comment normalization (experimental)
- [Neovim Setup](docs/neovim-setup.md) - Configure Sight for Neovim

## Development

See [Development Notes](DEVELOPMENT.md) for build instructions, testing, and release process.

## License

Copyright © 2026 Jonathan Marc Bearak
[GPLv3](LICENSE) - This project is open source software. You can use, modify, and distribute it with attribution, but any derivative works must also be open source under GPLv3.

# Sight

Sight is a static analyzer and language server for the Stata statistical programming language. It resolves what's in scope at each line — catching undefined macros and used-before-defined references even in a single script, and across files by following `do`/`run`/`include` chains — without running your code. Sight ships as an extension for [VS Code](https://github.com/Microsoft/vscode), bringing real-time diagnostics and code intelligence to your editor as you type; it also runs as a standalone [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol) server for other editors and headlessly via `sight check` for automated checks in CI.

> **tl;dr**: Sight brings **modern IDE superpowers** to Stata coding. It goes far beyond syntax highlighting, using **semantic analysis** to provide **workspace-wide symbol resolution** and **intelligent macro tracking**. With features like **Go-to-Definition**, **Autocomplete**, and **Real-time Diagnostics** that trace execution through `do` and `include` chains, Sight helps you catch errors *before* you run your code.

> **Status:** Sight is under active development. It works well for day-to-day use but hasn't been widely announced yet. Bug reports and feedback are welcome!

> **Quick Start:** Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jbearak.sight) or [OpenVSX](https://open-vsx.org/extension/jbearak/sight), or download the `.vsix` from the [releases page](https://github.com/jbearak/sight/releases). See [Installation](#installation) for other methods.

Sight's sister project [Raven](https://github.com/jbearak/raven) implements a language server for R. Together they bring cross-file navigation, error detection, and code intelligence to two languages widely used in social science research.

## Features

### Language Server:

- **[Diagnostics](docs/diagnostics.md)**: Real-time syntax error detection and undefined macro warnings
- **[Code Completion](docs/completion.md)**: Context-aware completions for commands, options, macros, and variables
- **Go-to-Definition**: Jump to definitions of local/global macros and programs across the workspace
- **[Find References](docs/find-references.md)**: Locate every use of a macro, program, or variable across related files
- **[Cross-file awareness](docs/cross-file.md)**: Symbol resolution across `do`/`include` chains with position-aware scope
- **[Declaration directives](docs/declaration-directives.md)**: Suppress diagnostics for dynamically-created symbols (`sight: local`, `sight: global`; `@lsp-` remains an alias)
- **[Document Outline](docs/document-outline.md)**: Hierarchical code navigation with programs, macros, variables, and code sections
- **Workspace Symbols**: Search for symbols across the entire workspace

### Editor Extension:

The editor extension enables language server features and further provides:

- **[Run Code](docs/send-to-stata.md)**: Execute code in the Stata application or terminal with intelligent statement detection and working directory management
- **[Syntax Highlighting](docs/syntax-highlighting.md)**: Rich syntax highlighting with unique features like macro/string nesting depth coloring
- **[Auto-Closing Pairs](docs/quote-auto-close.md)**: Intelligently handles Stata's unique conventions for nested macros and compound strings
- **[Data Browser](docs/data-browser.md)**: Open `.dta` files directly in VS Code, or call `vview` from Stata to send the current dataset to the editor — features a virtualized grid with column resizing/hiding and value labels. In console Stata, `browse` (and its abbreviations `brows`/`brow`/`bro`/`br`) works as an alias for `vview` (the GUI's built-in `browse` is unaffected)
- **[Log Viewer](docs/log-viewer.md)**: Render Stata log files (`.smcl`) with formatted output directly in VS Code
- **[Help Viewer](docs/help-viewer.md)**: Read Stata help files (`.sthlp`) directly in VS Code with clickable help-topic links
- **[Code Formatting](docs/formatting.md)** (experimental): Format `.do` files and normalize comment styles

## Documentation

### Guides

- [Configuration](docs/configuration.md) - All settings and options
- [CLI](docs/cli.md) - `sight check` for CI and command-line diagnostics
- [Standalone Installation](docs/standalone-installation.md) - CLI usage, release binary, build from source
- [Editor Integrations](docs/editor-integrations.md) - Generic LSP clients, AI agents
- [Neovim Setup](docs/neovim-setup.md) - Configure Sight for Neovim

Per-feature reference pages live in [`docs/`](docs) and are linked from
most entries in [Features](#features) above.

### Examples

#### Undefined local macro

Stata would evaluate `` `froot' `` to `""` because of the misspelling. In this example, it affects the displayed text. When combined with if-then-else statements, this leads to unexpected control flow.
<img width="683" height="390" alt="Undefined local macro diagnostic" src="examples/undefined_local.png"/>

#### Command completion
<img width="615" height="420" alt="Command completion popup" src="examples/command_completion.png"/>

#### Syntax highlighting

Sight colorizes nesting depth of compound strings and local macros.

<img width="581" height="386" alt="Syntax highlighting with nesting depth colors (dark theme)" src="examples/nested_locals_within_compound_strings_dark.png"/>
<img width="581" height="386" alt="Syntax highlighting with nesting depth colors (light theme)" src="examples/nested_locals_within_compound_strings_light.png"/>

#### Send to Stata

Execute code in Stata directly from the editor.
<img width="641" height="565" alt="Send to Stata menu" src="examples/send_to_stata_menu.png"/>

> See the [Examples Gallery](docs/examples.md) for more screenshots.

## Installation

### From Extension Registry

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jbearak.sight)
- [OpenVSX Registry](https://open-vsx.org/extension/jbearak/sight)

### From VSIX

1. Download the latest `.vsix` from the [releases page](https://github.com/jbearak/sight/releases)
2. In VS Code:
  - Extensions → `...` menu → "Install from VSIX..."
  - Or via CLI: `code --install-extension sight-<version>.vsix`

> **Note:** If you have other extensions installed that provide Stata syntax highlighting (e.g., `stata-enhanced` or `stata-language`), disable them to use Sight's syntax highlighting.

### From npm

For command-line use or editors that connect to an external LSP server:

```bash
npm install -g @jbearak/sight
sight --help
```

### From Homebrew (macOS, Apple Silicon)

```bash
brew install jbearak/sight/sight
sight --help
```

Installs the prebuilt `sight` CLI from the
[`jbearak/sight`](https://github.com/jbearak/homebrew-sight) tap. Apple Silicon
macOS only.

### Other Methods

- **Standalone CLI / Build from Source**: See [Standalone Installation](docs/standalone-installation.md)
- **Other Editors & AI Agents**: See [Editor Integrations](docs/editor-integrations.md)
- **Neovim**: See [Neovim Setup Guide](docs/neovim-setup.md)

## Development

See [Development Notes](DEVELOPMENT.md) for build instructions, testing, and release process.

## License

Copyright © 2026 Jonathan Marc Bearak
[GPLv3](LICENSE) - This project is open source software. You can use, modify, and distribute it with attribution, but any derivative works must also be open source under GPLv3.

# Sight - Language Server for Stata

An open source [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol) implementation for the Stata statistical programming language, with a corresponding extension for [VS Code](https://github.com/Microsoft/vscode).

> **tl;dr**: Sight brings **modern IDE superpowers** to Stata coding. It goes far beyond syntax highlighting, using **semantic analysis** to provide **workspace-wide symbol resolution** and **intelligent macro tracking**. With features like **Go-to-Definition**, **Autocomplete**, and **Real-time Diagnostics** that trace execution through `do` and `include` chains, Sight helps you catch errors *before* you run your code.

> **Development Status:** Sight is an early-stage implementation. While functional, it requires substantial testing and code review. Contributions and feedback are welcome!

> **Quick Start:** Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jbearak.sight) or [OpenVSX](https://open-vsx.org/extension/jbearak/sight), or download the `.vsix` from the [releases page](https://github.com/jbearak/sight/releases). See [Installation](#installation) for other methods.

Sight provides Stata language support for VS Code, its forks (Antigravity, Cursor, Kiro, Positron, and Windsurf), and Zed. This repository, [Sight](https://github.com/jbearak/sight), contains the language server, editor extension, and TextMate grammar. The corresponding Zed extension is in [zed-stata](https://github.com/jbearak/zed-stata), and the tree-sitter grammar is in [tree-sitter-stata](https://github.com/jbearak/tree-sitter-stata). Like the language server, the grammar can be used in any editor.

Sight's sister project [Raven](https://github.com/jbearak/raven) implements a language server for R. Together they bring cross-file navigation, error detection, and code intelligence to two languages widely used in social science research.

## Features

### Language Server:

- **Diagnostics**: Real-time syntax error detection and undefined macro warnings
- **Code Completion**: Context-aware completions for commands, options, macros, and variables
- **Go-to-Definition**: Jump to definitions of local/global macros and programs across the workspace
- **Find References**: Locate every use of a macro, program, or variable across related files
- **Cross-file awareness**: Symbol resolution across `do`/`include` chains with position-aware scope
- **Declaration directives**: Suppress diagnostics for dynamically-created symbols (`@lsp-local`, `@lsp-global`)
- **Document Outline**: Hierarchical code navigation with programs, macros, variables, and code sections
- **Workspace Symbols**: Search for symbols across the entire workspace

### Editor Extension:

The editor extension enables language server features and further provides:

- **Run Code**: Execute code in the Stata application or terminal with intelligent statement detection and working directory management
- **Syntax Highlighting**: Rich syntax highlighting with unique features like macro/string nesting depth coloring
- **Auto-Closing Pairs**: Intelligently handles Stata's unique conventions for nested macros and compound strings
- **Data Browser**: Open `.dta` files directly in VS Code, or call `vview` from Stata to send the current dataset to the editor — features a virtualized grid with column resizing/hiding and value labels
- **Log Viewer**: Render Stata log files (`.smcl`) with formatted output directly in VS Code
- **Help Viewer**: Read Stata help files (`.sthlp`) directly in VS Code with clickable help-topic links

## Documentation

### Guides

- [Configuration](docs/configuration.md) - All settings and options
- [Standalone Installation](docs/standalone-installation.md) - CLI usage, npm/npx, build from source
- [Editor Integrations](docs/editor-integrations.md) - Generic LSP clients, AI agents
- [Neovim Setup](docs/neovim-setup.md) - Configure Sight for Neovim

### Features

- [Diagnostics](docs/diagnostics.md) - Real-time error detection, scoping rules, suppression directives
- [Data Browser](docs/data-browser.md) - Browse datasets in VS Code with the `vview` command
- [Log Viewer](docs/log-viewer.md) - Render Stata `.smcl` log files in VS Code
- [Help Viewer](docs/help-viewer.md) - Read Stata `.sthlp` help files in VS Code
- [Document Outline](docs/document-outline.md) - Hierarchical code navigation with sections, programs, and macros
- [Cross-File Awareness](docs/cross-file.md) - Workspace indexing, directives, scope resolution
- [Declaration Directives](docs/declaration-directives.md) - `@lsp-local`, `@lsp-global` for dynamically-created symbols
- [Send to Stata](docs/send-to-stata.md) - Execute code in Stata from VS Code or terminal
- [Quote Auto-Close](docs/quote-auto-close.md) - Intelligent auto-closing for Stata quoting conventions
- [Formatting](docs/formatting.md) - Code formatting and comment normalization (experimental)
- [Syntax Highlighting](docs/syntax-highlighting.md) - TextMate scopes, nesting depth colors

### Examples

#### Undefined local macro

Stata would evaluate `` `froot' `` to `""` because of the misspelling. In this example, it affects the displayed text. When combined with if-then-else statements, this leads to unexpected control flow.
<img width="683" height="390" src="examples/undefined_local.png"/>

#### Command completion
<img width="615" height="420" src="examples/command_completion.png"/>

#### Syntax highlighting

Sight colorizes nesting depth of compound strings and local macros.

<img width="581" height="386" src="examples/nested_locals_within_compound_strings_dark.png"/>
<img width="581" height="386" src="examples/nested_locals_within_compound_strings_light.png"/>

#### Send to Stata

Execute code in Stata directly from the editor.
<img width="641" height="565" src="examples/send_to_stata_menu.png"/>

> See the [Examples Gallery](docs/examples.md) for more screenshots.

## Installation

### From Extension Registry

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jbearak.sight)
- [OpenVSX Registry](https://open-vsx.org/extension/jbearak/sight)

### From VSIX

1. Download the latest `.vsix` from the [releases page](https://github.com/jbearak/sight/releases)
2. In VS Code:
  - Extensions → `...` menu → "Install from VSIX..."
  - Or via CLI: `code --install-extension sight-client-<version>.vsix`

> **Note:** If you have other extensions installed that provide Stata syntax highlighting (e.g., `stata-enhanced` or `stata-language`), disable them to use Sight's syntax highlighting. Extensions like `stataRun` (which launches Stata from VS Code) can remain enabled.

### Other Methods

- **Standalone CLI / Build from Source**: See [Standalone Installation](docs/standalone-installation.md)
- **Other Editors & AI Agents**: See [Editor Integrations](docs/editor-integrations.md)
- **Neovim**: See [Neovim Setup Guide](docs/neovim-setup.md)

## Development

See [Development Notes](DEVELOPMENT.md) for build instructions, testing, and release process.

## License

Copyright © 2026 Jonathan Marc Bearak
[GPLv3](LICENSE) - This project is open source software. You can use, modify, and distribute it with attribution, but any derivative works must also be open source under GPLv3.

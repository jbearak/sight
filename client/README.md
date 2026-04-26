# Sight - Comprehensive Stata Language Support

Comprehensive language support for Stata: real-time diagnostics, completions, go-to-definition, find references, run code in Stata, syntax highlighting with nesting depth colors, code formatting, cross-file symbol resolution, and built-in viewers for datasets, logs, and help files.

## Features

- **[Real-time Diagnostics](https://github.com/jbearak/sight/blob/main/docs/diagnostics.md)**: Catch undefined macros and other issues as you type
- **[Intelligent Completions](https://github.com/jbearak/sight/blob/main/docs/completion.md)**: Context-aware completions for commands, options, macros, and variables
- **Go-to-Definition**: Jump to definitions of local/global macros and programs across the workspace
- **[Find References](https://github.com/jbearak/sight/blob/main/docs/find-references.md)**: Locate every use of a macro, program, or variable across related files
- **[Run Code in Stata](https://github.com/jbearak/sight/blob/main/docs/send-to-stata.md)**: Execute code in the Stata application or terminal with intelligent statement detection and working directory management
- **[Syntax Highlighting](https://github.com/jbearak/sight/blob/main/docs/syntax-highlighting.md)**: Rich highlighting with nesting depth colors for compound strings and nested macros
- **[Auto-Closing Pairs](https://github.com/jbearak/sight/blob/main/docs/quote-auto-close.md)**: Intelligently handles Stata's unique conventions for nested macros and compound strings
- **[Cross-File Awareness](https://github.com/jbearak/sight/blob/main/docs/cross-file.md)**: Symbol resolution across `do`/`run`/`include` chains with position-aware scope. Works automatically for most projects; some edge cases (e.g., dynamic macro paths or files outside the workspace) require manual configuration.
- **[Declaration Directives](https://github.com/jbearak/sight/blob/main/docs/declaration-directives.md)**: Suppress diagnostics for dynamically-created symbols (`@lsp-local`, `@lsp-global`)
- **[Document Outline](https://github.com/jbearak/sight/blob/main/docs/document-outline.md)**: Hierarchical code navigation with programs, macros, variables, and code sections
- **Workspace Symbols**: Search for symbols across the entire workspace
- **[Data Browser](https://github.com/jbearak/sight/blob/main/docs/data-browser.md)**: Open `.dta` files directly in VS Code, or call `vview` from Stata to send the current dataset to the editor — features a virtualized grid with column resizing/hiding and value labels
- **[Log Viewer](https://github.com/jbearak/sight/blob/main/docs/log-viewer.md)**: Render Stata `.smcl` log files with formatted output directly in VS Code
- **[Help Viewer](https://github.com/jbearak/sight/blob/main/docs/help-viewer.md)**: Read Stata `.sthlp` help files directly in VS Code with clickable help-topic links

## Screenshots

<details>
<summary>Real-time diagnostics</summary>

<img width="683" height="390" alt="Undefined local macro diagnostic" src="https://github.com/jbearak/sight/blob/main/examples/undefined_local.png?raw=true"/>
</details>

<details>
<summary>Intelligent completions</summary>

<img width="615" height="420" alt="Command completion popup" src="https://github.com/jbearak/sight/blob/main/examples/command_completion.png?raw=true"/>

<img width="651" height="449" alt="Macro completion popup" src="https://github.com/jbearak/sight/blob/main/examples/macro_completion.png?raw=true"/>
</details>

<details>
<summary>Run code in Stata</summary>

<img width="641" height="565" alt="Send to Stata menu" src="https://github.com/jbearak/sight/blob/main/examples/send_to_stata_menu.png?raw=true"/>
</details>

<details>
<summary>Syntax highlighting with nesting depth colors</summary>

<img width="581" height="386" alt="Syntax highlighting with nesting depth colors" src="https://github.com/jbearak/sight/blob/main/examples/nested_locals_within_compound_strings_dark.png?raw=true"/>
</details>

## Installation

Search for "Sight" in the extension marketplace and click Install, or download the extension from [Releases](https://github.com/jbearak/sight/releases).

## Documentation

For full documentation, configuration options, and LSP directives, see the [full documentation on GitHub](https://github.com/jbearak/sight#readme).

## License

Copyright (c) 2026 Jonathan Marc Bearak. Licensed under GPLv3.

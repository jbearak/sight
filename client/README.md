# Sight - Comprehensive Stata Language Support

Comprehensive language support for Stata: real-time diagnostics, completions, go-to-definition, find references, code formatting, syntax highlighting with nesting depth colors, cross-file symbol resolution, and integrated code execution.

## Features

### Language Server

- **Real-time Diagnostics**: Catch undefined macros and other issues as you type

  <img width="683" height="390" src="https://github.com/jbearak/sight/blob/main/examples/undefined_local.png?raw=true"/>

- **Intelligent Completions**: Context-aware completions for commands, options, macros, and variables

  <img width="615" height="420" src="https://github.com/jbearak/sight/blob/main/examples/command_completion.png?raw=true"/>

  <img width="651" height="449" src="https://github.com/jbearak/sight/blob/main/examples/macro_completion.png?raw=true"/>

- **Go-to-Definition**: Jump to definitions of local/global macros and programs across the workspace
- **Find References**: Locate every use of a macro, program, or variable across related files
- **Cross-File Awareness**: Symbol resolution across `do`/`run`/`include` chains with position-aware scope. Works automatically for most projects; some edge cases (e.g., dynamic macro paths or files outside the workspace) require manual configuration — see [Cross-File Awareness](https://github.com/jbearak/sight/blob/main/docs/cross-file.md).
- **Declaration Directives**: Suppress diagnostics for dynamically-created symbols (`@lsp-local`, `@lsp-global`)
- **Document Outline**: Hierarchical code navigation with programs, macros, variables, and code sections
- **Workspace Symbols**: Search for symbols across the entire workspace

### Editor Extension

- **Run Code in Stata**: Execute code in the Stata application or terminal with intelligent statement detection and working directory management

  <img width="641" height="565" src="https://github.com/jbearak/sight/blob/main/examples/send_to_stata_menu.png?raw=true"/>

- **Syntax Highlighting**: Rich highlighting with nesting depth colors for compound strings and nested macros

  <img width="581" height="386" src="https://github.com/jbearak/sight/blob/main/examples/nested_locals_within_compound_strings_dark.png?raw=true"/>

- **Auto-Closing Pairs**: Intelligently handles Stata's unique conventions for nested macros and compound strings
- **Data Browser**: Open `.dta` files directly in VS Code, or call `vview` from Stata to send the current dataset to the editor — features a virtualized grid with column resizing/hiding and value labels
- **Log Viewer**: Render Stata `.smcl` log files with formatted output directly in VS Code
- **Help Viewer**: Read Stata `.sthlp` help files directly in VS Code with clickable help-topic links

## Installation

Search for "Sight" in the extension marketplace and click Install, or download the extension from [Releases](https://github.com/jbearak/sight/releases).

## Documentation

For full documentation, configuration options, and LSP directives, see the [full documentation on GitHub](https://github.com/jbearak/sight#readme).

## License

Copyright (c) 2026 Jonathan Marc Bearak. Licensed under GPLv3.

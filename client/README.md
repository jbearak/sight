# Sight - Comprehensive Stata Language Support

Comprehensive language support for Stata: real-time diagnostics, completions, go-to-definition, code formatting, syntax highlighting with nesting depth colors, cross-file symbol resolution, and integrated code execution.

## Features

### Intelligent Completions

Context-aware completions for commands, options, macros, and variables.

<img width="615" height="420" src="https://github.com/jbearak/sight/blob/main/examples/command_completion.png?raw=true"/>

<img width="651" height="449" src="https://github.com/jbearak/sight/blob/main/examples/macro_completion.png?raw=true"/>

### Real-time Diagnostics

Catch undefined macros and other issues as you type.

<img width="683" height="390" src="https://github.com/jbearak/sight/blob/main/examples/undefined_local.png?raw=true"/>

### Go-to-Definition

Cmd/Ctrl+click to jump to macro and program definitions.

<img width="671" height="386" src="https://github.com/jbearak/sight/blob/main/examples/command_click.png?raw=true"/>

### Syntax Highlighting

Rich highlighting with nesting depth colors for compound strings and nested macros.

<img width="581" height="386" src="https://github.com/jbearak/sight/blob/main/examples/nested_locals_within_compound_strings_dark.png?raw=true"/>

### Cross-File Awareness

Automatically resolves symbols across files — globals, programs, scalars, and variables defined in parent files are inherited by child files via `do`, `run`, and `include` commands. No configuration or directives needed.

### Run Code in Stata

Execute code in Stata directly from the editor.

<img width="641" height="565" src="https://github.com/jbearak/sight/blob/main/examples/send_to_stata_menu.png?raw=true"/>

## Installation

Search for "Sight" in the extension marketplace and click Install, or download the extension from [Releases](https://github.com/jbearak/sight/releases).

## Documentation

For full documentation, configuration options, and LSP directives, see the [full documentation on GitHub](https://github.com/jbearak/sight#readme).

## License

Copyright (c) 2026 Jonathan Marc Bearak. Licensed under GPLv3.

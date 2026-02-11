# Sight - Language Server for Stata

An open source [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol) implementation for the Stata statistical programming language, with a corresponding extension for [VS Code](https://github.com/Microsoft/vscode).

> **tl;dr**: Sight brings **modern IDE superpowers** to Stata coding. It goes far beyond syntax highlighting, using **semantic analysis** to provide **workspace-wide symbol resolution** and **intelligent macro tracking**. With features like **Go-to-Definition**, **Autocomplete**, and **Real-time Diagnostics** that trace execution through `do` and `include` chains, Sight helps you catch errors *before* you run your code.

> **⚠️ Development Status:** Sight is an early-stage implementation. While functional, it requires substantial testing and code review. Contributions and feedback are welcome!

> **🚀 Quick Start:** Download from the [releases page](https://github.com/jbearak/sight/releases), or clone the repo and run `./setup.sh` to build from source. See [Installation](#installation) for details.

Sight provides Stata language support for VS Code, its forks (Antigravity, Cursor, Kiro, Positron, and Windsurf), and Zed. This repository, [Sight](https://github.com/jbearak/sight), contains the language server, editor extension, and TextMate grammar. The corresponding Zed extension is in [zed-stata](https://github.com/jbearak/zed-stata), and the tree-sitter grammar is in [tree-sitter-stata](https://github.com/jbearak/tree-sitter-stata). Like the language server, the grammar can be used in any editor.

## Features

### Language Server:
- **Code Completion**: Context-aware completions for commands, options, macros, and variables.
- **Diagnostics**: Real-time syntax error detection and undefined macro warnings.
- **Go-to-Definition**: Jump to definitions of local/global macros and programs across the workspace.
- **Workspace Symbols**: Search for symbols across the entire workspace.

### Editor Extension:

The editor extension enables language server features and further provides:

- **Run Code**: Execute code in the Stata application or terminal with intelligent statement detection and working directory management. See [Send to Stata](#send-to-stata) for details.
- **Syntax Highlighting**: Rich syntax highlighting with unique features like macro/string nesting depth coloring.
- **Quote Auto-Close**: Intelligently handles Stata's unique conventions for nested macros and compound strings.

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

> **Note:** Indentation diagnostics are disabled by default. See [Configuration > Diagnostics](#diagnostics) to enable them.

<img width="" height="345" src="examples/missing_indentation.png"/>



## Syntax Highlighting

The LSP provides comprehensive syntax highlighting through TextMate grammar scopes. These scopes enable precise theming and editor features.

### Core Language Elements

| Element               | Scope                                         | Description                                     |
| --------------------- | --------------------------------------------- | ----------------------------------------------- |
| **Comments**          | `comment.block.stata`                         | Block comments (`/* */`)                        |
|                       | `comment.line.star.stata`                     | Star comments (`*`)                             |
|                       | `comment.line.double-slash.stata`             | Double-slash comments (`//`)                    |
|                       | `comment.line.triple-slash.stata`             | Triple-slash continuation (`///`)               |
| **Strings**           | `string.quoted.double.stata`                  | Double-quoted strings                           |
|                       | `string.quoted.compound.depth[1-6].stata`     | Compound strings with nesting                   |
| **Macros**            | `variable.other.macro.global.stata`           | Global macros (`$name`)                         |
|                       | `variable.other.macro.local.depth[1-6].stata` | Local macros with nesting                       |
| **Macro Definitions** | `variable.other.local.stata`                  | Local macro names at definition (`local foo`)   |
|                       | `variable.other.global.stata`                 | Global macro names at definition (`global bar`) |

### Keywords and Commands

| Category           | Scope                               | Examples                                                |
| ------------------ | ----------------------------------- | ------------------------------------------------------- |
| **Control Flow**   | `keyword.control.conditional.stata` | `if`, `else`                                            |
|                    | `keyword.control.flow.stata`        | `foreach`, `forvalues`, `while`, `do`, `run`, `include` |
|                    | `keyword.control.prefix.stata`      | `by`, `quietly`, `capture`                              |
| **Commands**       | `keyword.functions.data.stata`      | `gen`, `replace`, `use`, `save`                         |
|                    | `keyword.other.command.stata`       | `display`, `list`, `tab`                                |
|                    | `keyword.other.command.addon.stata` | `reghdfe`, `estout`                                     |
| **Macro Commands** | `keyword.macro.stata`               | `local`, `global`, `tempvar`, `tempname`, `tempfile`    |
|                    | `keyword.macro.extendedfcn.stata`   | Extended functions                                      |

### Data Types and Built-ins

| Element                | Scope                             | Examples                                                           |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| **Functions**          | `support.function.builtin.stata`  | Built-in functions                                                 |
| **Data Types**         | `support.type.stata`              | `byte`, `int`, `long`, `float`, `double`, `str1`-`str2045`, `strL` |
| **Built-in Variables** | `variable.language.stata`         | `_n`, `_N`, `_b`, `_coef`, `_cons`, `_rc`, `_se`                   |
| **Missing Values**     | `constant.language.missing.stata` | `.`, `.a`-`.z`                                                     |

### Operators and Programs

| Element       | Scope                               | Examples             |
| ------------- | ----------------------------------- | -------------------- |
| **Operators** | `keyword.operator.arithmetic.stata` | `+`, `-`, `*`, `/`   |
|               | `keyword.operator.comparison.stata` | `==`, `!=`, `<`, `>` |
|               | `keyword.operator.logical.stata`    | `&`, `               | `, `!` |
|               | `keyword.operator.assignment.stata` | `=`                  |
| **Programs**  | `storage.type.function.stata`       | `program` keyword    |
|               | `entity.name.function.stata`        | Program names        |

### Mata Blocks

| Element           | Scope                            | Description            |
| ----------------- | -------------------------------- | ---------------------- |
| **Mata Context**  | `meta.embedded.block.mata.stata` | Entire Mata block      |
| **Mata Keywords** | `keyword.control.mata.stata`     | Mata-specific keywords |
| **Mata Types**    | `support.type.mata.stata`        | Mata data types        |

### Nesting Depth Feature

The grammar supports **6 levels of nesting depth** for compound strings and local macros, cycling through depth1-depth6:

```stata
local outer "Level 1 `inner' text"           // depth1
local inner "Level 2 `deeper' text"          // depth2  
local deeper "Level 3 `deepest' text"        // depth3
// ... continues through depth6, then cycles back to depth1
```

This enables editors to apply distinct styling to each nesting level, improving readability of complex macro expansions.

#### Automatic Color Configuration

On first activation, the extension automatically adds colors for each nesting depth to your VS Code settings. These colors work with **all VS Code themes**, including:

- Themes with "Dark" or "Light" in their names (e.g., "Dark+", "Light+")
- Themes without these keywords (e.g., "Monokai", "Dracula", "Nord", "Solarized")

The extension detects your current theme type (dark or light) and applies appropriate colors automatically. When you switch themes, the colors update to match.

> VS Code's architecture requires `editor.tokenColorCustomizations` to be present in your settings file for custom syntax scopes to have colors. Extensions cannot provide default colors for custom scopes through their manifest - the colors must exist in `settings.json` or all nesting levels would appear identical.

You can customize these colors by opening your VS Code settings and modifying the `editor.tokenColorCustomizations` section.

To reset depth colors to defaults, use the command palette: **Sight: Reset Depth Colors**

#### Default Nesting Colors

**String Depth Colors** (warm progression):

| Depth | Scope                                 | Dark Theme               | Light Theme              |
| ----- | ------------------------------------- | ------------------------ | ------------------------ |
| 1     | `string.quoted.compound.depth1.stata` | `#CE9178` (orange)       | `#A31515` (dark red)     |
| 2     | `string.quoted.compound.depth2.stata` | `#D4A373` (light orange) | `#986801` (brown)        |
| 3     | `string.quoted.compound.depth3.stata` | `#DCDCAA` (gold)         | `#6B8E23` (olive)        |
| 4     | `string.quoted.compound.depth4.stata` | `#B5CEA8` (yellow-green) | `#2E8B57` (forest green) |
| 5     | `string.quoted.compound.depth5.stata` | `#A8D4A8` (light green)  | `#008B8B` (teal)         |
| 6     | `string.quoted.compound.depth6.stata` | `#8ECDC8` (teal)         | `#4682B4` (steel blue)   |

**Macro Depth Colors** (cool progression):

| Depth | Scope                                     | Dark Theme               | Light Theme             |
| ----- | ----------------------------------------- | ------------------------ | ----------------------- |
| 1     | `variable.other.macro.local.depth1.stata` | `#9CDCFE` (light blue)   | `#001080` (dark blue)   |
| 2     | `variable.other.macro.local.depth2.stata` | `#7DCFEA` (sky blue)     | `#0000CD` (navy)        |
| 3     | `variable.other.macro.local.depth3.stata` | `#6DD4D4` (cyan)         | `#4169E1` (royal blue)  |
| 4     | `variable.other.macro.local.depth4.stata` | `#5DC9B0` (teal)         | `#6A5ACD` (slate blue)  |
| 5     | `variable.other.macro.local.depth5.stata` | `#B4A7D6` (light purple) | `#8A2BE2` (blue violet) |
| 6     | `variable.other.macro.local.depth6.stata` | `#C9A7DE` (lavender)     | `#9932CC` (dark orchid) |

#### Customizing Nesting Colors

You can override the default colors in your VS Code settings. The extension automatically detects your theme type and applies colors to the current theme. To customize colors for specific themes, you can use theme selectors:

```json
{
  "editor.tokenColorCustomizations": {
    "[Monokai]": {
      "textMateRules": [
        {
          "scope": "string.quoted.compound.depth1.stata",
          "settings": { "foreground": "#FFD700" }
        },
        {
          "scope": "variable.other.macro.local.depth1.stata",
          "settings": { "foreground": "#87CEEB" }
        }
      ]
    },
    "[*Dark*]": {
      "textMateRules": [
        {
          "scope": "string.quoted.compound.depth1.stata",
          "settings": { "foreground": "#CE9178" }
        }
      ]
    },
    "[*Light*]": {
      "textMateRules": [
        {
          "scope": "string.quoted.compound.depth1.stata",
          "settings": { "foreground": "#B22222" }
        }
      ]
    }
  }
}
```

To match your theme's bracket pair colors, find your theme's bracket colors (`editorBracketHighlight.foreground1` through `foreground6`) and apply them to the depth scopes.

## What the LSP reads (open files vs workspace)

When you open a Stata file in VS Code, there are two separate mechanisms at work:

### 1) Open files (what you have in editor tabs)

For every Stata file that is currently *open* in the editor, the LSP receives the full text via the LSP protocol (`didOpen` / `didChange`). It then lexes/parses/analyzes that document and keeps an in-memory cache of the parsed state for *open documents*.

This open-document cache is used for features that are inherently document-centric (diagnostics, formatting, document symbols, etc.). Closing a tab removes that document from the open-document cache.

### 2) Workspace indexing (files on disk)

Independently of which files are open, the LSP can also **scan your workspace folders on disk** and build a workspace symbol index. This is enabled by default via the VS Code setting `sight.indexWorkspace: true`. If you are using a workspace `.sight.json`, cross-file indexing is controlled separately via `crossFile.indexWorkspace`.

At startup (after the server is initialized), the indexer recursively scans the workspace folders for Stata-related files and reads them from disk to extract symbols. This index is used for cross-file features like workspace-wide symbol search and go-to-definition across files.

The indexer is *best-effort* and intentionally bounded:
- It skips files larger than `sight.indexing.maxFileSizeBytes` (default ~500KB)
- It stops after `crossFile.maxIndexedFiles` (default 1000)
- It updates the index when files change on disk (via the VS Code file watcher)

### Cross-file scope resolution via directives

Cross-file *scope* (which symbols are considered “in scope” at a particular point in a file) is handled by the **directive-based scope resolver**.

If an open file contains `@lsp-done-by` and/or `@lsp-included-by` directives in its header, the scope resolver will read the referenced parent file(s) from disk (even if they are not open) and **recursively follow directives** to build a scope chain. Results are cached and invalidated when relevant files change.

Importantly, your editor tab state does not change the *meaning* of the analysis for a file: what you see for a given file is determined by that file’s contents plus any files it references via directives (and, separately, whatever symbols exist in the workspace index). Opening or closing unrelated tabs may affect performance/caching, but should not change results for the file you are viewing.

## Cross-File Awareness

The LSP provides cross-file symbol awareness through comment directives that inform the analyzer about symbols defined in other files.

### Directives

Use these comment directives to declare which files call the current file (cross-file scope awareness).

**Recommended (spec) syntax:**

- `@lsp-done-by: "<path>"` - Parent file calls this file via `do` (inherits globals, scalars, matrices, programs; **not** locals)
- `@lsp-run-by: "<path>"` - Synonym for `@lsp-done-by`; use when the parent calls this file via `run` instead of `do`
- `@lsp-included-by: "<path>"` - Parent file calls this file via `include` (inherits locals, globals, scalars, matrices, programs)

Notes:
- Directives are only read from the **top of the file** (header). Parsing stops at the first line that is not a comment and not blank after trimming whitespace (so whitespace-only lines still count as blank).
- The parser also accepts an alternative form without the colon and/or without quotes (e.g. `// @lsp-done-by parent.do`), but the spec form above is preferred.
- `@lsp-run-by` and `@lsp-done-by` are functionally identical; use whichever matches the actual Stata command (`run` vs `do`) for semantic clarity.

### Forward Scope Resolution

In addition to backward directives, the LSP can follow `do`, `run`, and `include` commands to inherit symbols from called files.

**Forward Call Directives:**

- `@lsp-do: "path.do"` - Follow a do command to inherit symbols (excludes locals)
- `@lsp-run: "path.do"` - Follow a run command to inherit symbols (excludes locals)
- `@lsp-include: "path.do"` - Follow an include command to inherit all symbols including locals

**Automatic Detection:**

The LSP also automatically detects `do`, `run`, and `include` commands in your code and follows them for scope resolution. Paths containing macro references (e.g., ``do "`path'/file.do"``) are not followed.

**Inheritance Rules:**

- `do` and `run`: Inherit programs, globals, scalars, matrices, and variables (NOT local macros)
- `include`: Inherit all symbols including local macros

**Scope Visibility:**

Forward-resolved symbols become visible only after the call site where they are defined. Backward directives (`@lsp-done-by`/`@lsp-included-by`) are resolved first, then forward calls are processed in execution order. Current file symbols always override inherited ones.

**Diagnostics:**

- Exceeding `maxBackwardDepth` emits a diagnostic about backward directive chain depth
- Exceeding `maxForwardDepth` emits a diagnostic about forward resolution depth  
- Exceeding `maxChainDepth` emits a diagnostic about combined resolution depth
- Cycles in forward resolution are detected and emit a warning

**Configuration:**

| Option                        | Type   | Default | Description                                            |
| ----------------------------- | ------ | ------- | ------------------------------------------------------ |
| `crossFile.maxBackwardDepth`  | number | `10`    | Maximum depth for backward directive chains            |
| `crossFile.maxForwardDepth`   | number | `10`    | Maximum recursion depth for forward scope resolution   |
| `crossFile.maxChainDepth`     | number | `20`    | Maximum combined depth for forward + backward resolution |

### Working Directory

By default, the LSP resolves relative paths in `do`, `run`, and `include` commands relative to the script's containing directory. However, Stata scripts are often executed from a different working directory than where they reside. The `@lsp-working-directory` directive allows you to specify this working directory context.

**Directive Syntax:**

```stata
// @lsp-working-directory: "/path/to/working/dir"
```

**Synonym Forms:**

All of the following are equivalent:
- `@lsp-working-directory`
- `@lsp-working-dir`
- `@lsp-current-directory`
- `@lsp-current-dir`
- `@lsp-cd`
- `@lsp-wd`

**Path Resolution:**

- Paths starting with `/` are treated as **workspace-root-relative** (e.g. `/data/load.do` resolves to `<workspaceRoot>/data/load.do`). This is *not* a filesystem-absolute path.
- Other paths are resolved relative to the **script's containing directory**

**Limitations:**
- Filesystem-absolute paths (e.g. `/Users/alice/project/file.do`) are not currently supported by `@lsp-working-directory` because leading `/` is reserved for workspace-root-relative paths.

**Examples:**

```stata
// Script in /project/scripts/analysis.do
// Executed from /project (workspace root)

// @lsp-working-directory: "/"
// Paths in do/run/include resolve relative to /project

do "data/load_data.do"  // Resolves to /project/data/load_data.do
```

```stata
// Script in /project/scripts/analysis.do
// Executed from /project/data

// @lsp-working-directory: "../data"
// Paths resolve relative to /project/data

do "clean.do"  // Resolves to /project/data/clean.do
```

**Fallback Behavior:**

When no `@lsp-working-directory` directive is present:
1. The LSP first tries to resolve paths relative to the script's containing directory
2. If the file is not found, it tries resolving relative to the workspace root
3. If still not found, an informational diagnostic suggests adding a working directory directive

**Important Notes:**

- The directive must appear in the file **header** (before any non-comment, non-blank code)
- If multiple working directory directives are present, the **last one** is used (with a warning)
- The directive only affects path resolution for `do`, `run`, and `include` **commands in Stata code**
- Other `@lsp-*` directives (`@lsp-do`, `@lsp-run`, `@lsp-include`, `@lsp-done-by`, `@lsp-included-by`) always resolve paths relative to the script's containing directory, unaffected by the working directory directive

**Common Use Case:**

Many Stata projects have a structure like:
```
project/
├── main.do           # Run from project root
├── scripts/
│   ├── analysis.do   # Called via: do "scripts/analysis.do"
│   └── helpers.do
└── data/
    └── load.do
```

When `analysis.do` calls `do "../data/load.do"`, the path is relative to `scripts/`. But if you want paths to resolve as if running from the project root:

```stata
// scripts/analysis.do
// @lsp-working-directory: "/"
do "data/load.do"  // Resolves to /project/data/load.do
```

**Working Directory Inheritance:**

When a file uses backward directives (`@lsp-done-by`, `@lsp-run-by`, or `@lsp-included-by`) to declare a parent file, it can automatically inherit the working directory from that parent file. This eliminates the need to redundantly specify both the backward directive and a working directory directive when the parent already establishes the working directory context.

**Inheritance Rules:**

- If a child file has a backward directive but **no own** working directory directive, it inherits the working directory from its parent file
- If a child file has its **own** working directory directive, it takes precedence over any inherited working directory
- When multiple parent files have working directory directives, the **nearest parent** (smallest depth in the directive chain) wins
- The inherited working directory is resolved relative to the **parent file's** containing directory, not the child's

**Example:**

```
project/
├── scripts/
│   ├── loop.do       # Has @lsp-cd: "../" (sets working directory to project/)
│   └── dhs/
│       └── survey.do # Has @lsp-done-by: "../loop.do" (inherits working directory)
└── data/
    └── load_data.do
```

```stata
// scripts/loop.do
// @lsp-cd: "../"
// Working directory is now project/ (parent of scripts/)
global survey_list "dhs"
foreach survey of global survey_list {
    do "scripts/dhs/survey.do"
}
```

```stata
// scripts/dhs/survey.do
// @lsp-done-by: "../loop.do"
// Inherits working directory from loop.do (project/)
// No need to add @lsp-cd here!
do "data/load_data.do"  // Resolves to project/data/load_data.do
```

In this example, `survey.do` inherits the working directory from `loop.do`, so paths in `survey.do` resolve relative to `project/` rather than `scripts/dhs/`.

Backward directives (`@lsp-done-by`, `@lsp-run-by`, `@lsp-included-by`) and forward call directives (`@lsp-do`, `@lsp-run`, `@lsp-include`) support optional call-site parameters. These parameters control the **effective call site line** used for call-site filtering and scope visibility.

- `line=<number>`
  - Backward directives: treat the current file as being called at this line in the *parent* file (1-indexed)
  - Forward directives: treat the callee as being called at this line in the *current* file (1-indexed)
- `match="<string>"`
  - Backward directives: treat the current file as being called at the first line in the *parent* file containing the string
  - Forward directives: treat the callee as being called at the first line in the *current* file containing the string

Notes:
- For forward directives, `line=`/`match=` are useful when you want to keep directives near documentation (or grouped in one place) but the call happens elsewhere; the directive can override where forward-resolved symbols become visible.
- If `match=` is not found, the LSP emits a warning and falls back to the directive line as the call site.

### Automatic Call Site Inference

When no explicit `line=` or `match=` parameter is provided, the LSP automatically infers the call site by searching the parent file for `do`, `include`, or `run` statements that reference the current file.

**How it works:**
1. The LSP extracts the filename from the current file's URI
2. It searches the parent file for statements like `do "filename.do"`, `include filename`, or `run filename.do`
3. If found, the first matching line is used as the call site
4. If not found, the `assumeCallSite` config setting is used as fallback (`"end"` by default)

**Matching rules:**
- Matches both quoted and unquoted paths: `do "analysis.do"` and `do analysis.do`
- Matches with or without `.do` suffix: `do analysis` matches `analysis.do`
- Uses the first match if multiple calls exist

**Example:**

```stata
// parent.do
global setup_var = 1
do "child.do"        // <-- Call site automatically detected here
global after_var = 2
```

```stata
// child.do
// @lsp-done-by: "parent.do"
// No line= or match= needed - call site is inferred automatically
local result $setup_var   // OK - defined before call site
local other $after_var    // Warning - defined after call site
```

### Execution Order Checking

The LSP validates that symbols are defined before they're used in execution order, accounting for cross-file relationships and call sites.

**How execution order checking works:**
1. **Within-file analysis**: Symbols must be defined before use in the same file
2. **Cross-file call sites**: When using directives, only symbols defined on or before the call site in the parent file are considered available
3. **Out-of-scope warnings**: References to symbols defined after the call site generate warnings

**Automatic call site detection:**
- The LSP scans parent files for `do`, `run`, or `include` statements matching the current filename
- Matches both quoted (`do "file.do"`) and unquoted (`do file`) forms
- Uses the first matching statement as the effective call site
- Falls back to `assumeCallSite` setting (`"end"` by default) if no match found

**Out-of-scope symbol handling:**
- Symbols defined after the call site are flagged as "out-of-scope"
- These symbols appear in completions but generate warnings when used
- Use `line=` or `match=` parameters to specify exact call sites when automatic detection fails

### Examples

#### Basic Usage

```stata
// @lsp-done-by: "setup.do"
local result `global_from_setup'
```

```stata
// @lsp-included-by: "common.do"
local shared_local `local_from_common'
```

#### Line-Specific Directives

```stata
// @lsp-done-by: "config.do" line=5
local data_path `root_path'  // Symbols defined on or before line 5 are available
local other `undefined'      // This will still warn
```

#### Call Site Matching

```stata
// @lsp-done-by: "orchestrator.do" match="do \"analysis.do\""
local result `setup_global'  // Symbols defined before the do call are available
```

### Inheritance Rules

- **@lsp-done-by** / **@lsp-run-by**: Covers most symbols, except for local macros (covers programs, scalars, matrices, and global macros)
- **@lsp-included-by**: Covers all symbols including local macros

Use `@lsp-done-by` (or `@lsp-run-by`) for files that define globals/programs, and `@lsp-included-by` for files that are literally included (like with `include` command).

### Call Site Diagnostics

The LSP provides informative diagnostics when processing cross-file directives to help you understand the resolution behavior.

#### Information-Level Diagnostics

These diagnostics inform you about the resolution behavior without indicating an error:

- **Call site not identified**: When the LSP cannot find a `do`/`run`/`include` statement in the parent file that references your file, it uses a default assumption (configurable via `assumeCallSite`). The diagnostic suggests using `line=` or `match=` parameters for explicit call site specification.

- **done-by with include mismatch**: When you use `@lsp-done-by` but the parent file actually uses `include`, the LSP informs you that full inheritance (including local macros) will occur.

#### Warning-Level Diagnostics

These diagnostics indicate potential issues that may affect your code:

- **included-by with do/run mismatch**: When you use `@lsp-included-by` but the parent file uses `do` or `run`, local macros will NOT be inherited. This is a semantic issue that may cause undefined macro warnings.

- **Mixed call types**: When the parent file contains both `do`/`run` AND `include` statements referencing your file, the LSP warns about the ambiguity and suggests using `line=` or `match=` to specify which call site to use.

- **line= out of bounds**: When the specified `line=` parameter exceeds the parent file's line count.

- **line= invalid call statement**: When the specified `line=` points to a line that doesn't contain a `do`/`run`/`include` command or `@lsp-do`/`@lsp-run`/`@lsp-include` directive.

- **match= not found**: When the specified `match=` string is not found in the parent file.

#### Examples: Explicit Call Site Selection

When automatic call site inference fails or you need precise control, use `line=` or `match=` parameters:

```stata
// child.do - Using line= to specify exact call site
// @lsp-done-by: "parent.do" line=15
local result $setup_var  // Only symbols defined on/before line 15 of parent.do are visible
```

```stata
// child.do - Using match= to find call site by content
// @lsp-included-by: "orchestrator.do" match="include \"child.do\""
local shared `parent_local'  // Symbols defined before the matched line are visible
```

```stata
// analysis.do - Combining with quoted paths
// @lsp-done-by: "../scripts/setup.do" line=42
// @lsp-included-by: "common/macros.do" match="include \"analysis.do\""
local data_path "$root_path"
local helper `shared_macro'
```

#### Configuration

Information-level diagnostics for call site identification can be configured via the `crossFile.diagnostics.callSiteIdentification` setting:
- `"information"` (default): Show as information
- `"warning"`: Show as warning
- `"off"`: Suppress these diagnostics

Note: The `included-by` with `do`/`run` mismatch warning cannot be suppressed as it indicates a semantic issue that affects symbol inheritance.

### Tie-Breaking / Precedence

When multiple parent files contribute symbols to the same child file, precedence is resolved deterministically.

Rules:
- **Depth wins first**: symbols from nearer parents (direct parents) override symbols from more distant ancestors.
- **Same-depth conflicts**: if multiple parents at the same depth define the *same* symbol, the definition from the parent referenced by the **lattermost directive in the child file header** wins.

Example (same depth, lattermost wins):

```stata
// @lsp-done-by: "analysis.do"
// @lsp-done-by: "setup.do"
local path "$data_path"  // Uses definition from setup.do (because its directive is lattermost)
```

Notes:
- This rule applies consistently across completion, hover, go-to-definition, and diagnostics.
- The `included-by` vs `done-by` distinction controls *which kinds of symbols are inherited* (locals are only inherited via `included-by`), but for symbols that both directive types can inherit (e.g., globals/programs/scalars/matrices), header order controls same-depth conflicts.


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

## Configuration

The extension supports the following configuration options. All settings are prefixed with `sight.` and can be configured in VS Code's Settings UI or in your `settings.json` file.

### Diagnostics

Control how the LSP reports errors, warnings, and other diagnostics.

| Setting                                        | Type    | Default         | Description                                                                                                           |
| ---------------------------------------------- | ------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sight.diagnostics.enabled`                    | boolean | `true`          | Enable or disable all diagnostics                                                                                     |
| `sight.diagnostics.severity.undefinedMacro`    | enum    | `"warning"`     | Severity level for undefined macro references. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"`    |
| `sight.diagnostics.severity.undefinedVariable` | enum    | `"off"`         | [Experimental] Severity level for undefined variable references. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.styleWarnings`     | enum    | `"hint"`        | Severity level for style warnings. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"`                |
| `sight.diagnostics.severity.malformedOperator` | enum    | `"warning"`     | Severity for spaced compound operator diagnostics (e.g., `< =` → `<=`). Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.invalidOperatorSequence` | enum | `"error"`     | Severity for invalid operator sequence diagnostics (e.g., `< |`). Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.cStyleLogicalInControlFlow` | enum | `"information"` | Severity for C-style logical operators (`&&`, `||`) in if/else if control flow statements. These work but are stylistically discouraged. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.indentation`                | boolean | `false`         | Enable indentation diagnostics (missing indentation in blocks, unnecessary indentation after comments)                |

<a name="why-indentation-diagnostics-disabled"></a>
> **Why Indentation Diagnostics Are Disabled by Default**
>
> Unlike Python, Stata ignores indentation - it's purely stylistic and doesn't affect code execution. Indentation diagnostics are disabled by default for several reasons:
>
> 1. **Stylistic, not semantic**: "Wrong" indentation won't break your code
> 2. **Legacy codebase noise**: Existing codebases may produce many warnings, causing alert fatigue
> 3. **Subjective preferences**: Teams may have different indentation conventions
> 4. **Opt-in philosophy**: Mature LSPs (TypeScript, ESLint) default stylistic rules to off
>
> To enable indentation diagnostics:
> - **VS Code**: Set `sight.diagnostics.indentation` to `true` in Settings
> - **Project config**: Add `"diagnostics": { "indentation": true }` to `.sight.json`

#### Forward Reference Detection

The LSP detects "forward references" - using a macro before it's defined in execution order. Stata executes code sequentially, so a macro doesn't exist until the line defining it runs.

**Local macros** must be defined before use within the same file:
```stata
// Warning: `fruit' is not yet defined
local result: list fruit - other
local fruit apple banana
local other banana
```

**Global macros in the same file** must also be defined before use:
```stata
// Warning: file_global is not yet defined  
local result: list file_global - other
global file_global value
```

**Global macros from other files** also produce warnings unless the LSP can determine the relationship. The LSP automatically follows `do`, `run`, and `include` commands in your code to resolve cross-file symbols. You can also use explicit directives (`@lsp-done-by`, `@lsp-included-by`, `@lsp-do`, `@lsp-run`, `@lsp-include`) for cases where auto-detection doesn't work (e.g., dynamic paths with macros). The workspace indexer provides globals for completions and go-to-definition, but does not suppress undefined macro warnings.

**First definition wins**: When a macro is defined multiple times, references before the first definition produce warnings, but references after the first definition do not (even if they appear before later redefinitions).

**Macro-creating options**: The analyzer recognizes `local()` and `global()` options on built-in commands (`levelsof`, `glevelsof`) and user-defined programs (via `c_local `option'` and `global `option'` patterns matching syntax declarations).

#### Suppressing Diagnostics with Comments

You can suppress diagnostics on specific lines using comment directives:

- `@lsp-ignore` - Suppresses all diagnostics on the same line
- `@lsp-ignore-next` - Suppresses all diagnostics on the next line

```stata
// Suppress warning on the next line
// @lsp-ignore-next
local result `macro_from_program'

// Suppress warning on the same line
local result `macro_from_program'  // @lsp-ignore
```

<a id="what-the-lsp-can-detect"></a>

This is useful when the LSP cannot automatically detect that a macro will be defined. The LSP can trace `do`/`run`/`include` calls to find macros defined in other files, and it can detect macros created by called programs when the macro name is fixed or set via a program option. In other situations, you can use `@lsp-ignore` or `@lsp-ignore-next` to suppress diagnostics for a specific line, or `@lsp-local` to declare the macro to the LSP.

#### Declaring Symbols with Directives

You can explicitly declare symbols to the LSP using declaration directives. These directives tell the LSP that a symbol should be considered defined from the point where the directive appears.

*   **Locals and Globals**: The LSP **will** emit warnings (or errors, based on settings) if these macros are used but not defined. Use declaration directives (`@lsp-local`, `@lsp-global`) to suppress these warnings for macros defined dynamically.
*   **Variables**: By default, the LSP does **not** emit warnings about undefined variables, since it cannot statically check what's in your datasets. This is an experimental feature - you can set `sight.diagnostics.severity.undefinedVariable` to a severity other than `"off"` (see [Configuration](#configuration)) to enable checking, then use `@lsp-variables` to declare variables loaded from external data files.
*   **Scalars, Matrices, and Programs**: You can declare these to the LSP (`@lsp-scalar`, `@lsp-matrix`, `@lsp-program`), but at present, the LSP does **not** emit warnings if it fails to find them in scope. Support for these directives is implemented to prepare code for future configurable strictness checks.

**Available directives:**

| Directive             | Purpose                 |
| --------------------- | ----------------------- |
| `@lsp-local <name>`   | Declares a local macro  |
| `@lsp-global <name>`  | Declares a global macro |
| `@lsp-variables <names>` | Declares variables (space-separated) |
| `@lsp-scalar <name>`  | Declares a scalar       |
| `@lsp-matrix <name>`  | Declares a matrix       |
| `@lsp-program <name>` | Declares a program      |

**Important:** Each directive accepts exactly one argument (the symbol name). Multiple arguments will produce a warning.

**Exception:** `@lsp-variables` accepts multiple space-separated variable names.

**Examples:**

```stata
// Declare a local macro that will be created by a called program
// @lsp-local result_from_program
do "compute_result.do"
display `result_from_program'  // No warning - declared above

// Declare a global macro set by external code
* @lsp-global CONFIG_PATH
local path "$CONFIG_PATH"  // No warning

// Declare a scalar (ready for future validation enhancements)
// @lsp-scalar my_scalar
display scalar(my_scalar)

// Declare a matrix
// @lsp-matrix coefficients
matrix list coefficients

// Declare a program defined elsewhere
// @lsp-program my_utility
my_utility arg1 arg2
```

**Notes:**
- Directives can appear anywhere in the file (not just in the header)
- The declaration takes effect from the line where it appears through the end of the file
- References to the symbol before the directive line will still produce warnings
- Both `*` and `//` comment styles are supported
- Trailing whitespace after the symbol name is allowed

**When to use declaration directives:**
- When a macro is created by `c_local` in a called program and the LSP cannot detect it (see [what the LSP can detect](#what-the-lsp-can-detect))
- When symbols are defined by external Stata commands or plugins
- When symbols are conditionally defined in ways the LSP cannot analyze
- When working with dynamically generated code



### Indexing

Configure workspace indexing behavior for cross-file features.

| Setting                           | Type    | Default  | Description                                      |
| --------------------------------- | ------- | -------- | ------------------------------------------------ |
| `sight.indexWorkspace`            | boolean | `true`   | Enable workspace-wide symbol indexing            |
| `sight.indexing.maxFileSizeBytes` | number  | `500000` | Maximum file size in bytes for indexing (~500KB) |

### ADO Paths

Configure additional search paths for ADO files.

| Setting          | Type  | Default | Description                              |
| ---------------- | ----- | ------- | ---------------------------------------- |
| `sight.adoPaths` | array | `[]`    | Additional paths to search for ADO files |

### Project Configuration File

You can also configure the LSP using a `.sight.json` file in your workspace root. This is useful for project-specific settings that should be shared with collaborators.

```json
{
  "diagnostics": {
    "indentation": false
  },
  "crossFile": {
    "indexWorkspace": true,
    "maxIndexedFiles": 1000,
    "maxBackwardDepth": 10,
    "maxForwardDepth": 10,
    "maxChainDepth": 20,
    "assumeCallSite": "end",
    "diagnostics": {
      "outOfScope": "information",
      "missingFile": "warning",
      "callSiteIdentification": "information"
    }
  }
}
```

| Option                                  | Type                 | Default         | Description                                                             |
| --------------------------------------- | -------------------- | --------------- | ----------------------------------------------------------------------- |
| `diagnostics.indentation`               | boolean              | `false`         | Enable indentation diagnostics                                          |
| `crossFile.indexWorkspace`              | boolean              | `true`          | Enable workspace-wide file indexing                                     |
| `crossFile.maxIndexedFiles`             | number               | `1000`          | Maximum files to index                                                  |
| `crossFile.maxBackwardDepth`            | number               | `10`            | Maximum recursion depth for backward directive resolution               |
| `crossFile.maxForwardDepth`             | number               | `10`            | Maximum recursion depth for forward scope resolution                    |
| `crossFile.maxChainDepth`               | number               | `20`            | Maximum combined depth for forward + backward resolution                |
| `crossFile.maxCalleeRevalidations`      | number               | `10`            | Maximum number of open callee documents to revalidate per caller change |
| `crossFile.assumeCallSite`              | `"end"` \| `"start"` | `"end"`         | Where to assume call site when not specified and inference fails        |
| `crossFile.diagnostics.outOfScope`      | severity             | `"information"` | Severity for out-of-scope symbol diagnostics                            |
| `crossFile.diagnostics.missingFile`     | severity             | `"warning"`     | Severity for missing directive file diagnostics                         |
| `crossFile.diagnostics.callSiteIdentification` | severity      | `"information"` | Severity for call site identification diagnostics                       |

Severity options: `"error"`, `"warning"`, `"information"`, `"off"` (alias: `"info"` for `"information"`)

VS Code settings take precedence over `.sight.json` when both are present.

### Example Configurations

#### Disable All Diagnostics

```json
{
  "sight.diagnostics.enabled": false
}
```

#### Treat Undefined Macros as Errors

```json
{
  "sight.diagnostics.severity.undefinedMacro": "error"
}
```

#### Disable Indentation Diagnostics

```json
{
  "sight.diagnostics.indentation": false
}
```

#### Add Custom ADO Paths

```json
{
  "sight.adoPaths": [
    "/path/to/custom/ado",
    "/another/ado/directory"
  ]
}
```

#### Minimal Diagnostics (Errors Only)

```json
{
  "sight.diagnostics.severity.undefinedMacro": "error",
  "sight.diagnostics.severity.undefinedVariable": "off",
  "sight.diagnostics.severity.styleWarnings": "off"
}
```



## Quote Auto-Close

The extension provides intelligent auto-closing for Stata's unique quoting conventions. Unlike VS Code's built-in auto-closing pairs, this feature handles Stata's overlapping delimiters correctly.

### Supported Patterns

| You Type   | Result         | Description                           |
| ---------- | -------------- | ------------------------------------- |
| `` ` ``    | `` `\|' ``     | Local macro reference                 |
| `` \`\` `` | `` \`\`\|'' `` | Nested local macro (double backticks) |
| `` `" ``   | `` `"\|"' ``   | Compound string                       |
| `"`        | `` `"\|"` ``   | Double-quoted string                  |

Note: `|` represents cursor position.

### Skip-Over Behavior

When you manually type a closing character that was auto-inserted, the extension skips over it instead of inserting a duplicate:

| Context            | You Type | Result             |
| ------------------ | -------- | ------------------ |
| `` `macro\|' ``    | `'`      | `` `macro'\| ``    |
| `"string\|"`       | `"`      | `"string"\|`       |
| `` `"string\|"' `` | `'`      | `` `"string"'\| `` |

This prevents common issues like ending up with `"string""` or `` `macro'' ``.

### How It Works

The extension uses a `onDidChangeTextDocument` listener rather than VS Code's `type` command interceptor. This approach:
- Does not conflict with other extensions
- Reacts after the character is inserted
- Checks context to determine appropriate closing characters

### Preserved Behaviors

Standard auto-closing pairs continue to work via VS Code's language configuration:
- `{` → `{|}`
- `[` → `[|]`
- `(` → `(|)`

## Send to Stata

The extension provides commands to send Stata code directly from VS Code to Stata for execution, supporting both the Stata application (on Mac and Windows) and terminal sessions.

> **Implementation Note:** On macOS, the extension uses AppleScript to communicate with the Stata application. On Windows, it uses the [send-to-stata](https://github.com/jbearak/send-to-stata) utility, which is not bundled with the extension. On first use, you'll be prompted to download it.

### Execution Targets

- **Stata Application**: Send code to the Stata application
- **Terminal Sessions**: Sends code to VS Code's integrated terminal (works on Mac, Linux, Windows with WSL, and over SSH)

### Keyboard Shortcuts

| Mac | Windows | Action |
|-----|---------|--------|
| `Cmd+Enter` | `Ctrl+Enter` | Send statement to Stata app |
| `Shift+Cmd+Enter` | `Shift+Ctrl+Enter` | Send file to Stata app |
| `Alt+Cmd+Enter` | `Alt+Ctrl+Enter` | Include statement (preserves locals) |
| `Alt+Shift+Cmd+Enter` | `Alt+Shift+Ctrl+Enter` | Include file (preserves locals) |
| `Alt+Enter` | `Alt+Enter` | Send statement to terminal |
| `Alt+Shift+Enter` | `Alt+Shift+Enter` | Send file to terminal |

> [!TIP]
> You can also access these commands via:
> - an editor toolbar menu (`▶` button)
  > - the command palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows).

![Send to Stata Menu](examples/send_to_stata_menu.png)

### Additional Commands

- **Send Upward Lines**: Sends all lines from start of file to current line
- **Send Downward Lines**: Sends all lines from current line to end of file
- **CD to File Folder**: Changes Stata's working directory to the current file's folder
- **CD to Workspace Folder**: Changes Stata's working directory to the workspace root

> [!TIP]
> The toolbar button (`▶`) lists all commands.

### Cursor Advancement

By default, the cursor advances to the next line when it sends a single statement (not a selection or entire file) to Stata.

**Configuration**: `sight.sendToStata.advanceCursorOnSend` (default: `true`)

### Working Directory Management

Control which directory Stata uses when executing your code:

| Option | Description | When to Use |
|--------|-------------|-------------|
| **lsp** (default) | Uses working directory from LSP directives | Recommended - leverages `@lsp-cd` or inherited from parent files |
| **none** | No directory change | When Stata's current directory is already correct |
| **file** | Changes to current file's directory | For standalone scripts |
| **workspace** | Changes to workspace root | For project-relative paths |

**Configuration**: `sight.sendToStata.workingDirectory`

The **lsp** option reads the working directory from:
- `@lsp-cd`, `@lsp-working-directory`, or `@lsp-wd` directives in your file
- Parent files via `@lsp-done-by` or `@lsp-included-by` directives (inherits working directory)
- Falls back to "none" if no LSP working directory is available

When set to "none", manual CD commands appear in the toolbar menu for quick directory changes.

### Statement Detection

The extension intelligently detects complete Stata statements:
- Handles multi-line statements with `///` continuation markers
- When cursor is on a continuation line, includes the entire statement from beginning
- When cursor is on a line with `///`, includes all continuation lines

### Editor Toolbar

A toolbar button (▶) appears in the editor title bar for Stata files, providing quick access to all send commands organized by category (Do, Include, Terminal, CD).

### Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sight.sendToStata.stataApp` | string | `""` | Override Stata variant (macOS only). Auto-detects if empty. |
| `sight.sendToStata.saveBeforeSend` | boolean | `true` | Automatically save file before sending |
| `sight.sendToStata.advanceCursorOnSend` | boolean | `true` | Advance cursor to next line after single-line send |
| `sight.sendToStata.workingDirectory` | enum | `"lsp"` | Working directory mode: "lsp", "none", "file", or "workspace" |
| `sight.sendToStata.focusStataWindow` | boolean | `false` | Switch focus to Stata after sending code |

### Comments

Configure the line comment character used by VS Code's toggle comment shortcut.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `sight.lineCommentStyle` | string | `"//"` | Line comment character used by the toggle comment shortcut. In Stata, `//` can appear anywhere on a line while `*` must be at the start of a line. Options: `"//"`, `"*"` |

To use `*` for comment toggling instead of `//`:

```json
{
    "sight.lineCommentStyle": "*"
}
```

## Experimental Features (Not Ready for Use)

**⚠️ Warning:** The following features (Pretty Printer and Comment Formatter) exist in the codebase but are not recommended for production use at this time.

### Formatting

Configure code formatting options.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `sight.formatting.indentSize` | number | `4` | Number of spaces or tab stops for indentation (minimum: 1) |
| `sight.formatting.indentStyle` | enum | `"spaces"` | Use spaces or tabs for indentation. Options: `"spaces"`, `"tabs"` |
| `sight.formatting.lineWidth` | number | `80` | Maximum line width for formatting (minimum: 40) |
| `sight.formatting.preserveAlignment` | boolean | `true` | Preserve intentional alignment in continuation lines |
| `sight.formatting.normalizeCommentStyle` | boolean | `false` | Normalize comment styles during formatting |
| `sight.formatting.preferredCommentStyle` | enum | `"line"` | Preferred comment style for normalization. `"line"` uses the value of `sight.lineCommentStyle`. Options: `"line"`, `"//"`, `"*"`, `"/* */"` |
| `sight.formatting.commentLineWidth` | number | `72` | Maximum line width for comments (minimum: 40) |

To automatically format on save, enable VS Code's built-in `editor.formatOnSave` setting.

#### Alignment Preservation

When `preserveAlignment` is enabled (default), the formatter detects and preserves intentional alignment in continuation lines (lines after `///`). This allows you to maintain aligned operators, conditions, or expressions across multiple lines:

```stata
gen new_var = (condition1 == 1) ///
            & (condition2 == 2) ///
            | (condition3 == 3)
```

**Alignment with Indentation Correction**: When the formatter corrects incorrect block indentation, it preserves alignment by applying the same indentation delta to all continuation lines. For example, if a statement inside an `if` block is missing 4 spaces of indentation:

```stata
// Before formatting (missing indentation)
if condition {
gen result = (var1 == 1) ///
           & (var2 == 2) ///
           | (var3 == 3)
}

// After formatting (indentation corrected, alignment preserved)
if condition {
    gen result = (var1 == 1) ///
               & (var2 == 2) ///
               | (var3 == 3)
}
```

The formatter adds the same 4 spaces to both the base statement and all continuation lines, maintaining their relative alignment.

When alignment preservation is disabled, the formatter applies standard indentation rules to all continuation lines.

### Comment Style Normalization

Sight supports automatic comment style normalization during formatting operations. This feature allows you to maintain a consistent comment style across your codebase.

#### Supported Comment Styles

Stata supports three comment styles:

1. **Slash comments** (`//`): Single-line comments
2. **Star comments** (`*`): Single-line comments (traditional Stata style)
3. **Block comments** (`/* */`): Multi-line comments

#### Enabling Comment Normalization

To enable comment style normalization, add the following to your VS Code settings:

```json
{
  "sight.formatting.normalizeCommentStyle": true,
  "sight.formatting.preferredCommentStyle": "//",
  "sight.formatting.commentLineWidth": 72
}
```

#### Special Cases

- **Continuation comments** (`///`): These are never normalized, as they have special meaning in Stata for line continuation.
- **Embedded language blocks**: Comments within Mata or Python blocks are preserved in their original style.
- **Markdown in comments**: The formatter respects Markdown syntax in comments and preserves list items and code blocks during line wrapping.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions, testing, and release process.

## License

Copyright © 2026 Jonathan Marc Bearak  
[GPLv3](LICENSE) - This project is open source software. You can use, modify, and distribute it with attribution, but any derivative works must also be open source under GPLv3.

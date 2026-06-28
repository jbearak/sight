# Declaration Directives

## Suppressing Diagnostics with Comments

You can suppress diagnostics on specific lines using comment directives:

- `# sight: ignore` - Suppresses all diagnostics on the same line
- `# sight: ignore-next` - Suppresses all diagnostics on the next line

`# sight:` is the preferred directive prefix. It must appear inside a Stata
comment, such as `// # sight: ...` or `* # sight: ...`. The older `@lsp-`
forms remain permanent aliases, so `// @lsp-ignore` still works.

```stata
// Suppress warning on the next line
// # sight: ignore-next
local result `macro_from_program'

// Suppress warning on the same line
local result `macro_from_program'  // # sight: ignore
```

<a id="what-the-lsp-can-detect"></a>

This is useful when the LSP cannot automatically detect that a macro will be defined. The LSP can trace `do`/`run`/`include` calls to find macros defined in other files, and it can detect macros created by called programs when the macro name is fixed or set via a program option. In other situations, you can use `# sight: ignore` or `# sight: ignore-next` to suppress diagnostics for a specific line, or `# sight: local` to declare the macro to the LSP.

## Declaring Symbols with Directives

You can explicitly declare symbols to the LSP using declaration directives. These directives tell the LSP that a symbol should be considered defined from the point where the directive appears.

*   **Locals and Globals**: The LSP **will** emit warnings (or errors, based on settings) if these macros are used but not defined. Use declaration directives (`# sight: local`, `# sight: global`) to suppress these warnings for macros defined dynamically.
*   **Variables**: By default, the LSP does **not** emit warnings about undefined variables, since it cannot statically check what's in your datasets. This is an experimental feature - you can set `sight.diagnostics.severity.undefinedVariable` to a severity other than `"off"` (see [Configuration](configuration.md)) to enable checking, then use `# sight: variables` to declare variables loaded from external data files.
*   **Scalars, Matrices, and Programs**: You can declare these to the LSP (`# sight: scalar`, `# sight: matrix`, `# sight: program`), but at present, the LSP does **not** emit warnings if it fails to find them in scope. Support for these directives is implemented to prepare code for future configurable strictness checks.

**Available directives:**

| Directive             | Purpose                 |
| --------------------- | ----------------------- |
| `# sight: local <name>`   | Declares a local macro  |
| `# sight: global <name>`  | Declares a global macro |
| `# sight: variables <names>` | Declares variables (space-separated) |
| `# sight: scalar <name>`  | Declares a scalar       |
| `# sight: matrix <name>`  | Declares a matrix       |
| `# sight: program <name>` | Declares a program      |

Each declaration directive accepts one or more space-separated symbol names.
`# sight: variables` likewise accepts one or more variable names.

**Examples:**

```stata
// Declare a local macro that will be created by a called program
// # sight: local result_from_program
do "compute_result.do"
display `result_from_program'  // No warning - declared above

// Declare a global macro set by external code
* # sight: global CONFIG_PATH
local path "$CONFIG_PATH"  // No warning

// Declare a scalar (ready for future validation enhancements)
// # sight: scalar my_scalar
display scalar(my_scalar)

// Declare a matrix
// # sight: matrix coefficients
matrix list coefficients

// Declare a program defined elsewhere
// # sight: program my_utility
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

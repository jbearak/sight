# Declaration Directives

## Suppressing Diagnostics with Comments

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

## Declaring Symbols with Directives

You can explicitly declare symbols to the LSP using declaration directives. These directives tell the LSP that a symbol should be considered defined from the point where the directive appears.

*   **Locals and Globals**: The LSP **will** emit warnings (or errors, based on settings) if these macros are used but not defined. Use declaration directives (`@lsp-local`, `@lsp-global`) to suppress these warnings for macros defined dynamically.
*   **Variables**: By default, the LSP does **not** emit warnings about undefined variables, since it cannot statically check what's in your datasets. This is an experimental feature - you can set `sight.diagnostics.severity.undefinedVariable` to a severity other than `"off"` (see [Configuration](configuration.md)) to enable checking, then use `@lsp-variables` to declare variables loaded from external data files.
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

# Diagnostics

Sight reports problems in your Stata code as you type — syntax errors,
unresolved macros, suspicious operators, and style issues. This page
lists every diagnostic, shows how to silence individual reports, and
documents the configuration keys that control severity.

Diagnostics are deferred until the workspace scan completes, so
cross-file warnings reflect the full project rather than just the open
buffer. Each diagnostic carries a numeric `code` (the values in the
tables below) and `source: "sight"`.

## Quick reference

- **Silence one site** — add `// sight: ignore` or
  `// sight: ignore-next` on its own line above the offending statement. Suppresses undefined-symbol
  (`UNDEFINED_MACRO`, `UNDEFINED_VARIABLE`, `OUT_OF_SCOPE_SYMBOL`) and
  operator-style diagnostics on the targeted line. Lexer, parser /
  brace-style, and indentation diagnostics are not silenced this way —
  fix lexer/parser issues at the source, or turn indentation off via
  `sight.diagnostics.indentation` (it ships off by default).
- **Declare a symbol the analyzer can't see** — use
  [`sight: local`, `sight: global`, `sight: variables`, `sight: scalar`,
  `sight: matrix`, `sight: program`](declaration-directives.md). Forward-only:
  effective at and after the directive line.
- **Bring a sibling file's symbols into scope** — usually nothing to do:
  Sight auto-discovers `do` / `run` / `include` relationships and
  inherits the parent's symbols. Add a header directive
  (`sight: done-by`, `sight: included-by`) only when auto-discovery can't
  see the link — for example, when the path is built from macros. See
  [Cross-File Awareness](cross-file.md).
- **Turn a category off globally** — set the matching severity to
  `"off"` (see [Configuration](#configuration)).
- **Disable everything** — set `sight.diagnostics.enabled` to `false`.

## Lexical errors

Reported by the lexer. Most are hard errors; `CONTINUATION_NO_SPACE` is
gated by the `styleWarnings` severity.

| Code | Name | Default | Trigger |
|---|---|---|---|
| 1001 | `UNBALANCED_QUOTES` | error | A string literal is opened but never closed on the same statement. |
| 1002 | `UNBALANCED_BLOCK_COMMENT` | error | `/*` is not matched by `*/`. |
| 1003 | `UNTERMINATED_STATEMENT` | error | A statement runs off the end of the file in `#delimit ;` mode without a terminating `;`. |
| 1004 | `CONTINUATION_NO_SPACE` | hint (`styleWarnings`) | `///` continuation marker not preceded by whitespace (`foo///` instead of `foo ///`). |
| 1005 | `BLOCK_COMMENT_IN_STAR_COMMENT` | warning | A `/* … */` block appears inside a `*` line comment, which Stata parses unexpectedly. |

## Parse and structural errors

Reported by the parser and context tracker. Severity is fixed (no
configuration key); two entries are warnings rather than errors because
Stata still runs the code.

| Code | Name | Default | Trigger |
|---|---|---|---|
| 3000 | `SYNTAX_ERROR` | error | Generic parser failure not covered by a more specific code. |
| 3001 | `BRACE_ELSE_SAME_LINE` | error | `} else {` style — Stata requires the closing brace and `else` on separate lines. |
| 3002 | `BRACE_NOT_ALONE` | error | A closing `}` shares a line with other code. |
| 3003 | `MISSING_PROGRAM_END` | error | A `program` / `mata` / `python` block is not closed by `end`. |
| 3004 | `OPEN_BRACE_ALONE` | error | An opening `{` appears alone on a line where Stata expects it on the control statement. |
| 3005 | `UNCLOSED_BLOCK` | error | An `if` / `foreach` / `forvalues` / `while` / frame / mata / python block is not closed. |
| 3006 | `CODE_AFTER_OPEN_BRACE` | warning | Tokens follow `{` on the same line as the opening brace. Stata runs the block but ignores trailing code on that line. |
| 3008 | `FORVALUES_SYNTAX` | error | Malformed `forvalues` range (e.g., missing `=` or bad `to`/`/` separators). |
| 3009 | `REDUNDANT_MACRO_SUFFIX` | warning | A macro reference includes redundant trailing characters that Stata ignores. |
| 3010 | `INVALID_MACRO_CHAR` | error | A macro name contains a character Stata does not allow in identifiers. (Analyzer-emitted; shares numeric code 3010 with the parser-emitted `MISSING_EXPRESSION_AFTER_EQUALS` below.) |
| 3010 | `MISSING_EXPRESSION_AFTER_EQUALS` | error | An `=` is followed by no expression — e.g., `gen x =`, an empty `if` / `while` condition, or an empty qualifier. |
| 3011 | `UNBALANCED_PARENTHESES` | error | Mismatched `(` / `)` in an expression, `if` / `while` condition, or `by` / `bysort` qualifier. |
| 3012 | `ORPHAN_CLOSE_BRACE` | error | A `}` appears with no matching opening block. |
| 3013 | `STRAY_TOKEN_IN_CONDITION` | error | Unexpected token inside an `if` / `while` / qualifier condition. |
| 3014 | `SPLIT_LITERAL_IN_CONDITION` | error | A string or compound literal is split across the condition boundary, leaving an unterminated literal in an `if` / `while` condition. |

## Semantic / scope diagnostics

The analyzer flags references it cannot resolve to a definition in the
current scope. All four codes are gated by the `undefinedMacro` or
`undefinedVariable` severity (see [How scope is decided](#how-scope-is-decided)).

| Code | Name | Default | Severity key | Trigger |
|---|---|---|---|---|
| 2001 | `UNDEFINED_MACRO` | warning | `undefinedMacro` | `` `name' ``, `$name`, or `${name}` references a macro that is not in scope at the reference line. Also covers undefined scalars, matrices, and programs. |
| 2002 | `UNDEFINED_VARIABLE` | off | `undefinedVariable` | A varlist position references a name Sight has not seen defined. See [What counts as a variable definition](#what-counts-as-a-variable-definition). |
| 2003 | `OUT_OF_SCOPE_SYMBOL` | inherits | matches the underlying symbol's key | A reference resolves to a symbol that exists in the workspace but is not reachable from this file's scope chain. The diagnostic message names the file the symbol was found in. |
| 2004 | `MISSING_VARIABLE_NAME` | error | n/a | A command position requires a variable name and the parser found no token (e.g., `gen = 1`). |

A second class — *forward references* — also surfaces under
`UNDEFINED_MACRO` when a macro is used earlier in the same file than its
first definition (see [Forward references](#forward-references)).

Positional macro arguments (`` `0' ``, `` `1' ``, …) bypass position
and scope checks: they are bound by the caller, not by lexical position.

## Operator style diagnostics

Each operator diagnostic has its own severity key, and each can be
turned off independently.

| Code | Name | Default | Severity key | Trigger |
|---|---|---|---|---|
| 6001 | `MALFORMED_OPERATOR` | warning | `malformedOperator` | Compound operators split by whitespace (`< =`, `> =`, `! =`). Stata accepts these but they are usually typos. |
| 6002 | `INVALID_OPERATOR_SEQUENCE` | error | `invalidOperatorSequence` | Token sequences Stata cannot parse (e.g., `< \|`, `= ==`). |
| 6003 | `CSTYLE_LOGICAL_IN_CONTROL_FLOW` | information | `cStyleLogicalInControlFlow` | `&&` / `\|\|` used in `if` / `else if`. Legal in Stata, but the canonical style uses `&` / `\|`. |
| 6004 | `MIXED_LOGICAL_OPERATORS` | warning | `mixedLogicalOperators` | `&` and `\|` mixed in one expression without parentheses; precedence is easy to misread. |

## Indentation diagnostics

Off by default. Enable with `sight.diagnostics.indentation: true`.
This is an on/off toggle — there is no severity key; both codes are
emitted at `information` severity.

| Code | Name | Trigger |
|---|---|---|
| 5001 | `UNNECESSARY_INDENTATION` | A line is indented past the AST-computed depth. |
| 5002 | `MISSING_INDENTATION` | A line is at a shallower indent than its block depth. |

## Cross-file diagnostics

Reported during cross-file scope resolution. Severity is configurable
via the `crossFile.diagnostics.*` keys in `sight.toml`.

| Code | Name | Default | Severity key | Trigger |
|---|---|---|---|---|
| 7001 | `PATH_CASE_MISMATCH` | `auto` | `crossFile.diagnostics.caseMismatch` | A `do`/`run`/`include` command or cross-file directive (`sight: do`, `sight: run`, `sight: include`, `sight: done-by`, `sight: run-by`, `sight: included-by`) references a path that differs from the on-disk file by letter case only. The file is resolved and symbols are inherited normally; only the spelling is wrong. |

### `PATH_CASE_MISMATCH` (7001)

**Trigger:** A static path in a `do`, `run`, or `include` command — or
in a forward directive (`sight: do`, `sight: run`, `sight: include`) or
backward header directive (`sight: done-by`, `sight: run-by`,
`sight: included-by`) — resolves to an on-disk file that has different
letter casing. The file is found and symbols are inherited (no
undefined-symbol cascade), but the diagnostic asks you to fix the
spelling.

**Forward message** (`do`/`run`/`include` commands and forward
directives): notes that Stata will not find the file on case-sensitive
filesystems and shows both spellings:

```text
Path "helpers/clean" does not match the file on disk
"helpers/Clean.do"; Stata will not find it on case-sensitive
filesystems (Linux). Update the path to match.
```

**Backward message** (`sight: done-by`, `sight: run-by`,
`sight: included-by`): backward directives are not Stata commands, so the
message makes no execution claim:

```text
Directive path "parent" does not match the file on disk
"Parent.do"; update the directive to match the file's casing.
```

**Default severity (`"auto"`):** `information` on case-insensitive
filesystems (macOS/Windows), `warning` on case-sensitive ones (Linux /
CI). This means the same code is quiet during local development on a Mac
but surfaces as a build warning in Linux CI — the intended asymmetry.

**Not suppressible** by `sight: ignore` or `sight: ignore-next`. Suppress
project-wide with `crossFile.diagnostics.caseMismatch = "off"`, or fix
the path casing. Setting `crossFile.diagnostics.missingFile = "off"`
does **not** silence this diagnostic — the two settings are independent.

**Out of scope:** data-file commands (`use`, `save`, `merge`, `import`,
`export`); paths with macro interpolation; paths outside all workspace
folders. Only static paths in the cross-file execution graph
(`do`/`run`/`include` and their directive equivalents) are covered.

## Configuration

Diagnostics keys live under `sight.*` in VS Code's `settings.json`:

```jsonc
{
  "sight.diagnostics.enabled": true,           // master switch
  "sight.diagnostics.indentation": false,      // enable 5001/5002
  "sight.diagnostics.severity.undefinedMacro":              "warning",
  "sight.diagnostics.severity.undefinedVariable":           "off",
  "sight.diagnostics.severity.styleWarnings":               "hint",
  "sight.diagnostics.severity.malformedOperator":           "warning",
  "sight.diagnostics.severity.invalidOperatorSequence":     "error",
  "sight.diagnostics.severity.cStyleLogicalInControlFlow":  "information",
  "sight.diagnostics.severity.mixedLogicalOperators":       "warning"
}
```

Project-wide diagnostic settings can also be stored in `sight.toml`:

```toml
[diagnostics]
enabled = true
indentation = false

[diagnostics.severity]
undefinedMacro = "warning"
undefinedVariable = "off"
styleWarnings = "hint"
```

See the [Project Configuration File](configuration.md#project-configuration-file)
section for the full `sight.toml` schema and precedence rules.

Each severity key accepts `"error"`, `"warning"`, `"information"`,
`"hint"`, or `"off"`. Notes:

- `undefinedMacro` also governs undefined scalars, matrices, programs,
  and the `OUT_OF_SCOPE_SYMBOL` variants of those categories.
- `undefinedVariable` is experimental and ships off — see
  [Why undefined-variable is off by default](#why-undefined-variable-is-off-by-default).
- `styleWarnings` currently gates `CONTINUATION_NO_SPACE` (1004).
- Parse and brace-style diagnostics have no per-category control and
  `sight: ignore` does not silence them — fix the underlying issue.
- Indentation diagnostics ship off; turn them on with the boolean
  `sight.diagnostics.indentation`. Both indentation codes emit at
  `information` severity (there is no severity key), and `sight: ignore`
  does not silence individual sites.

## Suppressing diagnostics in source

| Directive | Effect |
|---|---|
| `// sight: ignore` | Suppresses undefined-symbol and operator-style diagnostics on the next non-trivia statement. Does not silence lexer, parser / brace-style, or indentation diagnostics. |
| `// sight: ignore-next` | Same effect as `sight: ignore`. |
| `// sight: local name [name ...]` | Declares one or more local macros from the directive line forward. |
| `// sight: global name [name ...]` | Same, for globals. |
| `// sight: variables var [var ...]` | Declares variables (e.g., loaded from a `.dta` file). |
| `// sight: scalar name`, `// sight: matrix name`, `// sight: program name` | Declares scalars, matrices, and programs respectively. |

Directives must occupy their own `//` or line-leading `*` comment line. Inline
trailing comments and `/* ... */` block comments are not directive comments.
`@lsp-` spellings are permanent aliases for all directive forms above.

Declaration directives are forward-only: they suppress warnings at and
after the directive line, not earlier ones. See
[Declaration Directives](declaration-directives.md) for the full
syntax.

For cross-file linkage (the usual reason a global appears "undefined"
when it is defined in a sibling file), prefer the dependency-graph
mechanism — Sight auto-discovers `do` / `run` / `include` chains and
inherits the parent's symbols. Header directives (`sight: done-by`,
`sight: included-by`) handle cases auto-discovery cannot, such as paths
built from macros. See [Cross-File Awareness](cross-file.md).

## How scope is decided

A symbol is considered in scope at a reference line when one of these
holds:

1. **Same file, on or before the reference line.** Subject to the
   forward-reference check below.
2. **Inherited from a parent file** via the resolved scope chain:
   - `done-by` / `run-by` / `do` / `run` inherit non-local symbols
     (programs, globals, scalars, matrices, variables).
   - `included-by` / `include` inherit all symbols, including local
     macros.
3. **Declared by directive** (`sight: local`, `sight: global`, … ) on or
   before the reference line.

Workspace indexing alone does **not** suppress diagnostics. A global
defined in an unrelated file is still offered in completion (marked
out of scope) but a reference to it produces an undefined-symbol
warning. The warning is the cue to add a `do` / `run` / `include`
statement or a cross-file directive.

## Forward references

Within a single file, the analyzer compares each reference's preorder
position against the symbol's first definition:

- Reference appears before the first definition in the same file →
  warning (under `UNDEFINED_MACRO`).
- Reference appears at or after the first definition → no warning.
- When a name is defined more than once, the first definition wins.

Forward-reference checking is intra-file only. Symbols inherited from
parent files are subject to *call-site* filtering instead: only
definitions on or before the call site of the current file in the
parent are considered in scope.

## Startup behavior

Sight defers diagnostics until the workspace scan finishes parsing
every `.do`, `.ado`, `.doh`, and `.mata` file and the dependency graph
is populated. Files opened before the scan completes are re-checked
once the graph is ready, so cross-file warnings reflect the full
project rather than just the open buffer.

## What counts as a variable definition

Sight recognizes a variable as defined when it sees one of:

- `generate` / `gen`, `egen`, `input` — explicit creation.
- `rename` / `ren` — the new name is registered.
- `confirm variable` / `confirm var` — treated as an assertion that
  the variable exists; useful for declaring columns loaded from a
  dataset without disabling the diagnostic.
- `sight: variables name [name …]` — manual declaration, forward-only.

Variables loaded from `use`, `import`, or `merge` are **not**
introspected — Sight does not read `.dta` files. If the diagnostic is
on and you load data, declare the columns with `sight: variables` (or a
`confirm variable` line if you want a runtime assertion as well).

## Why undefined-variable is off by default

Stata variable existence depends on the dataset in memory at runtime,
which the LSP cannot observe statically. Even with the definitions
listed above, a name may legitimately come from a `use`, `import`, or
`merge` the analyzer cannot read — particularly when the dataset path
is built from macros. Defaulting the diagnostic to `off` avoids
drowning users in false positives. To opt in, set
`sight.diagnostics.severity.undefinedVariable` to any non-`off` value
and declare dynamically-loaded columns with `sight: variables` or
`confirm variable`.

## Relationship to completion

Completion and diagnostics share the same scope resolver but apply
different rules. Completion may surface workspace symbols as
out-of-scope suggestions (see [Completion](completion.md));
diagnostics never treat workspace-only visibility as resolved scope.
Accepting an out-of-scope completion produces a diagnostic by design —
that is the signal to link the file via `do` / `run` / `include` or a
cross-file directive.

# Diagnostics

Sight reports problems in your Stata code as you type — syntax errors,
unresolved macros, suspicious operators, and style issues. This page
lists every diagnostic, shows how to silence individual reports, and
documents the configuration keys that control severity.

In VS Code, Sight keeps Problems entries only for files represented by real
editor tabs or visible peek editors. A diff tab owns its modified side, not the
original side. Text models opened invisibly by another extension remain
synchronized and participate in cross-file analysis, but do not add background
Problems entries. Closing and re-adding a tab starts a fresh diagnostic
lifecycle, so an older in-flight result cannot reappear after the clear. Other
LSP clients that do not send editor ownership metadata retain standard
`didOpen`-scoped diagnostics.

Diagnostics are deferred until the workspace scan completes, so
cross-file warnings reflect the full project rather than just the open
buffer. Each diagnostic carries a symbolic `code` (the rule IDs below)
and `source: "sight"`. LSP diagnostics, JSON, and SARIF use the
canonical uppercase rule IDs. `sight check` text output lowercases the
same rule IDs in its bracketed suffixes, for example `[undefined_macro]`.

## Quick reference

- **Silence one site** — add `// sight: ignore` or
  `// sight: ignore-next` on its own line above the offending statement, or
  add `// sight: ignore` as a trailing comment on the offending line.
  Suppresses undefined-symbol (`UNDEFINED_MACRO`, `UNDEFINED_VARIABLE`,
  `OUT_OF_SCOPE_SYMBOL`) and operator-style diagnostics on the targeted line.
  Lexer, parser / brace-style, and indentation diagnostics are not silenced
  this way — fix lexer/parser issues at the source, or turn indentation off via
  `sight.diagnostics.indentation` (it ships off by default).
- **Declare a symbol the analyzer can't see** — use
  [`sight: local`, `sight: global`, `sight: variables`, `sight: scalar`,
  `sight: matrix`, `sight: program`](declaration-directives.md). Forward-only:
  effective for the whole directive line and following lines. Declaration
  directives may also be trailing `//` comments.
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

| Rule ID | Default | Trigger |
|---|---|---|
| <a id="unbalanced-quotes"></a>`UNBALANCED_QUOTES` | error | A string literal is opened but never closed on the same statement. |
| <a id="unbalanced-block-comment"></a>`UNBALANCED_BLOCK_COMMENT` | error | `/*` is not matched by `*/`. |
| <a id="unterminated-statement"></a>`UNTERMINATED_STATEMENT` | error | A statement runs off the end of the file in `#delimit ;` mode without a terminating `;`. |
| <a id="continuation-no-space"></a>`CONTINUATION_NO_SPACE` | information (`styleWarnings`) | `///` continuation marker not preceded by whitespace (`foo///` instead of `foo ///`). |
| <a id="block-comment-in-star-comment"></a>`BLOCK_COMMENT_IN_STAR_COMMENT` | warning | A `/* ... */` block appears inside a `*` line comment, which Stata parses unexpectedly. |

## Parse and structural errors

Reported by the parser and context tracker. Severity is fixed (no
configuration key); two entries are warnings rather than errors because
Stata still runs the code.

| Rule ID | Default | Trigger |
|---|---|---|
| <a id="syntax-error"></a>`SYNTAX_ERROR` | error | Generic parser failure not covered by a more specific rule. |
| <a id="brace-else-same-line"></a>`BRACE_ELSE_SAME_LINE` | error | `} else {` style: Stata requires the closing brace and `else` on separate lines. |
| <a id="brace-not-alone"></a>`BRACE_NOT_ALONE` | error | A closing `}` shares a line with other code. |
| <a id="missing-program-end"></a>`MISSING_PROGRAM_END` | error | A `program` / `mata` / `python` block is not closed by `end`. |
| <a id="open-brace-alone"></a>`OPEN_BRACE_ALONE` | error | An opening `{` appears alone on a line where Stata expects it on the control statement. |
| <a id="unclosed-block"></a>`UNCLOSED_BLOCK` | error | An `if` / `foreach` / `forvalues` / `while` / frame / mata / python block is not closed. |
| <a id="code-after-open-brace"></a>`CODE_AFTER_OPEN_BRACE` | warning | Tokens follow `{` on the same line as the opening brace. Stata runs the block but ignores trailing code on that line. |
| <a id="forvalues-syntax"></a>`FORVALUES_SYNTAX` | error | Malformed `forvalues` range (e.g., missing `=` or bad `to`/`/` separators). |
| <a id="redundant-macro-suffix"></a>`REDUNDANT_MACRO_SUFFIX` | warning | A macro reference includes redundant trailing characters that Stata ignores. |
| <a id="invalid-macro-char"></a>`INVALID_MACRO_CHAR` | error | A macro name contains a character Stata does not allow in identifiers. |
| <a id="missing-expression-after-equals"></a>`MISSING_EXPRESSION_AFTER_EQUALS` | error | An `=` is followed by no expression: e.g., `gen x =`, an empty `if` / `while` condition, or an empty qualifier. |
| <a id="unbalanced-parentheses"></a>`UNBALANCED_PARENTHESES` | error | Mismatched `(` / `)` in an expression, `if` / `while` condition, or `by` / `bysort` qualifier. |
| <a id="orphan-close-brace"></a>`ORPHAN_CLOSE_BRACE` | error | A `}` appears with no matching opening block. |
| <a id="stray-token-in-condition"></a>`STRAY_TOKEN_IN_CONDITION` | error | Unexpected token inside an `if` / `while` / qualifier condition. |
| <a id="split-literal-in-condition"></a>`SPLIT_LITERAL_IN_CONDITION` | error | A string or compound literal is split across the condition boundary, leaving an unterminated literal in an `if` / `while` condition. |

## Embedded language context diagnostics

Reported by the context tracker for Mata and Python block structure.

| Rule ID | Default | Trigger |
|---|---|---|
| <a id="unclosed-mata-block"></a>`UNCLOSED_MATA_BLOCK` | error | A Mata block is opened but not closed. |
| <a id="unclosed-python-block"></a>`UNCLOSED_PYTHON_BLOCK` | error | A Python block is opened but not closed. |
| <a id="unexpected-end"></a>`UNEXPECTED_END` | error | An `end` appears where no embedded language block is open. |
| <a id="unexpected-end-command"></a>`UNEXPECTED_END_COMMAND` | error | An `end` command does not match the current embedded language context. |
| <a id="mismatched-end-python"></a>`MISMATCHED_END_PYTHON` | error | A Python block is closed with a mismatched delimiter. |
| <a id="nested-block-error"></a>`NESTED_BLOCK_ERROR` | error | Embedded language block nesting is invalid. |
| <a id="invalid-delimiter-position"></a>`INVALID_DELIMITER_POSITION` | error | A Mata or Python delimiter appears where it cannot start or end a valid block. |

## Semantic / scope diagnostics

The analyzer flags references it cannot resolve to a definition in the
current scope. All four codes are gated by the `undefinedMacro` or
`undefinedVariable` severity (see [How scope is decided](#how-scope-is-decided)).

| Rule ID | Default | Severity key | Trigger |
|---|---|---|---|
| <a id="undefined-macro"></a>`UNDEFINED_MACRO` | warning | `undefinedMacro` | `` `name' ``, `$name`, or `${name}` references a macro that is not in scope at the reference line. Also covers undefined scalars, matrices, and programs. |
| <a id="undefined-variable"></a>`UNDEFINED_VARIABLE` | off | `undefinedVariable` | A varlist position references a name Sight has not seen defined. See [What counts as a variable definition](#what-counts-as-a-variable-definition). |
| <a id="out-of-scope-symbol"></a>`OUT_OF_SCOPE_SYMBOL` | inherits | matches the underlying symbol's key | A reference resolves to a symbol that exists in the workspace but is not reachable from this file's scope chain. The diagnostic message names the file the symbol was found in. |
| <a id="missing-variable-name"></a>`MISSING_VARIABLE_NAME` | error | n/a | A command position requires a variable name and the parser found no token (e.g., `gen = 1`). |

A second class — *forward references* — also surfaces under
`UNDEFINED_MACRO` when a macro is used earlier in the same file than its
first definition (see [Forward references](#forward-references)).
For statically expanded `foreach` / `forvalues` constructed macro names,
the definition line is the `local` or `global` statement inside the loop
body that creates the concrete name:

```stata
foreach g in age sex {
    display `total_`g''       // UNDEFINED_MACRO: used before its definition
    local total_`g' = r(N)    // defines total_age, total_sex from here on
    display `total_`g''       // no warning — at or after the definition line
}
```

Positional macro arguments (`` `0' ``, `` `1' ``, …) bypass position
and scope checks: they are bound by the caller, not by lexical position.

## Operator style diagnostics

Each operator diagnostic has its own severity key, and each can be
turned off independently.

| Rule ID | Default | Severity key | Trigger |
|---|---|---|---|
| <a id="malformed-operator"></a>`MALFORMED_OPERATOR` | warning | `malformedOperator` | `= =`, which Stata does not treat as `==` in all expression contexts. |
| <a id="invalid-operator-sequence"></a>`INVALID_OPERATOR_SEQUENCE` | error | `invalidOperatorSequence` | Token sequences Stata cannot parse (e.g., `< \|`, `= ==`). |
| <a id="cstyle-logical-in-control-flow"></a>`CSTYLE_LOGICAL_IN_CONTROL_FLOW` | information | `cStyleLogicalInControlFlow` | `&&` / `\|\|` used in `if` / `else if`. Legal in Stata, but the canonical style uses `&` / `\|`. |
| <a id="mixed-logical-operators"></a>`MIXED_LOGICAL_OPERATORS` | warning | `mixedLogicalOperators` | `&` and `\|` mixed in one expression without parentheses; precedence is easy to misread. |
| <a id="spaced-compound-operator"></a>`SPACED_COMPOUND_OPERATOR` | information | `spacedCompoundOperator` | Compound operators split by whitespace that Stata accepts as the compact form: `< =`, `> =`, `! =`, and `~ =`. |
| <a id="chained-comparison"></a>`CHAINED_COMPARISON` | warning | `chainedComparison` | Two or more comparisons chained without a logical connector (e.g., `a != b != c`, `a < b < c`). Stata evaluates these left-to-right — `a < b < c` is `(a < b) < c` — so a chain is usually a missing `&` / `\|` or missing parentheses. |
| <a id="literal-macro-adjacency"></a>`LITERAL_MACRO_ADJACENCY` | hint | `literalMacroAdjacency` | A number or complete string literal placed directly against a following macro reference where the pair is an operand of a comparison/logical operator (e.g., `a == 1\`b'`, or `1\`b' == a`). Stata concatenates them during macro expansion — if `` `b' `` is `0`, `1\`b'` becomes `10`. Only flagged when a comparison/logical operator sits immediately before the literal or immediately after the macro, so intentional adjacency (`gen x\`i'`, function arguments, string interpolation) is left alone. |

These operator/expression rules are heuristic token-stream checks: they do not
parse per-command semantics, so they can fire inside text-storing commands
(e.g. `notes`, `char`, `local x <text>`) and do not cover every
bare-expression command. `LITERAL_MACRO_ADJACENCY` additionally recognizes
`assert` as a bare-boolean-expression command when it appears in command
position (optionally after `capture` / `quietly` / `noisily` prefixes and
their colons), so `assert 1\`b'` is flagged like `if 1\`b'`; other
bare-expression commands remain uncovered. This matches the scope of the
existing operator diagnostics; see
[#268](https://github.com/jbearak/sight/issues/268) for the known edge cases
and the command-context improvement tracked for later.

## Indentation diagnostics

Off by default. Enable with `sight.diagnostics.indentation: true`.
This is an on/off toggle — there is no severity key; both codes are
emitted at `information` severity.

| Rule ID | Trigger |
|---|---|
| <a id="unnecessary-indentation"></a>`UNNECESSARY_INDENTATION` | A line is indented past the AST-computed depth. |
| <a id="missing-indentation"></a>`MISSING_INDENTATION` | A line is at a shallower indent than its block depth. |

## Cross-file diagnostics

Reported during cross-file scope resolution. Severity is configurable
via the `crossFile.diagnostics.*` keys in `sight.toml`.

| Rule ID | Default | Severity key | Trigger |
|---|---|---|---|
| <a id="path-case-mismatch"></a>`PATH_CASE_MISMATCH` | `auto` | `crossFile.diagnostics.caseMismatch` | A `do`/`run`/`include` command or cross-file directive (`sight: do`, `sight: run`, `sight: include`, `sight: done-by`, `sight: run-by`, `sight: included-by`) references a path that differs from the on-disk file by letter case only. The file is resolved and symbols are inherited normally; only the spelling is wrong. |
| <a id="cross-file-missing-file"></a>`CROSS_FILE_MISSING_FILE` | warning | `crossFile.diagnostics.missingFile` | A `do`/`run`/`include` command or cross-file directive references a target file Sight cannot read. |
| <a id="cross-file-truncated"></a>`CROSS_FILE_TRUNCATED` | warning | `crossFile.diagnostics.maxDepth` | Cross-file scope resolution hit a configured traversal depth cap. Results may be incomplete, but this is not treated as an undefined-symbol error by `sight check`. |

### `PATH_CASE_MISMATCH`

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

## File-level check diagnostics

`sight check` can also emit diagnostics for files that could not be
analyzed. These use the same symbolic `code` field as analyzer
diagnostics.

| Rule ID | Trigger |
|---|---|
| <a id="sight-file-too-large"></a>`SIGHT_FILE_TOO_LARGE` | An explicitly checked source file exceeds `indexing.maxFileSizeBytes`. |
| <a id="sight-file-not-indexed"></a>`SIGHT_FILE_NOT_INDEXED` | An explicitly checked source file was skipped because `crossFile.maxIndexedFiles` was reached. |
| <a id="sight-unreadable"></a>`SIGHT_UNREADABLE` | A target file could not be read or decoded when `sight check` tried to analyze it. |
| <a id="sight-invalid-encoding"></a>`SIGHT_INVALID_ENCODING` | A target file is not valid UTF-8, so `sight check` could not decode its contents. |

## Configuration

Diagnostics keys live under `sight.*` in VS Code's `settings.json`:

```jsonc
{
  "sight.diagnostics.enabled": true,           // master switch
  "sight.diagnostics.indentation": false,      // enable indentation diagnostics
  "sight.diagnostics.severity.undefinedMacro":              "warning",
  "sight.diagnostics.severity.undefinedVariable":           "off",
  "sight.diagnostics.severity.styleWarnings":               "information",
  "sight.diagnostics.severity.malformedOperator":           "warning",
  "sight.diagnostics.severity.spacedCompoundOperator":      "information",
  "sight.diagnostics.severity.invalidOperatorSequence":     "error",
  "sight.diagnostics.severity.cStyleLogicalInControlFlow":  "information",
  "sight.diagnostics.severity.mixedLogicalOperators":       "warning",
  "sight.diagnostics.severity.chainedComparison":           "warning",
  "sight.diagnostics.severity.literalMacroAdjacency":       "hint"
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
styleWarnings = "information"
```

See the [Project Configuration File](configuration.md#project-configuration-file)
section for the full `sight.toml` schema and precedence rules.

Each severity key accepts `"error"`, `"warning"`, `"information"`,
`"hint"`, or `"off"`. Notes:

- `undefinedMacro` also governs undefined scalars, matrices, programs,
  and the `OUT_OF_SCOPE_SYMBOL` variants of those categories.
- `undefinedVariable` is experimental and ships off — see
  [Why undefined-variable is off by default](#why-undefined-variable-is-off-by-default).
- `styleWarnings` currently gates `CONTINUATION_NO_SPACE`.
- Parse and brace-style diagnostics have no per-category control and
  `sight: ignore` does not silence them — fix the underlying issue.
- Indentation diagnostics ship off; turn them on with the boolean
  `sight.diagnostics.indentation`. Both indentation rule IDs emit at
  `information` severity (there is no severity key), and `sight: ignore`
  does not silence individual sites.

## Suppressing diagnostics in source

| Directive | Effect |
|---|---|
| `// sight: ignore` | On its own comment line, suppresses undefined-symbol and operator-style diagnostics on the next non-trivia statement. As a trailing `//` comment, suppresses those diagnostics on the same line. Does not silence lexer, parser / brace-style, or indentation diagnostics. |
| `// sight: ignore-next` | Suppresses undefined-symbol and operator-style diagnostics on the next non-trivia statement. It does not suppress diagnostics on its own source line. |

When the next statement spans several physical lines — via `///`
continuations, or under `#delimit ;` — a standalone `sight: ignore` /
`sight: ignore-next` covers every line the statement spans, wherever in
the statement the flagged construct sits. A statement that opens a block
(`{`, `mata`, or `python`) is covered through its header line only, but
never the block body: to suppress a diagnostic inside a block, put the
directive on the offending statement inside the block. A trailing
`// sight: ignore` on any physical line an operator-style diagnostic
spans also suppresses it.
| `// sight: local name [name ...]` | Declares one or more local macros from the directive line forward. |
| `// sight: global name [name ...]` | Same, for globals. |
| `// sight: variables var [var ...]` | Declares variables (e.g., loaded from a `.dta` file). |
| `// sight: scalar name`, `// sight: matrix name`, `// sight: program name` | Declares scalars, matrices, and programs respectively. |

Directives other than `sight: ignore` and `sight: ignore-next` must occupy
their own `//` or line-leading `*` comment line. `sight: ignore` may also be
used as a trailing `//` comment for same-line suppression; `sight: ignore-next`
always targets the following statement. `/* ... */` block comments are not
directive comments. `@lsp-` spellings are permanent aliases for all directive
forms above.

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

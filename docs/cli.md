# CLI

Sight ships a `sight` binary for editor language-server use, command-line
checks, JSON output of parsed Stata for other tools, and an enhanced Stata
console.

## `sight check`

Run the same static diagnostics Sight publishes in the editor, but in a
headless batch suitable for CI:

```text
sight check [OPTIONS] [PATHS...]
```

`sight check` indexes the workspace so `do`, `run`, and `include` chains resolve
correctly. Positional `PATHS...` only filter which files report diagnostics.
With no paths, Sight reports discovered `.do`, `.ado`, `.doh`, and `.mata` files
under the workspace.

Workspace discovery respects `.gitignore` by default, both when indexing
cross-file relationships and when selecting files to report. This also applies
to explicitly named directories. An explicitly named file, such as
`sight check local/analysis.do`, is checked even if ignored. Directly resolved
dependencies remain available for cross-file analysis.

To disable Gitignore filtering, set this in `sight.toml`:

```toml
[workspace]
respectGitignore = false
```

This keeps Sight's other discovery rules in effect. `--no-config` uses the
built-in default, which respects `.gitignore`. The CLI does not read VS Code's
`settings.json`. See [Gitignore rules](configuration.md#gitignore-rules) for
ancestor lookup, nested rules, and workspace scope.

Automatic discovery skips dot-prefixed descendant directories, including
`.claude/worktrees`, `.worktrees`, and version-control metadata, before scanning
their contents. Dot-prefixed source filenames such as `.helper.do` are still
included. A selected workspace root or explicit directory is entered even if
its name or an ancestor is hidden; hidden directories below it are still
skipped. An explicitly named file is always checked. For example:

```text
sight check .claude/worktrees/replica/main.do
sight check --workspace .claude/worktrees/replica
```

Paths matching the `workspace.exclude` setting (see
[configuration](configuration.md#excluding-files-and-directories)) are skipped
by both the index and the directory walk. An explicitly-named path
(`sight check output/foo.do`) is always checked, even when it matches
`workspace.exclude`; exclusion only filters directory walks.

Options:

- `--workspace DIR`: workspace root to index. Defaults to the current directory.
- `--config PATH`: explicit `sight.toml`, resolved from the invocation
  directory.
- `--no-config`: ignore `sight.toml` and use built-in defaults.
- `--format text|json|sarif`: output format. Defaults to `text`.
- `--max-severity off|hint|info|warning|error`: highest severity that does not
  fail the build. Defaults to `info`, so warnings and errors fail.
- `--quiet`: suppress the text summary line.
- `--color auto|always|never`: colorize text output.
- `--no-color`: alias for `--color never`.

Text output prints diagnostic rule IDs in lowercase bracketed form, such as
`[undefined_macro]`. JSON and SARIF keep the canonical uppercase codes.

Exit codes:

- `0`: no diagnostic exceeded `--max-severity`.
- `1`: at least one diagnostic exceeded `--max-severity`.
- `2`: operator or usage error, such as an unknown or malformed flag, invalid
  workspace, missing explicit path, or malformed config.

## CI Examples

Both examples run `sight check` on pull requests and on pushes to your default
branch (`main`). Pushing to a branch that already has an open pull request runs
the check only once — the push-to-`main` trigger is scoped to `main` precisely
so it does not duplicate the pull-request run.

Running the check does not by itself block a merge. To prevent broken code from
landing, mark the Sight check as a required status check (GitHub branch
protection) or a merge check (Bitbucket), so a failing check stops the merge.

### GitHub Actions

Use [`jbearak/setup-sight`](https://github.com/jbearak/setup-sight) to install
the prebuilt Sight CLI from GitHub Releases. You can copy
[`docs/examples/ci/github-actions-sight.yml`](examples/ci/github-actions-sight.yml)
to `.github/workflows/sight.yml`:

```yaml
name: Sight

# Runs on pull requests and on pushes to the default branch (main).
# Scoping push to main avoids a duplicate run when you push to a branch
# that already has an open pull request (pull_request already covers that).
"on":
  push:
    branches: [main]
  pull_request:

jobs:
  sight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jbearak/setup-sight@v1
        with:
          version: latest
      - name: Check Stata sources
        run: sight check
```

### Bitbucket Pipelines

Install Sight from npm in a Node build image. You can copy
[`docs/examples/ci/bitbucket-pipelines.yml`](examples/ci/bitbucket-pipelines.yml)
to `bitbucket-pipelines.yml`:

```yaml
# Runs on pull requests and on pushes to the default branch (main).
# repository-push is scoped to main so pushing to a branch with an open
# pull request runs only once (via pullrequest-push), not twice.
pipelines:
  custom:
    Sight:
      - step:
          name: Sight
          image: node:24
          script:
            - npm install -g @jbearak/sight
            - sight check

triggers:
  repository-push:
    - condition: BITBUCKET_BRANCH == "main"
      pipelines:
        - Sight
  pullrequest-push:
    - condition: glob(BITBUCKET_BRANCH, "**")
      pipelines:
        - Sight
```

If VS Code's YAML extension reports an unresolved Bitbucket schema reference
such as `pipelines_configuration`, the pipeline file can still be valid. To
silence that editor-only diagnostic in the workspace, add `.vscode/settings.json`:

```json
{
  "yaml.schemaStore.enable": false,
  "yaml.schemas": {
    "./.vscode/bitbucket-pipelines.schema.json": "bitbucket-pipelines.yml"
  }
}
```

Then add `.vscode/bitbucket-pipelines.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Bitbucket Pipelines",
  "type": "object",
  "additionalProperties": true
}
```

### Other CI Systems

For any CI system with Node.js 24 or newer available:

```bash
npm install -g @jbearak/sight
sight check
```

`.mata` files are included as report targets because Sight indexes them for
symbols, but v1 diagnostics for Mata are limited to what the current parser and
diagnostic pipeline can produce.

## `sight parse` and `sight graph`

Two commands print Sight's view of Stata code as versioned JSON, for tools
that translate or analyze Stata:

```text
sight parse --json FILE...        # statements and expressions of each file
sight graph --json [ROOT]         # do/run/include graph of a project
```

`sight parse` prints one JSON document for one FILE. With several FILEs it
prints [JSON Lines](https://jsonlines.org): one document per line, in argument
order. It exits 0 when every file was read, even if the files have syntax
errors (those are data, in `errors`). An unreadable file prints a document
with an `error` field in its place and the command exits 2. Bad arguments
also exit 2.

`sight graph` indexes ROOT (default: the current directory) the way
`sight check` does: it reads `sight.toml` (or `--config PATH`, or none with
`--no-config`) and honors `.gitignore` and `workspace.exclude`. It exits 0 on
success and 2 for bad arguments, a ROOT that isn't a directory, or a config
error.

Both outputs are compact JSON followed by a newline.

### Schema versioning

Each document has `schema_version` (currently `1`) and `sight_version`.

- Adding a field, or a new value for a `kind`-like field, does not change
  `schema_version`. Consumers should ignore fields they don't know.
- Removing or renaming a field, or changing what a field means, increases
  `schema_version`. Consumers should reject versions they don't know.

### Conventions

- Positions follow the Language Server Protocol: 0-based `line`, 0-based
  `character` in UTF-16 code units, `end` exclusive. A range is
  `{"start": {"line", "character"}, "end": {"line", "character"}}`.
- Every object that comes from source has a `range`.
- Stata names are reported exactly as written. Canonical names are matched
  by exact case, as Stata does (`REG` is not `regress`).
- Absent optional values are `null`; absent lists are `[]`.

### Expressions

Expressions (`if` conditions, `= exp`, weights, option arguments, loop
bounds) are trees of objects tagged by `kind`:

| `kind` | Fields |
| --- | --- |
| `number` | `text` (as written), `value` |
| `missing` | `text` (`.`, `.a` ... `.z`), `extended` (`"a"` ... `"z"`, or null) |
| `string` | `quote` (`simple` or `compound`), `text` (with quotes), `parts` |
| `variable` | `name`; `parts` when the name is built from macros, as in `` `v'_lag `` |
| `system_variable` | `name`: `_n`, `_N`, `_pi`, `_rc`, or `_cons` |
| `macro_ref` | `scope` (`local`/`global`), `form` (`name`, `eval` for `` `=exp' ``, `extended` for `` `:fcn ...' ``, `increment` for `` `++i' ``), `text`, `name`, and when they apply `name_parts`, `macval`, `expression`, `extended`, `increment`, `increment_position` |
| `unary` | `op` (`-`, `+`, `!`), `op_text` (as written; `~` is `!`), `operand` |
| `binary` | `op` (`+ - * / ^ == != < > <= >= & \|`), `op_text` (`~=` is `!=`), `left`, `right` |
| `call` | `name`, `name_range`, `args` |
| `subscript` | `target`, `indices` (`x[_n-1]`, `M[1,2]`) |
| `coefficient` | `which` (`_b`, `_se`, `_coef`), `spec` (text inside the brackets), `spec_range` |
| `stored_result` | `result_class` (`r`, `e`, `s`, `c`), `name`, and `name_parts` when the name has macros |
| `paren` | `expression`; explicit parentheses are kept |
| `varlist` | `items`: `variable`, `wildcard`, `variable_range`, `macro_ref`, or `unparsed` |
| `wildcard` | `pattern` (`inc*`, `x?`) |
| `variable_range` | `from`, `to` |
| `observation` | `which` (`first`/`last`), `text` (`f`, `F`, `l`, `L`); only in `in` ranges |
| `unparsed` | `text`, `reason` (`factor_or_time_series_operator`, `syntax_error`, `empty`) |

`parts` lists hold `{"kind": "text", "value", "range"}` objects and
`macro_ref` objects.

Parsing never fails. Syntax that the parser does not model becomes an
`unparsed` node with its text and range. That includes factor-variable and
time-series operators (`i.region`, `L.x`) and matrix operators. An unparsed
node replaces the smallest part it can: in `L.x + 1` only `L.x` is unparsed.

Precedence follows Stata 18, highest first: `^`; unary `-` and `!`; `*` and
`/`; `+` and `-`; comparisons; `&`; `|`. All binary operators associate to
the left, so `2^3^2` is `(2^3)^2`, `-2^2` is `-(2^2)`, and `!x == 1` is
`(!x) == 1`.

### `sight parse` documents

```json
{
  "schema_version": 1,
  "sight_version": "0.17.0",
  "path": "/abs/path/clean.do",
  "line_count": 16,
  "statements": [],
  "comments": [],
  "errors": [{"source": "parser", "code": "SYNTAX_ERROR", "message": "...", "range": {}}]
}
```

`comments` lists the comments that no statement reports, in source order:
all of them in a file with no statements (for example a header of
comments only), and the comment-only lines after the last statement
(including after a final `#delimit ;`). In a file with statements,
header comments are the first statement's `leading` comments. Each
comment appears exactly once.

`errors` lists lexer and parser errors in source order (`source` is `lexer`
or `parser`). An unreadable file's document has `schema_version`,
`sight_version`, `path`, and `error: {"message"}` instead.

Every statement has:

- `kind`: `command`, `block`, `if`, `else`, `foreach`, `forvalues`, `while`,
  `program`, `macro`, `syntax`, `embedded`, `delimit`, or `frame`.
- `range` and `text`: the exact source of the statement, including `///`
  continuations and comments inside it. In `#delimit ;` mode the closing `;`
  is not included.
- `delimit`: `cr` or `semicolon`, the `#delimit` mode the statement is in.
- `comments`: `{"leading": [], "trailing": [], "interior": [], "block_end": []}`:
  comments before and after the statement, inside it (between its tokens,
  including `///` continuations), and, for statements with a body, before
  the closing `}` or `end`. `trailing` comments start on the statement's
  last line, or on the line where the previous trailing comment ends (as
  in `di 1 /* a */ // b`); a comment on a line of its own after a
  statement is never `trailing`. Comments inside body statements belong to those
  statements. Each comment is `{"style", "text", "range", "directive"}`,
  where `style` is `slash` (`//`), `star` (`*`), `block` (`/* */`), or
  `continuation` (`///` with any text after it), and `directive` is described
  under "Directives" below. As in Stata 18, a `//` or `///` is a comment
  only at the start of a line or after a space or tab (or, under
  `#delimit ;`, right after the `;` that ends a statement). Otherwise it
  is part of the statement's text: `local a b///` has the value `b///`,
  and `use http://example.com/d` keeps the whole URL.

Statements with a body (`block`, `if`, `else`, loops, `program`, `frame`)
have `body`, a list of statements. `command`, `block`, `macro`, `syntax`,
`embedded`, and control-flow statements have `prefixes` (see `command`), so
`capture local y 2` is a `macro` with a `capture` prefix, and
`version 14: local x = 1` is a `macro` with a `version` prefix.

#### Directives

A comment's `directive` is the [Sight directive](declaration-directives.md)
it carries, read by the same code the editor uses, or `null`. It is `null`
for an ordinary comment and for a directive Sight does not honor where it
stands. `sight:` and the `@lsp-` alias, the optional colon, and quoted or
unquoted paths all give the same object.

| `kind` | Other fields | Honored in |
|---|---|---|
| `declare` | `symbol_kind`: `local`, `global`, `variables`, `scalar`, `matrix`, or `program`; `names`: the declared names | any `//` or `*` line comment, standalone or after code |
| `ignore`, `ignore_next` | `target_range` | any `//` or `*` line comment, standalone or after code |
| `forward` | `call_type`: `do`, `run`, or `include`; `raw_path` | a comment line anywhere |
| `backward` | `call_type`: `do` (`done-by`), `run` (`run-by`), or `include` (`included-by`); `raw_path` | a header comment line |
| `standalone` | none | a header comment line |
| `working_directory` | `raw_path` | a header comment line |

- A comment line is a line holding only the comment. The header is the
  comment and blank lines before the first line of code.
- Never honored: a directive inside a `/* */` comment, a `forward`,
  `backward`, `standalone`, or `working_directory` directive after code on
  the same line, a header-only directive after the header, and a malformed
  one (for example a declaration with no valid name).
- Only the last `working_directory` and the first `standalone` count; the
  others are `null`. A `forward` directive on the line after an `ignore` or
  `ignore_next` comment is suppressed, so it is `null` too.
- `raw_path` is the path as written, without quotes. `sight graph` resolves
  it, and reports `run-by` as `do`.
- `target_range` is the code Sight suppresses diagnostics on, from its first
  token to its last, or `null` when there is none (for example an `ignore`
  at the end of the file). A standalone `ignore` and any `ignore_next` cover
  the next statement, all of its `///` or `#delimit ;` lines; a statement
  that opens a block is covered through its `{` only, never its body. An
  `ignore` after code covers its own line. A comment just before a block's
  closing `}` or `end` covers the first line of the statement after the
  block.

#### `command`

```json
{
  "kind": "command",
  "text": "bysort hhid (pid): gen double n = _n if inc > 0",
  "name": "gen",
  "canonical_name": "generate",
  "prefixes": [{
    "name": "bysort", "canonical_name": "bysort",
    "by_varlist": {"kind": "varlist", "items": [{"kind": "variable", "name": "hhid"}]},
    "sort_varlist": {"kind": "varlist", "items": [{"kind": "variable", "name": "pid"}]},
    "arguments": null, "options": [], "frame": null
  }],
  "args": [{"text": "double"}, {"text": "n"}],
  "varlist": {"kind": "varlist", "items": []},
  "assignment": {"text": "_n", "expression": {"kind": "system_variable", "name": "_n"}},
  "if": {"text": "inc > 0", "expression": {"kind": "binary", "op": ">"}},
  "in": null, "weight": null, "using": null, "options": []
}
```

(Ranges and some nested fields are omitted above.)

- `name` is the command as written. `canonical_name` is the full name of a
  built-in command that `name` abbreviates (`reg` is `regress`), or null for
  anything else, such as user programs and community commands.
- `prefixes`, outermost first, each with `name`, `canonical_name`, `range`,
  `by_varlist`, `sort_varlist`, `arguments`, `options`, and `frame`:
  - `capture`, `quietly`, `noisily`, and their abbreviations;
  - `by` and `bysort` with `by_varlist`, `sort_varlist` (the parenthesized
    sort variables), and `options` (`, sort`);
  - `frame name:` with `frame`;
  - prefixes that take arguments before a colon: `svy`, `version`, `xi`,
    `bootstrap` (`bs`), `jackknife`, `simulate`, `statsby`, `rolling`,
    `permute`, `mi`, `nestreg`, `stepwise` (`sw`), `fp`, `mfp`, `collect`,
    and `eststo`, with the raw text before any comma in `arguments` and the
    options after it in `options`.
- `args`: the arguments between the command name and the first qualifier or
  comma, in source order, as `{"text", "range"}`. Tokens that touch are one
  arg, so `"$root/x`i'.dta"` and `i.region` are each one. The `using`
  clause is not included. For commands such as `display`, `assert`, and
  `label define`, `args` holds all of their arguments.
- `varlist`: `args` parsed as a varlist when every arg is a name, wildcard,
  range, macro, or factor-variable term; otherwise null.
- `assignment`: `{"text", "expression"}` for `= exp`, or null. For `egen`,
  `expression` is a `call`; row and grouping functions (`rowtotal`,
  `rowmean`, `group`, `tag`, `concat`, ...) have `varlist` arguments.
- `if`: `{"text", "expression"}`, or null.
- `in`: `{"text", "first", "last", "range"}`, or null. `last` is null for
  `in 5`. A range that is not `#` or `#/#` (with `f`, `l`, negative
  counts, or macros) has an `unparsed` `first`.
- `weight`: `{"keyword", "kind", "text", "expression", "range"}`, or null.
  `kind` is `fweight`, `aweight`, `pweight`, `iweight`, or `weight`, or null
  for the `` [`weight'`exp'] `` idiom of programs that use `syntax`.
- `using`: `{"range", "paths": [{"text", "quote", "parts", "range"}]}`, or
  null. `quote` is `simple`, `compound`, or null for an unquoted name.
- `options`: `[{"name", "canonical_name", "argument", "argument_range",
  "expression", "range"}]`. `argument` is the raw text inside the
  parentheses, or null. `expression` is that text parsed as an expression
  when it parses with no `unparsed` part, otherwise null. So `level(95)`
  has a number and `absorb(firm year)` has null. `canonical_name` is the
  full name of the command's built-in option that `name` abbreviates, or
  null.

The qualifiers may appear in any order in the source, as Stata allows.

#### Other statements

- `block`: a prefix with a brace body, such as `capture { ... }`:
  `prefixes`, `body`.
- `if`: `condition: {"text", "expression"}`, `single_statement` (true for
  `if x display 1`), `body`.
- `else`: `else_if` and `body`. An `else if` is an `else` whose body is a
  single `if` statement, with `else_if: true`. An `else` follows its `if`
  as the next statement in the same list.
- `foreach`: `variable`, `spec: {"keyword", "list_type", "text", "items"}`,
  `body`. `keyword` is `in` or `of`, `list_type` is `varlist`, `newlist`,
  `numlist`, `local`, `global`, or null, and `items` are the list's
  `{"text", "range"}` items as written.
- `forvalues`: `variable`, `spec: {"text", "form", "first", "second",
  "step", "last"}`, `body`. `form` is `slash` (`1/10`), `paren` (`1(2)10`),
  `to` (`1 3 to 9` or `1 3 : 9`, where `second` is the second value), or
  null when the range has another shape and `first` holds all of it.
- `while`: `condition: {"text", "expression"}`, `body`.
- `program`: `name`, `define_options` (raw text after the comma, such as
  `rclass`, or null), `args` (`{"name", "range"}` from the program's `args`
  statements), `syntax`, `body`. `syntax` is the parsed `syntax` signature
  or null: `{"arguments": [{"type", "name", "optional", "range"}],
  "options": [{"name", "min_abbreviation", "required", "optional",
  "argument_type", "default", "range"}], "allows_arbitrary_options"}`.
- `syntax`: `prefixes`, `signature` (as above).
- `macro`: `scope` (`local` or `global`), `name`, `form`, `value`,
  `value_parts`, `expression`, `extended`, `increment`. `form` is `value`
  (`local a x y`), `expression` (`local n = exp`, with `expression`),
  `extended` (`local w : word 1 of ...`, with `extended: {"function",
  "args"}`), or `increment` (`local ++i`, with `increment`). `value` is the
  raw value text. For the `value` form, `value_parts` splits it into text
  and `macro_ref` parts.
- `embedded`: a Mata or Python block, kept opaque: `language` (`mata` or
  `python`), `inline` (true for `mata: ...` on one line), `prefixes`,
  `content: {"text", "range"}`.
- `delimit`: `mode` (`cr` or `semicolon`), the mode from the next statement
  on.
- `frame`: `frame name { ... }`: `frame`, `body`.

### `sight graph` documents

```json
{
  "schema_version": 1,
  "sight_version": "0.17.0",
  "root": "/abs/project",
  "files": [{"path": "main.do", "standalone": false, "error": null}],
  "entry_points": ["main.do"],
  "edges": [{
    "caller": "main.do", "call_type": "do", "range": {},
    "raw_path": "clean.do", "arguments": ["2019", "\"rural\""],
    "static": true, "source": "command",
    "working_directory": "/abs/project/code",
    "target": "code/clean.do", "resolution": "exact"
  }],
  "unresolved": [],
  "cycles": [["loop/a.do", "loop/b.do"]]
}
```

- `files`: the `.do`, `.ado`, and `.doh` files under ROOT, sorted, as paths
  relative to ROOT with `/` separators. `standalone` is true for files with
  the `sight: standalone` directive. `error` is null, or a message when the
  file could not be read (for example, it is not valid UTF-8). A file with an
  error is listed, and calls to it resolve, but its own calls are not in
  `edges`; Sight also warns about it on stderr.
- `edges`: one per call site, including repeated calls to the same file.
  They are sorted by `caller`. A caller's own call sites come first in
  source order, then the backward-directive edges that name it, by
  `target`.
  - `caller`: the calling file.
  - `call_type`: `do`, `run`, or `include`. A `run-by` directive is
    reported as `do`.
  - `range`: the call site; for a backward directive, the directive in the
    child file.
  - `raw_path`: the path as written.
  - `arguments`: the raw tokens after the path (`do clean.do 2019`), or
    `[]`.
  - `static`: false when the path contains a macro reference.
  - `source`: `command` for `do`/`run`/`include` statements, `directive`
    for forward directives (`sight: do file.do`), or `backward_directive`
    for `sight: done-by`/`run-by`/`included-by` in a child file, which
    names that file's caller.
  - `working_directory`: the absolute directory the path is resolved
    against at the call site, after top-level literal `cd` commands and
    `sight: cd` directives; null when it is the caller's own directory.
  - `target`: the called file, relative to ROOT (absolute when outside
    ROOT), or null when unresolved.
  - `resolution`: `exact`, `case_only` (found, but the case differs from
    the file on disk), `ambiguous` (several files differ only by case),
    `missing` (no such file), or `dynamic` (the path has a macro).
- `unresolved`: indexes into `edges` whose `resolution` is not `exact` or
  `case_only`.
- `entry_points`: files with no incoming resolved edge from another file,
  sorted. A backward directive counts as an incoming edge when its parent
  file exists.
- `cycles`: strongly connected components of the resolved edges that have
  more than one file, or one file that calls itself. Each is sorted, and the
  list is sorted by first member.

## `sight console`

Run Stata's console with syntax highlighting, Tab completion, history and
colored output (experimental). On Windows, where Stata has no console, it
drives the Stata application through Automation:

```text
sight console [OPTIONS] [-- STATA_ARGS...]
```

See [Sight console](console.md) for options, keys and limits, and
[Exit codes on Windows](console.md#exit-codes-on-windows) for the codes
editors can act on.

## Language server

For editor integration, Sight runs as a Language Server Protocol server:

```text
sight --stdio      # LSP over stdin/stdout (default transport)
sight --node-ipc   # LSP over Node IPC (used by the VS Code client)
```

What a bare `sight` (no subcommand) does depends on where its stdin comes from:

- **Spawned over a pipe** — e.g. by an editor — it starts the server, defaulting
  to the stdio transport. So `sight` and `sight --stdio` are equivalent here;
  both block while they speak the protocol over their input stream.
- **Typed at an interactive terminal** (a TTY) it prints this help instead of
  starting the server, so it does not look like a hang. Pass `--stdio`
  explicitly if you want the server in a terminal anyway.

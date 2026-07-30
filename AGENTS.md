# Sight Development Guidelines

Sight is a static analyzer and Language Server Protocol (LSP) implementation for
Stata, with a VS Code client in `client/`. Start with [README.md](README.md) for
features and [DEVELOPMENT.md](DEVELOPMENT.md) for setup, builds, tests, and
releases. Load detailed documentation only for the area you are changing.

## Non-negotiable language rule: Stata is case-sensitive

Stata commands, keywords, variables, macros, and programs are case-sensitive.
Use exact string comparison for source-language matching. For example,
`display` is valid but `Display` is not; `myVar` and `myvar` are different
symbols. Do **not** normalize Stata keywords or commands with `toLowerCase()`.

Case-insensitive handling is acceptable only where case is not Stata syntax:

- file extensions, subject to filesystem behavior;
- Sight/LSP directives, which are Sight conventions;
- command-database convenience lookups that compare one user-typed fragment
  with canonical database entries (the database normalizes on entry).

This exception does not cover hardcoded canonical command lists in providers or
comparisons between two source-text values at the same position. Keep those
exact-case. If adding an exception, document why it is not Stata-language
matching.

## Architecture map

The main pipeline is:

```text
source -> lexer -> parser -> analyzer -> providers -> LSP response
```

Important locations:

- `src/lexer/`, `src/parser/`, `src/analyzer/`: language processing.
- `src/providers/`: completion, definition, references, diagnostics, hover,
  symbols, and formatting.
- `src/context-tracker/`: Stata/Mata/Python context.
- `src/document-store.ts`: open-document state and update coordination.
- `src/server.ts`: Node IPC entrypoint; `src/server-factory.ts`: server wiring;
  `src/server-handlers.ts`: request/notification handler factories.
- Root source is ESM, but the VS Code extension and copied server are
  intentionally bundled as CommonJS for `vscode-languageserver` compatibility.
  Do not remove their `--format=cjs` or nested package declarations without
  validating extension startup.
- `src/indexer/`: workspace symbols and dependency discovery.
- `src/dependency-graph/`, `src/scope-resolver/`,
  `src/forward-scope-resolver/`, `src/directive-parser/`: cross-file analysis.
- `src/config-file/` and `src/utils/config-validator.ts`: `sight.toml` loading,
  schema mapping, merging, and validation.
- `src/command-database/`, `src/commands/`: command metadata and fallbacks.
- `src/pretty-printer/`, `src/comment-processor/`, `src/smcl-parser/`:
  formatting and SMCL support.
- `client/src/`: VS Code extension; `client/src/send-to-stata/`: execution
  commands; `client/syntaxes/stata.tmLanguage.json`: hand-maintained grammar.
- `src/types/index.ts`: shared types; `src/index.ts`: public barrel exports.

Prefer source comments and tests over this file for implementation details.
Relevant behavior references include:

- [Cross-file scope](docs/cross-file.md)
- [Diagnostics](docs/diagnostics.md)
- [Completion](docs/completion.md)
- [Find references](docs/find-references.md)
- [Formatting](docs/formatting.md)
- [Send to Stata](docs/send-to-stata.md)
- [Configuration](docs/configuration.md)

Some deliberate contracts that are easy to misread:

- Workspace symbols support completion/navigation but do not by themselves
  suppress undefined-macro diagnostics; resolved execution scope does.
- Find references intentionally uses different scopes for local macros,
  non-local symbols, and variables. Treat
  [docs/find-references.md](docs/find-references.md) as authoritative.
- `include` and `do`/`run` have different local-macro inheritance semantics.
  Preserve call-site ordering and precedence rules described in
  [docs/cross-file.md](docs/cross-file.md).
- Open-document, dependency, and diagnostic work is asynchronous. Before
  changing lifecycle or cache behavior, trace stale-update guards and tests
  rather than simplifying from a single call site.

## Development workflow

Use Bun for repository work:

- `bun install`, not `npm install`;
- `bun run <script>`, not `npm run <script>`;
- `bunx <package>`, not `npx <package>`;
- `bun <file>`, not `node <file>`;
- `bun test`, not Jest directly.

Follow the existing module's naming and comment style. Make focused changes and
add regression tests for behavior changes.

Before opening a PR, run each gate independently so one success cannot hide an
earlier failure:

```bash
bun run check:line-endings
bun run typecheck
bun test ./tests
bun run lint   # eslint; intentionally separate and not run by CI
```

Use `SIGHT_TEST_LOG=1` when debugging tests that normally suppress expected
error-path warnings.

### Test layout and special rules

- `tests/unit/`: component tests.
- `tests/integration/`: cross-component behavior.
- `tests/property/`: fast-check properties and shared generators.
- Reproduction tests may live directly under `tests/`.

All formatter behavior must be tested in both formatter modes. Use the helpers
in `tests/property/helpers/formatter-test-utils.ts`:

- `for_each_formatter_mode()`;
- `for_each_formatter_mode_property()`;
- `create_formatter_config()`;
- `skip_for_mode()` and `mode_specific_assertion()` only for intentional
  mode-specific behavior.

Stata treats `if` and `in` as qualifiers in many statement positions. Property
tests that need an ordinary identifier in varlist/expression contexts should use
`arbitrary_non_reserved_identifier()` and
`RESERVED_QUALIFIER_KEYWORDS` from
`tests/property/generators/primitives.ts`, exported through
`tests/property/generators/index.ts`.

## Code conventions

Match surrounding code first. Unless the file establishes another convention:

- Use clear `snake_case` names for new local variables and helper functions.
- Existing exported APIs and class methods may use `camelCase`; do not rename
  them merely for style.
- Use `UPPER_SNAKE_CASE` for constants.
- Include units in names (`time_ms`, `size_bytes`, `age_years`).
- Prefer descriptive names over abbreviations.
- Loop-scoped values usually use `my_`; collections created primarily for
  iteration use `the_`. Single-letter indices (`i`, `j`, `k`) are fine.
- Use 4-space indentation unless the file uses 2 spaces; never introduce tabs.
- Keep code near 80 columns and comments near 72 columns where practical.
- Prefer simple, readable implementations over clever ones.

Use TypeScript to make invalid states difficult to represent:

- Avoid `any`; use concrete types, unions, or `unknown` with narrowing.
- Narrow `StataNode` and other discriminated unions by `type` before accessing
  variant-specific properties.
- Use reusable type guards where the same narrowing recurs.
- Handle absent array entries and optional properties explicitly.
- Do not use type assertions to bypass a model mismatch; fix the model or add a
  checked boundary.

## Performance rules

Inputs can be large workspaces and long Stata files. Avoid accidental quadratic
work:

- Do not put `.some()`, `.includes()`, or `.find()` inside a loop when a `Set`
  or `Map` can provide constant-time lookup.
- Avoid repeated string concatenation in large loops; collect parts and join, or
  use substring boundaries while scanning.
- Avoid multiple full scans when one pass can collect the needed state.
- Do not repeatedly run whole-string replacements for many placeholders when a
  single regex callback can perform the dispatch.
- Hoist reusable `RegExp` objects to module scope. Reset `lastIndex` before
  reusing a global or sticky regex.

Optimize only after preserving behavior; apply the replaced-primitive contract
check below when changing an implementation strategy.

## Review checklist

In addition to checking the intended logic, apply these checks to every
non-trivial diff:

1. **Specify old behavior.** If replacing behavior, enumerate what the old code
   did before deciding what is out of scope. Capability loss must be explicit,
   not accidental.
2. **Check replaced-primitive contracts.** A replacement must preserve all
   relevant properties of the old API. For example, `existsSync` follows
   symlinks, while `Dirent.isFile()`/`isDirectory()` do not classify a symlink as
   either.
3. **Sweep the pattern.** When establishing an invariant, find every consumer of
   the affected type/function/result, not only the reported call site.
4. **Run a cold review.** At least one review pass should not be primed with the
   expected bug list; ask what the author may not have considered.
5. **Verify tests and lint independently.** Do not chain commands in a way that
   masks an earlier failure. Report skipped or failing checks accurately.

## Maintenance tasks

### Versions and releases

Use the repository scripts rather than editing version fields manually. See
[DEVELOPMENT.md](DEVELOPMENT.md#versioning). For a release, use
`bun scripts/release.ts x.y.z`; do not use `bump-version --push` as a substitute
for the release gates.

### Command metadata caches

Command caches under `src/command-database/caches/` are generated artifacts that
are committed. When command extraction changes, a Stata version is added, or
hardcoded command options/subcommands change, regenerate or update the relevant
JSON caches as well. In particular, edits to
`src/commands/builtin-commands.ts` may require matching cache updates. See
`src/command-database/README.md` and `scripts/generate-cache.ts`.

The TextMate grammar is maintained separately; regenerating command caches does
not update `client/syntaxes/stata.tmLanguage.json`.

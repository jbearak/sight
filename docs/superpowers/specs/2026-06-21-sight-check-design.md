# Design: `sight check`

## Context

Sight already has the foundations needed for a command-line checker:

- the `sight` binary name and CLI entrypoint from the binary rename work;
- a shared `sight.toml` project config module intended for LSP and CLI use;
- `WorkspaceIndexer`, `DependencyGraph`, `ScopeResolver`, and
  `ForwardScopeResolver` for cross-file scope;
- `DocumentStore` for parsing source text into cached document state; and
- `DiagnosticsProvider.get_diagnostics()` for collecting LSP diagnostics without
  publishing them.

Raven's `raven check` provides the model. It is a headless direct pipeline, not
an LSP client: it indexes the workspace, reports diagnostics for requested
targets, renders text/JSON/SARIF, and exits with CI-friendly status codes.
`sight check` should follow that shape closely.

## Goals

- Add `sight check` as a real subcommand of the existing `sight` binary.
- Reuse the same parser, analyzer, workspace index, scope resolution, config,
  and diagnostic providers as the editor.
- Index the whole workspace before reporting so cross-file diagnostics match the
  LSP after its startup scan completes.
- Treat positional paths as report filters only; they must not shrink the
  workspace used for cross-file resolution.
- Support Raven-parity output and gating options for CI.
- Keep editor diagnostic defaults. In particular, `undefinedVariable` remains
  off unless enabled by config.

## Non-Goals

- Do not implement `sight check` by spawning or driving the LSP protocol.
- Do not add stricter CI-only diagnostic defaults.
- Do not implement a separate style-only `sight lint` command in this feature.
- Do not materially expand Mata diagnostics. `.mata` files participate as
  report targets, but v1 reports only what the current pipeline can produce.

## CLI Surface

The top-level CLI should route subcommands before transport startup:

```text
sight check [OPTIONS] [PATHS...]
sight --stdio
sight --node-ipc
```

`sight check` options:

```text
--workspace DIR
--config PATH
--no-config
--format text|json|sarif
--max-severity off|hint|info|warning|error
--quiet
--color auto|always|never
--no-color
--help
```

Defaults:

- `--workspace`: current directory.
- `PATHS...`: empty means every Stata source file under the workspace.
- `--format`: `text`.
- `--max-severity`: `info`, so warnings and errors fail CI while hints and
  information do not.
- `--color`: `auto`.

`--config PATH` and `--no-config` conflict. Usage errors such as an unknown flag
or a missing option value should print a concise error and exit `1`.

The existing top-level `parse_args()` rejects non-flag positional tokens, so
`src/cli.ts` must intercept `argv[0] === 'check'` before calling the existing
transport parser. `sight check --help` should print check-specific help and
exit `0`.

Severity gating is strict. Use this ordering:

```text
off(0) < hint(1) < info(2) < warning(3) < error(4)
```

A run fails only when `diagnosticSeverity > maxSeverity`. Therefore the default
`--max-severity info` fails warnings and errors, but not information or hints.

## Source Scope

The checker reports the same source extensions the workspace indexer handles:

- `.do`
- `.ado`
- `.doh`
- `.mata`

Extension matching should be case-insensitive for CLI filesystem friendliness.
Directory walks should recurse and skip VCS metadata directories such as `.git`,
`.hg`, and `.svn`. Existing non-source files passed as explicit paths are
ignored. Missing explicit paths are operator errors.

Resolve `--workspace`, `--config`, and every positional path from the invocation
cwd before canonicalization. Do not resolve `--config` or positional paths
relative to `--workspace`.

The whole workspace is always indexed. `PATHS...` only decide which files are
reported:

- no paths: report every source file under `--workspace`;
- file path: report it if it is a supported source file;
- directory path: recursively report supported source files under it.

## Configuration

`sight check` should consume the shared `src/config-file` module:

1. If `--no-config` is set, skip discovery and use no project layer.
2. If `--config PATH` is set, load that explicit `sight.toml`, resolving
   relative paths from the invocation cwd.
3. Otherwise discover the nearest `sight.toml` at or above `--workspace`.

Project config is merged over built-in defaults through the same merge semantics
used by the LSP, then validated by the existing config validator.

The CLI has no LSP client or initialization-options layer. Build its settings as
`validate_comment_formatting_config(deep_merge_config(DEFAULT_SETTINGS,
projectPartial || {}))`.

Malformed or unreadable config is an operator error in `sight check` and exits
`2`. This intentionally differs from the LSP, which logs the problem and starts
without a project layer.

Config warnings, including stale `.sight.json` warnings and unknown keys, should
go to stderr.

## Architecture

Add small CLI-focused modules while keeping the existing LSP server lifecycle out
of the checker:

```text
src/cli.ts
src/cli/check.ts
src/cli/shared.ts
src/cli/source-files.ts
```

Suggested responsibilities:

- `src/cli.ts`: top-level routing for `check`, help/version, and LSP transport
  startup.
- `src/cli/check.ts`: parse `sight check` args, build the batch analysis
  context, collect diagnostics, and return an exit code.
- `src/cli/shared.ts`: output formats, severity ordering, color resolution, and
  exit code constants.
- `src/cli/source-files.ts`: supported source predicates, directory walking, and
  report-target collection.

`DiagnosticsProvider` currently depends on the full
`vscode-languageserver` `Connection` type even though it only uses
`sendDiagnostics`. Before instantiating it from CLI code, introduce a narrow
exported connection interface for diagnostics, for example:

```typescript
export interface DiagnosticsConnection {
    sendDiagnostics(params: { uri: string; diagnostics: Diagnostic[] }): void;
}
```

Then update `DiagnosticsProvider` to accept that interface. The LSP server still
passes the real connection, and the CLI can pass a no-op implementation.

The batch analysis context should own:

- `DependencyGraph`
- `WorkspaceIndexer`
- `ScopeResolver`
- `ForwardScopeResolver`
- `DocumentStore`
- `DiagnosticsProvider`

`ScopeResolver` logging callbacks in CLI mode must write warnings and debug logs
to stderr or no-op based on config/debug mode. They must never write to stdout,
because stdout carries JSON and SARIF machine output.

## Data Flow

1. Resolve cwd.
2. Resolve and canonicalize `--workspace`.
3. Load/merge/validate config.
4. Build dependency graph, indexer, scope resolvers, document store, and
   diagnostics provider.
5. Configure the indexer from the validated config.
6. Wire the graph and resolvers the same way the server does:
   - `workspace_indexer.set_dependency_graph(dependency_graph)`;
   - `workspace_indexer.set_max_indexed_files(config.cross_file.max_indexed_files)`;
   - scope resolver reads from the dependency graph;
   - `scope_resolver.set_dependency_graph(dependency_graph)`;
   - forward resolver is injected into scope resolver;
   - `scope_resolver.set_forward_scope_resolver(forward_scope_resolver)`;
   - `diagnostics_provider.set_dependency_graph(dependency_graph)`;
   - document store receives workspace roots and scope resolver.
7. Run `WorkspaceIndexer.initialize([workspace], config.adoPaths)`.
8. Collect report targets from `PATHS...`.
9. For each target:
   - read source;
   - convert the filesystem path to a URI with `URI.file(path).toString()`;
   - open it in `DocumentStore` with `await document_store.open(...)`;
   - read the committed `DocumentState` with `document_store.get(uri)`;
   - collect diagnostics with `DiagnosticsProvider.get_diagnostics()`, passing
     `workspace_indexer.get_all_symbols()` and the scope resolver;
   - store `(path, diagnostic)` pairs;
   - close the document with `document_store.close(uri)` before moving to the
     next target, so the CLI does not trip the store's LRU limits on large
     workspaces.
10. Render all diagnostics.
11. Return the gated exit code.

The workspace scan completes before diagnostics are collected, so the existing
auto-backward undefined-diagnostic deferral should not suppress warnings
permanently.

## Large Files

The indexer already honors `indexing.maxFileSizeBytes`.

For v1, a file skipped only as part of workspace indexing may remain silent
unless normal logging is enabled. However, an explicitly reported source file
that exceeds the configured size limit should produce an error diagnostic rather
than silently passing. That diagnostic should point at `1:1` and explain the
configured byte limit.

If `cross_file.max_indexed_files` prevents the workspace scan from indexing an
explicitly reported source file, produce an error diagnostic for that file rather
than silently passing it.

This keeps CI honest: when a user names a file, `sight check` either analyzes it
or reports why it did not.

## Encoding And Read Errors

Missing explicit paths are operator errors. Existing files that cannot be read
because of permissions or other I/O failures are also operator errors.

Reported source files that can be read but cannot be decoded as UTF-8 are
error-severity diagnostics, not operator errors. A small CLI read helper should
validate UTF-8 bytes before parsing so mis-encoded source is treated as a code
finding. The message should include the byte offset where decoding failed.

## Output

Text output should be concise and grep-friendly:

```text
analysis/main.do:12:8 warning: Undefined macro: project_root [2001]
```

Rules:

- paths are relative to the workspace when possible;
- line and column are one-based;
- severity words are lower-case;
- the diagnostic code is included in brackets when present;
- `--quiet` suppresses only the trailing text summary.

Sort output deterministically by workspace-relative path, then start line, start
column, severity, code, and message.

The text summary should match this shape:

```text
N issues (E errors, W warnings, I infos, H hints, O notes)
```

JSON output should be an array:

```json
[
  {
    "path": "analysis/main.do",
    "diagnostic": {
      "range": {
        "start": { "line": 11, "character": 7 },
        "end": { "line": 11, "character": 19 }
      },
      "severity": 2,
      "code": 2001,
      "source": "sight",
      "message": "Undefined macro: project_root"
    }
  }
]
```

SARIF output should emit SARIF 2.1.0 with diagnostic codes as rule IDs. A
pragmatic v1 mapping is enough: `error` and `warning` map directly; information
and hint map to SARIF `note`. Rule IDs must be strings, using `SIGHT<code>` for
numeric diagnostic codes. Include `tool.driver.name = "sight"` and the package
version in `tool.driver.version`.

Color applies only to text output. `--color auto` should respect terminal TTY
status plus `NO_COLOR` and `FORCE_COLOR`. `--no-color` is an alias for
`--color never`.

## Exit Codes

- `0`: no diagnostic exceeded `--max-severity`.
- `1`: at least one diagnostic exceeded `--max-severity`, or a usage error.
- `2`: operator error while running, such as invalid workspace, unreadable
  explicit path, or config load failure.

Operator errors take priority over diagnostic threshold failures. A partially
read run should not appear as an ordinary diagnostic-only failure.

## Testing

Unit and property tests:

- parser accepts all `sight check` flags;
- parser rejects unknown flags, missing option values, bad enum values, and
  `--config` with `--no-config`;
- severity ordering and `--max-severity` gating are deterministic;
- `--max-severity info` does not fail information or hint diagnostics;
- text, JSON, and SARIF render stable path, range, severity, message, source,
  and code data;
- text output sorts diagnostics deterministically and prints the documented
  summary;
- color resolution follows explicit flag, `NO_COLOR`, `FORCE_COLOR`, and TTY
  precedence;
- source discovery includes `.do`, `.ado`, `.doh`, and `.mata`;
- source discovery treats extensions case-insensitively;
- source discovery skips VCS metadata directories;
- config loading covers no-config, explicit config, discovery, warnings, and
  load failures.

Integration tests:

- `sight check` reports lexer, parser, and semantic diagnostics for a single
  file.
- `sight check` indexes the whole workspace even when report paths filter output.
- Auto-discovered `do` / `run` / `include` chains suppress valid inherited
  symbols.
- Missing cross-file targets and out-of-scope references are reported.
- `sight.toml` changes diagnostic severities and indexing settings for the CLI
  the same way it does for the LSP.
- A malformed `sight.toml` exits `2`.
- A missing explicit path exits `2`.
- A large explicitly reported source file produces an error diagnostic.
- A mis-encoded reported source file produces an error diagnostic with byte
  offset information.
- JSON output is parseable.
- SARIF output has the required top-level 2.1.0 shape.

Tests should prefer the direct `check.run_with_cwd(...)` seam for focused cases
and a small number of spawned CLI smoke tests for end-to-end command routing.

## Documentation

Add `docs/cli.md` and link it from `README.md`.

The docs should cover:

- what `sight check` reports;
- workspace indexing versus report filters;
- `sight.toml` discovery and `--config` / `--no-config`;
- output formats;
- exit codes;
- source extensions;
- limitations for `.mata` diagnostics;
- a minimal CI example.

Example:

```yaml
- name: Check Stata sources
  run: sight check
```

## Implementation Notes

The natural implementation order is:

1. CLI parser, help text, source discovery, output rendering, and severity
   gating.
2. Config loading and batch context construction.
3. Same-file diagnostic collection.
4. Workspace indexing and cross-file diagnostic parity.
5. Large-file and encoding diagnostics.
6. Docs and spawned smoke tests.

This can remain one stacked feature branch, but keeping those internal
milestones distinct will make review easier.

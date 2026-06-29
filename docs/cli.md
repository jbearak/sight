# CLI

Sight ships a `sight` binary for editor language-server use and command-line
checks.

## `sight check`

Run the same static diagnostics Sight publishes in the editor, but in a
headless batch suitable for CI:

```text
sight check [OPTIONS] [PATHS...]
```

`sight check` always indexes the whole workspace so `do`, `run`, and `include`
chains resolve correctly. Positional `PATHS...` only filter which files report
diagnostics. With no paths, Sight reports every `.do`, `.ado`, `.doh`, and
`.mata` file under the workspace.

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

### GitHub Actions

Use [`jbearak/setup-sight`](https://github.com/jbearak/setup-sight) to install
the prebuilt Sight CLI from GitHub Releases. You can copy
[`docs/examples/ci/github-actions-sight.yml`](examples/ci/github-actions-sight.yml)
to `.github/workflows/sight.yml`:

```yaml
name: Sight

"on":
  pull_request:
  push:

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
pipelines:
  default:
    - step:
        name: Sight
        image: node:24
        script:
          - npm install -g @jbearak/sight
          - sight check
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

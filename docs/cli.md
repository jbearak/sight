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

Exit codes:

- `0`: no diagnostic exceeded `--max-severity`.
- `1`: at least one diagnostic exceeded `--max-severity`.
- `2`: operator or usage error, such as an unknown or malformed flag, invalid
  workspace, missing explicit path, or malformed config.

Example:

```yaml
- name: Check Stata sources
  run: sight check
```

`.mata` files are included as report targets because Sight indexes them for
symbols, but v1 diagnostics for Mata are limited to what the current parser and
diagnostic pipeline can produce.

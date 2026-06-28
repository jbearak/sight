# setup-sight GitHub Action Design

## Goal

Create a standalone GitHub Action repository, `jbearak/setup-sight`, that
installs the Sight CLI in GitHub Actions workflows from prebuilt GitHub release
binaries.

The action should mirror the shape and behavior of `jbearak/setup-raven`: a
small composite action backed by a shell installer script, with documentation,
license, and CI in the action repository.

## Implementation Status

The action implementation is intentionally outside this Sight repository. The
standalone repository has been created at
[`jbearak/setup-sight`](https://github.com/jbearak/setup-sight); this repository
keeps the design and implementation plan as project documentation.

## User-Facing Behavior

Users can install Sight in a workflow with:

```yaml
- uses: actions/checkout@v4
- uses: jbearak/setup-sight@v1
  with:
    version: latest
- run: sight --version
```

The `version` input accepts `latest` or a Sight release tag such as `v0.8.4`.
When pinned to a tag, the action downloads artifacts from that exact release.

After the action completes, the `sight` command is available on `PATH` for later
workflow steps.

## Installation Source

The action installs Sight from Bun-compiled release binaries published by
`jbearak/sight`, not from npm.

This keeps the action fast and close to `setup-raven`: detect the runner,
download one checked release artifact, verify its SHA-256 checksum, install it
under the stable command name, and smoke-test it.

## Supported Platforms

The action supports the release artifacts Sight currently publishes:

- `sight-darwin-arm64`
- `sight-linux-x64`
- `sight-linux-arm64`
- `sight-windows-x64.exe`
- `sight-windows-arm64.exe`

macOS x64 is intentionally unsupported because Sight does not publish that
artifact. The installer should fail with a clear error for unsupported
OS/architecture pairs.

## Repository Layout

The standalone repository should contain:

- `action.yml`: composite action metadata and the `version` input.
- `setup-sight.sh`: installer script.
- `README.md`: usage, inputs, supported runners, and rationale.
- `LICENSE`: GPL-3.0, matching Sight.
- `.github/workflows/ci.yml`: action smoke tests.

## Installer Design

`setup-sight.sh` should:

1. Read `SIGHT_VERSION`, defaulting to `latest`.
2. Read `SIGHT_RELEASE_REPOSITORY`, defaulting to `jbearak/sight`.
3. Validate `SIGHT_VERSION` as `latest` or a release tag.
4. Map GitHub runner OS and architecture to a Sight release asset name.
5. Download the raw binary asset and its `.sha256` file.
6. Validate that the checksum file is well-formed and names the expected asset.
7. Verify the downloaded binary checksum with `sha256sum` or `shasum`.
8. Copy the binary to a temporary `bin` directory as `sight` or `sight.exe`.
9. Mark the copied binary executable.
10. Append the temporary `bin` directory to `GITHUB_PATH`.
11. Run the installed binary with `--version` as a smoke test.

Unlike `setup-raven`, the Sight installer does not need archive extraction
because Sight release assets are raw binaries rather than zip files.

## CI Design

The action repository CI should test the action itself on supported runner
families where GitHub-hosted runners are practical.

At minimum, CI should run on Ubuntu x64 and verify that:

- `uses: ./` installs Sight.
- `sight --version` succeeds.

Where available, CI should also cover Windows x64 and macOS ARM64. macOS x64 is
not a target and should not be treated as a coverage gap.

## Non-Goals

- Do not install Sight from npm.
- Do not build Sight from source.
- Do not add generic multi-tool downloader behavior.
- Do not support macOS x64 unless Sight starts publishing that artifact.

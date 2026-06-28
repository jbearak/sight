# setup-sight GitHub Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone `jbearak/setup-sight` GitHub Action that installs the Sight CLI from verified GitHub release binaries.

**Architecture:** The action is a small composite GitHub Action. `action.yml` forwards the user-selected version to `setup-sight.sh`; the shell script detects the runner platform, downloads one raw Sight release binary and its checksum, verifies it, installs it into a temporary `bin` directory as `sight` or `sight.exe`, appends that directory to `GITHUB_PATH`, and smoke-tests `--version`.

**Tech Stack:** Bash, GitHub composite actions, GitHub Actions workflow YAML, curl, sha256sum/shasum.

---

## File Structure

Create the standalone repository at `/Users/jmb/.codex/worktrees/48cf/setup-sight` unless the user requests a different location.

- `action.yml`: Composite action metadata, one `version` input, and env wiring into `setup-sight.sh`.
- `setup-sight.sh`: Installer implementation.
- `README.md`: User-facing rationale, usage, inputs, and supported runners.
- `LICENSE`: GPL-3.0 text, copied from Sight or setup-raven.
- `.github/workflows/ci.yml`: CI for tests and action smoke checks.
- `tests/setup-sight-test.sh`: Bash test harness with fake release assets and fake `curl`.
- `tests/fixtures/bin/sight`: Fake Unix Sight executable used by tests.
- `tests/fixtures/bin/sight.exe`: Fake Windows Sight executable used by tests.

## Task 1: Scaffold Standalone Repository

**Files:**
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/action.yml`
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/setup-sight.sh`
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/README.md`
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/LICENSE`
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/.github/workflows/ci.yml`

- [ ] **Step 1: Create the repository directory**

Run:

```bash
mkdir -p /Users/jmb/.codex/worktrees/48cf/setup-sight/.github/workflows
```

Expected: directory exists.

- [ ] **Step 2: Initialize git**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
git init
```

Expected: `Initialized empty Git repository`.

- [ ] **Step 3: Copy GPL-3.0 license**

Run:

```bash
cp /Users/jmb/.codex/worktrees/48cf/sight/LICENSE /Users/jmb/.codex/worktrees/48cf/setup-sight/LICENSE
```

Expected: `LICENSE` exists and matches Sight's GPL-3.0 license.

- [ ] **Step 4: Create minimal action metadata**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/action.yml`:

```yaml
name: Setup Sight
description: Install the Sight CLI from prebuilt GitHub Release binaries.

inputs:
  version:
    description: Sight version to install. Use "latest" or a release tag.
    required: false
    default: latest

runs:
  using: composite
  steps:
    - name: Install Sight
      shell: bash
      env:
        SIGHT_VERSION: ${{ inputs.version }}
        SIGHT_RELEASE_REPOSITORY: jbearak/sight
      run: bash "$GITHUB_ACTION_PATH/setup-sight.sh"
```

- [ ] **Step 5: Create placeholder installer that fails**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/setup-sight.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "::error::setup-sight installer is not implemented yet" >&2
exit 1
```

Run:

```bash
chmod +x /Users/jmb/.codex/worktrees/48cf/setup-sight/setup-sight.sh
```

Expected: script is executable.

- [ ] **Step 6: Create initial README**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/README.md`:

```markdown
# setup-sight

A GitHub Action that installs the [Sight](https://github.com/jbearak/sight) CLI
from prebuilt release binaries.

## Usage

```yaml
- uses: actions/checkout@v4
- uses: jbearak/setup-sight@v1
  with:
    version: latest
- run: sight --version
```

## License

[GPL-3.0](LICENSE), the same license as Sight.
```
```

- [ ] **Step 7: Create placeholder CI**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/.github/workflows/ci.yml`:

```yaml
name: CI

"on":
  push:
  pull_request:

jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash tests/setup-sight-test.sh
```

- [ ] **Step 8: Commit scaffold**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
git add action.yml setup-sight.sh README.md LICENSE .github/workflows/ci.yml
git commit -m "chore: scaffold setup-sight action"
```

Expected: commit succeeds.

## Task 2: Add Failing Installer Tests

**Files:**
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/tests/setup-sight-test.sh`
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/tests/fixtures/bin/sight`
- Create: `/Users/jmb/.codex/worktrees/48cf/setup-sight/tests/fixtures/bin/sight.exe`

- [ ] **Step 1: Create fake Sight executables**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/tests/fixtures/bin/sight`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--version" ]; then
  echo "sight 0.0.0-test"
  exit 0
fi

echo "unexpected fake sight args: $*" >&2
exit 1
```

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/tests/fixtures/bin/sight.exe` with the same content.

Run:

```bash
chmod +x /Users/jmb/.codex/worktrees/48cf/setup-sight/tests/fixtures/bin/sight /Users/jmb/.codex/worktrees/48cf/setup-sight/tests/fixtures/bin/sight.exe
```

Expected: both fixtures are executable.

- [ ] **Step 2: Write the failing Bash test harness**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/tests/setup-sight-test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="${RUNNER_TEMP:-/tmp}/setup-sight-tests"
rm -rf "$test_root"
mkdir -p "$test_root/fake-curl" "$test_root/releases" "$test_root/github-paths"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

make_release_asset() {
  local asset="$1"
  local source="$2"
  mkdir -p "$test_root/releases/v0.0.0"
  cp "$source" "$test_root/releases/v0.0.0/$asset"
  local digest
  if command -v sha256sum >/dev/null 2>&1; then
    digest="$(sha256sum "$test_root/releases/v0.0.0/$asset" | awk '{print $1; exit}')"
  else
    digest="$(shasum -a 256 "$test_root/releases/v0.0.0/$asset" | awk '{print $1; exit}')"
  fi
  printf '%s  %s\n' "$digest" "$asset" > "$test_root/releases/v0.0.0/$asset.sha256"
}

cat > "$test_root/fake-curl/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

asset="${url##*/}"
tag="${url%/download/*}"
tag="${tag##*/}"
source="${SETUP_SIGHT_TEST_RELEASES}/${tag}/${asset}"
test -f "$source" || {
  echo "missing fake release asset: $source" >&2
  exit 22
}
cp "$source" "$output"
FAKE_CURL
chmod +x "$test_root/fake-curl/curl"

run_install() {
  local os="$1"
  local arch="$2"
  local github_path="$test_root/github-paths/${os}-${arch}"
  : > "$github_path"
  PATH="$test_root/fake-curl:$PATH" \
    SETUP_SIGHT_TEST_RELEASES="$test_root/releases" \
    SIGHT_VERSION="v0.0.0" \
    RUNNER_OS="$os" \
    RUNNER_ARCH="$arch" \
    RUNNER_TEMP="$test_root/tmp-${os}-${arch}" \
    GITHUB_PATH="$github_path" \
    bash "$repo_root/setup-sight.sh"
  local installed_dir
  installed_dir="$(tail -n 1 "$github_path")"
  test -n "$installed_dir" || fail "GITHUB_PATH was not updated for $os/$arch"
  printf '%s\n' "$installed_dir"
}

make_release_asset "sight-linux-x64" "$repo_root/tests/fixtures/bin/sight"
installed_linux="$(run_install Linux X64)"
test -x "$installed_linux/sight" || fail "linux install did not create sight"
"$installed_linux/sight" --version | grep -q "sight 0.0.0-test" || fail "linux sight smoke failed"

make_release_asset "sight-windows-x64.exe" "$repo_root/tests/fixtures/bin/sight.exe"
installed_windows="$(run_install Windows X64)"
test -x "$installed_windows/sight.exe" || fail "windows install did not create sight.exe"
"$installed_windows/sight.exe" --version | grep -q "sight 0.0.0-test" || fail "windows sight.exe smoke failed"

if SIGHT_VERSION="v0.0.0" RUNNER_OS="macOS" RUNNER_ARCH="X64" bash "$repo_root/setup-sight.sh" >"$test_root/macos-x64.log" 2>&1; then
  fail "macOS x64 unexpectedly succeeded"
fi
grep -q "unsupported runner architecture for macOS" "$test_root/macos-x64.log" || fail "macOS x64 error was unclear"

echo "setup-sight tests passed"
```

Run:

```bash
chmod +x /Users/jmb/.codex/worktrees/48cf/setup-sight/tests/setup-sight-test.sh
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
bash tests/setup-sight-test.sh
```

Expected: FAIL because `setup-sight installer is not implemented yet`.

- [ ] **Step 4: Commit failing tests**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
git add tests/setup-sight-test.sh tests/fixtures/bin/sight tests/fixtures/bin/sight.exe
git commit -m "test: cover setup-sight installer behavior"
```

Expected: commit succeeds with failing tests recorded.

## Task 3: Implement Installer

**Files:**
- Modify: `/Users/jmb/.codex/worktrees/48cf/setup-sight/setup-sight.sh`
- Test: `/Users/jmb/.codex/worktrees/48cf/setup-sight/tests/setup-sight-test.sh`

- [ ] **Step 1: Replace placeholder with installer implementation**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/setup-sight.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

version="${SIGHT_VERSION:-latest}"
release_repository="${SIGHT_RELEASE_REPOSITORY:-jbearak/sight}"

fail() {
  echo "::error::$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required to install Sight"
}

if [ "$version" != "latest" ] && ! [[ "$version" =~ ^v[0-9]+(\.[0-9]+){0,2}([-+][A-Za-z0-9._-]+)?$ ]]; then
  fail "version must be 'latest' or a Sight release tag (e.g. v0.8.4)"
fi

runner_os="${RUNNER_OS:-$(uname -s)}"
case "$runner_os" in
  Linux | linux* | GNU/Linux)
    os="linux"
    ;;
  macOS | Darwin | darwin*)
    os="darwin"
    ;;
  Windows | Windows_NT | windows* | MINGW* | MSYS* | CYGWIN*)
    os="windows"
    ;;
  *)
    fail "unsupported runner OS: ${runner_os}. setup-sight supports Linux, macOS, and Windows runners."
    ;;
esac

runner_arch="${RUNNER_ARCH:-$(uname -m)}"
case "$runner_arch" in
  X64 | x86_64 | amd64)
    arch="x64"
    ;;
  ARM64 | arm64 | aarch64)
    arch="arm64"
    ;;
  *)
    fail "unsupported runner architecture: ${runner_arch}. setup-sight supports x64 and arm64 runners."
    ;;
esac

if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
  fail "unsupported runner architecture for macOS: x64. Sight publishes macOS arm64 binaries only."
fi

asset="sight-${os}-${arch}"
bin_name="sight"
if [ "$os" = "windows" ]; then
  asset="${asset}.exe"
  bin_name="sight.exe"
fi

if [ "$version" = "latest" ]; then
  release_base="https://github.com/${release_repository}/releases/latest/download"
else
  release_base="https://github.com/${release_repository}/releases/download/${version}"
fi

runner_temp="${RUNNER_TEMP:-/tmp}"
runner_temp="${runner_temp//\\//}"
workdir="$(mktemp -d "${runner_temp}/setup-sight-${os}-${arch}.XXXXXX")"
bin_dir="${workdir}/bin"
downloaded_binary="${workdir}/${asset}"
checksum_file="${workdir}/${asset}.sha256"

mkdir -p "$bin_dir"

require_command curl

echo "Downloading ${asset} from ${release_repository} (${version})"
curl -fsSL --retry 3 --retry-delay 2 -o "$downloaded_binary" "${release_base}/${asset}"
curl -fsSL --retry 3 --retry-delay 2 -o "$checksum_file" "${release_base}/${asset}.sha256"

read -r expected_checksum expected_name extra < "$checksum_file" || true
expected_name="${expected_name#\*}"
if [ -n "${extra:-}" ] || ! [[ "$expected_checksum" =~ ^[0-9a-fA-F]{64}$ ]]; then
  fail "malformed checksum file for ${asset}"
fi
if [ "$expected_name" != "$asset" ]; then
  fail "checksum file names '${expected_name:-<missing>}', expected '${asset}'"
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$downloaded_binary" | awk '{print $1; exit}')"
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "$downloaded_binary" | awk '{print $1; exit}')"
else
  fail "sha256sum or shasum is required to verify Sight"
fi

if [ "$actual_checksum" != "$expected_checksum" ]; then
  fail "checksum mismatch for ${asset}: expected ${expected_checksum}, got ${actual_checksum}"
fi

echo "Checksum verified for ${asset}"

if [ ! -f "$downloaded_binary" ] || [ -L "$downloaded_binary" ]; then
  fail "downloaded asset must be a regular ${asset} file"
fi

cp "$downloaded_binary" "${bin_dir}/${bin_name}"
chmod +x "${bin_dir}/${bin_name}"

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$bin_dir" >> "$GITHUB_PATH"
fi

"${bin_dir}/${bin_name}" --version
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
bash tests/setup-sight-test.sh
```

Expected: PASS with `setup-sight tests passed`.

- [ ] **Step 3: Run a syntax check**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
bash -n setup-sight.sh
bash -n tests/setup-sight-test.sh
```

Expected: no output and exit code 0.

- [ ] **Step 4: Commit installer implementation**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
git add setup-sight.sh
git commit -m "feat: install verified sight release binaries"
```

Expected: commit succeeds.

## Task 4: Finish README and CI

**Files:**
- Modify: `/Users/jmb/.codex/worktrees/48cf/setup-sight/README.md`
- Modify: `/Users/jmb/.codex/worktrees/48cf/setup-sight/.github/workflows/ci.yml`

- [ ] **Step 1: Expand README**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/README.md`:

```markdown
# setup-sight

A GitHub Action that installs the [Sight](https://github.com/jbearak/sight) CLI
from prebuilt release binaries.

**Sight** is a Language Server Protocol implementation and static analyzer for
the Stata programming language. It provides editor features such as diagnostics,
completion, hover, go-to-definition, and a standalone `sight` CLI for use in
CI and other editor integrations.

## Why this action exists

Sight publishes Bun-compiled binaries on
[GitHub Releases](https://github.com/jbearak/sight/releases). Installing one in
CI by hand means detecting the runner OS and architecture, selecting the right
asset, downloading it, verifying its SHA-256 checksum, renaming it to the stable
`sight` command, and adding it to `PATH`.

This action does that install step for you. It downloads the matching release
binary, verifies the published checksum, adds `sight` to `PATH`, and runs
`sight --version` as a smoke test.

It installs only. Beyond the `--version` smoke test, it does not run `sight`
subcommands; your workflow controls which paths and flags to check.

## Usage

```yaml
- uses: actions/checkout@v4
- uses: jbearak/setup-sight@v1
  with:
    version: latest
- run: sight --version
```

Pin a release tag for reproducible builds:

```yaml
- uses: jbearak/setup-sight@v1
  with:
    version: v0.8.4
```

## Inputs

- `version` - `latest` (default) or a Sight release tag such as `v0.8.4`.

## Supported runners

The action supports the runner targets published by Sight:

- Linux x64
- Linux ARM64
- Windows x64
- Windows ARM64
- macOS ARM64

macOS x64 is not supported because Sight does not publish a macOS x64 binary.

## License

[GPL-3.0](LICENSE), the same license as Sight.
```

- [ ] **Step 2: Expand CI**

Write `/Users/jmb/.codex/worktrees/48cf/setup-sight/.github/workflows/ci.yml`:

```yaml
name: CI

"on":
  push:
  pull_request:

jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Syntax check
        run: |
          bash -n setup-sight.sh
          bash -n tests/setup-sight-test.sh
      - name: Unit tests
        run: bash tests/setup-sight-test.sh

  smoke:
    strategy:
      fail-fast: false
      matrix:
        os:
          - ubuntu-latest
          - windows-latest
          - macos-15
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          version: latest
      - run: sight --version
```

- [ ] **Step 3: Run local checks**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
bash -n setup-sight.sh
bash -n tests/setup-sight-test.sh
bash tests/setup-sight-test.sh
```

Expected: syntax checks pass and tests print `setup-sight tests passed`.

- [ ] **Step 4: Commit docs and CI**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
git add README.md .github/workflows/ci.yml
git commit -m "docs: document setup-sight usage"
```

Expected: commit succeeds.

## Task 5: Final Verification and Repository Handoff

**Files:**
- No file changes expected.

- [ ] **Step 1: Inspect history**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
git log --oneline --decorate -5
```

Expected: commits for scaffold, tests, installer, docs/CI.

- [ ] **Step 2: Inspect working tree**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
git status --short
```

Expected: no output.

- [ ] **Step 3: Run final local verification**

Run:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
bash -n setup-sight.sh
bash -n tests/setup-sight-test.sh
bash tests/setup-sight-test.sh
```

Expected: all commands pass.

- [ ] **Step 4: Report next GitHub setup commands**

Tell the user the repository is ready locally and can be pushed with:

```bash
cd /Users/jmb/.codex/worktrees/48cf/setup-sight
gh repo create jbearak/setup-sight --public --source=. --remote=origin --push
git tag v1
git push origin v1
```

Only run these commands if the user explicitly asks, because they create and publish a public GitHub repository and tag.

## Self-Review

- Spec coverage: The plan creates a standalone action repo, uses Bun-compiled Sight release binaries, verifies SHA-256 checksums, installs `sight`/`sight.exe`, documents supported platforms, and avoids npm/source builds.
- Placeholder scan: No task contains unresolved placeholders or unspecified implementation details.
- Type/name consistency: Environment variables, asset names, file paths, and command names match between tests, installer, docs, and action metadata.

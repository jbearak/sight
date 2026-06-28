# NPM Trusted Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Sight as `@jbearak/sight` via npm Trusted Publishing with one public npm command, `sight`, while cleaning up the old `sight-language-server` alias from source installs.

**Architecture:** Keep Sight's existing two-stage release pipeline and add npm publishing to `release-publish.yml`, where the GitHub release and registry publishing already happen. Change package metadata and installer helpers so `sight` is the only installed command, while uninstall/install still remove Sight-owned stale legacy aliases.

**Tech Stack:** Bun, TypeScript, npm, GitHub Actions, npm Trusted Publishing/OIDC.

---

## Tasks

### Task 1: Lock Package Bin Contract

**Files:**
- Modify: `tests/unit/binary-command-name.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing tests**

Add assertions that the root package name is `@jbearak/sight`, the `bin` map contains only `sight`, and CI no longer smoke-tests the legacy alias.

- [ ] **Step 2: Run tests**

Run: `bun test ./tests/unit/binary-command-name.test.ts`

Expected before implementation: failure because `package.json` is still named `sight-language-server` and still exports the legacy bin.

- [ ] **Step 3: Implement metadata and CI changes**

Change `package.json` name/bin fields and remove the CI alias check.

- [ ] **Step 4: Re-run test**

Run: `bun test ./tests/unit/binary-command-name.test.ts`

Expected after implementation: pass for package-contract assertions.

### Task 2: Remove Legacy Source Install Alias

**Files:**
- Modify: `scripts/binary-names.ts`
- Modify: `scripts/install.ts`
- Modify: `scripts/uninstall.ts`
- Modify: `tests/unit/binary-command-name.test.ts`

- [ ] **Step 1: Write failing tests**

Update install-name tests so `get_binary_names_to_install()` returns only `sight`, and add stale-alias cleanup tests showing source install/uninstall remove a Sight-owned `sight-language-server`.

- [ ] **Step 2: Run tests**

Run: `bun test ./tests/unit/binary-command-name.test.ts`

Expected before implementation: failure because source install still writes both names.

- [ ] **Step 3: Implement installer cleanup**

Make install targets primary-only. Add separate stale legacy alias cleanup paths for install and uninstall, protected by existing ownership checks.

- [ ] **Step 4: Re-run tests**

Run: `bun test ./tests/unit/binary-command-name.test.ts`

Expected after implementation: pass.

### Task 3: Wire NPM Trusted Publishing

**Files:**
- Modify: `.github/workflows/release-publish.yml`
- Modify: `.github/actions/setup/action.yml` only if needed
- Modify: `scripts/release.ts`

- [ ] **Step 1: Add workflow assertions if covered by existing tests**

Use the existing binary-command workflow guard tests to ensure CI no longer references the old alias.

- [ ] **Step 2: Implement workflow**

Grant `id-token: write` on the publish job, pass `registry-url` to setup, install a pinned Trusted Publishing-capable npm CLI, and publish with `npm publish --ignore-scripts --access public`.

- [ ] **Step 3: Update release script messaging**

Mention npm as a release channel and `npm install -g @jbearak/sight` as an install test.

### Task 4: Update Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/standalone-installation.md`
- Modify: `DEVELOPMENT.md` if it references npm install or old alias

- [ ] **Step 1: Remove old-alias instructions**

Delete guidance to create `sight-language-server` symlinks/copies. Add npm install as a standalone option.

- [ ] **Step 2: Sweep references**

Run: `rg -n "sight-language-server|@jbearak/sight|npm install -g" README.md docs DEVELOPMENT.md package.json .github scripts tests src`

Expected: legacy alias remains only where it is intentionally tested as stale cleanup or accepted as an invocation-compatibility path.

### Task 5: Verify Package Shape

**Files:**
- No source edits unless verification reveals a bug.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test ./tests/unit/binary-command-name.test.ts
bun test ./tests/integration/binary-invocation.test.ts
bun test ./tests/unit/smoke-stdio-startup.test.ts
```

- [ ] **Step 2: Run package build checks**

Run:

```bash
bun run build:npm
npm pack --dry-run
```

- [ ] **Step 3: Run broader gate if practical**

Run:

```bash
bun run typecheck
```

Run `bun run test` and `bun run lint` if time permits.

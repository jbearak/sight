# NPM Trusted Publishing for Sight

## Goal

Publish Sight to npm as `@jbearak/sight` automatically during the existing release flow, using npm Trusted Publishing rather than a long-lived `NPM_TOKEN`.

The npm package should expose one command, `sight`. The old `sight-language-server` npm bin should not ship.

## Precedents

`jbearak/dta-parser` uses npm Trusted Publishing with GitHub Actions OIDC: the workflow has `id-token: write`, runs through the `release` environment, validates tag/package version alignment, and publishes with `npm publish --ignore-scripts --access public`.

Raven provides the local cleanup precedent: it has one canonical executable name and its install scripts remove previously installed files before copying the new binary, including cleanup of old hand-installed binaries so they do not shadow the current install on `PATH`.

## Design

### Package metadata

Rename the root package from `sight-language-server` to `@jbearak/sight`.

Keep only this npm bin:

```json
{
  "bin": {
    "sight": "dist/sight-server.js"
  }
}
```

The bundled executable remains `dist/sight-server.js`; the CLI banner and primary command remain `sight`.

### Release workflow

Add npm publishing to `.github/workflows/release-publish.yml`, because Sight already has a two-stage release pipeline:

1. `release-build.yml` verifies, builds, packages, smoke-tests, assembles artifacts, and triggers `release-publish.yml`.
2. `release-publish.yml` validates the tag, downloads the exact build artifacts, publishes external channels, creates the GitHub release, and bumps Homebrew.

Publishing from `release-publish.yml` keeps npm aligned with the same approved release artifact set instead of creating a second tag-triggered publish path.

The publish job will:

- grant `id-token: write` on the publish job for npm Trusted Publishing;
- use the existing `release` environment;
- configure npm with `registry-url: https://registry.npmjs.org`;
- install a pinned Trusted Publishing-capable npm CLI before publish;
- publish with `npm publish --ignore-scripts --access public`.

One-time npm setup:

- package: `@jbearak/sight`;
- owner/repo: `jbearak/sight`;
- workflow filename: `release-publish.yml`;
- environment: `release`.

### Build artifact and tarball safety

The release build already runs `bun run build:npm`, validates `dist/sight-server.js --version`, and smoke-tests the bundled server. CI already runs `npm pack --dry-run` and global installation tests.

Update those checks so they assert only the `sight` command after `npm install -g .`. Do not assert or preserve the `sight-language-server` alias.

Keep `.npmignore` focused so the npm package contains the package manifest, README/license material, and the bundled server, not source, tests, scripts, client extension files, or binary artifacts.

### Legacy alias cleanup

Apply the Raven lesson beyond npm metadata:

- source installation should install only `~/bin/sight`;
- source installation should remove a Sight-owned stale `~/bin/sight-language-server` or `~/bin/sight-language-server.exe` when present;
- source uninstallation should remove the old alias if it is Sight-owned, so users who previously installed from source are cleaned up;
- documentation should stop recommending symlinking/copying `sight-language-server`;
- tests should lock in the single-command package contract and stale-alias cleanup behavior.

Do not change Stata language behavior or LSP protocol behavior.

## Validation

Run:

```bash
bun run typecheck
bun test ./tests/unit/binary-command-name.test.ts
bun test ./tests/integration/binary-invocation.test.ts
bun test ./tests/unit/smoke-stdio-startup.test.ts
bun run build:npm
npm pack --dry-run
```

If time permits, also run the full CI-equivalent gate:

```bash
bun run test
bun run lint
```

## Risks

Trusted Publishing requires npm-side configuration before the first release. If that is missing, the release workflow will fail at the npm publish step after build validation but before publishing npm.

Removing the old bin is intentionally breaking for users who installed only through npm and call `sight-language-server`. The desired contract is one command, `sight`; docs and installer cleanup should make that explicit.

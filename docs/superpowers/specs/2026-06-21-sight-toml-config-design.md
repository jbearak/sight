# Design: `sight.toml` Project Configuration

**Date:** 2026-06-21
**Status:** Approved, ready for implementation planning

## Overview

Sight currently has a small `.sight.json` workspace-root configuration path
used by the language server. Before adding `sight check`, Sight should move to
the same portable configuration model as Raven: a committed project config file
read by both editor/LSP sessions and command-line checks.

This design replaces `.sight.json` with a single `sight.toml` project config.
The config layer should be a shared discovery/load/merge module, not LSP-only
startup logic, so `sight check` can use the same behavior immediately after this
work lands.

## Goals

- Use `sight.toml` as Sight's one portable project configuration file.
- Remove `.sight.json` as a parsed config source before users depend on it.
- Share config discovery, loading, warnings, and merge semantics between the
  LSP and the future `sight check` CLI.
- Make project config override client/editor settings per key.
- Cover the full server-side configuration space, not only the current
  `.sight.json` subset.
- Keep configuration syntax forgiving while documenting one canonical style.

## Non-Goals

- Implement `sight check` in this change.
- Automatically convert `.sight.json` to `sight.toml`.
- Add per-file config overrides.
- Put VS Code-only/client-only UI and command settings in `sight.toml`.
- Hand-write a TOML parser.

## Config Source

Sight will support one project config file: `sight.toml`.

Discovery will walk upward from a single search root, bounded by a maximum
depth, looking for `sight.toml`. The search root is the first workspace folder
for the LSP, the `--workspace` directory for `sight check`, or the invocation
working directory for CLI commands that do not take `--workspace`. Discovery is
not per document in v1.

The nearest `sight.toml` on that upward walk wins. The walk stops when it finds
that nearest `sight.toml`, reaches the maximum depth, or reaches the filesystem
root. This mirrors Raven's project-config discovery model and lets an editor
session and `sight check --workspace ...` share the same result.

During the directories visited by that walk, up to and including the directory
containing the nearest `sight.toml` if one exists, Sight should also detect
`.sight.json` files for warning purposes only. If no `sight.toml` is found, the
`.sight.json` warning scan covers the full bounded walk. Sight should not parse
`.sight.json`, and its presence must not change which `sight.toml` is active.
The LSP should log a warning like:

```text
.sight.json is no longer supported. Convert it to sight.toml; JSON syntax is
not compatible with TOML.
```

If both `sight.toml` and `.sight.json` exist in a candidate directory,
`sight.toml` is the only active project config. The `.sight.json` warning is
still useful because it tells the user they have stale project config nearby.

## Precedence

Configuration precedence is per key:

1. Built-in defaults.
2. Client/editor settings.
3. `sight.toml`.

Project config wins over client/editor settings at leaves. If `sight.toml`
sets `crossFile.maxChainDepth`, that value wins. If it is silent on
`formatting.lineWidth`, the client/editor value survives. If neither layer sets
a key, built-in defaults apply.

Arrays replace wholesale rather than concatenating.

This deliberately changes the old `.sight.json` behavior documented in
`docs/configuration.md`, where VS Code settings took precedence over project
config. The Raven model is a better fit for CI and other editors: a committed
project file should define the shared policy.

## Shared Architecture

Add a dedicated project config module, likely `src/config-file/`, with small
units:

- `discovery.ts`: find `sight.toml` and detect stale `.sight.json` during the
  same bounded upward walk.
- `toml-loader.ts`: read and parse TOML into the public settings shape. Use an
  existing TOML parser dependency rather than a custom parser.
- `discovery-load.ts`: shared "discover then load" entry point returning
  `Loaded`, `LoadFailed`, or `None`, plus warnings for the caller to route.
- explicit-load helpers: resolve relative explicit config paths from a caller
  supplied base directory, then load that file without discovery. These are for
  `sight check --config PATH` and tests.
- `merge.ts`: deep merge raw client settings and raw project settings with
  project values winning at leaves.
- mapping helpers: normalize public config into `DeepPartial<StataLSPConfig>`.

The LSP should own how warnings are logged. The future CLI should own how
warnings are printed and when load failures become operator errors.

The public API should cover the future CLI cases now:

- default discovery from a search root
- explicit config path loading
- no-config mode represented by skipping discovery and using no project layer
- warnings returned as data, not printed by the loader
- load failure distinguished from no config found

## LSP Behavior

On initialization or workspace refresh:

1. Discover and load `sight.toml` from the active project root.
2. Store the raw project settings and active config path.
3. Merge raw client/editor settings and raw project settings.
4. Validate/default the merged partial config into a complete
   `StataLSPConfig`.
5. Configure the workspace indexer and cross-file systems from the result.
6. Validate open documents.

On `sight.toml` changes:

1. Rediscover the active project config.
2. Reload raw project settings.
3. Clear cached document settings.
4. Reconfigure affected services.
5. Revalidate open documents.

Malformed `sight.toml` in the LSP should log a warning and drop the project
layer for that reload, leaving client/default settings in effect. The editor
should not fail to start because of a bad config file.

The future `sight check` should use the same loader but treat a discovered,
unloadable config as an operator error.

If discovery finds a `sight.toml` that cannot be read or parsed, discovery does
not continue upward looking for another project config. The nearest file is the
project's config attempt, and a bad nearest config means no project layer in
the LSP and an operator error in `sight check`.

### Project Config Watching

The LSP must watch `sight.toml` changes so the project layer reloads without a
server restart.

The watcher strategy should cover both files inside the workspace and files on
the active discovery walk outside the workspace. This matters because upward
discovery can choose an ancestor `sight.toml` above the opened folder; a simple
workspace glob will not see edits there.

Register watches for candidate directories on the full bounded discovery walk,
not just exact files that exist at startup. This is necessary so creation of a
nearer `sight.toml`, deletion of the active `sight.toml`, or creation/removal of
stale `.sight.json` files triggers rediscovery.

At minimum, watch `sight.toml` and `.sight.json` in each candidate directory on
that walk. After every rediscovery, refresh the watcher set because the active
search root, candidate directories, or active config may have changed.

When a watched config event fires, rediscover from the active root rather than
assuming the changed file is active. This preserves the rule that the nearest
`sight.toml` on the discovery walk wins, including the case where a newly
created nearer file replaces a previously active ancestor config.

## TOML Schema

The `sight.toml` schema mirrors Sight's public server settings. Canonical docs
and examples should use camelCase keys and lowercase enum values.

```toml
indexWorkspace = true
adoPaths = []
lineCommentStyle = "//"
debug = false

[diagnostics]
enabled = true
indentation = false

[diagnostics.severity]
undefinedMacro = "warning"
undefinedVariable = "off"
styleWarnings = "hint"
malformedOperator = "warning"
spacedCompoundOperator = "information"
invalidOperatorSequence = "error"
cStyleLogicalInControlFlow = "information"
mixedLogicalOperators = "warning"

[formatting]
indentSize = 4
indentStyle = "spaces"
lineWidth = 80
preferredCommentStyle = "line"
normalizeCommentStyle = false
commentLineWidth = 72
mode = "source-preserving"
preserveAlignment = true

[completion]
cacheSize = 200
prefixMaxItems = 200

[indexing]
maxFileSizeBytes = 500000

[crossFile]
indexWorkspace = true
maxIndexedFiles = 1000
assumeCallSite = "end"
backwardDependencies = "auto"
maxBackwardDepth = 10
maxForwardDepth = 10
maxChainDepth = 20
maxCalleeRevalidations = 10

[crossFile.diagnostics]
missingFile = "warning"
maxDepth = "information"
callSiteIdentification = "information"
```

The top-level `indexWorkspace` and `crossFile.indexWorkspace` settings are
distinct because the existing server config has both. The top-level setting is
the legacy/global workspace-indexing switch. `crossFile.indexWorkspace` is the
cross-file system's indexing switch. Indexing runs only when both are enabled,
so either value can disable workspace indexing. Both default to `true`.
Documentation should name both switches and explain the AND behavior whenever
it shows one of them.

`lineCommentStyle` belongs in `sight.toml` because server formatting behavior
uses it to resolve `formatting.preferredCommentStyle = "line"`. It is not a
diagnostic setting.

The loader should accept section names, keys, and enum/string option values
case-insensitively when they are otherwise known. It should normalize them to
the canonical internal shape. The docs should not advertise alternate casing as
style; leniency is a courtesy for users.

If two keys normalize to the same canonical path in one `sight.toml`, the loader
should warn and use a deterministic winner that does not depend on source-order
metadata from the TOML parser. Prefer exact canonical spelling over
case-insensitive aliases. If no occurrence uses canonical spelling, ignore all
colliding aliases for that canonical path so a typo in casing cannot
nondeterministically mask client/editor settings. The warning should name the
canonical path and the raw keys that collided.

Unknown keys should produce warnings and be ignored. Invalid project values
should not mask valid lower-precedence client/editor values. When the loader or
mapper can identify an invalid project leaf, it should warn and omit that leaf
before merge. The config validator still fills built-in defaults for keys that
remain absent after merging all valid client/editor and project settings.

## Server-Side Versus Client-Only Settings

`sight.toml` should include settings that affect server behavior or future
`sight check` behavior:

- diagnostics
- formatting
- completion
- indexing
- cross-file resolution
- ADO path resolution
- debug/server behavior

It should exclude VS Code-only settings that control local UI, panels,
terminals, webviews, or editor command behavior. Examples include
`sight.sendToStata.*` settings such as `stataApp`, `focusStataWindow`,
`saveBeforeSend`, `advanceCursorOnSend`, `target`, and `workingDirectory`.

## Multi-Root Workspaces

Use the first workspace folder as the active project root for v1, matching the
existing global-config shape. Sight's config is currently global across the
server instance, so true per-folder project configs would require broader state
changes. Users who need a different project config can open that folder
directly.

## Testing

Add focused tests for:

- TOML parsing into the public settings shape.
- Public-to-internal mapping for every server-side config section.
- Case-insensitive matching for known keys, sections, and enum values.
- Duplicate keys that normalize to the same canonical path warning and using
  canonical spelling when present, otherwise ignoring all colliding aliases.
- Unknown-key warnings.
- Malformed TOML returning `LoadFailed`.
- `.sight.json` detection and unsupported-config warnings.
- Discovery walking upward from the LSP/CLI search root, nearest `sight.toml`
  winning, malformed nearest config not falling through to ancestors, and
  stopping at the configured depth.
- Explicit config path resolution and no-config mode for the future CLI.
- Merge semantics: project wins at leaves, client survives where project is
  silent, arrays replace wholesale.
- LSP refresh reading `sight.toml`.
- LSP config reload clearing cached settings and revalidating open documents.
- Watched-file events for candidate-directory `sight.toml` creation, edit, and
  deletion, including newly-created nearer configs and fallback after deletion.
- Watched-file events for candidate-directory `.sight.json` refreshing
  unsupported-config warnings without loading JSON.

Update docs to describe `sight.toml`, precedence, the supported schema, and
the removal of `.sight.json`.

## Follow-Up

The next feature, `sight check`, should consume the shared config module rather
than reimplementing discovery or merge behavior. Its CLI behavior should mirror
Raven: malformed or unreadable discovered config is an operator error, while
warnings are printed to stderr.

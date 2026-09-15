# Respect Gitignore during workspace discovery

## Behavior

Add `workspace.respectGitignore`, default `true`, to `sight.toml` and expose
`sight.workspace.respectGitignore` in VS Code. Preserve configuration aliases
and project-over-editor precedence. The CLI reads project configuration.

The setting filters automatic source discovery in `sight check`, the workspace
index, and automatic caller relationships. Explicit CLI files, editor-open
documents, and explicitly resolved dependencies remain available for analysis.
Configured Sight exclusions, hidden-directory pruning, source extensions, and
symlink traversal keep their existing behavior. External ADO roots are outside
this workspace policy.

Read root and nested `.gitignore` files without invoking Git. When a workspace
is below a Git repository root, include ancestor ignore files up to the nearest
`.git` file or directory. Without repository metadata, start at the workspace
root. Nested repositories encountered within a workspace retain the selected
workspace's ignore hierarchy; selecting one as a workspace establishes its own
root. A named CLI directory still applies ignore rules to discovered files.

Honor nested negation, anchored patterns, directory-only rules, and the rule
that an ignored parent cannot be reopened by a child's ignore file. Match
case-sensitively. Do not consult Git's tracked-file index, global exclusions,
or `.git/info/exclude`. Ignore symlinked `.gitignore` files. Missing files are
normal; other read errors warn once per matcher and preserve available rules.

## Design decisions

Explorer agents traced discovery, configuration, graph ownership, and the
recent PR process. Architecture agents compared a standalone matcher,
generation-scoped contexts, and a common policy for all discovery exclusions.

Use a standalone `GitignoreMatcher` with a single file/directory query and
watch-directory descriptions. Cache directory contexts and absent ignore files
behind that interface. Create a fresh matcher for each scan generation rather
than exposing cache invalidation to callers. Use `ignore` as a direct runtime
dependency. Keep the existing configured glob matcher separate.

The matcher makes discovery decisions and does not mutate graph state.
Incremental indexing of ignored files must preserve edges owned by open
documents. Closing an ignored document removes its caller edges because a
disk reindex will no longer replace them. Explicit dependency resolution stays
independent of discovery filtering.

## Implementation steps

1. Add the shared matcher, runtime dependency, and temporary-directory tests
   for pattern semantics, root scope, caching, and watch locations.
2. Add the setting to shared types, defaults, mapping, validation, VS Code
   contribution, documentation, and configuration tests.
3. Apply the matcher to CLI directory discovery, index scans, direct indexing,
   and queued updates. Reuse the indexer's decision for explicit-file cap
   exemptions. Test CLI/indexer parity and explicit dependency behavior.
4. Add `.gitignore` notifications and watch registrations. Coalesce refreshes,
   cancel stale scan work, replace matcher state, rescan, and revalidate open
   documents. Include the setting in the indexing signature. Test ignored
   caller close/reopen behavior and removal/restoration of discovered edges.
5. Run two independent review/fix passes, including a cold review. Check
   lifecycle races, ignore semantics, source-discovery contracts, and tests.
6. Run each gate independently:
   - `bun run check:line-endings`
   - `bun run typecheck`
   - `bun test ./tests`
   - `bun run lint`
7. Open a focused PR, address CI and CodeRabbit findings, verify the final
   commit and checks, then squash merge. Do not bump versions or release.

## Validation priorities

Test observable file selection, symbols, caller relationships, and diagnostics.
Include default/disabled behavior, nested rules and ignored parents, ancestor
rules and standalone projects, case sensitivity, external ADO roots, explicit
files at the index cap, and directly referenced ignored dependencies.

Exercise `.gitignore` creation/change/deletion and setting changes through
actual LSP handlers. Verify that ignored open documents retain live analysis,
closing them removes buffer-only caller edges, reopening rebuilds those edges,
and superseded scans cannot restore stale entries.

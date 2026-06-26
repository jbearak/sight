# Symlink-aware directory walks (issue #219)

## Problem

Several directory-walk sites classify `readdir` entries with only
`Dirent.isDirectory()` / `Dirent.isFile()`. For a symlink entry **both** return
`false` (the true predicate is `isSymbolicLink()`), so symlinked directories and
symlinked `.do`/source files are silently invisible to these walks. A Stata
project laid out with symlinked directories or symlinked source files is not
fully indexed, checked, or completed.

This is the same class of bug fixed in PR #216 for `resolve_path_rich`
(`src/utils/file-path-utils.ts`). Those sites are **pre-existing** (they never
followed symlinks — not regressions), so #216 left them out of scope and #219
tracks them.

## Affected sites

| Site | Function | I/O | Recursive? |
|------|----------|-----|------------|
| `src/indexer/index.ts:308` | `scan_directory` | async (`fs.promises.readdir`) | yes, **unbounded** |
| `src/indexer/index.ts:1298` | `find_sthlp_file_recursive` | async | yes, depth-capped (8) |
| `src/cli/source-files.ts:67` | `walk_sources` | sync (`fs.readdirSync`) | yes, **unbounded** |
| `src/providers/completion.ts:~1426` | path completion | sync | no (single dir listing) |

Note: `collect_report_targets` (the caller of `walk_sources`) already
`fs.statSync`s each **explicit** top-level input path, so an explicitly named
symlinked file/dir already works; only the recursive `walk_sources` descent
misses symlinks. No change needed there.

## Reference behavior (PR #216)

`resolve_path_rich` added a `statSync` to its injected fs seam and two private
helpers, `entry_is_dir` / `entry_is_file`:

- Fast path: `entry.isDirectory()` / `entry.isFile()` — no extra syscall for the
  common non-symlink entry.
- Symlink path: only when `entry.isSymbolicLink()`, `statSync(full_path)` (which
  follows the link) and classify by the **target's** `isDirectory()`/`isFile()`.
- A dangling symlink makes `statSync` throw; caught → treated as non-matching
  (skipped, not crashed).

We reuse exactly this logic.

## Design

### 1. Shared symlink-aware classification helper

`resolve_path_rich` already contains the canonical sync implementation as the
private `entry_is_dir` / `entry_is_file`. To avoid a fourth and fifth copy of
the same try/catch, extract the logic into a new focused module and have all
consumers (including `file-path-utils.ts`) call it.

New file `src/utils/symlink-aware-entry.ts`:

```typescript
/** Minimal fs seam: a stat that FOLLOWS symlinks (throws on dangling). */
export interface StatSyncFs {
    statSync(p: string): { isFile(): boolean; isDirectory(): boolean };
}
export interface StatAsyncFs {
    stat(p: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
}

interface DirentLike {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

export function entry_is_directory_sync(
    entry: DirentLike, full_path: string, fs: StatSyncFs): boolean;
export function entry_is_file_sync(
    entry: DirentLike, full_path: string, fs: StatSyncFs): boolean;
export async function entry_is_directory_async(
    entry: DirentLike, full_path: string, fs: StatAsyncFs): Promise<boolean>;
export async function entry_is_file_async(
    entry: DirentLike, full_path: string, fs: StatAsyncFs): Promise<boolean>;
```

Each is the PR #216 shape: fast path on the `Dirent` predicate; on
`isSymbolicLink()`, stat the full path and classify by the target; `try/catch`
→ `false` on a dangling/erroring link. The sync and async pairs share identical
logic, differing only in `await`.

`file-path-utils.ts`'s private `entry_is_dir` / `entry_is_file` are rewritten to
delegate to `entry_is_directory_sync` / `entry_is_file_sync` (one source of
truth). `RichResolveFs.statSync` already satisfies `StatSyncFs`, so the resolver
and its tests are unaffected behaviorally — verified by the existing
`path-resolve-rich.test.ts` symlink suite.

### 2. Cycle protection for unbounded recursive walks

`resolve_path_rich` walks a **fixed component list** from a request path, so it
cannot loop. The two unbounded recursive discovery walks (`scan_directory`,
`walk_sources`) *can*: a directory symlink pointing at an ancestor
(`/ws/sub/link -> /ws`) becomes an infinite descent the moment we start
following symlinked directories. We must add a guard **as part of this fix**, or
we trade an invisible-files bug for a hang.

`find_sthlp_file_recursive` is already bounded by `MAX_STHLP_SEARCH_DEPTH = 8`,
so it cannot hang; it gets the classification fix but no cycle set. (Worst case:
a symlink cycle is re-walked up to depth 8 — bounded and cheap. Adding the set
there too is harmless but not required; we add it for consistency only if it
costs nothing — decision: **do not** add it there, to keep the depth-capped path
unchanged.)

**Guard strategy — canonical-path visited set, symlinked-dirs only:**

- A non-symlink subdirectory of a tree can never create a cycle, so the common
  case stays exactly as today (no extra syscall, no set membership cost worth
  mentioning).
- Only when we are about to descend into an entry that is a **symlinked
  directory** do we resolve its real path (`fs.realpathSync` / `fs.promises.realpath`)
  and check a `Set<string>` of already-entered canonical dirs. If present →
  skip. Otherwise add and recurse.
- `realpath` on the symlink target also collapses two different symlinks to the
  same physical dir, avoiding duplicate indexing.
- If `realpath` throws (dangling/raced), skip that entry.

This keeps cycle-detection cost proportional to the number of symlinked
directories, not the (far larger) number of plain directories.

`scan_directory` currently takes `(dir_path, generation)`. Thread an optional
`visited_real_dirs: Set<string>` (created at the scan root, default a fresh
empty set) through the recursion. `walk_sources` similarly threads a
`Set<string>`.

### 3. Per-site changes

**`scan_directory` (async):** for each entry, replace
`entry.isDirectory()` → `await entry_is_directory_async(entry, entry_path, fs.promises)`
and `entry.isFile() && hasStataExtension(...)` →
`(await entry_is_file_async(entry, entry_path, fs.promises)) && hasStataExtension(...)`.
Before recursing into a directory that is a symlink, apply the cycle guard from
§2. The VCS-metadata skip (`VCS_METADATA_DIRS.has(entry.name)`) is unchanged and
still keyed on the entry name.

**`find_sthlp_file_recursive` (async):** same async classification swap; no
cycle set (depth-capped). `EXCLUDED_DIRS` check unchanged.

**`walk_sources` (sync):** swap to `entry_is_directory_sync` / `entry_is_file_sync`
with the real `fs` (`{ statSync: fs.statSync }`). Apply the §2 cycle guard
(sync `realpath`) before descending symlinked dirs. `VCS_METADATA_DIRS` check
unchanged.

**path completion (sync):** swap the two predicates to the sync helpers. No
recursion → no cycle set. The hidden-file skip (`entry.name.startsWith('.')`)
and prefix filter are unchanged. A symlinked dir is offered with the trailing
`/`; a symlinked Stata file is offered like a regular file.

### 4. Out of scope / explicitly preserved

- **No new symlink-following anywhere except classification + guarded descent.**
  We do not resolve/canonicalize output paths reported to users — indexed and
  completed paths remain the symlink path as written (matching how non-symlink
  entries are reported today). Only the internal cycle set uses canonical paths.
- `resolve_path_rich`'s external behavior is unchanged; the refactor is
  mechanical de-duplication covered by existing tests.
- `find_sthlp_file_recursive` keeps its depth cap as its loop bound.

## Testing

Mirror `path-resolve-rich.test.ts`'s injected-fs approach (a fake fs mapping
paths → `link-dir` / `link-file` / `link-dead` kinds) so tests are deterministic
and platform-independent (no real symlinks on disk, which are awkward on CI /
Windows).

New unit tests for `symlink-aware-entry.ts`:
- symlinked-dir entry → `entry_is_directory_*` true, `entry_is_file_*` false
- symlinked-file entry → file true, dir false
- dangling symlink → both false, no throw
- plain dir / plain file → fast path, stat never called (spy asserts 0 calls)
- sync and async variants each covered

Per-site tests (injected fs where the site supports it; otherwise a temp dir
with real symlinks guarded for the platform):
- **indexer `scan_directory`:** a symlinked `.do` file is indexed; a symlinked
  subdirectory's files are indexed; a directory symlink cycle terminates and
  does not double-index.
- **indexer `find_sthlp_file_recursive`:** a symlinked `.sthlp` (or symlinked
  dir containing it) is found.
- **`walk_sources` / `collect_report_targets`:** symlinked source file and
  symlinked subtree are discovered; a cycle terminates.
- **path completion:** symlinked dir and symlinked `.do` appear as completions.

Existing `path-resolve-rich.test.ts` symlink suite must stay green after the
delegation refactor (regression guard for §1).

## Risks

- **Performance:** stat/realpath only on symlink entries; non-symlink fast path
  unchanged. Negligible for non-symlinked projects (the common case).
- **Cycle guard correctness:** canonical-path set is the standard, robust
  approach; the main subtlety (only guard symlinked-dir descent) is called out
  so reviewers can confirm a plain deep tree pays nothing.
- **Refactor regression in the resolver:** bounded — delegation preserves
  semantics and is covered by the existing symlink test suite.

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
| `src/indexer/index.ts` | `scan_directory` | async (`fs.promises.readdir`) | yes, **unbounded** |
| `src/indexer/index.ts` | `find_sthlp_file_recursive` | async | yes, depth-capped (8) |
| `src/cli/source-files.ts` | `walk_sources` | sync (`fs.readdirSync`) | yes, **unbounded** |
| `src/providers/completion.ts` | path completion | sync | no (single dir listing) |

Note: `collect_report_targets` (the caller of `walk_sources`) already
`fs.statSync`s each **explicit** top-level input path, so an explicitly named
symlinked file/dir already works; only the recursive `walk_sources` descent
misses symlinks. No change needed there.

These are the sites the original bug touches. The fix's reach differs by site
(see §2): the **persistent indexer** `scan_directory` is intentionally left
real-files-only (it cannot keep a symlink-alias entry fresh — Codex round-7),
no walk descends symlinked directories, and the **one-shot** consumers
(`walk_sources`, `find_sthlp_file_recursive`, path completion) follow symlinked
files.

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
private `entry_is_dir` / `entry_is_file`. Rather than copy that try/catch into
each new walk site, extract it into a focused module and have all consumers
(including `file-path-utils.ts`) call it.

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
export async function entry_is_file_async(
    entry: DirentLike, full_path: string, fs: StatAsyncFs): Promise<boolean>;

// Single-syscall classifier for path completion, which lists one directory
// level and offers BOTH symlinked dirs and symlinked files (dir-then-file on
// the same entry — the boolean pair would stat a symlink twice).
export type EntryKind = 'directory' | 'file' | 'other';
export function classify_entry_sync(
    entry: DirentLike, full_path: string, fs: StatSyncFs): EntryKind;
```

Each is the PR #216 shape: fast path on the `Dirent` predicate; on
`isSymbolicLink()`, stat the full path and classify by the target; `try/catch`
→ `false`/`'other'` on a dangling/erroring link.

`entry_is_directory_sync` / `entry_is_file_sync` serve `resolve_path_rich`
(which tests *either* dir or file on a given entry, never both) and
`walk_sources` (`entry_is_file_sync`). `entry_is_file_async` serves the
on-demand async `.sthlp` lookup. `classify_entry_sync` serves path completion.
There is deliberately **no** async directory variant or async classifier: the
recursive walks descend only real subdirectories (`Dirent.isDirectory()`), so
they never async-classify a directory.

`file-path-utils.ts`'s private `entry_is_dir` / `entry_is_file` delegate to
`entry_is_directory_sync` / `entry_is_file_sync` (one source of truth).
`RichResolveFs.statSync` already satisfies `StatSyncFs`, so the resolver and its
tests are unaffected behaviorally — verified green by the existing
`path-resolve-rich.test.ts` symlink suite.

### 2. Traversal policy: follow symlinked files, do NOT descend symlinked dirs

Classification (§1) tells a walk *what* an entry is. It does **not** by itself
decide *whether to descend* — and `resolve_path_rich` never had to, because it
walks a **fixed component list** from a request path and cannot loop or escape.
The three recursive walks (`scan_directory`, `walk_sources`,
`find_sthlp_file_recursive`) enumerate arbitrary trees, where recursively
following symlinked **directories** introduces a cluster of hazards (raised by
Codex's adversarial reviews of both the spec and the implementation):

1. **Cycles** — a dir symlink pointing at an ancestor (`/ws/sub/link -> /ws`).
2. **Escape** — a dir symlink to outside the workspace (`/ws/link -> /Users/me`)
   crawls an arbitrary external tree. The indexer's `maxIndexedFiles` cap does
   **not** bound this: it gates *indexing* inside `index_file`
   (`should_skip_for_max_indexed_files`), while the directory walk keeps
   recursing regardless.
3. **Aliasing / duplicate indexing** — the same physical dir reached via a
   symlink and via its real path is walked/indexed twice under distinct URIs
   (`index_file` keys by traversal path, not realpath); a symlink to a
   *declared root* can even claim that root before its own scan.
4. **TOCTOU + exclusion bypass** — a parent-side boundary check is racy, and a
   symlink named innocuously but pointing at `.git`/`node_modules` bypasses the
   name-based exclusion.

Two realizations shape the policy:

1. **Descending symlinked directories adds essentially no coverage.** If a
   symlinked dir's target is *inside* the workspace, the direct scan of its
   real location already covers those files; if *outside*, that is precisely
   the escape hazard. So no walk descends symlinked directories.
2. **The persistent workspace index cannot safely follow symlinked files
   either.** It keys entries by path (`URI.file(file_path)`) and the file
   watcher (`onDidChangeWatchedFiles`) re-indexes/removes only the *changed
   event path*. An `alias.do -> real.do` entry indexed alongside `real.do`
   would go stale the moment `real.do` is edited (the watcher fires for
   `real.do`, not `alias.do`), leaving duplicate/stale symbols in
   completions, go-to-definition, and the dependency graph. (Codex round-7
   finding.) Rather than add a realpath→aliases invalidation map, the
   long-lived index holds **real files only**.

So:

- **Recursive walks recurse into real subdirectories only**
  (`entry.isDirectory()`, the pre-existing check). Recursion follows only real
  subdirectories exactly as before, so the change adds **no** new symlink
  cycle/escape risk and needs **no** visited set, realpath, or boundary
  machinery; the TOCTOU / aliasing / exclusion-bypass classes a symlinked-dir
  descent would create do not arise. (OS-level Windows junctions and bind
  mounts report as real directories via `isDirectory()` and are descended just
  as the pre-existing code descended them — unchanged by this fix, out of
  scope.)
- **The persistent indexer (`scan_directory`) follows real files only** — its
  file branch is unchanged (`entry.isFile() && hasStataExtension(name)`), for
  the staleness reason above. In-workspace symlink targets are covered via
  their real path; external targets are declared as a workspace folder /
  ado-path.
- **One-shot consumers follow symlinked source FILES**, where there is no
  long-lived path-keyed state to keep fresh, so no staleness can arise:
  - **path completion** offers symlinked dirs (navigable folders) and files;
  - **`sight check`** (`walk_sources`) discovers symlinked source files in its
    single scan;
  - the on-demand **`.sthlp` lookup** (`find_sthlp_file_recursive`, a fresh
    per-request walk that returns a path and never caches into the index)
    matches a symlinked help file.
  Each keeps its existing **name-based** match (`hasStataExtension(entry.name)`,
  or `name === basename` for `.sthlp`) and adds `entry_is_file_*` to confirm
  the target is a regular file. Detection is by the link's own name (matching
  how regular files are matched): a link named `analysis.do` is followed
  (target anywhere), a link without a Stata-extension name is not.

This is the conscious scope decision: **the persistent index follows neither
symlinked directories nor symlinked files; one-shot consumers follow symlinked
files; no walk descends symlinked directories.**

### 3. Per-site changes

**`scan_directory` (async, persistent index):** **unchanged from `main`** —
directory branch `entry.isDirectory()` (real subdirs only) with the
`VCS_METADATA_DIRS` skip, file branch `entry.isFile() &&
hasStataExtension(entry.name)`. The persistent index follows neither symlinked
dirs nor symlinked files (staleness reason in §2). A brief comment records why.

**`find_sthlp_file_recursive` (async, on-demand lookup):** directory branch stays
`my_dirent.isDirectory()` with the `EXCLUDED_DIRS` skip and the depth cap. File
branch becomes `my_dirent.name === basename && await entry_is_file_async(...)`
so a symlinked `.sthlp` is matched.

**`walk_sources` (sync):** signature unchanged. Directory branch stays
`entry.isDirectory()` with the `VCS_METADATA_DIRS` skip. File branch becomes
`hasStataExtension(entry.name) && entry_is_file_sync(entry, entry_path, fs)`
(cheap name check first, same gating as the other walks). `collect_report_targets`
then de-duplicates the discovered files by **realpath** (keeping the
lexically-smallest name) instead of by raw path string, so a symlink and its
in-tree target are checked once — no duplicate diagnostics. (Explicit top-level
input paths already `statSync` + `canonicalize_existing_path`, so a
directly-named symlink already works.)

**path completion (sync):** uses `classify_entry_sync(entry, full_path, fs)` and
offers `'directory'` (incl. symlinked dirs) with a trailing `/` and `'file'`
(incl. symlinked files) as files. **No recursion** → listing a symlinked dir is
safe; navigating into it re-lists that one level on the next request. Hidden-file
skip (`entry.name.startsWith('.')`) and prefix filter unchanged.

### 4. Out of scope / explicitly preserved

- **Symlinked directories are not recursively descended** by any walk (see §2).
  In-workspace targets are covered by the direct scan; external targets must be
  declared as a workspace folder / ado-path. Path completion still *offers*
  symlinked dirs (listing, not recursion).
- **The persistent workspace index follows real files only** (see §2) — it does
  not add symlinked-file aliases it could not keep fresh. Symlinked files are
  followed by the one-shot consumers (completion, `sight check`, `.sthlp`
  lookup) only.
- **Output paths stay as written.** Indexed URIs / completion labels remain the
  path as encountered, matching non-symlink entries.
- `resolve_path_rich`'s external behavior is unchanged; the helper extraction is
  mechanical de-duplication covered by existing tests.

## Testing

Mirror `path-resolve-rich.test.ts`'s injected-fs approach (a fake fs mapping
paths → `link-dir` / `link-file` / `link-dead` kinds) so tests are deterministic
and platform-independent (no real symlinks on disk, which are awkward on CI /
Windows). For sites whose seams are not injectable, use a temp dir with real
symlinks, guarded so the test skips where the platform cannot create symlinks.

New unit tests for `symlink-aware-entry.ts`:
- symlinked-dir / symlinked-file / dangling / plain-dir / plain-file across the
  boolean helpers and `classify_entry_sync`
- fast path asserts the stat seam is **never called** for plain entries
- `entry_is_file_async` covered (sync + async parity)

Per-site tests (real temp-dir symlinks, skipped where the platform can't make
them):
- **indexer `scan_directory`:** a symlinked `.do` is **not** added to the index
  (real files only); a symlinked dir's in-workspace target is indexed via its
  real path; an ancestor-pointing dir symlink does not hang (not descended); a
  dir symlink whose target is **outside** the workspace is **not descended**; a
  dangling symlink does not break the scan.
- **`.sthlp` lookup `find_sthlp_file_recursive`:** a symlinked `.sthlp` under a
  real subdir is found; a dangling symlinked `.sthlp` is not returned; a dir
  symlink is not recursed through.
- **`walk_sources` / `collect_report_targets`:** external-target symlinked
  source file discovered; a symlink + its in-tree target reported once
  (realpath dedup); non-source symlink not discovered; symlinked-dir target
  discovered via its real path; dir symlink not recursed; external dir symlink
  not descended.
- **path completion:** a symlinked dir and a symlinked `.do` appear as
  completions; an external-target symlinked dir is offered; a dangling symlink
  is not.

Existing `path-resolve-rich.test.ts` symlink suite must stay green after the
delegation refactor (regression guard for §1) — confirmed.

## Risks

- **Performance:** in the one-shot consumers, `stat` only on symlinked entries
  (one syscall, only when the `Dirent` fast path doesn't resolve it). The
  indexer (the hot startup path) is unchanged.
- **External symlink targets not indexed:** a symlinked directory or file whose
  target is outside the workspace is not in the persistent index. Mitigation:
  documented; declare the target as a workspace folder / ado-path. Chosen over
  crawling symlinked dirs (cycle/escape/aliasing/TOCTOU hazards) and over
  indexing symlinked-file aliases (path-keyed staleness, Codex round-7) — both
  for little gain on in-workspace layouts.
- **Refactor regression in the resolver:** bounded — delegation preserves
  semantics and is covered by the existing symlink test suite (confirmed green).

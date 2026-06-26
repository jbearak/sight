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

// Single-syscall classifier for walker call sites that test dir-then-file
// on the same entry (the boolean pair would stat a symlink twice).
export type EntryKind = 'directory' | 'file' | 'other';
export function classify_entry_sync(
    entry: DirentLike, full_path: string, fs: StatSyncFs): EntryKind;
export async function classify_entry_async(
    entry: DirentLike, full_path: string, fs: StatAsyncFs): Promise<EntryKind>;
```

Each is the PR #216 shape: fast path on the `Dirent` predicate; on
`isSymbolicLink()`, stat the full path and classify by the target; `try/catch`
→ `false`/`'other'` on a dangling/erroring link. The sync and async pairs share
identical logic, differing only in `await`.

The boolean pair stays for `resolve_path_rich`, which tests *either* dir
(non-final component) *or* file (final component) on a given entry, never both.
The four recursive/listing walk sites test **directory-then-file** on the same
entry, so they use `classify_entry_*` to avoid stat-ing a symlinked entry twice
(Codex review, minor #4).

`file-path-utils.ts`'s private `entry_is_dir` / `entry_is_file` delegate to
`entry_is_directory_sync` / `entry_is_file_sync` (one source of truth).
`RichResolveFs.statSync` already satisfies `StatSyncFs`, so the resolver and its
tests are unaffected behaviorally — verified green by the existing
`path-resolve-rich.test.ts` symlink suite. *(Already implemented.)*

### 2. Traversal policy for recursive walks (separate from classification)

Classification (§1) tells a walk *what* an entry is. It does **not** decide
*whether to descend* — and `resolve_path_rich` never had to, because it walks a
**fixed component list** from a request path and cannot loop or escape. The
three recursive walks (`scan_directory`, `walk_sources`,
`find_sthlp_file_recursive`) enumerate arbitrary trees, so following symlinked
directories introduces two distinct hazards that classification alone does not
address (Codex review, major #1/#2/#3):

1. **Cycles** — a directory symlink pointing at an ancestor
   (`/ws/sub/link -> /ws`) is an infinite descent.
2. **Escape** — a directory symlink pointing outside the declared scan roots
   (`/ws/link -> /Users/me`) makes the walk crawl an arbitrary external tree.
   The indexer's `maxIndexedFiles` cap does **not** bound this: it gates
   *indexing* inside `index_file` (`should_skip_for_max_indexed_files`,
   `src/indexer/index.ts:421`), while `scan_directory` keeps recursing
   regardless, so the directory walk itself is unbounded.
3. **Duplicate traversal/indexing** — the same physical dir reached via two
   paths (`/ws/a` and `/ws/link_to_a`) is walked and indexed twice under
   distinct URIs (symbols are keyed by traversal path, `src/indexer/index.ts:450`).

**Policy — canonical visited set + scan-root boundary, threaded per walk:**

Each top-level walk owns a `visited_real_dirs: Set<string>` and a set of
**canonical boundary roots** (the canonical form of the directories the walk was
explicitly told to scan). On entering *any* directory `dir` to scan (root and
every subdirectory, symlinked or not):

1. `canonical = realpath(dir)`; on throw (dangling/raced) → skip the directory.
2. If `visited_real_dirs.has(canonical)` → return (handles cycles **and**
   duplicate traversal/indexing for free). Else add it.
3. Recurse into child directories. For a child that **is a symlink**, first
   check its canonical target is within some canonical boundary root; if not,
   skip it (do not follow the escape). Non-symlink children are within the root
   by construction and need no boundary check.

Why `realpath` on every directory rather than only on symlinked entries: the
visited set must be keyed by physical identity to dedupe a plain subtree reached
*through* a symlink (`/ws/link/sub` vs `/ws/real/sub`). `realpath` is one
syscall per **directory** (not per file); directories are far fewer than files,
and the indexer already `stat`s every file it indexes (`src/indexer/index.ts:463`),
so the added cost is negligible against total scan work. The non-symlinked
common case gains one `realpath` per directory and no behavior change.

The boundary deliberately does **not** follow symlinks that escape the declared
roots. A user who wants an external shared library indexed adds it as a
workspace folder or ado-path (the indexer already accepts both) rather than
relying on an escaping symlink — a conservative, predictable default that avoids
silently crawling `$HOME`. This is an explicit, reviewed scope decision.

`find_sthlp_file_recursive` gets the **same** visited-set + boundary guard. Its
`MAX_STHLP_SEARCH_DEPTH = 8` cap bounds depth but **not** repeated traversal of
the same physical dirs within that depth, so the depth cap alone is not
sufficient (Codex review, major #3). Boundary root = the canonical `root_dir`
it was invoked with.

### 3. Per-site changes

**`scan_directory` (async):** signature gains a threaded
`visited_real_dirs: Set<string>` and `boundary_roots: string[]` (canonical).
`initialize` seeds `boundary_roots` once from the canonical form of
`workspace_folders ∪ ado_paths` and passes a fresh `visited_real_dirs` per
top-level `scan_directory` call (shared across its recursion). Per directory:
realpath + visited check (step 1–2). Per entry: `classify_entry_async(entry,
entry_path, fs.promises)`; `'directory'` → VCS skip, then symlink-boundary check
(step 3) before recursing; `'file'` + `hasStataExtension` → collect. VCS skip
(`VCS_METADATA_DIRS.has(entry.name)`) unchanged.

**`find_sthlp_file_recursive` (async):** add `classify_entry_async`; seed a
`visited_real_dirs` set and a single boundary root (canonical `root_dir`) at the
top; realpath + visited check before processing each popped dir; symlink
children get the boundary check before being pushed. `EXCLUDED_DIRS` unchanged;
depth cap retained as an additional bound.

**`walk_sources` (sync):** thread `visited_real_dirs` and a `boundary_root`
(canonical of the top dir passed by `collect_report_targets`). Use
`classify_entry_sync` with `{ statSync: fs.statSync }` and `fs.realpathSync` for
the visited/boundary logic. `VCS_METADATA_DIRS` skip unchanged. (Explicit
top-level input paths in `collect_report_targets` already `statSync` and
`canonicalize_existing_path`, so they are unaffected.)

**path completion (sync):** swap the dir/file predicates to
`classify_entry_sync` with `{ statSync: fs.statSync }`. **No recursion** → no
visited set, no boundary: the provider lists one directory level; navigating
into a symlinked dir re-lists that one level on the next request. Hidden-file
skip (`entry.name.startsWith('.')`) and prefix filter unchanged. A symlinked dir
is offered with the trailing `/`; a symlinked Stata file like a regular file.

### 4. Out of scope / explicitly preserved

- **Output paths stay as written (symlink paths), not canonicalized.** Indexed
  URIs and completion labels remain the traversal/symlink path, matching how
  non-symlink entries are reported today. Canonical paths are used *only*
  internally for the visited set and boundary check.
- **Escaping symlinks are not followed** (see §2). Declared roots are the
  boundary; external targets must be declared explicitly.
- `resolve_path_rich`'s external behavior is unchanged; the helper extraction is
  mechanical de-duplication covered by existing tests.

## Testing

Mirror `path-resolve-rich.test.ts`'s injected-fs approach (a fake fs mapping
paths → `link-dir` / `link-file` / `link-dead` kinds) so tests are deterministic
and platform-independent (no real symlinks on disk, which are awkward on CI /
Windows). For sites whose seams are not injectable, use a temp dir with real
symlinks, guarded so the test skips where the platform cannot create symlinks.

New unit tests for `symlink-aware-entry.ts` *(already implemented, 9 passing)*:
- symlinked-dir / symlinked-file / dangling / plain-dir / plain-file across the
  boolean pair and the `classify_entry_*` pair
- fast path asserts the stat seam is **never called** for plain entries
- sync and async variants each covered

Per-site tests:
- **indexer `scan_directory`:** symlinked `.do` is indexed; files under a
  symlinked subdir are indexed; an ancestor-pointing dir symlink **terminates**;
  the same physical file reached via a symlink is **not double-indexed**; a dir
  symlink whose target is **outside** all declared roots is **not followed**.
- **indexer `find_sthlp_file_recursive`:** a symlinked `.sthlp` (or symlinked
  dir containing it) is found; a cycle terminates within the depth cap.
- **`walk_sources` / `collect_report_targets`:** symlinked source file and
  symlinked subtree are discovered; a cycle terminates; an escaping symlink is
  not followed.
- **path completion:** symlinked dir and symlinked `.do` appear as completions.

Existing `path-resolve-rich.test.ts` symlink suite must stay green after the
delegation refactor (regression guard for §1) — confirmed.

## Risks

- **Performance:** one `realpath` per directory entered (not per file) plus
  `stat` only on symlinked entries. Negligible against per-file indexing work;
  the non-symlinked common case is otherwise unchanged.
- **Boundary too strict:** a symlink to an undeclared external tree is silently
  not indexed. Mitigation: documented behavior; the fix is to declare the target
  as a workspace folder / ado-path. Chosen over the alternative (crawl anywhere)
  because unbounded external traversal is the worse failure.
- **Refactor regression in the resolver:** bounded — delegation preserves
  semantics and is covered by the existing symlink test suite (confirmed green).

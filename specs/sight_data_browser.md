# Sight Data Browser

## Overview

A VS Code integrated data browser for Stata datasets, invoked from the Stata console via a custom `.ado` command. The browser renders in a VS Code webview panel with virtualized scrolling, lazy row loading via memory-mapped `.dta` file access, and full support for Stata metadata (variable labels, value labels, display formats).

This feature has no equivalent in any existing Stata editor or VS Code extension.

## Motivation

Stata's built-in `browse` command opens a separate GUI window that is disconnected from the editor. R users in VS Code benefit from tight `View()` integration via the vscode-R extension and Data Wrangler, but no analogous workflow exists for Stata. Data Wrangler itself is unsuitable for large datasets (it loads the full file into a pandas DataFrame) and discards Stata-specific metadata.

Sight is uniquely positioned to offer this because it already maintains a language server connection to VS Code and can extend the extension host with file parsing and webview capabilities.

## Architecture

```text
┌──────────────────┐         ┌──────────────────────────────────┐
│   Stata Console  │         │        VS Code / Sight           │
│                  │         │                                  │
│  . vview varlist │         │  ┌────────────┐  ┌───────────┐  │
│    [if] [in]     │────────▶│  │ File       │  │ Webview   │  │
│                  │  .dta   │  │ Watcher /  │─▶│ Panel     │  │
│  (saves temp     │  file + │  │ Signal     │  │ (grid UI) │  │
│   .dta, signals) │  signal │  │ Listener   │  │           │  │
│                  │         │  └────────────┘  └─────┬─────┘  │
└──────────────────┘         │        ▲                │        │
                             │        │    row requests │        │
                             │  ┌─────┴────────────────▼─────┐  │
                             │  │   .dta Parser / mmap       │  │
                             │  │   (random access backend)  │  │
                             │  └────────────────────────────┘  │
                             └──────────────────────────────────┘
```

### Components

1. **`vview.ado`** — Stata-side command that saves the (optionally subsetted) dataset to a temp `.dta` file, writes a JSON sidecar with request metadata, and touches a signal file.

2. **Signal listener** — Extension-side file watcher on `~/.sight/browse/` that detects new `*.json` sidecar files or `signal_*` files.

3. **`.dta` parser** — TypeScript module that reads `.dta` format 117/118/119 files. Supports:
   - Header-only reads (metadata without observation data)
   - Random-access observation reads via memory mapping or file offset seeks
   - `strL` resolution from the GSO block

4. **Webview panel** — A VS Code webview tab rendering a virtualized data grid. Communicates with the extension host via `postMessage` to request row pages on scroll.

## Stata-Side Interface

### Command Syntax

```stata
vview [varlist] [if] [in] [, Rows(integer) Name(string) Replace]
```

- `varlist` — optional variable subset; default is all variables (`_all`)
- `if` / `in` — standard Stata qualifiers for row subsetting
- `Rows(integer)` — max rows to export (default: all). Useful as a safety valve for very large datasets where even `.dta` writing is slow.
- `Name(string)` — tab label in VS Code (default: dataset name from `c(filename)` or "Untitled")
- `Replace` — if a browser tab with the same name is already open, refresh it instead of opening a new tab

### Behavior

1. `preserve` the current dataset.
2. Apply `varlist`, `if`, `in`, and `rows` constraints.
3. `save` to `~/.sight/browse/<uuid>.dta`, `replace`.
4. Write `~/.sight/browse/<uuid>.json` sidecar:

```json
{
  "version": 1,
  "uuid": "a1b2c3d4",
  "timestamp": "2026-03-26T14:30:00Z",
  "source": "/path/to/original/dataset.dta",
  "name": "auto",
  "subsetted": true,
  "varlist": ["make", "price", "mpg"],
  "if": "foreign == 1",
  "in": "",
  "N": 22,
  "k": 3,
  "replace": false
}
```

5. `restore` the dataset.
6. Touch `~/.sight/browse/signal_<uuid>` (or overwrite it with the uuid) to notify the extension.

### Reference Implementation

```stata
*! vview.ado — Open dataset in Sight Data Browser
*! Version 0.1.0

program define vview
    version 16.0
    syntax [varlist] [if] [in] [, Rows(integer 0) Name(string) Replace]

    // Resolve output directory
    local browsedir "~/.sight/browse"
    mata: st_local("browsedir", pathjoin(pathresolve("~"), ".sight", "browse"))
    cap mkdir "`browsedir'"

    // Generate request UUID
    local uuid = strtoname("_" + subinstr(c(current_date) + c(current_time), " ", "", .) ///
        + string(runiform(), "%12.0g"), 1)

    local dtapath "`browsedir'/`uuid'.dta"
    local jsonpath "`browsedir'/`uuid'.json"
    local signalpath "`browsedir'/signal_`uuid'"

    // Determine tab name
    if `"`name'"' == "" {
        if `"`c(filename)'"' != "" {
            local name = c(filename)
        }
        else {
            local name "Untitled"
        }
    }

    // Save subsetted data
    preserve
    
    // Apply if/in qualifiers
    marksample touse, novarlist
    qui keep if `touse'
    drop `touse'

    if "`varlist'" != "" {
        keep `varlist'
    }
    if `rows' > 0 {
        if _N > `rows' {
            keep in 1/`rows'
            di as txt "(showing first `rows' of `=_N' observations)"
        }
    }

    local obs_n = c(N)
    local var_k = c(k)

    qui save "`dtapath'", replace
    restore

    // Escape backslashes for JSON (Windows paths)
    local json_dtapath = subinstr(`"`dtapath'"', "\", "\\", .)
    local json_name = subinstr(`"`name'"', "\", "\\", .)

    // Write JSON sidecar
    tempname fh
    file open `fh' using "`jsonpath'", write replace
    file write `fh' `"{"' _n
    file write `fh' `"  "version": 1,"' _n
    file write `fh' `"  "uuid": "`uuid'","' _n
    file write `fh' `"  "name": "`json_name'","' _n
    file write `fh' `"  "dtapath": "`json_dtapath'","' _n
    file write `fh' `"  "N": `obs_n',"' _n
    file write `fh' `"  "k": `var_k',"' _n
    file write `fh' `"  "replace": `= cond("`replace'" != "", "true", "false")',"' _n
    file write `fh' `"  "subsetted": `= cond("`varlist'`if'`in'" != "", "true", "false")'"' _n
    file write `fh' `"}"' _n
    file close `fh'

    // Signal the extension
    file open `fh' using "`signalpath'", write replace
    file write `fh' "`uuid'"
    file close `fh'

    di as txt "Opened in Sight Data Browser" as res " (`obs_n' obs, `var_k' vars)"
end
```

## .dta Parser

### Requirements

- Parse `.dta` format versions 117 (Stata 13), 118 (Stata 14–15), and 119 (Stata 15+/MP).
- Implement two read modes:
  - **Metadata-only**: read header, variable names, types, sort order, display formats, variable labels, value label mappings, and value label tables. No observation data.
  - **Row-range read**: given a range `[start, end)`, return decoded observations for those rows only.

### .dta Format Layout (v118)

| Section | Content |
|---|---|
| Header | Format version, byte order, number of variables (K), number of observations (N), dataset label |
| Map | Byte offsets to each subsequent section |
| Variable types | K entries: type codes (fixed-width numerics + `strL` pointer) |
| Variable names | K null-terminated strings |
| Sort order | Sort variable indices |
| Display formats | K format strings (e.g., `%9.0g`, `%td`) |
| Value label names | K entries: associated value label name per variable |
| Variable labels | K descriptive label strings |
| Characteristics | Extension metadata (ignorable for browsing) |
| **Data** | **N × obs_length bytes (fixed-width)** |
| strLs (GSO) | Variable-length string storage, referenced by (v,o) pairs in data |
| Value labels | Named lookup tables mapping integers → strings |

### Random Access Strategy

The **data section** stores observations in fixed-width rows. Observation length is the sum of the byte widths of all K variables. For format 118:

- `byte`: 1 byte
- `int`: 2 bytes
- `long`: 4 bytes
- `float`: 4 bytes
- `double`: 8 bytes
- `str1`–`str2045`: 1–2045 bytes
- `strL`: 8 bytes (GSO pointer: `(v, o)` pair)

Given the **map** section's pointer to the data block start (`data_offset`) and the computed `obs_length`:

```text
row_offset(i) = data_offset + (i * obs_length)
```

To read rows `[start, end)`:

```typescript
const buf = Buffer.alloc((end - start) * obsLength);
await fd.read(buf, 0, buf.length, dataOffset + start * obsLength);
```

This is O(1) seek + O(page_size) read regardless of total dataset size.

### strL Resolution

`strL` fields store an 8-byte `(v, o)` pointer into the GSO (Generic String Object) block. The GSO block must be indexed on first open by reading through it and building a `Map<string, number>` keyed on `"v:o"` that maps to the byte offset in the file where the string starts. This index is built once and cached; it requires a single pass through the GSO block but does not require loading observation data or string content into memory.

For datasets where `strL` usage is minimal (most datasets), this overhead is negligible. For datasets with heavy `strL` usage, the GSO index will consume memory proportional to the number of distinct string values (just the offset numbers), not the number of observations or the string content itself. The actual string content is lazily read from disk using the offset only when requested by a row read.

### Module API

```typescript
interface DtaFile {
  // Open and parse metadata only
  static open(path: string): Promise<DtaFile>;

  // Metadata accessors
  readonly nobs: number;
  readonly nvar: number;
  readonly variables: VariableInfo[];
  readonly valueLabelTables: Map<string, Map<number, string>>;
  readonly datasetLabel: string;

  // Row access
  readRows(start: number, count: number, colStart?: number, colEnd?: number): Promise<Row[]>;

  // Cleanup
  close(): void;
}

interface VariableInfo {
  name: string;
  type: DtaType;
  format: string;          // e.g., "%9.0g", "%20s", "%td"
  label: string;           // variable label
  valueLabelName: string;  // name of associated value label table, or ""
}

type Row = (number | string | null)[];
```

## Webview Panel

### Grid Component

Use a virtualized grid library that supports:

- Rendering only visible rows + a configurable buffer (e.g., 50 rows above/below viewport)
- Column resizing
- Horizontal + vertical smooth scrolling
- Custom cell renderers (for value labels, missing values, formatting)

Candidate libraries (evaluate in order of preference):

1. **glide-data-grid** — React-based, canvas-rendered, handles millions of rows, good custom cell support
2. **ag-grid Community** — heavier but extremely full-featured; MIT-licensed community edition
3. **Custom canvas renderer** — maximum control, most work

### Row Loading Protocol

The webview and extension host communicate via `postMessage`:

```typescript
// Webview → Extension
interface RowRequest {
  type: "requestRows";
  start: number;
  count: number;
  colStart?: number;
  colEnd?: number;
  requestId: string;
}

// Extension → Webview
interface RowResponse {
  type: "rowData";
  start: number;
  colStart?: number;
  // rows array is either full width, or subsetted to [colStart, colEnd)
  rows: CellValue[][];
  requestId: string;
}

// Extension → Webview (initial)
interface MetadataMessage {
  type: "metadata";
  nobs: number;
  variables: {
    name: string;
    type: string;
    format: string;
    label: string;
    hasValueLabels: boolean;
  }[];
  datasetLabel: string;
  name: string;
}

type CellValue = {
  raw: number | string | null;
  display: string;  // formatted per Stata display format + value labels
};
```

### Display Behavior

- **Column headers**: variable name as primary text; variable label as subtitle or tooltip
- **Value labels**: when a variable has an associated value label table, cells display the label text with the numeric value in a tooltip (or togglable via a toolbar button)
- **Missing values**: Stata's extended missing values (`.`, `.a`–`.z`) rendered in gray italic
- **Display formats**: numeric values formatted according to Stata display format strings (`%9.2f`, `%12.0gc`, `%td`, etc.)
- **Toolbar**:
  - Toggle value labels on/off
  - Toggle display formats on/off (show raw values)
  - Search/filter (column-level text filter)
  - Row count indicator ("Showing 1–50 of 1,234,567")
  - Copy selection to clipboard (as TSV)
- **Status bar**: dataset name, N × K, source file path, whether subsetted

### Performance Targets

| Dataset size | Open (metadata) | Scroll to arbitrary row | Memory (extension) |
|---|---|---|---|
| 10K × 50 | < 50ms | < 10ms | < 5 MB |
| 1M × 100 | < 200ms | < 20ms | < 20 MB |
| 50M × 20 | < 500ms | < 50ms | < 50 MB |

Memory is dominated by the GSO index (if `strL` fields exist) and the value label tables. Observation data is never held in memory beyond the current page cache.

### Page Cache

Maintain a small LRU cache of decoded row pages (e.g., 10 pages × 200 rows each = 2,000 rows in memory). This smooths out rapid scrolling without unbounded memory growth.

```typescript
class RowCache {
  private cache: Map<number, { rows: Row[]; accessTime: number }>;
  private maxPages: number = 10;
  private pageSize: number = 200;

  getPage(startRow: number): Row[] | undefined;
  setPage(startRow: number, rows: Row[]): void;
  evictOldest(): void;
}
```

## Signal / IPC Mechanism

### Phase 1: File Watcher

The extension watches `~/.sight/browse/` using Node's `fs.watch` (or a library like `chokidar`). *Do not use `vscode.workspace.createFileSystemWatcher` as it only watches files inside the currently open workspace.* On change:

1. Detect new `signal_<uuid>` files. Extract the uuid.
2. Read `~/.sight/browse/<uuid>.json` for request metadata.
3. Open `~/.sight/browse/<uuid>.dta` via the `.dta` parser.
4. If `replace` is true and a tab with the same `name` exists, explicitly close the old `DtaFile` (to prevent file descriptor leaks) and refresh it; otherwise open a new tab.
5. Clean up: delete `.json` and `signal_<uuid>` file. Immediately `fs.unlink` the `.dta` file while keeping the mmap / file descriptor open (unlink-on-open pattern). The file disappears from `~/.sight/browse/` but the mmap remains valid for lazy row reads. When the tab closes (or VS Code crashes / the process exits), the OS reclaims the disk space automatically — no orphaned files. **Windows fallback:** Windows does not allow unlinking an open file. On Windows, delete the `.dta` on tab close via `onDidDispose`, and run a startup sweep on extension activation that prunes any `.dta` files in `~/.sight/browse/` older than 24 hours (to catch crashes).

## Implementation Milestones

### M0: .dta Parser (TypeScript)

- [ ] Parse v117/v118/v119 headers and metadata
- [ ] Compute observation byte layout and offsets
- [ ] Implement `readRows(start, count)` with direct file seeks
- [ ] Build GSO index for `strL` resolution
- [ ] Decode value labels
- [ ] Apply Stata display formats to numeric values
- [ ] Unit tests against known `.dta` files (use `auto.dta`, `census.dta`, etc.)

### M1: Webview Grid

- [ ] Set up webview panel infrastructure in the Sight extension
- [ ] Integrate virtualized grid (glide-data-grid or ag-grid)
- [ ] Implement `postMessage` row-request protocol
- [ ] Page cache (LRU)
- [ ] Column headers with variable labels
- [ ] Value label display + toggle
- [ ] Missing value rendering
- [ ] Copy-to-clipboard
- [ ] Toolbar and status bar

### M2: Stata Integration

- [ ] `vview.ado` — save, sidecar, signal
- [ ] File watcher in extension
- [ ] Tab management (replace, naming)
- [ ] Temp file lifecycle (unlink-on-open after mmap; no explicit tab-close cleanup needed)
- [ ] Register `vview` command in VS Code command palette (for re-triggering from editor side)

### M3: Polish

- [ ] Column sorting (client-side for small datasets; disabled above row count threshold)
- [ ] Column-level text filter
- [ ] Keyboard navigation (arrow keys, page up/down, Ctrl+Home/End)
- [ ] Theming (respect VS Code color theme via CSS variables)
- [ ] Accessibility (screen reader labels, ARIA attributes on grid)
- [ ] Performance benchmarking against target table above
- [ ] Register custom editor for `.dta` files (open from file explorer). **CRITICAL:** Unlink-on-open logic must be strictly sandboxed to the `~/.sight/browse/` temp directory to avoid deleting user files!

## Resolved Questions

1. **Format version scope**: The TypeScript `.dta` parser (M0) will support v117 (Stata 13) in addition to v118/v119, so users can browse older dataset files. The `vview.ado` itself targets Stata 16+ and will always write the current format.

2. **Column sorting on large files**: Start with (a) — disable sort above a row count threshold. Option (c), building a sort index file on first sort request, is tracked as a future enhancement (see jbearak/sight#108).

3. **Live refresh**: Deferred. The mechanism is unclear — Stata doesn't expose file-change hooks, and polling the dataset file is unreliable since Stata holds a lock on the active dataset. Revisit only if a concrete design emerges.

4. **Cross-platform paths and remote development**: `~/.sight/browse/` resolves to `%USERPROFILE%\.sight\browse\` on Windows via `mata: pathjoin()` on the Stata side and `os.homedir()` on the extension side. **Critically, the data browser logic (file watcher, `.dta` parser, row serving) must run on the server side of the extension host**, not the client. In VS Code Remote (SSH, WSL, containers), Stata and the `.dta` temp files live on the remote machine. The extension's server component (where the language server already runs) has filesystem access; the webview panel runs in the client but communicates back via `postMessage`. This is the standard VS Code remote architecture — no special handling is needed as long as all file I/O is in the extension host (server), not the webview (client).

5. **Could Data Wrangler handle `.dta` files?**: No — Data Wrangler loads the full file into a pandas DataFrame, which is slow for large datasets and discards Stata-specific metadata (value labels, display formats, variable labels). Instead, register a `CustomReadonlyEditorProvider` so double-clicking a `.dta` file in the Explorer opens the Sight Data Browser. This is a separate activation path from `vview` but shares all the same infrastructure (parser, webview, grid). Add to M3 milestones.

## `vview.ado` Installation and Updates

### Problem

Stata discovers commands by searching its ado-path (`sysdir` directories). For the user to type `vview` in Stata's console, the `vview.ado` file must exist somewhere on that path. The Sight extension bundles the `.ado` file but Stata has no knowledge of VS Code extensions.

### Strategy: Install to PERSONAL ado directory

The extension installs `vview.ado` into Stata's **PERSONAL** ado directory, which is always on the default ado-path and is the standard location for user-authored programs. This avoids modifying `sysdir` or `adopath` and works without any Stata-side configuration.

### Discovering the PERSONAL path

The PERSONAL directory is **not** a fixed path — it is user-configurable via `sysdir set PERSONAL` and varies across platforms and installations. Common defaults:

| Platform | Typical PERSONAL directory |
|---|---|
| macOS | `~/Documents/Stata/ado/personal/` |
| Linux | `~/ado/personal/` |
| Windows | `%USERPROFILE%\ado\personal\` |

But users may have changed it, so the extension must not hardcode these paths.

**Discovery mechanism — `sight.personalAdoDir` setting with auto-detection fallback:**

1. **Extension setting** (`sight.personalAdoDir`): If the user has configured this setting, use it directly. This is the escape hatch for non-standard setups.

2. **Auto-detection from `sysdir.ado`**: Stata stores its `sysdir` configuration in a file at `~/ado/personal/sysdir.ado` (the bootstrap location), or within the PERSONAL directory itself. This is unreliable for discovery since it's circular.

3. **Platform defaults**: If no setting is configured, use the platform default:
   - macOS: `~/Documents/Stata/ado/personal/` (the Stata for Mac default since Stata 16)
   - Linux: `~/ado/personal/`
   - Windows: `%USERPROFILE%\ado\personal\`

4. **Validation**: After resolving the path, check that the directory exists (or can be created). If it doesn't exist and creation fails, log a warning and skip installation — the user can configure the setting manually.

**First-run experience:**

On first activation, if the extension uses the platform default and successfully installs `vview.ado`, log a message to the output channel:

```text
Installed vview.ado to /Users/jmb/Documents/Stata/ado/personal/
If this is not your Stata PERSONAL directory, set sight.personalAdoDir in settings.
```

This gives users a clear signal if the path is wrong without requiring configuration for the common case.

### Lifecycle

**On extension activation:**

1. Resolve the PERSONAL ado directory (setting → platform default).
2. Compute the target path: `<PERSONAL>/vview.ado`.
3. Read the bundled `vview.ado` from the extension's install directory (`context.extensionUri`).
4. If the target file does not exist, or its content differs from the bundled version, write the bundled version to the target path. Create intermediate directories if they don't exist.
5. If the target file exists and matches the bundled version, do nothing.

This runs on every activation (which is fast — one `stat` + optional `readFile` comparison) so that extension updates automatically propagate the latest `vview.ado` to Stata.

**Version detection:**

The bundled `vview.ado` includes a version comment in its header (e.g., `*! Version 0.1.0`). The comparison is a byte-level content check, not version parsing — this is simpler, handles any change (bug fixes, formatting), and avoids version-string parsing edge cases.

**Conflict handling:**

If the user has manually placed a `vview.ado` in PERSONAL (or elsewhere on the ado-path), the extension's copy in PERSONAL will take precedence only if it's in the same or earlier directory on the ado-path. Since PERSONAL is searched before PLUS and other user directories by default, the extension's copy wins. If the user has a custom `vview.ado` in SITE or another earlier directory, that one wins — this is acceptable; power users who override the file are opting out of auto-management.

**No uninstall hook:**

VS Code does not provide a reliable extension uninstall lifecycle event. The `vview.ado` file is left in PERSONAL if the extension is uninstalled. This is harmless — the command simply errors once the signal listener is gone. A note in the README tells users they can delete the file manually after uninstalling.

### Bundling

The `vview.ado` source lives at `stata/vview.ado` in the extension source tree. The build step includes it in the extension package (`.vsix`) as a static asset. At runtime, it's read from `context.extensionUri` via `vscode.workspace.fs.readFile`.

### Milestone Mapping

This work belongs in **M2: Stata Integration**:

- [ ] Bundle `vview.ado` as a static asset in the extension package
- [ ] Add `sight.personalAdoDir` extension setting (optional, string)
- [ ] Implement PERSONAL directory resolution (setting → platform default)
- [ ] On activation, install/update `vview.ado` to resolved PERSONAL directory
- [ ] Log installation status to the output channel (installed, updated, already current, path used)

## Open Questions

_(None at this time.)_
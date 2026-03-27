# Sight Data Browser

## Overview

A VS Code integrated data browser for Stata datasets, invoked from the Stata console via a custom `.ado` command. The browser renders in a VS Code webview panel with virtualized scrolling, lazy row loading via memory-mapped `.dta` file access, and full support for Stata metadata (variable labels, value labels, display formats).

This feature has no equivalent in any existing Stata editor or VS Code extension.

## Motivation

Stata's built-in `browse` command opens a separate GUI window that is disconnected from the editor. R users in VS Code benefit from tight `View()` integration via the vscode-R extension and Data Wrangler, but no analogous workflow exists for Stata. Data Wrangler itself is unsuitable for large datasets (it loads the full file into a pandas DataFrame) and discards Stata-specific metadata.

Sight is uniquely positioned to offer this because it already maintains a language server connection to VS Code and can extend the extension host with file parsing and webview capabilities.

## Architecture

```
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

2. **Signal listener** — Extension-side file watcher on `~/.sight/browse/` that detects new browse requests.

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
6. Touch `~/.sight/browse/signal` (or overwrite it with the uuid) to notify the extension.

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
    local signalpath "`browsedir'/signal"

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
    if "`varlist'" != "" {
        keep `varlist'
    }
    if `rows' > 0 {
        if _N > `rows' {
            keep in 1/`rows'
            di as txt "(showing first `rows' of `=_N' observations)"
        }
    }

    local obs_n = _N
    local var_k : word count `varlist'
    if `var_k' == 0 local var_k = c(k)

    qui save "`dtapath'", replace
    restore

    // Write JSON sidecar
    tempname fh
    file open `fh' using "`jsonpath'", write replace
    file write `fh' `"{"' _n
    file write `fh' `"  "version": 1,"' _n
    file write `fh' `"  "uuid": "`uuid'","' _n
    file write `fh' `"  "name": "`name'","' _n
    file write `fh' `"  "dtapath": "`dtapath'","' _n
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

```
row_offset(i) = data_offset + (i * obs_length)
```

To read rows `[start, end)`:

```typescript
const buf = Buffer.alloc((end - start) * obsLength);
await fd.read(buf, 0, buf.length, dataOffset + start * obsLength);
```

This is O(1) seek + O(page_size) read regardless of total dataset size.

### strL Resolution

`strL` fields store an 8-byte `(v, o)` pointer into the GSO (Generic String Object) block. The GSO block must be indexed on first open by reading through it and building a `Map<string, string>` keyed on `"v:o"`. This index is built once and cached; it requires a single pass through the GSO block but does not require loading observation data.

For datasets where `strL` usage is minimal (most datasets), this overhead is negligible. For datasets with heavy `strL` usage, the GSO index will consume memory proportional to the number of distinct string values, not the number of observations.

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
  readRows(start: number, count: number): Promise<Row[]>;

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
  requestId: string;
}

// Extension → Webview
interface RowResponse {
  type: "rowData";
  start: number;
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

The extension watches `~/.sight/browse/signal` using `vscode.workspace.createFileSystemWatcher` (or `fs.watch`). On change:

1. Read the uuid from the signal file.
2. Read `~/.sight/browse/<uuid>.json` for request metadata.
3. Open `~/.sight/browse/<uuid>.dta` via the `.dta` parser.
4. If `replace` is true and a tab with the same `name` exists, refresh it; otherwise open a new tab.
5. Clean up: delete `.json` and `signal` file. The `.dta` file is retained as long as the tab is open, then deleted on tab close.

### Phase 2 (future): Local HTTP Server

For bidirectional communication (e.g., Stata pushing live updates after `replace`, or the browser sending filter expressions back to Stata), a local HTTP server on a random port would be more flexible. The port is written to `~/.sight/port`. This is not needed for the initial implementation.

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
- [ ] Temp file lifecycle (cleanup on tab close)
- [ ] Register `vview` command in VS Code command palette (for re-triggering from editor side)

### M3: Polish

- [ ] Column sorting (client-side for small datasets; disabled above row count threshold)
- [ ] Column-level text filter
- [ ] Keyboard navigation (arrow keys, page up/down, Ctrl+Home/End)
- [ ] Theming (respect VS Code color theme via CSS variables)
- [ ] Accessibility (screen reader labels, ARIA attributes on grid)
- [ ] Performance benchmarking against target table above
- [ ] Register custom editor for `.dta` files (open from file explorer)

## Resolved Questions

1. **Format version scope**: The TypeScript `.dta` parser (M0) will support v117 (Stata 13) in addition to v118/v119, so users can browse older dataset files. The `vview.ado` itself targets Stata 16+ and will always write the current format.

2. **Column sorting on large files**: Start with (a) — disable sort above a row count threshold. Option (c), building a sort index file on first sort request, is tracked as a future enhancement (see jbearak/sight#108).

3. **Live refresh**: Deferred. The mechanism is unclear — Stata doesn't expose file-change hooks, and polling the dataset file is unreliable since Stata holds a lock on the active dataset. The Phase 2 HTTP server could enable this if Stata scripts explicitly signal updates, but there's no clean way to watch for implicit changes. Revisit only if a concrete design emerges.

4. **Cross-platform paths and remote development**: `~/.sight/browse/` resolves to `%USERPROFILE%\.sight\browse\` on Windows via `mata: pathjoin()` on the Stata side and `os.homedir()` on the extension side. **Critically, the data browser logic (file watcher, `.dta` parser, row serving) must run on the server side of the extension host**, not the client. In VS Code Remote (SSH, WSL, containers), Stata and the `.dta` temp files live on the remote machine. The extension's server component (where the language server already runs) has filesystem access; the webview panel runs in the client but communicates back via `postMessage`. This is the standard VS Code remote architecture — no special handling is needed as long as all file I/O is in the extension host (server), not the webview (client).

5. **Relationship to Data Wrangler**: Register a custom editor for `.dta` files so double-clicking in the file explorer opens the Sight Data Browser. This is a separate activation path from `vview` but shares all the same infrastructure (parser, webview, grid). Add to M3 milestones.

## Open Questions

_(None at this time.)_
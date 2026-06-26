# Data Browser

Sight includes a data browser for viewing Stata datasets in VS Code. Open `.dta` files directly in the editor, or call `vview` from Stata to send the current dataset to VS Code — either way, data renders in a webview panel with a virtualized grid that handles large datasets efficiently.

## The `vview` Command

`vview` is a Stata ado-file that exports the current dataset and opens it in the Sight Data Browser. It supports the same syntax as `browse`:

```stata
sysuse auto, clear
vview                          // View all data
vview price mpg weight         // View specific variables
vview if foreign == 1          // View with if condition
vview in 1/100                 // View first 100 observations
vview price mpg if foreign, replace  // Refresh existing panel
```

### Options

| Option | Description |
|--------|-------------|
| `varlist` | Variables to display (default: all) |
| `if` / `in` | Subset observations using Stata's standard qualifiers |
| `replace` | Refresh the existing panel instead of opening a new one |
| `name(string)` | Custom tab name (default: current filename) |
| `rows(integer)` | Cap the number of displayed observations. Applied *after* `if`/`in` filtering — useful when you want to limit output without knowing the exact observation count (e.g., `vview, rows(500)` on a large dataset) |

### `browse` in console Stata

In console Stata (the CLI), the built-in `browse` command does not exist — it
is a GUI-only feature. Sight ships a small `browse.ado` alongside `vview.ado`
so that, **in the CLI only**, `browse` becomes an alias for `vview`:

```stata
browse                 // same as vview
browse price mpg if foreign
```

This does **not** affect the Stata GUI. There, the built-in `browse` is
resolved before any ado-file on your path, so the native Data Editor opens
exactly as before; Sight's `browse.ado` never runs. The alias also guards on
`c(console)` as a safeguard.

The standard abbreviations of `browse` — `brows`, `brow`, `bro`, and `br` —
are aliased too. Stata does not auto-abbreviate ado-file command names, so
Sight ships a small forwarder ado for each (`br.ado`, `bro.ado`, etc.). In the
GUI, the built-in `browse` command and its abbreviations are resolved first,
so all of these still open the native Data Editor; in the CLI they forward to
`vview`. Because the alias forwards to `vview`, only `vview`'s options apply;
native-`browse`-only options such as `nolabel` are not supported in the CLI.

### Installation

Sight automatically installs its Stata commands (`vview.ado`, `browse.ado`,
and the `browse` abbreviation forwarders `brows`/`brow`/`bro`/`br`) the first
time the extension activates. You'll see a one-time prompt asking for
permission.

- **macOS**: `~/ado/`
- **Windows**: `%USERPROFILE%\ado\personal\`
- **Linux**: `~/ado/personal/`

On macOS, Sight defaults to `OLDPLACE` (`~/ado/`) rather than `PERSONAL` to avoid sandbox-related writes into `~/Documents/Stata/...`.

If you already have your own `browse.ado` on the ado-path, Sight leaves it
untouched and installs only `vview.ado`.

You can override the install location with the `sight.personalAdoDir` setting, or manually install with the **Sight: Install Stata Commands (vview, browse)** command from the Command Palette.

To re-trigger the install prompt (e.g., after declining), run **Sight: Reset Stata Commands Install Permission** from the Command Palette. To remove the installed files (Sight-owned copies only), run **Sight: Uninstall Stata Commands (vview, browse)**.

### How It Works

When you run `vview` in Stata:

1. Stata saves the (optionally subsetted) dataset to a temporary `.dta` file in `~/.sight/browse/`
2. A JSON sidecar file is written alongside it with metadata (variable count, observation count, source file, Stata's working directory, etc.)
3. A signal file is created that triggers the VS Code extension
4. The extension claims the signal (atomically, so only one VS Code window processes it), reads the metadata, and opens the data browser panel
5. The temporary files are cleaned up automatically

**Multi-window support**: When multiple VS Code windows are open, Sight prioritizes the window whose workspace folder matches Stata's current working directory. This means the data browser is more likely to open in the "right" window when you have multiple projects open.

## Opening `.dta` Files Directly

You can also open `.dta` files directly in the data browser without using `vview`:

- Double-click a `.dta` file in the VS Code Explorer
- Right-click a `.dta` file and select **Open in Sight Data Browser**
- Run **Sight: Open Data Browser** from the Command Palette

This supports Stata formats 113–119 (Stata 8 through Stata 18).

## Features

- **Virtualized grid**: Only visible rows are loaded into memory, so large datasets scroll smoothly
- **Column resizing**: Drag column borders to resize; widths are persisted across sessions
- **Column visibility**: Hide/show columns from the column header context menu
- **Value labels**: Toggle between raw values, formatted values, and value labels
- **Missing values**: Extended missing values (`.a` through `.z`) are highlighted; style configurable via `sight.dataBrowser.missingValueStyle`
- **Theme-aware**: The grid automatically adapts to your VS Code color theme
- **Sorting**: Sort rows by one or more columns (see below)
- **Filtering**: Filter rows by per-column predicates (see below)

## Sorting Rows

Right-click a column header to sort:

- **Sort ascending / Sort descending** replaces any active sort with this column.
- **Add ascending/descending to sort** appends the column as the next sort key
  (also available by holding **Shift** while clicking Sort ascending/descending).
  This builds a multi-column sort: rows are ordered by the first key, ties broken
  by the second, and so on.
- **Clear sort on this column** / **Clear all sorts** remove keys.

Sorted headers show a small arrow (▲ ascending, ▼ descending). With more than one
key, each header also shows its 1-based priority number. The toolbar grows a chip
strip listing the active keys; click a chip to flip its direction, remove it, or
move it to first. The status bar appends a `sorted by …` summary.

**Keyboard shortcuts** (when the grid is focused and a column is selected):

| Shortcut | Action |
|----------|--------|
| `Shift+Alt+A` | Sort the focused column ascending (replace) |
| `Shift+Alt+D` | Sort the focused column descending (replace) |
| `Shift+Alt+0` | Clear all sorts |

### Sort details

- **Missing values sort last** in both ascending and descending order. (This is a
  data-browser convention, not Stata's "missing is larger than any number"
  ordering — it keeps real values together at the top however you sort.)
- **Labels are WYSIWYG**: a value-labelled column sorts by the displayed label when
  **Labels** is on, and by the underlying numeric code when it is off. Toggling
  **Labels** re-sorts such a column. Display **Formats** never affect order.
- **String columns** use natural numeric-aware collation, so `file_2` sorts before
  `file_10`.
- Sorting runs in the extension host against the on-disk `.dta` file; **Copy
  column** follows the displayed (sorted) order.
- The active sort is remembered per dataset (and dataset shape) and restored the
  next time you open it, unless `sight.dataBrowser.persistSort` is disabled.

## Filtering Rows

Right-click a column header and choose **Filter…** (or **Edit filter…** if the
column already has one) to open the filter editor. Pick a condition, enter the
value(s), and click **Apply** (or press **Enter**). One filter per column;
applying a new filter replaces the column's existing one. Multiple columns'
filters combine with **AND** — a row is shown only if it passes every enabled
filter.

The available conditions depend on the column's type:

| Column kind | Conditions |
|-------------|-----------|
| Numeric | Compare (`=, ≠, <, ≤, >, ≥`), Between, Not between, Is empty / Is not empty |
| Value-labelled numeric | Is one of / Is not one of (a checklist of labels), plus all numeric conditions |
| String | Contains, Does not contain, Starts with, Ends with, Equals, Not equals, Matches regex, Is empty / Is not empty |
| Date | Compare, Between, Not between, Is empty / Is not empty |

Each applied filter becomes a chip in the toolbar's second row. A chip shows a
✓/✗ enabled glyph and a short predicate summary; click its body to edit, or use
the **⋯** menu to Enable/Disable or Remove it. A trailing **✕** clears all
filters. The status bar appends `filtered to N of M (P%)`.

**Keyboard shortcuts** (when the grid is focused and a column is selected):

| Shortcut | Action |
|----------|--------|
| `Shift+Alt+F` | Open the filter editor for the focused column |
| `Shift+Alt+X` | Clear the focused column's filter |
| `Shift+Alt+9` | Clear all filters |

### Filter details

- **Missing values** (`.`, `.a`–`.z`) fail every predicate by default. Tick
  **Include missing** in the editor to keep missing rows as well. The **Is
  empty** condition matches *only* missing rows (and ignores the checkbox).
- **Numeric "Between"** shows a histogram brush: drag the two thumbs (or nudge
  with arrow keys; hold **Shift** for a 10× step) to set the low/high bounds,
  which stay in sync with the typed inputs.
- **Value-labelled numerics** filter by the underlying numeric **code**, not the
  displayed label. The label checklist is for convenience only, so a filter
  survives toggling **Labels** on or off. Display **Formats** never affect which
  rows match.
- **Dates** are entered as calendar dates (or date-times for `%tc`/`%tC`
  clock formats) and converted to Stata's internal day/millisecond domain. Only
  daily (`%td`, `%d`) and clock (`%tc`, `%tC`) formats are treated as dates;
  other `%t…` formats (weekly, monthly, quarterly, …) filter as plain numerics
  by their stored code.
- **Regular expressions** are validated live in the editor; an invalid pattern
  can't be applied. Note that a pathological pattern (catastrophic backtracking)
  runs synchronously over every row on a large dataset and can briefly stall the
  view — this is self-inflicted and limited to your own typed pattern.
- Filtering runs in the extension host against the on-disk `.dta` file; the
  visible row numbers reflect the filtered sequence, and **Copy column** follows
  the displayed (filtered, then sorted) order.
- Active filters are remembered per dataset (and dataset shape) and restored the
  next time you open it, unless `sight.dataBrowser.persistFilters` is disabled.
  Only the filter definitions are stored; the surviving rows are always
  recomputed against the current data.

## Layout Persistence

Column widths and visibility settings are saved automatically in VS Code's global state, keyed by the source dataset path. Layouts persist across sessions and survive dataset refreshes.

### Storage Limit

To prevent unbounded storage growth, Sight limits the number of stored layout entries. When the limit is reached, the least recently saved entries are evicted first.

| Setting | Default | Description |
|---------|---------|-------------|
| `sight.dataBrowser.maxStoredLayouts` | `10000` | Maximum layout entries stored. Each dataset may use multiple entries for alias keys (source path, temp path, basename). |

With the default limit of 10,000 entries and ~3-4 alias keys per dataset, this accommodates roughly 2,500-3,000 unique datasets before eviction begins.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sight.dataBrowser.missingValueStyle` | `"foreground"` | How to highlight missing values: `"foreground"` (colorize text), `"background"` (tint cell), or `"none"` |
| `sight.dataBrowser.persistSort` | `true` | Remember and restore the row sort per dataset (matching shape) |
| `sight.dataBrowser.persistFilters` | `true` | Remember and restore the row filters per dataset (matching shape) |
| `sight.dataBrowser.maxStoredLayouts` | `10000` | Maximum stored layout entries (see above) |
| `sight.personalAdoDir` | (platform default) | Path where Sight installs `vview.ado` |

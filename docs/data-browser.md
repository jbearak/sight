# Data Browser (`vview`)

Sight includes a data browser that lets you view Stata datasets directly in VS Code. It works like Stata's `browse` command, but renders in a VS Code webview panel with a virtualized grid that handles large datasets efficiently.

## The `vview` Command

`vview` is a Stata ado-file that exports the current dataset and opens it in the Sight Data Browser. It supports the same syntax as `browse`:

```stata
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
| `if` / `in` | Subset observations |
| `replace` | Refresh the existing panel instead of opening a new one |
| `name(string)` | Custom tab name (default: current filename) |
| `rows(integer)` | Limit displayed observations |

### Installation

Sight automatically installs `vview.ado` into your personal ado directory the first time the extension activates. You'll see a one-time prompt asking for permission.

- **macOS**: `~/Documents/Stata/ado/personal/`
- **Windows**: `%USERPROFILE%\ado\personal\`
- **Linux**: `~/ado/personal/`

You can override the install location with the `sight.personalAdoDir` setting, or manually install with the **Sight: Install vview.ado** command from the Command Palette.

To re-trigger the install prompt (e.g., after declining), run **Sight: Reset vview.ado Install Permission** from the Command Palette.

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

This supports Stata formats 113-119 (Stata 8 through Stata 18+).

## Features

- **Virtualized grid**: Only visible rows are loaded into memory, so large datasets scroll smoothly
- **Column resizing**: Drag column borders to resize; widths are persisted across sessions
- **Column visibility**: Hide/show columns from the column header context menu
- **Value labels**: Toggle between raw values, formatted values, and value labels
- **Missing values**: Extended missing values (`.a` through `.z`) are highlighted; style configurable via `sight.dataBrowser.missingValueStyle`
- **Theme-aware**: The grid automatically adapts to your VS Code color theme

## Layout Persistence

Column widths and visibility settings are saved automatically in VS Code's global state, keyed by the source dataset path. Layouts persist across sessions and survive dataset refreshes.

### Storage Limit

To prevent unbounded storage growth, Sight limits the number of stored layout entries. When the limit is reached, the least recently used entries are evicted first.

| Setting | Default | Description |
|---------|---------|-------------|
| `sight.dataBrowser.maxStoredLayouts` | `10000` | Maximum layout entries stored. Each dataset may use multiple entries for alias keys (source path, temp path, basename). |

With the default limit of 10,000 entries and ~3-4 alias keys per dataset, this accommodates roughly 2,500-3,000 unique datasets before eviction begins.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sight.dataBrowser.missingValueStyle` | `"foreground"` | How to highlight missing values: `"foreground"` (colorize text), `"background"` (tint cell), or `"none"` |
| `sight.dataBrowser.maxStoredLayouts` | `10000` | Maximum stored layout entries (see above) |
| `sight.personalAdoDir` | (auto-detected) | Path to personal ado directory for `vview.ado` installation |

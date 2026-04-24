# SMCL Log Viewer

Sight includes a viewer for Stata's SMCL (Stata Markup and Control Language) files. SMCL is Stata's native output format, used for log files (`.smcl`) and help files (`.sthlp`).

## Usage

Open any `.smcl` or `.sthlp` file in VS Code and use any of the following to open the preview:

- Click the **Open Preview** icon in the editor title bar
- Right-click the file and select **Open SMCL Preview** or **Open SMCL Preview (Full Width)**
- Use the Command Palette: **Sight: Open SMCL Preview**

The preview renders SMCL markup as formatted HTML in a VS Code webview panel, showing the output as it would appear in Stata's Viewer window.

## Supported Formats

The viewer renders both:
- **Log files** (`.smcl`): Stata session output with formatted results, tables, and error messages
- **Help files** (`.sthlp`): Stata help documentation with cross-references and formatted syntax

## Help links in hovers and completions

Hovering over a built-in command (e.g. `generate`), an expression
function (e.g. `mi()`), or a prefix-command subcommand (e.g. `frame
create`) shows a clickable `help <topic>` link. Clicking the link opens
the matching `.sthlp` file in the SMCL preview to the right of the
editor. The same link appears in the completion popup for built-in
commands and their abbreviations.

Sight resolves the topic to a file by searching, in order:

1. Every directory listed in the `sight.adoPaths` setting.
2. Your workspace folders.
3. Auto-detected Stata install locations (e.g. `/Applications/Stata/ado/base` on macOS, `/usr/local/stata<version>/ado/base` on Linux, `C:\Program Files\Stata<version>\ado\base` on Windows), plus the usual `~/ado/personal` and `~/ado/plus` conventions.

This means `help regress`, `help include`, and other built-in topics generally work out of the box without any configuration. If a `.sthlp` still isn't found, Sight shows a notification with an **Open Settings** button that jumps straight to `sight.adoPaths` so you can point it at the directory containing the help file.

# Help Viewer

Sight includes an in-editor help viewer that renders Stata documentation.  
Access it through `sight.openHelpTopic` in the Command Palette or  
by clicking a `help <topic>` link shown when hovering a command or function  
name.

## Help Links in Hovers and Completions

Hovering over a built-in command (for example `generate`), an expression
function (for example `mi()`), or a prefix-command subcommand (for example
`frame create`) shows a clickable `help <topic>` link. Clicking that link opens
the matching `.sthlp` file in the preview to the right of the editor.

The same link appears in the completion popup for built-in commands and their
abbreviations.

## Opening a Help File Manually

You can also open a `.sthlp` file directly in VS Code and open the preview:

- Click the **Open Preview** icon in the editor title bar
- Right-click the file and select **Open SMCL Preview** or
**Open SMCL Preview (Full Width)**
- Use the Command Palette: **Sight: Open SMCL Preview**

The preview renders Stata help markup as formatted HTML in a VS Code webview
panel.

## How Sight Resolves Help Topics

Sight resolves a help topic to a file by searching, in order:

1. Every directory listed in `sight.adoPaths`.
2. Your workspace folders.
3. Auto-detected Stata install locations (for example
  `/Applications/Stata/ado/base` on macOS,
   `/usr/local/stata<version>/ado/base` on Linux,
   `C:\\Program Files\\Stata<version>\\ado\\base` on Windows), plus the usual
   `~/ado/personal` and `~/ado/plus` conventions.

Because of this search order, built-in topics like `help regress` and
`help include` usually work without extra configuration.

If a `.sthlp` file is not found, Sight shows a notification with an
**Open Settings** button that jumps directly to `sight.adoPaths`.
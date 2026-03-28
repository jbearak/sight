# SMCL Log Viewer

Sight includes a viewer for Stata's SMCL (Stata Markup and Control Language) files. SMCL is Stata's native output format, used for log files (`.smcl`) and help files (`.sthlp`).

## Usage

Open any `.smcl` or `.sthlp` file in VS Code, then:

- Click the **Open Preview** icon in the editor title bar
- Right-click the file and select **Open SMCL Preview** or **Open SMCL Preview (Full Width)**
- Use the Command Palette: **Sight: Open SMCL Preview**

The preview renders SMCL markup as formatted HTML in a VS Code webview panel, showing the output as it would appear in Stata's Viewer window.

## Supported Formats

The viewer renders both:
- **Log files** (`.smcl`): Stata session output with formatted results, tables, and error messages
- **Help files** (`.sthlp`): Stata help documentation with cross-references and formatted syntax

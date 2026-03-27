# SMCL Preview Feature Plan

## Overview
A built-in SMCL preview webview for VS Code, analogous to the Markdown Preview. Renders `.smcl` and `.sthlp` files as formatted HTML in a side-by-side panel.

## Requirements
- **High-fidelity rendering** of SMCL directives to HTML
- **Cross-reference navigation**: clicking `{help cmd}` resolves the `.sthlp` file and opens its preview
- **Live updates** on file changes (debounced)
- **Side-by-side** by default (`ViewColumn.Beside`), full-width when Alt/Option held
- **Triggers**: editor title icon, command palette, keyboard shortcut (`Ctrl+Shift+V` / `Cmd+Shift+V`)
- **Cross-platform** (complements existing macOS-only "Open in Stata" button)

## Architecture

### Rendering: Client-side (bundled into extension)

The SMCL-to-HTML renderer lives in the client extension. The existing `SmclTokenizer` from `src/smcl-parser/tokenizer.ts` is pure TypeScript with no Node.js builtins, so esbuild bundles it directly into the extension. This avoids LSP round-trips per keystroke and works before the language server is ready.

A new `smcl_to_html()` function implements an HTML rendering pass (the existing pretty-printer only does plain text and Markdown). This is a new renderer, not a modification of the existing one, since the existing `to_markdown`/`to_plain_text` serve different purposes (hover tooltips, cache generation).

### Cross-reference resolution: Server-side via custom LSP request

The server already has ado-path knowledge via `WorkspaceIndexer`. A new custom LSP request `sight/resolveSthlpFile` accepts a command name and returns the resolved `.sthlp` file path (or null). The indexer populates a sthlp index during its workspace scan.

### Panel management: Singleton per source URI

A `SmclPanelManager` maintains a `Map<string, SmclPreviewPanel>`. Opening a preview for an already-open file reveals the existing panel. Each `SmclPreviewPanel` owns its own `onDidChangeTextDocument` listener with 300ms debounce.

## File Structure

### New files
```text
client/src/smcl-preview/
  index.ts              - Module entry, register_smcl_preview(), command registration
  smcl-to-html.ts       - Core SMCL-to-HTML renderer (pure function, no vscode deps)
  webview-html.ts       - Assembles full HTML document with CSS + JS for webview
  preview-panel.ts      - SmclPreviewPanel class (webview lifecycle, debounced updates)
  panel-manager.ts      - SmclPanelManager (singleton map, open/reveal logic)
```

### Modified files
```text
client/src/extension.ts     - Import and call register_smcl_preview()
client/package.json         - Commands, keybindings, menus for preview
src/server-handlers.ts      - New create_resolve_sthlp_file_handler()
src/server-factory.ts       - Wire sight/resolveSthlpFile request
src/indexer/index.ts        - Add sthlp index + get_ado_paths() + resolve_sthlp_file()
```

## Data Flow

```text
User clicks preview icon / Cmd+Shift+V
  --> sight.openSmclPreview command
  --> SmclPanelManager.open_or_reveal(uri, beside=true)
  --> SmclPreviewPanel constructor
      --> fs.readFile(source_uri.fsPath)
      --> smcl_to_html(raw_smcl) --> SmclHtmlResult { html, cross_references }
      --> build_webview_html(result, nonce) --> full HTML string
      --> panel.webview.html = html

File changes (onDidChangeTextDocument, debounced 300ms)
  --> SmclPreviewPanel.refresh() [same render path]

Cross-reference click ({help regress})
  --> Webview JS posts { type: 'navigate', command_name: 'regress' }
  --> panel.webview.onDidReceiveMessage
  --> language_client.sendRequest('sight/resolveSthlpFile', { command_name })
  --> Server resolves via ado-paths + workspace scan
  --> SmclPanelManager.open_or_reveal(resolved_uri, beside=true)
```

## SMCL Directives to Handle (Initial Scope)

### Priority 1 - Structure & Typography
- `{smcl}` - strip (document marker)
- `{title:text}` - `<h2>`
- `{dlgtab:text}` - `<h3>`
- `{hline}`, `{.-}` - `<hr>`
- `{hline #}` - inline horizontal rule
- `{p}`, `{p_end}` - paragraph open/close
- `{pstd}`, `{phang}`, `{pmore}`, `{pin}` - paragraph variants with indentation
- `{bf:text}`, `{bf}` - bold (scoped and persistent)
- `{it:text}`, `{it}` - italic
- `{ul:text}`, `{ul on}`, `{ul off}` - underline
- `{sf}`, `{rm}` - reset face
- `{cmd:text}` - inline code
- `{cmdab:ab:rest}` - command with abbreviation underlined
- `{opt ...}` all variants - option display
- `{opth ...}` - option with hyperlinked arg

### Priority 2 - Tables & Layout
- `{synoptset # [tabbed|notes]}` - start synopt table
- `{synopthdr}` - table header row
- `{synoptline}` - horizontal rule in table
- `{syntab:text}` - section header in table
- `{synopt:option_col}description{p_end}` - option row
- `{p2colset # # # #}` - two-column layout
- `{p2col:first}second{p_end}` - two-column row
- `{p2colreset}` - end two-column
- `{p2line}` - horizontal rule across columns
- `{col #}`, `{space #}`, `{tab}` - spacing
- `{center:text}`, `{right:text}` - alignment
- `{lalign #:text}`, `{ralign #:text}` - field alignment

### Priority 3 - Links & Navigation
- `{help topic}`, `{help topic:text}` - cross-reference link
- `{helpb topic}` - bold help link
- `{manhelp topic MANUAL}` - manual reference
- `{manhelpi topic MANUAL}` - italic manual reference
- `{manlink MANUAL entry}`, `{manlinki MANUAL entry}` - manual links
- `{browse URL}`, `{browse URL:text}` - external URL
- `{marker name}` - anchor
- `{viewerjumpto "Section" "topic##anchor"}` - TOC navigation
- `{stata cmd}`, `{stata cmd:text}` - run command link

### Priority 4 - Colors & Log Files
- `{txt}`, `{text}` - normal text style
- `{com}` - command prompt style
- `{res}`, `{result}` - result style
- `{err}`, `{error}` - error style
- `{inp}`, `{input}` - input style
- `{hi}`, `{hilite}` - highlight style

### Priority 5 - Special Characters
- `{c -(}` = `{`, `{c )-}` = `}`
- `{c S|}` = `$`, `{c 'g}` = backtick
- `{c #}` = ASCII character
- `{c 0x##}` = hex character
- Box-drawing: `{c -}`, `{c |}`, `{c +}`, `{c TT}`, `{c BT}`, etc.

### Priority 6 - Other
- `{...}` - line continuation (join lines)
- `{bind:text}` - no-break span
- `{break}` - line break
- `{dup #:text}` - repeat text
- `{asis}` - as-is mode (preformatted until next `{smcl}`)
- `{reset}` - reset all styles
- `{*:comment}` - strip

## CSS Theme Integration

Use VS Code CSS variables for theme-aware rendering:
```css
body { font-family: var(--vscode-editor-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
.smcl-cmd { color: var(--vscode-textLink-foreground); }
.smcl-res { font-weight: bold; }
.smcl-err { color: var(--vscode-errorForeground); }
.smcl-title { border-bottom: 1px solid var(--vscode-panel-border); }
a { color: var(--vscode-textLink-foreground); }
code { background: var(--vscode-textCodeBlock-background); }
```

## Implementation Sequence

### Phase 1: Core preview (no cross-ref navigation)
1. Create `smcl-to-html.ts` - SMCL renderer
2. Create `webview-html.ts` - HTML document assembly
3. Create `preview-panel.ts` - panel lifecycle + debounced updates
4. Create `panel-manager.ts` - singleton management
5. Create `index.ts` - command registration
6. Modify `extension.ts` - wire up
7. Modify `package.json` - commands, keybindings, menus

### Phase 2: Cross-reference navigation
1. Add sthlp index to `src/indexer/index.ts`
2. Add `create_resolve_sthlp_file_handler` to `src/server-handlers.ts`
3. Wire in `src/server-factory.ts`
4. Update `preview-panel.ts` to handle navigate messages

### Phase 3: Polish
1. Test against real `.sthlp` files
2. Refine CSS for table rendering
3. Add panel icon

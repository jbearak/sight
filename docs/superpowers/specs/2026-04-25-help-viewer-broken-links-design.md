# Fix Broken Links in Help Viewer

## Problem

Some links in the SMCL help viewer don't do anything when clicked:

- Same-page anchor links (e.g., "See Description below" in `generate`)
- Cross-page anchor links (e.g., `single_options` in `stset`)

Root cause: the `##anchor` fragment is stripped from help links at render time
(`smcl-to-html.ts`, `render_help_link()` line 969). Additionally, `{viewerjumpto}`
table-of-contents directives are suppressed entirely.

## Design

### 1. Thread anchors through the help link pipeline

**`smcl-to-html.ts` — `render_help_link()`**: Stop stripping `##anchor` from
topic strings. When an anchor is present:

- If the topic matches the current page (same-page link): render as
  `<a class="smcl-jumpto" href="#anchor">` so it scrolls in-place using the
  existing click handler. The current page's topic is determined from the
  `{help_title}` synthetic directive or passed into `smcl_to_html()` as a
  render option (e.g., derived from the `.sthlp` filename).
- If the topic is a different page (cross-page link): add
  `data-smcl-anchor="anchor"` alongside the existing `data-smcl-topic`
  attribute.

**`webview-html.ts` — click handler**: When a `data-smcl-topic` link also has
`data-smcl-anchor`, include the anchor in the navigate message:
`{ type: 'navigate', topic, anchor }`.

**`preview-panel.ts`**: Accept the optional `anchor` field in navigate messages
and pass it through to the panel manager callback.

**`panel-manager.ts` — `open_topic()` / `handle_navigate()`**: After
opening/revealing a help page, post a `scrollToAnchor` message to the webview.

**`webview-html.ts` — message receiver**: Handle `scrollToAnchor` messages by
calling `document.getElementById(anchor).scrollIntoView({ behavior: 'smooth' })`.

### 2. Render `{viewerjumpto}` as a table of contents

Instead of suppressing `{viewerjumpto}` directives, collect all preamble
`{viewerjumpto}` entries and render them as a horizontal TOC bar at the top of
the help page.

**Format**: `{viewerjumpto "Label" "topic##anchor"}` — the label is the display
text, the target is always a same-page anchor.

**Rendering**: A horizontal list of `a.smcl-jumpto` links separated by ` | `,
e.g.:

```
Syntax | Description | Options | Remarks and examples | Stored results
```

These use `href="#anchor"` and scroll in-place via the existing jump-to click
handler.

### 3. Handle `{search}`, `{view}`, and `{dialog}` directives

- **`{dialog}`**: Keep as-is. Renders display text as plain text, which reads
  naturally in context (e.g., "the dialog box").
- **`{search keyword}`**: Render as a help link (`data-smcl-topic`). Treat
  search as equivalent to opening the help topic.
- **`{view filename}`**: If the argument ends in `.sthlp` or `.hlp`, render as
  a help link. Otherwise render as plain text.

Principle: nothing should look clickable and do nothing.

### 4. Test program for broken link detection

A TypeScript script (`scripts/check-help-links.ts`) that:

1. **Enumerates commands** from `v18.json`.
2. **Resolves each command** to a `.sthlp` file using ado-path search.
3. **Parses and renders** each file via `smcl_to_html()`.
4. **Extracts all links** from the rendered HTML:
   - Help links: `data-smcl-topic` (+ `data-smcl-anchor`)
   - Jump-to links: `a.smcl-jumpto` with `href="#anchor"`
5. **Validates** each link:
   - Topic resolution: can `data-smcl-topic` resolve to a `.sthlp` file?
   - Same-page anchors: does `#anchor` have a matching `<a id="anchor">` in
     the current page?
   - Cross-page anchors: resolve the target `.sthlp`, render it, check for the
     anchor element.
6. **Reports** broken links grouped by source help page with link text, target,
   and failure reason.

**Configuration**: Takes an ado-path argument so it knows where to find `.sthlp`
files.

**Output**: Summary to stdout — total pages scanned, total links checked, broken
links with details. Non-zero exit if broken links found.

**Not in CI**: Lives in `scripts/`, requires a Stata installation. Could be
gated behind `SIGHT_STATA_PATH` environment variable for optional test suite
inclusion.

**Excluded from broken-link detection**: `{dialog}` links (intentionally plain
text). `{mansection}` and `{browse}` links (external URLs — validated
separately if desired).

### 5. Iterative fix cycle

1. Implement the core fix (sections 1–3).
2. Build and run the test program to get a baseline broken-link report.
3. Triage results: categorize remaining broken links by pattern, design targeted
   fixes.
4. Implement fixes, rerun. Repeat until the report is clean or remaining items
   are known limitations.

Known limitations to document rather than fix:
- Topics that map only to PDF manual entries (no `.sthlp` file)
- Paths containing macro interpolation

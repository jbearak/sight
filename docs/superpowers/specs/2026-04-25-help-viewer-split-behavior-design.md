# Help Viewer Split Behavior

## Problem

Clicking any help viewer link always opens with `ViewColumn.Beside`, splitting
the editor. This is disruptive when the user is already in a help panel clicking
cross-reference links, or when opening a topic from the command palette.

## Design

Split the editor (Beside) only when a help link originates from an editor view
(hover provider or completions menu). All other entry points open in the active
column (new tab, no split).

### Entry Points and Target Columns

| Entry point | Current | New |
|---|---|---|
| Hover/completion link (`sight.openHelpTopic` with arg) | Beside | **Beside** (unchanged) |
| Command palette (`sight.openHelpTopic`, no arg) | Beside | **Active** |
| Cross-reference link inside help viewer (`handle_navigate`) | Beside | **Active** |

### Changes

**`client/src/smcl-preview/panel-manager.ts`** — `handle_navigate` (line 132):

Change `ViewColumn.Beside` to `ViewColumn.Active`. Links clicked within the
help viewer open a new tab in the same column instead of splitting.

**`client/src/smcl-preview/index.ts`** — `sight.openHelpTopic` handler
(lines 84-87):

Select the column based on whether a topic argument was provided:
- Arg present (hover/completion link) → `ViewColumn.Beside`
- Arg absent (command palette, user prompted) → `ViewColumn.Active`

The `my_topic` variable already distinguishes these cases: `extract_topic(arg)`
returns non-null for hover/completion, null for command palette (which then
calls `prompt_for_topic()`). Track which path was taken and pass the
appropriate column to `open_topic`.

### Unchanged Entry Points

- `sight.openSmclPreview` — keeps `ViewColumn.Beside` (explicit side-by-side
  preview of a raw SMCL file)
- `sight.openSmclPreviewFull` — keeps `ViewColumn.Active` (Alt/Option
  full-width variant)

# Fix Broken SMCL Help Links

## Problem

Running `scripts/check-help-links.ts` reports 1,155 broken links in the SMCL
help viewer. Root cause analysis identified four categories:

1. **Cross-file anchor fallback (702 links):** Stata's viewer has implicit
   redirect logic. When `estimation##level()` can't find the `level()` marker
   in `estimation.sthlp`, it falls back to `estimation_options.sthlp` or
   `estimation_postestimation.sthlp`. Our viewer doesn't implement this.

2. **Missing markers from INCLUDE directives (~119 + portion of Cat 4):**
   1,337 help files use `INCLUDE help <name>` to inline `.ihlp` content. Our
   renderer drops these lines entirely, so markers, option docs, and other
   content from includes are missing from the rendered page. This accounts for
   the `display_options`, `lasso_options`, `selopts`, and many other "missing
   anchor" failures.

3. **`{search}` rendered as help links (~46 links):** `{search r(5)}` opens
   Stata's keyword search dialog — it is not a help topic link. Our renderer
   treats `{search}` identically to `{help}`, generating clickable links to
   non-existent topics.

4. **Unresolvable function/variable topics (~46+ links):** Function topics
   like `float()` don't resolve because the help file is `f_float.sthlp`.
   System variable `_N` should resolve to `_variables.sthlp`. Our resolver
   lacks these fallback conventions.

## Solution

Four independently shippable parts, implemented in order with checker reruns
between each.

### Part 1: INCLUDE directive expansion

**New LSP request: `sight/expandIncludes`**

- **Input:** `{ content: string }` — raw SMCL source
- **Output:** `{ content: string }` — SMCL with `INCLUDE help <name>` lines
  replaced by the corresponding `.ihlp` file content

**Resolution rules:**
- `INCLUDE help <name>` → search for `<name>.ihlp` using the existing
  ado-path search in the indexer (same search order as `resolve_sthlp_file`)
- Case-sensitive match only: all 1,337 occurrences in Stata 18 use uppercase
  `INCLUDE`. No quoted names — bare tokens only. Both verified empirically.
- Recursive: `.ihlp` files can include other `.ihlp` files (29 cases in
  Stata 18). Depth limit of 10 with cycle detection (track visited paths).
- Missing `.ihlp` files → remove the `INCLUDE` line and emit a debug-level
  `console.warn` (observable in dev tools, silent for users)
- Cache `.ihlp` file content in an LRU cache keyed by resolved path (files
  don't change at runtime). Cache lives in the indexer (alongside
  `FindaliasResolver`), shared across requests, invalidated when ado-paths
  change.

**Server-side implementation:**
- New handler `create_expand_includes_handler()` in `server-handlers.ts`
- Uses a new `resolve_ihlp_file(name)` method in the indexer. `.ihlp` files
  follow the same letter-subdirectory convention as `.sthlp` files (verified:
  `r/robust_short.ihlp`, `u/unstarred.ihlp`, etc.), so the implementation
  mirrors `resolve_sthlp_file` with a different extension.
- Regex to match include lines: `/^INCLUDE help (\S+)/` (line-anchored,
  case-sensitive). Empirically verified: no leading whitespace, no case
  variants, no quoted names exist in Stata 18's help corpus.
- Expand in-place, then return the fully expanded content

**Client-side change (`preview-panel.ts`):**
- In `refresh()`, after `read_content()` call `sight/expandIncludes`
- Place before `resolve_findalias_map()` (findalias may appear in included
  content)
- Same staleness guard: check `refresh_seq` after await

### Part 2: Cross-file anchor fallback

**Extend `resolveSthlpFile` with an optional `anchor` parameter.**

- **Input:** `{ topic: string, anchor?: string }`
- **Output:** `{ file_path: string | null }` (unchanged)

**Algorithm when `anchor` is present:**
1. Resolve `topic` to a file path (existing logic, unchanged)
2. Read the resolved file, expand includes (reuse Part 1 cache), scan for
   `{marker <anchor>}` using string matching: find lines containing
   `{marker `, extract the name token, compare with exact string equality.
   No regex interpolation of anchor text (anchors contain metacharacters
   like `()`, `.`, `+`).
3. If marker found → return this file path
4. If not found → find all `topic_*.sthlp` files across the ado-path search
   directories (new indexer method `find_related_sthlp_files(topic)`). For
   each candidate, read + expand includes, scan for the marker.
5. Return first match. If no match, return the original file path (user sees
   the page without scrolling — better than "not found")

**Why glob instead of a fixed suffix list:** Stata uses many suffixes beyond
`_options` and `_postestimation` — including `_postestimation_plots`,
`_printcolor`, `_fred`, `_summarize`, `_pie`, `_diagnostics`, and others.
Empirically, scanning all `topic_*` files fixes 90 cross-page anchor links
vs only 19 with just `_options`/`_postestimation`. The glob is cheap (one
readdir per search directory, cached) and the marker name match prevents
false positives.

**When `anchor` is absent:** Existing behavior, fully backward compatible.

**Client change (`panel-manager.ts`):**
- Pass `anchor` in the `sight/resolveSthlpFile` request when present:
  `{ topic, anchor }`

### Part 3: Renderer and resolver fixes

**3a. `{search}` directives → plain text**

In `render_search_link()` in `smcl-to-html.ts`, replace the current help-link
rendering with plain styled text:

```typescript
return `<span class="smcl-search-text" data-smcl-search-query="${escape_html(my_topic)}">${my_display}</span>`;
```

No `data-smcl-topic` attribute, no cross-reference entry. The
`data-smcl-search-query` attribute preserves the query for potential future
search UX. Add a CSS rule for `.smcl-search-text` (same styling as `{dialog}`
or similar non-navigable directives).

**3b. Function topic fallback (`f_` prefix)**

In `resolveSthlpFile`, add a fallback: if the topic ends with `()`, strip the
parentheses and try `f_<name>`. Insert after the existing abbreviation
expansion step.

Example: `float()` → try `f_float` → resolves to `f_float.sthlp`.

**3c. System variable fallback (`_` prefix → `_variables`)**

In `resolveSthlpFile`, add a fallback: if the topic starts with `_` and
doesn't resolve through the existing chain, try `_variables` as the topic.

Covers `_N`, `_n`, `_pi`, `_rc`, `_cons`, and any future additions to
`_variables.sthlp`.

### Part 4: Validation

After each part, rerun `scripts/check-help-links.ts` to measure impact:

1. After Part 1 → expect large drop in same-page anchor failures
   (display_options, lasso_options, menu, selopts, etc.)
2. After Part 2 → expect Category 1 resolved (estimation##, regress##
   fallbacks)
3. After Part 3 → expect remaining search/function/variable topics resolved
4. Final run → assess any remaining failures and decide if further work is
   needed

## Files to modify

| File | Change |
|------|--------|
| `src/server-handlers.ts` | New `sight/expandIncludes` handler; extend `resolveSthlpFile` with `anchor` param and `f_`/`_` fallbacks |
| `src/indexer/index.ts` | Add `resolve_ihlp_file()`, `find_related_sthlp_files()`, include expansion cache |
| `client/src/smcl-preview/preview-panel.ts` | Call `sight/expandIncludes` in `refresh()` |
| `client/src/smcl-preview/panel-manager.ts` | Pass `anchor` in `resolveSthlpFile` request |
| `client/src/smcl-preview/smcl-to-html.ts` | Change `render_search_link()` to emit plain text |
| `client/src/smcl-preview/webview-html.ts` | Add `.smcl-search-text` CSS rule |
| `scripts/check-help-links.ts` | Update to use include expansion when checking anchors |

## Error handling

Graceful degradation throughout — log warnings, never crash or block:

- **Unreadable `.ihlp` file:** Log warning, treat as missing (remove the
  `INCLUDE` line), continue expansion
- **Include depth limit exceeded:** Log warning, return content expanded so
  far (partial expansion is better than none)
- **Malformed `{marker}` directive:** Skip (don't extract a name), continue
  scanning
- **`_variables.sthlp` missing from installation:** `resolve_sthlp_file`
  returns null, fallback is a no-op

## Testing

Each part requires automated tests beyond the checker script:

- **Part 1 (INCLUDE expansion):** Unit tests for the expander — basic
  expansion, recursive includes, cycle detection, missing file handling,
  depth limit, unreadable file handling. Integration test: render a known
  `.sthlp` with includes and verify markers appear in output HTML.
- **Part 2 (anchor fallback):** Unit tests for `resolveSthlpFile` with
  anchor param — anchor found in primary file, anchor found in a suffix
  file, anchor not found anywhere (returns original file). Test with
  anchors containing metacharacters like `level()`.
- **Part 3 (renderer/resolver):** Unit test that `render_search_link`
  produces a `<span>` not an `<a>`. Unit tests for `f_` prefix and `_`
  prefix fallbacks in `resolveSthlpFile`.
- **Checker script:** Update `check-help-links.ts` to use include expansion
  when validating anchors, so it accurately reflects the viewer's behavior.

## Out of scope

- Remaining genuinely unresolvable topics (`h2omlestat`, `h2omlgraph`,
  `dynamic`, `Java`, etc.) — reassess after Parts 1–3
- `{search}` as a functional search feature (would require new webview UX)
- Rendering `.ihlp` content differently from inline content (no visual
  distinction needed)

# Fix Broken Links in Help Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken anchor links in the SMCL help viewer, render `{viewerjumpto}` as a clickable TOC, handle `{search}`/`{view}`/`{dialog}` directives properly, and build a test script to detect broken links across all help pages.

**Architecture:** Thread `##anchor` fragments through the entire link pipeline (renderer → webview → panel manager). Collect `{viewerjumpto}` preamble directives and render as a horizontal TOC bar. Build a standalone script reusing existing SMCL infrastructure to validate all links.

**Tech Stack:** TypeScript, Bun, VS Code Webview API

**Design spec:** `docs/superpowers/specs/2026-04-25-help-viewer-broken-links-design.md`

---

### Task 1: Add `current_topic` to RenderContext and SmclToHtmlOptions

The renderer needs to know the current page's topic to distinguish same-page anchor links from cross-page links. We thread this through as an option.

**Files:**
- Modify: `client/src/smcl-preview/smcl-to-html.ts` (SmclToHtmlOptions, RenderContext, create_context, smcl_to_html)
- Modify: `client/src/smcl-preview/preview-panel.ts` (pass topic to smcl_to_html)
- Test: `tests/unit/smcl-to-html.test.ts`

- [ ] **Step 1: Write test for current_topic option passthrough**

In `tests/unit/smcl-to-html.test.ts`, add a test in the `links and cross-references` describe block:

```typescript
it('accepts current_topic option without affecting basic rendering', () => {
    const result = smcl_to_html('{help regress}', {
        current_topic: 'generate',
    });
    expect(result.html).toContain('data-smcl-topic="regress"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "accepts current_topic"`
Expected: FAIL — `current_topic` is not a recognized property on `SmclToHtmlOptions`.

- [ ] **Step 3: Add current_topic to SmclToHtmlOptions and RenderContext**

In `client/src/smcl-preview/smcl-to-html.ts`:

Add to `SmclToHtmlOptions` (around line 24):
```typescript
export interface SmclToHtmlOptions {
    findalias_map?: Map<string, string>;
    current_topic?: string;
}
```

Add to `RenderContext` (around line 307):
```typescript
interface RenderContext {
    // ... existing fields ...
    current_topic?: string;
}
```

Update `create_context` (around line 326):
```typescript
function create_context(
    findalias_map?: Map<string, string>,
    current_topic?: string
): RenderContext {
    return {
        // ... existing fields ...
        findalias_map,
        findalias_stack: [],
        current_topic,
    };
}
```

Update the `smcl_to_html` entry point (around line 1382):
```typescript
const ctx = create_context(options?.findalias_map, options?.current_topic);
```

- [ ] **Step 4: Pass current_topic from preview-panel.ts**

In `client/src/smcl-preview/preview-panel.ts`, in the `refresh()` method (around line 176), derive the topic from the filename:

```typescript
const my_result = smcl_to_html(my_content, {
    findalias_map: my_findalias_map,
    current_topic: this.get_current_topic(),
});
```

Add the helper method to `SmclPreviewPanel`:
```typescript
private get_current_topic(): string | undefined {
    const my_basename = this.source_uri.fsPath.split(/[\\/]/).pop();
    if (!my_basename) return undefined;
    // Strip .sthlp extension to get topic name
    const my_match = my_basename.match(/^(.+)\.sthlp$/i);
    return my_match?.[1];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "accepts current_topic"`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun run test`
Expected: All tests pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add client/src/smcl-preview/smcl-to-html.ts client/src/smcl-preview/preview-panel.ts tests/unit/smcl-to-html.test.ts
git commit -m "feat: add current_topic to SMCL render context for anchor resolution"
```

---

### Task 2: Thread `##anchor` through help links

Stop stripping the anchor from `{help topic##anchor}`. Same-page anchors become `a.smcl-jumpto` links; cross-page anchors get a `data-smcl-anchor` attribute.

**Files:**
- Modify: `client/src/smcl-preview/smcl-to-html.ts` (`render_help_link`)
- Test: `tests/unit/smcl-to-html.test.ts`

- [ ] **Step 1: Write tests for anchor handling in help links**

In `tests/unit/smcl-to-html.test.ts`, in the `links and cross-references` describe block:

```typescript
describe('anchor links', () => {
    it('renders same-page anchor as jumpto link', () => {
        const result = smcl_to_html('{help regress##syntax}', {
            current_topic: 'regress',
        });
        expect(result.html).toContain('class="smcl-jumpto"');
        expect(result.html).toContain('href="#syntax"');
        expect(result.html).not.toContain('data-smcl-topic');
    });

    it('renders cross-page anchor with data-smcl-anchor', () => {
        const result = smcl_to_html('{help regress##syntax}', {
            current_topic: 'generate',
        });
        expect(result.html).toContain('data-smcl-topic="regress"');
        expect(result.html).toContain('data-smcl-anchor="syntax"');
    });

    it('renders anchor-only link (no topic change) as jumpto', () => {
        // When topic matches current page
        const result = smcl_to_html('{help generate##description}', {
            current_topic: 'generate',
        });
        expect(result.html).toContain('href="#description"');
        expect(result.html).toContain('class="smcl-jumpto"');
    });

    it('renders help link without anchor unchanged', () => {
        const result = smcl_to_html('{help regress}', {
            current_topic: 'generate',
        });
        expect(result.html).toContain('data-smcl-topic="regress"');
        expect(result.html).not.toContain('data-smcl-anchor');
    });

    it('renders anchor link with display text', () => {
        const result = smcl_to_html(
            '{help regress##syntax:click here}',
            { current_topic: 'generate' }
        );
        expect(result.html).toContain('data-smcl-topic="regress"');
        expect(result.html).toContain('data-smcl-anchor="syntax"');
        expect(result.html).toContain('>click here</a>');
    });

    it('cross-page anchor link without current_topic uses navigate', () => {
        // Without current_topic, we can't know if it's same-page,
        // so always emit navigate link
        const result = smcl_to_html('{help regress##syntax}');
        expect(result.html).toContain('data-smcl-topic="regress"');
        expect(result.html).toContain('data-smcl-anchor="syntax"');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "anchor links"`
Expected: FAIL — anchors are stripped and no `data-smcl-anchor` or `smcl-jumpto` links are generated.

- [ ] **Step 3: Update render_help_link to handle anchors**

In `client/src/smcl-preview/smcl-to-html.ts`, replace `render_help_link` (lines 956–985):

```typescript
function render_help_link(
    directive: SmclDirective,
    ctx: RenderContext,
    bold: boolean,
    italic: boolean
): string {
    // {help topic} or {help topic##anchor} or {help topic:display_text}
    const my_full_topic = directive.args || '';
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_full_topic);

    // Split topic##anchor — Stata uses ## as the anchor separator
    const my_anchor_idx = my_full_topic.indexOf('##');
    const my_topic_name = (my_anchor_idx >= 0
        ? my_full_topic.substring(0, my_anchor_idx)
        : my_full_topic
    ).split(' ')[0].trim();
    const my_anchor = my_anchor_idx >= 0
        ? my_full_topic.substring(my_anchor_idx + 2).split(' ')[0].trim()
        : '';

    const my_id = `smcl-ref-${ctx.ref_counter++}`;
    ctx.cross_references.push({
        topic: my_topic_name,
        display_text: my_full_topic,
        element_id: my_id,
    });

    let my_html: string;

    // Same-page anchor: render as in-page jump link
    if (
        my_anchor &&
        ctx.current_topic &&
        my_topic_name === ctx.current_topic
    ) {
        my_html =
            `<a class="smcl-jumpto" id="${my_id}" ` +
            `href="#${escape_html(my_anchor)}"` +
            `>${my_display}</a>`;
    } else if (my_anchor) {
        // Cross-page anchor: navigate link with anchor data
        my_html =
            `<a class="smcl-help-link" id="${my_id}" ` +
            `href="#" data-smcl-topic="${escape_html(my_topic_name)}" ` +
            `data-smcl-anchor="${escape_html(my_anchor)}"` +
            `>${my_display}</a>`;
    } else {
        // No anchor: standard navigate link
        my_html =
            `<a class="smcl-help-link" id="${my_id}" ` +
            `href="#" data-smcl-topic="${escape_html(my_topic_name)}"` +
            `>${my_display}</a>`;
    }

    if (bold) my_html = `<strong>${my_html}</strong>`;
    if (italic) my_html = `<em>${my_html}</em>`;
    return my_html;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "anchor links"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass. Some existing tests may need minor updates if they assert on exact HTML output for links with `##` — update them to match the new behavior.

- [ ] **Step 6: Commit**

```bash
git add client/src/smcl-preview/smcl-to-html.ts tests/unit/smcl-to-html.test.ts
git commit -m "feat: thread ##anchor through help links for same-page and cross-page navigation"
```

---

### Task 3: Handle anchor in webview click handler and message passing

Update the webview script to include anchor in navigate messages, and the preview panel / panel manager to scroll to anchors after navigation.

**Files:**
- Modify: `client/src/smcl-preview/webview-html.ts` (click handler, message handler)
- Modify: `client/src/smcl-preview/preview-panel.ts` (handle_message, on_navigate callback type)
- Modify: `client/src/smcl-preview/panel-manager.ts` (handle_navigate, open_topic, open_or_reveal)

- [ ] **Step 1: Update the webview click handler to include anchor**

In `client/src/smcl-preview/webview-html.ts`, update the help link click handler (around line 292):

Change:
```javascript
const link = e.target.closest('a[data-smcl-topic]');
if (link) {
    e.preventDefault();
    e.stopPropagation();
    const topic = link.getAttribute('data-smcl-topic');
    if (topic) {
        vscode.postMessage({ type: 'navigate', topic: topic });
    }
    return;
}
```

To:
```javascript
const link = e.target.closest('a[data-smcl-topic]');
if (link) {
    e.preventDefault();
    e.stopPropagation();
    const topic = link.getAttribute('data-smcl-topic');
    if (topic) {
        const anchor = link.getAttribute('data-smcl-anchor');
        var msg = { type: 'navigate', topic: topic };
        if (anchor) { msg.anchor = anchor; }
        vscode.postMessage(msg);
    }
    return;
}
```

- [ ] **Step 2: Add scrollToAnchor message handler in webview**

In `client/src/smcl-preview/webview-html.ts`, update the message listener (around line 388):

Change:
```javascript
window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'scrollToLine') {
        scrollToSourceLine(msg.line);
    }
});
```

To:
```javascript
window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'scrollToLine') {
        scrollToSourceLine(msg.line);
    }
    if (msg.type === 'scrollToAnchor') {
        var target = document.getElementById(msg.anchor);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    }
});
```

- [ ] **Step 3: Update preview-panel.ts to pass anchor through**

In `client/src/smcl-preview/preview-panel.ts`:

Update the `on_navigate` callback type (line 32):
```typescript
private on_navigate: (topic: string, anchor?: string) => void;
```

Update the constructor parameter (line 51):
```typescript
on_navigate: (topic: string, anchor?: string) => void,
```

Update `handle_message` (around line 381):
```typescript
case 'navigate':
    if (typeof message.topic === 'string') {
        const my_anchor = typeof message.anchor === 'string'
            ? message.anchor
            : undefined;
        this.on_navigate(message.topic, my_anchor);
    }
    break;
```

Add a public method to post scrollToAnchor:
```typescript
scroll_to_anchor(anchor: string): void {
    this.panel.webview.postMessage({
        type: 'scrollToAnchor',
        anchor,
    });
}
```

- [ ] **Step 4: Update panel-manager.ts to handle anchor navigation**

In `client/src/smcl-preview/panel-manager.ts`:

Update `handle_navigate` (line 131):
```typescript
private handle_navigate(
    topic: string,
    anchor?: string
): Promise<void> {
    return this.open_topic(topic, vscode.ViewColumn.Active, anchor);
}
```

Update `open_topic` (line 68) to accept and use anchor:
```typescript
async open_topic(
    topic: string,
    column: vscode.ViewColumn,
    anchor?: string
): Promise<void> {
    const my_client = this.get_client();
    if (!my_client) {
        vscode.window.showInformationMessage(
            'Language server not ready. Try again in a moment.'
        );
        return;
    }

    try {
        const my_result = await my_client.sendRequest<{
            file_path: string | null;
        }>('sight/resolveSthlpFile', { topic });

        if (my_result?.file_path) {
            const my_uri = vscode.Uri.file(my_result.file_path);
            this.open_or_reveal(my_uri, column, anchor);
        } else {
            await this.show_not_found_message(topic);
        }
    } catch (err) {
        console.error(
            `open_topic: sendRequest sight/resolveSthlpFile` +
            ` failed for topic="${topic}":`, err
        );
        await this.show_server_error_message(topic);
    }
}
```

Update `open_or_reveal` to accept anchor and scroll after revealing:
```typescript
open_or_reveal(
    source_uri: vscode.Uri,
    column: vscode.ViewColumn,
    anchor?: string
): void {
    const my_key = source_uri.toString();
    const my_existing = this.panels.get(my_key);

    if (my_existing) {
        my_existing.reveal(column);
        if (anchor) {
            my_existing.scroll_to_anchor(anchor);
        }
        return;
    }

    const my_name = source_uri.fsPath.split(/[\\/]/).pop() || 'SMCL';
    const my_panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        `Preview ${my_name}`,
        column,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    const my_preview = new SmclPreviewPanel(
        source_uri,
        my_panel,
        (topic, anch) => this.handle_navigate(topic, anch),
        () => this.get_client()
    );

    my_preview.on_did_dispose(() => {
        this.panels.delete(my_key);
        my_preview.cleanup();
    });

    this.panels.set(my_key, my_preview);

    // For newly created panels, scroll after initial render completes.
    // Use a short delay to allow the webview to finish rendering.
    if (anchor) {
        setTimeout(() => {
            my_preview.scroll_to_anchor(anchor);
        }, 300);
    }
}
```

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/smcl-preview/webview-html.ts client/src/smcl-preview/preview-panel.ts client/src/smcl-preview/panel-manager.ts
git commit -m "feat: pass anchor through navigate pipeline and scroll to anchor on open"
```

---

### Task 4: Render `{viewerjumpto}` as a TOC bar

Collect preamble `{viewerjumpto}` directives and render them as a horizontal table of contents at the top of the help page.

**Files:**
- Modify: `client/src/smcl-preview/smcl-to-html.ts` (new `collect_viewerjumpto_entries` function, new `render_viewerjumpto_toc` function, update entry point)
- Modify: `client/src/smcl-preview/webview-html.ts` (CSS for TOC bar)
- Test: `tests/unit/smcl-to-html.test.ts`

- [ ] **Step 1: Write tests for viewerjumpto TOC rendering**

In `tests/unit/smcl-to-html.test.ts`, update the existing viewerjumpto suppression test and add new tests:

```typescript
describe('viewerjumpto TOC', () => {
    it('renders viewerjumpto directives as a horizontal TOC bar', () => {
        const my_input =
            '{viewerjumpto "Syntax" "regress##syntax"}{...}\n' +
            '{viewerjumpto "Description" "regress##description"}{...}\n' +
            '{title:Title}\n' +
            '{p}Body text{p_end}';
        const result = smcl_to_html(my_input, {
            current_topic: 'regress',
        });
        expect(result.html).toContain('class="smcl-toc"');
        expect(result.html).toContain('href="#syntax"');
        expect(result.html).toContain('href="#description"');
        expect(result.html).toContain('>Syntax<');
        expect(result.html).toContain('>Description<');
    });

    it('renders TOC entries as smcl-jumpto links', () => {
        const my_input =
            '{viewerjumpto "Options" "test##options"}{...}\n' +
            '{p}Content{p_end}';
        const result = smcl_to_html(my_input, {
            current_topic: 'test',
        });
        expect(result.html).toContain('class="smcl-jumpto"');
        expect(result.html).toContain('href="#options"');
    });

    it('renders TOC with pipe separators', () => {
        const my_input =
            '{viewerjumpto "A" "x##a"}{...}\n' +
            '{viewerjumpto "B" "x##b"}{...}\n' +
            '{viewerjumpto "C" "x##c"}{...}\n';
        const result = smcl_to_html(my_input, {
            current_topic: 'x',
        });
        // Should have separators between entries
        expect(result.html).toContain('smcl-toc-separator');
    });

    it('does not render TOC when no viewerjumpto directives', () => {
        const result = smcl_to_html('{p}Just content{p_end}');
        expect(result.html).not.toContain('smcl-toc');
    });

    it('still suppresses viewerdialog and vieweralsosee', () => {
        const my_input =
            '{vieweralsosee "[D] dir" "mansection D dir"}{...}\n' +
            '{viewerdialog regress "dialog regress"}{...}';
        const result = smcl_to_html(my_input);
        expect(result.html).not.toContain('dir');
        expect(result.html).not.toContain('dialog');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "viewerjumpto TOC"`
Expected: FAIL — viewerjumpto directives are currently suppressed.

- [ ] **Step 3: Implement viewerjumpto TOC collection and rendering**

In `client/src/smcl-preview/smcl-to-html.ts`, add these functions before the entry point:

```typescript
interface ViewerJumptoEntry {
    label: string;
    anchor: string;
}

/**
 * Extract `{viewerjumpto "Label" "topic##anchor"}` directives from
 * the node list. These always appear in the preamble (before the
 * first non-metadata content). Returns the entries and the filtered
 * node list with viewerjumpto nodes removed.
 */
function collect_viewerjumpto_entries(
    nodes: SmclNode[]
): { entries: ViewerJumptoEntry[]; filtered: SmclNode[] } {
    const the_entries: ViewerJumptoEntry[] = [];
    const the_filtered: SmclNode[] = [];

    for (const my_node of nodes) {
        if (
            is_directive(my_node) &&
            my_node.name.toLowerCase() === 'viewerjumpto'
        ) {
            const my_args = my_node.args || '';
            // Parse: "Label" "topic##anchor"
            const my_match = my_args.match(
                /^"([^"]*)"\s+"[^#]*##([^"]*)"/
            );
            if (my_match) {
                the_entries.push({
                    label: my_match[1],
                    anchor: my_match[2],
                });
            }
        } else {
            the_filtered.push(my_node);
        }
    }

    return { entries: the_entries, filtered: the_filtered };
}

/**
 * Render collected viewerjumpto entries as a horizontal TOC bar.
 */
function render_viewerjumpto_toc(
    entries: ViewerJumptoEntry[]
): string {
    if (entries.length === 0) return '';

    const the_links = entries.map(my_entry =>
        `<a class="smcl-jumpto" href="#${escape_html(my_entry.anchor)}"` +
        `>${escape_html(my_entry.label)}</a>`
    );

    return (
        '<nav class="smcl-toc">' +
        the_links.join('<span class="smcl-toc-separator"> | </span>') +
        '</nav>'
    );
}
```

Update the `smcl_to_html` entry point (around line 1355) to collect viewerjumpto entries and prepend the TOC:

In the entry point, after the existing transforms and before `render_nodes`, add:

```typescript
export function smcl_to_html(
    smcl: string,
    options?: SmclToHtmlOptions
): SmclHtmlResult {
    const the_raw_nodes = parse_smcl(smcl);
    const the_stripped_nodes = strip_placeholder_title(the_raw_nodes);
    const the_p2col_nodes = transform_help_title(the_stripped_nodes);
    const the_findalias_nodes = transform_findalias_help_title(
        the_p2col_nodes,
        options?.findalias_map
    );

    // Collect {viewerjumpto} entries for the TOC bar, removing them
    // from the node list so they don't render inline.
    const { entries: the_toc_entries, filtered: the_nodes } =
        collect_viewerjumpto_entries(the_findalias_nodes);

    const ctx = create_context(options?.findalias_map, options?.current_topic);
    let html = render_viewerjumpto_toc(the_toc_entries);
    html += render_nodes(the_nodes, ctx);
    // ... rest unchanged (close asis, formats, tables) ...
```

The `viewerjumpto` case in `render_directive` can remain as `return ''` since the nodes are filtered out before rendering. But keep it as a safety net.

- [ ] **Step 4: Update the existing viewerjumpto suppression test**

The existing test at line 312 asserts that viewerjumpto content doesn't appear. Update it to expect the TOC instead:

```typescript
it('renders preamble {viewerjumpto} as TOC and suppresses {vieweralsosee} and {viewerdialog}', () => {
    const my_preamble =
        '{viewerjumpto "Syntax" "regress##syntax"}{...}\n' +
        '{viewerjumpto "Description" "regress##description"}{...}\n' +
        '{vieweralsosee "[D] dir" "mansection D dir"}{...}\n' +
        '{vieweralsosee "" "--"}{...}\n' +
        '{vieweralsosee "[D] cd" "help cd"}{...}\n' +
        '{viewerdialog regress "dialog regress"}{...}';
    const result = smcl_to_html(my_preamble, {
        current_topic: 'regress',
    });
    // viewerjumpto entries appear as a TOC
    expect(result.html).toContain('class="smcl-toc"');
    expect(result.html).toContain('href="#syntax"');
    expect(result.html).toContain('href="#description"');
    // vieweralsosee and viewerdialog are still suppressed
    expect(result.html).not.toContain('mansection');
    expect(result.html).not.toContain('dialog');
});
```

- [ ] **Step 5: Add TOC CSS**

In `client/src/smcl-preview/webview-html.ts`, add CSS after the existing link styles (around line 180):

```css
/* Table of contents bar */
.smcl-toc {
    padding: 6px 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    font-size: 0.9em;
    line-height: 1.8;
}
.smcl-toc-separator {
    color: var(--vscode-descriptionForeground, rgba(128, 128, 128, 0.7));
    margin: 0 2px;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "viewerjumpto"`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/smcl-preview/smcl-to-html.ts client/src/smcl-preview/webview-html.ts tests/unit/smcl-to-html.test.ts
git commit -m "feat: render {viewerjumpto} as clickable table-of-contents bar"
```

---

### Task 5: Handle `{search}` and `{view}` directives as links

Render `{search}` as a help link and `{view}` as a help link when the argument is a `.sthlp`/`.hlp` file.

**Files:**
- Modify: `client/src/smcl-preview/smcl-to-html.ts` (switch cases for search/view, new render functions)
- Test: `tests/unit/smcl-to-html.test.ts`

- [ ] **Step 1: Write tests for search and view directives**

In `tests/unit/smcl-to-html.test.ts`, add a new describe block:

```typescript
describe('{search} and {view} directives', () => {
    it('renders {search keyword} as a help link', () => {
        const result = smcl_to_html('{search robust}');
        expect(result.html).toContain('data-smcl-topic="robust"');
        expect(result.html).toContain('class="smcl-help-link"');
    });

    it('renders {search keyword:display text} with display text', () => {
        const result = smcl_to_html('{search robust:click here}');
        expect(result.html).toContain('data-smcl-topic="robust"');
        expect(result.html).toContain('>click here</a>');
    });

    it('renders {view file.sthlp} as a help link', () => {
        const result = smcl_to_html('{view regress.sthlp}');
        expect(result.html).toContain('data-smcl-topic="regress"');
        expect(result.html).toContain('class="smcl-help-link"');
    });

    it('renders {view file.hlp} as a help link', () => {
        const result = smcl_to_html('{view myhelp.hlp}');
        expect(result.html).toContain('data-smcl-topic="myhelp"');
    });

    it('renders {view other.txt} as plain text', () => {
        const result = smcl_to_html('{view notes.txt}');
        expect(result.html).toContain('notes.txt');
        expect(result.html).not.toContain('data-smcl-topic');
    });

    it('renders {view file.sthlp:display} with display text', () => {
        const result = smcl_to_html('{view regress.sthlp:see regress}');
        expect(result.html).toContain('data-smcl-topic="regress"');
        expect(result.html).toContain('>see regress</a>');
    });

    it('keeps {dialog} as plain text', () => {
        const result = smcl_to_html('{dialog regress:the dialog box}');
        expect(result.html).toContain('the dialog box');
        expect(result.html).not.toContain('data-smcl-topic');
        expect(result.html).not.toContain('href');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "search.*and.*view"`
Expected: FAIL — `{search}` and `{view}` currently render as plain text.

- [ ] **Step 3: Implement render functions for search and view**

In `client/src/smcl-preview/smcl-to-html.ts`, add new render functions:

```typescript
function render_search_link(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // {search keyword} or {search keyword:display_text}
    const my_topic = (directive.args || '').split(' ')[0].trim();
    if (!my_topic) return render_content(directive, ctx);

    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_topic);

    const my_id = `smcl-ref-${ctx.ref_counter++}`;
    ctx.cross_references.push({
        topic: my_topic,
        display_text: my_topic,
        element_id: my_id,
    });

    return (
        `<a class="smcl-help-link" id="${my_id}" ` +
        `href="#" data-smcl-topic="${escape_html(my_topic)}"` +
        `>${my_display}</a>`
    );
}

function render_view_link(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // {view filename} or {view filename:display_text}
    const my_filename = (directive.args || '').trim();
    if (!my_filename) return render_content(directive, ctx);

    // Only render as help link if it's a .sthlp or .hlp file
    const my_match = my_filename.match(/^(.+)\.(sthlp|hlp)$/i);
    if (!my_match) return render_content(directive, ctx);

    const my_topic = my_match[1];
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_filename);

    const my_id = `smcl-ref-${ctx.ref_counter++}`;
    ctx.cross_references.push({
        topic: my_topic,
        display_text: my_filename,
        element_id: my_id,
    });

    return (
        `<a class="smcl-help-link" id="${my_id}" ` +
        `href="#" data-smcl-topic="${escape_html(my_topic)}"` +
        `>${my_display}</a>`
    );
}
```

Update the switch cases (around lines 728–733):

```typescript
case 'dialog':
    return render_content(directive, ctx);
case 'view':
    return render_view_link(directive, ctx);
case 'search':
    return render_search_link(directive, ctx);
```

Also add `'search'` to the `ARGS_ONLY_DIRECTIVES` set (line 98) since search args may contain colons:

```typescript
const ARGS_ONLY_DIRECTIVES = new Set([
    'opt', 'opth', 'cmdab', 'browse', 'c', 'char',
    'viewerjumpto', 'viewerdialog', 'vieweralsosee', 'mansection',
    'marker', 'col', 'space', 'hline', 'dup',
    'p', 'p2colset', 'search',
]);
```

Wait — `{search}` and `{view}` can have `{search keyword:display}` syntax where colon separates args from content. They should NOT be in ARGS_ONLY_DIRECTIVES. The current parsing already handles the colon split correctly — `directive.args` gets the keyword and `directive.content` gets the display text. Leave ARGS_ONLY_DIRECTIVES unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smcl-to-html.test.ts --filter "search.*and.*view"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/smcl-preview/smcl-to-html.ts tests/unit/smcl-to-html.test.ts
git commit -m "feat: render {search} and {view .sthlp} directives as navigable help links"
```

---

### Task 6: Build broken-link detection script

Create `scripts/check-help-links.ts` that enumerates all commands, resolves their `.sthlp` files, renders them, and validates all links.

**Files:**
- Create: `scripts/check-help-links.ts`

- [ ] **Step 1: Create the script**

Create `scripts/check-help-links.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Broken-link checker for Stata help pages.
 *
 * Enumerates every command in the v18 cache, resolves each to a
 * `.sthlp` file, renders it via `smcl_to_html()`, then validates:
 *   1. Every `data-smcl-topic` can be resolved to a `.sthlp` file
 *   2. Every `href="#anchor"` has a matching `<a id="anchor">` in
 *      the same page
 *   3. Every `data-smcl-anchor` has a matching `<a id="anchor">` in
 *      the resolved target page
 *
 * Requires a local Stata installation (uses `discover_stata_ado_paths`).
 *
 * Usage:
 *   bun scripts/check-help-links.ts [--ado-path /path/to/ado]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { command_database } from '../src/command-database';
import type { CommandCache } from '../src/command-database/types';
import { WorkspaceIndexer } from '../src/indexer';
import { smcl_to_html } from '../client/src/smcl-preview/smcl-to-html';
import { discover_stata_ado_paths } from '../src/utils/stata-install-paths';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface BrokenLink {
    source_topic: string;
    link_type: 'topic' | 'same_page_anchor' | 'cross_page_anchor';
    target_topic: string;
    target_anchor: string;
    reason: string;
}

interface PageResult {
    topic: string;
    file_path: string;
    total_links: number;
    broken_links: BrokenLink[];
}

// -----------------------------------------------------------------------
// HTML link extraction (regex-based, sufficient for our controlled output)
// -----------------------------------------------------------------------

interface ExtractedLink {
    type: 'navigate' | 'same_page_anchor';
    topic: string;
    anchor: string;
}

function extract_links(html: string): ExtractedLink[] {
    const the_links: ExtractedLink[] = [];

    // Navigate links: data-smcl-topic="X" [data-smcl-anchor="Y"]
    const NAVIGATE_RE =
        /data-smcl-topic="([^"]*)"(?:\s+data-smcl-anchor="([^"]*)")?/g;
    let my_match: RegExpExecArray | null;
    while ((my_match = NAVIGATE_RE.exec(html)) !== null) {
        the_links.push({
            type: 'navigate',
            topic: my_match[1],
            anchor: my_match[2] || '',
        });
    }

    // Same-page anchor links: class="smcl-jumpto" ... href="#X"
    const JUMPTO_RE = /class="smcl-jumpto"[^>]*href="#([^"]*)"/g;
    while ((my_match = JUMPTO_RE.exec(html)) !== null) {
        the_links.push({
            type: 'same_page_anchor',
            topic: '',
            anchor: my_match[1],
        });
    }

    return the_links;
}

function extract_anchor_ids(html: string): Set<string> {
    const the_ids = new Set<string>();
    const ID_RE = /<a\s+id="([^"]*)"/g;
    let my_match: RegExpExecArray | null;
    while ((my_match = ID_RE.exec(html)) !== null) {
        the_ids.add(my_match[1]);
    }
    return the_ids;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main(): Promise<void> {
    // Parse args
    const the_args = process.argv.slice(2);
    let explicit_ado_path: string | undefined;
    for (let i = 0; i < the_args.length; i++) {
        if (the_args[i] === '--ado-path' && the_args[i + 1]) {
            explicit_ado_path = the_args[i + 1];
            i++;
        }
    }

    // Discover ado paths
    const the_ado_paths = explicit_ado_path
        ? [explicit_ado_path]
        : discover_stata_ado_paths();

    if (the_ado_paths.length === 0) {
        console.error(
            'No Stata installation found. Use --ado-path to specify.'
        );
        process.exit(1);
    }
    console.log(`Using ado paths: ${the_ado_paths.join(', ')}`);

    // Load command cache
    const my_cache_path = path.join(
        __dirname,
        '../src/command-database/caches/v18.json'
    );
    const the_cache = JSON.parse(
        fs.readFileSync(my_cache_path, 'utf-8')
    ) as CommandCache;
    command_database.load_cache(the_cache);

    // Set up indexer
    const my_throwaway = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sight-link-check-')
    );
    const my_indexer = new WorkspaceIndexer();
    await my_indexer.initialize([my_throwaway]);
    my_indexer.set_help_search_paths(the_ado_paths);

    // Enumerate topics
    const the_topics = command_database.get_all_command_names();
    console.log(`Checking ${the_topics.length} commands...\n`);

    // Cache of rendered pages: topic -> { html, anchor_ids }
    const the_page_cache = new Map<string, {
        html: string;
        anchor_ids: Set<string>;
    }>();

    // Render and cache a topic; returns null if unresolvable
    async function render_topic(
        topic: string
    ): Promise<{ html: string; anchor_ids: Set<string> } | null> {
        const my_cached = the_page_cache.get(topic);
        if (my_cached) return my_cached;

        const my_file_path = await my_indexer.resolve_sthlp_file(topic);
        if (!my_file_path) return null;

        const my_content = fs.readFileSync(my_file_path, 'utf-8');
        const my_result = smcl_to_html(my_content, {
            current_topic: topic,
        });
        const my_entry = {
            html: my_result.html,
            anchor_ids: extract_anchor_ids(my_result.html),
        };
        the_page_cache.set(topic, my_entry);
        return my_entry;
    }

    // Phase 1: Render all pages
    const the_results: PageResult[] = [];
    let resolved_count = 0;
    let unresolved_count = 0;

    for (const my_topic of the_topics) {
        const my_file_path = await my_indexer.resolve_sthlp_file(my_topic);
        if (!my_file_path) {
            unresolved_count++;
            continue;
        }
        resolved_count++;

        const my_page = await render_topic(my_topic);
        if (!my_page) continue;

        const the_links = extract_links(my_page.html);
        const the_broken: BrokenLink[] = [];

        for (const my_link of the_links) {
            if (my_link.type === 'same_page_anchor') {
                // Validate same-page anchor
                if (!my_page.anchor_ids.has(my_link.anchor)) {
                    the_broken.push({
                        source_topic: my_topic,
                        link_type: 'same_page_anchor',
                        target_topic: my_topic,
                        target_anchor: my_link.anchor,
                        reason: `No <a id="${my_link.anchor}"> in page`,
                    });
                }
            } else if (my_link.type === 'navigate') {
                // Validate topic resolution
                const my_target = await render_topic(my_link.topic);
                if (!my_target) {
                    the_broken.push({
                        source_topic: my_topic,
                        link_type: 'topic',
                        target_topic: my_link.topic,
                        target_anchor: my_link.anchor,
                        reason: `Cannot resolve ${my_link.topic}.sthlp`,
                    });
                } else if (my_link.anchor) {
                    // Validate cross-page anchor
                    if (!my_target.anchor_ids.has(my_link.anchor)) {
                        the_broken.push({
                            source_topic: my_topic,
                            link_type: 'cross_page_anchor',
                            target_topic: my_link.topic,
                            target_anchor: my_link.anchor,
                            reason: `No <a id="${my_link.anchor}"> in ${my_link.topic}`,
                        });
                    }
                }
            }
        }

        the_results.push({
            topic: my_topic,
            file_path: my_file_path,
            total_links: the_links.length,
            broken_links: the_broken,
        });
    }

    // Phase 2: Report
    const the_all_broken = the_results.flatMap(r => r.broken_links);
    const my_total_links = the_results.reduce(
        (sum, r) => sum + r.total_links, 0
    );

    console.log('=== Help Link Check Results ===\n');
    console.log(`Commands in cache:   ${the_topics.length}`);
    console.log(`Resolved to .sthlp:  ${resolved_count}`);
    console.log(`Unresolvable:        ${unresolved_count}`);
    console.log(`Total links checked: ${my_total_links}`);
    console.log(`Broken links:        ${the_all_broken.length}\n`);

    if (the_all_broken.length > 0) {
        // Group by source topic
        const the_by_source = new Map<string, BrokenLink[]>();
        for (const my_broken of the_all_broken) {
            const my_existing = the_by_source.get(my_broken.source_topic);
            if (my_existing) {
                my_existing.push(my_broken);
            } else {
                the_by_source.set(my_broken.source_topic, [my_broken]);
            }
        }

        for (const [my_source, my_links] of the_by_source) {
            console.log(`--- ${my_source} ---`);
            for (const my_link of my_links) {
                const my_target = my_link.target_anchor
                    ? `${my_link.target_topic}##${my_link.target_anchor}`
                    : my_link.target_topic;
                console.log(
                    `  [${my_link.link_type}] → ${my_target}: ${my_link.reason}`
                );
            }
            console.log('');
        }
    }

    // Cleanup
    fs.rmSync(my_throwaway, { recursive: true, force: true });

    if (the_all_broken.length > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
```

- [ ] **Step 2: Test the script runs (requires Stata installation)**

Run: `bun scripts/check-help-links.ts`
Expected: The script runs, enumerates commands, and produces a report. It may find broken links — that's expected and is input for the next iteration.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-help-links.ts
git commit -m "feat: add broken-link detection script for help pages"
```

---

### Task 7: Run the checker and triage results

Run the broken-link checker and categorize findings for targeted fixes.

- [ ] **Step 1: Run the script and capture output**

Run: `bun scripts/check-help-links.ts 2>&1 | tee /tmp/broken-links-baseline.txt`

- [ ] **Step 2: Triage the results**

Categorize broken links by pattern:
- Missing anchors in same-page links (marker not emitted or wrong name)
- Unresolvable topics (commands that don't have `.sthlp` files)
- Cross-page anchor mismatches

- [ ] **Step 3: Create a follow-up plan**

Based on the triage, create targeted fixes for each category. Common patterns:
- If many same-page anchors are missing, the `{marker}` rendering may need adjustment
- If certain topics can't resolve, the `resolve_sthlp_file` alias logic may need expansion
- If cross-page anchors fail, the anchor naming conventions may differ between pages

- [ ] **Step 4: Implement targeted fixes**

Apply fixes based on the triage findings.

- [ ] **Step 5: Rerun the script**

Run: `bun scripts/check-help-links.ts`
Expected: Fewer broken links. Repeat steps 3–5 until remaining items are known limitations.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve broken help links found by checker"
```

---

### Task 8: Run full test suite and typecheck

Final validation that all changes work together.

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors.

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 3: Manual verification**

Open the extension in VS Code (if available) and verify:
1. Help page for `generate` — click "See Description below" → page scrolls to Description section
2. Help page for `stset` — click `single_options` → navigates to correct section
3. Help page for `regress` — TOC bar appears at top with clickable entries
4. Cross-page links still navigate correctly

- [ ] **Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: final adjustments from manual verification"
```

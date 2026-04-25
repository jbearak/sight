# Help Viewer Split Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only split the editor when a help link is clicked from an editor view (hover/completion); command palette and in-viewer cross-references open in the active column.

**Architecture:** Two small wiring changes in the VS Code client extension. No new files, no new tests (these are VS Code API calls that can't be unit tested without mocking the entire extension host).

**Tech Stack:** TypeScript, VS Code Extension API

---

### Task 1: Change in-viewer navigation to Active column

**Files:**
- Modify: `client/src/smcl-preview/panel-manager.ts:131-133`

- [ ] **Step 1: Update `handle_navigate` to use `ViewColumn.Active`**

In `client/src/smcl-preview/panel-manager.ts`, change line 132 from:

```typescript
    private handle_navigate(topic: string): Promise<void> {
        return this.open_topic(topic, vscode.ViewColumn.Beside);
    }
```

to:

```typescript
    private handle_navigate(topic: string): Promise<void> {
        return this.open_topic(topic, vscode.ViewColumn.Active);
    }
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/smcl-preview/panel-manager.ts
git commit -m "fix: open in-viewer help links in active column instead of splitting"
```

---

### Task 2: Make `sight.openHelpTopic` column context-dependent

**Files:**
- Modify: `client/src/smcl-preview/index.ts:73-90`

- [ ] **Step 1: Update the `sight.openHelpTopic` handler to choose column based on origin**

In `client/src/smcl-preview/index.ts`, replace the command handler (lines 73-90):

```typescript
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.openHelpTopic',
            async (arg: unknown) => {
                let my_topic = extract_topic(arg);
                if (!my_topic) {
                    my_topic = await prompt_for_topic();
                }
                if (!my_topic) {
                    return;
                }
                await my_manager.open_topic(
                    my_topic,
                    vscode.ViewColumn.Beside
                );
            }
        )
    );
```

with:

```typescript
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.openHelpTopic',
            async (arg: unknown) => {
                const my_linked_topic = extract_topic(arg);
                let my_topic = my_linked_topic;
                if (!my_topic) {
                    my_topic = await prompt_for_topic();
                }
                if (!my_topic) {
                    return;
                }
                const my_column = my_linked_topic
                    ? vscode.ViewColumn.Beside
                    : vscode.ViewColumn.Active;
                await my_manager.open_topic(my_topic, my_column);
            }
        )
    );
```

`my_linked_topic` is non-null only when the command was invoked from a
hover/completion link (arg provided). When the user opens from the command
palette, `my_linked_topic` is null, so we use `Active`.

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: All tests pass (no behavioral change to tested code paths).

- [ ] **Step 4: Commit**

```bash
git add client/src/smcl-preview/index.ts
git commit -m "fix: open command-palette help topics in active column, keep split for editor links"
```

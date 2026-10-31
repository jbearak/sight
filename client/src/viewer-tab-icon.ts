/**
 * Editor-tab icons for sight's webview viewers (data browser, SMCL
 * preview, extension-conflict help).
 *
 * `WebviewPanel.iconPath` only began honoring a `ThemeIcon` (codicon) at
 * runtime in **VSCode 1.110** (microsoft/vscode#282608, finalized Feb 2026).
 * On older hosts the *only* way to set a custom tab icon is an image-file
 * `Uri` — which we deliberately do not ship. So the icon is gated on the
 * running VSCode version: on 1.110+ the panel gets its codicon; on older
 * hosts `iconPath` is left unset and the tab keeps VSCode's default page
 * icon (a graceful no-op, never an error). Sight now targets
 * `engines.vscode: ^1.123.0`, so every supported host passes the gate; it
 * stays as a guard for hosts that ignore `engines`.
 *
 * This is the single source of truth for that gate. New viewers should call
 * `applyViewerTabIcon(...)` rather than assigning `iconPath` directly, so both
 * the version guard and the type-cast below stay in one place.
 */

import * as vscode from 'vscode';
import { meetsMinVersion } from './version-gate.js';

/** First VSCode version whose runtime renders a `ThemeIcon` as a webview tab icon. */
const THEME_ICON_TAB_MIN = { major: 1, minor: 110 } as const;

/**
 * Locally-widened view of `WebviewPanel.iconPath`.
 *
 * Written when `@types/vscode` was pinned to 1.75, whose `iconPath` is typed
 * `Uri | { light; dark }` only, so assigning a `ThemeIcon` did not
 * type-check. The pin is now 1.120.0, whose `IconPath` includes
 * `ThemeIcon`, so this widening is no longer required but still type-checks.
 * A `WebviewPanel` is structurally assignable to this interface (its
 * narrower `iconPath` fits this wider union), so the cast in
 * `applyViewerTabIcon` needs no `unknown` and the assigned value stays fully
 * type-checked. Cannot be a `declare module 'vscode'` merge: interface merging
 * adds members but cannot re-type an existing property like `iconPath`.
 */
interface WebviewPanelWithThemeIcon {
    iconPath?: vscode.Uri | { readonly light: vscode.Uri; readonly dark: vscode.Uri } | vscode.ThemeIcon;
}

/**
 * A codicon to assign to a webview panel's `iconPath`, or `undefined` on
 * hosts that predate `ThemeIcon` tab-icon support. Assigning `undefined` to
 * `iconPath` is valid and leaves the default page icon in place.
 */
export function viewerTabIcon(codiconId: string): vscode.ThemeIcon | undefined {
    // `vscode.version` is always a string at runtime; guard anyway so test
    // doubles that omit it fall through to "unsupported" rather than throwing.
    if (typeof vscode.version !== 'string') return undefined;
    return meetsMinVersion(vscode.version, THEME_ICON_TAB_MIN.major, THEME_ICON_TAB_MIN.minor)
        ? new vscode.ThemeIcon(codiconId)
        : undefined;
}

/**
 * Assign a codicon to `panel`'s editor tab, or leave VSCode's default page
 * icon in place on hosts older than 1.110. Use this rather than assigning
 * `panel.iconPath` directly so the version guard and the floor-pinned-types
 * cast stay centralized here.
 */
export function applyViewerTabIcon(panel: vscode.WebviewPanel, codiconId: string): void {
    (panel as WebviewPanelWithThemeIcon).iconPath = viewerTabIcon(codiconId);
}

# Click a status bar item to open its Claude Code tab

**Date:** 2026-08-09
**Status:** approved

## Problem

Clicking a status bar item hides the session (`claudeContextBar.hideSession`). That is
not what the click affords: the item names a live Claude Code tab, so clicking it should
take you to that tab. Hiding is a rarely wanted action occupying the only interaction the
status bar offers.

## Goal

Clicking an item reveals the Claude Code tab for that session **in the current window**.
The manual hide feature is removed entirely.

## Non-goals

- **Cross-window jumps.** VS Code has no API to focus another window, and the workaround
  (`vscode://file/<cwd>` plus a shared-state file for cross-window IPC) is unverified.
  Out of scope.
- **Changing which sessions appear.** The existing filters (`onlyCurrentWindow`,
  `showScheduledTasks`, `idleTimeout`, `maxItems`) stay exactly as they are. In
  particular, sessions from the terminal CLI and Claude Desktop keep showing up, so the
  click handler must cope with them.
- **Automatic idle hiding.** `idleTimeout` is untouched. Only the *manual* hide goes away.

## Background: how the reveal works

The Claude Code VS Code extension (verified by reading the bundle of
`anthropic.claude-code-2.1.226-darwin-arm64`) registers:

```js
registerCommand("claude-vscode.editor.open", async (sessionId, prompt, viewColumn) => {
    ... createPanel(sessionId, prompt, viewColumn)
})

createPanel(e, t, r) {
    if (e) { let a = this.sessionPanels.get(e); if (a) { a.reveal(); ... return } }
    ... // no panel for this id: creates a NEW webview panel
}
```

`sessionPanels` is keyed by the Claude Code session id — the same UUID that names the
`.jsonl` file this extension already reads. So
`executeCommand('claude-vscode.editor.open', sessionId)` reveals the tab when the panel
lives in this window.

Two consequences drive the design:

1. The command is **private, undocumented API**. It can disappear in any update, so every
   call is guarded.
2. When the id is *not* in `sessionPanels`, the call **creates a new tab** instead of
   revealing one. Sessions that are not IDE tabs at all (terminal, Claude Desktop, SDK)
   must therefore never reach the command.

Session origin is readable from the `.jsonl`: the `entrypoint` field carries
`claude-vscode`, `cli`, `sdk-cli`, or `claude-desktop`. Verified across the local session
files: the field is present on nearly every `user`/`assistant`/`attachment`/`system`
line, not only the first, so the parser's existing forward pass (which starts after the
last `/clear`) always sees it.

## Design

### `src/revealSession.ts` — new pure module

Follows the existing pattern of `contextLimit.ts` and `sessionFilter.ts`: no `vscode`
import, so it is testable under `node --test`.

```ts
export type ClickAction =
  | { kind: 'reveal'; sessionId: string }
  | { kind: 'notice'; message: string };

export function resolveClickAction(
  session: { sessionId: string; entrypoint: string },
  claudeCommandAvailable: boolean
): ClickAction;
```

Decision order:

1. `entrypoint !== 'claude-vscode'` → `notice`. Covers `cli`, `sdk-cli`,
   `claude-desktop`, and an empty/missing `entrypoint` (older sessions). Fail-closed: an
   unknown origin never reaches the command, so a click can never spawn a surprise tab.
   The message names the origin it saw.
2. `!claudeCommandAvailable` → `notice` saying the Claude Code extension was not found.
3. Otherwise → `reveal`.

Checking `entrypoint` first yields the more specific message when both conditions hold.

### `src/extension.ts`

**Added**

- `entrypoint: string` on `SessionInfo` and on the `TokenUsage` shape returned by
  `getLatestTokenCount`, captured in the forward pass (first line that carries the
  field), defaulting to `''`.
- Command `claudeContextBar.revealSession`, taking `(sessionId, entrypoint)`. It resolves
  availability with `vscode.commands.getCommands(true)`, calls `resolveClickAction`, then
  either `executeCommand('claude-vscode.editor.open', sessionId)` or
  `window.showInformationMessage(message)`.
- Status bar item `command` points at `claudeContextBar.revealSession`; tooltip footer
  becomes `*Click to open this tab*`.

**Removed**

- The `hiddenSessions` map.
- The `claudeContextBar.hideSession` command registration.
- The hidden-session filter in `findActiveSessions` (the auto-unhide-on-new-activity
  branch goes with it).
- The `*Click to hide*` tooltip footer.

### Text updates

- `package.json`: drop "Click to manually hide." from the `idleTimeout` description.
- `README.md`: update the click description and the idle-timeout wording.
- `CHANGELOG.md`: new entry for the behaviour change (it is breaking for anyone relying
  on click-to-hide).

## Testing

`src/revealSession.test.ts`, run by the existing `npm test` (`tsc` then
`node --test out/*.test.js`):

| Case | Expected |
|------|----------|
| `entrypoint: 'claude-vscode'`, command available | `reveal` with the session id |
| `entrypoint: 'cli'` | `notice` |
| `entrypoint: 'sdk-cli'` | `notice` |
| `entrypoint: 'claude-desktop'` | `notice` |
| `entrypoint: ''` | `notice` |
| `entrypoint: 'claude-vscode'`, command unavailable | `notice` mentioning the extension |
| both conditions failing | `notice` about the origin, not about the extension |

Parser coverage: `getLatestTokenCount` reads the filesystem and is not currently under
test, so `entrypoint` extraction is verified through the manual gate rather than a unit
test.

**Manual gate (required).** Reading the bundle proves the command's shape, not its
runtime behaviour. In the Extension Development Host: click an item for a session started
as a VS Code tab and confirm the tab is revealed; click one for a terminal session and
confirm the notice appears with no new tab.

## Risks

- `claude-vscode.editor.open` is private API of the Claude Code extension. Mitigated by
  the `getCommands` guard: if it disappears, the click degrades to an informational
  message instead of throwing.
- A tab closed within `idleTimeout` still shows in the bar; clicking it opens a new tab
  resuming that session rather than revealing the old one. Accepted — resuming the
  conversation you just closed is a reasonable outcome.
- Two windows with the same folder open cannot be told apart. Nothing in the `.jsonl`
  identifies a window and no API exposes the Claude panels by session id, so a click in
  the wrong window opens a new tab there. Accepted as a rare case.
